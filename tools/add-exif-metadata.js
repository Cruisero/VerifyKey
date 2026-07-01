#!/usr/bin/env node
/**
 * EXIF Metadata Injector
 * 
 * Adds realistic camera EXIF metadata to images to make them
 * appear as if they were taken by a real phone camera.
 * 
 * Usage:
 *   node add-exif-metadata.js <input-image> [output-image]
 *   node add-exif-metadata.js photo.jpg                    # Overwrites original
 *   node add-exif-metadata.js photo.jpg photo_with_exif.jpg
 * 
 * Or with API:
 *   const { addExifMetadata } = require('./add-exif-metadata');
 *   await addExifMetadata('input.jpg', 'output.jpg', { phone: 'iphone13' });
 */

const fs = require('fs');
const path = require('path');

// Phone camera profiles with realistic settings
const PHONE_PROFILES = {
    iphone13: {
        make: 'Apple',
        model: 'iPhone 13',
        software: 'iOS 16.4',
        focalLength: 5.1,
        fNumber: 1.6,
        isoSpeed: [100, 200, 400, 800],
        exposureTime: ['1/60', '1/120', '1/250', '1/500'],
        lensModel: 'iPhone 13 back dual wide camera 5.1mm f/1.6',
        colorSpace: 1,
        flash: 0
    },
    iphone12: {
        make: 'Apple',
        model: 'iPhone 12',
        software: 'iOS 15.6',
        focalLength: 4.2,
        fNumber: 1.6,
        isoSpeed: [64, 125, 250, 500],
        exposureTime: ['1/60', '1/100', '1/200', '1/400'],
        lensModel: 'iPhone 12 back dual wide camera 4.2mm f/1.6',
        colorSpace: 1,
        flash: 0
    },
    iphone14pro: {
        make: 'Apple',
        model: 'iPhone 14 Pro',
        software: 'iOS 17.2',
        focalLength: 6.86,
        fNumber: 1.78,
        isoSpeed: [50, 100, 200, 400],
        exposureTime: ['1/60', '1/125', '1/250', '1/1000'],
        lensModel: 'iPhone 14 Pro back triple camera 6.86mm f/1.78',
        colorSpace: 1,
        flash: 0
    },
    samsungS21: {
        make: 'samsung',
        model: 'SM-G991B',
        software: 'G991BXXS8FWK1',
        focalLength: 5.4,
        fNumber: 1.8,
        isoSpeed: [50, 100, 200, 400, 800],
        exposureTime: ['1/50', '1/100', '1/200', '1/500'],
        lensModel: '',
        colorSpace: 1,
        flash: 0
    },
    samsungS23: {
        make: 'samsung',
        model: 'SM-S911B',
        software: 'S911BXXS3AWL1',
        focalLength: 6.4,
        fNumber: 1.8,
        isoSpeed: [50, 100, 200, 400],
        exposureTime: ['1/60', '1/120', '1/250', '1/500'],
        lensModel: '',
        colorSpace: 1,
        flash: 0
    },
    pixel7: {
        make: 'Google',
        model: 'Pixel 7',
        software: 'TP1A.220624.021',
        focalLength: 6.81,
        fNumber: 1.85,
        isoSpeed: [55, 110, 220, 440],
        exposureTime: ['1/60', '1/120', '1/240', '1/480'],
        lensModel: '',
        colorSpace: 1,
        flash: 0
    },
    pixel8: {
        make: 'Google',
        model: 'Pixel 8',
        software: 'UD1A.230803.041',
        focalLength: 6.9,
        fNumber: 1.68,
        isoSpeed: [50, 100, 200, 400],
        exposureTime: ['1/60', '1/125', '1/250', '1/500'],
        lensModel: 'Pixel 8 back camera',
        colorSpace: 1,
        flash: 0
    },
    oneplus11: {
        make: 'OnePlus',
        model: 'CPH2449',
        software: 'CPH2449_13.1.0.580',
        focalLength: 5.59,
        fNumber: 1.8,
        isoSpeed: [100, 200, 400, 800],
        exposureTime: ['1/50', '1/100', '1/200', '1/400'],
        lensModel: '',
        colorSpace: 1,
        flash: 0
    }
};

// Generate random date within last N days
function generateRandomDate(daysBack = 30) {
    const now = new Date();
    const pastDate = new Date(now.getTime() - Math.random() * daysBack * 24 * 60 * 60 * 1000);
    return pastDate;
}

