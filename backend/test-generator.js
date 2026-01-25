/**
 * Test script for document generation
 * Uses the configuration from Admin page (config.json)
 * Run with: node test-generator.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getConfig, getActiveGenerator } = require('./utils/config-manager');
const { generateDocumentWithGemini } = require('./services/gemini-generator');
const { generateDocument } = require('./services/document-generator');

const outputDir = path.join(__dirname, 'test-output');

async function test() {
    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });

    // Load config from Admin page
    const config = getConfig();
    const activeGenerator = getActiveGenerator();

    console.log('🧪 Document Generation Test');
    console.log('============================');
    console.log('');
    console.log('📋 Current Configuration (from Admin page):');
    console.log(`   Provider: ${activeGenerator.type}`);

    if (activeGenerator.type === 'antigravity') {
        console.log(`   API Base: ${activeGenerator.apiBase}`);
        console.log(`   Model: ${activeGenerator.model}`);
        console.log(`   API Key: ${activeGenerator.apiKey ? '✓ Configured' : '✗ Not set'}`);
    } else if (activeGenerator.type === 'gemini_official') {
        console.log(`   Model: ${activeGenerator.model}`);
        console.log(`   API Key: ${activeGenerator.apiKey ? '✓ Configured' : '✗ Not set'}`);
    } else {
        console.log('   Using SVG template (no API required)');
    }

    console.log(`   Fallback to SVG: ${activeGenerator.fallbackToSvg ? 'Yes' : 'No'}`);
    console.log('');
    console.log('Output:', outputDir);
    console.log('');

    // Test 1: SVG Generator (always works)
    console.log('📄 [1/2] SVG Generator');
    try {
        const svgDoc = generateDocument(
            'transcript',
            'John',
            'Smith',
            'Harvard University',
            '2003-05-15'
        );
        const svgPath = path.join(outputDir, 'test_transcript.svg');
        fs.writeFileSync(svgPath, svgDoc.data);
        console.log(`   ✅ Saved: ${svgPath}`);
        console.log(`   📊 Size: ${svgDoc.data.length} bytes`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
    console.log('');

    // Test 2: AI Generator based on config
    if (activeGenerator.type === 'svg') {
        console.log('📄 [2/2] AI Generator');
        console.log('   ⚠️  Skipped: Current provider is set to SVG');
        console.log('   💡 Change provider in Admin page to test AI generation');
    } else if (activeGenerator.type === 'antigravity') {
        console.log('📄 [2/2] Antigravity Tools Generator');
        await testAntigravityGenerator(activeGenerator);
    } else if (activeGenerator.type === 'gemini_official') {
        console.log('📄 [2/2] Gemini Official API Generator');
        await testGeminiOfficialGenerator(activeGenerator);
    }

    console.log('');
    console.log('============================');
    console.log('✅ Test complete!');
    console.log('');
    console.log('📂 Open test output:');
    console.log(`   open ${outputDir}`);
}

async function testAntigravityGenerator(settings) {
    if (!settings.apiKey) {
        console.log('   ⚠️  Skipped: No API key configured');
        console.log('   💡 Set API key in Admin page');
        return;
    }

    try {
        console.log('   ⏳ Calling Antigravity API...');
        console.log(`   📡 ${settings.apiBase}`);

        const aiDoc = await generateDocumentWithGemini(
            'transcript',
            'Emily',
            'Johnson',
            'Stanford University',
            '2004-03-22',
            settings.apiKey
        );

        if (aiDoc) {
            const aiPath = path.join(outputDir, 'test_ai_transcript.png');
            fs.writeFileSync(aiPath, aiDoc.data);
            console.log(`   ✅ Saved: ${aiPath}`);
            console.log(`   📊 Size: ${aiDoc.data.length} bytes`);
            console.log(`   🤖 Generator: ${aiDoc.generatedBy}`);
        } else {
            console.log('   ⚠️  AI returned null');
            console.log('   💡 Check if Antigravity Tools is running');
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
}

async function testGeminiOfficialGenerator(settings) {
    if (!settings.apiKey) {
        console.log('   ⚠️  Skipped: No API key configured');
        console.log('   💡 Set API key in Admin page');
        return;
    }

    try {
        console.log('   ⏳ Calling Gemini Official API...');
        console.log(`   📡 Model: ${settings.model}`);

        // Call Gemini Official API
        const prompt = `Generate a realistic university transcript document image for:
- Student: Emily Johnson
- University: Stanford University
- Date of Birth: 2004-03-22
Create a realistic-looking official academic transcript with courses, grades, and GPA. Output the image directly.`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`,
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
            throw new Error(error.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();

        // Check for image in response
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

        if (imagePart) {
            const imageData = Buffer.from(imagePart.inlineData.data, 'base64');
            const ext = imagePart.inlineData.mimeType.split('/')[1] || 'png';
            const aiPath = path.join(outputDir, `test_gemini_official.${ext}`);
            fs.writeFileSync(aiPath, imageData);
            console.log(`   ✅ Saved: ${aiPath}`);
            console.log(`   📊 Size: ${imageData.length} bytes`);
            console.log(`   🤖 Generator: Gemini Official (${settings.model})`);
        } else {
            console.log('   ⚠️  No image in response');
            console.log('   💡 The model may not support image generation');

            // Show text response if available
            const textPart = parts.find(p => p.text);
            if (textPart) {
                console.log('   📝 Text response received instead');
            }
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
}

test().catch(console.error);
