"""
Auth module for OnePASS
Handles user authentication, registration, and JWT tokens
"""

import os
import sqlite3
import bcrypt
import jwt
import time
import string
import random
import json
from typing import Optional
from datetime import datetime, timedelta

# JWT Configuration
JWT_SECRET = os.getenv("JWT_SECRET", "verifykey-jwt-secret-change-in-production")
JWT_EXPIRES_HOURS = 168  # 7 days

ADMIN_PERMISSION_DEFINITIONS = [
    {"id": "view_users", "label": "查看用户", "description": "查看用户列表、邀请数和用户历史"},
    {"id": "manage_credits", "label": "调整积分", "description": "修改用户积分和处理补偿"},
    {"id": "view_orders", "label": "查看订单", "description": "查看订单、CDK 兑换和财务流水"},
    {"id": "manage_cdk", "label": "管理 CDK", "description": "生成、删除和消耗 CDK"},
    {"id": "view_logs", "label": "查看验证记录", "description": "查看验证日志、实时监控和审计记录"},
    {"id": "manual_override", "label": "手动处理结果", "description": "手动标记验证成功/失败、编辑失败提示"},
    {"id": "manage_config", "label": "系统配置", "description": "修改 Bot、Pixel、GPT、邮件等系统配置"},
    {"id": "manage_nodes", "label": "节点/通道管理", "description": "调整节点健康、权重、通道开关"},
    {"id": "manage_maintenance", "label": "维护和公告", "description": "开启维护模式、发布公告"},
    {"id": "super_admin", "label": "管理员管理", "description": "设置用户角色、权限和子管理员模板"},
]

ALL_ADMIN_PERMISSIONS = [p["id"] for p in ADMIN_PERMISSION_DEFINITIONS]

DEFAULT_ADMIN_ROLE_PRESETS = [
    {
        "id": "support_admin",
        "label": "客服/售后子管理员",
        "description": "处理用户问题、查看记录、手动处理失败单；默认不允许改配置或批量发码。",
        "permissions": ["view_users", "view_orders", "view_logs", "manual_override", "manage_credits"],
    },
    {
        "id": "ops_admin",
        "label": "运营/代理子管理员",
        "description": "查看用户与订单、管理少量 CDK、跟踪邀请和运营数据。",
        "permissions": ["view_users", "view_orders", "view_logs", "manage_cdk"],
    },
    {
        "id": "tech_admin",
        "label": "技术运维子管理员",
        "description": "管理节点、通道、系统配置、维护模式和公告。",
        "permissions": ["view_logs", "manage_config", "manage_nodes", "manage_maintenance"],
    },
]

# Database path - use /app/data in Docker, local data/ directory otherwise
if os.path.exists("/app/data"):
    DB_PATH = "/app/data/verifykey.db"
else:
    # Local development - create data directory next to this file
    DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
    os.makedirs(DATA_DIR, exist_ok=True)
    DB_PATH = os.path.join(DATA_DIR, "verifykey.db")


def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def init_database():
    """Initialize database with users table"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            credits INTEGER DEFAULT 0,
            invite_code TEXT UNIQUE,
            invited_by INTEGER,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Ensure invite columns exist for older DBs
    for col, typedef in [("invite_code", "TEXT"), ("invited_by", "INTEGER"), ("status", "TEXT DEFAULT 'active'"), ("admin_permissions", "TEXT")]:
        try:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col} {typedef}")
        except:
            pass

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS admin_role_presets (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            description TEXT DEFAULT '',
            permissions TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    ensure_admin_role_presets(conn)
    
    conn.commit()
    
    # Ensure admin user exists
    ensure_admin_user(conn)
    
    conn.close()
    print("[Auth] Database initialized")


def _normalize_permissions(permissions) -> list:
    if permissions is None:
        return []
    if isinstance(permissions, str):
        try:
            permissions = json.loads(permissions)
        except Exception:
            permissions = [p.strip() for p in permissions.split(",") if p.strip()]
    if not isinstance(permissions, list):
        return []
    allowed = set(ALL_ADMIN_PERMISSIONS)
    normalized = []
    for p in permissions:
        if p in allowed and p not in normalized:
            normalized.append(p)
    return normalized


def ensure_admin_role_presets(conn=None):
    close_conn = False
    if conn is None:
        conn = get_db()
        close_conn = True
    cursor = conn.cursor()
    for preset in DEFAULT_ADMIN_ROLE_PRESETS:
        cursor.execute("SELECT id FROM admin_role_presets WHERE id = ?", (preset["id"],))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO admin_role_presets (id, label, description, permissions)
                VALUES (?, ?, ?, ?)
            """, (
                preset["id"],
                preset["label"],
                preset["description"],
                json.dumps(preset["permissions"], ensure_ascii=False),
            ))
    conn.commit()
    if close_conn:
        conn.close()


