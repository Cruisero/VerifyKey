#!/usr/bin/env node
/**
 * Test Post-Processing with HTML Template Output
 * 
 * Uses a sample student ID card image to test post-processing
 * without needing Gemini API
 */

const fs = require('fs');
const path = require('path');
const { postProcessImage, PHONE_PROFILES } = require('../backend/services/image-processor');

async function testWithSampleImage() {
    console.log('\n📷 Post-Processing Test (No API Required)\n');
    console.log('='.repeat(50));

    const outputDir = path.join(__dirname, 'generated');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Check if there's an existing image to process
    const templateDir = path.join(__dirname, '../templates');
    const sampleImages = [
        path.join(__dirname, 'test_original.png'),
        path.join(templateDir, 'sample_id.png'),
        path.join(templateDir, 'sample_id.jpg')
    ];

    let inputImage = null;
    for (const imgPath of sampleImages) {
        if (fs.existsSync(imgPath)) {
            inputImage = imgPath;
            break;
        }
    }

    // If no sample image, create a test one
    if (!inputImage) {
        console.log('\n1️⃣ Creating sample student ID card image...\n');

        const sharp = require('sharp');

        // Create a more realistic student ID card simulation
        const width = 856;  // 3.5" at 244dpi
        const height = 540; // 2.2" at 244dpi

        // Create image with SVG for text
        const svgText = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <!-- Background -->
            <rect width="100%" height="100%" fill="#ffffff"/>
            
            <!-- Header bar -->
            <rect x="0" y="0" width="100%" height="80" fill="#1e3a5f"/>
            
            <!-- University name -->
            <text x="428" y="45" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="white" text-anchor="middle">
                UNIVERSITY OF CALIFORNIA, LOS ANGELES
            </text>
            <text x="428" y="68" font-family="Arial, sans-serif" font-size="12" fill="#a0c4e8" text-anchor="middle">
                Student Identification Card
            </text>
            
            <!-- Photo area -->
            <rect x="30" y="100" width="180" height="220" fill="#e0e0e0" stroke="#cccccc" stroke-width="2"/>
            <text x="120" y="210" font-family="Arial, sans-serif" font-size="14" fill="#888888" text-anchor="middle">PHOTO</text>
            
            <!-- Student info -->
            <text x="240" y="130" font-family="Arial, sans-serif" font-size="12" fill="#666666">Name:</text>
            <text x="240" y="155" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#1e3a5f">JOHN SMITH</text>
            
            <text x="240" y="190" font-family="Arial, sans-serif" font-size="12" fill="#666666">Student ID:</text>
            <text x="240" y="215" font-family="Arial, sans-serif" font-size="16" fill="#333333">24-789456</text>
            
            <text x="240" y="250" font-family="Arial, sans-serif" font-size="12" fill="#666666">Major:</text>
            <text x="240" y="275" font-family="Arial, sans-serif" font-size="14" fill="#333333">Computer Science</text>
            
            <text x="240" y="310" font-family="Arial, sans-serif" font-size="12" fill="#666666">Valid Through:</text>
            <text x="240" y="335" font-family="Arial, sans-serif" font-size="14" fill="#333333">August 2026</text>
            
            <!-- Barcode area -->
            <rect x="30" y="360" width="400" height="60" fill="#f5f5f5" stroke="#dddddd"/>
            <text x="230" y="395" font-family="Courier, monospace" font-size="14" fill="#333333" text-anchor="middle">
                |||||| ||| |||| ||| |||| ||| ||||
            </text>
            
            <!-- UCLA seal placeholder -->
            <circle cx="750" y="250" r="80" fill="none" stroke="#1e3a5f" stroke-width="3"/>
            <text x="750" y="255" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#1e3a5f" text-anchor="middle">UCLA</text>
            
            <!-- Footer -->
            <rect x="0" y="480" width="100%" height="60" fill="#f0f0f0"/>
            <text x="428" y="515" font-family="Arial, sans-serif" font-size="10" fill="#888888" text-anchor="middle">
                This card is property of UCLA. If found, please return to Bruins Card Center.
            </text>
        </svg>`;

        const svgBuffer = await sharp(Buffer.from(svgText))
            .png()
            .toBuffer();

        inputImage = path.join(outputDir, 'sample_id_original.png');
        fs.writeFileSync(inputImage, svgBuffer);
        console.log(`   ✅ Created: ${inputImage}`);
    } else {
        console.log(`\n1️⃣ Using existing image: ${inputImage}\n`);
    }

    // Read input image
    const inputBuffer = fs.readFileSync(inputImage);
    console.log(`   📊 Original size: ${inputBuffer.length} bytes`);

    // Test different phone profiles
    console.log('\n2️⃣ Applying camera effects with different phones...\n');

    const testProfiles = [
        { phone: 'iphone13', noise: 6, blur: 0.3 },
        { phone: 'iphone14pro', noise: 8, blur: 0.4 },
        { phone: 'samsungS23', noise: 10, blur: 0.3 },
        { phone: 'pixel8', noise: 7, blur: 0.35 }
    ];

    for (const config of testProfiles) {
        try {
            const profile = PHONE_PROFILES[config.phone];
            console.log(`   📱 ${profile.make} ${profile.model}...`);

            const processed = await postProcessImage(inputBuffer, {
                phone: config.phone,
                noise: config.noise,
                blur: config.blur,
                brightness: -5,
                contrast: -3,
                quality: 85,
                includeGPS: true
            });

            const outputPath = path.join(outputDir, `id_${config.phone}.jpg`);
            fs.writeFileSync(outputPath, processed);

            console.log(`      ✅ Saved: ${outputPath} (${processed.length} bytes)`);
        } catch (error) {
            console.log(`      ❌ Error: ${error.message}`);
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Test complete!\n');
    console.log(`📁 Output directory: ${outputDir}`);
    console.log('\nGenerated files:');

    const files = fs.readdirSync(outputDir);
    files.forEach(f => {
        const stat = fs.statSync(path.join(outputDir, f));
        console.log(`   • ${f} (${Math.round(stat.size / 1024)} KB)`);
    });

    console.log('\nTo view the files:');
    console.log(`   open ${outputDir}\n`);

    // Open the folder
    require('child_process').exec(`open ${outputDir}`);
}

testWithSampleImage().catch(console.error);
