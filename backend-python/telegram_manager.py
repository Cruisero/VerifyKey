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
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError

import config_manager

logger = logging.getLogger(__name__)


class TelegramAccountManager:
    """Manage multiple Telegram accounts, login flow, and active client."""

    def __init__(self):
        self._client: Optional[TelegramClient] = None
        self._active_account_id: Optional[str] = None
        # Pending login sessions: {account_id: TelegramClient}
        self._login_sessions: Dict[str, TelegramClient] = {}

    # ------ Properties ------

    @property
    def client(self) -> Optional[TelegramClient]:
        return self._client

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.is_connected

    @property
    def active_account_id(self) -> Optional[str]:
        return self._active_account_id

    # ------ Account CRUD ------

    def get_accounts(self) -> list:
        """Return all stored accounts (without sessionString for security)."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])
        # Strip sensitive data for frontend display
        safe = []
        for acc in accounts:
            safe.append({
                "id": acc.get("id"),
                "label": acc.get("label", ""),
                "phone": self._mask_phone(acc.get("phone", "")),
                "active": acc.get("id") == self._active_account_id,
                "hasSession": bool(acc.get("sessionString")),
            })
        return safe

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

        if self._active_account_id == account_id:
            self._active_account_id = None
            # Client will be disconnected by caller
        logger.info(f"[TGManager] Removed account {account_id}")
        return True

    def update_account(self, account_id: str, updates: dict) -> bool:
        """Update label or other editable fields."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])
        for acc in accounts:
            if acc.get("id") == account_id:
                if "label" in updates:
                    acc["label"] = updates["label"]
                config["telegramAccounts"] = accounts
                config_manager.save_config(config)
                return True
        return False

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

            # Disconnect temporary client (will reconnect when activated)
            await client.disconnect()

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

    async def activate(self, account_id: str) -> dict:
        """Switch the active Telegram account. Disconnects old, connects new."""
        acc = self._find_account(account_id)
        if not acc:
            return {"success": False, "error": "账号不存在"}

        if not acc.get("sessionString"):
            return {"success": False, "error": "该账号尚未登录，请先完成登录"}

        # Disconnect current client
        if self._client:
            try:
                await self._client.disconnect()
            except:
                pass
            self._client = None

        # Connect new client
        try:
            api_id = int(acc["apiId"])
            api_hash = acc["apiHash"]
            session = StringSession(acc["sessionString"])

            client = TelegramClient(session, api_id, api_hash)
            await client.connect()

            if not await client.is_user_authorized():
                return {"success": False, "error": "会话已过期，请重新登录"}

            me = await client.get_me()
            username = me.username or me.first_name or "Unknown"

            self._client = client
            self._active_account_id = account_id

            logger.info(f"[TGManager] Activated account {account_id}: @{username}")
            return {
                "success": True,
                "username": username,
                "message": f"已切换到: @{username}"
            }
        except Exception as e:
            logger.error(f"[TGManager] Activate failed: {e}")
            return {"success": False, "error": str(e)}

    async def disconnect(self):
        """Disconnect the current client."""
        if self._client:
            try:
                await self._client.disconnect()
            except:
                pass
            self._client = None
            self._active_account_id = None

    async def auto_connect(self):
        """On startup, try to connect the first account that has a session."""
        config = config_manager.get_config()
        accounts = config.get("telegramAccounts", [])

        for acc in accounts:
            if acc.get("sessionString"):
                logger.info(f"[TGManager] Auto-connecting account: {acc.get('label', acc['id'])}")
                result = await self.activate(acc["id"])
                if result.get("success"):
                    return result
                else:
                    logger.warning(f"[TGManager] Auto-connect failed for {acc['id']}: {result.get('error')}")

        # Fallback: try legacy single-account config
        tg_config = config.get("verification", {}).get("telegram", {})
        if tg_config.get("enabled") and tg_config.get("apiId") and tg_config.get("apiHash"):
            logger.info("[TGManager] No multi-accounts found, trying legacy config...")
            # Migrate legacy config → accounts array
            legacy_id = self.add_account(
                api_id=tg_config["apiId"],
                api_hash=tg_config["apiHash"],
                label="旧配置(已迁移)"
            )
            return {"success": False, "message": "旧配置已迁移到账号列表，请在后台重新登录"}

        logger.info("[TGManager] No accounts to auto-connect")
        return {"success": False, "message": "No accounts configured"}

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
