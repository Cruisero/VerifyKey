"""
Bot Verification Log - tracks bot verification attempts with link, username, time, status.
"""
import json
import os
import threading
from datetime import datetime, timezone
from typing import Dict, List

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
LOG_FILE = os.path.join(DATA_DIR, "bot_verify_log.json")
MAX_RECORDS = 200
_lock = threading.Lock()


def _load_log() -> List[Dict]:
    try:
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return []


def _save_log(data: List[Dict]):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def log_bot_verify(link: str, username: str, user_id: int, status: str, message: str = "") -> Dict:
    """
    Log a bot verification attempt.
    
    Args:
        link: The verification link submitted
        username: Telegram username
        user_id: Telegram user ID
        status: 'success', 'failed', 'error', 'refunded'
        message: Optional status message
    """
    record = {
        "link": link,
        "username": username or str(user_id),
        "user_id": user_id,
        "status": status,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    with _lock:
        log = _load_log()
        log.append(record)
        if len(log) > MAX_RECORDS:
            log = log[-MAX_RECORDS:]
        _save_log(log)

    return record


def get_recent(limit: int = 50) -> List[Dict]:
    """Get the most recent bot verification log entries."""
    with _lock:
        log = _load_log()
    return log[-limit:][::-1]  # newest first
