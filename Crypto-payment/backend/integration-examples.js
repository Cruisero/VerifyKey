/**
 * Kashop USDT/BSC Cryptocurrency Payment Integration Example
 * 
 * This file contains snippets showing how to integrate usdtService.js and bscUsdtService.js
 * into your Express/Node.js controllers.
 */

// 1. Controller Integration for Checkout
async function checkout(req, res, next) {
    try {
        const { orderId, paymentMethod } = req.body;
        // Fetch order from DB...
        const order = { id: orderId, totalAmount: 100, orderNo: 'ORD1234' };
        const paymentData = {};

        if (paymentMethod === 'usdt') {
            const usdtService = require('../services/usdtService');
            // Creates the payment intent and gets the recipient wallet & calculated crypto amount
            const usdtInfo = await usdtService.createUsdtPayment(order);
            paymentData = {
                paymentType: 'usdt',
                walletAddress: usdtInfo.walletAddress,
                usdtAmount: usdtInfo.usdtAmount,
                qrContent: usdtInfo.qrContent,
                exchangeRate: usdtInfo.exchangeRate
            };
        } else if (paymentMethod === 'bsc_usdt') {
            const bscUsdtService = require('../services/bscUsdtService');
            const bscInfo = await bscUsdtService.createBscUsdtPayment(order);
            paymentData = {
                paymentType: 'bsc_usdt',
                walletAddress: bscInfo.walletAddress,
                usdtAmount: bscInfo.usdtAmount,
                qrContent: bscInfo.qrContent,
                exchangeRate: bscInfo.exchangeRate
            };
        }

        res.json({
            ...paymentData,
            orderNo: order.orderNo,
            amount: parseFloat(order.totalAmount)
        });
    } catch (error) {
        next(error);
    }
}

// 2. Initializing Polling Service Automatically on Boot
// Add this to your main server.js / app.js
/*
const usdtService = require('./services/usdtService');
const bscUsdtService = require('./services/bscUsdtService');

// Start the blockchain polling loops
usdtService.startPolling().catch(err => console.error('USDT Polling Error:', err));
bscUsdtService.startPolling().catch(err => console.error('BSC Polling Error:', err));

// When shutting down safely
process.on('SIGTERM', () => {
    usdtService.stopPolling();
    bscUsdtService.stopPolling();
});
*/
