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

    def __init__(self, warmup_bot: str = "SatsetHelperbot", verify_bot: str = "AutoGeminiProbot", config: dict = None):
        self.warmup_bot = warmup_bot.lstrip("@")
        self.verify_bot = verify_bot.lstrip("@")
        self.config = config or {}
        # New: Per-account locks to prevent concurrent requests on the same account
        self._locks: Dict[str, asyncio.Lock] = {}

    def _get_lock(self, account_id: str) -> asyncio.Lock:
        if account_id not in self._locks:
            self._locks[account_id] = asyncio.Lock()
        return self._locks[account_id]

    async def verify(self, client: TelegramClient, link: str, account_id: str = "default", warmup_bot: str = None, verify_bot: str = None, auto_bypass: bool = True, timeout: int = 120, on_progress=None) -> dict:
        """
        Run full dual-bot verification pipeline with per-account locking.

        Args:
            client: The Telegram client to use
            link: The verification link
            account_id: ID of the Telegram account (for locking)
            warmup_bot: Username of the warmup bot
            verify_bot: Username of the verification bot
            auto_bypass: Whether to automatically refresh the link on failure
            timeout: Maximum time to wait for responses
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

            # Use provided bots or instance defaults
            w_bot = (warmup_bot or self.warmup_bot).lstrip("@")
            v_bot = (verify_bot or self.verify_bot).lstrip("@")

            vid = self._extract_vid(link)
            if not vid:
                return {"success": False, "status": "error", "message": "Cannot extract verificationId from link"}

            # ---- Pre-check VID status before processing ----
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
                logger.warning(f"[DualBot] [{account_id}] Pre-check failed: {e}")

            # ---- Step 1: Warmup via @SatsetHelperbot ----
            await emit("warmup", "Generating document...")
            logger.info(f"[DualBot] [{account_id}] Step 1: Warmup {vid[:8]}... via @{w_bot}")
            # We wait for the FINAL result (not just 'Processing...')
            warmup_result = await self._send_and_wait(client, w_bot, link, wait_for_final=True, timeout=90)

            if warmup_result is None:
                return {
                    "success": False,
                    "status": "warmup_timeout",
                    "verificationId": vid,
                    "message": f"文档生成超时，请重试",
                    "messageKey": "msgWarmupTimeout"
                }

            logger.info(f"[DualBot] [{account_id}] Warmup response: {warmup_result[:100]}...")
            
            # Step 1 Check: Strict Success Required for WARMUP logic
            warmup_parsed = self._parse_response(warmup_result, vid, is_warmup=True)
            
            if not warmup_parsed.get("success"):
                logger.warning(f"[DualBot] [{account_id}] Warmup failed/rejected by @{w_bot}: {warmup_parsed['message']}")
                # Tag cooldown with stage so waterfall knows link was NOT yet consumed
                if warmup_parsed.get("status") == "cooldown":
                    warmup_parsed["cooldown_stage"] = "warmup"
                else:
                    warmup_parsed["message"] = f"文档生成失败: {warmup_parsed['message']}"
                    warmup_parsed["messageKey"] = "msgWarmupFailed"
                return warmup_parsed

            logger.info(f"[DualBot] [{account_id}] Warmup stage SUCCEEDED. Proceeding to Step 2...")

            # ---- Step 2: Verify via @AutoGeminiProbot ----
            await emit("verify", "Submitting document...")
            logger.info(f"[DualBot] [{account_id}] Step 2: Verify {vid[:8]}... via @{v_bot}")
            
            # Schedule a delayed "waiting" progress update
            async def delayed_waiting():
                await asyncio.sleep(10)
                await emit("waiting", "Waiting for verification...")
            waiting_task = asyncio.create_task(delayed_waiting())
            
            # ENABLING wait_for_final=True because @AutoGeminiProbot edits "Processing" -> "Success/Fail"
            verify_result = await self._send_and_wait(client, v_bot, link, wait_for_final=True, timeout=timeout)
            
            # Cancel the delayed waiting task if verification completes before 10s
            waiting_task.cancel()

            if verify_result is None:
                return {
                    "success": False,
                    "status": "timeout",
                    "verificationId": vid,
                    "message": f"验证超时，请重试",
                    "messageKey": "msgVerifyTimeout"
                }

            # Parse result
            parsed = self._parse_response(verify_result, vid, is_warmup=False)
            # Tag verify-stage cooldown so waterfall knows link was already consumed
            if parsed.get("status") == "cooldown":
                parsed["cooldown_stage"] = "verify"

            # ---- Race condition check ----
            # If bot says "failed" but another account already succeeded,
            # check SheerID's actual status to detect the win.
            # IMPORTANT: Only do this if VID was NOT already in 'success' state before we started.
            if not parsed["success"] and parsed["status"] in ("failed", "rejected", "no_credits") and initial_step not in ("success", "error"):
                try:
                    import httpx
                    async with httpx.AsyncClient(timeout=10) as http_client:
                        check_resp = await http_client.get(f"https://services.sheerid.com/rest/v2/verification/{vid}")
                        if check_resp.status_code == 200:
                            actual_step = check_resp.json().get("currentStep", "")
                            if actual_step == "success":
                                logger.info(f"[DualBot] [{account_id}] Race condition detected! Bot said fail but SheerID says SUCCESS for {vid[:8]}")
                                parsed["success"] = True
                                parsed["status"] = "approved"
                                parsed["message"] = "验证通过"
                                parsed["messageKey"] = "msgApproved"
                except Exception as e:
                    logger.warning(f"[DualBot] [{account_id}] Race check failed: {e}")

            # ---- Step 3: Auto bypass on failure (async — fire and forget) ----
            # Skip bypass if bot quota exhausted (nothing to bypass on SheerID side)
            skip_bypass = "程序崩溃" in parsed.get("message", "")
            if not parsed["success"] and auto_bypass and parsed["status"] in ("failed", "rejected") and not skip_bypass:
                # Build message with specific failure reason
                reason_key = parsed.get("failureReasonKey", "reasonFailed")
                reason_zh = {"reasonFraud": "检测到欺诈", "reasonDocRejected": "文档被拒绝", "reasonFailed": "验证失败"}
                reason = reason_zh.get(reason_key, "验证失败")
                
                parsed["message"] = f"{reason}，链接正在刷新中..."
                parsed["messageKey"] = "msgBypassStarted"
                parsed["bypassed"] = "started"
                parsed["failureReasonKey"] = reason_key
                
                # Fire-and-forget bypass (runs in background, doesn't block account)
                async def _bg_bypass(_vid, _acc_id, _emit):
                    try:
                        await _emit("bypass", "Refreshing link...")
                        logger.info(f"[DualBot] [{_acc_id}] Async bypass started for {_vid[:8]}...")
                        ok = await self._run_bypass(_vid, _acc_id)
                        if ok:
                            logger.info(f"[DualBot] [{_acc_id}] Async bypass DONE for {_vid[:8]}")
                        else:
                            logger.warning(f"[DualBot] [{_acc_id}] Async bypass FAILED for {_vid[:8]}")
                    except Exception as e:
                        logger.error(f"[DualBot] [{_acc_id}] Async bypass error: {e}")
                
                asyncio.create_task(_bg_bypass(vid, account_id, emit))

            return parsed

    async def _run_bypass(self, vid: str, account_id: str) -> bool:
        """Run the full bypass sequence asynchronously. Returns True if at least 1 upload succeeded."""
        import httpx
        base_url = "https://services.sheerid.com/rest/v2"

        try:
            async with httpx.AsyncClient(timeout=30) as http_client:
                # MUST wait for pending to clear before uploading
                # Uploading during pending wastes the 10-upload limit
                pending_cleared = False
                for poll in range(100):  # 100 × 3s = 300s max
                    check_resp = await http_client.get(f"{base_url}/verification/{vid}")
                    if check_resp.status_code == 200:
                        step = check_resp.json().get("currentStep", "")
                    else:
                        step = f"error_{check_resp.status_code}"

                    if step != "pending":
                        logger.info(f"[DualBot] [{account_id}] Bypass: Pending cleared -> {step}")
                        pending_cleared = True
                        break

                    if poll % 5 == 0:
                        logger.info(f"[DualBot] [{account_id}] Bypass: Waiting for pending... ({(poll+1)*3}s)")
                    await asyncio.sleep(3)

                if not pending_cleared:
                    logger.warning(f"[DualBot] [{account_id}] Bypass: Pending timeout 300s, aborting to avoid wasting uploads")
                    return False

            # Run bypass uploads (only after pending has cleared)
            # Retry loop: if uploads stop for non-429 reasons, wait and retry
            bypass_count = 0
            got_rate_limited = False
            max_rounds = 3  # Up to 3 rounds of retries

            for round_num in range(max_rounds):
                if got_rate_limited:
                    break

                for i in range(10):
                    ok, status_code = await self._bypass_link_with_status(vid)
                    if ok:
                        bypass_count += 1
                        await asyncio.sleep(1.5)
                    else:
                        if status_code == 429:
                            logger.info(f"[DualBot] [{account_id}] Bypass: Got 429 rate limit, stopping")
                            got_rate_limited = True
                        else:
                            logger.info(f"[DualBot] [{account_id}] Bypass: Upload failed (HTTP {status_code}), will retry after delay")
                        break

                if not got_rate_limited and round_num < max_rounds - 1:
                    # Wait before retrying (the link might need time to transition)
                    logger.info(f"[DualBot] [{account_id}] Bypass: Round {round_num+1} done ({bypass_count} uploads), retrying in 5s...")
                    await asyncio.sleep(5)

            logger.info(f"[DualBot] [{account_id}] Bypass: Done. {bypass_count} total uploads for {vid[:8]}")
            return bypass_count > 0

        except Exception as e:
            logger.error(f"[DualBot] [{account_id}] Bypass error: {e}")
            return False

    # ---- Send message and wait for reply ----

    async def _send_and_wait(self, client: TelegramClient, bot_username: str, message: str, wait_for_final: bool = False, timeout: int = 60) -> Optional[str]:
        """
        Send a message to a bot and wait for the reply.
        If wait_for_final is True, skips 'Processing' messages and waits for a definitive response.
        Supports both NewMessage and MessageEdited events.
        """
        loop = asyncio.get_event_loop()
        future = loop.create_future()

        async def handler(event):
            if future.done():
                return
            
            # Capture either text or photo caption
            reply_text = event.message.text or event.message.message or ""
            # Also check photo caption specifically if text/message is empty
            if not reply_text and hasattr(event.message, 'photo') and event.message.photo:
                reply_text = event.message.caption or ""
                
            if not reply_text:
                return

            event_type = "New" if isinstance(event, events.NewMessage.Event) else "Edit"
            logger.info(f"[DualBot] {event_type} message from @{bot_username}: {reply_text[:100]}...")

            if wait_for_final:
                # Check if this IS a final result or just a "Processing" status
                parsed = self._parse_response(reply_text, "temp", is_warmup=True)
                logger.info(f"[DualBot] Parsed status for @{bot_username}: {parsed['status']}")
                if parsed["status"] == "processing":
                    logger.info(f"[DualBot] Skipping intermediate status from @{bot_username}, continuing to wait...")
                    return
            
            future.set_result(reply_text)

        # Register temporary handlers for both new messages and edits
        client.add_event_handler(handler, events.NewMessage(from_users=bot_username))
        client.add_event_handler(handler, events.MessageEdited(from_users=bot_username))

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
            client.remove_event_handler(handler, events.NewMessage)
            client.remove_event_handler(handler, events.MessageEdited)

    # ---- Parse bot response (config-driven) ----

    def _parse_response(self, text: str, vid: str, is_warmup: bool = False) -> dict:
        """Parse bot response using configurable rules with fallback to defaults."""
        if not text:
            return {
                "success": False,
                "status": "failed",
                "verificationId": vid,
                "message": "Bot returned empty content",
                "raw_response": ""
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
        logger.info(f"[DualBot] Parsing @{vid[:8]} (warmup={is_warmup}) - Cleaned: {text_clean[:80]}...")

        # Extract claim link
        link_match = re.search(r'(https://one\.google\.com/[^\s\n]+)', text)
        if link_match:
            result["claimLink"] = link_match.group(1)

        # 1. Config: Processing Keywords
        proc_keywords = self.config.get("processingKeywords", [
            "SEDANG MEMPROSES", "SEDANG DI PROSES", "PROCESSING YOUR", "PROCESSING...",
            "WAIT...", "⏳", "LOADING", "MOHON TUNGGU", "TUNGGU SEBENTAR"
        ])
        for kw in proc_keywords:
            if kw.upper() in text_clean:
                logger.info(f"[DualBot] Matched processing keyword: {kw}")
                result["success"] = None
                result["status"] = "processing"
                result["message"] = "Processing..."
                return result

        # 2. Config: Cooldown
        cooldown_config = self.config.get("cooldown", {"keywords": ["COOLDOWN"], "timePattern": r"(\d+)\s*M"})
        cooldown_keywords = cooldown_config.get("keywords", ["COOLDOWN"])
        if any(k.upper() in text_clean for k in cooldown_keywords):
            logger.info(f"[DualBot] Cooldown detected")
            minutes = 0
            seconds = 0
            time_pattern = cooldown_config.get("timePattern", r"(\d+)\s*M")
            if time_pattern:
                m_match = re.search(time_pattern, text_clean, flags=re.IGNORECASE)
                if m_match:
                    minutes = int(m_match.group(1))
            s_match = re.search(r'(\d+)\s*S\b', text_clean)
            if s_match:
                seconds = int(s_match.group(1))
            total_seconds = minutes * 60 + seconds
            if total_seconds == 0:
                total_seconds = 90

            # Extract remaining quota
            quota_config = self.config.get("quota", {})
            quota_pattern = quota_config.get("remainingPattern", r"REMAINING\s+VERIFICATIONS[:\s]*\*{0,2}(\d+)\*{0,2}")
            if quota_pattern:
                quota_match = re.search(quota_pattern, text_clean, flags=re.IGNORECASE)
                if quota_match:
                    result["remaining_quota"] = int(quota_match.group(1))

            result["success"] = False
            result["status"] = "cooldown"
            result["message"] = "程序崩溃，请重试"
            result["messageKey"] = "msgCrashed"
            result["cooldown_seconds"] = total_seconds
            logger.info(f"[DualBot] Cooldown: {total_seconds}s")
            return result

        # 3. Config: Response Rules (ordered, first match wins)
        rules = self.config.get("responseRules", [])
        if rules:
            for rule in rules:
                keywords = [k.upper() for k in rule.get("keywords", [])]
                if any(k in text_clean for k in keywords):
                    # For general success keywords, skip "UNTIL SUCCESS" false positives
                    if rule.get("success") and ("UNTIL SUCCESS" in text_clean or "UNTIL BERHASIL" in text_clean):
                        continue
                    logger.info(f"[DualBot] Config rule matched: {rule.get('status')} - keywords: {keywords}")
                    result["success"] = rule.get("success", False)
                    result["status"] = rule.get("status", "failed")
                    result["message"] = rule.get("message", "Rule matched")
                    if "messageKey" in rule:
                        result["messageKey"] = rule["messageKey"]
                    if "failureReasonKey" in rule:
                        result["failureReasonKey"] = rule["failureReasonKey"]

                    # Extract quota from result messages
                    quota_config = self.config.get("quota", {})
                    quota_pattern = quota_config.get("remainingPattern")
                    if quota_pattern:
                        quota_match = re.search(quota_pattern, text_clean, flags=re.IGNORECASE)
                        if quota_match:
                            result["remaining_quota"] = int(quota_match.group(1))

                    return result

        # 4. Config: Warmup-specific success keywords
        if is_warmup:
            warmup_kws = self.config.get("warmupSuccessKeywords", ["PROSES SELESAI", "PROCESS FINISHED", "SELESAI!"])
            for kw in warmup_kws:
                if kw.upper() in text_clean:
                    logger.info(f"[DualBot] Warmup success: {kw}")
                    result["success"] = True
                    result["status"] = "approved"
                    result["message"] = "Warmup complete"
                    return result

        # 5. Safe Fallback
        logger.info("[DualBot] No status matched, falling back to failed.")
        result["success"] = False
        result["status"] = "failed"
        result["message"] = f"请求失败: {text[:50]}..."
        result["messageKey"] = "msgRequestFailed"
        result["failureReasonKey"] = "reasonFailed"
        return result

    # ---- Bypass (submit empty doc to invalidate link) ----

    async def _bypass_link(self, vid: str) -> bool:
        """Wrapper for backwards compatibility."""
        ok, _ = await self._bypass_link_with_status(vid)
        return ok

    async def _bypass_link_with_status(self, vid: str) -> tuple:
        """
        Submit an empty/minimal document to SheerID to invalidate the verification link.
        Returns (success: bool, http_status_code: int).
        """
        import httpx

        try:
            base_url = "https://services.sheerid.com/rest/v2"

            async with httpx.AsyncClient(timeout=30) as client:
                # Step A: Check current step
                check_resp = await client.get(f"{base_url}/verification/{vid}")
                if check_resp.status_code != 200:
                    logger.warning(f"[Bypass] Check failed: {check_resp.status_code}")
                    return False, check_resp.status_code

                step = check_resp.json().get("currentStep", "")
                logger.info(f"[Bypass] Current step for {vid[:8]}: {step}")

                # Short grace period if still pending (outer loop should have waited already)
                if step == "pending":
                    logger.info(f"[Bypass] Still pending, short 5s grace wait...")
                    await asyncio.sleep(5)
                    check_resp = await client.get(f"{base_url}/verification/{vid}")
                    step = check_resp.json().get("currentStep", "")
                    if step == "pending":
                        logger.warning(f"[Bypass] Still pending after grace wait.")
                        return False, 0
                
                # If already succeeded, no bypass needed
                if step == "success":
                    logger.info(f"[Bypass] Link is already successful, no bypass needed.")
                    return False, 0

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
                    return False, upload_resp.status_code

                docs = upload_resp.json().get("documents", [])
                if not docs or not docs[0].get("uploadUrl"):
                    logger.warning("[Bypass] No upload URL returned")
                    return False, 0

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
                    return False, s3_resp.status_code

                # Step D: Complete upload
                complete_resp = await client.post(f"{base_url}/verification/{vid}/step/completeDocUpload")
                logger.info(f"[Bypass] Complete response: {complete_resp.status_code}")

                return True, complete_resp.status_code

        except Exception as e:
            logger.error(f"[Bypass] Error: {e}")
            return False, 0

    # ---- Helpers ----

    @staticmethod
    def _extract_vid(link: str) -> Optional[str]:
        match = re.search(r'verificationId=([a-zA-Z0-9-]+)', link)
        return match.group(1) if match else None
