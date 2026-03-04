"""
SQLite Database Module for OnePass
Provides shared database connection, table initialization, and JSON data migration.
Database file: /app/data/onepass.db
"""

import json
import os
import sqlite3
import threading
from pathlib import Path

# Database file path (inside docker /app/data, locally in current dir)
DB_DIR = "/app/data"
DB_FILE = os.path.join(DB_DIR, "onepass.db")

# Thread-local storage for connections
_local = threading.local()
_initialized = False
_init_lock = threading.Lock()


def get_connection() -> sqlite3.Connection:
    """Get a thread-local SQLite connection."""
    if not hasattr(_local, 'connection') or _local.connection is None:
        os.makedirs(DB_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_FILE, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")  # Better concurrency
        conn.execute("PRAGMA busy_timeout=5000")  # Wait up to 5s on lock
        _local.connection = conn
    return _local.connection


def init_db():
    """Initialize database tables and migrate existing JSON data."""
    global _initialized
    if _initialized:
        return

    with _init_lock:
        if _initialized:
            return

        conn = get_connection()

        # Create tables
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS verification_history (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                verification_id TEXT DEFAULT '',
                message TEXT DEFAULT '',
                cdk TEXT DEFAULT '',
                timestamp TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bot_verify_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                link TEXT NOT NULL,
                username TEXT DEFAULT '',
                user_id INTEGER DEFAULT 0,
                status TEXT NOT NULL,
                message TEXT DEFAULT '',
                timestamp TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cdkeys (
                code TEXT PRIMARY KEY,
                quota INTEGER NOT NULL DEFAULT 0,
                used INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'unused',
                created_at TEXT DEFAULT '',
                last_used_at TEXT,
                note TEXT DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_vh_status ON verification_history(status);
            CREATE INDEX IF NOT EXISTS idx_vh_timestamp ON verification_history(timestamp);
            CREATE INDEX IF NOT EXISTS idx_bvl_timestamp ON bot_verify_log(timestamp);
            CREATE INDEX IF NOT EXISTS idx_cdk_status ON cdkeys(status);
        """)

        # Migrate existing JSON data
        _migrate_verification_history(conn)
        _migrate_bot_verify_log(conn)
        _migrate_cdkeys(conn)

        conn.commit()
        _initialized = True
        print("[DB] Database initialized successfully")


def _migrate_verification_history(conn: sqlite3.Connection):
    """Migrate verification_history.json to SQLite if table is empty."""
    cursor = conn.execute("SELECT COUNT(*) FROM verification_history")
    if cursor.fetchone()[0] > 0:
        return  # Already has data

    json_file = os.path.join(DB_DIR, "verification_history.json")
    if not os.path.exists(json_file):
        return

    try:
        with open(json_file, 'r') as f:
            records = json.load(f)

        if not records:
            return

        conn.executemany(
            "INSERT OR IGNORE INTO verification_history (id, status, verification_id, message, cdk, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            [(r.get("id", ""), r.get("status", ""), r.get("verificationId", ""),
              r.get("message", ""), r.get("cdk", ""), r.get("timestamp", ""))
             for r in records]
        )
        print(f"[DB] Migrated {len(records)} verification history records from JSON")

        # Rename old file as backup
        backup = json_file + ".bak"
        os.rename(json_file, backup)
        print(f"[DB] Backed up old JSON to {backup}")
    except Exception as e:
        print(f"[DB] Error migrating verification_history: {e}")


def _migrate_bot_verify_log(conn: sqlite3.Connection):
    """Migrate bot_verify_log.json to SQLite if table is empty."""
    cursor = conn.execute("SELECT COUNT(*) FROM bot_verify_log")
    if cursor.fetchone()[0] > 0:
        return

    json_file = os.path.join(DB_DIR, "bot_verify_log.json")
    if not os.path.exists(json_file):
        return

    try:
        with open(json_file, 'r') as f:
            records = json.load(f)

        if not records:
            return

        conn.executemany(
            "INSERT INTO bot_verify_log (link, username, user_id, status, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            [(r.get("link", ""), r.get("username", ""), r.get("user_id", 0),
              r.get("status", ""), r.get("message", ""), r.get("timestamp", ""))
             for r in records]
        )
        print(f"[DB] Migrated {len(records)} bot verify log records from JSON")

        backup = json_file + ".bak"
        os.rename(json_file, backup)
        print(f"[DB] Backed up old JSON to {backup}")
    except Exception as e:
        print(f"[DB] Error migrating bot_verify_log: {e}")


def _migrate_cdkeys(conn: sqlite3.Connection):
    """Migrate cdkeys.json to SQLite if table is empty."""
    cursor = conn.execute("SELECT COUNT(*) FROM cdkeys")
    if cursor.fetchone()[0] > 0:
        return

    json_file = os.path.join(DB_DIR, "cdkeys.json")
    if not os.path.exists(json_file):
        return

    try:
        with open(json_file, 'r') as f:
            cdks = json.load(f)

        if not cdks:
            return

        conn.executemany(
            "INSERT OR IGNORE INTO cdkeys (code, quota, used, status, created_at, last_used_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(code, data.get("quota", 0), data.get("used", 0), data.get("status", "unused"),
              data.get("createdAt", ""), data.get("lastUsedAt"), data.get("note", ""))
             for code, data in cdks.items()]
        )
        print(f"[DB] Migrated {len(cdks)} CDK records from JSON")

        backup = json_file + ".bak"
        os.rename(json_file, backup)
        print(f"[DB] Backed up old JSON to {backup}")
    except Exception as e:
        print(f"[DB] Error migrating cdkeys: {e}")
