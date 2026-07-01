"""
Bot Verification Log - tracks bot verification attempts with link, username, time, status.
Storage: SQLite database at /app/data/onepass.db

Supports real-time process tracking with statuses:
  - submitted: user submitted the link, verification starting
  - processing: verification in progress (document generation, upload, etc.)
  - success: verification passed
  - failed: verification failed
  - error: unexpected error
  - refunded: credits refunded
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional

import database


def log_bot_verify(link: str, username: str, user_id: int, status: str, message: str = "", vid: str = "") -> Dict:
    """
    Log a bot verification attempt.
    
    Args:
        link: The verification link submitted
        username: Telegram username
        user_id: Telegram user ID
        status: 'submitted', 'processing', 'success', 'failed', 'error', 'refunded'
        message: Optional status message
        vid: Optional verification ID extracted from the link
    """
    record = {
        "link": link,
        "username": username or str(user_id),
        "user_id": user_id,
        "status": status,
        "message": message,
        "vid": vid,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    conn = database.get_connection()
    cursor = conn.execute(
        "INSERT INTO bot_verify_log (link, username, user_id, status, message, vid, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (record["link"], record["username"], record["user_id"], record["status"], record["message"], record["vid"], record["timestamp"])
    )
    record["id"] = cursor.lastrowid
    conn.commit()

    return record


def update_status(log_id: int, status: str, message: str = "") -> bool:
    """
    Update the status and message of an existing log entry.
    Used to transition from 'submitted' -> 'processing' -> 'success'/'failed'.
    
    Args:
        log_id: The ID of the log entry to update
        status: New status
        message: Optional new message
    """
    conn = database.get_connection()
    if message:
        conn.execute(
            "UPDATE bot_verify_log SET status = ?, message = ? WHERE id = ?",
            (status, message, log_id)
        )
    else:
        conn.execute(
            "UPDATE bot_verify_log SET status = ? WHERE id = ?",
            (status, log_id)
        )
    conn.commit()
    return True


def get_recent(limit: int = 300) -> List[Dict]:
    """Get the most recent bot verification log entries."""
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT id, link, username, user_id, status, message, vid, timestamp FROM bot_verify_log ORDER BY id DESC LIMIT ?",
        (limit,)
    )
    return [
        {
            "id": r["id"],
            "link": r["link"],
            "username": r["username"],
            "user_id": r["user_id"],
            "status": r["status"],
            "message": r["message"],
            "vid": r["vid"] if "vid" in r.keys() else "",
            "timestamp": r["timestamp"]
        }
        for r in cursor.fetchall()
    ]


def get_total_count() -> int:
    """Get total number of bot verification log entries."""
    conn = database.get_connection()
    cursor = conn.execute("SELECT COUNT(*) as cnt FROM bot_verify_log")
    row = cursor.fetchone()
    return row["cnt"] if row else 0


def get_paginated(page: int = 1, page_size: int = 100) -> Dict:
    """Get paginated bot verification log entries.

    Args:
        page: Page number (1-indexed)
        page_size: Number of entries per page

    Returns:
        Dict with 'log', 'total', 'page', 'pageSize', 'totalPages'
    """
    total = get_total_count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, total_pages))
    offset = (page - 1) * page_size

    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT id, link, username, user_id, status, message, vid, timestamp FROM bot_verify_log ORDER BY id DESC LIMIT ? OFFSET ?",
        (page_size, offset)
    )
    log = [
        {
            "id": r["id"],
            "link": r["link"],
            "username": r["username"],
            "user_id": r["user_id"],
            "status": r["status"],
            "message": r["message"],
            "vid": r["vid"] if "vid" in r.keys() else "",
            "timestamp": r["timestamp"]
        }
        for r in cursor.fetchall()
    ]

    return {
        "log": log,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": total_pages,
    }
