/**
 * Configuration Manager
 * Stores and manages AI generator settings
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../config.json');

// Default configuration
const DEFAULT_CONFIG = {
    // AI Generator settings
    aiGenerator: {
        provider: 'svg', // 'svg' | 'antigravity' | 'gemini_official'

        // Antigravity Tools settings
        antigravity: {
            enabled: false,
            apiBase: 'http://127.0.0.1:8045/v1',
            apiKey: '',
            model: 'gemini-3-pro-image'
        },

        // Gemini Official API settings
        geminiOfficial: {
            enabled: false,
            apiKey: '',
            model: 'gemini-2.0-flash-exp-image-generation'
        },

        // SVG Fallback (always available)
        svgFallback: {
            enabled: true
        }
    },

    // Verification settings
    verification: {
        maxBatchSize: 5,
        delayBetweenMs: 2000
    },

    // Maintenance mode
    maintenance: {
        enabled: false,
        message: '系统维护中，请稍后再试',
        estimatedEnd: null
    },

    // Last updated
    updatedAt: null
};

/**
 * Load configuration from file
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const config = JSON.parse(data);
            // Merge with defaults to ensure all fields exist
            return { ...DEFAULT_CONFIG, ...config };
        }
    } catch (error) {
        console.error('[Config] Error loading config:', error.message);
    }
    return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to file
 */
function saveConfig(config) {
    try {
        config.updatedAt = new Date().toISOString();
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('[Config] Error saving config:', error.message);
        return false;
    }
}

/**
 * Get current configuration
 */
function getConfig() {
    return loadConfig();
}

/**
 * Update configuration
 */
function updateConfig(updates) {
    const current = loadConfig();
    const updated = deepMerge(current, updates);
    return saveConfig(updated) ? updated : null;
}

/**
 * Deep merge helper
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

/**
 * Get active AI generator settings
 */
function getActiveGenerator() {
    const config = loadConfig();
    const provider = config.aiGenerator.provider;

    switch (provider) {
        case 'antigravity':
            return {
                type: 'antigravity',
                apiBase: config.aiGenerator.antigravity.apiBase,
                apiKey: config.aiGenerator.antigravity.apiKey,
                model: config.aiGenerator.antigravity.model,
                fallbackToSvg: config.aiGenerator.svgFallback.enabled
            };

        case 'gemini_official':
            return {
                type: 'gemini_official',
                apiKey: config.aiGenerator.geminiOfficial.apiKey,
                model: config.aiGenerator.geminiOfficial.model,
                fallbackToSvg: config.aiGenerator.svgFallback.enabled
            };

        case 'svg':
        default:
            return {
                type: 'svg',
                fallbackToSvg: true
            };
    }
}

module.exports = {
    loadConfig,
    saveConfig,
    getConfig,
    updateConfig,
    getActiveGenerator,
    DEFAULT_CONFIG
};
