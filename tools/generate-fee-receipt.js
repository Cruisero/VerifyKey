/**
 * Fee Receipt Generator
 * Generates university fee receipts with random but realistic data
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Bank names by country
const BANKS_BY_COUNTRY = {
    BD: ['Islami Bank', 'Sonali Bank', 'Janata Bank', 'Agrani Bank', 'Bangladesh Krishi Bank', 'Rupali Bank', 'BRAC Bank', 'Dutch-Bangla Bank', 'Eastern Bank', 'Prime Bank'],
    IN: ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Punjab National Bank', 'Bank of Baroda', 'Axis Bank', 'Kotak Mahindra Bank', 'IndusInd Bank', 'Yes Bank', 'Union Bank'],
    US: ['Bank of America', 'Chase Bank', 'Wells Fargo', 'Citibank', 'US Bank', 'PNC Bank', 'Capital One', 'TD Bank', 'BB&T', 'SunTrust'],
    UK: ['Barclays', 'HSBC', 'Lloyds Bank', 'NatWest', 'Santander UK', 'Halifax', 'Royal Bank of Scotland', 'TSB Bank', 'Metro Bank', 'Nationwide'],
    PK: ['Habib Bank', 'National Bank of Pakistan', 'United Bank', 'MCB Bank', 'Allied Bank', 'Bank Alfalah', 'Meezan Bank', 'Faysal Bank', 'Askari Bank', 'Summit Bank']
};

// Addresses by country
const ADDRESSES_BY_COUNTRY = {
    BD: [
        'House 45, Road 12, Dhanmondi, Dhaka 1209',
        'Plot 23, Block C, Bashundhara R/A, Dhaka 1229',
        'Uttara Sector 6, Road 14, Dhaka 1230',
        'Mirpur DOHS, Road 8, Dhaka 1216',
        'Gulshan Avenue, Block A, Dhaka 1212'
    ],
    IN: [
        '45 MG Road, Connaught Place, New Delhi 110001',
        '123 Park Street, Kolkata, West Bengal 700016',
        '78 Brigade Road, Bengaluru, Karnataka 560001',
        '56 Marine Drive, Mumbai, Maharashtra 400020',
        '89 Anna Salai, Chennai, Tamil Nadu 600002'
    ],
    US: [
        '123 University Ave, Berkeley, CA 94720',
        '456 Campus Drive, Stanford, CA 94305',
        '789 College Street, Boston, MA 02115',
        '321 Academic Blvd, Ann Arbor, MI 48109',
        '654 Scholar Lane, Austin, TX 78712'
    ],
    UK: [
        '45 Oxford Street, London W1D 2DZ',
        '78 University Road, Cambridge CB2 1TN',
        '23 High Street, Oxford OX1 4AQ',
        '56 Royal Mile, Edinburgh EH1 1YS',
        '89 Victoria Street, Manchester M1 5GH'
    ],
    PK: [
        'F-7/4, Jinnah Avenue, Islamabad 44000',
        'Block 5, Clifton, Karachi 75600',
        'Gulberg III, Main Boulevard, Lahore 54660',
        'Saddar Road, Rawalpindi 46000',
        'University Town, Peshawar 25000'
    ]
};

// Universities by country
const UNIVERSITIES_BY_COUNTRY = {
    BD: ['Uttara Town College', 'Dhaka University', 'BRAC University', 'North South University', 'East West University'],
    IN: ['Delhi University', 'Mumbai University', 'Calcutta University', 'Bangalore University', 'Anna University'],
    US: ['University of California', 'Stanford University', 'MIT', 'Harvard University', 'Yale University'],
    UK: ['Oxford University', 'Cambridge University', 'Imperial College', 'UCL', 'King\'s College London'],
    PK: ['Punjab University', 'Karachi University', 'Quaid-i-Azam University', 'LUMS', 'NUST']
};

// Number to words converter (for amounts)
function numberToWords(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    if (num === 0) return 'Zero';
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + numberToWords(num % 100) : '');
    if (num < 100000) return numberToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + numberToWords(num % 1000) : '');
    if (num < 10000000) return numberToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + numberToWords(num % 100000) : '');
    return num.toString();
}

// Generate random number in range
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Generate random date within last 2 weeks
function generateRecentDate() {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const randomTime = twoWeeksAgo.getTime() + Math.random() * (now.getTime() - twoWeeksAgo.getTime());
    const date = new Date(randomTime);

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);

    return `${day}.${month}.${year}`;
}

// Generate receipt data
function generateReceiptData(studentName, country = 'BD') {
    const countryCode = country.toUpperCase();

    const banks = BANKS_BY_COUNTRY[countryCode] || BANKS_BY_COUNTRY['BD'];
    const addresses = ADDRESSES_BY_COUNTRY[countryCode] || ADDRESSES_BY_COUNTRY['BD'];
    const universities = UNIVERSITIES_BY_COUNTRY[countryCode] || UNIVERSITIES_BY_COUNTRY['BD'];

    const regDate = generateRecentDate();
    const amount = randomInt(10000, 99999);

    return {
        universityName: universities[randomInt(0, universities.length - 1)],
        studentName: studentName.toUpperCase(),
        studentRoll: randomInt(10, 999).toString(),
        centre: String(randomInt(10000, 99999)),
        regDate: regDate,
        instrumentNo: String(randomInt(100000, 999999)),
        instrumentDate: regDate,
        paymentType: countryCode === 'BD' ? 'BDT' : (countryCode === 'IN' ? 'INR' : (countryCode === 'US' ? 'USD' : (countryCode === 'UK' ? 'GBP' : 'PKR'))),
        bank: banks[randomInt(0, banks.length - 1)],
        amount: amount.toString(),
        amountWords: numberToWords(amount),
        address: addresses[randomInt(0, addresses.length - 1)],
        year: new Date().getFullYear().toString()
    };
}

async function generateFeeReceipt(studentName, country = 'BD', outputDir = '/output') {
    console.log(`[FeeReceipt] Generating receipt for ${studentName}...`);

    const templatePath = path.join(__dirname, '..', 'templates', 'fee-receipt.html');

    if (!fs.existsSync(templatePath)) {
        console.error(`[FeeReceipt] Template not found: ${templatePath}`);
        return null;
    }

    const data = generateReceiptData(studentName, country);
    console.log(`[FeeReceipt] Data:`, JSON.stringify(data, null, 2));

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        // Load template
        await page.goto(`file://${templatePath}`, { waitUntil: 'networkidle0' });

        // Fill in data
        await page.evaluate((d) => {
            document.getElementById('cardUniversityName').textContent = d.universityName;
            document.getElementById('cardName').textContent = d.studentName;
            document.getElementById('cardStudentRoll').textContent = d.studentRoll;
            document.getElementById('cardCentre').textContent = d.centre;
            document.getElementById('cardRegDate').textContent = d.regDate;
            document.getElementById('cardInstrumentNo').textContent = d.instrumentNo;
            document.getElementById('cardInstrumentDate').textContent = d.instrumentDate;
            document.getElementById('cardPaymentType').textContent = d.paymentType;
            document.getElementById('cardBank').textContent = d.bank;
            document.getElementById('cardAmount').textContent = d.amount;
            document.getElementById('cardAmountWords').textContent = d.amount;
            document.getElementById('cardAmountText').textContent = d.amountWords;
            document.getElementById('cardAddress').textContent = d.address;
            document.getElementById('cardYear').textContent = d.year;
        }, data);

        // Wait for rendering
        await new Promise(r => setTimeout(r, 500));

        // Capture screenshot
        const receipt = await page.$('#receiptPreview');
        const filename = `receipt_${studentName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.jpg`;
        const outputPath = path.join(outputDir, filename);

        await receipt.screenshot({
            path: outputPath,
            type: 'jpeg',
            quality: 95
        });

        console.log(`[FeeReceipt] ✓ Saved: ${outputPath}`);

        // Read and return image bytes
        const imageBytes = fs.readFileSync(outputPath);

        // Save form data
        const formDataPath = outputPath.replace('.jpg', '.json');
        fs.writeFileSync(formDataPath, JSON.stringify(data, null, 2));

        return {
            imageBytes,
            filename,
            formData: data
        };

    } finally {
        await browser.close();
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const studentName = args[0] || 'Test Student';
    const country = args[1] || 'BD';

    generateFeeReceipt(studentName, country)
        .then(result => {
            if (result) {
                console.log(`\n✅ Receipt generated: ${result.filename}`);
            }
        })
        .catch(err => {
            console.error('Error:', err);
            process.exit(1);
        });
}

module.exports = { generateFeeReceipt, generateReceiptData };