def get_admin_role_config() -> dict:
    conn = get_db()
    ensure_admin_role_presets(conn)
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT id, label, description, permissions, updated_at
        FROM admin_role_presets ORDER BY id ASC
    """).fetchall()
    conn.close()
    presets = []
    for row in rows:
        item = dict(row)
        item["permissions"] = _normalize_permissions(item.get("permissions"))
        presets.append(item)
    return {"permissions": ADMIN_PERMISSION_DEFINITIONS, "presets": presets}


def save_admin_role_presets(presets: list) -> dict:
    if not isinstance(presets, list):
        raise ValueError("Invalid presets")
    conn = get_db()
    cursor = conn.cursor()
    existing_ids = set()
    for raw in presets:
        role_id = (raw.get("id") or "").strip()
        label = (raw.get("label") or "").strip()
        if not role_id or not label:
            raise ValueError("Role id and label are required")
        if role_id in ("admin", "user"):
            raise ValueError("Reserved role id")
        existing_ids.add(role_id)
        cursor.execute("""
            INSERT INTO admin_role_presets (id, label, description, permissions, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                label = excluded.label,
                description = excluded.description,
                permissions = excluded.permissions,
                updated_at = CURRENT_TIMESTAMP
        """, (
            role_id,
            label,
            raw.get("description") or "",
            json.dumps(_normalize_permissions(raw.get("permissions")), ensure_ascii=False),
        ))
    if existing_ids:
        placeholders = ",".join("?" for _ in existing_ids)
        cursor.execute(f"DELETE FROM admin_role_presets WHERE id NOT IN ({placeholders})", tuple(existing_ids))
    conn.commit()
    conn.close()
    return get_admin_role_config()


def role_permissions(role: str) -> list:
    if role == "admin":
        return ALL_ADMIN_PERMISSIONS[:]
    if not role or role == "user":
        return []
    conn = get_db()
    cursor = conn.cursor()
    row = cursor.execute("SELECT permissions FROM admin_role_presets WHERE id = ?", (role,)).fetchone()
    conn.close()
    return _normalize_permissions(row["permissions"] if row else [])


def hydrate_admin_permissions(user: dict) -> dict:
    if not user:
        return user
    role = user.get("role") or "user"
    if role == "admin":
        user["admin_permissions"] = ALL_ADMIN_PERMISSIONS[:]
        user["is_admin"] = True
        return user
    explicit = _normalize_permissions(user.get("admin_permissions"))
    role_based = role_permissions(role)
    merged = []
    for p in role_based + explicit:
        if p not in merged:
            merged.append(p)
    user["admin_permissions"] = merged
    user["is_admin"] = bool(merged)
    return user


def user_has_permission(user: dict, permission: str = None) -> bool:
    if not user:
        return False
    if user.get("role") == "admin":
        return True
    permissions = _normalize_permissions(user.get("admin_permissions"))
    if not permissions and user.get("role") not in (None, "user"):
        permissions = role_permissions(user.get("role"))
    if permission is None:
        return bool(permissions)
    return permission in permissions


def ensure_admin_user(conn=None):
    """Create or update admin user"""
    close_conn = False
    if conn is None:
        conn = get_db()
        close_conn = True
    
    cursor = conn.cursor()
    admin_email = "Rawbump@gmail.com"
    admin_password = "Pure314159"
    
    # Check if new admin email already exists
    cursor.execute("SELECT id FROM users WHERE email = ?", (admin_email,))
    existing = cursor.fetchone()
    
    if not existing:
        # Check if old admin exists and update it
        cursor.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
        old_admin = cursor.fetchone()
        
        if old_admin:
            hashed = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
            cursor.execute("""
                UPDATE users SET email = ?, password = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (admin_email, hashed, old_admin["id"]))
            conn.commit()
            print(f"[Auth] Admin user updated to: {admin_email}")
        else:
            hashed = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
            cursor.execute("""
                INSERT INTO users (email, username, password, role, credits)
                VALUES (?, '管理员', ?, 'admin', 9999)
            """, (admin_email, hashed))
            conn.commit()
            print(f"[Auth] Admin user created: {admin_email}")
    else:
        # Admin with correct email exists, update password
        hashed = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
        cursor.execute("""
            UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
        """, (hashed, admin_email))
        conn.commit()
        print(f"[Auth] Admin password updated for: {admin_email}")
    
    if close_conn:
        conn.close()


