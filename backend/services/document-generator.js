/**
 * Document Generator for SheerID Verification
 * Generates student ID cards and transcripts using Canvas
 */

const { randomInt, randomChoice } = require('../utils/anti-detect');

// Course names for transcript generation
const COURSES = [
    'Introduction to Computer Science', 'Calculus I', 'English Composition',
    'Physics I', 'Chemistry I', 'Biology I', 'Statistics',
    'Data Structures', 'Linear Algebra', 'Organic Chemistry',
    'Microeconomics', 'Macroeconomics', 'Psychology 101',
    'American History', 'Philosophy', 'Art History',
    'Programming Languages', 'Discrete Mathematics', 'Algorithms',
    'Database Systems', 'Operating Systems', 'Computer Networks'
];

// Grades for transcript
const GRADES = ['A', 'A', 'A', 'A-', 'A-', 'B+', 'B+', 'B', 'B', 'B-', 'C+'];

// Color schemes for documents (adds variety to avoid pattern detection)
const COLOR_SCHEMES = [
    { primary: '#1a365d', secondary: '#2c5282', accent: '#4299e1', text: '#1a202c' },
    { primary: '#22543d', secondary: '#276749', accent: '#48bb78', text: '#1a202c' },
    { primary: '#742a2a', secondary: '#9b2c2c', accent: '#fc8181', text: '#1a202c' },
    { primary: '#44337a', secondary: '#553c9a', accent: '#9f7aea', text: '#1a202c' },
    { primary: '#234e52', secondary: '#285e61', accent: '#38b2ac', text: '#1a202c' },
    { primary: '#744210', secondary: '#975a16', accent: '#ecc94b', text: '#1a202c' },
];

/**
 * Generate a random student ID number
 */
function generateStudentId() {
    const year = randomInt(21, 25);
    const num = randomInt(100000, 999999);
    return `${year}${num}`;
}

/**
 * Generate a random barcode pattern (visual representation)
 */
function generateBarcodeData() {
    let barcode = '';
    for (let i = 0; i < 40; i++) {
        barcode += randomInt(0, 1) ? '1' : '0';
    }
    return barcode;
}

/**
 * Add noise to image data for anti-detection
 * @param {Buffer} imageBuffer - PNG image buffer
 */
function addImageNoise(imageBuffer) {
    // Convert to array and add subtle noise
    const arr = [...imageBuffer];
    const noiseCount = Math.floor(arr.length * 0.001); // 0.1% noise

    for (let i = 0; i < noiseCount; i++) {
        const pos = randomInt(100, arr.length - 100);
        // Only modify non-critical bytes (avoid PNG headers)
        if (pos > 100) {
            arr[pos] = (arr[pos] + randomInt(-2, 2) + 256) % 256;
        }
    }

    return Buffer.from(arr);
}

/**
 * Generate student ID card image as Base64 PNG
 * Uses simple SVG since canvas may not be available
 */
