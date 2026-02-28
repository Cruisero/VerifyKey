"""
Dual Bot Verifier
Two-bot verification pipeline:
  Step 1: @SatsetHelperbot  — warmup link
  Step 2: @AutoGeminiProbot — verify link
  Step 3 (on failure): bypass via SheerID API (submit empty doc to invalidate link)
"""

import asyncio
import re
import logging
from typing import Optional
from telethon import TelegramClient, events

logger = logging.getLogger(__name__)


class DualBotVerifier:
    """
    Execute the dual-bot verification flow using an external TelegramClient.
    The client is managed by TelegramAccountManager — this class only holds references.
    """

    def __init__(self, warmup_bot: str = "SatsetHelperbot", verify_bot: str = "AutoGeminiProbot"):
        self.warmup_bot = warmup_bot.lstrip("@")
        self.verify_bot = verify_bot.lstrip("@")

    async def verify(self, client: TelegramClient, link: str, auto_bypass: bool = True, timeout: int = 120) -> dict:
        """
        Run full dual-bot verification pipeline.

        Returns:
            dict with: success, status, message, verificationId, claimLink, raw_response
        """
        if not client or not client.is_connected():
            return {"success": False, "status": "error", "message": "Telegram 未连接"}

        vid = self._extract_vid(link)
        if not vid:
            return {"success": False, "status": "error", "message": "无法从链接中提取 verificationId"}

        # ---- Step 1: Warmup via @SatsetHelperbot ----
        logger.info(f"[DualBot] Step 1: Warmup {vid[:8]}... via @{self.warmup_bot}")
        warmup_result = await self._send_and_wait(client, self.warmup_bot, link, timeout=60)

        if warmup_result is None:
            return {
                "success": False,
                "status": "warmup_timeout",
                "verificationId": vid,
                "message": "预热超时，请重试"
            }

        logger.info(f"[DualBot] Warmup response: {warmup_result[:100]}...")

        # ---- Step 2: Verify via @AutoGeminiProbot ----
        logger.info(f"[DualBot] Step 2: Verify {vid[:8]}... via @{self.verify_bot}")
        verify_result = await self._send_and_wait(client, self.verify_bot, link, timeout=timeout)

        if verify_result is None:
            return {
                "success": False,
                "status": "timeout",
                "verificationId": vid,
                "message": f"验证超时（{timeout}s），请重试"
            }

        # Parse result
        parsed = self._parse_response(verify_result, vid)

        # ---- Step 3: Auto bypass on failure ----
        if not parsed["success"] and auto_bypass and parsed["status"] in ("failed", "rejected"):
            logger.info(f"[DualBot] Step 3: Auto-bypass for {vid[:8]}...")
            bypass_ok = await self._bypass_link(vid)
            if bypass_ok:
                parsed["message"] = "验证失败，链接已自动刷新，请重新获取验证链接"
                parsed["bypassed"] = True
            else:
                parsed["message"] = "验证失败，自动刷新链接时出错"
                parsed["bypassed"] = False

        return parsed

    # ---- Send message and wait for reply ----

    async def _send_and_wait(self, client: TelegramClient, bot_username: str, message: str, timeout: int = 60) -> Optional[str]:
        """Send a message to a bot and wait for the next reply."""
        future = asyncio.get_event_loop().create_future()

        async def handler(event):
            if not future.done():
                future.set_result(event.message.text)

        # Register temporary handler
        client.add_event_handler(handler, events.NewMessage(from_users=bot_username))

        try:
            await client.send_message(bot_username, message)
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            logger.warning(f"[DualBot] Timeout waiting for @{bot_username}")
            return None
        except Exception as e:
            logger.error(f"[DualBot] Error with @{bot_username}: {e}")
            return None
        finally:
            client.remove_event_handler(handler)

    # ---- Parse bot response ----

    def _parse_response(self, text: str, vid: str) -> dict:
        """Parse @AutoGeminiProbot response."""
        result = {
            "success": None,
            "status": "unknown",
            "verificationId": vid,
            "message": "",
            "claimLink": None,
            "raw_response": text,
        }

        text_upper = text.upper()

        # Extract claim link
        link_match = re.search(r'(https://one\.google\.com/[^\s\n]+)', text)
        if link_match:
            result["claimLink"] = link_match.group(1)

        # Check for failure first
        if any(kw in text_upper for kw in ["VERIFICATION FAILED", "FAILED", "❌", "REJECTED", "UNSUCCESSFUL"]):
            result["success"] = False
            result["status"] = "failed"
            result["message"] = "验证失败"
            return result

        # Check for success
        if any(kw in text_upper for kw in ["CONGRATULATIONS", "APPROVED", "VERIFIED", "SUCCESS", "✅", "🎉"]):
            result["success"] = True
            result["status"] = "approved"
            result["message"] = "验证通过！"
            return result

        # Check for processing
        if any(kw in text_upper for kw in ["PROCESSING", "WAIT", "⏳"]):
            result["status"] = "processing"
            result["message"] = "正在处理..."
            return result

        # Unknown
        result["message"] = text[:200]
        return result

    # ---- Bypass (submit empty doc to invalidate link) ----

    async def _bypass_link(self, vid: str) -> bool:
        """
        Submit an empty/minimal document to SheerID to invalidate the verification link.
        Uses the SheerID REST API directly (same as verifier.py docUpload flow).
        """
        import httpx

        try:
            base_url = "https://services.sheerid.com/rest/v2"

            async with httpx.AsyncClient(timeout=30) as client:
                # Step A: Check current step
                check_resp = await client.get(f"{base_url}/verification/{vid}")
                if check_resp.status_code != 200:
                    logger.warning(f"[Bypass] Check failed: {check_resp.status_code}")
                    return False

                step = check_resp.json().get("currentStep", "")
                logger.info(f"[Bypass] Current step for {vid[:8]}: {step}")

                # Skip SSO if needed
                if step in ("sso", "collectStudentPersonalInfo"):
                    await client.delete(f"{base_url}/verification/{vid}/step/sso")
                    logger.info(f"[Bypass] Skipped SSO for {vid[:8]}")

                # Step B: Request upload URL with a tiny dummy file
                upload_body = {"files": [{"fileName": "bypass.png", "mimeType": "image/png", "fileSize": 68}]}
                upload_resp = await client.post(
                    f"{base_url}/verification/{vid}/step/docUpload",
                    json=upload_body
                )

                if upload_resp.status_code != 200:
                    logger.warning(f"[Bypass] Upload request failed: {upload_resp.status_code}")
                    return False

                docs = upload_resp.json().get("documents", [])
                if not docs or not docs[0].get("uploadUrl"):
                    logger.warning("[Bypass] No upload URL returned")
                    return False

                # Step C: Upload a minimal valid PNG (1x1 transparent pixel)
                # 68-byte minimal PNG
                import base64
                tiny_png = base64.b64decode(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                )

                upload_url = docs[0]["uploadUrl"]
                s3_resp = await client.put(upload_url, content=tiny_png, headers={"Content-Type": "image/png"})
                if not (200 <= s3_resp.status_code < 300):
                    logger.warning(f"[Bypass] S3 upload failed: {s3_resp.status_code}")
                    return False

                # Step D: Complete upload
                complete_resp = await client.post(f"{base_url}/verification/{vid}/step/completeDocUpload")
                logger.info(f"[Bypass] Complete response: {complete_resp.status_code}")

                return True

        except Exception as e:
            logger.error(f"[Bypass] Error: {e}")
            return False

    # ---- Helpers ----

    @staticmethod
    def _extract_vid(link: str) -> Optional[str]:
        match = re.search(r'verificationId=([a-zA-Z0-9]+)', link)
        return match.group(1) if match else None
