#!/usr/bin/env node
/**
 * Image Post-Processor for Student ID Verification
 * 
 * Applies realistic camera effects and embeds EXIF metadata
 * to make generated images look like real phone photos.
 * 
 * Usage:
 *   node process-image.js <input-image> [output-image] [options]
 * 
 * Options:
 *   --phone=<profile>   Phone camera profile (iphone13, samsungS23, etc.)
 *   --noise=<0-25>      Noise level (default: 8)
 *   --blur=<0-2>        Blur radius (default: 0.3)
 *   --brightness=<-20,20>  Brightness adjustment (default: -5)
 *   --contrast=<-20,20>    Contrast adjustment (default: -3)
 *   --quality=<60-95>   JPEG quality (default: 85)
 *   --no-gps           Disable GPS coordinates in EXIF
 * 
 * Examples:
 *   node process-image.js card.png card_processed.jpg
 *   node process-image.js card.png --phone=iphone14pro --noise=10
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const piexif = require('piexifjs');

// Phone camera profiles
const PHONE_PROFILES = {
    iphone13: {
        make: 'Apple',
        model: 'iPhone 13',
        software: '16.4',
        focalLength: 5.1,
        fNumber: 1.6,
        isoSpeed: [100, 200, 400, 800],
        exposureTime: [[1, 60], [1, 120], [1, 250], [1, 500]],
        lensModel: 'iPhone 13 back dual wide camera 5.1mm f/1.6'
    },
    iphone12: {
        make: 'Apple',
        model: 'iPhone 12',
        software: '15.6',
        focalLength: 4.2,
        fNumber: 1.6,
        isoSpeed: [64, 125, 250, 500],
        exposureTime: [[1, 60], [1, 100], [1, 200], [1, 400]],
        lensModel: 'iPhone 12 back dual wide camera 4.2mm f/1.6'
    },
    iphone14pro: {
        make: 'Apple',
        model: 'iPhone 14 Pro',
        software: '17.2',
        focalLength: 6.86,
        fNumber: 1.78,
        isoSpeed: [50, 100, 200, 400],
        exposureTime: [[1, 60], [1, 125], [1, 250], [1, 1000]],
        lensModel: 'iPhone 14 Pro back triple camera 6.86mm f/1.78'
    },
    samsungS21: {
        make: 'samsung',
        model: 'SM-G991B',
        software: 'G991BXXS8FWK1',
        focalLength: 5.4,
        fNumber: 1.8,
        isoSpeed: [50, 100, 200, 400, 800],
        exposureTime: [[1, 50], [1, 100], [1, 200], [1, 500]],
        lensModel: ''
    },
    samsungS23: {
        make: 'samsung',
        model: 'SM-S911B',
        software: 'S911BXXS3AWL1',
        focalLength: 6.4,
        fNumber: 1.8,
        isoSpeed: [50, 100, 200, 400],
        exposureTime: [[1, 60], [1, 120], [1, 250], [1, 500]],
        lensModel: ''
    },
    pixel7: {
        make: 'Google',
        model: 'Pixel 7',
        software: 'TP1A.220624.021',
        focalLength: 6.81,
        fNumber: 1.85,
        isoSpeed: [55, 110, 220, 440],
        exposureTime: [[1, 60], [1, 120], [1, 240], [1, 480]],
        lensModel: ''
    },
    pixel8: {
        make: 'Google',
        model: 'Pixel 8',
        software: 'UD1A.230803.041',
        focalLength: 6.9,
        fNumber: 1.68,
        isoSpeed: [50, 100, 200, 400],
        exposureTime: [[1, 60], [1, 125], [1, 250], [1, 500]],
        lensModel: 'Pixel 8 back camera'
    },
    oneplus11: {
        make: 'OnePlus',
        model: 'CPH2449',
        software: 'CPH2449_13.1.0.580',
        focalLength: 5.59,
        fNumber: 1.8,
        isoSpeed: [100, 200, 400, 800],
        exposureTime: [[1, 50], [1, 100], [1, 200], [1, 400]],
        lensModel: ''
    }
};

// Utility functions
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomDate(daysBack = 30) {
    const now = new Date();
    return new Date(now.getTime() - Math.random() * daysBack * 24 * 60 * 60 * 1000);
}

function formatExifDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Generate GPS coordinates (random US location)
function generateGPSCoordinates() {
    const lat = 33 + Math.random() * 10;
    const lng = 78 + Math.random() * 40;

    const toRational = (val) => {
        const degrees = Math.floor(val);
        const minutesDecimal = (val - degrees) * 60;
        const minutes = Math.floor(minutesDecimal);
        const seconds = (minutesDecimal - minutes) * 60;
        return [[degrees, 1], [minutes, 1], [Math.round(seconds * 100), 100]];
    };

    return {
        lat: toRational(lat),
        latRef: 'N',
        lng: toRational(lng),
        lngRef: 'W',
        alt: [[Math.round(10 + Math.random() * 500), 1]]
    };
}

// Create EXIF data
function createExifData(profile, options = {}) {
    const date = generateRandomDate(options.daysBack || 30);
    const dateStr = formatExifDate(date);
    const iso = randomChoice(profile.isoSpeed);
    const exposure = randomChoice(profile.exposureTime);

    const zeroth = {};
    const exif = {};
    const gps = {};

    // IFD0 (Image)
    zeroth[piexif.ImageIFD.Make] = profile.make;
    zeroth[piexif.ImageIFD.Model] = profile.model;
    zeroth[piexif.ImageIFD.Orientation] = 1;
    zeroth[piexif.ImageIFD.XResolution] = [72, 1];
    zeroth[piexif.ImageIFD.YResolution] = [72, 1];
    zeroth[piexif.ImageIFD.ResolutionUnit] = 2;
    zeroth[piexif.ImageIFD.Software] = profile.software;
    zeroth[piexif.ImageIFD.DateTime] = dateStr;

    // EXIF
    exif[piexif.ExifIFD.ExposureTime] = exposure;
    exif[piexif.ExifIFD.FNumber] = [Math.round(profile.fNumber * 10), 10];
    exif[piexif.ExifIFD.ExposureProgram] = 2;
    exif[piexif.ExifIFD.ISOSpeedRatings] = iso;
    exif[piexif.ExifIFD.DateTimeOriginal] = dateStr;
    exif[piexif.ExifIFD.DateTimeDigitized] = dateStr;
    exif[piexif.ExifIFD.ShutterSpeedValue] = [Math.round(Math.log2(exposure[1] / exposure[0]) * 100), 100];
    exif[piexif.ExifIFD.ApertureValue] = [Math.round(2 * Math.log2(profile.fNumber) * 100), 100];
    exif[piexif.ExifIFD.BrightnessValue] = [Math.round(Math.random() * 50 + 50), 10];
    exif[piexif.ExifIFD.ExposureBiasValue] = [0, 10];
    exif[piexif.ExifIFD.MeteringMode] = 5;
    exif[piexif.ExifIFD.Flash] = 0;
    exif[piexif.ExifIFD.FocalLength] = [Math.round(profile.focalLength * 100), 100];
    exif[piexif.ExifIFD.ColorSpace] = 1;
    exif[piexif.ExifIFD.PixelXDimension] = options.width || 4032;
    exif[piexif.ExifIFD.PixelYDimension] = options.height || 3024;
    exif[piexif.ExifIFD.SensingMethod] = 2;
    exif[piexif.ExifIFD.ExposureMode] = 0;
    exif[piexif.ExifIFD.WhiteBalance] = 0;
    exif[piexif.ExifIFD.FocalLengthIn35mmFilm] = Math.round(profile.focalLength * 7);
    exif[piexif.ExifIFD.SceneCaptureType] = 0;
    if (profile.lensModel) {
        exif[piexif.ExifIFD.LensModel] = profile.lensModel;
    }

    // GPS
    if (options.includeGPS !== false) {
        const coords = generateGPSCoordinates();
        gps[piexif.GPSIFD.GPSLatitudeRef] = coords.latRef;
        gps[piexif.GPSIFD.GPSLatitude] = coords.lat;
        gps[piexif.GPSIFD.GPSLongitudeRef] = coords.lngRef;
        gps[piexif.GPSIFD.GPSLongitude] = coords.lng;
        gps[piexif.GPSIFD.GPSAltitudeRef] = 0;
        gps[piexif.GPSIFD.GPSAltitude] = coords.alt;
    }

    return { '0th': zeroth, 'Exif': exif, 'GPS': gps };
}

// Add noise to image buffer
async function addNoise(buffer, intensity) {
    const { data, info } = await sharp(buffer)
        .raw()
        .toBuffer({ resolveWithObject: true });

    for (let i = 0; i < data.length; i++) {
        const noise = (Math.random() + Math.random() + Math.random() - 1.5) * intensity;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
    }

    return sharp(data, {
        raw: {
            width: info.width,
            height: info.height,
            channels: info.channels
        }
    }).jpeg().toBuffer();
}

// Main processing function
async function processImage(inputPath, outputPath, options = {}) {
    console.log('\n🔄 Processing image...');
    console.log(`📁 Input: ${inputPath}`);
    console.log(`📁 Output: ${outputPath}`);

    // Get phone profile
    const phoneKey = options.phone || randomChoice(Object.keys(PHONE_PROFILES));
    const profile = PHONE_PROFILES[phoneKey];

    if (!profile) {
        throw new Error(`Unknown phone: ${phoneKey}`);
    }

    console.log(`📱 Camera: ${profile.make} ${profile.model}`);

    // Read input image
    let image = sharp(inputPath);
    const metadata = await image.metadata();

    // Apply brightness/contrast
    const brightness = options.brightness !== undefined ? options.brightness : -5;
    const contrast = options.contrast !== undefined ? options.contrast : -3;

    // Process with sharp
    let processed = image
        .modulate({
            brightness: 1 + (brightness / 100),
        })
        .linear(1 + (contrast / 100), -(128 * contrast / 100));

    // Apply blur if specified
    const blur = options.blur !== undefined ? options.blur : 0.3;
    if (blur > 0) {
        processed = processed.blur(blur);
    }

    // Convert to JPEG with quality setting
    const quality = options.quality !== undefined ? options.quality : 85;
    let buffer = await processed.jpeg({ quality }).toBuffer();

    // Add noise if specified
    const noise = options.noise !== undefined ? options.noise : 8;
    if (noise > 0) {
        // Re-process with noise
        const { data, info } = await sharp(buffer)
            .raw()
            .toBuffer({ resolveWithObject: true });

        for (let i = 0; i < data.length; i++) {
            const n = (Math.random() + Math.random() + Math.random() - 1.5) * noise;
            data[i] = Math.max(0, Math.min(255, data[i] + n));
        }

        buffer = await sharp(data, {
            raw: { width: info.width, height: info.height, channels: info.channels }
        }).jpeg({ quality }).toBuffer();
    }

    // Add EXIF metadata
    const exifData = createExifData(profile, {
        width: metadata.width,
        height: metadata.height,
        includeGPS: options.includeGPS !== false,
        daysBack: options.daysBack || 30
    });

    const exifBytes = piexif.dump(exifData);
    const jpegData = buffer.toString('binary');
    const newJpegData = piexif.insert(exifBytes, jpegData);

    // Write output
    fs.writeFileSync(outputPath, Buffer.from(newJpegData, 'binary'));

    console.log('\n✅ Processing complete!');
    console.log('━'.repeat(50));
    console.log(`📷 Camera: ${profile.make} ${profile.model}`);
    console.log(`🔧 Software: ${profile.software}`);
    console.log(`⚡ ISO: ${randomChoice(profile.isoSpeed)}`);
    console.log(`🎯 Aperture: f/${profile.fNumber}`);
    console.log(`📐 Focal Length: ${profile.focalLength}mm`);
    console.log(`🌫️  Noise: ${noise}%`);
    console.log(`🔍 Blur: ${blur}px`);
    console.log(`💡 Brightness: ${brightness}%`);
    console.log(`🎨 Contrast: ${contrast}%`);
    console.log(`📊 JPEG Quality: ${quality}%`);
    console.log('━'.repeat(50));

    return outputPath;
}

// Parse command line arguments
function parseArgs(args) {
    const options = {};
    const positional = [];

    args.forEach(arg => {
        if (arg.startsWith('--')) {
            const [key, value] = arg.slice(2).split('=');
            if (value === undefined) {
                if (key.startsWith('no-')) {
                    options[key.slice(3)] = false;
                } else {
                    options[key] = true;
                }
            } else if (!isNaN(value)) {
                options[key] = parseFloat(value);
            } else {
                options[key] = value;
            }
        } else {
            positional.push(arg);
        }
    });

    return { options, positional };
}

// Main CLI
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
📷 Image Post-Processor
=======================

Makes generated images look like real phone photos.

Usage:
  node process-image.js <input> [output] [options]

Options:
  --phone=<profile>     Phone camera profile
  --noise=<0-25>        Noise level (default: 8)
  --blur=<0-2>          Blur radius (default: 0.3)
  --brightness=<-20,20> Brightness (default: -5)
  --contrast=<-20,20>   Contrast (default: -3)
  --quality=<60-95>     JPEG quality (default: 85)
  --no-gps              Disable GPS in EXIF

Phone profiles:
${Object.keys(PHONE_PROFILES).map(k => `  • ${k}: ${PHONE_PROFILES[k].make} ${PHONE_PROFILES[k].model}`).join('\n')}

Examples:
  node process-image.js card.png card_final.jpg
  node process-image.js card.png --phone=iphone14pro
  node process-image.js card.png out.jpg --noise=10 --blur=0.5
        `);
        process.exit(0);
    }

    const { options, positional } = parseArgs(args);

    const inputPath = positional[0];
    let outputPath = positional[1];

    if (!outputPath) {
        const ext = path.extname(inputPath);
        const base = path.basename(inputPath, ext);
        const dir = path.dirname(inputPath);
        outputPath = path.join(dir, `${base}_processed.jpg`);
    }

    if (!fs.existsSync(inputPath)) {
        console.error(`❌ Error: File not found: ${inputPath}`);
        process.exit(1);
    }

    try {
        await processImage(inputPath, outputPath, options);
        console.log(`\n📁 Saved to: ${outputPath}\n`);
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
}

// Export for module use
module.exports = { processImage, PHONE_PROFILES };

// Run if called directly
if (require.main === module) {
    main();
}
