/**
 * B2B Merchant API Token Generator
 * Generates a long-lived or permanent JWT token for a specific user email.
 * Run with: node generate-token.js <user_email> [expiry_days]
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const database = require('./utils/database');

const JWT_SECRET = process.env.JWT_SECRET || 'verifykey-jwt-secret-change-in-production';

async function main() {
    const email = process.argv[2];
    const days = process.argv[3] ? parseInt(process.argv[3]) : 3650; // Default to 10 years (3650 days)

    if (!email) {
        console.log('\nOnePASS B2B Merchant API Token Generator');
        console.log('========================================');
        console.log('Usage: node generate-token.js <user_email> [expiry_days]');
        console.log('  - <user_email>: The email of the merchant account');
        console.log('  - [expiry_days]: Days until expiration. Set to 0 for a permanent token (no expiration). Default is 3650 days (10 years).');
        console.log('\nExample (10-year token): node generate-token.js merchant@example.com');
        console.log('Example (permanent token): node generate-token.js merchant@example.com 0\n');
        process.exit(1);
    }

    // Initialize Database
    await database.initDatabase();

    // Check if user exists
    const user = database.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
    if (!user) {
        console.error(`\n❌ Error: User with email "${email}" not found in database.`);
        process.exit(1);
    }

    const payload = { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
    };

    const options = {};
    if (days > 0) {
        options.expiresIn = `${days}d`;
    }

    // Sign the JWT token
    const token = jwt.sign(payload, JWT_SECRET, options);

    console.log('\n======================================================================');
    console.log(`🔑 Generated API Token for: ${user.email}`);
    console.log(`📅 Expiration: ${days > 0 ? days + ' days (' + Math.round(days/365) + ' years)' : 'Never expire (Permanent)'}`);
    console.log('======================================================================\n');
    console.log(token);
    console.log('\n======================================================================\n');
}

main().catch(console.error);
