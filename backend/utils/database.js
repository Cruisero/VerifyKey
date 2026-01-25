/**
 * Database setup using sql.js (pure JavaScript SQLite)
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'verifykey.db');
let db = null;
let SQL = null;

// Initialize database
async function initDatabase() {
    if (db) return db;

    SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            credits INTEGER DEFAULT 100,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            sheerid_url TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            result TEXT,
            document_path TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Create indexes  
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications(user_id)`);

    // Save database
    saveDatabase();

    console.log('[Database] SQLite initialized:', dbPath);
    return db;
}

// Save database to file
function saveDatabase() {
    if (!db) return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

/**
 * Execute a SQL statement with parameters
 * Returns { lastInsertRowid } for INSERT statements
 */
function run(sql, params = []) {
    if (!db) throw new Error('Database not initialized');

    try {
        // Use db.run which accepts params array
        db.run(sql, params);

        // Get last insert rowid BEFORE saving
        const result = db.exec("SELECT last_insert_rowid() as id");
        const lastId = result.length > 0 && result[0].values.length > 0
            ? result[0].values[0][0]
            : 0;

        // Save after getting lastId
        saveDatabase();

        return { lastInsertRowid: lastId };
    } catch (error) {
        console.error('[DB] Run error:', error.message, 'SQL:', sql);
        throw error;
    }
}

/**
 * Get a single row from a SQL query
 */
function get(sql, params = []) {
    if (!db) throw new Error('Database not initialized');

    try {
        const stmt = db.prepare(sql);
        if (params.length > 0) {
            stmt.bind(params);
        }

        let row = null;
        if (stmt.step()) {
            row = stmt.getAsObject();
        }
        stmt.free();
        return row;
    } catch (error) {
        console.error('[DB] Get error:', error.message, 'SQL:', sql);
        throw error;
    }
}

/**
 * Get all rows from a SQL query
 */
function all(sql, params = []) {
    if (!db) throw new Error('Database not initialized');

    try {
        const stmt = db.prepare(sql);
        if (params.length > 0) {
            stmt.bind(params);
        }

        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    } catch (error) {
        console.error('[DB] All error:', error.message, 'SQL:', sql);
        throw error;
    }
}

/**
 * Prepare-like interface for compatibility
 */
function prepare(sql) {
    return {
        run: (...params) => run(sql, params),
        get: (...params) => get(sql, params),
        all: (...params) => all(sql, params)
    };
}

// Export interface
module.exports = {
    initDatabase,
    run,
    get,
    all,
    prepare,
    getDb: () => db,
    saveDatabase
};
