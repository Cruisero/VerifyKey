"""
Verification History Logger for VerifyKey
Records each verification result for the real-time status grid.
Storage: SQLite database at /app/data/onepass.db
"""

import uuid
from datetime import datetime
from typing import Dict, List

import database

# Keywords for user errors that shouldn't pollute the system failure stats
USER_ERROR_FILTER = " AND IFNULL(message, '') NOT LIKE '%WRONG_PASSWORD%' AND IFNULL(message, '') NOT LIKE '%2fa错误%' AND IFNULL(message, '') NOT LIKE '%账号错误%' AND IFNULL(message, '') NOT LIKE '%密码错误%' AND IFNULL(message, '') NOT LIKE '%incorrect 2fa%' "

# Display reset point — records before this timestamp won't be shown
_display_reset_at: str = ""
_reset_loaded: bool = False


def _load_reset_timestamp():
    """Load the display reset timestamp from DB on first access."""
    global _display_reset_at, _reset_loaded
    if _reset_loaded:
        return
    _reset_loaded = True
    try:
        conn = database.get_connection()
        cursor = conn.execute("SELECT value FROM kv_store WHERE key = 'display_reset_at'")
        row = cursor.fetchone()
        if row:
            _display_reset_at = row["value"]
    except Exception:
        pass


def log_verification(status: str, verification_id: str = "", message: str = "", cdk: str = "", via: str = "", email: str = "", cost: float = 0) -> Dict:
    """
    Log a verification result.
    
    Args:
        status: One of 'pass', 'failed', 'processing', 'cancel'
        verification_id: Optional verification ID
        message: Optional status message (rejection reason, success URL, etc.)
        cdk: Optional CDK code used for this verification
        via: Optional route source tag (e.g. 'getgem', 'dualbot', 'singlebot_1')
        email: Optional email submitted by the user
        cost: The exact credit cost locked at submission time (default 0)
    
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
                "email": email,
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
        "email": email,
        "cost": cost,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }

    conn.execute(
        "INSERT INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email, cost, is_refunded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (record["id"], record["status"], record["verificationId"], record["message"], record["cdk"], record["timestamp"], record["via"], record["email"], cost, 0)
    )
    conn.commit()

    return record


def update_verification(record_id: str, status: str, message: str = None) -> bool:
    """
    Update the status of an existing verification record.
    Useful for updating 'processing' → 'pass'/'failed'/'cancel'.
    
    Args:
        record_id: The record ID to update
        status: New status
        message: Optional new message to update
    
    Returns:
        True if updated successfully
    """
    conn = database.get_connection()
    if message is not None:
        cursor = conn.execute(
            "UPDATE verification_history SET status = ?, message = ?, timestamp = ? WHERE id = ?",
            (status, message, datetime.now().isoformat(), record_id)
        )
    else:
        cursor = conn.execute(
            "UPDATE verification_history SET status = ?, timestamp = ? WHERE id = ?",
            (status, datetime.now().isoformat(), record_id)
        )
    conn.commit()
    return cursor.rowcount > 0


def get_recent_history(limit: int = 200, ignore_reset: bool = False) -> List[Dict]:
    """
    Get recent verification history.
    Only returns records after _display_reset_at if set (unless ignore_reset=True).
    
    Args:
        limit: Max number of records to return
        ignore_reset: If True, ignore the display reset point (for admin views)
    
    Returns:
        List of verification records, newest last
    """
    _load_reset_timestamp()
    global _display_reset_at
    conn = database.get_connection()
    if _display_reset_at and not ignore_reset:
        cursor = conn.execute(
            f"SELECT id, status, verification_id, message, cdk, timestamp, via, email FROM verification_history WHERE timestamp > ? {USER_ERROR_FILTER} ORDER BY rowid DESC LIMIT ?",
            (_display_reset_at, limit)
        )
    else:
        cursor = conn.execute(
            f"SELECT id, status, verification_id, message, cdk, timestamp, via, email FROM verification_history WHERE 1=1 {USER_ERROR_FILTER} ORDER BY rowid DESC LIMIT ?",
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
            "submitEmail": r["email"] if "email" in r.keys() else "",
            "timestamp": r["timestamp"]
        }
        for r in reversed(rows)
    ]


def get_paginated_history(page: int = 1, page_size: int = 100, ignore_reset: bool = True, search: str = "") -> Dict:
    """Get paginated verification history for admin dashboard.

    Args:
        page: Page number (1-indexed)
        page_size: Number of entries per page
        ignore_reset: If True, ignore the display reset point
        search: Optional search keyword (searches vid, message, cdk, via, email)

    Returns:
        Dict with 'history', 'total', 'page', 'pageSize', 'totalPages'
    """
    _load_reset_timestamp()
    global _display_reset_at
    conn = database.get_connection()

    # Build WHERE clause
    if _display_reset_at and not ignore_reset:
        where = f"WHERE timestamp > ? {USER_ERROR_FILTER}"
        params_base = [_display_reset_at]
    else:
        where = f"WHERE 1=1 {USER_ERROR_FILTER}"
        params_base = []

    # Add search filter
    if search and search.strip():
        keyword = f"%{search.strip()}%"
        where += " AND (verification_id LIKE ? OR message LIKE ? OR cdk LIKE ? OR via LIKE ? OR email LIKE ? OR status LIKE ?)"
        params_base.extend([keyword, keyword, keyword, keyword, keyword, keyword])

    # Total count
    count_cursor = conn.execute(
        f"SELECT COUNT(*) as cnt FROM verification_history {where}",
        params_base
    )
    total = count_cursor.fetchone()["cnt"]
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, total_pages))
    offset = (page - 1) * page_size

    # Paginated query (newest first)
    cursor = conn.execute(
        f"SELECT id, status, verification_id, message, cdk, timestamp, via, email FROM verification_history {where} ORDER BY rowid DESC LIMIT ? OFFSET ?",
        params_base + [page_size, offset]
    )

    history = [
        {
            "id": r["id"],
            "status": r["status"],
            "verificationId": r["verification_id"],
            "message": r["message"],
            "cdk": r["cdk"],
            "via": r["via"] if "via" in r.keys() else "",
            "submitEmail": r["email"] if "email" in r.keys() else "",
            "timestamp": r["timestamp"]
        }
        for r in cursor.fetchall()
    ]

    return {
        "history": history,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": total_pages,
    }


def reset_display() -> str:
    """Set the display reset point to now. Records before this won't be shown."""
    global _display_reset_at
    _display_reset_at = datetime.utcnow().isoformat() + "Z"
    # Persist to DB
    try:
        conn = database.get_connection()
        conn.execute(
            "INSERT OR REPLACE INTO kv_store (key, value) VALUES ('display_reset_at', ?)",
            (_display_reset_at,)
        )
        conn.commit()
    except Exception:
        pass
    return _display_reset_at


