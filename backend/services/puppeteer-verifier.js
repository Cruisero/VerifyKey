/**
 * Puppeteer-based SheerID Verifier
 * Uses headless Chrome with stealth plugin to bypass fraud detection
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());

const { selectUniversity, recordResult } = require('../data/universities');
const {
    generateName,
    generateEmail,
    generateBirthDate,
    randomSleep
} = require('../utils/anti-detect');
const { generateDocument } = require('./document-generator');
const { generateDocumentWithGemini } = require('./gemini-generator');
const config = require('../utils/config');

// SheerID verification URL
const SHEERID_BASE_URL = 'https://services.sheerid.com/verify';
const PROGRAM_ID = '676f6f676c654f6e65'; // Google One Student

/**
 * Puppeteer-based SheerID Verifier Class
 */
class PuppeteerVerifier {
    constructor(verificationId, options = {}) {
        this.vid = verificationId;
        this.proxyUrl = options.proxy || process.env.PROXY_URL || null;
        this.browser = null;
        this.page = null;
        this.university = null;
        this.studentInfo = null;
        this.onProgress = options.onProgress || (() => { });
    }

    /**
     * Initialize browser with stealth settings
     */
    async initBrowser() {
        const launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled'
            ]
        };

        // Add proxy if configured
        if (this.proxyUrl) {
            // Parse proxy URL to extract host:port
            const proxyMatch = this.proxyUrl.match(/@([^:]+:\d+)/);
            if (proxyMatch) {
                launchOptions.args.push(`--proxy-server=${proxyMatch[1]}`);
                console.log(`[Puppeteer] Using proxy: ${proxyMatch[1]}`);
            }
        }

        this.browser = await puppeteer.launch(launchOptions);
        this.page = await this.browser.newPage();

        // Set viewport
        await this.page.setViewport({ width: 1920, height: 1080 });

        // Set realistic user agent
        await this.page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Set extra headers
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br'
        });

        // Handle proxy authentication if needed
        if (this.proxyUrl) {
            const authMatch = this.proxyUrl.match(/\/\/([^:]+):([^@]+)@/);
            if (authMatch) {
                await this.page.authenticate({
                    username: authMatch[1],
                    password: authMatch[2]
                });
                console.log(`[Puppeteer] Proxy authenticated`);
            }
        }

        console.log(`[Puppeteer] Browser initialized`);
    }

    /**
     * Close browser
     */
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }

    /**
     * Run verification using Puppeteer
     */
    async verify() {
        try {
            // Initialize browser
            this.onProgress({ step: 'initializing', message: 'Starting browser...' });
            await this.initBrowser();

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

            // Navigate to verification page
            this.onProgress({ step: 'navigating', message: 'Opening verification page...' });
            const verifyUrl = `${SHEERID_BASE_URL}/${PROGRAM_ID}/?verificationId=${this.vid}`;
            console.log(`[Puppeteer] Navigating to: ${verifyUrl}`);

            await this.page.goto(verifyUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            await randomSleep(2000, 3000);

            // Wait for form to load
            this.onProgress({ step: 'waiting', message: 'Waiting for form...' });

            // Try to find the form fields - SheerID uses various selectors
            const formSelectors = {
                firstName: 'input[name="firstName"], input[id*="firstName"], input[placeholder*="First"]',
                lastName: 'input[name="lastName"], input[id*="lastName"], input[placeholder*="Last"]',
                email: 'input[name="email"], input[type="email"], input[id*="email"]',
                birthDate: 'input[name="birthDate"], input[id*="birthDate"], input[type="date"]',
                organization: 'input[name="organization"], input[id*="organization"], input[placeholder*="school"]'
            };

            // Check if we're on a form page
            const hasForm = await this.page.$(formSelectors.firstName);

            if (!hasForm) {
                // Page might have error or already completed
                const pageContent = await this.page.content();

                if (pageContent.includes('error') || pageContent.includes('Error')) {
                    console.log('[Puppeteer] Error detected on page');
                    recordResult(this.university.name, false);
                    return { success: false, error: 'Verification page error' };
                }

                if (pageContent.includes('success') || pageContent.includes('verified')) {
                    console.log('[Puppeteer] Already verified');
                    return { success: false, error: 'Already verified' };
                }

                console.log('[Puppeteer] Form not found, trying API approach');
                // Fall back to API-based verification
                await this.closeBrowser();
                return { success: false, error: 'Form not found - try API method', fallbackToApi: true };
            }

            // Fill in the form
            this.onProgress({ step: 'filling', message: 'Filling form...' });

            // First name
            await this.page.type(formSelectors.firstName, firstName, { delay: 50 });
            await randomSleep(300, 500);

            // Last name
            await this.page.type(formSelectors.lastName, lastName, { delay: 50 });
            await randomSleep(300, 500);

            // Email
            await this.page.type(formSelectors.email, email, { delay: 50 });
            await randomSleep(300, 500);

            // Birth date (format: YYYY-MM-DD or MM/DD/YYYY depending on locale)
            const birthDateInput = await this.page.$(formSelectors.birthDate);
            if (birthDateInput) {
                await birthDateInput.click();
                await this.page.keyboard.type(birthDate.replace(/-/g, ''));
            }
            await randomSleep(300, 500);

            // Organization/School - use autocomplete
            const orgInput = await this.page.$(formSelectors.organization);
            if (orgInput) {
                await orgInput.type(this.university.name.substring(0, 10), { delay: 100 });
                await randomSleep(1000, 1500);

                // Wait for autocomplete dropdown and select first option
                await this.page.keyboard.press('ArrowDown');
                await this.page.keyboard.press('Enter');
            }
            await randomSleep(500, 1000);

            // Submit form
            this.onProgress({ step: 'submitting', message: 'Submitting form...' });

            // Find and click submit button
            const submitSelectors = [
                'button[type="submit"]',
                'button:contains("Continue")',
                'button:contains("Verify")',
                '.submit-button',
                'input[type="submit"]'
            ];

            for (const selector of submitSelectors) {
                try {
                    const btn = await this.page.$(selector);
                    if (btn) {
                        await btn.click();
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            await randomSleep(3000, 5000);

            // Check result
            const afterSubmitContent = await this.page.content();

            if (afterSubmitContent.includes('fraudRulesReject') || afterSubmitContent.includes('fraud')) {
                recordResult(this.university.name, false);
                return { success: false, error: 'Fraud detection triggered' };
            }

            if (afterSubmitContent.includes('docUpload') || afterSubmitContent.includes('upload')) {
                // Need to upload document
                this.onProgress({ step: 'uploading', message: 'Document upload required...' });

                // Generate document
                const aiConfig = config.get('aiGenerator', {});
                let doc = null;

                if (aiConfig.provider === 'gemini_official' && aiConfig.geminiOfficial?.enabled) {
                    doc = await generateDocumentWithGemini(
                        'transcript',
                        firstName, lastName,
                        this.university.name,
                        birthDate,
                        aiConfig.geminiOfficial
                    );
                }

                if (!doc) {
                    doc = generateDocument('transcript', firstName, lastName, this.university.name, birthDate);
                }

                // Find file input and upload
                const fileInput = await this.page.$('input[type="file"]');
                if (fileInput) {
                    // Save doc to temp file and upload
                    const fs = require('fs');
                    const path = require('path');
                    const tempPath = path.join('/tmp', `doc_${Date.now()}.${doc.mimeType.includes('pdf') ? 'pdf' : 'png'}`);
                    fs.writeFileSync(tempPath, doc.data);

                    await fileInput.uploadFile(tempPath);
                    await randomSleep(2000, 3000);

                    // Clean up
                    fs.unlinkSync(tempPath);
                }

                // Submit upload
                for (const selector of submitSelectors) {
                    try {
                        const btn = await this.page.$(selector);
                        if (btn) {
                            await btn.click();
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                await randomSleep(3000, 5000);
            }

            // Final check
            const finalContent = await this.page.content();
            const success = finalContent.includes('success') ||
                finalContent.includes('pending') ||
                finalContent.includes('review') ||
                finalContent.includes('24-48');

            if (success) {
                recordResult(this.university.name, true);
                this.onProgress({ step: 'success', message: 'Verification submitted!' });

                return {
                    success: true,
                    status: 'pending',
                    message: 'Verification submitted! Wait 24-48 hours for review.',
                    student: `${firstName} ${lastName}`,
                    email,
                    school: this.university.name
                };
            } else {
                recordResult(this.university.name, false);
                return { success: false, error: 'Verification failed', pageSnapshot: finalContent.substring(0, 500) };
            }

        } catch (error) {
            console.error(`[Puppeteer] Error: ${error.message}`);
            if (this.university) {
                recordResult(this.university.name, false);
            }
            return { success: false, error: error.message };
        } finally {
            await this.closeBrowser();
        }
    }
}

/**
 * Verify using Puppeteer
 */
async function verifyWithPuppeteer(verificationId, options = {}) {
    const verifier = new PuppeteerVerifier(verificationId, options);
    return verifier.verify();
}

module.exports = {
    PuppeteerVerifier,
    verifyWithPuppeteer
};