function generateStudentIdCard(firstName, lastName, universityName) {
    const colors = randomChoice(COLOR_SCHEMES);
    const studentId = generateStudentId();
    const fullName = `${firstName} ${lastName}`;
    const year = randomInt(2024, 2027);

    // Random position offsets for anti-detection
    const offsetX = randomInt(-3, 3);
    const offsetY = randomInt(-3, 3);

    // Generate SVG student ID card
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250">
  <!-- Background -->
  <rect width="400" height="250" fill="${colors.primary}" rx="10"/>
  
  <!-- Header stripe -->
  <rect y="0" width="400" height="60" fill="${colors.secondary}" rx="10"/>
  <rect y="30" width="400" height="30" fill="${colors.secondary}"/>
  
  <!-- University name -->
  <text x="${200 + offsetX}" y="${40 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="16" font-weight="bold" text-anchor="middle">${universityName}</text>
  
  <!-- Photo placeholder -->
  <rect x="${20 + offsetX}" y="${80 + offsetY}" width="90" height="110" fill="#e2e8f0" rx="5"/>
  <text x="${65 + offsetX}" y="${140 + offsetY}" fill="#718096" font-family="Arial" font-size="12" text-anchor="middle">PHOTO</text>
  
  <!-- Student info -->
  <text x="${130 + offsetX}" y="${100 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="11" opacity="0.8">STUDENT NAME</text>
  <text x="${130 + offsetX}" y="${120 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="16" font-weight="bold">${fullName}</text>
  
  <text x="${130 + offsetX}" y="${150 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="11" opacity="0.8">STUDENT ID</text>
  <text x="${130 + offsetX}" y="${170 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="14">${studentId}</text>
  
  <text x="${280 + offsetX}" y="${150 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="11" opacity="0.8">VALID THRU</text>
  <text x="${280 + offsetX}" y="${170 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="14">08/${year}</text>
  
  <!-- Barcode area -->
  <rect x="20" y="210" width="360" height="30" fill="white" rx="3"/>
  <text x="200" y="230" fill="#333" font-family="Courier New, monospace" font-size="14" text-anchor="middle">${studentId}</text>
</svg>`;

    // Convert SVG to base64
    const base64 = Buffer.from(svg).toString('base64');
    return {
        data: Buffer.from(svg),
        base64: base64,
        mimeType: 'image/svg+xml',
        studentId: studentId
    };
}

/**
 * Generate academic transcript as SVG
 */
function generateTranscript(firstName, lastName, universityName, birthDate) {
    const colors = randomChoice(COLOR_SCHEMES);
    const studentId = generateStudentId();
    const fullName = `${firstName} ${lastName}`;

    // Generate random courses with grades
    const selectedCourses = [];
    const usedCourses = new Set();
    for (let i = 0; i < randomInt(6, 10); i++) {
        let course;
        do {
            course = randomChoice(COURSES);
        } while (usedCourses.has(course));
        usedCourses.add(course);
        selectedCourses.push({
            name: course,
            credits: randomInt(3, 4),
            grade: randomChoice(GRADES)
        });
    }

    // Calculate GPA
    const gradePoints = { 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7, 'C+': 2.3 };
    let totalPoints = 0;
    let totalCredits = 0;
    selectedCourses.forEach(c => {
        totalPoints += gradePoints[c.grade] * c.credits;
        totalCredits += c.credits;
    });
    const gpa = (totalPoints / totalCredits).toFixed(2);

    // Random offsets
    const offsetX = randomInt(-2, 2);
    const offsetY = randomInt(-2, 2);

    // Build course rows
    let courseRows = '';
    let yPos = 200;
    selectedCourses.forEach(course => {
        courseRows += `
    <text x="${50 + offsetX}" y="${yPos}" fill="#333" font-family="Arial" font-size="11">${course.name}</text>
    <text x="${350 + offsetX}" y="${yPos}" fill="#333" font-family="Arial" font-size="11" text-anchor="middle">${course.credits}</text>
    <text x="${420 + offsetX}" y="${yPos}" fill="#333" font-family="Arial" font-size="11" text-anchor="middle">${course.grade}</text>`;
        yPos += 25;
    });

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="500" height="${yPos + 100}" viewBox="0 0 500 ${yPos + 100}">
  <!-- Background -->
  <rect width="500" height="${yPos + 100}" fill="#fafafa"/>
  
  <!-- Header -->
  <rect width="500" height="80" fill="${colors.primary}"/>
  <text x="${250 + offsetX}" y="${35 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="18" font-weight="bold" text-anchor="middle">${universityName}</text>
  <text x="${250 + offsetX}" y="${60 + offsetY}" fill="white" font-family="Arial, sans-serif" font-size="14" text-anchor="middle">OFFICIAL ACADEMIC TRANSCRIPT</text>
  
  <!-- Student Info -->
  <text x="50" y="110" fill="#666" font-family="Arial" font-size="11">Student Name:</text>
  <text x="150" y="110" fill="#333" font-family="Arial" font-size="12" font-weight="bold">${fullName}</text>
  
  <text x="300" y="110" fill="#666" font-family="Arial" font-size="11">Student ID:</text>
  <text x="380" y="110" fill="#333" font-family="Arial" font-size="12">${studentId}</text>
  
  <text x="50" y="135" fill="#666" font-family="Arial" font-size="11">Date of Birth:</text>
  <text x="150" y="135" fill="#333" font-family="Arial" font-size="12">${birthDate}</text>
  
  <text x="300" y="135" fill="#666" font-family="Arial" font-size="11">Cumulative GPA:</text>
  <text x="400" y="135" fill="${colors.accent}" font-family="Arial" font-size="14" font-weight="bold">${gpa}</text>
  
  <!-- Divider -->
  <line x1="40" y1="155" x2="460" y2="155" stroke="#ccc" stroke-width="1"/>
  
  <!-- Course Header -->
  <text x="50" y="180" fill="${colors.primary}" font-family="Arial" font-size="12" font-weight="bold">Course Name</text>
  <text x="350" y="180" fill="${colors.primary}" font-family="Arial" font-size="12" font-weight="bold" text-anchor="middle">Credits</text>
  <text x="420" y="180" fill="${colors.primary}" font-family="Arial" font-size="12" font-weight="bold" text-anchor="middle">Grade</text>
  
  <!-- Courses -->
  ${courseRows}
  
  <!-- Footer -->
  <line x1="40" y1="${yPos + 20}" x2="460" y2="${yPos + 20}" stroke="#ccc" stroke-width="1"/>
  <text x="250" y="${yPos + 50}" fill="#666" font-family="Arial" font-size="10" text-anchor="middle">This is an official document. Total Credits: ${totalCredits}</text>
  <text x="250" y="${yPos + 70}" fill="#999" font-family="Arial" font-size="9" text-anchor="middle">Generated: ${new Date().toISOString().split('T')[0]}</text>
</svg>`;

    return {
        data: Buffer.from(svg),
        base64: Buffer.from(svg).toString('base64'),
        mimeType: 'image/svg+xml',
        studentId: studentId,
        gpa: gpa
    };
}

/**
 * Generate document (either student ID or transcript)
 * @param {string} type - 'id_card' or 'transcript'
 */
function generateDocument(type, firstName, lastName, universityName, birthDate = '') {
    if (type === 'transcript' || Math.random() < 0.5) {
        return {
            ...generateTranscript(firstName, lastName, universityName, birthDate),
            type: 'transcript',
            fileName: 'transcript.svg'
        };
    } else {
        return {
            ...generateStudentIdCard(firstName, lastName, universityName),
            type: 'id_card',
            fileName: 'student_id.svg'
        };
    }
}

module.exports = {
    generateStudentIdCard,
    generateTranscript,
    generateDocument,
    generateStudentId,
};
