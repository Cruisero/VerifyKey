/**
 * Crypto Payment UI Example (React)
 * This snippet demonstrates how to display the payment QR code and amount
 * for USDT (TRC20) and BSC USDT (BEP20).
 */
import React, { useState, useEffect } from 'react';

function CryptoPaymentDisplay({ orderData }) {
    // orderData is the response from the checkout controller:
    // { paymentType, walletAddress, usdtAmount, qrContent, exchangeRate }

    const isCrypto = ['usdt', 'bsc_usdt', 'USDT-TRC20', 'USDT-BEP20'].includes(orderData.paymentType);

    if (!isCrypto) return null;

    return (
        <div className="crypto-payment-box">
            <h4>
                {orderData.paymentType.includes('bsc')
                    ? '🟡 USDT-BEP20 (BSC) 支付'
                    : '💎 USDT-TRC20 (TRON) 支付'}
            </h4>

            <div className="crypto-amount-box">
                <span className="label">需支付金额：</span>
                <span className="usdt-amount">{orderData.usdtAmount} USDT</span>
            </div>

            <div className="crypto-qr-container">
                {/* 
                 * You can use a library like qrcode.react to generate the QR code 
                 * import { QRCodeSVG } from 'qrcode.react';
                 */}
                {/* <QRCodeSVG value={orderData.qrContent || orderData.walletAddress} size={200} /> */}
                <div className="qr-placeholder" style={{ width: 200, height: 200, background: '#eee' }}>
                    [QR Code Placeholder for: {orderData.walletAddress}]
                </div>
            </div>

            <div className="crypto-details">
                <div className="detail-item">
                    <p>收款地址：</p>
                    <strong>{orderData.walletAddress}</strong>
                    <button onClick={() => navigator.clipboard.writeText(orderData.walletAddress)}>
                        复制地址
                    </button>
                </div>
                <div className="detail-item">
                    <p>汇率：1 USDT = ¥{orderData.exchangeRate}</p>
                </div>
                <div className="warning-note" style={{ color: '#d97706', marginTop: '1rem' }}>
                    ⚠️ 请务必转账准确金额 <strong>{orderData.usdtAmount} USDT</strong>，
                    金额不符或网络选择错误将导致无法自动确认并造成资产丢失。
                </div>
            </div>

            <p className="loading-text">🔄 正在等待区块链确认，成功付款后页面将自动跳转...</p>
        </div>
    );
}

export default CryptoPaymentDisplay;