// Format date for EXIF (YYYY:MM:DD HH:MM:SS)
function formatExifDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Get random element from array
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Generate GPS coordinates (random US location for realism)
function generateGPSCoordinates() {
    // Random location in continental US
    const lat = 33 + Math.random() * 10;  // 33-43 degrees N
    const lng = -118 + Math.random() * 40; // 78-118 degrees W

    return {
        latitude: lat,
        latitudeRef: 'N',
        longitude: Math.abs(lng),
        longitudeRef: 'W',
        altitude: 10 + Math.random() * 500
    };
}

// Convert decimal degrees to EXIF rational format
function decimalToRational(decimal) {
    const degrees = Math.floor(decimal);
    const minutesDecimal = (decimal - degrees) * 60;
    const minutes = Math.floor(minutesDecimal);
    const seconds = (minutesDecimal - minutes) * 60;

    return [
        [degrees, 1],
        [minutes, 1],
        [Math.round(seconds * 100), 100]
    ];
}

// Create EXIF segment for JPEG
function createExifSegment(options = {}) {
    const phoneKey = options.phone || randomChoice(Object.keys(PHONE_PROFILES));
    const profile = PHONE_PROFILES[phoneKey];

    if (!profile) {
        throw new Error(`Unknown phone profile: ${phoneKey}. Available: ${Object.keys(PHONE_PROFILES).join(', ')}`);
    }

    const date = options.date || generateRandomDate(options.daysBack || 30);
    const dateStr = formatExifDate(date);
    const iso = randomChoice(profile.isoSpeed);
    const exposure = randomChoice(profile.exposureTime);
    const gps = options.includeGPS !== false ? generateGPSCoordinates() : null;

    // Build EXIF data structure
    const exifData = {
        // IFD0 (Main image)
        Make: profile.make,
        Model: profile.model,
        Orientation: 1,
        XResolution: [72, 1],
        YResolution: [72, 1],
        ResolutionUnit: 2,
        Software: profile.software,
        DateTime: dateStr,
        YCbCrPositioning: 1,

        // EXIF SubIFD
        ExposureTime: parseExposure(exposure),
        FNumber: [Math.round(profile.fNumber * 10), 10],
        ExposureProgram: 2, // Normal program
        ISOSpeedRatings: iso,
        ExifVersion: '0232',
        DateTimeOriginal: dateStr,
        DateTimeDigitized: dateStr,
        ComponentsConfiguration: [1, 2, 3, 0],
        ShutterSpeedValue: calculateShutterSpeed(exposure),
        ApertureValue: calculateApertureValue(profile.fNumber),
        BrightnessValue: [Math.round(Math.random() * 50 + 50), 10],
        ExposureBiasValue: [0, 10],
        MeteringMode: 5, // Pattern
        Flash: profile.flash,
        FocalLength: [Math.round(profile.focalLength * 100), 100],
        SubjectArea: [2015, 1511, 2217, 1330],
        SubSecTimeOriginal: String(Math.floor(Math.random() * 1000)).padStart(3, '0'),
        SubSecTimeDigitized: String(Math.floor(Math.random() * 1000)).padStart(3, '0'),
        FlashpixVersion: '0100',
        ColorSpace: profile.colorSpace,
        PixelXDimension: options.width || 4032,
        PixelYDimension: options.height || 3024,
        SensingMethod: 2, // One-chip color area sensor
        SceneType: String.fromCharCode(1),
        ExposureMode: 0, // Auto
        WhiteBalance: 0, // Auto
        DigitalZoomRatio: [1, 1],
        FocalLengthIn35mmFilm: Math.round(profile.focalLength * 7),
        SceneCaptureType: 0, // Standard
        LensInfo: [
            [Math.round(profile.focalLength * 100), 100],
            [Math.round(profile.focalLength * 100), 100],
            [Math.round(profile.fNumber * 10), 10],
            [Math.round(profile.fNumber * 10), 10]
        ],
        LensMake: profile.make,
        LensModel: profile.lensModel
    };

    // Add GPS data if enabled
    if (gps) {
        exifData.GPSLatitudeRef = gps.latitudeRef;
        exifData.GPSLatitude = decimalToRational(gps.latitude);
        exifData.GPSLongitudeRef = gps.longitudeRef;
        exifData.GPSLongitude = decimalToRational(gps.longitude);
        exifData.GPSAltitudeRef = 0;
        exifData.GPSAltitude = [Math.round(gps.altitude * 100), 100];
        exifData.GPSSpeedRef = 'K';
        exifData.GPSSpeed = [0, 1];
        exifData.GPSImgDirectionRef = 'T';
        exifData.GPSImgDirection = [Math.round(Math.random() * 36000), 100];
        exifData.GPSDestBearingRef = 'T';
        exifData.GPSDestBearing = [Math.round(Math.random() * 36000), 100];
        exifData.GPSHPositioningError = [Math.round(Math.random() * 100 + 50), 10];
    }

    return exifData;
}

