"""
Telegram Userbot - Automatically call external SheerID Bot for verification
Supports: /daily auto-claim, /verify flow, /balance check
"""
import asyncio
import re
import logging
import os
from datetime import datetime, timedelta
from typing import Optional, Dict
from telethon import TelegramClient, events
from telethon.sessions import StringSession

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SheerIDUserbot:
    def __init__(self, api_id: int, api_hash: str, session_string: str = None, bot_username: str = "SheerID_Bot"):
        """
        Initialize Userbot
        
        Args:
            api_id: Telegram API ID
            api_hash: Telegram API Hash
            session_string: Optional session string (if already logged in)
            bot_username: Target bot username to send commands to
        """
        # If session_string is provided, use StringSession, otherwise verifykey.session file
        if session_string:
            session = StringSession(session_string)
        else:
            # Store session in /app/data/ so it persists across Docker rebuilds
            data_dir = os.path.join(os.path.dirname(__file__), "data")
            os.makedirs(data_dir, exist_ok=True)
            session = os.path.join(data_dir, "verifykey")
            
        self.client = TelegramClient(session, api_id, api_hash)
        self.bot_username = bot_username.lstrip("@") if bot_username else "SheerID_Bot"
        self.pending_verifications: Dict[str, asyncio.Future] = {}
        self.is_connected = False
        self._daily_task = None
        self._last_daily_claim = None
        self._response_waiters: list = []  # Generic response waiters
        
    async def start(self):
        """Start the client"""
        try:
            await self.client.start()
            self.is_connected = True
            me = await self.client.get_me()
            username = me.username or me.first_name if me else "Unknown"
            logger.info(f"Telegram Userbot started. Logged in as: {username}")
            
            # Register event handler for ALL messages from bot
            self.client.add_event_handler(self._on_message, events.NewMessage(from_users=self.bot_username))
            
            # Start daily claim scheduler
            self._daily_task = asyncio.create_task(self._daily_claim_scheduler())
            logger.info("Daily auto-claim scheduler started")
            
            # Claim daily right away on startup
            asyncio.create_task(self._safe_claim_daily())
            
        except Exception as e:
            logger.error(f"Failed to start Telegram Userbot: {e}")
            self.is_connected = False
            raise e

    async def stop(self):
        """Stop the client"""
        if self._daily_task:
            self._daily_task.cancel()
            self._daily_task = None
        if self.client:
            await self.client.disconnect()
            self.is_connected = False
            logger.info("Telegram Userbot stopped")

    # ========== Daily Auto-Claim ==========
    
    async def _daily_claim_scheduler(self):
        """Background task to claim /daily every 24 hours"""
        while True:
            try:
                # Wait until next claim time
                now = datetime.now()
                if self._last_daily_claim:
                    next_claim = self._last_daily_claim + timedelta(hours=24)
                    wait_seconds = (next_claim - now).total_seconds()
                    if wait_seconds > 0:
                        logger.info(f"Next /daily claim in {wait_seconds/3600:.1f} hours")
                        await asyncio.sleep(wait_seconds)
                else:
                    # First run - wait 24 hours for next auto-claim (we already claimed on startup)
                    await asyncio.sleep(24 * 3600)
                
                await self._safe_claim_daily()
                
            except asyncio.CancelledError:
                logger.info("Daily claim scheduler cancelled")
                break
            except Exception as e:
                logger.error(f"Daily claim scheduler error: {e}")
                await asyncio.sleep(3600)  # Retry in 1 hour on error
    
    async def _safe_claim_daily(self):
        """Safely claim daily credits"""
        try:
            result = await self.claim_daily()
            logger.info(f"Daily claim result: {result}")
        except Exception as e:
            logger.error(f"Failed to claim daily: {e}")
    
    async def claim_daily(self) -> dict:
        """Send /daily to claim free credits"""
        if not self.is_connected:
            return {"success": False, "error": "Userbot not connected"}
        
        logger.info("Claiming daily free credits...")
        response = await self._send_and_wait("/daily", timeout=15)
        
        self._last_daily_claim = datetime.now()
        
        if response:
            return {
                "success": True,
                "message": response,
                "claimed_at": self._last_daily_claim.isoformat()
            }
        else:
            return {
                "success": False,
                "error": "No response from bot",
                "claimed_at": self._last_daily_claim.isoformat()
            }
    
    # ========== Balance Check ==========
    
    async def check_balance(self) -> dict:
        """Send /balance to check remaining credits"""
        if not self.is_connected:
            return {"success": False, "error": "Userbot not connected"}
        
        response = await self._send_and_wait("/balance", timeout=15)
        
        if response:
            # Try to extract credit number from response
            credits = None
            match = re.search(r'(\d+)\s*credit', response, re.IGNORECASE)
            if match:
                credits = int(match.group(1))
            
            return {
                "success": True,
                "message": response,
                "credits": credits
            }
        return {"success": False, "error": "No response from bot"}
    
    # ========== Verification ==========

    async def verify(self, verification_link: str, timeout: int = 120) -> dict:
        """
        Complete verification flow:
        1. Send /verify command
        2. Wait for bot prompt
        3. Send the verification link
        4. Wait for verification result
        
        Args:
            verification_link: The full SheerID verification URL
            timeout: Timeout in seconds
            
        Returns:
            dict: Verification result {success: bool, message: str, ...}
        """
        if not self.is_connected:
            return {"success": False, "error": "Userbot not connected"}

        logger.info(f"Starting verification flow for link: {verification_link[:60]}...")
        
        try:
            # Step 1: Send the verification link directly to the bot
            # Most SheerID bots accept a direct link or /verify <link>
            response = await self._send_and_wait(verification_link, timeout=timeout)
            
            if not response:
                # Try with /verify prefix
                logger.info("No response to direct link, trying /verify command...")
                await self.client.send_message(self.bot_username, "/verify")
                await asyncio.sleep(3)
                
                # Then send the link
                response = await self._send_and_wait(verification_link, timeout=timeout)
            
            if not response:
                return {"success": False, "error": "No response from bot (timeout)"}
            
            # Check if bot is asking for more input (multi-step flow)
            if self._is_prompt(response):
                # Bot is asking for input, send the link  
                logger.info(f"Bot prompted, sending link...")
                response = await self._send_and_wait(verification_link, timeout=timeout)
            
            # Parse the final response
            return self._parse_verification_response(response)
            
        except asyncio.TimeoutError:
            logger.warning(f"Verification timeout")
            return {"success": False, "error": f"Verification timeout ({timeout}s)"}
        except Exception as e:
            logger.error(f"Verification error: {e}")
            return {"success": False, "error": str(e)}

    # ========== Helper Methods ==========
    
    async def _send_and_wait(self, message: str, timeout: int = 30) -> Optional[str]:
        """
        Send a message to the bot and wait for a response.
        
        Returns the bot's response text, or None if timeout.
        """
        future = asyncio.get_event_loop().create_future()
        self._response_waiters.append(future)
        
        try:
            await self.client.send_message(self.bot_username, message)
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            logger.warning(f"Timeout waiting for bot response to: {message[:50]}")
            return None
        finally:
            if future in self._response_waiters:
                self._response_waiters.remove(future)

    async def _on_message(self, event):
        """Handle ALL incoming messages from Bot"""
        try:
            text = event.message.text or ""
            logger.info(f"Received from Bot: {text[:150]}...")
            
            # First, check if any generic waiter is pending
            if self._response_waiters:
                waiter = self._response_waiters[0]
                if not waiter.done():
                    waiter.set_result(text)
                    return
            
            # Legacy: check for verification-specific responses
            vid = self._extract_vid_from_text(text)
            if vid and vid in self.pending_verifications:
                result = self._parse_verification_response(text)
                if not self.pending_verifications[vid].done():
                    self.pending_verifications[vid].set_result(result)
                
        except Exception as e:
            logger.error(f"Error processing message: {e}")
    
    def _is_prompt(self, text: str) -> bool:
        """Check if bot response is asking for input"""
        prompt_keywords = [
            "send me", "paste", "enter", "provide", "link",
            "url", "please send", "waiting for", "share"
        ]
        text_lower = text.lower()
        return any(kw in text_lower for kw in prompt_keywords)
    
    def _parse_verification_response(self, text: str) -> dict:
        """Parse bot's verification response into structured result"""
        text_upper = text.upper()
        
        # Success indicators
        if any(kw in text_upper for kw in ["CONGRATULATIONS", "VERIFIED", "APPROVED", "SUCCESS", "YOU'VE BEEN VERIFIED"]):
            return {
                "success": True,
                "status": "verified",
                "message": "Verification Approved",
                "raw_response": text
            }
        
        # Processing indicator
        if any(kw in text_upper for kw in ["PROCESSING", "PLEASE WAIT", "WORKING ON"]):
            return {
                "success": None,  # Still processing
                "status": "processing", 
                "message": "Verification in progress",
                "raw_response": text
            }
        
        # Failure indicators
        if any(kw in text_upper for kw in ["FAILED", "ERROR", "INVALID", "REJECTED", "DENIED", "EXPIRED"]):
            return {
                "success": False,
                "status": "failed",
                "error": "Verification Failed",
                "raw_response": text
            }
        
        # Insufficient credits
        if any(kw in text_upper for kw in ["INSUFFICIENT", "NO CREDIT", "NOT ENOUGH", "TOP UP"]):
            return {
                "success": False,
                "status": "no_credits",
                "error": "Insufficient credits",
                "raw_response": text
            }
        
        # Unknown response - return as-is
        return {
            "success": None,
            "status": "unknown",
            "message": text[:200],
            "raw_response": text
        }

    def _extract_vid(self, link: str) -> Optional[str]:
        """Extract verificationId from URL"""
        match = re.search(r"verificationId=([a-zA-Z0-9]+)", link)
        if match:
            return match.group(1)
        return None

    def _extract_vid_from_text(self, text: str) -> Optional[str]:
        """Extract verificationId from message text"""
        # Look for ID: <vid> pattern
        match = re.search(r"ID:\s*([a-zA-Z0-9]+)", text)
        if match:
            return match.group(1)
            
        # Look for verificationId in link
        match = re.search(r"verificationId=([a-zA-Z0-9]+)", text)
        if match:
            return match.group(1)
            
        return None