def get_history_stats(respect_reset: bool = True) -> Dict:
    """Get statistics from verification history.
    
    Args:
        respect_reset: If True, only count records after the display reset point.
    """
    _load_reset_timestamp()
    conn = database.get_connection()
    if respect_reset and _display_reset_at:
        cursor = conn.execute(
            f"SELECT status, COUNT(*) as cnt FROM verification_history WHERE timestamp > ? {USER_ERROR_FILTER} GROUP BY status",
            (_display_reset_at,)
        )
    else:
        cursor = conn.execute(
            f"SELECT status, COUNT(*) as cnt FROM verification_history WHERE 1=1 {USER_ERROR_FILTER} GROUP BY status"
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
        "SELECT id, status, verification_id, message, cdk, timestamp, via, email FROM verification_history WHERE cdk = ? ORDER BY rowid DESC",
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
            "submitEmail": r["email"] if "email" in r.keys() else "",
            "timestamp": r["timestamp"]
        }
        for r in cursor.fetchall()
    ]


def get_history_by_user(user_id: int, limit: int = 50) -> List[Dict]:
    """Get verification history for a specific user (via cdk='user:{id}' field).
    
    Args:
        user_id: The user's numeric ID
        limit: Max number of records to return (default 50)
    
    Returns:
        List of verification records, newest first
    """
    conn = database.get_connection()
    cdk_tag = f"user:{user_id}"
    cursor = conn.execute(
        "SELECT id, status, verification_id, message, cdk, timestamp, via, email "
        "FROM verification_history WHERE cdk = ? ORDER BY rowid DESC LIMIT ?",
        (cdk_tag, limit)
    )
    return [
        {
            "id": r["id"],
            "status": r["status"],
            "verificationId": r["verification_id"],
            "message": r["message"],
            "cdk": r["cdk"],
            "via": r["via"] if "via" in r.keys() else "",
            "submitEmail": r["email"] if "email" in r.keys() else "",
            "timestamp": r["timestamp"]
        }
        for r in cursor.fetchall()
    ]


def get_successful_history_by_email(email: str, user_id: int) -> Dict:
    """Check if the user has already successfully verified this email."""
    if not email or not user_id:
        return {}
    conn = database.get_connection()
    cdk_tag = f"user:{user_id}"
    cursor = conn.execute(
        "SELECT id, status, verification_id, message, cdk, timestamp, via, email "
        "FROM verification_history WHERE email = ? AND cdk = ? AND status = 'pass' ORDER BY rowid DESC LIMIT 1",
        (email, cdk_tag)
    )
    row = cursor.fetchone()
    if row:
        return {
            "id": row["id"],
            "status": row["status"],
            "verificationId": row["verification_id"],
            "message": row["message"],
            "cdk": row["cdk"],
            "via": row["via"] if "via" in row.keys() else "",
            "submitEmail": row["email"] if "email" in row.keys() else "",
            "timestamp": row["timestamp"]
        }
    return {}


# ========== Atomic State Machine ==========

