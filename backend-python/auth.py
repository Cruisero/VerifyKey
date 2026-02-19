"""
Authentication Service for OnePass
Handles user registration, login, and JWT management
"""

import os
import sqlite3
import bcrypt
import jwt
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
            credits INTEGER DEFAULT 100,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
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


def register(email: str, password: str, username: str) -> dict:
    """Register a new user"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if user exists
    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    if cursor.fetchone():
        conn.close()
        raise ValueError("该邮箱已被注册")
    
    # Hash password
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    
    # Insert user
    cursor.execute("""
        INSERT INTO users (email, username, password, role, credits)
        VALUES (?, ?, ?, 'user', 100)
    """, (email, username, hashed))
    conn.commit()
    
    user_id = cursor.lastrowid
    
    # Get user data
    cursor.execute("""
        SELECT id, email, username, role, credits, created_at 
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
    conn.close()
    
    if not user_row:
        raise ValueError("邮箱或密码错误")
    
    user = dict(user_row)
    
    # Verify password
    if not bcrypt.checkpw(password.encode(), user["password"].encode()):
        raise ValueError("邮箱或密码错误")
    
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
            SELECT id, email, username, role, credits, created_at 
            FROM users WHERE id = ?
        """, (decoded["userId"],))
        user_row = cursor.fetchone()
        conn.close()
        
        if user_row:
            return dict(user_row)
        return None
    except:
        return None


def get_user_by_id(user_id: int) -> Optional[dict]:
    """Get user by ID"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, email, username, role, credits, created_at 
        FROM users WHERE id = ?
    """, (user_id,))
    user_row = cursor.fetchone()
    conn.close()
    
    if user_row:
        return dict(user_row)
    return None


def update_credits(user_id: int, amount: int) -> Optional[dict]:
    """Update user credits"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
    """, (amount, user_id))
    conn.commit()
    conn.close()
    
    return get_user_by_id(user_id)
