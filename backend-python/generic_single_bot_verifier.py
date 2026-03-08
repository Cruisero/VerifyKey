"""
Generic Single Bot Verifier
Config-driven single-bot verification pipeline.
Takes a bot configuration object from the admin settings.
"""

import asyncio
import re
import logging
from typing import Optional, Dict
from telethon import TelegramClient, events

logger = logging.getLogger(__name__)


class GenericSingleBotVerifier:
    """
    Config-driven single-bot verifier.
    Sends a formatted link and waits for the final result based on configured rules.
    """

    def __init__(self, bot_config: dict):
        self.config = bot_config
        self.bot_id = bot_config.get("id", "unknown")
        self.bot_username = bot_config.get("username", "").lstrip("@")
        self._locks: Dict[str, asyncio.Lock] = {}
        self._semaphores: Dict[str, asyncio.Semaphore] = {}
        self._concurrent = bot_config.get("concurrentPerAccount", 1)
        self._cooldown_map: Dict[str, int] = {}  # vid -> cooldown_seconds

    def _get_lock(self, account_id: str):
        """Return Lock (concurrent=1) or Semaphore (concurrent>1)."""
        if self._concurrent > 1:
            if account_id not in self._semaphores:
                self._semaphores[account_id] = asyncio.Semaphore(self._concurrent)
            return self._semaphores[account_id]
        if account_id not in self._locks:
            self._locks[account_id] = asyncio.Lock()
        return self._locks[account_id]

    async def verify(self, client: TelegramClient, link: str, account_id: str = "default",
                     bot_username: str = None, auto_bypass: bool = None,
                     timeout: int = 180, on_progress=None) -> dict:
        """
        Run single-bot verification pipeline with per-account locking.
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
                                "success": True, "status": "approved", "verificationId": vid,
                                "message": "该链接已验证成功",
                                "messageKey": "msgAlreadyVerified",
                                "alreadyVerified": True
                            }
                        if initial_step == "docUpload" and rejection_reasons:
                            return {
                                "success": False, "status": "failed", "verificationId": vid,
                                "message": f"该链接已被拒绝 ({', '.join(rejection_reasons)})，请刷新页面获取新链接",
                                "messageKey": "msgLinkRejected"
                            }
            except Exception as e:
                logger.warning(f"[GenericBot:{self.bot_id}] [{account_id}] Pre-check failed: {e}")

            # ---- Send link and wait for result ----
            await emit("verify", "正在验证...")
            logger.info(f"[GenericBot:{self.bot_id}] [{account_id}] Sending {vid[:8]}... to @{bot}")

            # Schedule a delayed "waiting" progress update
            async def delayed_waiting():
                await asyncio.sleep(15)
                await emit("waiting", "等待验证结果...")
            waiting_task = asyncio.create_task(delayed_waiting())

            # Format the outbound message using config
            send_format = self.config.get("sendFormat", "{link}")
            outbound_msg = send_format.replace("{link}", link)

            # When concurrentPerAccount > 1, use VID matching to correlate responses
            match_vid = vid if self._concurrent > 1 else None
            reply = await self._send_and_wait(client, bot, outbound_msg, wait_for_final=True, timeout=timeout, match_vid=match_vid)

            waiting_task.cancel()

            cd_seconds = self._cooldown_map.pop(vid, None) or self._cooldown_map.pop("_default", None)
            if cd_seconds is not None:
                return {
                    "success": False, 
                    "status": "cooldown", 
                    "cooldown_seconds": cd_seconds,
                    "verificationId": vid,
                    "message": f"账号冷却中，请等待 {cd_seconds} 秒后再试"
                }

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

            # ---- Race condition check (for SheerID API sync) ----
            if not parsed.get("success") and parsed.get("status") in ("failed", "rejected") and initial_step not in ("success", "error"):
                try:
                    async with httpx.AsyncClient(timeout=10) as http_client:
                        check_resp = await http_client.get(f"https://services.sheerid.com/rest/v2/verification/{vid}")
                        if check_resp.status_code == 200:
                            actual_step = check_resp.json().get("currentStep", "")
                            if actual_step == "success":
                                logger.info(f"[GenericBot:{self.bot_id}] [{account_id}] Race condition! Bot said fail but SheerID says SUCCESS for {vid[:8]}")
                                parsed["success"] = True
                                parsed["status"] = "approved"
                                parsed["message"] = "验证通过"
                                parsed["messageKey"] = "msgApproved"
                except Exception as e:
                    logger.warning(f"[GenericBot:{self.bot_id}] [{account_id}] Race check failed: {e}")

            # ---- Auto bypass on failure ----
            do_bypass = auto_bypass if auto_bypass is not None else self.config.get("autoBypass", False)
            if not parsed.get("success") and do_bypass and parsed.get("status") in ("failed", "rejected"):
                await emit("failed", "验证失败，正在刷新链接...")
                await emit("bypass", "刷新链接中...")
                logger.info(f"[GenericBot:{self.bot_id}] [{account_id}] Running bypass for {vid[:8]}...")
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
                              wait_for_final: bool = False, timeout: int = 180,
                              match_vid: str = None) -> Optional[str]:
        """
        Send a message to a bot and wait for the reply.
        If wait_for_final is True, skips intermediate/processing messages.
        Supports both NewMessage and MessageEdited events.

        If match_vid is set, only captures messages containing that VID string,
        allowing multiple concurrent sends on the same account.
        """
        loop = asyncio.get_event_loop()
        future = loop.create_future()

        auto_click_buttons = [btn.lower() for btn in self.config.get("autoClickButtons", [])]

        async def handler(event):
            if future.done():
                return

            reply_text = event.message.text or event.message.message or ""
            if not reply_text and hasattr(event.message, 'photo') and event.message.photo:
                reply_text = event.message.caption or ""

            if not reply_text:
                return

            # ---- VID matching: only capture messages for OUR VID ----
            if match_vid:
                # Bot may return VID without dashes (e.g. "69aaa4abfd3d62455b7a17ae")
                # but our VID has dashes (e.g. "69aaa4ab-fd3d-6245-5b7a-17ae")
                vid_no_dash = match_vid.replace("-", "")
                if match_vid not in reply_text and vid_no_dash not in reply_text:
                    # Message doesn't contain our VID — but check if it matches a
                    # response rule (e.g. "Service Update", "COOLDOWN") since some
                    # bot messages are global and don't include the VID.
                    if wait_for_final:
                        probe = self._parse_response(reply_text, match_vid)
                        if probe.get("status") not in ("unknown", "processing"):
                            logger.info(f"[GenericBot:{self.bot_id}] Non-VID message matched rule: {probe['status']} — {reply_text[:80]}")
                            # Accept this message as the result
                        else:
                            logger.debug(f"[GenericBot:{self.bot_id}] Skipping message (VID {match_vid[:8]} not found): {reply_text[:80]}")
                            return
                    else:
                        logger.debug(f"[GenericBot:{self.bot_id}] Skipping message (VID {match_vid[:8]} not found): {reply_text[:80]}")
                        return

            event_type = "New" if isinstance(event, events.NewMessage.Event) else "Edit"
            logger.info(f"[GenericBot:{self.bot_id}] {event_type} message from @{bot_username}: {reply_text[:120]}...")

            # ---- Auto-click configured buttons ----
            if auto_click_buttons and event.message.buttons:
                for i, row in enumerate(event.message.buttons):
                    for j, btn in enumerate(row):
                        btn_text = btn.text or ""
                        if any(k in btn_text.lower() for k in auto_click_buttons):
                            logger.info(f"[GenericBot:{self.bot_id}] Auto-clicking button: '{btn_text}'")
                            try:
                                await event.message.click(i, j)
                            except Exception as e:
                                logger.error(f"[GenericBot:{self.bot_id}] Failed to click button: {e}")
                            return  # Wait for the actual result msg

            # ---- Parse Status ----
            if wait_for_final:
                parsed = self._parse_response(reply_text, match_vid or "temp")
                logger.info(f"[GenericBot:{self.bot_id}] Parsed status for @{bot_username}: {parsed['status']}")

                if parsed.get("status") == "processing":
                    logger.info(f"[GenericBot:{self.bot_id}] Skipping processing message...")
                    return
                elif parsed.get("status") == "cooldown":
                    if match_vid:
                        self._cooldown_map[match_vid] = parsed.get("cooldown_seconds")
                    else:
                        self._cooldown_map["_default"] = parsed.get("cooldown_seconds")

            future.set_result(reply_text)

        client.add_event_handler(handler, events.NewMessage(from_users=bot_username))
        client.add_event_handler(handler, events.MessageEdited(from_users=bot_username))

        try:
            await client.send_message(bot_username, message)
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            logger.warning(f"[GenericBot:{self.bot_id}] Timeout waiting for @{bot_username}")
            return None
        except Exception as e:
            logger.error(f"[GenericBot:{self.bot_id}] Error with @{bot_username}: {e}")
            return None
        finally:
            client.remove_event_handler(handler, events.NewMessage)
            client.remove_event_handler(handler, events.MessageEdited)

    # ---- Parse bot response ----

    def _parse_response(self, text: str, vid: str) -> dict:
        """
        Parse bot response using dynamic configuration rules.
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

        # Extract Verification ID
        vid_match = re.search(r'Verification\s+ID:\s*([a-fA-F0-9]+)', text, flags=re.IGNORECASE)
        if vid_match:
            result["verificationId"] = vid_match.group(1)

        # Extract claim link (Google One)
        link_match = re.search(r'(https://one\.google\.com/[^\s\n]+)', text)
        if link_match:
            result["claimLink"] = link_match.group(1)

        # Config: Quota Parsing
        quota_config = self.config.get("quota", {})
        if quota_config and quota_config.get("remainingPattern"):
            quota_match = re.search(quota_config["remainingPattern"], text_clean, flags=re.IGNORECASE)
            if quota_match:
                result["remaining_quota"] = int(quota_match.group(1))

        # 1. Config: Evaluate Response Rules FIRST (definitive results take priority)
        rules = self.config.get("responseRules", [])
        for rule in rules:
            keywords = [k.upper() for k in rule.get("keywords", [])]
            if any(k in text_clean for k in keywords):
                result["success"] = rule.get("success", False)
                result["status"] = rule.get("status", "failed")
                result["message"] = rule.get("message", "Rule matched")
                if "failureReasonKey" in rule:
                    result["failureReasonKey"] = rule["failureReasonKey"]
                if "messageKey" in rule:
                    result["messageKey"] = rule["messageKey"]
                return result

        # 2. Config: Processing Keywords (check BEFORE cooldown to avoid false positives)
        #    e.g. "Please wait while we..." contains "WAIT" which could match cooldown keywords
        processing_kws = self.config.get("processingKeywords", [])
        if processing_kws:
            for kw in processing_kws:
                if kw.upper() in text_clean:
                    result["success"] = None
                    result["status"] = "processing"
                    result["message"] = "Processing..."
                    return result

        # 3. Config: Cooldown Parsing (only if no definitive rule or processing matched)
        cooldown_config = self.config.get("cooldown", {})
        if cooldown_config and cooldown_config.get("keywords"):
            if any(k.upper() in text_clean for k in cooldown_config.get("keywords", [])):
                cd_pattern = cooldown_config.get("timePattern")
                result["status"] = "cooldown"
                result["success"] = False
                result["cooldown_seconds"] = 30  # Default
                
                if cd_pattern:
                    min_match = re.search(cd_pattern, text_clean, flags=re.IGNORECASE)
                    if min_match:
                        try:
                            result["cooldown_seconds"] = int(min_match.group(1)) * 60 + 10
                        except Exception:
                            pass
                return result

        # 4. Safe fallback
        logger.info(f"[GenericBot:{self.bot_id}] No status matched, falling back.")
        result["success"] = False
        result["status"] = "failed"
        result["message"] = f"请求失败: {text[:60]}..."
        result["messageKey"] = "msgRequestFailed"
        result["failureReasonKey"] = "reasonFailed"
        return result

    # ---- Bypass (reuse logic) ----

    async def _run_bypass(self, vid: str, account_id: str) -> bool:
        """Submit dummy docs to SheerID to invalidate the link."""
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
                        logger.info(f"[GenericBot:{self.bot_id}] [{account_id}] Bypass: Pending cleared -> {step}")
                        break

                    if poll % 5 == 0:
                        logger.info(f"[GenericBot] [{account_id}] Bypass: Waiting pending... ({(poll+1)*3}s)")
                    await asyncio.sleep(3)
                else:
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

            logger.info(f"[GenericBot:{self.bot_id}] [{account_id}] Bypass: Done. {bypass_count} uploads")
            return bypass_count > 0

        except Exception as e:
            logger.error(f"[GenericBot:{self.bot_id}] [{account_id}] Bypass error: {e}")
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
            return False

    @staticmethod
    def _extract_vid(link: str) -> Optional[str]:
        match = re.search(r'verificationId=([a-zA-Z0-9-]+)', link)
        return match.group(1) if match else None