def _generate_invite_code(cursor):
    """Generate a unique 6-char invite code"""
    chars = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choices(chars, k=6))
        cursor.execute("SELECT id FROM users WHERE invite_code = ?", (code,))
        if not cursor.fetchone():
            return code


def register(email: str, password: str, username: str, invite_code: str = None) -> dict:
    """Register a new user, optionally with an invite code"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if user exists
    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    if cursor.fetchone():
        conn.close()
        raise ValueError("该邮箱已被注册")
    
    # Hash password
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    
    # Generate unique invite code for this user
    user_invite_code = _generate_invite_code(cursor)
    
    # Resolve inviter
    invited_by = None
    bonus_credits = 0
    if invite_code:
        cursor.execute("SELECT id FROM users WHERE invite_code = ?", (invite_code,))
        inviter = cursor.fetchone()
        if inviter:
            invited_by = inviter["id"] if isinstance(inviter, dict) else inviter[0]
            bonus_credits = 0  # No registration bonus; reward is given upon CDK redemption
    
    # Insert user
    initial_credits = 0 + bonus_credits
    cursor.execute("""
        INSERT INTO users (email, username, password, role, credits, invite_code, invited_by)
        VALUES (?, ?, ?, 'user', ?, ?, ?)
    """, (email, username, hashed, initial_credits, user_invite_code, invited_by))
    conn.commit()
    
    user_id = cursor.lastrowid
    
    # Get user data
    cursor.execute("""
        SELECT id, email, username, role, credits, invite_code, created_at 
        FROM users WHERE id = ?
    """, (user_id,))
    user_row = cursor.fetchone()
    conn.close()
    
    user = dict(user_row)
    token = generate_token(user)
    
    return {"user": user, "token": token}


def login(email: str, password: str) -> dict:
    """Login user"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Find user
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    user_row = cursor.fetchone()
    
    if not user_row:
        conn.close()
        raise ValueError("邮箱或密码错误")
    
    user = dict(user_row)
    
    # Verify password
    if not bcrypt.checkpw(password.encode(), user["password"].encode()):
        conn.close()
        raise ValueError("邮箱或密码错误")
        
    # Auto-generate invite_code for legacy users who have it as NULL
    if not user.get("invite_code"):
        code = _generate_invite_code(cursor)
        cursor.execute("UPDATE users SET invite_code = ? WHERE id = ?", (code, user["id"]))
        conn.commit()
        user["invite_code"] = code
        
    conn.close()
    
    # Remove password from response
    del user["password"]
    user = hydrate_admin_permissions(user)
    
    token = generate_token(user)
    
    return {"user": user, "token": token}


