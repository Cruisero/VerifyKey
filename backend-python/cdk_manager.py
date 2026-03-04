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
    chars = string.ascii_uppercase + string.digits
    parts = [''.join(random.choices(chars, k=4)) for _ in range(3)]
    return f"VK-{parts[0]}-{parts[1]}-{parts[2]}"


def generate_cdks(count: int, quota: int, note: str = "") -> List[str]:
    """
    Generate batch of CDK codes.
    
    Args:
        count: Number of CDKs to generate
        quota: Credits per CDK (1, 2, 5, 20, 100)
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


def validate_cdk(code: str) -> Dict:
    """
    Validate a CDK code and return its status.
    
    Returns:
        Dict with: valid (bool), remaining (int), quota (int), used (int), message (str)
    """
    code = code.strip().upper()
    conn = database.get_connection()
    cursor = conn.execute("SELECT quota, used, status FROM cdkeys WHERE code = ?", (code,))
    row = cursor.fetchone()

    if not row:
        return {"valid": False, "remaining": 0, "message": "无效的 CDK"}

    remaining = row["quota"] - row["used"]

    if remaining <= 0:
        return {"valid": False, "remaining": 0, "quota": row["quota"], "used": row["used"], "message": "CDK 额度已用完"}

    return {
        "valid": True,
        "remaining": remaining,
        "quota": row["quota"],
        "used": row["used"],
        "message": f"CDK 有效，剩余 {remaining} 次"
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
    code = code.strip().upper()
    conn = database.get_connection()

    with _lock:
        cursor = conn.execute("SELECT quota, used FROM cdkeys WHERE code = ?", (code,))
        row = cursor.fetchone()

        if not row:
            return {"success": False, "remaining": 0, "message": "无效的 CDK"}

        remaining = row["quota"] - row["used"]

        if remaining < amount:
            return {"success": False, "remaining": remaining, "message": f"CDK 额度不足（剩余 {remaining}）"}

        new_used = row["used"] + amount
        new_remaining = row["quota"] - new_used
        new_status = "used" if new_remaining <= 0 else "active"
        now = datetime.now().isoformat()

        conn.execute(
            "UPDATE cdkeys SET used = ?, status = ?, last_used_at = ? WHERE code = ?",
            (new_used, new_status, now, code)
        )
        conn.commit()

        return {"success": True, "remaining": new_remaining, "message": f"扣减成功，剩余 {new_remaining} 次"}


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
        cursor = conn.execute("DELETE FROM cdkeys WHERE code = ?", (code,))
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