def _extract_user_id(cdk: str) -> int:
    """Extract user ID from cdk tag like 'user:123'."""
    if cdk and cdk.startswith("user:"):
        try:
            return int(cdk.replace("user:", ""))
        except ValueError:
            pass
    return 0


def transition_task_status(
    verification_id: str,
    new_status: str,
    message: str = "",
    user_id: int = 0,
    via: str = "",
    email: str = "",
) -> dict:
    """
    Atomic state machine for task status transitions.
    
    Uses SQL WHERE conditions as mutual exclusion locks:
    - Only ONE concurrent caller can successfully UPDATE a given row.
    - Handles credit deduction/refund automatically based on the stored `cost`.
    
    Args:
        verification_id: The job/verification ID
        new_status: Target status ('pass', 'failed', 'cancel')
        message: Status message to set
        user_id: User ID (optional, will be extracted from cdk if not provided)
        via: Source tag
        email: User email
    
    Returns:
        dict with keys: success, prev_status, deducted, refunded, reason
    """
    import auth
    import logging

    conn = database.get_connection()
    now = datetime.utcnow().isoformat() + "Z"

    if new_status == "pass":
        # === Transition: processing → pass ===
        # Credits were pre-deducted at submission. Just update status.
        cursor = conn.execute(
            "UPDATE verification_history SET status='pass', message=?, timestamp=? "
            "WHERE verification_id=? AND status NOT IN ('pass', 'failed', 'cancel')",
            (message, now, verification_id)
        )
        if cursor.rowcount > 0:
            conn.commit()
            logging.info(f"[StateMachine] processing→pass for {verification_id}")
            return {"success": True, "prev_status": "processing", "deducted": False, "refunded": False}

        # === Transition: failed → pass (reconciliation) ===
        # Task was previously refunded. Need to re-deduct.
        cursor = conn.execute(
            "UPDATE verification_history SET status='pass', is_refunded=0, message=?, timestamp=? "
            "WHERE verification_id=? AND status='failed' AND is_refunded=1",
            (message, now, verification_id)
        )
        if cursor.rowcount > 0:
            conn.commit()
            # Read cost and user from the updated row
            row = conn.execute(
                "SELECT cost, cdk FROM verification_history WHERE verification_id=? ORDER BY rowid DESC LIMIT 1",
                (verification_id,)
            ).fetchone()
            cost = row["cost"] if row and "cost" in row.keys() else 0
            uid = _extract_user_id(row["cdk"]) if row else user_id
            deducted = False
            if cost > 0 and uid:
                result = auth.deduct_credits(uid, cost, reason="pixel_reconcile", ref_id=verification_id)
                deducted = bool(result)
                if not deducted:
                    logging.warning(f"[StateMachine] Reconcile deduct failed for user {uid}, cost={cost}, vid={verification_id} (insufficient credits)")
            logging.info(f"[StateMachine] failed→pass for {verification_id}, deducted={deducted}")
            return {"success": True, "prev_status": "failed", "deducted": deducted, "refunded": False}

        # Already pass → idempotent
        existing = conn.execute(
            "SELECT status FROM verification_history WHERE verification_id=? ORDER BY rowid DESC LIMIT 1",
            (verification_id,)
        ).fetchone()
        return {"success": False, "prev_status": existing["status"] if existing else "unknown",
                "deducted": False, "refunded": False, "reason": "already_terminal"}

    elif new_status in ("failed", "cancel"):
        # === Transition: processing → failed/cancel ===
        # Credits were pre-deducted. Refund them.
        cursor = conn.execute(
            "UPDATE verification_history SET status=?, is_refunded=1, message=?, timestamp=? "
            "WHERE verification_id=? AND status NOT IN ('pass', 'failed', 'cancel') AND is_refunded=0",
            (new_status, message, now, verification_id)
        )
        if cursor.rowcount > 0:
            conn.commit()
            row = conn.execute(
                "SELECT cost, cdk FROM verification_history WHERE verification_id=? ORDER BY rowid DESC LIMIT 1",
                (verification_id,)
            ).fetchone()
            cost = row["cost"] if row and "cost" in row.keys() else 0
            uid = _extract_user_id(row["cdk"]) if row else user_id
            refunded = False
            if cost > 0 and uid:
                auth.update_credits(uid, cost, reason="pixel_refund", ref_id=verification_id)
                refunded = True
            logging.info(f"[StateMachine] processing→{new_status} for {verification_id}, refunded={refunded}, cost={cost}")
            return {"success": True, "prev_status": "processing", "deducted": False, "refunded": refunded}

        # Already failed/cancel → idempotent (don't double-refund)
        existing = conn.execute(
            "SELECT status, is_refunded FROM verification_history WHERE verification_id=? ORDER BY rowid DESC LIMIT 1",
            (verification_id,)
        ).fetchone()
        return {"success": False, "prev_status": existing["status"] if existing else "unknown",
                "deducted": False, "refunded": False, "reason": "already_terminal"}

    return {"success": False, "reason": f"unsupported_status: {new_status}", "deducted": False, "refunded": False}

