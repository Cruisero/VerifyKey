/**
 * Gemini AI Document Generator via Antigravity Tools Proxy
 * Uses OpenAI-compatible API to generate realistic student documents
 */

const { randomInt, randomChoice } = require('../utils/anti-detect');

// Antigravity Tools API configuration (OpenAI-compatible)
const DEFAULT_API_BASE = 'http://127.0.0.1:8045/v1';
const IMAGE_MODEL = 'gemini-3-pro-image';

/**
 * Call Antigravity Tools API for image generation
 */
async function generateImageWithAPI(prompt, apiKey, apiBase = DEFAULT_API_BASE) {
    try {
        const response = await fetch(`${apiBase}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: IMAGE_MODEL,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                // Use 4:3 aspect ratio for documents
                size: '1216x896'
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Antigravity API] Error:', response.status, errorText);
            return null;
        }

        const data = await response.json();

        // Extract image from OpenAI-format response
        if (data.choices && data.choices[0]?.message?.content) {
            const content = data.choices[0].message.content;

            // Check if content is base64 image data
            if (content.startsWith('data:image')) {
                const matches = content.match(/^data:image\/(\w+);base64,(.+)$/);
                if (matches) {
                    return {
                        mimeType: `image/${matches[1]}`,
                        base64: matches[2],
                        data: Buffer.from(matches[2], 'base64')
                    };
                }
            }

            // Check if content is a URL
            if (content.startsWith('http')) {
                // Download the image
                const imgResponse = await fetch(content);
                if (imgResponse.ok) {
                    const arrayBuffer = await imgResponse.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const contentType = imgResponse.headers.get('content-type') || 'image/png';
                    return {
                        mimeType: contentType,
                        base64: buffer.toString('base64'),
                        data: buffer
                    };
                }
            }

            // Try to parse as JSON (some APIs return structured data)
            try {
                const parsed = JSON.parse(content);
                if (parsed.image || parsed.url || parsed.data) {
                    const imgUrl = parsed.image || parsed.url;
                    const imgData = parsed.data;

                    if (imgData) {
                        return {
                            mimeType: 'image/png',
                            base64: imgData,
                            data: Buffer.from(imgData, 'base64')
                        };
                    }

                    if (imgUrl) {
                        const imgResponse = await fetch(imgUrl);
                        if (imgResponse.ok) {
                            const arrayBuffer = await imgResponse.arrayBuffer();
                            const buffer = Buffer.from(arrayBuffer);
                            return {
                                mimeType: imgResponse.headers.get('content-type') || 'image/png',
                                base64: buffer.toString('base64'),
                                data: buffer
                            };
                        }
                    }
                }
            } catch {
                // Not JSON, continue
            }

            console.log('[Antigravity API] Unexpected response format:', content.substring(0, 100));
        }

        console.error('[Antigravity API] No image in response');
        return null;

    } catch (error) {
        console.error('[Antigravity API] Request failed:', error.message);
        return null;
    }
}

/**
 * Call Google Gemini Official API directly for image generation
 */
async function generateImageWithGoogleGemini(prompt, apiKey, model = 'gemini-2.0-flash-exp-image-generation') {
    if (!apiKey) {
        console.log('[Gemini Official] No API key provided');
        return null;
    }

    try {
        console.log(`[Gemini Official] Calling Google API with model: ${model}`);

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

        if (!response.ok) {
            const error = await response.json();
            console.error('[Gemini Official] API Error:', error.error?.message || `HTTP ${response.status}`);
            return null;
        }

        const data = await response.json();

        // Extract image from response
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

        if (imagePart) {
            const imageData = Buffer.from(imagePart.inlineData.data, 'base64');
            console.log(`[Gemini Official] Got image: ${imageData.length} bytes`);
            return {
                mimeType: imagePart.inlineData.mimeType,
                base64: imagePart.inlineData.data,
                data: imageData
            };
        }

        console.log('[Gemini Official] No image in response');
        return null;

    } catch (error) {
        console.error('[Gemini Official] Request failed:', error.message);
        return null;
    }
}

/**
 * Generate student ID card using Antigravity Tools API
 */
async function generateStudentIdWithGemini(firstName, lastName, universityName, apiKey, apiBase) {
    const studentId = `${randomInt(21, 25)}${randomInt(100000, 999999)}`;
    const validThru = `08/${randomInt(2025, 2027)}`;

    const prompt = `Generate a realistic university student ID card image with these exact details:

UNIVERSITY: ${universityName}
STUDENT NAME: ${firstName} ${lastName}
STUDENT ID: ${studentId}
VALID THROUGH: ${validThru}

Requirements:
- Official university ID card design
- University logo/seal at top
- Photo ID placeholder on left side
- Student name and ID number clearly visible
- Barcode at bottom
- Professional colors matching real university IDs
- Looks like a real scanned/photographed ID card
- High quality, realistic appearance

Do NOT include any text explaining the image, ONLY generate the ID card image.`;

    const result = await generateImageWithAPI(prompt, apiKey, apiBase);

    if (result) {
        return {
            ...result,
            type: 'id_card',
            fileName: 'student_id.png',
            studentId: studentId,
            generatedBy: 'antigravity-gemini'
        };
    }

    return null;
}

/**
 * Generate academic transcript using Antigravity Tools API
 */
async function generateTranscriptWithGemini(firstName, lastName, universityName, birthDate, apiKey, apiBase) {
    const studentId = `${randomInt(21, 25)}${randomInt(100000, 999999)}`;
    const gpa = (3.2 + Math.random() * 0.8).toFixed(2);

    // Generate random courses
    const courses = [
        'Introduction to Computer Science - A',
        'Calculus I - A-',
        'English Composition - B+',
        'Physics I - A',
        'Chemistry I - B+',
        'Statistics - A-',
        'Data Structures - A',
        'Linear Algebra - B+'
    ];
    const selectedCourses = courses.slice(0, randomInt(6, 8)).join('\n');

    const prompt = `Generate a realistic university academic transcript document image with these exact details:

UNIVERSITY: ${universityName}
STUDENT NAME: ${firstName} ${lastName}
STUDENT ID: ${studentId}
DATE OF BIRTH: ${birthDate}
CUMULATIVE GPA: ${gpa}

COURSES:
${selectedCourses}

Requirements:
- Official academic transcript format
- University letterhead with logo at top
- "OFFICIAL ACADEMIC TRANSCRIPT" title
- Student information section
- Course listing in table format
- GPA summary
- Looks like a real scanned official document
- Professional formatting
- Watermark or seal optional

Do NOT include any text explaining the image, ONLY generate the transcript image.`;

    const result = await generateImageWithAPI(prompt, apiKey, apiBase);

    if (result) {
        return {
            ...result,
            type: 'transcript',
            fileName: 'transcript.png',
            studentId: studentId,
            gpa: gpa,
            generatedBy: 'antigravity-gemini'
        };
    }

    return null;
}

/**
 * Main function to generate document
 * Priority: Google Gemini Official > Antigravity Proxy > SVG Fallback
 */
async function generateDocumentWithGemini(type, firstName, lastName, universityName, birthDate, config = {}) {
    // Get API configuration
    const geminiKey = config.apiKey || process.env.GEMINI_API_KEY;
    const geminiModel = config.model || 'gemini-2.0-flash-exp-image-generation';
    const antigravityBase = process.env.GEMINI_API_BASE || DEFAULT_API_BASE;

    // Randomly choose document type if 'auto'
    const docType = type === 'auto' ? (Math.random() < 0.6 ? 'transcript' : 'id_card') : type;

    console.log(`[DocGenerator] Generating ${docType} for ${firstName} ${lastName} at ${universityName}`);

    // Build prompt based on document type
    const studentId = `${randomInt(21, 25)}${randomInt(100000, 999999)}`;
    const gpa = (3.2 + Math.random() * 0.8).toFixed(2);

    let prompt;
    if (docType === 'transcript') {
        const courses = [
            'Introduction to Computer Science - A',
            'Calculus I - A-',
            'English Composition - B+',
            'Physics I - A',
            'Chemistry I - B+',
            'Statistics - A-'
        ].join('\\n');

        prompt = `Generate a realistic university academic transcript document image:

UNIVERSITY: ${universityName}
STUDENT NAME: ${firstName} ${lastName}
STUDENT ID: ${studentId}
DATE OF BIRTH: ${birthDate}
CUMULATIVE GPA: ${gpa}

Requirements:
- Official academic transcript format with university letterhead
- Course listing with grades
- Looks like a real scanned official document
- Professional formatting

Generate ONLY the image, no explanation text.`;
    } else {
        prompt = `Generate a realistic university student ID card image:

UNIVERSITY: ${universityName}
STUDENT NAME: ${firstName} ${lastName}
STUDENT ID: ${studentId}

Requirements:
- Official university ID card design with logo
- Student photo placeholder area
- Barcode at bottom
- Looks like a real scanned ID card

Generate ONLY the image, no explanation text.`;
    }

    let result = null;

    // Try 1: Google Gemini Official API (direct)
    if (geminiKey) {
        console.log('[DocGenerator] Trying Google Gemini Official API...');
        result = await generateImageWithGoogleGemini(prompt, geminiKey, geminiModel);
        if (result) {
            result.type = docType;
            result.fileName = docType === 'transcript' ? 'transcript.png' : 'student_id.png';
            result.studentId = studentId;
            result.generatedBy = 'gemini-official';
            console.log(`[DocGenerator] ✓ Generated with Google Gemini (${result.data.length} bytes)`);
            return result;
        }
    }

    // Try 2: Antigravity Proxy (local)
    console.log('[DocGenerator] Trying Antigravity Proxy...');
    result = await generateImageWithAPI(prompt, geminiKey, antigravityBase);
    if (result) {
        result.type = docType;
        result.fileName = docType === 'transcript' ? 'transcript.png' : 'student_id.png';
        result.studentId = studentId;
        result.generatedBy = 'antigravity-proxy';
        console.log(`[DocGenerator] ✓ Generated with Antigravity (${result.data.length} bytes)`);
        return result;
    }

    console.log('[DocGenerator] ✗ All AI generators failed, will use SVG fallback');
    return null;
}

module.exports = {
    generateStudentIdWithGemini,
    generateTranscriptWithGemini,
    generateDocumentWithGemini,
    generateImageWithGoogleGemini,
};
