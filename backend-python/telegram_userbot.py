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
    def __init__(self, api_id: int, api_hash: str, session_string: str = None, bot_username: str = "SheerID_Bot"):
        if session_string:
            session = StringSession(session_string)
        else:
            # Store session in data/ so it persists across Docker rebuilds
            data_dir = os.path.join(os.path.dirname(__file__), "data")
            os.makedirs(data_dir, exist_ok=True)
            session = os.path.join(data_dir, "verifykey")

        self.client = TelegramClient(session, api_id, api_hash)
        self.bot_username = bot_username.lstrip("@") if bot_username else "SheerID_Bot"
        self.is_connected = False
        self._daily_task = None
        self._last_daily_claim = None
        self._response_waiters: list = []

    async def start(self):
        """Start the client and register event handler"""
        try:
            await self.client.start()
            self.is_connected = True
            me = await self.client.get_me()
            username = me.username or me.first_name if me else "Unknown"
            logger.info(f"Telegram Userbot started. Logged in as: {username}")

            # Register event handler for bot messages
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

    # ========== Verification ==========

    async def verify(self, verification_link: str, timeout: int = 120) -> dict:
        """
        Send a full verification link to the bot and wait for result.

        The bot flow:
        1. We send the full link (e.g. https://services.sheerid.com/verify/xxx/?verificationId=yyy)
        2. Bot responds with "Processing your verification request..."
        3. Bot sends final result: APPROVED or REJECTED

        We need to collect ALL messages until we get a definitive result,
        since the bot may send multiple messages (processing + result).

        Returns:
            dict with: success (bool), status (str), verificationId, credits, message, claimLink, raw_response
        """
        if not self.is_connected:
            return {"success": False, "status": "error", "message": "Userbot not connected"}

        logger.info(f"Sending verification link: {verification_link[:80]}...")

        # Collect all responses (bot sends multiple messages)
        collected_responses: List[str] = []
        result_event = asyncio.Event()
        final_result = {"found": False}

        async def collector(event):
            text = event.message.text or ""
            logger.info(f"Bot message: {text[:100]}...")
            collected_responses.append(text)

            # Check if this is a final response (not just "Processing...")
            parsed = self._parse_bot_response(text)
            if parsed["status"] in ("approved", "rejected", "error"):
                final_result["data"] = parsed
                final_result["found"] = True
                result_event.set()

        # Add temporary collector
        self.client.add_event_handler(collector, events.NewMessage(from_users=self.bot_username))

        try:
            # Send the verification link
            await self.client.send_message(self.bot_username, verification_link)

            # Wait for final result
            try:
                await asyncio.wait_for(result_event.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning(f"Verification timeout after {timeout}s")

            if final_result["found"]:
                return final_result["data"]
            elif collected_responses:
                # Parse whatever we got
                full_text = "\n".join(collected_responses)
                return self._parse_bot_response(full_text)
            else:
                return {
                    "success": False,
                    "status": "timeout",
                    "message": f"No response from bot (timeout {timeout}s)"
                }
        finally:
            # Remove temporary collector
            self.client.remove_event_handler(collector)

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
        id_match = re.search(r'ID:\s*([a-zA-Z0-9]+)', text)
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
        if any(kw in text_upper for kw in ["CONGRATULATIONS", "VERIFICATION APPROVED", "STATUS: VERIFIED"]):
            result["success"] = True
            result["status"] = "approved"
            result["message"] = "✅ 验证通过！"
            return result

        if "VERIFICATION REJECTED" in text_upper or "❌" in text:
            result["success"] = False
            result["status"] = "rejected"

            # Extract rejection reason
            if "RATE LIMITED" in text_upper or "TOO MANY REQUESTS" in text_upper:
                result["message"] = "❌ 被拒绝：请求过于频繁"
                result["reason"] = "rate_limited"
            elif "DO NOT OPEN" in text_upper:
                result["message"] = "❌ 被拒绝：链接已被打开"
                result["reason"] = "link_opened"
            elif "EXPIRED" in text_upper:
                result["message"] = "❌ 被拒绝：链接已过期"
                result["reason"] = "expired"
            elif "INVALID" in text_upper:
                result["message"] = "❌ 被拒绝：无效链接"
                result["reason"] = "invalid"
            else:
                result["message"] = "❌ 验证被拒绝"
                result["reason"] = "unknown"
            return result

        if "PROCESSING" in text_upper or "请求" in text:
            result["status"] = "processing"
            result["message"] = "⏳ 正在处理..."
            return result

        if any(kw in text_upper for kw in ["ERROR", "FAILED"]):
            result["success"] = False
            result["status"] = "error"
            result["message"] = "❌ 验证出错"
            return result

        if "INSUFFICIENT" in text_upper or "NOT ENOUGH" in text_upper:
            result["success"] = False
            result["status"] = "no_credits"
            result["message"] = "❌ Bot 额度不足"
            return result

        # Unknown - return raw
        result["message"] = text[:200]
        return result

    # ========== Helper Methods ==========

    async def _send_and_wait(self, message: str, timeout: int = 30) -> Optional[str]:
        """Send a message and wait for the next bot response."""
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
        """Handle incoming messages from Bot (for _send_and_wait)"""
        try:
            text = event.message.text or ""

            # Resolve any pending waiter
            if self._response_waiters:
                waiter = self._response_waiters[0]
                if not waiter.done():
                    waiter.set_result(text)

        except Exception as e:
            logger.error(f"Error processing message: {e}")
