require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Store CSRF token (will be fetched from batch.1key.me)
let csrfToken = null;
let csrfTokenTime = 0;
const CSRF_TOKEN_TTL = 5 * 60 * 1000; // 5 minutes

// Fetch CSRF token from batch.1key.me
async function getCsrfToken() {
    const now = Date.now();
    if (csrfToken && (now - csrfTokenTime) < CSRF_TOKEN_TTL) {
        return csrfToken;
    }

    try {
        const response = await fetch('https://batch.1key.me/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });
        const html = await response.text();

        // Extract CSRF token from HTML
        const match = html.match(/window\.CSRF_TOKEN\s*=\s*["']([^"']+)["']/);
        if (match) {
            csrfToken = match[1];
            csrfTokenTime = now;
            console.log('CSRF Token refreshed:', csrfToken.substring(0, 10) + '...');
            return csrfToken;
        }
        throw new Error('CSRF token not found in page');
    } catch (error) {
        console.error('Failed to fetch CSRF token:', error.message);
        throw error;
    }
}

// Verify endpoint
app.post('/api/verify', async (req, res) => {
    const { verificationIds, programId = '' } = req.body;

    if (!verificationIds || !Array.isArray(verificationIds) || verificationIds.length === 0) {
        return res.status(400).json({ error: 'verificationIds required' });
    }

    // Max 5 IDs per batch with API key
    if (verificationIds.length > 5) {
        return res.status(400).json({ error: 'Max 5 verification IDs per batch' });
    }

    try {
        // Get CSRF token
        const token = await getCsrfToken();

        // Set up SSE response to client
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Make request to batch.1key.me
        const response = await fetch('https://batch.1key.me/api/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token,
                'Origin': 'https://batch.1key.me',
                'Referer': 'https://batch.1key.me/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            body: JSON.stringify({
                verificationIds,
                hCaptchaToken: process.env.BATCH_API_KEY,
                useLucky: false,
                programId
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        // Stream the SSE response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
        }

        res.end();

    } catch (error) {
        console.error('Verify error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

// Check status endpoint (for pending verifications)
app.post('/api/check-status', async (req, res) => {
    const { checkToken } = req.body;

    if (!checkToken) {
        return res.status(400).json({ error: 'checkToken required' });
    }

    try {
        const response = await fetch('https://batch.1key.me/api/check-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://batch.1key.me',
                'Referer': 'https://batch.1key.me/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            body: JSON.stringify({ checkToken })
        });

        const data = await response.json();
        res.json(data);

    } catch (error) {
        console.error('Check status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// System status endpoint
app.get('/api/status', async (req, res) => {
    try {
        const response = await fetch('https://batch.1key.me/api/status', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 VerifyKey Backend running on http://localhost:${PORT}`);
    console.log(`📋 API Key configured: ${process.env.BATCH_API_KEY ? 'Yes' : 'No'}`);
});
