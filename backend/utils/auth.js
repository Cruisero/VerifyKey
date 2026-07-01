/**
 * Authentication Service
 * Handles user registration, login, and JWT management
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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
async function register(email, password, username, inviteCode) {
    await init();

    // Check if user already exists
    const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        throw new Error('该邮箱已被注册');
    }

    // Look up inviter if invite code provided
    let inviterId = null;
    if (inviteCode) {
        const inviter = database.prepare('SELECT id FROM users WHERE invite_code = ?').get(inviteCode);
        if (inviter) inviterId = inviter.id;
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);
    const myInviteCode = generateInviteCode();

    // Insert user
    const result = database.prepare(`
        INSERT INTO users (email, username, password, role, credits, invite_code, invited_by)
        VALUES (?, ?, ?, 'user', 100, ?, ?)
    `).run(email, username, hashedPassword, myInviteCode, inviterId);

    const user = database.prepare('SELECT id, email, username, role, credits, invite_code, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

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
        const user = database.prepare('SELECT id, email, username, role, credits, invite_code, created_at FROM users WHERE id = ?').get(decoded.userId);
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
    return database.prepare('SELECT id, email, username, role, credits, invite_code, created_at FROM users WHERE id = ?').get(id);
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
 * Generate a unique 8-char invite code
 */
function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        const bytes = crypto.randomBytes(8);
        for (let i = 0; i < 8; i++) {
            code += chars[bytes[i] % chars.length];
        }
        // Check uniqueness
        const existing = database.prepare('SELECT id FROM users WHERE invite_code = ?').get(code);
        if (!existing) break;
    } while (true);
    return code;
}

/**
 * Trigger invite reward when invitee consumes credits for the first time
 * Returns the inviter's updated user if reward was given, null otherwise
 */
async function triggerInviteReward(userId) {
    await init();
    const user = database.prepare('SELECT id, invited_by, has_consumed FROM users WHERE id = ?').get(userId);
    if (!user || user.has_consumed || !user.invited_by) return null;

    // Mark as consumed
    database.prepare('UPDATE users SET has_consumed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);

    // Reward inviter +0.2 credits
    const rewardAmount = 0.2;
    database.prepare('UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(rewardAmount, user.invited_by);

    // Log the reward
    database.prepare('INSERT INTO invitation_rewards (inviter_id, invitee_id, reward_amount) VALUES (?, ?, ?)').run(user.invited_by, userId, rewardAmount);

    console.log(`[Invite] User ${user.invited_by} rewarded +${rewardAmount} credits (invitee: ${userId})`);
    return getUserById(user.invited_by);
}

/**
 * Get invitation stats for a user
 */
async function getInviteStats(userId) {
    await init();
    const user = database.prepare('SELECT invite_code FROM users WHERE id = ?').get(userId);
    const invited = database.prepare('SELECT COUNT(*) as count FROM users WHERE invited_by = ?').get(userId);
    const rewards = database.prepare('SELECT COALESCE(SUM(reward_amount), 0) as total FROM invitation_rewards WHERE inviter_id = ?').get(userId);

    return {
        inviteCode: user?.invite_code || '',
        invitedCount: invited?.count || 0,
        totalRewards: rewards?.total || 0
    };
}

/**
 * Create admin user if not exists
 */
async function ensureAdminUser() {
    const adminEmail = 'admin@verifykey.com';
    const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

    if (!existing) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        const adminInviteCode = generateInviteCode();
        database.prepare(`
            INSERT INTO users (email, username, password, role, credits, invite_code)
            VALUES (?, '管理员', ?, 'admin', 9999, ?)
        `).run(adminEmail, hashedPassword, adminInviteCode);
        console.log('[Auth] Admin user created: admin@verifykey.com / admin123');
    } else if (!existing.invite_code) {
        // Backfill invite code for existing admin
        const code = generateInviteCode();
        database.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(code, existing.id);
    }
}

module.exports = {
    init,
    register,
    login,
    verifyToken,
    generateToken,
    getUserById,
    updateCredits,
    triggerInviteReward,
    getInviteStats
};