def generate_token(user: dict) -> str:
    """Generate JWT token"""
    payload = {
        "userId": user["id"],
        "email": user["email"],
        "role": user.get("role", "user"),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRES_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_token(token: str) -> Optional[dict]:
    """Verify JWT token and return user"""
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, email, username, role, credits, status, invite_code, admin_permissions, created_at 
            FROM users WHERE id = ?
        """, (decoded["userId"],))
        user_row = cursor.fetchone()
        
        if user_row:
            u_dict = dict(user_row)
            if not u_dict.get("invite_code"):
                code = _generate_invite_code(cursor)
                cursor.execute("UPDATE users SET invite_code = ? WHERE id = ?", (code, u_dict["id"]))
                conn.commit()
                u_dict["invite_code"] = code
            conn.close()
            return hydrate_admin_permissions(u_dict)
            
        conn.close()
        return None
    except:
        return None


def get_user_by_id(user_id: int) -> Optional[dict]:
    """Get user by ID"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, email, username, role, credits, invite_code, admin_permissions, created_at 
        FROM users WHERE id = ?
    """, (user_id,))
    user_row = cursor.fetchone()
    conn.close()
    
    if user_row:
        return hydrate_admin_permissions(dict(user_row))
    return None


def update_credits(user_id: int, amount: int, reason: str = "", ref_id: str = "") -> Optional[dict]:
    """Update user credits. Prevents negative balances when deducting.
    
    Args:
        user_id: User ID
        amount: Positive to add, negative to deduct
        reason: Audit reason (e.g. 'pixel_refund', 'cdk_redeem', 'admin_adjust')
        ref_id: Reference ID (e.g. verification_id)
    """
    conn = get_db()
    cursor = conn.cursor()
    if amount < 0:
        # Prevent negative balance: only deduct if sufficient credits
        cursor.execute("""
            UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ? AND credits >= ?
        """, (amount, user_id, abs(amount)))
        conn.commit()
        if cursor.rowcount == 0:
            conn.close()
            return None
    else:
        cursor.execute("""
            UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        """, (amount, user_id))
        conn.commit()
    conn.close()
    
    user = get_user_by_id(user_id)
    if user:
        _log_credit_transaction(user_id, amount, user["credits"], reason or "adjust", ref_id)
    return user


def deduct_credits(user_id: int, amount: float, reason: str = "", ref_id: str = "") -> Optional[dict]:
    """Deduct credits from user. Returns updated user if sufficient, None if not.
    
    Args:
        user_id: User ID
        amount: Amount to deduct (positive number)
        reason: Audit reason (e.g. 'pixel_deduct', 'gpt_deduct')
        ref_id: Reference ID (e.g. verification_id)
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT credits FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    if not row or row["credits"] < amount:
        conn.close()
        return None
    cursor.execute("""
        UPDATE users SET credits = credits - ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND credits >= ?
    """, (amount, user_id, amount))
    conn.commit()
    conn.close()
    if cursor.rowcount == 0:
        return None
    user = get_user_by_id(user_id)
    if user:
        _log_credit_transaction(user_id, -amount, user["credits"], reason or "deduct", ref_id)
    return user


def trigger_invite_reward(user_id: int) -> Optional[dict]:
    """
    Trigger invite reward when invitee redeems a CDK (i.e. purchases credits).
    Awards +0.2 credits to the inviter. Only triggers once per invitee.
    Returns the inviter's updated user data if reward was given, None otherwise.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if user exists, has an inviter, and hasn't consumed before
    cursor.execute("SELECT id, invited_by, has_consumed FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    
    if not user:
        conn.close()
        return None
    
    user_dict = dict(user)
    
    # Skip if already consumed or no inviter
    if user_dict.get("has_consumed") or not user_dict.get("invited_by"):
        conn.close()
        return None
    
    inviter_id = user_dict["invited_by"]
    reward_amount = 0.2
    
    # Mark as consumed
    cursor.execute("UPDATE users SET has_consumed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (user_id,))
    
    # Reward inviter
    cursor.execute("UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (reward_amount, inviter_id))
    
    # Log the reward in invitation_rewards table (in the main onepass.db)
    try:
        import database
        main_conn = database.get_connection()
        main_conn.execute(
            "INSERT INTO invitation_rewards (inviter_id, invitee_id, reward_amount) VALUES (?, ?, ?)",
            (inviter_id, user_id, reward_amount)
        )
        main_conn.commit()
    except Exception as e:
        print(f"[Invite] Error logging reward to invitation_rewards: {e}")
    
    conn.commit()
    conn.close()
    
    print(f"[Invite] User {inviter_id} rewarded +{reward_amount} credits (invitee: {user_id})")
    return get_user_by_id(inviter_id)


def create_reset_token(email: str) -> Optional[str]:
    """Create a password reset token (1 hour expiry)"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email FROM users WHERE email = ?", (email,))
    user_row = cursor.fetchone()
    conn.close()

    if not user_row:
        return None

    payload = {
        "userId": user_row["id"],
        "email": user_row["email"],
        "type": "password_reset",
        "exp": datetime.utcnow() + timedelta(hours=1)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_reset_token(token: str) -> Optional[dict]:
    """Verify a password reset token. Returns {'userId': ..., 'email': ...} or None"""
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        if decoded.get("type") != "password_reset":
            return None
        return {"userId": decoded["userId"], "email": decoded["email"]}
    except jwt.ExpiredSignatureError:
        return None
    except Exception:
        return None


def reset_password(user_id: int, new_password: str) -> bool:
    """Reset user password"""
    hashed = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (hashed, user_id))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected > 0


