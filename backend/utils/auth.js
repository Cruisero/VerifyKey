/**
 * Authentication Service
 * Handles user registration, login, and JWT management
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const database = require('./database');

// JWT secret (should be in .env in production)
const JWT_SECRET = process.env.JWT_SECRET || 'verifykey-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

let dbReady = false;

// Initialize database
async function init() {
    if (dbReady) return;
    await database.initDatabase();
    await ensureAdminUser();
    dbReady = true;
}

/**
 * Register a new user
 */
async function register(email, password, username) {
    await init();

    // Check if user already exists
    const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        throw new Error('该邮箱已被注册');
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Insert user
    const result = database.prepare(`
        INSERT INTO users (email, username, password, role, credits)
        VALUES (?, ?, ?, 'user', 100)
    `).run(email, username, hashedPassword);

    const user = database.prepare('SELECT id, email, username, role, credits, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

    // Generate token
    const token = generateToken(user);

    return { user, token };
}

/**
 * Login user
 */
async function login(email, password) {
    await init();

    // Find user
    const user = database.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
        throw new Error('邮箱或密码错误');
    }

    // Verify password
    const isValid = bcrypt.compareSync(password, user.password);
    if (!isValid) {
        throw new Error('邮箱或密码错误');
    }

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    // Generate token
    const token = generateToken(userWithoutPassword);

    return { user: userWithoutPassword, token };
}

/**
 * Verify JWT token and return user
 */
async function verifyToken(token) {
    try {
        await init();
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = database.prepare('SELECT id, email, username, role, credits, created_at FROM users WHERE id = ?').get(decoded.userId);
        return user;
    } catch (error) {
        return null;
    }
}

/**
 * Generate JWT token
 */
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

/**
 * Get user by ID
 */
async function getUserById(id) {
    await init();
    return database.prepare('SELECT id, email, username, role, credits, created_at FROM users WHERE id = ?').get(id);
}

/**
 * Update user credits
 */
async function updateCredits(userId, amount) {
    await init();
    database.prepare('UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(amount, userId);
    return getUserById(userId);
}

/**
 * Create admin user if not exists
 */
async function ensureAdminUser() {
    const adminEmail = 'admin@verifykey.com';
    const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

    if (!existing) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        database.prepare(`
            INSERT INTO users (email, username, password, role, credits)
            VALUES (?, '管理员', ?, 'admin', 9999)
        `).run(adminEmail, hashedPassword);
        console.log('[Auth] Admin user created: admin@verifykey.com / admin123');
    }
}

module.exports = {
    init,
    register,
    login,
    verifyToken,
    generateToken,
    getUserById,
    updateCredits
};
