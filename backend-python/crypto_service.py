"""
Crypto Payment Service — USDT TRC20 (TRON) blockchain polling.
Ported from Crypto-payment/backend/usdtService.js to Python.

No third-party payment gateway. Polls TronGrid API directly to detect
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

# USDT-TRC20 contract address on TRON mainnet
USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
TRONGRID_API = "https://api.trongrid.io"
POLL_INTERVAL = 30  # seconds

# Bot config file path
BOT_CONFIG_FILE = os.path.join(bot_data.DATA_DIR, "bot_config.json")


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
        "usdtWalletAddress": "",
        "usdtEnabled": False,
        "creditPrice": 1.0,  # 1 USDT = how many credits
        "dailyCredits": 1,
        "services": [
            {"name": "Spotify", "emoji": "🎵", "credits": 5},
        ],
    }


async def get_recent_trc20_transactions(wallet_address: str, limit: int = 50) -> list:
    """
    Query TronGrid API for recent TRC20 transfers to the wallet.
    Returns list of incoming USDT transactions.
    """
    if not wallet_address:
        return []

    url = (
        f"{TRONGRID_API}/v1/accounts/{wallet_address}"
        f"/transactions/trc20?limit={limit}"
        f"&contract_address={USDT_CONTRACT}"
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


async def check_usdt_payments(bot=None):
    """
    Poll blockchain and match incoming transfers to pending orders.
    If a match is found, confirm the order and notify the user via Telegram.
    """
    config = load_bot_config()
    wallet = config.get("usdtWalletAddress", "")

    if not config.get("usdtEnabled") or not wallet:
        return

    # Expire stale orders first
    bot_data.expire_old_orders(max_age_hours=24)

    pending_orders = bot_data.get_pending_orders()
    if not pending_orders:
        return

    transactions = await get_recent_trc20_transactions(wallet)

    for tx in transactions:
        # Only process incoming transfers
        if tx.get("to") != wallet:
            continue

        # USDT-TRC20 has 6 decimal places
        try:
            tx_amount = float(tx.get("value", "0")) / 1_000_000
        except (ValueError, TypeError):
            continue

        tx_hash = tx.get("transaction_id", "")

        # Find matching pending order by amount (±0.001 tolerance)
        for order in pending_orders:
            order_amount = order.get("usdt_amount", 0)
            if abs(tx_amount - order_amount) < 0.001:
                # Check if already processed
                all_orders = bot_data.get_all_orders()
                already_processed = any(
                    o.get("tx_hash") == tx_hash and o.get("status") == "confirmed"
                    for o in all_orders
                )
                if already_processed:
                    continue

                logger.info(
                    f"USDT payment matched! Order {order['id']}: "
                    f"{tx_amount} USDT, TX: {tx_hash}"
                )

                confirmed = bot_data.confirm_order(order["id"], tx_hash)
                if confirmed and bot:
                    # Notify user via Telegram
                    try:
                        await bot.send_message(
                            confirmed["telegram_id"],
                            f"✅ **充值成功！**\n\n"
                            f"💰 收到: `{tx_amount}` USDT\n"
                            f"🎁 获得: `{confirmed['credits_to_add']}` 积分\n"
                            f"💳 当前余额: `{bot_data.get_user(confirmed['telegram_id'])['credits']}` 积分\n\n"
                            f"🔗 交易哈希: `{tx_hash[:16]}...`",
                            parse_mode="Markdown",
                        )
                    except Exception as e:
                        logger.error(f"Failed to notify user {confirmed['telegram_id']}: {e}")

                # Remove from pending list for this iteration
                pending_orders = [o for o in pending_orders if o["id"] != order["id"]]
                break


async def start_polling(bot=None):
    """Start background payment polling loop."""
    logger.info("USDT-TRC20 payment monitor started")
    while True:
        try:
            await check_usdt_payments(bot)
        except Exception as e:
            logger.exception(f"Payment polling error: {e}")
        await asyncio.sleep(POLL_INTERVAL)
