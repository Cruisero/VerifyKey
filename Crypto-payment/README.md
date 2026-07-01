# Kashop Cryptocurrency Payment Module (USDT/BSC)
This package contains the standalone implementation of USDT-TRC20 (TRON) and USDT-BEP20 (BSC) payments, extracted from the Kashop project for reuse.

## File Structure
- `backend/usdtService.js`: TRON network (TRC20) USDT payment generation and polling implementation.
- `backend/bscUsdtService.js`: Binance Smart Chain (BEP20) USDT payment generation and polling implementation.
- `backend/integration-examples.js`: Examples of how to call the services from an Express/Node.js controller to generate a checkout session.
- `frontend/Checkout-example.jsx`: Example React component for displaying the crypto payment UI (Amount, Wallet Address, QR Code, and polling status).

## Features
- **No Third-Party APIM/Gateways**: Interacts directly with the blockchain (TronGrid API and Binance Smart Chain RPC elements).
- **Auto-Confirmations**: Uses background polling (`startPolling`) to verify transactions on-chain.
- **Zero Fees**: Merchants receive funds directly to their non-custodial wallets.

## Required Dependencies (Node.js/Backend)
```bash
npm install node-fetch   # Required for TronGrid HTTP API calls
npm install ethers       # Required for BSC JSON-RPC Web3 interactions
# Note: Prisma ORM is used in the examples, but it can be replaced with any database driver.
```

## How to use

### 1. Database & Config
The current implementation expects a `prisma.setting` table and `prisma.order` table. You should modify the `getConfig()` and `confirmOrder()` functions inside both `usdtService.js` and `bscUsdtService.js` to match your new project's database queries.

### 2. Initialization
Call `startPolling()` once when your server starts up. This will begin the loop that checks pending crypto orders against the blockchain to see if funds have arrived.

### 3. Creating a Payment
When a user checks out, call `createUsdtPayment(order)` or `createBscUsdtPayment(order)`. This calculates the exact crypto amount needed based on your exchange rate and returns the merchant wallet address for the user to transfer to.

### 4. Displaying UI
Pass the returned `walletAddress`, `usdtAmount`, and `exchangeRate` to your frontend. Render a QR code containing the `walletAddress` to make it easy for mobile wallets to scan.
