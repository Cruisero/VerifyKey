/**
 * Anti-Detection Utilities for SheerID Verification
 * Mimics real browser behavior to avoid detection
 */

const crypto = require('crypto');

// User Agent strings (Chrome, Firefox, Edge, Safari on various platforms)
const USER_AGENTS = [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    // Chrome on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    // Firefox on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    // Edge
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    // Safari
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

// Common screen resolutions
const RESOLUTIONS = [
    '1920x1080', '1366x768', '1536x864', '1440x900',
    '1280x720', '2560x1440', '1680x1050', '1920x1200'
];

// Timezones (US-focused for Gemini)
const TIMEZONES = [-8, -7, -6, -5, -4]; // PST, MST, CST, EST, AST

// Languages
const LANGUAGES = ['en-US', 'en-US,en;q=0.9'];

// Platforms
const PLATFORMS = ['Win32', 'MacIntel'];

// First names for identity generation
const FIRST_NAMES = [
    'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph',
    'Thomas', 'Christopher', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark',
    'Mary', 'Patricia', 'Jennifer', 'Linda', 'Barbara', 'Elizabeth', 'Susan',
    'Jessica', 'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Margaret', 'Sandra',
    'Emma', 'Olivia', 'Ava', 'Isabella', 'Sophia', 'Mia', 'Charlotte', 'Amelia',
    'Ethan', 'Noah', 'Liam', 'Mason', 'Jacob', 'Lucas', 'Benjamin', 'Alexander'
];

// Last names
const LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
    'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill',
    'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Turner', 'Phillips', 'Evans', 'Parker'
];

/**
 * Get random element from array
 */
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get random integer in range [min, max]
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate random delay using gamma distribution (more natural feel)
 * @param {number} minMs - Minimum milliseconds
 * @param {number} maxMs - Maximum milliseconds
 */
function randomDelay(minMs = 500, maxMs = 2000) {
    // Simple approximation of gamma distribution
    const shape = 2;
    const scale = (maxMs - minMs) / (shape * 2);
    let delay = 0;
    for (let i = 0; i < shape; i++) {
        delay -= Math.log(Math.random()) * scale;
    }
    return Math.min(maxMs, Math.max(minMs, Math.round(delay + minMs)));
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Random sleep with natural delay
 */
async function randomSleep(minMs = 500, maxMs = 2000) {
    const delay = randomDelay(minMs, maxMs);
    await sleep(delay);
    return delay;
}

/**
 * Get random User-Agent string
 */
function getRandomUserAgent() {
    return randomChoice(USER_AGENTS);
}

/**
 * Generate browser-like headers for SheerID API
 */
function getHeaders(userAgent = null) {
    const ua = userAgent || getRandomUserAgent();
    const isChrome = ua.includes('Chrome') && !ua.includes('Edg');
    const isFirefox = ua.includes('Firefox');
    const isEdge = ua.includes('Edg');

    const headers = {
        'User-Agent': ua,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': randomChoice(LANGUAGES),
        'Accept-Encoding': 'gzip, deflate, br',
        'Content-Type': 'application/json',
        'Origin': 'https://services.sheerid.com',
        'Referer': 'https://services.sheerid.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    };

    // Add Chrome-specific headers
    if (isChrome) {
        headers['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = Math.random() > 0.5 ? '"Windows"' : '"macOS"';
    } else if (isEdge) {
        headers['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"';
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = '"Windows"';
    }

    return headers;
}

/**
 * Generate realistic device fingerprint hash
 */
function generateFingerprint() {
    const components = [
        String(Date.now()),
        String(Math.random()),
        randomChoice(RESOLUTIONS),
        String(randomChoice(TIMEZONES)),
        randomChoice(LANGUAGES),
        randomChoice(PLATFORMS),
        Math.random() > 0.5 ? 'Google Inc.' : 'Apple Computer, Inc.',
        String(randomInt(4, 16)), // CPU cores
        String(randomInt(4, 32)), // Device memory GB
        String(randomInt(0, 1)),  // Touch support
        '24', // Color depth
        String(randomInt(0, 100)), // Random seed
    ];

    return crypto.createHash('md5').update(components.join('|')).digest('hex');
}

/**
 * Generate random name
 */
function generateName() {
    return {
        firstName: randomChoice(FIRST_NAMES),
        lastName: randomChoice(LAST_NAMES)
    };
}

/**
 * Generate realistic student email
 */
function generateEmail(firstName, lastName, domain) {
    const patterns = [
        () => `${firstName[0].toLowerCase()}${lastName.toLowerCase()}${randomInt(100, 999)}@${domain}`,
        () => `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(10, 99)}@${domain}`,
        () => `${lastName.toLowerCase()}${firstName[0].toLowerCase()}${randomInt(100, 999)}@${domain}`,
        () => `${firstName.toLowerCase()}${randomInt(1, 99)}@${domain}`,
    ];

    return randomChoice(patterns)();
}

/**
 * Generate birth date for student (18-26 years old)
 */
function generateBirthDate() {
    const year = randomInt(2000, 2006);
    const month = randomInt(1, 12);
    const day = randomInt(1, 28);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

module.exports = {
    getRandomUserAgent,
    getHeaders,
    generateFingerprint,
    generateName,
    generateEmail,
    generateBirthDate,
    randomDelay,
    randomSleep,
    sleep,
    randomInt,
    randomChoice,
    USER_AGENTS,
};
