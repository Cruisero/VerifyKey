"""
Black Bot Verifier
Single-bot verification via @Black_Verifier.
Send SheerID link → wait for result message → parse response.

Response patterns (from bot):
  ✅ "VERIFICATION SUCCESSFUL!" + "Status: VERIFIED"
  ❌ "Verification Rejected" — Document verification failed
  ❌ "Task Failed" — Error: collectStudentPersonalInfo failed
  ❌ "Fraud Reject (Anti-Fraud)" — SheerID rejected the request
  ❌ "Verification Timed Out" — in review status for more than 3 minutes
"""

import asyncio
import re
import logging
from typing import Optional, Dict
from telethon import TelegramClient, events

logger = logging.getLogger(__name__)


class BlackBotVerifier:
    """
    Single-bot verifier for @Black_Verifier.
    Sends a SheerID link and waits for the final result.
    """

    def __init__(self, bot_username: str = "Black_Verifier"):
        self.bot_username = bot_username.lstrip("@")
        self._locks: Dict[str, asyncio.Lock] = {}

    def _get_lock(self, account_id: str) -> asyncio.Lock:
        if account_id not in self._locks:
            self._locks[account_id] = asyncio.Lock()
        return self._locks[account_id]

    async def verify(self, client: TelegramClient, link: str, account_id: str = "default",
                     bot_username: str = None, auto_bypass: bool = True,
                     timeout: int = 180, on_progress=None) -> dict:
        """
        Run single-bot verification pipeline with per-account locking.

        Args:
            client: The Telegram client to use
            link: The verification link
            account_id: ID of the Telegram account (for locking)
            bot_username: Override bot username
            auto_bypass: Whether to automatically refresh the link on failure
            timeout: Maximum time to wait for responses (default 180s — bot may take 3+ min)
            on_progress: Optional async callback(dict) for progress updates
        """
        async def emit(step, message):
            if on_progress:
                try:
                    await on_progress({"step": step, "message": message})
                except Exception:
                    pass

        async with self._get_lock(account_id):
            if not client or not client.is_connected():
                return {"success": False, "status": "error", "message": "程序离线，请联系管理员"}

            bot = (bot_username or self.bot_username).lstrip("@")

            vid = self._extract_vid(link)
            if not vid:
                return {"success": False, "status": "error", "message": "Cannot extract verificationId from link"}

            # ---- Pre-check VID status ----
            initial_step = None
            try:
                import httpx
                async with httpx.AsyncClient(timeout=10) as http_client:
                    pre_resp = await http_client.get(f"https://services.sheerid.com/rest/v2/verification/{vid}")
                    if pre_resp.status_code == 200:
                        pre_data = pre_resp.json()
                        initial_step = pre_data.get("currentStep", "")
                        error_ids = pre_data.get("errorIds", [])
                        rejection_reasons = pre_data.get("rejectionReasons", [])

                        if initial_step == "error":
                            return {
                                "success": False, "status": "failed", "verificationId": vid,
                                "message": f"该链接已失败 ({', '.join(error_ids) if error_ids else '未知错误'})，请刷新页面获取新链接",
                                "messageKey": "msgLinkFailed"
                            }
                        if initial_step == "success":
                            return {
                                "success": False, "status": "failed", "verificationId": vid,
                                "message": "该链接已验证成功，无需重复提交",
                                "messageKey": "msgAlreadyVerified"
                            }
                        if initial_step == "docUpload" and rejection_reasons:
                            return {
                                "success": False, "status": "failed", "verificationId": vid,
                                "message": f"该链接已被拒绝 ({', '.join(rejection_reasons)})，请刷新页面获取新链接",
                                "messageKey": "msgLinkRejected"
                            }
            except Exception as e:
                logger.warning(f"[BlackBot] [{account_id}] Pre-check failed: {e}")

            # ---- Send link and wait for result ----
            await emit("verify", "正在验证...")
            logger.info(f"[BlackBot] [{account_id}] Sending {vid[:8]}... to @{bot}")

            # Schedule a delayed "waiting" progress update
            async def delayed_waiting():
                await asyncio.sleep(15)
                await emit("waiting", "等待验证结果...")
            waiting_task = asyncio.create_task(delayed_waiting())

            reply = await self._send_and_wait(client, bot, link, wait_for_final=True, timeout=timeout)

            waiting_task.cancel()

            if reply is None:
                return {
                    "success": False,
                    "status": "timeout",
                    "verificationId": vid,
                    "message": "验证超时，请重试",
                    "messageKey": "msgVerifyTimeout"
                }

            # Parse result
            parsed = self._parse_response(reply, vid)

            # ---- Race condition check ----
            if not parsed["success"] and parsed["status"] in ("failed", "rejected") and initial_step not in ("success", "error"):
                try:
                    import httpx
                    async with httpx.AsyncClient(timeout=10) as http_client:
                        check_resp = await http_client.get(f"https://services.sheerid.com/rest/v2/verification/{vid}")
                        if check_resp.status_code == 200:
                            actual_step = check_resp.json().get("currentStep", "")
                            if actual_step == "success":
                                logger.info(f"[BlackBot] [{account_id}] Race condition! Bot said fail but SheerID says SUCCESS for {vid[:8]}")
                                parsed["success"] = True
                                parsed["status"] = "approved"
                                parsed["message"] = "验证通过"
                                parsed["messageKey"] = "msgApproved"
                except Exception as e:
                    logger.warning(f"[BlackBot] [{account_id}] Race check failed: {e}")

            # ---- Auto bypass on failure ----
            if not parsed["success"] and auto_bypass and parsed["status"] in ("failed", "rejected"):
                await emit("failed", "验证失败，正在刷新链接...")
                await emit("bypass", "刷新链接中...")
                logger.info(f"[BlackBot] [{account_id}] Running bypass for {vid[:8]}...")
                bypass_ok = await self._run_bypass(vid, account_id)

                reason_key = parsed.get("failureReasonKey", "reasonFailed")
                reason_zh = {
                    "reasonFraud": "检测到欺诈",
                    "reasonDocRejected": "文档被拒绝",
                    "reasonTaskFailed": "任务失败",
                    "reasonTimedOut": "验证超时",
                    "reasonFailed": "验证失败"
                }
                reason = reason_zh.get(reason_key, "验证失败")

                if bypass_ok:
                    parsed["message"] = f"{reason}，链接已刷新，请重新获取新链接"
                    parsed["messageKey"] = "msgBypassDone"
                    parsed["bypassed"] = "done"
                else:
                    parsed["message"] = f"{reason}，请等待几分钟后刷新页面获取新链接"
                    parsed["messageKey"] = "msgBypassFailed"
                    parsed["bypassed"] = "failed"
                parsed["failureReasonKey"] = reason_key

            return parsed

    # ---- Send message and wait for reply ----

    async def _send_and_wait(self, client: TelegramClient, bot_username: str, message: str,
                              wait_for_final: bool = False, timeout: int = 180) -> Optional[str]:
        """
        Send a message to a bot and wait for the reply.
        If wait_for_final is True, skips intermediate/processing messages.
        Supports both NewMessage and MessageEdited events.
        """
        loop = asyncio.get_event_loop()
        future = loop.create_future()

        async def handler(event):
            if future.done():
                return

            reply_text = event.message.text or event.message.message or ""
            if not reply_text and hasattr(event.message, 'photo') and event.message.photo:
                reply_text = event.message.caption or ""

            if not reply_text:
                return

            event_type = "New" if isinstance(event, events.NewMessage.Event) else "Edit"
            logger.info(f"[BlackBot] {event_type} message from @{bot_username}: {reply_text[:120]}...")

            if wait_for_final:
                parsed = self._parse_response(reply_text, "temp")
                logger.info(f"[BlackBot] Parsed status for @{bot_username}: {parsed['status']}")
                if parsed["status"] == "processing":
                    logger.info(f"[BlackBot] Skipping processing message from @{bot_username}...")
                    return

            future.set_result(reply_text)

        client.add_event_handler(handler, events.NewMessage(from_users=bot_username))
        client.add_event_handler(handler, events.MessageEdited(from_users=bot_username))

        try:
            await client.send_message(bot_username, message)
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            logger.warning(f"[BlackBot] Timeout waiting for @{bot_username}")
            return None
        except Exception as e:
            logger.error(f"[BlackBot] Error with @{bot_username}: {e}")
            return None
        finally:
            client.remove_event_handler(handler, events.NewMessage)
            client.remove_event_handler(handler, events.MessageEdited)

    # ---- Parse bot response ----

    def _parse_response(self, text: str, vid: str) -> dict:
        """
        Parse @Black_Verifier bot response.

        Response patterns:
          ✅ "VERIFICATION SUCCESSFUL!" + "Status: VERIFIED"  (no emoji prefixes)
          ❌ "Verification Rejected" + "Document verification failed"
          ❌ "Task Failed" + "Error: ..."
          ❌ "Fraud Reject (Anti-Fraud)"
          ❌ "Verification Timed Out"

        All failures show "Balance: not charged".
        """
        if not text:
            return {
                "success": False, "status": "failed", "verificationId": vid,
                "message": "Bot returned empty content", "raw_response": ""
            }

        result = {
            "success": None,
            "status": "unknown",
            "verificationId": vid,
            "message": "",
            "claimLink": None,
            "raw_response": text,
        }

        text_upper = text.upper()
        text_clean = " ".join(text_upper.split())
        logger.info(f"[BlackBot] Parsing {vid[:8]} - Text: {text_clean[:100]}...")

        # Extract Verification ID from "Verification ID: xxxx"
        vid_match = re.search(r'Verification\s+ID:\s*([a-fA-F0-9]+)', text)
        if vid_match:
            result["verificationId"] = vid_match.group(1)

        # Extract claim link (Google One)
        link_match = re.search(r'(https://one\.google\.com/[^\s\n]+)', text)
        if link_match:
            result["claimLink"] = link_match.group(1)

        # Extract remaining verifications from "X verifications remaining"
        remaining_match = re.search(r'(\d+)\s+VERIFICATIONS?\s+REMAINING', text_clean)
        if remaining_match:
            result["remaining_quota"] = int(remaining_match.group(1))

        # ======== 1. Check for PROCESSING (skip intermediate) ========
        # @Black_Verifier doesn't seem to send processing messages based on screenshots,
        # but handle it defensively if they add ⏳ or "Processing" in the future
        proc_keywords = ["PROCESSING", "⏳", "WAIT", "LOADING"]
        # Only match if there's NO definitive status in the same message
        is_definitive = any(k in text_clean for k in [
            "VERIFICATION SUCCESSFUL", "VERIFICATION REJECTED", "TASK FAILED",
            "FRAUD REJECT", "VERIFICATION TIMED OUT", "STATUS: VERIFIED"
        ])
        if not is_definitive:
            for kw in proc_keywords:
                if kw in text_clean:
                    result["success"] = None
                    result["status"] = "processing"
                    result["message"] = "Processing..."
                    return result

        # ======== 2. DEFINITIVE SUCCESS ========
        # "🎉🎉🎉 VERIFICATION SUCCESSFUL! 🎉🎉🎉" with "Status: VERIFIED"
        if "VERIFICATION SUCCESSFUL" in text_clean:
            logger.info(f"[BlackBot] Success matched: VERIFICATION SUCCESSFUL")
            result["success"] = True
            result["status"] = "approved"
            result["message"] = "验证通过"
            result["messageKey"] = "msgApproved"
            return result

        # ======== 3. FRAUD REJECT ========
        # "Fraud Reject (Anti-Fraud)" — SheerID rejected the request
        if "FRAUD REJECT" in text_clean or "FRAUD" in text_clean:
            logger.info(f"[BlackBot] Fraud rejection matched")
            result["success"] = False
            result["status"] = "failed"
            result["message"] = "检测到欺诈行为，请刷新页面获取新链接"
            result["messageKey"] = "msgFraudDetected"
            result["failureReasonKey"] = "reasonFraud"
            return result

        # ======== 4. VERIFICATION REJECTED ========
        # "Verification Rejected" + "Document verification failed — SheerID rejected the uploaded file"
        if "VERIFICATION REJECTED" in text_clean:
            logger.info(f"[BlackBot] Verification rejected matched")
            result["success"] = False
            result["status"] = "failed"
            result["message"] = "文档验证失败，SheerID 拒绝了上传的文件"
            result["messageKey"] = "msgVerifyFailedDetail"
            result["failureReasonKey"] = "reasonDocRejected"
            return result

        # ======== 5. TASK FAILED ========
        # "Task Failed" + "Error: collectStudentPersonalInfo failed: HTTP 400"
        if "TASK FAILED" in text_clean:
            logger.info(f"[BlackBot] Task failed matched")
            # Extract specific error message
            error_match = re.search(r'Error:\s*(.+?)(?:\n|$)', text)
            error_detail = error_match.group(1).strip() if error_match else "Unknown error"
            result["success"] = False
            result["status"] = "failed"
            result["message"] = f"任务失败: {error_detail}"
            result["messageKey"] = "msgVerifyFailedDetail"
            result["failureReasonKey"] = "reasonTaskFailed"
            return result

        # ======== 6. VERIFICATION TIMED OUT ========
        # "Verification Timed Out" — link in review status for too long
        if "VERIFICATION TIMED OUT" in text_clean or "TIMED OUT" in text_clean:
            logger.info(f"[BlackBot] Verification timed out matched")
            result["success"] = False
            result["status"] = "failed"
            result["message"] = "验证超时，链接审核时间过长"
            result["messageKey"] = "msgVerifyFailedDetail"
            result["failureReasonKey"] = "reasonTimedOut"
            return result

        # ======== 7. Fallback: generic failure keywords ========
        fail_keywords = ["FAILED", "❌", "REJECTED", "ERROR", "EXPIRED"]
        for kw in fail_keywords:
            if kw in text_clean:
                logger.info(f"[BlackBot] Generic failure keyword matched: {kw}")
                result["success"] = False
                result["status"] = "failed"
                result["message"] = f"验证失败: {text[:60]}..."
                result["messageKey"] = "msgVerifyFailedDetail"
                result["failureReasonKey"] = "reasonFailed"
                return result

        # ======== 8. Safe fallback: unknown → failure ========
        logger.info("[BlackBot] No status matched, falling back to failed.")
        result["success"] = False
        result["status"] = "failed"
        result["message"] = f"请求失败: {text[:60]}..."
        result["messageKey"] = "msgRequestFailed"
        result["failureReasonKey"] = "reasonFailed"
        return result

    # ---- Bypass (reuse DualBot's bypass logic) ----

    async def _run_bypass(self, vid: str, account_id: str) -> bool:
        """Run bypass sequence: upload dummy docs to invalidate link."""
        import httpx
        base_url = "https://services.sheerid.com/rest/v2"

        try:
            async with httpx.AsyncClient(timeout=30) as http_client:
                # Wait for pending to clear
                for poll in range(60):
                    check_resp = await http_client.get(f"{base_url}/verification/{vid}")
                    if check_resp.status_code == 200:
                        step = check_resp.json().get("currentStep", "")
                    else:
                        step = f"error_{check_resp.status_code}"

                    if step != "pending":
                        logger.info(f"[BlackBot] [{account_id}] Bypass: Pending cleared -> {step}")
                        break

                    if poll % 5 == 0:
                        logger.info(f"[BlackBot] [{account_id}] Bypass: Waiting for pending... ({(poll+1)*3}s)")
                    await asyncio.sleep(3)
                else:
                    logger.warning(f"[BlackBot] [{account_id}] Bypass: Pending timeout, aborting")
                    return False

            # Run bypass uploads
            bypass_count = 0
            for i in range(10):
                ok = await self._bypass_link(vid)
                if ok:
                    bypass_count += 1
                    await asyncio.sleep(1.5)
                else:
                    break

            logger.info(f"[BlackBot] [{account_id}] Bypass: Done. {bypass_count} uploads for {vid[:8]}")
            return bypass_count > 0

        except Exception as e:
            logger.error(f"[BlackBot] [{account_id}] Bypass error: {e}")
            return False

    async def _bypass_link(self, vid: str) -> bool:
        """Submit an empty document to SheerID to invalidate the link."""
        import httpx
        import base64

        try:
            base_url = "https://services.sheerid.com/rest/v2"

            async with httpx.AsyncClient(timeout=30) as client:
                check_resp = await client.get(f"{base_url}/verification/{vid}")
                if check_resp.status_code != 200:
                    return False

                step = check_resp.json().get("currentStep", "")

                if step == "pending":
                    await asyncio.sleep(5)
                    check_resp = await client.get(f"{base_url}/verification/{vid}")
                    step = check_resp.json().get("currentStep", "")
                    if step == "pending":
                        return False

                if step == "success":
                    return False

                if step in ("sso", "collectStudentPersonalInfo"):
                    await client.delete(f"{base_url}/verification/{vid}/step/sso")

                upload_body = {"files": [{"fileName": "bypass.png", "mimeType": "image/png", "fileSize": 68}]}
                upload_resp = await client.post(f"{base_url}/verification/{vid}/step/docUpload", json=upload_body)

                if upload_resp.status_code != 200:
                    return False

                docs = upload_resp.json().get("documents", [])
                if not docs or not docs[0].get("uploadUrl"):
                    return False

                tiny_png = base64.b64decode(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                )

                upload_url = docs[0]["uploadUrl"]
                s3_resp = await client.put(upload_url, content=tiny_png, headers={"Content-Type": "image/png"})
                if not (200 <= s3_resp.status_code < 300):
                    return False

                await client.post(f"{base_url}/verification/{vid}/step/completeDocUpload")
                return True

        except Exception as e:
            logger.error(f"[BlackBot Bypass] Error: {e}")
            return False

    @staticmethod
    def _extract_vid(link: str) -> Optional[str]:
        match = re.search(r'verificationId=([a-zA-Z0-9-]+)', link)
        return match.group(1) if match else None