def list_all_users() -> list:
    """List all users (for admin)"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, email, username, role, credits, invite_code, invited_by, status, admin_permissions, created_at, updated_at
        FROM users ORDER BY id ASC
    """)
    rows = cursor.fetchall()
    users = []
    for r in rows:
        u = dict(r)
        u = hydrate_admin_permissions(u)
        # Count how many users this person invited
        cursor.execute("SELECT COUNT(*) FROM users WHERE invited_by = ?", (u["id"],))
        u["invite_count"] = cursor.fetchone()[0]
        users.append(u)
    conn.close()
    return users


def toggle_user_status(user_id: int, status: str) -> bool:
    """Toggle user status (active/suspended)"""
    conn = get_db()
    cursor = conn.cursor()
    # Ensure status column exists
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'")
        conn.commit()
    except:
        pass
    cursor.execute("""
        UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (status, user_id))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected > 0


def update_user_credits_admin(user_id: int, credits: float, reason: str = "admin_set") -> bool:
    """Set user credits to exact amount (admin)"""
    # Get old balance for audit
    old_user = get_user_by_id(user_id)
    old_credits = old_user["credits"] if old_user else 0

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (credits, user_id))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    
    if affected > 0:
        delta = credits - old_credits
        _log_credit_transaction(user_id, delta, credits, reason)
    return affected > 0


def update_user_admin_fields(user_id: int, credits=None, role=None, permissions=None, password: str = None) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, role FROM users WHERE id = ?", (user_id,))
    if not cursor.fetchone():
        conn.close()
        return {"success": False, "error": "User not found"}

    updates = []
    params = []
    if credits is not None:
        updates.append("credits = ?")
        params.append(float(credits))
    if role is not None:
        role = (role or "user").strip()
        if role not in ("user", "admin"):
            cursor.execute("SELECT id FROM admin_role_presets WHERE id = ?", (role,))
            if not cursor.fetchone():
                conn.close()
                return {"success": False, "error": "Invalid role"}
        updates.append("role = ?")
        params.append(role)
    if permissions is not None:
        updates.append("admin_permissions = ?")
        params.append(json.dumps(_normalize_permissions(permissions), ensure_ascii=False))
    if password:
        updates.append("password = ?")
        params.append(bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode())

    if updates:
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(user_id)
        cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()
    conn.close()
    return {"success": True}


def _log_credit_transaction(user_id: int, amount: float, balance_after: float, reason: str, ref_id: str = ""):
    """Write an immutable audit record to credit_transactions in the main onepass.db.
    
    This function never raises — audit failures are logged but do not break the caller.
    """
    try:
        import database
        conn = database.get_connection()
        conn.execute(
            "INSERT INTO credit_transactions (user_id, amount, balance_after, reason, ref_id, timestamp) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, round(amount, 2), round(balance_after, 2), reason, ref_id, datetime.utcnow().isoformat() + "Z")
        )
        conn.commit()
    except Exception as e:
        print(f"[Audit] Failed to log credit transaction for user {user_id}: {e}")
