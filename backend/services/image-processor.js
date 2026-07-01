/**
 * Image Post-Processor Service
 * 
 * Applies realistic camera effects and EXIF metadata to generated images
 * to make them look like real phone photos.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Lazy load piexifjs to avoid startup issues
let piexif = null;
function getPiexif() {
    if (!piexif) {
        try {
            piexif = require('piexifjs');
        } catch (e) {
            console.warn('piexifjs not available, EXIF will be skipped');
            return null;
        }
    }
    return piexif;
}

// Phone camera profiles with realistic settings
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
    const piexifLib = getPiexif();
    if (!piexifLib) return null;

    const date = generateRandomDate(options.daysBack || 30);
    const dateStr = formatExifDate(date);
    const iso = randomChoice(profile.isoSpeed);
    const exposure = randomChoice(profile.exposureTime);

    const zeroth = {};
    const exif = {};
    const gps = {};

    // IFD0 (Image)
    zeroth[piexifLib.ImageIFD.Make] = profile.make;
    zeroth[piexifLib.ImageIFD.Model] = profile.model;
    zeroth[piexifLib.ImageIFD.Orientation] = 1;
    zeroth[piexifLib.ImageIFD.XResolution] = [72, 1];
    zeroth[piexifLib.ImageIFD.YResolution] = [72, 1];
    zeroth[piexifLib.ImageIFD.ResolutionUnit] = 2;
    zeroth[piexifLib.ImageIFD.Software] = profile.software;
    zeroth[piexifLib.ImageIFD.DateTime] = dateStr;

    // EXIF
    exif[piexifLib.ExifIFD.ExposureTime] = exposure;
    exif[piexifLib.ExifIFD.FNumber] = [Math.round(profile.fNumber * 10), 10];
    exif[piexifLib.ExifIFD.ExposureProgram] = 2;
    exif[piexifLib.ExifIFD.ISOSpeedRatings] = iso;
    exif[piexifLib.ExifIFD.DateTimeOriginal] = dateStr;
    exif[piexifLib.ExifIFD.DateTimeDigitized] = dateStr;
    exif[piexifLib.ExifIFD.ShutterSpeedValue] = [Math.round(Math.log2(exposure[1] / exposure[0]) * 100), 100];
    exif[piexifLib.ExifIFD.ApertureValue] = [Math.round(2 * Math.log2(profile.fNumber) * 100), 100];
    exif[piexifLib.ExifIFD.BrightnessValue] = [Math.round(Math.random() * 50 + 50), 10];
    exif[piexifLib.ExifIFD.ExposureBiasValue] = [0, 10];
    exif[piexifLib.ExifIFD.MeteringMode] = 5;
    exif[piexifLib.ExifIFD.Flash] = 0;
    exif[piexifLib.ExifIFD.FocalLength] = [Math.round(profile.focalLength * 100), 100];
    exif[piexifLib.ExifIFD.ColorSpace] = 1;
    exif[piexifLib.ExifIFD.PixelXDimension] = options.width || 4032;
    exif[piexifLib.ExifIFD.PixelYDimension] = options.height || 3024;
    exif[piexifLib.ExifIFD.SensingMethod] = 2;
    exif[piexifLib.ExifIFD.ExposureMode] = 0;
    exif[piexifLib.ExifIFD.WhiteBalance] = 0;
    exif[piexifLib.ExifIFD.FocalLengthIn35mmFilm] = Math.round(profile.focalLength * 7);
    exif[piexifLib.ExifIFD.SceneCaptureType] = 0;
    if (profile.lensModel) {
        exif[piexifLib.ExifIFD.LensModel] = profile.lensModel;
    }

    // GPS
    if (options.includeGPS !== false) {
        const coords = generateGPSCoordinates();
        gps[piexifLib.GPSIFD.GPSLatitudeRef] = coords.latRef;
        gps[piexifLib.GPSIFD.GPSLatitude] = coords.lat;
        gps[piexifLib.GPSIFD.GPSLongitudeRef] = coords.lngRef;
        gps[piexifLib.GPSIFD.GPSLongitude] = coords.lng;
        gps[piexifLib.GPSIFD.GPSAltitudeRef] = 0;
        gps[piexifLib.GPSIFD.GPSAltitude] = coords.alt;
    }

    return { '0th': zeroth, 'Exif': exif, 'GPS': gps };
}

/**
 * Post-process an image buffer to look like a real camera photo
 * 
 * @param {Buffer} inputBuffer - Input image buffer (PNG or JPEG)
 * @param {Object} options - Processing options
 * @param {string} options.phone - Phone profile to use (default: random)
 * @param {number} options.noise - Noise level 0-25 (default: 8)
 * @param {number} options.blur - Blur radius 0-2 (default: 0.3)
 * @param {number} options.brightness - Brightness adjust -20 to 20 (default: -5)
 * @param {number} options.contrast - Contrast adjust -20 to 20 (default: -3)
 * @param {number} options.quality - JPEG quality 60-95 (default: 85)
 * @param {boolean} options.includeGPS - Include GPS in EXIF (default: true)
 * @returns {Promise<Buffer>} - Processed JPEG buffer with EXIF
 */
