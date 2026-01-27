#!/usr/bin/env node
/**
 * Student ID Card Generator - Puppeteer HTML Template Renderer
 * 
 * 使用 Puppeteer 渲染 HTML 模板来生成学生证图片
 * 
 * Usage:
 *   node generate-student-id.js [options]
 * 
 * Options:
 *   --name="Student Name"     学生姓名
 *   --university="Name"       大学名称
 *   --id="12345678"          学号
 *   --dob="January 1, 2000"  出生日期
 *   --phone="+1234567890"    电话号码
 *   --address="Address"      地址
 *   --year="2025"            学年
 *   --photo="path/to/photo"  照片路径 (可选，支持本地路径或URL)
 *   --output="output.jpg"    输出文件路径
 *   --format=jpeg|png        输出格式 (默认: jpeg)
 *   --quality=95             JPEG 质量 (1-100, 默认: 95)
 *   --scale=4                截图缩放倍数 (默认: 4)
 * 
 * Example:
 *   node generate-student-id.js --name="John Smith" --university="MIT" --id="20251234" --output="./john_id.jpg"
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

// ============================================
// GEMINI AI PHOTO GENERATION
// ============================================

/**
 * Generate student photo using Gemini AI
 */
async function generatePhotoWithGemini(studentData) {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp-image-generation';

    if (!apiKey) {
        console.log('[Photo] No Gemini API key found, will use fallback');
        return null;
    }

    const gender = studentData.gender || 'any';
    const genderDesc = gender === 'male' ? 'young man' : gender === 'female' ? 'young woman' : 'young person';

    const prompt = `Generate a realistic ID photo headshot of a ${genderDesc} college student, age 18-24.

Requirements:
- Plain solid color background (light blue, light gray, or white)
- Headshot from shoulders up, face centered
- Natural relaxed expression, slight casual smile (not too formal or stiff)
- Looking directly at camera
- Casual student attire visible at shoulders (t-shirt collar or casual shirt)
- Natural lighting like a quick photo booth shot
- Realistic skin texture with minor natural imperfections
- Slightly imperfect framing (not perfectly centered, natural feel)
- Young college student appearance (18-24 years old)
- NOT overly polished or retouched

Style: casual ID photo, like taken at university registration desk.
Generate ONLY the portrait photo, no text, borders, or decorations.`;

    try {
        console.log('[Photo] Generating student photo via Gemini AI...');

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseModalities: ["image", "text"]
                    }
                })
            }
        );

        if (response.ok) {
            const data = await response.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

            if (imagePart) {
                console.log('[Photo] ✓ Photo generated via Gemini AI');
                return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            }
            console.log('[Photo] No image in Gemini response');
        } else {
            const error = await response.json();
            console.log('[Photo] Gemini API error:', error.error?.message || response.status);
        }
    } catch (error) {
        console.log('[Photo] Gemini API failed:', error.message);
    }

    return null;
}

/**
 * Generate university logo/emblem using Gemini AI
 */
async function generateLogoWithGemini(universityName) {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp-image-generation';

    if (!apiKey) {
        console.log('[Logo] No Gemini API key found, will use fallback');
        return null;
    }

    // Extract key words from university name for the prompt
    const shortName = universityName.replace(/University|College|Institute|of|the/gi, '').trim();

    const prompt = `Generate a simple, clean university emblem/logo icon for "${universityName}".

Requirements:
- Circular or shield-shaped emblem design
- Professional academic style
- Simple iconic design (2-3 colors maximum)
- Include stylized imagery like: book, torch, laurel wreath, or academic symbols
- Clean lines, suitable for small display size
- NO text or letters in the design
- Solid background that contrasts with the design
- Classic university emblem aesthetic
- Flat design style, not 3D

Style: minimalist academic emblem icon.
Generate ONLY the logo icon, no text, no university name.`;

    try {
        console.log('[Logo] Generating university logo via Gemini AI...');

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseModalities: ["image", "text"]
                    }
                })
            }
        );

        if (response.ok) {
            const data = await response.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

            if (imagePart) {
                console.log('[Logo] ✓ Logo generated via Gemini AI');
                return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            }
            console.log('[Logo] No image in Gemini response');
        } else {
            const error = await response.json();
            console.log('[Logo] Gemini API error:', error.error?.message || response.status);
        }
    } catch (error) {
        console.log('[Logo] Gemini API failed:', error.message);
    }

    return null;
}

