import logging
from typing import Optional, Dict

logger = logging.getLogger(__name__)

class TelegramAccountManager:
    """Mock implementation of TelegramAccountManager to decouple Telethon dependency."""

    def __init__(self):
        self._client = None
        self._active_account_id = None
        self._clients: Dict[str, any] = {}
        self._pool_index = 0
        self._quotas: Dict[str, Optional[int]] = {}
        self._cooldowns: Dict[str, float] = {}
        self._notif_registered: bool = False
        self._login_sessions: Dict[str, any] = {}

    @property
    def client(self) -> Optional[any]:
        return self._client

    @property
    def is_connected(self) -> bool:
        return False

    @property
    def active_account_id(self) -> Optional[str]:
        return self._active_account_id

    def get_all_clients(self) -> Dict[str, any]:
        return {}

    def get_next_client(self, bot_type: str = None) -> Optional[tuple[str, any]]:
        return None

    def get_accounts(self) -> list:
        return []

    def update_quota(self, account_id: str, quota: int):
        pass

    def set_cooldown(self, account_id: str, seconds: int):
        pass

    def get_shortest_cooldown_wait(self) -> float:
        return 0.0

    def add_account(self, api_id: str, api_hash: str, label: str = "") -> dict:
        return {"success": False, "message": "Telegram module is disabled"}

    def remove_account(self, account_id: str) -> bool:
        return False

    def update_account(self, account_id: str, updates: dict) -> bool:
        return False

    def _find_account(self, account_id: str) -> Optional[dict]:
        return None

    def _mask_phone(self, phone: str) -> str:
        return phone or ""

    async def check_connection(self, account_id: str) -> dict:
        return {"success": False, "message": "Telegram module is disabled"}

    async def check_all_connections(self) -> list:
        return []

    async def login_request(self, account_id: str, phone: str) -> dict:
        return {"success": False, "message": "Telegram module is disabled"}

    async def login_verify(self, account_id: str, phone: str, code: str, phone_code_hash: str, password: str = None) -> dict:
        return {"success": False, "message": "Telegram module is disabled"}

    async def activate(self, account_id: str, set_as_primary: bool = True) -> dict:
        return {"success": False, "message": "Telegram module is disabled"}

    async def disconnect(self):
        pass

    async def auto_connect(self):
        return {"success": False, "message": "Telegram module is disabled"}
