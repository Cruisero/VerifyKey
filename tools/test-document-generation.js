#!/usr/bin/env node
/**
 * Test Document Generation with Post-Processing
 * 
 * Generates a student ID card or transcript using Gemini
 * and applies camera effects + EXIF metadata
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from backend/.env
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const {
    generateDocumentWithGemini,
    POST_PROCESS_DEFAULTS
} = require('../backend/services/gemini-generator');

async function testDocumentGeneration() {
    console.log('\n📄 Document Generation Test\n');
    console.log('='.repeat(50));

    // Test data
    const testData = {
        firstName: 'John',
        lastName: 'Smith',
        universityName: 'University of California, Los Angeles',
        birthDate: '1999-05-15'
    };

    console.log('\n📋 Test Data:');
    console.log(`   Name: ${testData.firstName} ${testData.lastName}`);
    console.log(`   University: ${testData.universityName}`);
    console.log(`   Birth Date: ${testData.birthDate}`);

    const outputDir = path.join(__dirname, 'generated');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Test 1: Generate Student ID Card
    console.log('\n' + '─'.repeat(50));
    console.log('1️⃣ Generating Student ID Card...\n');

    try {
        const idCardResult = await generateDocumentWithGemini(
            'id_card',
            testData.firstName,
            testData.lastName,
            testData.universityName,
            testData.birthDate,
            {
                apiKey: process.env.GEMINI_API_KEY,
                postProcess: {
                    enabled: true,
                    phone: 'iphone13',
                    noise: 8,
                    blur: 0.3
                }
            }
        );

        if (idCardResult) {
            const idCardPath = path.join(outputDir, `student_id_${Date.now()}.${idCardResult.fileName.split('.').pop()}`);
            fs.writeFileSync(idCardPath, idCardResult.data);

            console.log('   ✅ Student ID Card generated!');
            console.log(`   📁 File: ${idCardPath}`);
            console.log(`   📊 Size: ${idCardResult.data.length} bytes`);
            console.log(`   🎨 Type: ${idCardResult.mimeType}`);
            console.log(`   🔧 Generator: ${idCardResult.generatedBy}`);
            console.log(`   📷 Post-processed: ${idCardResult.postProcessed ? 'Yes' : 'No'}`);
        } else {
            console.log('   ❌ Failed to generate Student ID Card');
            console.log('   💡 Make sure GEMINI_API_KEY is set in .env');
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }

    // Test 2: Generate Transcript
    console.log('\n' + '─'.repeat(50));
    console.log('2️⃣ Generating Academic Transcript...\n');

    try {
        const transcriptResult = await generateDocumentWithGemini(
            'transcript',
            testData.firstName,
            testData.lastName,
            testData.universityName,
            testData.birthDate,
            {
                apiKey: process.env.GEMINI_API_KEY,
                postProcess: {
                    enabled: true,
                    phone: 'samsungS23',
                    noise: 10,
                    blur: 0.4
                }
            }
        );

        if (transcriptResult) {
            const transcriptPath = path.join(outputDir, `transcript_${Date.now()}.${transcriptResult.fileName.split('.').pop()}`);
            fs.writeFileSync(transcriptPath, transcriptResult.data);

            console.log('   ✅ Transcript generated!');
            console.log(`   📁 File: ${transcriptPath}`);
            console.log(`   📊 Size: ${transcriptResult.data.length} bytes`);
            console.log(`   🎨 Type: ${transcriptResult.mimeType}`);
            console.log(`   🔧 Generator: ${transcriptResult.generatedBy}`);
            console.log(`   📷 Post-processed: ${transcriptResult.postProcessed ? 'Yes' : 'No'}`);
        } else {
            console.log('   ❌ Failed to generate Transcript');
            console.log('   💡 Make sure GEMINI_API_KEY is set in .env');
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Test complete!\n');
    console.log(`📁 Output directory: ${outputDir}`);
    console.log('\nTo open the generated files:');
    console.log(`   open ${outputDir}\n`);
}

// Check for API key first
if (!process.env.GEMINI_API_KEY) {
    console.log('\n⚠️  Warning: GEMINI_API_KEY not found in environment');
    console.log('   Set it in .env file or run:');
    console.log('   export GEMINI_API_KEY=your_api_key\n');
}

testDocumentGeneration().catch(console.error);