/**
 * Get fallback photo from various sources
 */
async function getFallbackPhoto(gender = 'any') {
    // Try pravatar.cc first (clean professional headshots)
    const photoId = Math.floor(Math.random() * 70) + 1;

    try {
        console.log('[Photo] Using fallback source (pravatar.cc)...');
        const url = `https://i.pravatar.cc/500?img=${photoId}`;
        const response = await fetch(url);

        if (response.ok) {
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            console.log('[Photo] ✓ Photo loaded from pravatar.cc');
            return `data:${contentType};base64,${base64}`;
        }
    } catch (error) {
        console.log('[Photo] pravatar.cc failed, trying RandomUser...');
    }

    // Fallback to RandomUser API
    try {
        const genderParam = gender === 'any' ? '' : `&gender=${gender}`;
        const response = await fetch(`https://randomuser.me/api/?inc=picture&nat=us,gb,au,ca${genderParam}`);
        const data = await response.json();
        const imageUrl = data.results[0].picture.large;

        // Convert to base64
        const imgResponse = await fetch(imageUrl);
        const buffer = await imgResponse.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        console.log('[Photo] ✓ Photo loaded from RandomUser');
        return `data:image/jpeg;base64,${base64}`;
    } catch (error) {
        console.error('[Photo] All photo sources failed:', error.message);
        return null;
    }
}

// ============================================
// CONFIGURATION
// ============================================

const DEFAULT_CONFIG = {
    template: path.join(__dirname, '../templates/student-id-generator.html'),
    outputDir: path.join(__dirname, '../output'),
    format: 'jpeg',
    quality: 95,
    scale: 4,
    viewport: { width: 1920, height: 1080 }
};

