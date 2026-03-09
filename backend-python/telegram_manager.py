"""
Telegram Account Manager
Manages multiple Telegram accounts with interactive login and one-click switching.
All bot verifications share the single active account's TelegramClient.
"""

import asyncio
import uuid
import logging
import os
from typing import Optional, Dict
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError

import config_manager

logger = logging.getLogger(__name__)


class TelegramAccountManager:
    """Manage multiple Telegram accounts, login flow, and active client pool."""

    def __init__(self):
        self._client: Optional[TelegramClient] = None
        self._active_account_id: Optional[str] = None
        
        # New: Pool of active clients {account_id: TelegramClient}
        self._clients: Dict[str, TelegramClient] = {}
        # New: Round-robin index for client rotation
        self._pool_index = 0
        # New: Per-account bot quota tracking {account_id: int or None}
        self._quotas: Dict[str, Optional[int]] = {}
        # New: Per-account cooldown tracking {account_id: expiry_timestamp}
        self._cooldowns: Dict[str, float] = {}
        
        # Track whether notification handler is registered (single listener for public channel)
        self._notif_registered: bool = False
        
        # Pending login sessions: {account_id: TelegramClient}
        self._login_sessions: Dict[str, TelegramClient] = {}
        
        # Load persisted quotas from config
        config = config_manager.get_config()
        for acc in config.get("telegramAccounts", []):
            if acc.get("quota") is not None:
                self._quotas[acc["id"]] = acc["quota"]

    # ------ Properties ------

    @property
    def client(self) -> Optional[TelegramClient]:
        """Returns the primary active client (for legacy support)."""
        return self._client

    @property
    def is_connected(self) -> bool:
        """Returns True if at least one client in the pool is connected."""
        if self._client and self._client.is_connected():
            return True
        return any(c.is_connected() for c in self._clients.values())

    @property
    def active_account_id(self) -> Optional[str]:
        return self._active_account_id

    def get_all_clients(self) -> Dict[str, TelegramClient]:
        """Returns all currently connected clients."""
        return {aid: c for aid, c in self._clients.items() if c.is_connected()}

    def get_next_client(self, bot_type: str = None) -> Optional[tuple[str, TelegramClient]]:
        """
        Returns the next available client from the pool (Round-Robin).
        Skips accounts that are in cooldown.
        If bot_type is provided (e.g. 'dualbot', 'oldbot'), only returns accounts
        whose assignedBots contains that bot_type.
        Returns: (account_id, client) or None
        """
        import time
        now = time.time()
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])
        
        # Filter accounts that are enabled AND (optionally) assigned to this bot_type
        enabled_ids = []
        for acc in accounts:
            if not acc.get("enabled", True):
                continue
            if bot_type:
                assigned = acc.get("assignedBots", ["dualbot"])  # default: dualbot only
                if bot_type not in assigned:
                    continue
            enabled_ids.append(acc["id"])
        
        available_pool = [(aid, self._clients[aid]) for aid in enabled_ids 
                         if aid in self._clients and self._clients[aid].is_connected()
                         and self._cooldowns.get(aid, 0) <= now]
        
        if not available_pool:
            # Fallback to single primary client if pool is empty (only if no bot_type filter)
            if not bot_type and self._client and self._client.is_connected():
                return (self._active_account_id, self._client)
            return None
            
        # Round-robin selection
        self._pool_index = (self._pool_index + 1) % len(available_pool)
        return available_pool[self._pool_index]

    # ------ Account CRUD ------

    def get_accounts(self) -> list:
        """Return all stored accounts (without sessionString for security)."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])
        # Strip sensitive data for frontend display
        safe = []
        for acc in accounts:
            acc_id = acc.get("id")
            safe.append({
                "id": acc_id,
                "label": acc.get("label", ""),
                "phone": self._mask_phone(acc.get("phone", "")),
                "active": acc_id == self._active_account_id,
                "enabled": acc.get("enabled", True),
                "assignedBots": acc.get("assignedBots", ["dualbot"]),
                "hasSession": bool(acc.get("sessionString")),
                "connected": acc_id in self._clients and self._clients[acc_id].is_connected(),
                "quota": self._quotas.get(acc_id),
                "cooldownUntil": self._cooldowns.get(acc_id, 0) if self._cooldowns.get(acc_id, 0) > __import__('time').time() else None
            })
        return safe

    def update_quota(self, account_id: str, quota: int):
        """Update the bot quota for an account (extracted from @AutoGeminiProbot responses)."""
        self._quotas[account_id] = quota
        logger.info(f"[TGManager] Updated quota for {account_id}: {quota}")
        # Persist to config
        try:
            config = config_manager.get_config()
            for acc in config.get("telegramAccounts", []):
                if acc.get("id") == account_id:
                    acc["quota"] = quota
                    break
            config_manager.save_config(config)
        except Exception as e:
            logger.error(f"[TGManager] Failed to persist quota: {e}")

    def set_cooldown(self, account_id: str, seconds: int):
        """Set a cooldown for an account. It will be skipped in get_next_client() until it expires."""
        import time
        self._cooldowns[account_id] = time.time() + seconds
        logger.info(f"[TGManager] Account {account_id} in cooldown for {seconds}s (until +{seconds}s)")

    def get_shortest_cooldown_wait(self) -> float:
        """Return seconds until the soonest cooldown-locked account becomes available. 0 if none in cooldown."""
        import time
        now = time.time()
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])
        enabled_ids = [acc["id"] for acc in accounts if acc.get("enabled", True)]
        
        # Find the soonest expiry among enabled accounts that are actually in cooldown
        soonest = None
        for aid in enabled_ids:
            if aid in self._clients and self._clients[aid].is_connected():
                expiry = self._cooldowns.get(aid, 0)
                if expiry > now:
                    remaining = expiry - now
                    if soonest is None or remaining < soonest:
                        soonest = remaining
        
        return soonest if soonest is not None else 0

    def add_account(self, api_id: str, api_hash: str, label: str = "") -> dict:
        """Add a new account entry (not yet logged in)."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])

        account = {
            "id": f"acc_{uuid.uuid4().hex[:8]}",
            "label": label or f"账号 {len(accounts) + 1}",
            "apiId": str(api_id),
            "apiHash": api_hash,
            "phone": "",
            "sessionString": "",
            "enabled": True,
            "assignedBots": ["dualbot"]  # Default: only new bot
        }
        accounts.append(account)
        config["telegramAccounts"] = accounts
        config_manager.save_config(config)
        logger.info(f"[TGManager] Added account {account['id']}: {account['label']}")
        return {"id": account["id"], "label": account["label"]}

    def remove_account(self, account_id: str) -> bool:
        """Remove an account. Disconnects if active."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])
        config["telegramAccounts"] = [a for a in accounts if a.get("id") != account_id]
        config_manager.save_config(config)

        # Remove from pool
        if account_id in self._clients:
            asyncio.create_task(self._clients[account_id].disconnect())
            del self._clients[account_id]

        if self._active_account_id == account_id:
            self._active_account_id = None
            self._client = None
            
        logger.info(f"[TGManager] Removed account {account_id}")
        return True

    def update_account(self, account_id: str, updates: dict) -> bool:
        """Update label, enabled status, assignedBots or other editable fields."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])
        changed = False
        
        for acc in accounts:
            if acc.get("id") == account_id:
                if "label" in updates:
                    acc["label"] = updates["label"]
                    changed = True
                if "enabled" in updates:
                    acc["enabled"] = bool(updates["enabled"])
                    changed = True
                    logger.info(f"[TGManager] Account {account_id} enabled={acc['enabled']}")
                if "assignedBots" in updates:
                    acc["assignedBots"] = list(updates["assignedBots"])
                    changed = True
                    logger.info(f"[TGManager] Account {account_id} assignedBots={acc['assignedBots']}")
                
                if changed:
                    config["telegramAccounts"] = accounts
                    config_manager.save_config(config)
                    
                    if acc.get("enabled") and acc.get("sessionString") and account_id not in self._clients:
                        asyncio.create_task(self.activate(account_id, set_as_primary=False))
                    
                    return True
        return False

    # ------ Connection Check ------

    async def check_connection(self, account_id: str) -> dict:
        """Actively check if a specific account is still connected to Telegram."""
        acc = self._find_account(account_id)
        if not acc:
            return {"id": account_id, "online": False, "error": "账号不存在"}

        if not acc.get("sessionString"):
            return {"id": account_id, "online": False, "error": "未登录"}

        client = self._clients.get(account_id)

        # If client exists, try get_me() to verify it's truly alive
        if client and client.is_connected():
            try:
                me = await client.get_me()
                username = me.username or me.first_name or "Unknown"
                return {"id": account_id, "online": True, "username": username}
            except Exception as e:
                logger.warning(f"[TGManager] Connection check failed for {account_id}: {e}")
                # Fall through to reconnect attempt

        # Try to reconnect
        logger.info(f"[TGManager] Attempting reconnect for {account_id}...")
        try:
            result = await self.activate(account_id, set_as_primary=False)
            if result.get("success"):
                return {"id": account_id, "online": True, "username": result.get("username", ""), "reconnected": True}
            else:
                return {"id": account_id, "online": False, "error": result.get("error", "重连失败")}
        except Exception as e:
            logger.error(f"[TGManager] Reconnect failed for {account_id}: {e}")
            return {"id": account_id, "online": False, "error": str(e)}

    async def check_all_connections(self) -> list:
        """Check connection status of all enabled accounts."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])
        results = []

        for acc in accounts:
            if not acc.get("sessionString"):
                results.append({"id": acc["id"], "label": acc.get("label", ""), "online": False, "error": "未登录"})
                continue
            result = await self.check_connection(acc["id"])
            result["label"] = acc.get("label", "")
            results.append(result)

        return results

    # ------ Login Flow ------

    async def login_request(self, account_id: str, phone: str) -> dict:
        """Step 1: Send verification code to the phone number."""
        acc = self._find_account(account_id)
        if not acc:
            return {"success": False, "error": "账号不存在"}

        try:
            api_id = int(acc["apiId"])
            api_hash = acc["apiHash"]
        except (ValueError, KeyError):
            return {"success": False, "error": "API ID / Hash 无效"}

        # Create a temporary client using StringSession (in-memory)
        client = TelegramClient(StringSession(), api_id, api_hash)
        await client.connect()

        try:
            result = await client.send_code_request(phone)
            # Store pending session
            self._login_sessions[account_id] = client

            # Save phone to config
            config = config_manager.get_config()
            for a in config.get("telegramAccounts", []):
                if a["id"] == account_id:
                    a["phone"] = phone
            config_manager.save_config(config)

            logger.info(f"[TGManager] Code sent to {self._mask_phone(phone)} for {account_id}")
            return {
                "success": True,
                "phone_code_hash": result.phone_code_hash,
                "message": f"验证码已发送到 {self._mask_phone(phone)}"
            }
        except Exception as e:
            await client.disconnect()
            logger.error(f"[TGManager] Login request failed: {e}")
            return {"success": False, "error": str(e)}

    async def login_verify(self, account_id: str, phone: str, code: str, phone_code_hash: str, password: str = None) -> dict:
        """Step 2: Submit verification code (and optional 2FA password) to complete login."""
        client = self._login_sessions.get(account_id)
        if not client:
            return {"success": False, "error": "登录会话已过期，请重新发送验证码"}

        try:
            try:
                await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
            except SessionPasswordNeededError:
                if not password:
                    return {"success": False, "needs_password": True, "error": "此账号启用了两步验证，请输入密码"}
                await client.sign_in(password=password)

            # Get user info
            me = await client.get_me()
            username = me.username or me.first_name or "Unknown"

            # Save session string to config
            session_string = client.session.save()
            config = config_manager.get_config()
            for a in config.get("telegramAccounts", []):
                if a["id"] == account_id:
                    a["sessionString"] = session_string
                    a["phone"] = phone
            config_manager.save_config(config)

            # Clean up pending session
            del self._login_sessions[account_id]

            # Re-activate in the pool immediately after login
            await client.disconnect()
            await self.activate(account_id, set_as_primary=True)

            logger.info(f"[TGManager] Login successful for {account_id}: @{username}")
            return {
                "success": True,
                "username": username,
                "message": f"登录成功: @{username}"
            }
        except Exception as e:
            logger.error(f"[TGManager] Login verify failed: {e}")
            return {"success": False, "error": str(e)}

    # ------ Activate / Switch ------

    async def activate(self, account_id: str, set_as_primary: bool = True) -> dict:
        """
        Connect/Activate an account. 
        If set_as_primary=True, also sets it as self._client for legacy single-bot support.
        """
        acc = self._find_account(account_id)
        if not acc:
            return {"success": False, "error": "账号不存在"}

        if not acc.get("sessionString"):
            return {"success": False, "error": "该账号尚未登录，请先完成登录"}

        # Connect new client
        try:
            api_id = int(acc["apiId"])
            api_hash = acc["apiHash"]
            session = StringSession(acc["sessionString"])

            # Check if already in pool and connected
            if account_id in self._clients and self._clients[account_id].is_connected():
                client = self._clients[account_id]
            else:
                client = TelegramClient(session, api_id, api_hash)
                await client.connect()

            if not await client.is_user_authorized():
                return {"success": False, "error": "会话已过期，请重新登录"}

            me = await client.get_me()
            username = me.username or me.first_name or "Unknown"

            # Add to pool
            self._clients[account_id] = client
            
            # Register notification listener for DualBot stats
            self._register_notification_handler(client, account_id)
            
            if set_as_primary:
                self._client = client
                self._active_account_id = account_id

            logger.info(f"[TGManager] Pooled account {account_id}: @{username} (Primary={set_as_primary})")
            return {
                "success": True,
                "username": username,
                "message": f"账号已就绪: @{username}"
            }
        except Exception as e:
            logger.error(f"[TGManager] Activate failed for {account_id}: {e}")
            return {"success": False, "error": str(e)}

    async def disconnect(self):
        """Disconnect ALL clients in the pool."""
        for aid, client in self._clients.items():
            try:
                await client.disconnect()
            except:
                pass
        self._clients = {}
        self._client = None
        self._active_account_id = None

    async def auto_connect(self):
        """On startup, try to connect ALL ENABLED accounts in the pool."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])

        connected_count = 0
        for acc in accounts:
            if acc.get("sessionString") and acc.get("enabled", True):
                # Always set the first successful one as primary
                is_first = (connected_count == 0)
                logger.info(f"[TGManager] Startup: connecting account {acc.get('label', acc['id'])}...")
                try:
                    result = await asyncio.wait_for(
                        self.activate(acc["id"], set_as_primary=is_first),
                        timeout=10
                    )
                    if result.get("success"):
                        connected_count += 1
                        logger.info(f"[TGManager] ✅ Connected: {acc.get('label', acc['id'])}")
                    else:
                        logger.warning(f"[TGManager] Startup connect failed for {acc['id']}: {result.get('error')}")
                except asyncio.TimeoutError:
                    logger.warning(f"[TGManager] Startup connect timed out for {acc.get('label', acc['id'])}")
                except Exception as e:
                    logger.warning(f"[TGManager] Startup connect error for {acc.get('label', acc['id'])}: {e}")

        # Fallback: try legacy single-account config (migrate if exists)
        if connected_count == 0:
            tg_config = config.get("verification", {}).get("telegram", {})
            if tg_config.get("enabled") and tg_config.get("apiId") and tg_config.get("apiHash"):
                logger.info("[TGManager] No pooled accounts, migrating legacy config...")
                self.add_account(
                    api_id=tg_config["apiId"],
                    api_hash=tg_config["apiHash"],
                    label="旧配置(已迁移)"
                )
                return {"success": False, "message": "旧配置已迁移，请重新登录"}

        logger.info(f"[TGManager] Auto-connect finished. Pool size: {connected_count}")
        return {"success": connected_count > 0}

    # ------ Notification Listener (DualBot external stats) ------

    def _register_notification_handler(self, client: TelegramClient, account_id: str):
        """Register a persistent listener for @NotifSuccess verification notifications.
        
        Only registers ONCE (on the first connected account) because the notifications
        come from a public channel — multiple listeners would cause duplicate counting.
        """
        if self._notif_registered:
            return  # Already listening on another account
        
        notif_channel = "NotifSuccess"

        async def _on_notification(event):
            """Handle incoming notification messages from the notification channel."""
            try:
                text = event.message.text or event.message.message or ""
                if not text:
                    return
                
                text_upper = text.upper()
                
                # Only process final verification results
                if "VERIFICATION SUCCESSFUL" in text_upper or "SUCCESSFULLY VERIFIED" in text_upper:
                    from bot_stats import bot_stats_tracker
                    bot_stats_tracker.record("dualbot", True)
                    logger.info(f"[TGNotif] DualBot SUCCESS detected from @{notif_channel}")
                elif "VERIFICATION FAILED" in text_upper or "VERIFICATION REJECTED" in text_upper or "TASK FAILED" in text_upper:
                    from bot_stats import bot_stats_tracker
                    bot_stats_tracker.record("dualbot", False)
                    logger.info(f"[TGNotif] DualBot FAIL detected from @{notif_channel}")
            except Exception as e:
                logger.warning(f"[TGNotif] Handler error: {e}")

        client.add_event_handler(_on_notification, events.NewMessage(from_users=notif_channel))
        self._notif_registered = True
        logger.info(f"[TGManager] Registered notification listener for @{notif_channel} on account {account_id} (single listener)")

    # ------ Helpers ------

    def _find_account(self, account_id: str) -> Optional[dict]:
        config = config_manager.get_config()
        for acc in config.get("telegramAccounts", []):
            if acc.get("id") == account_id:
                return acc
        return None

    @staticmethod
    def _mask_phone(phone: str) -> str:
        if not phone or len(phone) < 5:
            return phone or ""
        return phone[:3] + "****" + phone[-2:]

    # ------ Helpers ------

    def _find_account(self, account_id: str) -> Optional[dict]:
        config = config_manager.get_config()
        for acc in config.get("telegramAccounts", []):
            if acc.get("id") == account_id:
                return acc
        return None

    @staticmethod
    def _mask_phone(phone: str) -> str:
        if not phone or len(phone) < 5:
            return phone or ""
        return phone[:3] + "****" + phone[-2:]
