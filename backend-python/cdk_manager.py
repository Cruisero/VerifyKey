"""
CDK (Card/Key) Manager for VerifyKey
Manages activation codes that grant verification quota.
Storage: JSON file at /app/data/cdkeys.json
"""

import json
import os
import string
import random
import threading
from datetime import datetime
from typing import Optional, Dict, List

# CDK storage file
CDK_FILE = "/app/data/cdkeys.json"

# Thread lock for concurrent access safety
_lock = threading.Lock()


def _generate_code() -> str:
    """Generate a CDK code like VK-XXXX-XXXX-XXXX"""
    chars = string.ascii_uppercase + string.digits
    parts = [''.join(random.choices(chars, k=4)) for _ in range(3)]
    return f"VK-{parts[0]}-{parts[1]}-{parts[2]}"


def _load_cdks() -> Dict:
    """Load CDK data from file"""
    try:
        if os.path.exists(CDK_FILE):
            with open(CDK_FILE, 'r') as f:
                return json.load(f)
    except Exception as e:
        print(f"[CDK] Error loading CDKs: {e}")
    return {}


def _save_cdks(data: Dict) -> bool:
    """Save CDK data to file"""
    try:
        os.makedirs(os.path.dirname(CDK_FILE), exist_ok=True)
        with open(CDK_FILE, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[CDK] Error saving CDKs: {e}")
        return False


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
    with _lock:
        cdks = _load_cdks()
        generated = []
        
        for _ in range(count):
            # Generate unique code
            code = _generate_code()
            while code in cdks:
                code = _generate_code()
            
            cdks[code] = {
                "quota": quota,
                "used": 0,
                "status": "unused",
                "createdAt": datetime.now().isoformat(),
                "lastUsedAt": None,
                "note": note
            }
            generated.append(code)
        
        _save_cdks(cdks)
        return generated


def validate_cdk(code: str) -> Dict:
    """
    Validate a CDK code and return its status.
    
    Returns:
        Dict with: valid (bool), remaining (int), quota (int), used (int), message (str)
    """
    code = code.strip().upper()
    cdks = _load_cdks()
    
    if code not in cdks:
        return {"valid": False, "remaining": 0, "message": "无效的 CDK"}
    
    cdk = cdks[code]
    remaining = cdk["quota"] - cdk["used"]
    
    if remaining <= 0:
        return {"valid": False, "remaining": 0, "quota": cdk["quota"], "used": cdk["used"], "message": "CDK 额度已用完"}
    
    return {
        "valid": True,
        "remaining": remaining,
        "quota": cdk["quota"],
        "used": cdk["used"],
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
    
    with _lock:
        cdks = _load_cdks()
        
        if code not in cdks:
            return {"success": False, "remaining": 0, "message": "无效的 CDK"}
        
        cdk = cdks[code]
        remaining = cdk["quota"] - cdk["used"]
        
        if remaining < amount:
            return {"success": False, "remaining": remaining, "message": f"CDK 额度不足（剩余 {remaining}）"}
        
        # Deduct
        cdk["used"] += amount
        cdk["lastUsedAt"] = datetime.now().isoformat()
        
        new_remaining = cdk["quota"] - cdk["used"]
        cdk["status"] = "used" if new_remaining <= 0 else "active"
        
        cdks[code] = cdk
        _save_cdks(cdks)
        
        return {"success": True, "remaining": new_remaining, "message": f"扣减成功，剩余 {new_remaining} 次"}


def get_all_cdks() -> List[Dict]:
    """Get all CDKs as a list (for Admin panel)"""
    cdks = _load_cdks()
    result = []
    for code, data in cdks.items():
        result.append({
            "code": code,
            **data,
            "remaining": data["quota"] - data["used"]
        })
    # Sort by creation time, newest first
    result.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return result


def delete_cdk(code: str) -> bool:
    """Delete a CDK"""
    code = code.strip().upper()
    with _lock:
        cdks = _load_cdks()
        if code in cdks:
            del cdks[code]
            _save_cdks(cdks)
            return True
        return False


def get_cdk_stats() -> Dict:
    """Get CDK statistics"""
    cdks = _load_cdks()
    
    total = len(cdks)
    unused = sum(1 for c in cdks.values() if c["status"] == "unused")
    active = sum(1 for c in cdks.values() if c["status"] == "active")
    used_up = sum(1 for c in cdks.values() if c["status"] == "used")
    
    total_quota = sum(c["quota"] for c in cdks.values())
    total_used = sum(c["used"] for c in cdks.values())
    total_remaining = total_quota - total_used
    
    return {
        "total": total,
        "unused": unused,
        "active": active,
        "usedUp": used_up,
        "totalQuota": total_quota,
        "totalUsed": total_used,
        "totalRemaining": total_remaining
    }