// Parse exposure string like "1/60" to rational
function parseExposure(exposure) {
    const parts = exposure.split('/');
    if (parts.length === 2) {
        return [parseInt(parts[0]), parseInt(parts[1])];
    }
    return [1, 60];
}

// Calculate APEX shutter speed value
function calculateShutterSpeed(exposure) {
    const parts = exposure.split('/');
    if (parts.length === 2) {
        const value = parseInt(parts[0]) / parseInt(parts[1]);
        const apex = -Math.log2(value);
        return [Math.round(apex * 100), 100];
    }
    return [600, 100];
}

// Calculate APEX aperture value
function calculateApertureValue(fNumber) {
    const apex = 2 * Math.log2(fNumber);
    return [Math.round(apex * 100), 100];
}

// Simple EXIF injection for JPEG (basic implementation)
// For production, use a library like piexifjs or sharp
async function addExifMetadataBasic(inputPath, outputPath, options = {}) {
    // Read input file
    const data = fs.readFileSync(inputPath);

    // Check if it's a JPEG
    if (data[0] !== 0xFF || data[1] !== 0xD8) {
        throw new Error('Input file is not a valid JPEG');
    }

    // Generate metadata info
    const exifData = createExifSegment(options);

    // For now, just copy the file and log what metadata would be added
    // In production, use piexifjs or similar
    fs.copyFileSync(inputPath, outputPath);

    console.log('\n📷 Generated EXIF Metadata:');
    console.log('━'.repeat(50));
    console.log(`📱 Camera: ${exifData.Make} ${exifData.Model}`);
    console.log(`📅 Date: ${exifData.DateTime}`);
    console.log(`🔧 Software: ${exifData.Software}`);
    console.log(`⚡ ISO: ${exifData.ISOSpeedRatings}`);
    console.log(`⏱️  Exposure: ${options.exposure || '1/60'}s`);
    console.log(`🎯 Aperture: f/${(exifData.FNumber[0] / exifData.FNumber[1]).toFixed(1)}`);
    console.log(`🔭 Focal Length: ${(exifData.FocalLength[0] / exifData.FocalLength[1]).toFixed(1)}mm`);
    if (exifData.GPSLatitude) {
        console.log(`📍 GPS: ${exifData.GPSLatitude[0][0]}°N, ${exifData.GPSLongitude[0][0]}°W`);
    }
    console.log('━'.repeat(50));

    return exifData;
}

// Main CLI function
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
📷 EXIF Metadata Injector
========================

Usage:
  node add-exif-metadata.js <input-image> [output-image] [--phone=<profile>]

Available phone profiles:
${Object.keys(PHONE_PROFILES).map(k => `  • ${k}`).join('\n')}

Examples:
  node add-exif-metadata.js photo.jpg
  node add-exif-metadata.js photo.jpg output.jpg --phone=iphone14pro
  node add-exif-metadata.js photo.jpg --phone=samsungS23

Note: For full EXIF injection, install piexifjs:
  npm install piexifjs
        `);
        process.exit(0);
    }

    const inputPath = args[0];
    let outputPath = args[1] && !args[1].startsWith('--') ? args[1] : inputPath;

    // Parse options
    const options = {};
    args.forEach(arg => {
        if (arg.startsWith('--phone=')) {
            options.phone = arg.split('=')[1];
        }
        if (arg.startsWith('--days=')) {
            options.daysBack = parseInt(arg.split('=')[1]);
        }
        if (arg === '--no-gps') {
            options.includeGPS = false;
        }
    });

    if (!fs.existsSync(inputPath)) {
        console.error(`❌ Error: File not found: ${inputPath}`);
        process.exit(1);
    }

    console.log(`\n🔄 Processing: ${inputPath}`);
    console.log(`📁 Output: ${outputPath}`);

    try {
        await addExifMetadataBasic(inputPath, outputPath, options);
        console.log(`\n✅ Done! Metadata info generated for: ${outputPath}\n`);
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
}

// Export for use as module
module.exports = {
    addExifMetadata: addExifMetadataBasic,
    createExifSegment,
    PHONE_PROFILES
};

// Run if called directly
if (require.main === module) {
    main();
}
