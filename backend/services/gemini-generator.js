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
 * Main function to generate document with Antigravity Tools API
 * Falls back to SVG template if API fails
 */
async function generateDocumentWithGemini(type, firstName, lastName, universityName, birthDate, apiKey) {
    // Get API configuration from environment
    const key = apiKey || process.env.GEMINI_API_KEY;
    const base = process.env.GEMINI_API_BASE || DEFAULT_API_BASE;

    if (!key) {
        console.log('[Antigravity] No API key configured, using fallback SVG generator');
        return null;
    }

    console.log(`[Antigravity] Generating ${type} for ${firstName} ${lastName} at ${universityName}`);
    console.log(`[Antigravity] Using API: ${base}`);

    // Randomly choose document type if 'auto'
    const docType = type === 'auto' ? (Math.random() < 0.6 ? 'transcript' : 'id_card') : type;

    let result;
    if (docType === 'transcript') {
        result = await generateTranscriptWithGemini(firstName, lastName, universityName, birthDate, key, base);
    } else {
        result = await generateStudentIdWithGemini(firstName, lastName, universityName, key, base);
    }

    if (result) {
        console.log(`[Antigravity] Successfully generated ${docType} (${result.data.length} bytes)`);
    } else {
        console.log(`[Antigravity] Failed to generate ${docType}, will use fallback`);
    }

    return result;
}

module.exports = {
    generateStudentIdWithGemini,
    generateTranscriptWithGemini,
    generateDocumentWithGemini,
};
