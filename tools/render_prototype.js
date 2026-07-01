const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    const templatePath = path.join(__dirname, '../backend-python/templates/OnepassHTML/design-lab.html');
    await page.goto(`file://${templatePath}`, { waitUntil: 'networkidle0' });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);

    const element = await page.$('.container');

    // Add some padding to the screenshot
    const box = await element.boundingBox();
    const padding = 20;

    await page.screenshot({
        path: path.join(__dirname, '../output/stamp_prototype.png'),
        clip: {
            x: box.x - padding,
            y: box.y - padding,
            width: box.width + padding * 2,
            height: box.height + padding * 2
        }
    });

    await browser.close();
    console.log('Prototype saved to output/stamp_prototype.png');
})();
