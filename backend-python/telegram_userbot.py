"""
Telegram Userbot - Automatically call external SheerID Bot for verification
"""
import asyncio
import re
import logging
import os
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
            session = "verifykey"
            
        self.client = TelegramClient(session, api_id, api_hash)
        self.bot_username = bot_username
        self.pending_verifications: Dict[str, asyncio.Future] = {}
        self.is_connected = False
        
    async def start(self):
        """Start the client"""
        try:
            await self.client.start()
            self.is_connected = True
            logger.info(f"Telegram Userbot started. Logged in as: {(await self.client.get_me()).username}")
            
            # Register event handler for new messages
            self.client.add_event_handler(self._on_message, events.NewMessage(from_users=self.bot_username))
            
        except Exception as e:
            logger.error(f"Failed to start Telegram Userbot: {e}")
            self.is_connected = False
            raise e

    async def stop(self):
        """Stop the client"""
        if self.client:
            await self.client.disconnect()
            self.is_connected = False
            logger.info("Telegram Userbot stopped")

    async def verify(self, sheerid_link: str, timeout: int = 120) -> dict:
        """
        Send verification request and wait for result
        
        Args:
            sheerid_link: The verification link
            timeout: Timeout in seconds
            
        Returns:
            dict: Verification result {success: bool, message: str, ...}
        """
        if not self.is_connected:
            return {"success": False, "error": "Userbot not connected"}

        # Extract verificationId from link for tracking
        vid = self._extract_vid(sheerid_link)
        if not vid:
            return {"success": False, "error": "Invalid SheerID link format"}
            
        logger.info(f"Starting verification for VID: {vid}")
        
        # Create Future to wait for result
        future = asyncio.get_event_loop().create_future()
        self.pending_verifications[vid] = future
        
        try:
            # Send message to Bot
            await self.client.send_message(self.bot_username, f"/verify {sheerid_link}")
            
            # Wait for result
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
            
        except asyncio.TimeoutError:
            logger.warning(f"Verification timeout for VID: {vid}")
            return {"success": False, "error": "Verification timeout (120s)"}
        except Exception as e:
            logger.error(f"Verification error for VID {vid}: {e}")
            return {"success": False, "error": str(e)}
        finally:
            # Cleanup
            self.pending_verifications.pop(vid, None)

    async def _on_message(self, event):
        """Handle incoming messages from Bot"""
        try:
            text = event.message.text
            logger.info(f"Received message from Bot: {text[:100]}...")
            
            # Parse response
            # Need to extract verificationId from the text to match with pending request
            # Common formats:
            # "ID: <verification_id>"
            # Link containing verificationId
            
            vid = self._extract_vid_from_text(text)
            
            if not vid:
                # Some bots might reply to the message, we can check reply_to_msg_id if needed
                # But usually they include the ID or link
                return

            if vid not in self.pending_verifications:
                return

            result = None
            
            # Check for success keywords
            if "VERIFICATION APPROVED" in text or "SUCCESS" in text.upper():
                result = {
                    "success": True, 
                    "status": "verified",
                    "message": "Verification Approved",
                    "raw_response": text
                }
            # Check for failure keywords
            elif "FAILED" in text.upper() or "ERROR" in text.upper() or "INVALID" in text.upper():
                result = {
                    "success": False, 
                    "error": "Verification Failed by Bot",
                    "raw_response": text
                }
            
            if result:
                self.pending_verifications[vid].set_result(result)
                
        except Exception as e:
            logger.error(f"Error processing message: {e}")

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
