"""
Telegram Userbot - Send verification links to @SheerID_Verification_bot and parse results.
Supports: /daily auto-claim, verify link flow, /balance check
"""
import asyncio
import re
import logging
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from telethon import TelegramClient, events
from telethon.sessions import StringSession

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SheerIDUserbot:
    def __init__(self, api_id: int, api_hash: str, session_string: str = None, bot_username: str = "SheerID_Verification_bot"):
        if session_string:
            session = StringSession(session_string)
        else:
            # Store session in data/ so it persists across Docker rebuilds
            data_dir = os.path.join(os.path.dirname(__file__), "data")
            os.makedirs(data_dir, exist_ok=True)
            session = os.path.join(data_dir, "verifykey")

        self.client = TelegramClient(session, api_id, api_hash)
        self.bot_username = bot_username.lstrip("@") if bot_username else "SheerID_Verification_bot"
        self.is_connected = False
        self._daily_task = None
        self._last_daily_claim = None
        self._response_waiters: list = []
        # ID-based concurrent verification matching
        # Key: verificationId, Value: asyncio.Future that resolves to parsed result dict
        self._pending_verifications: Dict[str, asyncio.Future] = {}
        # Fallback queue for messages we can't match by ID (e.g. "Processing...")
        self._unmatched_messages: List[str] = []
        # Track which external clients already have our handler registered
        self._registered_clients: set = set()

    async def start(self):
        """Start the client and register event handler"""
        try:
            await self.client.start()
            self.is_connected = True
            me = await self.client.get_me()
            username = me.username or me.first_name if me else "Unknown"
            logger.info(f"Telegram Userbot started. Logged in as: {username}")

            # Register SINGLE event handler for ALL bot messages
            self.client.add_event_handler(self._on_bot_message, events.NewMessage(from_users=self.bot_username))

            # Start daily claim scheduler
            self._daily_task = asyncio.create_task(self._daily_claim_scheduler())
            logger.info("Daily auto-claim scheduler started")

            # Claim daily on startup
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
                now = datetime.now()
                if self._last_daily_claim:
                    next_claim = self._last_daily_claim + timedelta(hours=24)
                    wait_seconds = (next_claim - now).total_seconds()
                    if wait_seconds > 0:
                        logger.info(f"Next /daily claim in {wait_seconds/3600:.1f} hours")
                        await asyncio.sleep(wait_seconds)
                else:
                    await asyncio.sleep(24 * 3600)

                await self._safe_claim_daily()

            except asyncio.CancelledError:
                logger.info("Daily claim scheduler cancelled")
                break
            except Exception as e:
                logger.error(f"Daily claim scheduler error: {e}")
                await asyncio.sleep(3600)

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
            credits = None
            match = re.search(r'(\d+)\s*credit', response, re.IGNORECASE)
            if match:
                credits = int(match.group(1))
            return {"success": True, "message": response, "credits": credits}
        return {"success": False, "error": "No response from bot"}

    # ========== Verification (ID-based concurrent matching) ==========

    def register_handler(self, client: TelegramClient):
        """
        Register the bot message event handler on an external TelegramClient.
        This allows pool clients to forward bot responses to our _pending_verifications matching.
        Safe to call multiple times — will skip already-registered clients.
        """
        client_id = id(client)
        if client_id in self._registered_clients:
            return
        client.add_event_handler(self._on_bot_message, events.NewMessage(from_users=self.bot_username))
        self._registered_clients.add(client_id)
        logger.info(f"[OldBot] Registered handler on pool client {client_id}")

    async def verify(self, verification_link: str, timeout: int = 120) -> dict:
        """Send a verification link using the internal client (backward compat)."""
        if not self.is_connected:
            return {"success": False, "status": "error", "message": "Userbot not connected"}
        return await self.verify_with_client(self.client, verification_link, timeout=timeout)

    async def verify_with_client(self, client: TelegramClient, verification_link: str, timeout: int = 120) -> dict:
        """
        Send a verification link using any TelegramClient from the pool.

        Concurrent-safe: multiple links can be sent simultaneously.
        Each bot response contains the verificationId (e.g. "ID: 6995269523c407520aeac689"),
        which is used to match the response back to the correct request.

        Returns:
            dict with: success, status, verificationId, credits, message, claimLink, raw_response
        """
        # Extract verificationId from the link
        vid_match = re.search(r'verificationId=([a-zA-Z0-9]+)', verification_link)
        if not vid_match:
            return {"success": False, "status": "error", "message": "Cannot extract verificationId from link"}

        verification_id = vid_match.group(1)

        logger.info(f"Sending verification: {verification_id}")

        # Register pending verification with a Future
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self._pending_verifications[verification_id] = future

        try:
            # Format message based on target bot
            if "gemini_2026" in self.bot_username.lower():
                message = f"/verify {verification_link}"
            else:
                message = verification_link

            # Send to the bot via the provided client
            await client.send_message(self.bot_username, message)

            # Wait for the matching result
            result = await asyncio.wait_for(future, timeout=timeout)
            return result

        except asyncio.TimeoutError:
            logger.warning(f"Verification timeout for {verification_id} after {timeout}s")
            return {
                "success": False,
                "status": "timeout",
                "verificationId": verification_id,
                "message": f"Verification did not return results within {timeout}s, auto-cancelled!"
            }
        except Exception as e:
            logger.error(f"Verification error for {verification_id}: {e}")
            return {
                "success": False,
                "status": "error",
                "verificationId": verification_id,
                "message": f"Verification error: {str(e)}"
            }
        finally:
            # Clean up pending entry
            self._pending_verifications.pop(verification_id, None)

    def _parse_bot_response(self, text: str) -> dict:
        """
        Parse the bot's response into a structured result.
        
        Bot response patterns:
        
        APPROVED:
          🎉🎊✨ CONGRATULATIONS! ✨🎊🎉
          🏆 VERIFICATION APPROVED! 🏆
          🆔 ID: 6995269523c407520aeac689
          ✅ Status: VERIFIED
          💎 Credits: 12
          🎁 CLAIM YOUR FREE GOOGLE AI PRO! 🎁
          🚀 https://one.google.com/ai-student?...
        
        REJECTED:
          ❌ Verification Rejected
          🆔 ID: 6995266f7167fe18a026b14c
          [reason text]
        
        PROCESSING:
          ⏳ Processing your verification request...
        """
        result = {
            "success": None,
            "status": "unknown",
            "verificationId": None,
            "credits": None,
            "message": "",
            "claimLink": None,
            "raw_response": text
        }

        text_upper = text.upper()

        # Extract verification ID
        id_match = re.search(r'ID:\s*`?([a-zA-Z0-9]+)`?', text)
        if id_match:
            result["verificationId"] = id_match.group(1)

        # Extract credits
        credits_match = re.search(r'Credits:\s*(\d+)', text, re.IGNORECASE)
        if credits_match:
            result["credits"] = int(credits_match.group(1))

        # Extract claim link
        link_match = re.search(r'(https://one\.google\.com/[^\s\n]+)', text)
        if link_match:
            result["claimLink"] = link_match.group(1)

        # Determine status
        # IMPORTANT: Check rejection FIRST — some rejection messages contain 
        # "success" in educational text (e.g. "ensures success!")
        if ("VERIFICATION REJECTED" in text_upper or "VERIFICATION UNSUCCESSFUL" in text_upper 
                or "❌" in text or "⛔" in text
                or "LINK EXPIRED" in text_upper or "CANNOT RESUME" in text_upper):
            result["success"] = False
            result["status"] = "rejected"

            # Extract rejection reason
            if "RATE LIMITED" in text_upper or "TOO MANY REQUESTS" in text_upper:
                result["message"] = "Rejected: Too many requests"
                result["reason"] = "rate_limited"
            elif "DO NOT OPEN" in text_upper or "DIFFERENT IP" in text_upper:
                result["message"] = "Rejected: Link already opened, please refresh the page"
                result["reason"] = "link_opened"
            elif "EXPIRED" in text_upper or "DOES NOT EXIST" in text_upper:
                result["message"] = "Rejected: Link expired, please refresh the page"
                result["reason"] = "expired"
            elif "INVALID" in text_upper or "COULD NOT BE VERIFIED" in text_upper:
                result["message"] = "Rejected: Invalid link, please refresh the page"
                result["reason"] = "invalid"
            elif "CANNOT RESUME" in text_upper:
                result["message"] = "Rejected: Cannot resume session"
                result["reason"] = "expired"
            else:
                result["message"] = "Verification rejected"
                result["reason"] = "unknown"
            return result

        if any(kw in text_upper for kw in ["CONGRATULATIONS", "VERIFICATION APPROVED", "STATUS: VERIFIED", "SUCCESS"]):
            result["success"] = True
            result["status"] = "approved"
            result["message"] = "Verification approved!"
            return result

        if "PROCESSING" in text_upper or "请求" in text:
            result["status"] = "processing"
            result["message"] = "⏳ Processing..."
            return result

        if any(kw in text_upper for kw in ["ERROR", "FAILED"]):
            result["success"] = False
            result["status"] = "error"
            result["message"] = "Verification error"
            return result

        if "INSUFFICIENT" in text_upper or "NOT ENOUGH" in text_upper:
            result["success"] = False
            result["status"] = "no_credits"
            result["message"] = "Insufficient documents"
            return result

        # Unknown - return raw
        result["message"] = text[:200]
        return result

    # ========== Helper Methods ==========

    async def _send_and_wait(self, message: str, timeout: int = 30) -> Optional[str]:
        """Send a message and wait for the next bot response (for /daily, /balance etc.)"""
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

    async def _on_bot_message(self, event):
        """
        Handle ALL incoming messages from the bot.
        
        For verification results: extract verificationId from the message and resolve
        the matching pending Future in _pending_verifications.
        
        For cooldown messages: resolve the most recent pending verification with cooldown status.
        
        For other messages (/daily, /balance): resolve via _response_waiters.
        """
        try:
            text = event.message.text or ""
            logger.info(f"Bot message received: {text[:120]}...")

            text_upper = text.upper()

            # Check for Cooldown Active message (no VID in these messages)
            if "COOLDOWN" in text_upper:
                # Extract wait time: "Please wait X seconds..."
                wait_match = re.search(r'wait\s+(\d+)\s*second', text, re.IGNORECASE)
                wait_seconds = int(wait_match.group(1)) if wait_match else 5
                logger.info(f"Cooldown detected: {wait_seconds}s")

                # Resolve the most recent pending verification with cooldown status
                if self._pending_verifications:
                    # Get the most recently added pending VID
                    vid = list(self._pending_verifications.keys())[-1]
                    future = self._pending_verifications.get(vid)
                    if future and not future.done():
                        future.set_result({
                            "success": False,
                            "status": "cooldown",
                            "verificationId": vid,
                            "cooldown_seconds": wait_seconds,
                            "message": f"Cooldown active, waiting {wait_seconds}s..."
                        })
                        logger.info(f"Cooldown resolved for pending VID {vid}")
                        return

            # Try to extract verificationId from the message
            id_match = re.search(r'ID:\s*`?([a-zA-Z0-9]+)`?', text)

            if id_match:
                vid = id_match.group(1)
                # Check if we have a pending verification for this ID
                if vid in self._pending_verifications:
                    parsed = self._parse_bot_response(text)
                    # Only resolve on final status (not "Processing...")
                    if parsed["status"] in ("approved", "rejected", "error", "no_credits"):
                        future = self._pending_verifications.get(vid)
                        if future and not future.done():
                            logger.info(f"Matched result for {vid}: {parsed['status']}")
                            future.set_result(parsed)
                            return
                    else:
                        logger.info(f"Non-final message for {vid}, waiting for final result...")
                        return

            # Skip "Processing..." messages — they don't have an ID
            if "PROCESSING" in text_upper:
                logger.info("Processing message received, waiting for final result...")
                return

            # Fallback: resolve simple waiters (for /daily, /balance commands)
            if self._response_waiters:
                waiter = self._response_waiters[0]
                if not waiter.done():
                    waiter.set_result(text)

        except Exception as e:
            logger.error(f"Error processing bot message: {e}")
