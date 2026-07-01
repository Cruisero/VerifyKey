#!/usr/bin/env node
/**
 * Automated Student ID Card Generator
 * 
 * Automatically generates:
 * 1. Random student information (name, ID, DOB, etc.)
 * 2. Student photo using Gemini AI
 * 3. Final ID card with post-processing effects
 * 
 * Usage:
 *   node auto-generate-id.js [options]
 * 
 * Options:
 *   --count=N         Generate N ID cards (default: 1)
 *   --gender=male|female|any  Gender preference (default: any)
 *   --university=NAME University name (default: random)
 *   --output=DIR      Output directory (default: ./output)
 *   --format=jpeg|png Output format (default: jpeg)
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

// ============================================
// DATA GENERATORS
// ============================================

// First names by gender
const FIRST_NAMES = {
    male: [
        'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph',
        'Thomas', 'Christopher', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark',
        'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth', 'Kevin', 'Brian',
        'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan'
    ],
    female: [
        'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan',
        'Jessica', 'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Margaret', 'Sandra',
        'Ashley', 'Kimberly', 'Emily', 'Donna', 'Michelle', 'Dorothy', 'Carol',
        'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia'
    ]
};

// Last names
const LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson'
];

// Universities
const UNIVERSITIES = [
    { name: 'Stanford University', address: '450 Jane Stanford Way, Stanford, CA 94305', phone: '+1 650-723-2300' },
    { name: 'University of California, Los Angeles', address: '405 Hilgard Ave, Los Angeles, CA 90095', phone: '+1 310-825-4321' },
    { name: 'Massachusetts Institute of Technology', address: '77 Massachusetts Ave, Cambridge, MA 02139', phone: '+1 617-253-1000' },
    { name: 'Harvard University', address: 'Cambridge, MA 02138', phone: '+1 617-495-1000' },
    { name: 'Columbia University', address: '116th St & Broadway, New York, NY 10027', phone: '+1 212-854-1754' },
    { name: 'University of Chicago', address: '5801 S Ellis Ave, Chicago, IL 60637', phone: '+1 773-702-1234' },
    { name: 'Yale University', address: 'New Haven, CT 06520', phone: '+1 203-432-4771' },
    { name: 'Princeton University', address: 'Princeton, NJ 08544', phone: '+1 609-258-3000' },
    { name: 'University of Pennsylvania', address: '3451 Walnut St, Philadelphia, PA 19104', phone: '+1 215-898-5000' },
    { name: 'Duke University', address: 'Durham, NC 27708', phone: '+1 919-684-8111' },
    { name: 'Northwestern University', address: '633 Clark St, Evanston, IL 60208', phone: '+1 847-491-3741' },
    { name: 'California Institute of Technology', address: '1200 E California Blvd, Pasadena, CA 91125', phone: '+1 626-395-6811' },
    { name: 'Johns Hopkins University', address: '3400 N Charles St, Baltimore, MD 21218', phone: '+1 410-516-8000' },
    { name: 'Cornell University', address: 'Ithaca, NY 14850', phone: '+1 607-255-2000' },
    { name: 'University of Michigan', address: '500 S State St, Ann Arbor, MI 48109', phone: '+1 734-764-1817' }
];

// Generate random date of birth (age 20-26 for college students)
function generateDOB() {
    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - 20 - Math.floor(Math.random() * 7); // 20-26 years old
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * 28) + 1;

    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    return `${months[month - 1]} ${day}, ${birthYear}`;
}

// Generate student ID
function generateStudentId() {
    const prefix = 20 + Math.floor(Math.random() * 6); // 20-25
    const number = Math.floor(Math.random() * 900000) + 100000;
    return `${prefix}-${number}`;
}

// Generate random student data
function generateStudentData(options = {}) {
    const gender = options.gender === 'any' || !options.gender
        ? (Math.random() > 0.5 ? 'male' : 'female')
        : options.gender;

    const firstName = FIRST_NAMES[gender][Math.floor(Math.random() * FIRST_NAMES[gender].length)];
    const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const university = options.university
        ? UNIVERSITIES.find(u => u.name.includes(options.university)) || UNIVERSITIES[Math.floor(Math.random() * UNIVERSITIES.length)]
        : UNIVERSITIES[Math.floor(Math.random() * UNIVERSITIES.length)];

    return {
        firstName,
        lastName,
        fullName: `${firstName.toUpperCase()} ${lastName.toUpperCase()}`,
        gender,
        dob: generateDOB(),
        studentId: generateStudentId(),
        university: university.name,
        address: university.address,
        phone: university.phone,
        academicYear: (new Date().getFullYear() + 1).toString()
    };
}

// ============================================
// GEMINI PHOTO GENERATION (Official Google API)
// ============================================

async function generatePhotoWithGemini(studentData) {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp-image-generation';

    if (!apiKey) {
        console.log('[Photo] No Gemini API key, using fallback photos');
        return null;
    }

    // Check if it's an official Google key (starts with AIza)
    const isGoogleKey = apiKey.startsWith('AIza');

    const prompt = `Generate a realistic passport-style portrait photo of a ${studentData.gender === 'male' ? 'young man' : 'young woman'} college student, age 20-26.

Requirements:
- Professional headshot style for student ID card
- Plain neutral background (light blue or white)
- Face looking directly at camera with natural friendly smile
- Clean, youthful appearance (college student age 20-26)
- Professional but casual attire (polo shirt or casual blazer)
- High quality, photorealistic image
- Good studio lighting, sharp focus on face
- Natural skin tone and features

Generate ONLY the portrait photo, no text, borders, or decorations.`;

    if (isGoogleKey) {
        // Use official Google Gemini API
        try {
            console.log('[Photo] Generating student photo via Google Gemini API...');

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
                    console.log('[Photo] ✓ Photo generated via Google Gemini API');
                    return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
                }
                console.log('[Photo] No image in response, trying text response...');
            } else {
                const error = await response.json();
                console.log('[Photo] Google API error:', error.error?.message || response.status);
            }
        } catch (error) {
            console.log('[Photo] Google API failed:', error.message);
        }
    } else {
        // Try Antigravity Proxy for non-Google keys
        const apiBase = process.env.GEMINI_API_BASE || 'http://127.0.0.1:8045/v1';
        try {
            console.log(`[Photo] Generating via Antigravity Proxy (${apiBase})...`);

            const response = await fetch(`${apiBase}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gemini-3-pro-image-3x4',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 4096
                })
            });

            if (response.ok) {
                const data = await response.json();
                const content = data.choices?.[0]?.message?.content;
                if (content && content.startsWith('data:image')) {
                    console.log('[Photo] ✓ Photo generated via Antigravity Proxy');
                    return content;
                }
            } else {
                const errorText = await response.text();
                console.log(`[Photo] Proxy error (${response.status}):`, errorText.substring(0, 100));
            }
        } catch (error) {
            console.log('[Photo] Proxy failed:', error.message);
        }
    }

    console.log('[Photo] All Gemini sources failed, will use fallback');
    return null;
}

// Fallback: Get high-quality young person photo
async function getFallbackPhoto(gender) {
    // Use pravatar.cc - provides clean headshots (usually young professionals)
    // We'll try multiple IDs to get variety
    const photoId = Math.floor(Math.random() * 70) + 1; // Random ID 1-70

    try {
        // pravatar.cc provides professional headshots
        const url = `https://i.pravatar.cc/500?img=${photoId}`;
        console.log(`[Photo] Using pravatar.cc headshot (ID: ${photoId})...`);

        // Fetch and convert to base64 for reliable embedding
        const response = await fetch(url);
        if (response.ok) {
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            return `data:${contentType};base64,${base64}`;
        }
    } catch (error) {
        console.log('[Photo] pravatar.cc failed, trying alternative...');
    }

    // Fallback to RandomUser API
    try {
        const genderParam = gender === 'any' ? '' : `&gender=${gender}`;
        const response = await fetch(`https://randomuser.me/api/?inc=picture&nat=us,gb,au,ca,nz${genderParam}`);
        const data = await response.json();
        return data.results[0].picture.large;
    } catch (error) {
        console.error('[Photo] All photo sources failed:', error.message);
        return null;
    }
}

// ============================================
// PUPPETEER ID CARD GENERATION
// ============================================

async function generateIdCard(studentData, photoUrl, options = {}) {
    const templatePath = `file://${path.join(__dirname, '../templates/student-id-generator.html')}`;
    const outputDir = options.outputDir || path.join(__dirname, '../output');
    const format = options.format || 'jpeg';

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('[Card] Launching browser...');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        // Set a very large viewport with high DPI for crisp, high-resolution screenshots
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 4 });

        console.log('[Card] Loading template...');
        await page.goto(templatePath, { waitUntil: 'networkidle0' });

        // Fill in student information
        console.log('[Card] Filling student data...');
        await page.evaluate((data, photo) => {
            // Set form values
            document.getElementById('universityNameInput').value = data.university;
            document.getElementById('nameInput').value = data.fullName;
            document.getElementById('dobInput').value = data.dob;
            document.getElementById('studentIdInput').value = data.studentId;
            document.getElementById('phoneInput').value = data.phone;
            document.getElementById('academicYearInput').value = data.academicYear;
            document.getElementById('addressInput').value = data.address;

            // Trigger input events to update preview
            ['universityNameInput', 'nameInput', 'dobInput', 'studentIdInput', 'phoneInput', 'academicYearInput', 'addressInput'].forEach(id => {
                document.getElementById(id).dispatchEvent(new Event('input', { bubbles: true }));
            });

            // Set photo
            if (photo) {
                document.getElementById('cardStudentPhoto').src = photo;
            }
        }, studentData, photoUrl);

        // Wait for photo to load
        if (photoUrl) {
            await page.waitForFunction(() => {
                const img = document.getElementById('cardStudentPhoto');
                return img.complete && img.naturalHeight !== 0;
            }, { timeout: 10000 }).catch(() => {
                console.log('[Card] Photo load timeout, continuing...');
            });
        }

        // Wait a bit for rendering
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Capture the ID card
        console.log('[Card] Capturing ID card...');
        const cardElement = await page.$('#idCardPreview');

        const timestamp = Date.now();
        const filename = `id_${studentData.firstName.toLowerCase()}_${studentData.lastName.toLowerCase()}_${timestamp}`;
        const outputPath = path.join(outputDir, `${filename}.${format === 'jpeg' ? 'jpg' : 'png'}`);

        // Take high-resolution screenshot (4x scale for crisp image)
        await cardElement.screenshot({
            path: outputPath,
            type: format === 'jpeg' ? 'jpeg' : 'png',
            quality: format === 'jpeg' ? 95 : undefined,
            captureBeyondViewport: true
        });

        console.log(`[Card] ✓ Saved: ${outputPath}`);

        // No post-processing - keep the image clean and high quality
        // Post-processing (noise, blur, etc.) is disabled as per user preference

        return {
            success: true,
            outputPath,
            studentData
        };

    } finally {
        await browser.close();
    }
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
    const args = process.argv.slice(2);

    // Parse arguments
    const options = {
        count: 1,
        gender: 'any',
        university: null,
        outputDir: path.join(__dirname, '../output'),
        format: 'jpeg'
    };

    args.forEach(arg => {
        if (arg.startsWith('--count=')) options.count = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--gender=')) options.gender = arg.split('=')[1];
        if (arg.startsWith('--university=')) options.university = arg.split('=')[1];
        if (arg.startsWith('--output=')) options.outputDir = arg.split('=')[1];
        if (arg.startsWith('--format=')) options.format = arg.split('=')[1];
    });

    console.log('\n🎓 Automated Student ID Card Generator\n');
    console.log('='.repeat(50));
    console.log(`Generating ${options.count} ID card(s)...`);
    console.log(`Gender: ${options.gender}`);
    console.log(`Format: ${options.format}`);
    console.log(`Output: ${options.outputDir}`);
    console.log('='.repeat(50) + '\n');

    const results = [];

    for (let i = 0; i < options.count; i++) {
        console.log(`\n[${i + 1}/${options.count}] Generating ID card...\n`);

        // Generate student data
        const studentData = generateStudentData(options);
        console.log(`   Student: ${studentData.fullName}`);
        console.log(`   University: ${studentData.university}`);
        console.log(`   ID: ${studentData.studentId}`);
        console.log(`   DOB: ${studentData.dob}`);

        // Generate photo
        let photoUrl = await generatePhotoWithGemini(studentData);

        if (!photoUrl) {
            console.log('[Photo] Using fallback photo source...');
            photoUrl = await getFallbackPhoto(studentData.gender);
        }

        // Generate ID card
        try {
            const result = await generateIdCard(studentData, photoUrl, options);
            results.push(result);
        } catch (error) {
            console.error(`[Error] Failed to generate card: ${error.message}`);
            results.push({ success: false, error: error.message, studentData });
        }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('✅ Generation Complete!\n');

    const successful = results.filter(r => r.success).length;
    console.log(`   Generated: ${successful}/${options.count} cards`);
    console.log(`   Output: ${options.outputDir}\n`);

    // List generated files
    if (successful > 0) {
        console.log('Generated files:');
        results.filter(r => r.success).forEach(r => {
            console.log(`   • ${path.basename(r.outputPath)} - ${r.studentData.fullName}`);
        });
    }

    console.log('\nTo open output folder:');
    console.log(`   open ${options.outputDir}\n`);

    return results;
}

// Export for use as module
module.exports = {
    generateStudentData,
    generatePhotoWithGemini,
    getFallbackPhoto,
    generateIdCard,
    UNIVERSITIES
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
