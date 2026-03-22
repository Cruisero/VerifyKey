"""
CDK (Card/Key) Manager for VerifyKey
Manages activation codes that grant verification quota.
Storage: SQLite database at /app/data/onepass.db
"""

import string
import random
import threading
from datetime import datetime
from typing import Dict, List

import database

_lock = threading.Lock()


def _generate_code() -> str:
    """Generate a CDK code like VK-XXXX-XXXX-XXXX"""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
    parts = [''.join(random.choices(chars, k=4)) for _ in range(3)]
    return f"VK-{parts[0]}-{parts[1]}-{parts[2]}"


def generate_cdks(count: int, quota: int, note: str = "") -> List[str]:
    """
    Generate batch of CDK codes.
    
    Args:
        count: Number of CDKs to generate
        quota: Points per CDK (e.g. 1, 1.5, 5, 10, 50, 100)
        note: Optional note/label
    
    Returns:
        List of generated CDK codes
    """
    conn = database.get_connection()
    generated = []
    now = datetime.now().isoformat()

    with _lock:
        # Get existing codes to avoid duplicates
        cursor = conn.execute("SELECT code FROM cdkeys")
        existing = {row["code"] for row in cursor.fetchall()}

        for _ in range(count):
            code = _generate_code()
            while code in existing:
                code = _generate_code()

            conn.execute(
                "INSERT INTO cdkeys (code, quota, used, status, created_at, last_used_at, note) VALUES (?, ?, 0, 'unused', ?, NULL, ?)",
                (code, quota, now, note)
            )
            existing.add(code)
            generated.append(code)

        conn.commit()

    return generated


def _ensure_redeemed_by_column():
    """Auto-migrate: add redeemed_by column to cdkeys if missing."""
    conn = database.get_connection()
    try:
        conn.execute("SELECT redeemed_by FROM cdkeys LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE cdkeys ADD COLUMN redeemed_by INTEGER DEFAULT NULL")
        conn.commit()
        print("[CDK] Added redeemed_by column to cdkeys table")

# Run migration on import
_ensure_redeemed_by_column()


def redeem_cdk(code: str, user_id: int) -> Dict:
    """
    Redeem a CDK: transfer ALL remaining credits to user account.
    CDK is fully consumed after redemption.

    Args:
        code: CDK code
        user_id: ID of the user redeeming

    Returns:
        Dict with: success, credits_added, message
    """
    import auth

    code = _normalize_code(code)
    conn = database.get_connection()

    with _lock:
        cursor = conn.execute("SELECT quota, used, status, redeemed_by FROM cdkeys WHERE code = ?", (code,))
        row = cursor.fetchone()

        if not row:
            return {"success": False, "message": "无效的 CDK"}

        if row["redeemed_by"] is not None:
            return {"success": False, "message": "该 CDK 已被兑换过"}

        remaining = row["quota"] - row["used"]
        if remaining <= 0:
            return {"success": False, "message": "CDK 积分已用完"}

        # Transfer all remaining credits to user account
        auth.update_credits(user_id, remaining)

        # Mark CDK as fully used
        now = datetime.now().isoformat()
        conn.execute(
            "UPDATE cdkeys SET used = quota, status = 'used', last_used_at = ?, redeemed_by = ? WHERE code = ?",
            (now, user_id, code)
        )
        conn.commit()

        remaining_display = int(remaining) if remaining == int(remaining) else round(remaining, 1)
        return {
            "success": True,
            "credits_added": remaining,
            "message": f"兑换成功！已充入 {remaining_display} 积分到您的账户"
        }



def _normalize_code(code: str) -> str:
    """Normalize CDK code: uppercase, strip invalid chars, O→0, I→1."""
    import re
    code = re.sub(r'[^A-Z0-9\-]', '', code.strip().upper())
    return code.replace('O', '0').replace('I', '1')


def normalize_existing_cdks():
    """Fix any CDKs in the database that contain O or I (one-time migration)."""
    conn = database.get_connection()
    with _lock:
        cursor = conn.execute("SELECT code FROM cdkeys WHERE code LIKE '%O%' OR code LIKE '%I%'")
        rows = cursor.fetchall()
        fixed = 0
        for row in rows:
            old_code = row["code"]
            new_code = old_code.replace('O', '0').replace('I', '1')
            if old_code != new_code:
                conn.execute("UPDATE cdkeys SET code = ? WHERE code = ?", (new_code, old_code))
                fixed += 1
        if fixed:
            conn.commit()
            print(f"[CDK] Normalized {fixed} CDK codes (O→0, I→1)")


