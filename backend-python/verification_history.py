"""
Verification History Logger for VerifyKey
Records each verification result for the real-time status grid.
Storage: SQLite database at /app/data/onepass.db
"""

import uuid
from datetime import datetime
from typing import Dict, List

import database

# Display reset point — records before this timestamp won't be shown
_display_reset_at: str = ""


def log_verification(status: str, verification_id: str = "", message: str = "", cdk: str = "", via: str = "") -> Dict:
    """
    Log a verification result.
    
    Args:
        status: One of 'pass', 'failed', 'processing', 'cancel'
        verification_id: Optional verification ID
        message: Optional status message (rejection reason, success URL, etc.)
        cdk: Optional CDK code used for this verification
        via: Optional route source tag (e.g. 'getgem', 'dualbot', 'singlebot_1')
    
    Returns:
        The logged record (or existing record if duplicate)
    """
    conn = database.get_connection()

    # Deduplication: if same VID already has a final result (pass/failed), skip
    if verification_id and status in ("pass", "failed"):
        cursor = conn.execute(
            "SELECT id, status FROM verification_history WHERE verification_id = ? AND status IN ('pass', 'failed') LIMIT 1",
            (verification_id,)
        )
        existing = cursor.fetchone()
        if existing:
            return {
                "id": existing["id"],
                "status": existing["status"],
                "verificationId": verification_id,
                "message": "duplicate",
                "cdk": cdk,
                "via": via,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "deduplicated": True
            }

    record = {
        "id": str(uuid.uuid4())[:8],
        "status": status,
        "verificationId": verification_id,
        "message": message,
        "cdk": cdk,
        "via": via,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }

    conn.execute(
        "INSERT INTO verification_history (id, status, verification_id, message, cdk, timestamp, via) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (record["id"], record["status"], record["verificationId"], record["message"], record["cdk"], record["timestamp"], record["via"])
    )
    conn.commit()

    return record


def update_verification(record_id: str, status: str) -> bool:
    """
    Update the status of an existing verification record.
    Useful for updating 'processing' → 'pass'/'failed'/'cancel'.
    
    Args:
        record_id: The record ID to update
        status: New status
    
    Returns:
        True if updated successfully
    """
    conn = database.get_connection()
    cursor = conn.execute(
        "UPDATE verification_history SET status = ?, timestamp = ? WHERE id = ?",
        (status, datetime.now().isoformat(), record_id)
    )
    conn.commit()
    return cursor.rowcount > 0


def get_recent_history(limit: int = 200) -> List[Dict]:
    """
    Get recent verification history.
    Only returns records after _display_reset_at if set.
    
    Args:
        limit: Max number of records to return
    
    Returns:
        List of verification records, newest last
    """
    global _display_reset_at
    conn = database.get_connection()
    if _display_reset_at:
        cursor = conn.execute(
            "SELECT id, status, verification_id, message, cdk, timestamp, via FROM verification_history WHERE timestamp > ? ORDER BY rowid DESC LIMIT ?",
            (_display_reset_at, limit)
        )
    else:
        cursor = conn.execute(
            "SELECT id, status, verification_id, message, cdk, timestamp, via FROM verification_history ORDER BY rowid DESC LIMIT ?",
            (limit,)
        )
    rows = cursor.fetchall()
    # Return newest last (reverse the DESC order)
    return [
        {
            "id": r["id"],
            "status": r["status"],
            "verificationId": r["verification_id"],
            "message": r["message"],
            "cdk": r["cdk"],
            "via": r["via"] if "via" in r.keys() else "",
            "timestamp": r["timestamp"]
        }
        for r in reversed(rows)
    ]


def reset_display() -> str:
    """Set the display reset point to now. Records before this won't be shown."""
    global _display_reset_at
    _display_reset_at = datetime.utcnow().isoformat() + "Z"
    return _display_reset_at


def get_history_stats() -> Dict:
    """Get statistics from verification history"""
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT status, COUNT(*) as cnt FROM verification_history GROUP BY status"
    )
    counts = {row["status"]: row["cnt"] for row in cursor.fetchall()}

    total = sum(counts.values())
    return {
        "total": total,
        "pass": counts.get("pass", 0),
        "failed": counts.get("failed", 0),
        "processing": counts.get("processing", 0),
        "cancel": counts.get("cancel", 0),
    }


def delete_verification(record_id: str) -> bool:
    """Delete a verification record by ID."""
    conn = database.get_connection()
    cursor = conn.execute("DELETE FROM verification_history WHERE id = ?", (record_id,))
    conn.commit()
    return cursor.rowcount > 0


def clear_history() -> int:
    """Clear all verification history. Returns count of deleted records."""
    conn = database.get_connection()
    cursor = conn.execute("SELECT COUNT(*) FROM verification_history")
    count = cursor.fetchone()[0]
    conn.execute("DELETE FROM verification_history")
    conn.commit()
    return count


def get_history_by_cdk(cdk_code: str) -> List[Dict]:
    """Get verification history for a specific CDK code."""
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT id, status, verification_id, message, cdk, timestamp, via FROM verification_history WHERE cdk = ? ORDER BY rowid DESC",
        (cdk_code,)
    )
    return [
        {
            "id": r["id"],
            "status": r["status"],
            "verificationId": r["verification_id"],
            "message": r["message"],
            "cdk": r["cdk"],
            "via": r["via"] if "via" in r.keys() else "",
            "timestamp": r["timestamp"]
        }
        for r in cursor.fetchall()
    ]