async function postProcessImage(inputBuffer, options = {}) {
    const startTime = Date.now();

    // Get phone profile
    const phoneKey = options.phone || randomChoice(Object.keys(PHONE_PROFILES));
    const profile = PHONE_PROFILES[phoneKey];

    if (!profile) {
        throw new Error(`Unknown phone profile: ${phoneKey}`);
    }

    console.log(`[PostProcess] Using camera: ${profile.make} ${profile.model}`);

    // Default settings
    const noise = options.noise !== undefined ? options.noise : 8;
    const blur = options.blur !== undefined ? options.blur : 0.3;
    const brightness = options.brightness !== undefined ? options.brightness : -5;
    const contrast = options.contrast !== undefined ? options.contrast : -3;
    const quality = options.quality !== undefined ? options.quality : 85;

    // Start with sharp processing
    let image = sharp(inputBuffer);
    const metadata = await image.metadata();

    // Apply brightness/contrast
    let processed = image
        .modulate({
            brightness: 1 + (brightness / 100),
        })
        .linear(1 + (contrast / 100), -(128 * contrast / 100));

    // Apply blur if specified
    if (blur > 0) {
        processed = processed.blur(blur);
    }

    // Convert to JPEG with quality setting
    let buffer = await processed.jpeg({ quality }).toBuffer();

    // Add noise if specified
    if (noise > 0) {
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
    const piexifLib = getPiexif();
    if (piexifLib) {
        try {
            const exifData = createExifData(profile, {
                width: metadata.width,
                height: metadata.height,
                includeGPS: options.includeGPS !== false,
                daysBack: options.daysBack || 30
            });

            if (exifData) {
                const exifBytes = piexifLib.dump(exifData);
                const jpegData = buffer.toString('binary');
                const newJpegData = piexifLib.insert(exifBytes, jpegData);
                buffer = Buffer.from(newJpegData, 'binary');
                console.log(`[PostProcess] EXIF metadata added`);
            }
        } catch (exifError) {
            console.warn(`[PostProcess] EXIF insertion failed: ${exifError.message}`);
        }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[PostProcess] Complete in ${elapsed}ms - noise:${noise} blur:${blur} brightness:${brightness} contrast:${contrast}`);

    return buffer;
}

/**
 * Post-process an image file
 * 
 * @param {string} inputPath - Input file path
 * @param {string} outputPath - Output file path (will be JPEG)
 * @param {Object} options - Processing options (same as postProcessImage)
 * @returns {Promise<string>} - Output file path
 */
async function postProcessImageFile(inputPath, outputPath, options = {}) {
    const inputBuffer = fs.readFileSync(inputPath);
    const outputBuffer = await postProcessImage(inputBuffer, options);

    // Ensure output path ends with .jpg
    if (!outputPath.toLowerCase().endsWith('.jpg') && !outputPath.toLowerCase().endsWith('.jpeg')) {
        outputPath = outputPath.replace(/\.[^.]+$/, '.jpg');
    }

    fs.writeFileSync(outputPath, outputBuffer);
    console.log(`[PostProcess] Saved to: ${outputPath}`);

    return outputPath;
}

/**
 * Post-process a base64 image
 * 
 * @param {string} base64Data - Base64 encoded image (with or without data URI prefix)
 * @param {Object} options - Processing options (same as postProcessImage)
 * @returns {Promise<string>} - Processed base64 JPEG string (without data URI prefix)
 */
async function postProcessBase64(base64Data, options = {}) {
    // Remove data URI prefix if present
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(base64Clean, 'base64');

    const outputBuffer = await postProcessImage(inputBuffer, options);

    return outputBuffer.toString('base64');
}

module.exports = {
    postProcessImage,
    postProcessImageFile,
    postProcessBase64,
    PHONE_PROFILES
};
