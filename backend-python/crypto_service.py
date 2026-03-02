"""
Crypto Payment Service — Multi-network USDT blockchain polling.
Supports: USDT-TRC20 (TRON), USDT-BEP20 (BSC), Binance Pay (manual).

No third-party payment gateway. Polls blockchain APIs directly to detect
incoming USDT transfers and match them to pending orders by amount.
"""
import asyncio
import json
import os
import logging
import httpx
from typing import Optional

import bot_data

logger = logging.getLogger(__name__)

# ==================== Constants ====================

# USDT-TRC20 (TRON)
TRC20_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
TRONGRID_API = "https://api.trongrid.io"

# USDT-BEP20 (BSC)
BSC_USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955"
BSC_RPC_URLS = [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.binance.org/",
    "https://bsc-dataseed2.binance.org/",
]

POLL_INTERVAL = 30  # seconds

# Bot config file path
BOT_CONFIG_FILE = os.path.join(bot_data.DATA_DIR, "bot_config.json")

# Last known BSC balance for balance-change detection
_last_bsc_balance = None


# ==================== Config Management ====================

def load_bot_config() -> dict:
    """Load bot configuration from JSON file."""
    if os.path.exists(BOT_CONFIG_FILE):
        try:
            with open(BOT_CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load bot config: {e}")
    return get_default_config()


def save_bot_config(config: dict):
    """Save bot configuration to JSON file."""
    os.makedirs(bot_data.DATA_DIR, exist_ok=True)
    try:
        with open(BOT_CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to save bot config: {e}")


def get_default_config() -> dict:
    return {
        "botName": "SheerID Verifier",
        "welcomeMessage": "Your premium gateway to instant student verifications.",
        "contactSupport": "@Terato1",
        # TRC20
        "trc20WalletAddress": "",
        "trc20Enabled": False,
        # BSC (BEP20)
        "bscWalletAddress": "",
        "bscEnabled": False,
        # Binance Pay
        "binancePayId": "",
        "binancePayEnabled": False,
        # General
        "dailyCredits": 1,
        "services": [
            {"name": "Gemini", "emoji": "🎵", "credits": 8},
        ],
    }


# ==================== TRC20 Polling ====================

async def get_recent_trc20_transactions(wallet_address: str, limit: int = 50) -> list:
    """Query TronGrid API for recent TRC20 transfers to the wallet."""
    if not wallet_address:
        return []

    url = (
        f"{TRONGRID_API}/v1/accounts/{wallet_address}"
        f"/transactions/trc20?limit={limit}"
        f"&contract_address={TRC20_USDT_CONTRACT}"
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", [])
    except Exception as e:
        logger.error(f"TronGrid API error: {e}")
        return []


async def check_trc20_payments(config: dict, pending_orders: list, bot=None):
    """Check TRC20 pending orders against blockchain."""
    wallet = config.get("trc20WalletAddress", "")
    if not config.get("trc20Enabled") or not wallet:
        return

    trc20_orders = [o for o in pending_orders if o.get("network") == "trc20"]
    if not trc20_orders:
        return

    transactions = await get_recent_trc20_transactions(wallet)

    for tx in transactions:
        if tx.get("to") != wallet:
            continue

        try:
            tx_amount = float(tx.get("value", "0")) / 1_000_000  # 6 decimals
        except (ValueError, TypeError):
            continue

        tx_hash = tx.get("transaction_id", "")

        for order in trc20_orders:
            order_amount = order.get("usdt_amount", 0)
            if abs(tx_amount - order_amount) < 0.001:
                # Check if already processed
                all_orders = bot_data.get_all_orders()
                if any(o.get("tx_hash") == tx_hash and o.get("status") == "confirmed" for o in all_orders):
                    continue

                logger.info(f"TRC20 payment matched! Order {order['id']}: {tx_amount} USDT, TX: {tx_hash}")
                confirmed = bot_data.confirm_order(order["id"], tx_hash)
                if confirmed and bot:
                    await _notify_payment_success(bot, confirmed, tx_amount, "TRON (TRC-20)", tx_hash)
                trc20_orders = [o for o in trc20_orders if o["id"] != order["id"]]
                break


# ==================== BSC (BEP20) Polling ====================

async def get_bsc_usdt_balance(wallet_address: str) -> float:
    """Query BSC USDT balance via RPC (free, no API key needed)."""
    balance_of_selector = "0x70a08231"
    padded_address = wallet_address.replace("0x", "").lower().zfill(64)
    data = balance_of_selector + padded_address

    for rpc_url in BSC_RPC_URLS:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(rpc_url, json={
                    "jsonrpc": "2.0",
                    "method": "eth_call",
                    "params": [{"to": BSC_USDT_CONTRACT, "data": data}, "latest"],
                    "id": 1
                })
                result = resp.json()
                if result.get("result"):
                    balance_wei = int(result["result"], 16)
                    return balance_wei / 1e18  # BSC USDT = 18 decimals
        except Exception:
            continue

    raise Exception("All BSC RPC nodes failed")


async def check_bsc_payments(config: dict, pending_orders: list, bot=None):
    """Check BSC pending orders via balance-change detection."""
    global _last_bsc_balance

    wallet = config.get("bscWalletAddress", "")
    if not config.get("bscEnabled") or not wallet:
        return

    bsc_orders = [o for o in pending_orders if o.get("network") == "bsc"]
    if not bsc_orders:
        return

    try:
        current_balance = await get_bsc_usdt_balance(wallet)
    except Exception as e:
        logger.error(f"BSC balance check failed: {e}")
        return

    if _last_bsc_balance is None:
        _last_bsc_balance = current_balance
        logger.info(f"BSC USDT initial balance: {current_balance}")
        return

    diff = current_balance - _last_bsc_balance
    if diff <= 0:
        return

    logger.info(f"BSC USDT balance change: +{diff:.6f} (was {_last_bsc_balance}, now {current_balance})")

    # Try single-order match
    matched = next((o for o in bsc_orders if abs(diff - o["usdt_amount"]) < 0.01), None)
    if matched:
        virtual_tx = f"bsc_balance_{int(asyncio.get_event_loop().time())}_{matched['id']}"
        logger.info(f"BSC payment matched! Order {matched['id']}: {diff:.6f} USDT")
        confirmed = bot_data.confirm_order(matched["id"], virtual_tx)
        if confirmed and bot:
            await _notify_payment_success(bot, confirmed, diff, "BSC (BEP-20)", virtual_tx[:24])

    _last_bsc_balance = current_balance


# ==================== Shared Helpers ====================

async def _notify_payment_success(bot, order: dict, amount: float, network: str, tx_ref: str):
    """Edit photo caption to show payment success, or send new message as fallback."""
    try:
        user = bot_data.get_user(order["telegram_id"])
        balance = user.get("credits", 0) if user else 0

        success_text = (
            f"✅ Payment Confirmed!\n\n"
            f"💰 Received: {amount:.2f} USDT\n"
            f"🌐 Network: {network}\n"
            f"🎁 Credits added: {order['credits_to_add']}\n"
            f"💳 Balance: {balance} credits\n\n"
            f"Thank you for your purchase!"
        )

        # Try to delete the original photo message
        chat_id = order.get("chat_id")
        message_id = order.get("message_id")

        if chat_id and message_id:
            try:
                await bot.delete_message(chat_id=chat_id, message_id=message_id)
            except Exception as e:
                logger.warning(f"Could not delete photo message for order {order['id']}: {e}")

        # Send a clean new text message with success info
        await bot.send_message(
            order["telegram_id"],
            f"✅ **Payment Confirmed!**\n\n"
            f"💰 Received: `{amount:.2f}` USDT\n"
            f"🌐 Network: {network}\n"
            f"🎁 Credits added: `{order['credits_to_add']}`\n"
            f"💳 Balance: `{balance}` credits\n\n"
            f"🔗 Ref: `{tx_ref}`",
            parse_mode="Markdown",
        )
    except Exception as e:
        logger.error(f"Failed to notify user {order['telegram_id']}: {e}")


# ==================== Main Polling Loop ====================

async def check_all_payments(bot=None):
    """Poll all enabled networks for pending payments."""
    config = load_bot_config()
    bot_data.expire_old_orders(max_age_hours=24)
    pending_orders = bot_data.get_pending_orders()
    if not pending_orders:
        return

    # Check TRC20
    await check_trc20_payments(config, pending_orders, bot)
    # Check BSC
    await check_bsc_payments(config, pending_orders, bot)
    # Binance Pay is manual — no auto-polling


async def start_polling(bot=None):
    """Start background payment polling loop."""
    logger.info("Multi-network payment monitor started (TRC20 + BSC)")
    while True:
        try:
            await check_all_payments(bot)
        except Exception as e:
            logger.exception(f"Payment polling error: {e}")
        await asyncio.sleep(POLL_INTERVAL)
