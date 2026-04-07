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
from datetime import datetime, timedelta
from typing import Optional

# JWT Configuration
JWT_SECRET = os.getenv("JWT_SECRET", "verifykey-jwt-secret-change-in-production")
JWT_EXPIRES_HOURS = 168  # 7 days

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
    conn = sqlite3.connect(DB_PATH)
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
    for col, typedef in [("invite_code", "TEXT"), ("invited_by", "INTEGER"), ("status", "TEXT DEFAULT 'active'")]:
        try:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col} {typedef}")
        except:
            pass
    
    conn.commit()
    
    # Ensure admin user exists
    ensure_admin_user(conn)
    
    conn.close()
    print("[Auth] Database initialized")


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
            bonus_credits = 50  # bonus for being invited
    
    # Insert user
    initial_credits = 0 + bonus_credits
    cursor.execute("""
        INSERT INTO users (email, username, password, role, credits, invite_code, invited_by)
        VALUES (?, ?, ?, 'user', ?, ?, ?)
    """, (email, username, hashed, initial_credits, user_invite_code, invited_by))
    conn.commit()
    
    user_id = cursor.lastrowid
    
    # Give inviter bonus credits
    if invited_by:
        cursor.execute("UPDATE users SET credits = credits + 50 WHERE id = ?", (invited_by,))
        conn.commit()
    
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
            SELECT id, email, username, role, credits, status, invite_code, created_at 
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
            return u_dict
            
        conn.close()
        return None
    except:
        return None


def get_user_by_id(user_id: int) -> Optional[dict]:
    """Get user by ID"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, email, username, role, credits, invite_code, created_at 
        FROM users WHERE id = ?
    """, (user_id,))
    user_row = cursor.fetchone()
    conn.close()
    
    if user_row:
        return dict(user_row)
    return None


def update_credits(user_id: int, amount: int) -> Optional[dict]:
    """Update user credits. Prevents negative balances when deducting."""
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
    
    return get_user_by_id(user_id)


def deduct_credits(user_id: int, amount: float) -> Optional[dict]:
    """Deduct credits from user. Returns updated user if sufficient, None if not."""
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
    return get_user_by_id(user_id)


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
        SELECT id, email, username, role, credits, invite_code, invited_by, status, created_at, updated_at
        FROM users ORDER BY id ASC
    """)
    rows = cursor.fetchall()
    users = []
    for r in rows:
        u = dict(r)
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


def update_user_credits_admin(user_id: int, credits: float) -> bool:
    """Set user credits to exact amount (admin)"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (credits, user_id))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected > 0