// Default student data
const DEFAULT_STUDENT = {
    name: 'JOHN SMITH',
    university: 'Massachusetts Institute of Technology',
    studentId: '20-251234',
    dob: 'March 15, 2002',
    phone: '+1 617-253-1000',
    address: '77 Massachusetts Ave, Cambridge, MA 02139',
    academicYear: '2026',
    photo: null
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse command line arguments
 */
function parseArgs(argv) {
    const args = {};
    argv.slice(2).forEach(arg => {
        const match = arg.match(/^--([^=]+)=(.*)$/);
        if (match) {
            args[match[1]] = match[2];
        } else if (arg.startsWith('--')) {
            args[arg.slice(2)] = true;
        }
    });
    return args;
}

/**
 * Convert local file path to base64 data URL
 */
async function fileToBase64(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Photo file not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';

    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/**
 * Prepare photo URL (handles local files and URLs)
 */
async function preparePhotoUrl(photoPath) {
    if (!photoPath) {
        return null;
    }

    // If it's already a data URL or http(s) URL, return as-is
    if (photoPath.startsWith('data:') || photoPath.startsWith('http://') || photoPath.startsWith('https://')) {
        return photoPath;
    }

    // Convert local file to base64
    const absolutePath = path.isAbsolute(photoPath) ? photoPath : path.resolve(process.cwd(), photoPath);
    return await fileToBase64(absolutePath);
}

/**
 * Ensure output directory exists
 */
function ensureOutputDir(outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ============================================
// MAIN GENERATOR CLASS
// ============================================

class StudentIdGenerator {
    constructor(options = {}) {
        this.config = { ...DEFAULT_CONFIG, ...options };
        this.browser = null;
    }

    /**
     * Initialize browser
     */
    async init() {
        if (!this.browser) {
            console.log('[Generator] Launching browser...');
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }
        return this;
    }

    /**
     * Close browser
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    /**
     * Generate student ID card image
     * 
     * @param {Object} studentData - Student information
     * @param {string} studentData.name - Student name
     * @param {string} studentData.university - University name
     * @param {string} studentData.studentId - Student ID number
     * @param {string} studentData.dob - Date of birth
     * @param {string} studentData.phone - Phone number
     * @param {string} studentData.address - Address
     * @param {string} studentData.academicYear - Academic year
     * @param {string} studentData.photo - Photo path or URL (optional)
     * @param {Object} options - Generation options
     * @param {string} options.output - Output file path
     * @param {string} options.format - Output format (jpeg/png)
     * @param {number} options.quality - JPEG quality (1-100)
     * @param {number} options.scale - Screenshot scale factor
     * @returns {Object} Result with success status and output path
     */
    async generate(studentData, options = {}) {
        const data = { ...DEFAULT_STUDENT, ...studentData };
        const config = { ...this.config, ...options };

        // Determine output path
        let outputPath = options.output;
        if (!outputPath) {
            const timestamp = Date.now();
            const safeName = data.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            outputPath = path.join(config.outputDir, `id_${safeName}_${timestamp}.${config.format === 'png' ? 'png' : 'jpg'}`);
        }

        // Ensure output directory exists
        ensureOutputDir(outputPath);

        // Initialize browser if needed
        await this.init();

        const page = await this.browser.newPage();

        try {
            // Set viewport with high DPI
            await page.setViewport({
                width: config.viewport.width,
                height: config.viewport.height,
                deviceScaleFactor: config.scale
            });

            // Load template
            console.log('[Generator] Loading HTML template...');
            console.log(`[Generator] Template path: ${config.template}`);
            const templateUrl = `file://${config.template}`;
            await page.goto(templateUrl, { waitUntil: 'networkidle0' });

            // Prepare photo URL - auto-generate if not provided
            let photoUrl = await preparePhotoUrl(data.photo);

            if (!photoUrl) {
                // Auto-generate photo using Gemini AI
                console.log('[Generator] No photo provided, generating with AI...');
                photoUrl = await generatePhotoWithGemini(data);

                // Fallback if Gemini fails
                if (!photoUrl) {
                    photoUrl = await getFallbackPhoto(data.gender || 'any');
                }
            }

            // Fill in student information based on template type
            console.log('[Generator] Filling student data...');

            // Detect template type and fill accordingly
            const templateType = await page.evaluate(() => {
                // Detect template by checking for specific elements
                if (document.getElementById('receiptPreview')) return 'fee-receipt';
                if (document.getElementById('idCardPreview')) return 'student-id';
                return 'unknown';
            });

            console.log(`[Generator] Detected template type: ${templateType}`);

            if (templateType === 'fee-receipt') {
                // Generate university logo for fee receipt
                console.log('[Generator] Generating university logo for fee receipt...');
                let logoUrl = await generateLogoWithGemini(data.university);

                // Fill fee receipt template with logo
                await page.evaluate((studentData, logo) => {
                    // Helper to safely set element text
                    const setTextById = (id, text) => {
                        const el = document.getElementById(id);
                        if (el) el.textContent = text;
                    };

                    // Banks and payment types by country
                    const BANKS_BY_COUNTRY = {
                        'US': ['Bank of America', 'Chase', 'Wells Fargo', 'Citibank', 'US Bank', 'Capital One'],
                        'CA': ['TD Bank', 'RBC', 'Scotiabank', 'BMO', 'CIBC'],
                        'AU': ['Commonwealth Bank', 'ANZ', 'Westpac', 'NAB'],
                        'UK': ['Barclays', 'HSBC', 'Lloyds Bank', 'NatWest', 'Santander UK'],
                        'DE': ['Deutsche Bank', 'Commerzbank', 'DZ Bank'],
                        'FR': ['BNP Paribas', 'Crédit Agricole', 'Société Générale'],
                        'IT': ['Intesa Sanpaolo', 'UniCredit', 'Banco BPM'],
                        'ES': ['Santander', 'BBVA', 'CaixaBank'],
                        'NL': ['ING Bank', 'ABN AMRO', 'Rabobank'],
                        'CH': ['UBS', 'Credit Suisse', 'Julius Baer'],
                        'SG': ['DBS Bank', 'OCBC', 'UOB'],
                        'MY': ['Maybank', 'CIMB', 'Public Bank'],
                        'TH': ['Bangkok Bank', 'Kasikornbank', 'Siam Commercial Bank'],
                        'VN': ['Vietcombank', 'BIDV', 'VietinBank'],
                        'PH': ['BDO', 'BPI', 'Metrobank'],
                        'PK': ['HBL', 'UBL', 'MCB Bank', 'Allied Bank'],
                        'BD': ['Islami Bank', 'Dutch-Bangla Bank', 'BRAC Bank'],
                        'NG': ['First Bank', 'Zenith Bank', 'GTBank', 'UBA'],
                        'ZA': ['Standard Bank', 'ABSA', 'Nedbank', 'FNB'],
                        'AR': ['Banco Nación', 'Banco Galicia', 'Santander Argentina'],
                        'BR': ['Itaú', 'Banco do Brasil', 'Bradesco'],
                        'MX': ['BBVA México', 'Banorte', 'Citibanamex'],
                        'IN': ['SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank'],
                        'DEFAULT': ['International Bank', 'National Bank', 'State Bank', 'Commercial Bank']
                    };

                    const CURRENCY_BY_COUNTRY = {
                        'US': 'USD', 'CA': 'CAD', 'AU': 'AUD', 'UK': 'GBP', 'GB': 'GBP',
                        'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR', 'NL': 'EUR', 'AT': 'EUR', 'BE': 'EUR', 'FI': 'EUR', 'PT': 'EUR', 'GR': 'EUR',
                        'CH': 'CHF', 'SG': 'SGD', 'MY': 'MYR', 'TH': 'THB', 'VN': 'VND', 'PH': 'PHP',
                        'PK': 'PKR', 'BD': 'BDT', 'NG': 'NGN', 'ZA': 'ZAR', 'KE': 'KES', 'GH': 'GHS',
                        'AR': 'ARS', 'BR': 'BRL', 'MX': 'MXN', 'CL': 'CLP', 'PE': 'PEN', 'CO': 'COP',
                        'IN': 'INR', 'TW': 'TWD', 'TR': 'TRY', 'PL': 'PLN', 'CZ': 'CZK', 'HU': 'HUF',
                        'SE': 'SEK', 'DK': 'DKK', 'NO': 'NOK', 'RO': 'RON', 'UA': 'UAH',
                        'IL': 'ILS', 'AE': 'AED', 'JO': 'JOD', 'IQ': 'IQD', 'MA': 'MAD',
                        'LK': 'LKR', 'RW': 'RWF', 'ZW': 'USD', 'VE': 'VES',
                        'DEFAULT': 'USD'
                    };

                    // Get country from university name or default
                    const getCountryFromUniversity = (uniName) => {
                        // Check specific countries FIRST (before generic patterns)
                        const specificPatterns = [
                            ['CA', /canada|toronto|mcgill|british columbia|waterloo|montreal|ottawa|alberta|queens/i],
                            ['AU', /australia|sydney|melbourne|queensland|unsw|anu|monash/i],
                            ['UK', /uk|britain|england|oxford|cambridge|london|manchester|edinburgh|imperial/i],
                            ['DE', /germany|german|berlin|munich|heidelberg|tuw|tu |technische/i],
                            ['FR', /france|french|paris|sorbonne|polytechnique|lyon|marseille/i],
                            ['IT', /italy|italian|milan|roma|bologna|polimi|torino/i],
                            ['ES', /spain|spanish|madrid|barcelona|valencia|sevilla/i],
                            ['NL', /netherlands|dutch|amsterdam|delft|leiden|rotterdam|utrecht/i],
                            ['CH', /switzerland|swiss|zurich|eth|epfl|geneva|bern/i],
                            ['SG', /singapore|nus|nanyang/i],
                            ['MY', /malaysia|malaya|ukm|usm|utm/i],
                            ['TH', /thailand|thai|chulalongkorn|mahidol|kasetsart|bangkok/i],
                            ['VN', /vietnam|vietnamese|hanoi|ho chi minh|hcm/i],
                            ['PH', /philippines|filipino|ateneo|la salle|manila/i],
                            ['PK', /pakistan|lahore|karachi|islamabad|nust|lums/i],
                            ['BD', /bangladesh|dhaka|buet|chittagong/i],
                            ['NG', /nigeria|lagos|ibadan|abuja/i],
                            ['ZA', /south africa|cape town|wits|stellenbosch|johannesburg/i],
                            ['AR', /argentina|buenos aires|cordoba|rosario/i],
                            ['IN', /india|delhi|mumbai|bangalore|iit|iim|chennai|kolkata/i],
                            ['TW', /taiwan|taipei|national taiwan|nthu|nctu/i],
                            ['TR', /turkey|turkish|istanbul|ankara|boğaziçi/i],
                            ['JP', /japan|japanese|tokyo|kyoto|osaka|waseda|keio/i],
                            ['KR', /korea|korean|seoul|yonsei|kaist/i],
                            ['CN', /china|chinese|beijing|shanghai|tsinghua|peking|fudan/i],
                            ['BR', /brazil|brazilian|são paulo|rio|usp|unicamp/i],
                            ['MX', /mexico|mexican|unam|monterrey/i],
                        ];

                        for (const [country, pattern] of specificPatterns) {
                            if (pattern.test(uniName)) return country;
                        }

                        // Default patterns for US (only if no specific match)
                        const usPattern = /america|usa|united states|california|texas|new york|florida|michigan|ohio|penn|harvard|yale|stanford|mit|columbia|cornell|princeton|duke|ucla|berkeley|arizona|illinois|washington|georgia tech|carnegie/i;
                        if (usPattern.test(uniName)) return 'US';

                        return 'US'; // Default to US
                    };

                    const country = getCountryFromUniversity(studentData.university);
                    const banks = BANKS_BY_COUNTRY[country] || BANKS_BY_COUNTRY['DEFAULT'];
                    const currency = CURRENCY_BY_COUNTRY[country] || CURRENCY_BY_COUNTRY['DEFAULT'];
                    const bank = banks[Math.floor(Math.random() * banks.length)];

                    // Generate receipt-specific data
                    const now = new Date();
                    const regDate = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getFullYear()).slice(-2)}`;
                    const amount = 10000 + Math.floor(Math.random() * 89999);
                    const studentRoll = Math.floor(Math.random() * 900) + 100;
                    const centre = 10000 + Math.floor(Math.random() * 90000);
                    const instrumentNo = 100000 + Math.floor(Math.random() * 900000);

                    // Number to words converter
                    const numberToWords = (num) => {
                        const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
                            'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
                        const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

                        if (num === 0) return 'Zero';
                        if (num < 20) return ones[num];
                        if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
                        if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + numberToWords(num % 100) : '');
                        if (num < 100000) return numberToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + numberToWords(num % 1000) : '');
                        return num.toString();
                    };

                    // Set card elements directly
                    setTextById('cardUniversityName', studentData.university);
                    setTextById('cardName', studentData.name);
                    setTextById('cardStudentRoll', studentRoll.toString());
                    setTextById('cardCentre', centre.toString());
                    setTextById('cardRegDate', regDate);
                    setTextById('cardInstrumentNo', instrumentNo.toString());
                    setTextById('cardInstrumentDate', regDate);
                    setTextById('cardPaymentType', currency);
                    setTextById('cardBank', bank);
                    setTextById('cardAmount', amount.toString());
                    setTextById('cardAmountWords', amount.toString());
                    setTextById('cardAmountText', numberToWords(amount));
                    setTextById('cardAddress', studentData.address || 'Uttara Town University College, 1st Floor, House Building, Plot 1 Road-2, Dhaka 1230');
                    setTextById('cardYear', new Date().getFullYear().toString());

                    // Set logo if provided
                    if (logo) {
                        const logoImg = document.getElementById('cardLogo');
                        const logoEmoji = document.getElementById('cardLogoEmoji');
                        if (logoImg && logoEmoji) {
                            logoImg.src = logo;
                            logoImg.style.display = 'block';
                            logoEmoji.style.display = 'none';
                        }
                    }
                }, data, logoUrl);

                // Wait for logo to load if we have one
                if (logoUrl) {
                    console.log('[Generator] Waiting for logo to load...');
                    await page.waitForFunction(() => {
                        const img = document.getElementById('cardLogo');
                        return img && img.complete && img.naturalHeight !== 0;
                    }, { timeout: 10000 }).catch(() => {
                        console.log('[Generator] Logo load timeout, continuing...');
                    });
                }
            } else {
                // Fill student ID card template (default)
                await page.evaluate((studentData, photo) => {
                    // Helper to safely set element
                    const setById = (id, value) => {
                        const el = document.getElementById(id);
                        if (el) {
                            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                                el.value = value;
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                            } else {
                                el.textContent = value;
                            }
                        }
                    };

                    // Set form values
                    setById('universityNameInput', studentData.university);
                    setById('nameInput', studentData.name);
                    setById('dobInput', studentData.dob);
                    setById('studentIdInput', studentData.studentId);
                    setById('phoneInput', studentData.phone);
                    setById('academicYearInput', studentData.academicYear);
                    setById('addressInput', studentData.address);

                    // Set card element text content directly
                    setById('cardUniversityName', studentData.university);
                    setById('cardName', studentData.name);
                    setById('cardDob', studentData.dob);
                    setById('cardStudentId', studentData.studentId);
                    setById('cardPhone', studentData.phone);
                    setById('cardAddress', studentData.address);
                    setById('cardAcademicYear', studentData.academicYear);

                    // Set photo if provided
                    if (photo) {
                        const photoEl = document.getElementById('cardStudentPhoto');
                        if (photoEl) photoEl.src = photo;
                    }
                }, data, photoUrl);
            }

            // Wait for photo to load (only for student ID templates)
            if (photoUrl && templateType !== 'fee-receipt') {
                console.log('[Generator] Waiting for photo to load...');
                await page.waitForFunction(() => {
                    const img = document.getElementById('cardStudentPhoto');
                    return img && img.complete && img.naturalHeight !== 0;
                }, { timeout: 10000 }).catch(() => {
                    console.log('[Generator] Photo load timeout, continuing...');
                });
            }

            // Wait for rendering
            await new Promise(resolve => setTimeout(resolve, 500));

            // Capture the document element based on template type
            console.log('[Generator] Capturing screenshot...');

            // Select the correct element based on template type
            const previewSelector = templateType === 'fee-receipt' ? '#receiptPreview' : '#idCardPreview';
            const cardElement = await page.$(previewSelector);

            if (!cardElement) {
                throw new Error(`Could not find preview element (${previewSelector})`);
            }

            // Take screenshot
            await cardElement.screenshot({
                path: outputPath,
                type: config.format === 'png' ? 'png' : 'jpeg',
                quality: config.format === 'png' ? undefined : config.quality,
                captureBeyondViewport: true
            });

            console.log(`[Generator] ✓ Saved: ${outputPath}`);

            return {
                success: true,
                outputPath,
                studentData: data
            };

        } catch (error) {
            console.error(`[Generator] Error: ${error.message}`);
            return {
                success: false,
                error: error.message,
                studentData: data
            };
        } finally {
            await page.close();
        }
    }

    /**
     * Generate multiple ID cards
     * 
     * @param {Array} studentsData - Array of student data objects
     * @param {Object} options - Generation options
     * @returns {Array} Array of results
     */
    async generateBatch(studentsData, options = {}) {
        const results = [];

        for (let i = 0; i < studentsData.length; i++) {
            console.log(`\n[${i + 1}/${studentsData.length}] Generating ID card...`);
            const result = await this.generate(studentsData[i], options);
            results.push(result);
        }

        return results;
    }
}

// ============================================
// CLI INTERFACE
// ============================================

async function main() {
    const args = parseArgs(process.argv);

    // Check for help
    if (args.help || args.h) {
        console.log(`
🎓 Student ID Card Generator - Puppeteer HTML Template Renderer

Usage:
  node generate-student-id.js [options]

Options:
  --name="Student Name"     学生姓名
  --university="Name"       大学名称
  --id="12345678"          学号
  --dob="January 1, 2000"  出生日期
  --phone="+1234567890"    电话号码
  --address="Address"      地址
  --year="2025"            学年
  --photo="path/to/photo"  照片路径 (支持本地路径或URL)
  --output="output.jpg"    输出文件路径
  --format=jpeg|png        输出格式 (默认: jpeg)
  --quality=95             JPEG 质量 (1-100, 默认: 95)
  --scale=4                截图缩放倍数 (默认: 4)
  --help                   显示帮助信息

Examples:
  # Basic usage
  node generate-student-id.js --name="John Smith" --output="./john_id.jpg"

  # Full example
  node generate-student-id.js \\
    --name="Emily Johnson" \\
    --university="Stanford University" \\
    --id="20-251234" \\
    --dob="March 15, 2002" \\
    --phone="+1 650-723-2300" \\
    --address="450 Jane Stanford Way, Stanford, CA 94305" \\
    --year="2026" \\
    --photo="./photo.jpg" \\
    --output="./emily_id.jpg" \\
    --format=jpeg \\
    --quality=95
`);
        return;
    }

    console.log('\n🎓 Student ID Card Generator\n');
    console.log('='.repeat(50));

    // Build student data from arguments
    const studentData = {
        name: args.name || DEFAULT_STUDENT.name,
        university: args.university || DEFAULT_STUDENT.university,
        studentId: args.id || DEFAULT_STUDENT.studentId,
        dob: args.dob || DEFAULT_STUDENT.dob,
        phone: args.phone || DEFAULT_STUDENT.phone,
        address: args.address || DEFAULT_STUDENT.address,
        academicYear: args.year || DEFAULT_STUDENT.academicYear,
        photo: args.photo || null
    };

    const options = {
        output: args.output,
        format: args.format || 'jpeg',
        quality: parseInt(args.quality) || 95,
        scale: parseInt(args.scale) || 4
    };

    // Handle custom template
    if (args.template) {
        // Check multiple possible template directories
        const possibleDirs = [
            '/templates',                              // Docker: /templates/
            path.join(__dirname, '../templates')       // Local: ../templates/
        ];

        let templateFound = false;
        for (const dir of possibleDirs) {
            const templatePath = path.join(dir, args.template);
            if (fs.existsSync(templatePath)) {
                options.template = templatePath;
                console.log(`[Generator] Using custom template: ${args.template}`);
                console.log(`[Generator] Template path: ${templatePath}`);
                templateFound = true;
                break;
            }
        }

        if (!templateFound) {
            console.log(`[Generator] Warning: Template ${args.template} not found in any directory, using default`);
        }
    }

    console.log(`Student: ${studentData.name}`);
    console.log(`University: ${studentData.university}`);
    console.log(`ID: ${studentData.studentId}`);
    console.log(`Format: ${options.format.toUpperCase()}`);
    console.log(`Quality: ${options.quality}%`);
    console.log('='.repeat(50) + '\n');

    // Generate
    const generator = new StudentIdGenerator();

    try {
        const result = await generator.generate(studentData, options);

        if (result.success) {
            console.log('\n' + '='.repeat(50));
            console.log('✅ Generation Complete!\n');
            console.log(`Output: ${result.outputPath}\n`);
            console.log('To open the file:');
            console.log(`   open "${result.outputPath}"\n`);
        } else {
            console.error('\n❌ Generation Failed');
            console.error(`Error: ${result.error}\n`);
            process.exit(1);
        }
    } finally {
        await generator.close();
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    StudentIdGenerator,
    DEFAULT_CONFIG,
    DEFAULT_STUDENT,
    parseArgs,
    fileToBase64,
    preparePhotoUrl
};

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
