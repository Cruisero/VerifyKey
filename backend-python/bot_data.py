"""
Bot Data Store — JSON-file-based persistence for user credits, orders, and referrals.
Stored in /app/data/ (Docker volume) so data survives container restarts.
"""
import json
import os
import time
import string
import random
import logging
from typing import Dict, Optional, List
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

DATA_DIR = "/app/data"
USERS_FILE = os.path.join(DATA_DIR, "bot_users.json")
ORDERS_FILE = os.path.join(DATA_DIR, "bot_orders.json")

# ==================== Helpers ====================

def _ensure_dir():
    os.makedirs(DATA_DIR, exist_ok=True)

def _load_json(path: str) -> dict:
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load {path}: {e}")
    return {}

def _save_json(path: str, data: dict):
    _ensure_dir()
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to save {path}: {e}")

# ==================== User Management ====================

def _load_users() -> Dict[str, dict]:
    return _load_json(USERS_FILE)

def _save_users(users: Dict[str, dict]):
    _save_json(USERS_FILE, users)

def _generate_referral_code() -> str:
    """Generate a unique 6-char alphanumeric referral code."""
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choices(chars, k=6))

def get_or_create_user(telegram_id: int, username: str = "") -> dict:
    """Get existing user or create new one. Returns user dict."""
    users = _load_users()
    uid = str(telegram_id)
    
    if uid not in users:
        # Generate unique referral code
        existing_codes = {u.get("referral_code") for u in users.values()}
        code = _generate_referral_code()
        while code in existing_codes:
            code = _generate_referral_code()
        
        users[uid] = {
            "telegram_id": telegram_id,
            "username": username,
            "credits": 0,
            "referral_code": code,
            "referred_by": None,
            "first_verify_done": False,
            "daily_last_claim": None,
            "total_verifications": 0,
            "total_spent_credits": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _save_users(users)
        logger.info(f"New bot user created: {telegram_id} (@{username})")
    else:
        # Update username if changed
        if username and users[uid].get("username") != username:
            users[uid]["username"] = username
            _save_users(users)
    
    return users[uid]

def get_user(telegram_id: int) -> Optional[dict]:
    """Get user by telegram_id, returns None if not found."""
    users = _load_users()
    return users.get(str(telegram_id))

def get_user_by_referral_code(code: str) -> Optional[dict]:
    """Find user by their referral code."""
    users = _load_users()
    for user in users.values():
        if user.get("referral_code") == code:
            return user
    return None

def set_referred_by(telegram_id: int, referrer_telegram_id: int):
    """Record that user was referred by another user."""
    users = _load_users()
    uid = str(telegram_id)
    if uid in users and users[uid].get("referred_by") is None:
        users[uid]["referred_by"] = referrer_telegram_id
        _save_users(users)

def add_credits(telegram_id: int, amount: int, reason: str = "") -> int:
    """Add credits to user. Returns new balance."""
    users = _load_users()
    uid = str(telegram_id)
    if uid in users:
        users[uid]["credits"] = users[uid].get("credits", 0) + amount
        _save_users(users)
        logger.info(f"Added {amount} credits to user {telegram_id} ({reason}). New balance: {users[uid]['credits']}")
        return users[uid]["credits"]
    return 0

def deduct_credits(telegram_id: int, amount: int) -> bool:
    """Deduct credits from user. Returns True if successful, False if insufficient."""
    users = _load_users()
    uid = str(telegram_id)
    if uid in users and users[uid].get("credits", 0) >= amount:
        users[uid]["credits"] -= amount
        users[uid]["total_spent_credits"] = users[uid].get("total_spent_credits", 0) + amount
        _save_users(users)
        return True
    return False

def increment_verifications(telegram_id: int):
    """Increment the user's total verification count."""
    users = _load_users()
    uid = str(telegram_id)
    if uid in users:
        users[uid]["total_verifications"] = users[uid].get("total_verifications", 0) + 1
        _save_users(users)

def mark_first_verify_done(telegram_id: int) -> Optional[int]:
    """
    Mark user's first verification as done.
    If user was referred, award +1 credit to referrer.
    Returns referrer's telegram_id if reward was given, else None.
    """
    users = _load_users()
    uid = str(telegram_id)
    if uid not in users:
        return None
    
    if users[uid].get("first_verify_done"):
        return None  # Already done
    
    users[uid]["first_verify_done"] = True
    
    referrer_id = users[uid].get("referred_by")
    if referrer_id:
        ref_uid = str(referrer_id)
        if ref_uid in users:
            users[ref_uid]["credits"] = users[ref_uid].get("credits", 0) + 1
            _save_users(users)
            logger.info(f"Referral reward: +1 credit to user {referrer_id} (referred {telegram_id})")
            return referrer_id
    
    _save_users(users)
    return None

def claim_daily(telegram_id: int, daily_amount: int = 1) -> tuple:
    """
    Claim daily free credits. 
    Returns (success: bool, new_balance: int, message: str).
    """
    users = _load_users()
    uid = str(telegram_id)
    if uid not in users:
        return False, 0, "User not found"
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    last_claim = users[uid].get("daily_last_claim")
    
    if last_claim == today:
        return False, users[uid].get("credits", 0), "今天已经领取过了，明天再来吧！"
    
    users[uid]["daily_last_claim"] = today
    users[uid]["credits"] = users[uid].get("credits", 0) + daily_amount
    _save_users(users)
    
    return True, users[uid]["credits"], f"成功领取 {daily_amount} 积分！"

def get_referral_stats(telegram_id: int) -> dict:
    """Get referral statistics for a user."""
    users = _load_users()
    uid = str(telegram_id)
    user = users.get(uid)
    if not user:
        return {"invited_count": 0, "earned_credits": 0}
    
    code = user.get("referral_code")
    invited = [u for u in users.values() if u.get("referred_by") == telegram_id]
    verified = [u for u in invited if u.get("first_verify_done")]
    
    return {
        "referral_code": code,
        "invited_count": len(invited),
        "verified_count": len(verified),
        "earned_credits": len(verified),  # 1 credit per verified referral
    }

def get_all_users() -> List[dict]:
    """Return all users as a list (for admin stats)."""
    users = _load_users()
    return list(users.values())

# ==================== Order Management ====================

def _load_orders() -> Dict[str, dict]:
    return _load_json(ORDERS_FILE)

def _save_orders(orders: Dict[str, dict]):
    _save_json(ORDERS_FILE, orders)

def create_order(telegram_id: int, usdt_amount: float, credits_to_add: int, network: str = "trc20", note_code: str = "") -> dict:
    """Create a pending crypto payment order."""
    orders = _load_orders()
    order_id = f"ORD_{int(time.time())}_{telegram_id}"
    
    order = {
        "id": order_id,
        "telegram_id": telegram_id,
        "usdt_amount": usdt_amount,
        "credits_to_add": credits_to_add,
        "network": network,
        "note_code": note_code,
        "status": "pending",
        "tx_hash": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "confirmed_at": None,
    }
    
    orders[order_id] = order
    _save_orders(orders)
    logger.info(f"Created order {order_id}: {usdt_amount} USDT ({network}) for {credits_to_add} credits (user {telegram_id})")
    return order

def get_pending_orders() -> List[dict]:
    """Get all pending crypto orders."""
    orders = _load_orders()
    return [o for o in orders.values() if o.get("status") == "pending"]

def confirm_order(order_id: str, tx_hash: str) -> Optional[dict]:
    """Confirm a crypto payment order. Returns the order if found."""
    orders = _load_orders()
    if order_id in orders and orders[order_id]["status"] == "pending":
        orders[order_id]["status"] = "confirmed"
        orders[order_id]["tx_hash"] = tx_hash
        orders[order_id]["confirmed_at"] = datetime.now(timezone.utc).isoformat()
        _save_orders(orders)
        
        # Add credits to user
        order = orders[order_id]
        add_credits(order["telegram_id"], order["credits_to_add"], f"Crypto payment {order_id}")
        
        logger.info(f"Order {order_id} confirmed. TX: {tx_hash}")
        return order
    return None

def expire_old_orders(max_age_hours: int = 24):
    """Expire orders older than max_age_hours."""
    orders = _load_orders()
    now = time.time()
    expired = []
    
    for oid, order in orders.items():
        if order["status"] != "pending":
            continue
        created = datetime.fromisoformat(order["created_at"]).timestamp()
        if now - created > max_age_hours * 3600:
            orders[oid]["status"] = "expired"
            expired.append(oid)
    
    if expired:
        _save_orders(orders)
        logger.info(f"Expired {len(expired)} old orders: {expired}")

def generate_unique_usdt_amount(base_amount: float) -> float:
    """
    Generate a unique USDT amount for payment identification.
    Adds small offsets to avoid collision with other pending orders.
    """
    pending = get_pending_orders()
    used_amounts = {round(o["usdt_amount"], 2) for o in pending}
    
    # Try offsets: +0.01, -0.01, +0.02, -0.02, ...
    for i in range(100):
        offset = (1 if i % 2 == 0 else -1) * ((i // 2) + 1) * 0.01
        candidate = round(base_amount + offset, 2)
        if candidate > 0 and candidate not in used_amounts:
            return candidate
    
    return base_amount

def get_all_orders() -> List[dict]:
    """Return all orders as a list (for admin stats)."""
    orders = _load_orders()
    return list(orders.values())

def get_stats() -> dict:
    """Get aggregate statistics for admin dashboard."""
    users = get_all_users()
    orders = get_all_orders()
    
    total_users = len(users)
    total_credits_in_circulation = sum(u.get("credits", 0) for u in users)
    total_verifications = sum(u.get("total_verifications", 0) for u in users)
    total_spent = sum(u.get("total_spent_credits", 0) for u in users)
    
    confirmed_orders = [o for o in orders if o.get("status") == "confirmed"]
    pending_orders = [o for o in orders if o.get("status") == "pending"]
    total_revenue_usdt = sum(o.get("usdt_amount", 0) for o in confirmed_orders)
    
    referral_rewards = sum(1 for u in users if u.get("referred_by") and u.get("first_verify_done"))
    
    # Today's active users (those who claimed daily or verified today)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    daily_active = sum(1 for u in users if u.get("daily_last_claim") == today)
    
    return {
        "total_users": total_users,
        "daily_active_users": daily_active,
        "total_credits_in_circulation": total_credits_in_circulation,
        "total_verifications": total_verifications,
        "total_spent_credits": total_spent,
        "total_revenue_usdt": round(total_revenue_usdt, 2),
        "confirmed_orders": len(confirmed_orders),
        "pending_orders": len(pending_orders),
        "referral_rewards_given": referral_rewards,
    }
