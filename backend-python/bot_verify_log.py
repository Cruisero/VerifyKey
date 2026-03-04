"""
Bot Verification Log - tracks bot verification attempts with link, username, time, status.
Storage: SQLite database at /app/data/onepass.db
"""

from datetime import datetime, timezone
from typing import Dict, List

import database


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

    conn = database.get_connection()
    conn.execute(
        "INSERT INTO bot_verify_log (link, username, user_id, status, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        (record["link"], record["username"], record["user_id"], record["status"], record["message"], record["timestamp"])
    )
    conn.commit()

    return record


def get_recent(limit: int = 50) -> List[Dict]:
    """Get the most recent bot verification log entries."""
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT link, username, user_id, status, message, timestamp FROM bot_verify_log ORDER BY id DESC LIMIT ?",
        (limit,)
    )
    return [
        {
            "link": r["link"],
            "username": r["username"],
            "user_id": r["user_id"],
            "status": r["status"],
            "message": r["message"],
            "timestamp": r["timestamp"]
        }
        for r in cursor.fetchall()
    ]
