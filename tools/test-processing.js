#!/usr/bin/env node
/**
 * Test Script for Image Post-Processing
 * 
 * Downloads a sample image and applies camera effects + EXIF metadata
 */

const fs = require('fs');
const path = require('path');
const { postProcessImage, PHONE_PROFILES } = require('../backend/services/image-processor');

async function runTest() {
    console.log('\n🧪 Image Post-Processing Test\n');
    console.log('='.repeat(50));

    // Create a simple test image (red rectangle) using sharp
    const sharp = require('sharp');

    // Create a test image - simple colored rectangle simulating a document
    const width = 800;
    const height = 600;

    console.log('\n1️⃣ Creating test image...');

    // Create a gradient image to simulate a document
    const channels = 3;
    const pixels = Buffer.alloc(width * height * channels);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            // Create a white background with some variation
            pixels[i] = 240 + Math.floor(Math.random() * 15);     // R
            pixels[i + 1] = 240 + Math.floor(Math.random() * 15); // G
            pixels[i + 2] = 245 + Math.floor(Math.random() * 10); // B

            // Add a "document" area in the center
            if (x > 100 && x < 700 && y > 80 && y < 520) {
                pixels[i] = 255;
                pixels[i + 1] = 255;
                pixels[i + 2] = 255;
            }

            // Add some "text" lines
            if (x > 150 && x < 650 && (y % 40 > 15 && y % 40 < 20) && y > 100 && y < 500) {
                pixels[i] = 30;
                pixels[i + 1] = 30;
                pixels[i + 2] = 30;
            }
        }
    }

    const testImage = await sharp(pixels, {
        raw: { width, height, channels }
    }).png().toBuffer();

    const originalPath = path.join(__dirname, 'test_original.png');
    fs.writeFileSync(originalPath, testImage);
    console.log(`   ✓ Original test image: ${originalPath} (${testImage.length} bytes)`);

    // Test different phone profiles
    const testPhones = ['iphone13', 'samsungS23', 'pixel8'];

    for (const phone of testPhones) {
        console.log(`\n2️⃣ Processing with ${PHONE_PROFILES[phone].make} ${PHONE_PROFILES[phone].model}...`);

        try {
            const processed = await postProcessImage(testImage, {
                phone: phone,
                noise: 8,
                blur: 0.3,
                brightness: -5,
                contrast: -3,
                quality: 85,
                includeGPS: true
            });

            const outputPath = path.join(__dirname, `test_${phone}.jpg`);
            fs.writeFileSync(outputPath, processed);

            console.log(`   ✓ Processed: ${outputPath} (${processed.length} bytes)`);
        } catch (error) {
            console.log(`   ✗ Error: ${error.message}`);
        }
    }

    // Test with different settings
    console.log('\n3️⃣ Testing different noise levels...');

    for (const noise of [0, 5, 10, 15, 20]) {
        try {
            const processed = await postProcessImage(testImage, {
                phone: 'iphone14pro',
                noise: noise,
                blur: 0.3,
                brightness: -5,
                contrast: -3,
                quality: 85
            });

            const outputPath = path.join(__dirname, `test_noise_${noise}.jpg`);
            fs.writeFileSync(outputPath, processed);
            console.log(`   ✓ Noise ${noise}%: ${outputPath} (${processed.length} bytes)`);
        } catch (error) {
            console.log(`   ✗ Error: ${error.message}`);
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Test complete!\n');
    console.log('📁 Output files saved to:', __dirname);
    console.log('\nOpen the files to compare:');
    console.log('  - test_original.png (clean, AI-generated look)');
    console.log('  - test_iphone13.jpg (with iPhone camera effects + EXIF)');
    console.log('  - test_samsungS23.jpg (with Samsung camera effects + EXIF)');
    console.log('  - test_pixel8.jpg (with Pixel camera effects + EXIF)');
    console.log('  - test_noise_*.jpg (different noise levels)\n');

    // Verify EXIF
    console.log('📷 To verify EXIF metadata, use:');
    console.log('   exiftool test_iphone13.jpg\n');
}

runTest().catch(console.error);
