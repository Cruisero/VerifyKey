require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { verifyBatch, parseVerificationId } = require('./services/sheerid-verifier');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// Self-hosted verification endpoint
app.post('/api/verify', async (req, res) => {
    const { verificationIds, programId = '' } = req.body;

    if (!verificationIds || !Array.isArray(verificationIds) || verificationIds.length === 0) {
        return res.status(400).json({ error: 'verificationIds required' });
    }

    // Max 5 IDs per batch
    if (verificationIds.length > 5) {
        return res.status(400).json({ error: 'Max 5 verification IDs per batch' });
    }

    // Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send start event
    res.write(`event: start\ndata: ${JSON.stringify({
        total: verificationIds.length,
        message: 'Starting verification...'
    })}\n\n`);

    try {
        // Run batch verification with progress updates
        const results = await verifyBatch(verificationIds, {
            onProgress: (progress) => {
                const vid = progress.verificationId ?
                    (parseVerificationId(progress.verificationId) || progress.verificationId) :
                    null;

                // Determine current step for frontend
                let currentStep = progress.step || 'processing';
                if (progress.step === 'success') currentStep = 'success';
                else if (progress.step === 'pending') currentStep = 'pending';

                const eventData = {
                    verificationId: vid,
                    currentStep: currentStep,
                    message: progress.message || '',
                    details: progress.details || null
                };

                res.write(`data: ${JSON.stringify(eventData)}\n\n`);
            }
        });

        // Send final results
        for (const result of results) {
            const currentStep = result.success ?
                (result.status === 'success' ? 'success' : 'pending') :
                'failed';

            res.write(`data: ${JSON.stringify({
                verificationId: result.verificationId,
                currentStep: currentStep,
                message: result.message || result.error || '',
                student: result.student || null,
                email: result.email || null,
                school: result.school || null
            })}\n\n`);
        }

        // Send end event
        res.write(`event: end\ndata: ${JSON.stringify({
            completed: results.length,
            total: verificationIds.length,
            successful: results.filter(r => r.success).length
        })}\n\n`);

    } catch (error) {
        console.error('Verify error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }

    res.end();
});

// Check single verification status
app.post('/api/check-status', async (req, res) => {
    const { verificationId } = req.body;

    if (!verificationId) {
        return res.status(400).json({ error: 'verificationId required' });
    }

    try {
        const vid = parseVerificationId(verificationId);
        if (!vid) {
            return res.status(400).json({ error: 'Invalid verification ID' });
        }

        // Check current status from SheerID
        const response = await fetch(`https://services.sheerid.com/rest/v2/verification/${vid}`);
        const data = await response.json();

        res.json({
            verificationId: vid,
            currentStep: data.currentStep || 'unknown',
            message: data.currentStep === 'success' ? 'Verified!' :
                data.currentStep === 'pending' ? 'Pending review' :
                    data.currentStep
        });

    } catch (error) {
        console.error('Check status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// System status endpoint
app.get('/api/status', (req, res) => {
    const { getActiveGenerator } = require('./utils/config-manager');
    const generator = getActiveGenerator();

    res.json({
        status: 'online',
        mode: 'self-hosted',
        version: '2.0.0',
        aiGenerator: generator.type,
        timestamp: new Date().toISOString()
    });
});

// Get configuration
app.get('/api/config', (req, res) => {
    const { getConfig } = require('./utils/config-manager');
    const config = getConfig();

    // Mask API keys for security
    const safeConfig = JSON.parse(JSON.stringify(config));
    if (safeConfig.aiGenerator?.antigravity?.apiKey) {
        const key = safeConfig.aiGenerator.antigravity.apiKey;
        safeConfig.aiGenerator.antigravity.apiKey = key ? `${key.substring(0, 10)}...` : '';
    }
    if (safeConfig.aiGenerator?.geminiOfficial?.apiKey) {
        const key = safeConfig.aiGenerator.geminiOfficial.apiKey;
        safeConfig.aiGenerator.geminiOfficial.apiKey = key ? `${key.substring(0, 10)}...` : '';
    }

    res.json(safeConfig);
});

// Update configuration
app.post('/api/config', (req, res) => {
    const { updateConfig, getConfig } = require('./utils/config-manager');
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Invalid configuration data' });
    }

    // Preserve existing API keys if not provided in update
    const currentConfig = getConfig();
    if (updates.aiGenerator?.antigravity && !updates.aiGenerator.antigravity.apiKey) {
        updates.aiGenerator.antigravity.apiKey = currentConfig.aiGenerator?.antigravity?.apiKey || '';
    }
    if (updates.aiGenerator?.geminiOfficial && !updates.aiGenerator.geminiOfficial.apiKey) {
        updates.aiGenerator.geminiOfficial.apiKey = currentConfig.aiGenerator?.geminiOfficial?.apiKey || '';
    }

    const result = updateConfig(updates);
    if (result) {
        res.json({ success: true, config: result });
    } else {
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// Test AI generator connection
app.post('/api/config/test', async (req, res) => {
    const { provider, apiBase, apiKey, model } = req.body;

    try {
        if (provider === 'antigravity') {
            // Test Antigravity Tools connection
            const response = await fetch(`${apiBase}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (response.ok) {
                const data = await response.json();
                const models = data.data?.map(m => m.id) || [];
                const hasImageModel = models.some(m => m.includes('image'));
                res.json({
                    success: true,
                    message: `Connected! ${models.length} models available`,
                    hasImageModel
                });
            } else {
                res.json({ success: false, message: `HTTP ${response.status}` });
            }
        } else if (provider === 'gemini_official') {
            // Test Gemini Official API
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
            );

            if (response.ok) {
                const data = await response.json();
                res.json({
                    success: true,
                    message: `Connected! ${data.models?.length || 0} models available`
                });
            } else {
                const error = await response.json();
                res.json({ success: false, message: error.error?.message || `HTTP ${response.status}` });
            }
        } else {
            res.json({ success: true, message: 'SVG generator is always available' });
        }
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 VerifyKey Backend (Self-Hosted) running on http://localhost:${PORT}`);
    console.log(`📋 Mode: Self-hosted SheerID verification`);
    console.log(`🔒 Proxy: ${process.env.PROXY_URL ? 'Configured' : 'Not configured (direct connection)'}`);
});