def validate_cdk(code: str) -> Dict:
    """
    Validate a CDK code and return its status.
    
    Returns:
        Dict with: valid (bool), remaining (int), quota (int), used (int), message (str)
    """
    code = _normalize_code(code)
    conn = database.get_connection()
    cursor = conn.execute("SELECT quota, used, status FROM cdkeys WHERE code = ?", (code,))
    row = cursor.fetchone()

    if not row:
        return {"valid": False, "remaining": 0, "message": "无效的 CDK"}

    remaining = row["quota"] - row["used"]

    if remaining <= 0:
        return {"valid": False, "remaining": 0, "quota": row["quota"], "used": row["used"], "message": "CDK 积分已用完"}

    remaining_display = int(remaining) if remaining == int(remaining) else round(remaining, 1)
    return {
        "valid": True,
        "remaining": remaining,
        "quota": row["quota"],
        "used": row["used"],
        "message": f"CDK 有效，剩余 {remaining_display} 积分"
    }


def use_cdk(code: str, amount: int = 1) -> Dict:
    """
    Deduct quota from a CDK.
    
    Args:
        code: CDK code
        amount: Amount to deduct (default 1)
    
    Returns:
        Dict with: success (bool), remaining (int), message (str)
    """
    code = _normalize_code(code)
    conn = database.get_connection()

    with _lock:
        cursor = conn.execute("SELECT quota, used FROM cdkeys WHERE code = ?", (code,))
        row = cursor.fetchone()

        if not row:
            return {"success": False, "remaining": 0, "message": "无效的 CDK"}

        remaining = row["quota"] - row["used"]

        if remaining < amount:
            return {"success": False, "remaining": remaining, "message": f"CDK 积分不足（剩余 {remaining}）"}

        new_used = row["used"] + amount
        new_remaining = row["quota"] - new_used
        new_status = "used" if new_remaining <= 0 else "active"
        now = datetime.now().isoformat()

        conn.execute(
            "UPDATE cdkeys SET used = ?, status = ?, last_used_at = ? WHERE code = ?",
            (new_used, new_status, now, code)
        )
        conn.commit()

        return {"success": True, "remaining": new_remaining, "message": f"扣减成功，剩余 {new_remaining} 积分"}


def refund_cdk(code: str, amount: int = 1) -> Dict:
    """
    Refund quota to a CDK (reverse of use_cdk).
    
    Args:
        code: CDK code
        amount: Amount to refund (default 1)
    
    Returns:
        Dict with: success (bool), remaining (int), message (str)
    """
    code = _normalize_code(code)
    conn = database.get_connection()

    with _lock:
        cursor = conn.execute("SELECT quota, used FROM cdkeys WHERE code = ?", (code,))
        row = cursor.fetchone()

        if not row:
            return {"success": False, "remaining": 0, "message": "无效的 CDK"}

        new_used = max(0, row["used"] - amount)
        new_remaining = row["quota"] - new_used
        new_status = "unused" if new_used == 0 else "active"
        now = datetime.now().isoformat()

        conn.execute(
            "UPDATE cdkeys SET used = ?, status = ?, last_used_at = ? WHERE code = ?",
            (new_used, new_status, now, code)
        )
        conn.commit()

        return {"success": True, "remaining": new_remaining, "message": f"退还成功，剩余 {new_remaining} 积分"}


def get_all_cdks() -> List[Dict]:
    """Get all CDKs as a list (for Admin panel)"""
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT code, quota, used, status, created_at, last_used_at, note FROM cdkeys ORDER BY created_at DESC"
    )
    return [
        {
            "code": r["code"],
            "quota": r["quota"],
            "used": r["used"],
            "status": r["status"],
            "remaining": r["quota"] - r["used"],
            "createdAt": r["created_at"],
            "lastUsedAt": r["last_used_at"],
            "note": r["note"]
        }
        for r in cursor.fetchall()
    ]


def delete_cdk(code: str) -> bool:
    """Delete a CDK"""
    code = code.strip().upper()
    conn = database.get_connection()
    with _lock:
        cursor = conn.execute("DELETE FROM cdkeys WHERE UPPER(code) = ?", (code,))
        conn.commit()
        return cursor.rowcount > 0


def get_cdk_stats() -> Dict:
    """Get CDK statistics"""
    conn = database.get_connection()

    cursor = conn.execute(
        "SELECT COUNT(*) as total, "
        "SUM(CASE WHEN status = 'unused' THEN 1 ELSE 0 END) as unused, "
        "SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active, "
        "SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) as used_up, "
        "COALESCE(SUM(quota), 0) as total_quota, "
        "COALESCE(SUM(used), 0) as total_used "
        "FROM cdkeys"
    )
    row = cursor.fetchone()

    return {
        "total": row["total"],
        "unused": row["unused"] or 0,
        "active": row["active"] or 0,
        "usedUp": row["used_up"] or 0,
        "totalQuota": row["total_quota"],
        "totalUsed": row["total_used"],
        "totalRemaining": row["total_quota"] - row["total_used"]
    }
