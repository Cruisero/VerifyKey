"""
SheerID Verifier — Premium Telegram Bot
Standalone product identity, fully managed from the OnePASS Admin dashboard.
"""
import asyncio
import io
import json
import logging
import os
import re
from typing import Optional

from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery, BufferedInputFile
import httpx
from httpx_sse import aconnect_sse
from dotenv import load_dotenv

import bot_data
import crypto_service

# Load environment variables
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

API_URL = "http://backend:3002"
BOT_TOKEN = os.getenv("API_BOT_TOKEN")

if not BOT_TOKEN:
    logger.error("API_BOT_TOKEN not found in environment variables!")
    exit(1)

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


# ==================== Constants ====================

# Predefined credit packages: (usdt_price, base_credits, bonus_credits)
CREDIT_PACKAGES = [
    {"price": 1,   "base": 10,   "bonus": 0,    "emoji": "🌱"},
    {"price": 5,   "base": 50,   "bonus": 0,    "emoji": "⭐"},
    {"price": 10,  "base": 100,  "bonus": 10,   "emoji": "🚀"},
    {"price": 20,  "base": 200,  "bonus": 30,   "emoji": "🤑"},
    {"price": 50,  "base": 500,  "bonus": 100,  "emoji": "💎"},
    {"price": 100, "base": 1000, "bonus": 300,  "emoji": "🏆"},
    {"price": 500, "base": 5000, "bonus": 3000, "emoji": "👑"},
]

VERIFICATION_CREDIT_COST = 8  # 8 credits = 1 verification

# ==================== Helpers ====================

def generate_qr_code(data: str) -> bytes:
    """Generate a QR code image as PNG bytes."""
    import qrcode
    from PIL import Image
    qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=8, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()


def get_config() -> dict:
    """Load dynamic bot config."""
    return crypto_service.load_bot_config()


def build_welcome_text(config: dict) -> str:
    """Build the premium welcome message."""
    bot_name = config.get("botName", "SheerID Verifier")
    welcome = config.get("welcomeMessage", "Your premium gateway to instant student verifications.")
    contact = config.get("contactSupport", "@Terato1")
    services = config.get("services", [])

    services_text = ""
    if services:
        services_text = "\n📋 Available Services:\n"
        for s in services:
            emoji = s.get("emoji", "🔹")
            services_text += f"  • {emoji} {s['name']} — {s['credits']} credits\n"

    return (
        f"🚀 Welcome to {bot_name}!\n\n"
        f"{welcome} 🎓✨\n"
        f"{services_text}\n"
        f"🛠 Commands:\n"
        f"🔹 /services - View services & get links\n"
        f"🔹 /verify - Start verification\n"
        f"🔹 /balance - Check credits\n"
        f"🔹 /crypto - Top up with crypto\n"
        f"🔹 /daily - Free daily credits\n"
        f"🔹 /referral - Earn credits by inviting\n"
        f"🔹 /help - Show this message\n\n"
        f"📝 How to use:\n"
        f"Use /services to get your verification link, then send /verify with the link\n\n"
        f"❓ Need help? Contact {contact}"
    )


# ==================== Command Handlers ====================

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Handle /start and /start ref_XXXXXX deep links."""
    config = get_config()
    user = bot_data.get_or_create_user(
        message.from_user.id,
        message.from_user.username or ""
    )

    # Handle referral deep link: /start ref_XXXXXX
    args = message.text.split()
    if len(args) > 1 and args[1].startswith("ref_"):
        ref_code = args[1][4:]  # Strip "ref_" prefix
        referrer = bot_data.get_user_by_referral_code(ref_code)
        if referrer and referrer["telegram_id"] != message.from_user.id:
            bot_data.set_referred_by(message.from_user.id, referrer["telegram_id"])
            await message.answer(
                f"🎉 You joined via {referrer.get('username', 'a friend')}'s referral!\n"
                f"Complete your first verification to reward them."
            )

    await message.answer(build_welcome_text(config))


@dp.message(Command("help"))
async def cmd_help(message: types.Message):
    config = get_config()
    bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    await message.answer(build_welcome_text(config))


@dp.message(Command("services"))
async def cmd_services(message: types.Message):
    config = get_config()
    bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    services = config.get("services", [])

    if not services:
        await message.answer("📋 No services available at the moment.")
        return

    text = "📋 **Available Services**\n\n"
    for s in services:
        emoji = s.get("emoji", "🔹")
        text += f"{emoji} **{s['name']}** — {s['credits']} credits\n"
    text += "\n💡 Send your verification link with /verify to get started!"
    await message.answer(text, parse_mode="Markdown")


@dp.message(Command("balance"))
async def cmd_balance(message: types.Message):
    user = bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    credits = user.get("credits", 0)
    total_v = user.get("total_verifications", 0)

    await message.answer(
        f"💳 **Your Balance**\n\n"
        f"🔹 Credits: `{credits}`\n"
        f"🔹 Total Verifications: `{total_v}`\n\n"
        f"💡 Top up with /crypto or earn free credits with /daily",
        parse_mode="Markdown"
    )


@dp.message(Command("daily"))
async def cmd_daily(message: types.Message):
    bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    config = get_config()
    daily_amount = config.get("dailyCredits", 1)

    success, balance, msg = bot_data.claim_daily(message.from_user.id, daily_amount)

    if success:
        await message.answer(
            f"🎁 **Daily Reward Claimed!**\n\n"
            f"✅ +{daily_amount} credit(s)\n"
            f"💳 Balance: `{balance}` credits\n\n"
            f"Come back tomorrow for more!",
            parse_mode="Markdown"
        )
    else:
        await message.answer(
            f"⏰ **Already Claimed Today**\n\n"
            f"💳 Balance: `{balance}` credits\n"
            f"Come back tomorrow! 🕐",
            parse_mode="Markdown"
        )


@dp.message(Command("referral"))
async def cmd_referral(message: types.Message):
    user = bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    stats = bot_data.get_referral_stats(message.from_user.id)
    bot_info = await bot.get_me()
    ref_link = f"https://t.me/{bot_info.username}?start=ref_{stats['referral_code']}"

    await message.answer(
        f"🤝 **Referral Program**\n\n"
        f"Invite friends and earn **+1 credit** for each friend who completes their first verification!\n\n"
        f"🔗 Your invite link:\n`{ref_link}`\n\n"
        f"📊 **Your Stats:**\n"
        f"👥 Invited: {stats['invited_count']}\n"
        f"✅ Verified: {stats['verified_count']}\n"
        f"🎁 Credits earned: {stats['earned_credits']}",
        parse_mode="Markdown"
    )


@dp.message(Command("crypto"))
async def cmd_crypto(message: types.Message):
    """Step 1: Show credit packages with inline keyboard buttons."""
    config = get_config()
    bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    contact = config.get("contactSupport", "@Terato1")

    # Build inline keyboard with package buttons (2 per row)
    buttons = []
    row = []
    for i, pkg in enumerate(CREDIT_PACKAGES):
        total = pkg["base"] + pkg["bonus"]
        if pkg["bonus"] > 0:
            label = f"{pkg['emoji']} ${pkg['price']} → {total} Credits (+{pkg['bonus']} 🎁)"
        else:
            label = f"{pkg['emoji']} ${pkg['price']} → {total} Credits"
        row.append(InlineKeyboardButton(text=label, callback_data=f"pkg_{pkg['price']}"))
        if len(row) == 2 or i == len(CREDIT_PACKAGES) - 1:
            buttons.append(row)
            row = []

    buttons.append([InlineKeyboardButton(text=f"💬 Support", url=f"https://t.me/{contact.lstrip('@')}")])
    buttons.append([InlineKeyboardButton(text="❌ Close", callback_data="close_menu")])

    keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)

    await message.answer(
        f"💰 **Top Up Credits** 💰\n\n"
        f"💡 How it works:\n"
        f"• $1 = 10 Credits\n"
        f"• {VERIFICATION_CREDIT_COST} Credits = 1 Verification\n"
        f"• Credits are added instantly after payment\n\n"
        f"Select a package below to pay with USDT:",
        parse_mode="Markdown",
        reply_markup=keyboard
    )


@dp.callback_query(F.data.startswith("pkg_"))
async def handle_pkg_callback(callback: CallbackQuery):
    """Step 2: Show payment network selection after package is chosen."""
    await callback.answer()

    try:
        selected_price = int(callback.data.split("_")[1])
    except (ValueError, IndexError):
        await callback.answer("❌ Invalid selection.", show_alert=True)
        return

    pkg = next((p for p in CREDIT_PACKAGES if p["price"] == selected_price), None)
    if not pkg:
        await callback.answer("❌ Package not found.", show_alert=True)
        return

    total = pkg["base"] + pkg["bonus"]
    bonus_text = f"\n🎁 Bonus: +{pkg['bonus']} credits" if pkg["bonus"] > 0 else ""

    # Build network selection buttons
    buttons = [
        [
            InlineKeyboardButton(text="🔴 TRC-20", callback_data=f"net_trc20_{selected_price}"),
            InlineKeyboardButton(text="🟡 BSC (BEP-20)", callback_data=f"net_bsc_{selected_price}"),
        ],
        [
            InlineKeyboardButton(text="🆔 Binance Pay", callback_data=f"net_binance_{selected_price}"),
        ],
        [
            InlineKeyboardButton(text="« Back", callback_data="back_to_packages"),
        ],
    ]

    keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)

    await callback.message.edit_text(
        f"📦 {pkg['emoji']} **${pkg['price']} Package**\n\n"
        f"✨ Total Credits: {total}{bonus_text}\n"
        f"⏰ Payment Window: 15 minutes\n\n"
        f"Select Payment Network:",
        parse_mode="Markdown",
        reply_markup=keyboard
    )


@dp.callback_query(F.data == "back_to_packages")
async def handle_back_to_packages(callback: CallbackQuery):
    """Go back to package selection."""
    await callback.answer()
    config = get_config()
    contact = config.get("contactSupport", "@Terato1")

    buttons = []
    row = []
    for i, pkg in enumerate(CREDIT_PACKAGES):
        total = pkg["base"] + pkg["bonus"]
        if pkg["bonus"] > 0:
            label = f"{pkg['emoji']} ${pkg['price']} → {total} Credits (+{pkg['bonus']} 🎁)"
        else:
            label = f"{pkg['emoji']} ${pkg['price']} → {total} Credits"
        row.append(InlineKeyboardButton(text=label, callback_data=f"pkg_{pkg['price']}"))
        if len(row) == 2 or i == len(CREDIT_PACKAGES) - 1:
            buttons.append(row)
            row = []

    buttons.append([InlineKeyboardButton(text=f"💬 Support", url=f"https://t.me/{contact.lstrip('@')}")])
    buttons.append([InlineKeyboardButton(text="❌ Close", callback_data="close_menu")])

    keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)

    await callback.message.edit_text(
        f"💰 **Top Up Credits** 💰\n\n"
        f"💡 How it works:\n"
        f"• $1 = 10 Credits\n"
        f"• {VERIFICATION_CREDIT_COST} Credits = 1 Verification\n"
        f"• Credits are added instantly after payment\n\n"
        f"Select a package below to pay with USDT:",
        parse_mode="Markdown",
        reply_markup=keyboard
    )


@dp.callback_query(F.data.startswith("net_"))
async def handle_network_callback(callback: CallbackQuery):
    """Step 3: Show payment instructions for the selected network."""
    await callback.answer()
    config = get_config()
    contact = config.get("contactSupport", "@Terato1")

    parts = callback.data.split("_")
    # net_trc20_10, net_bsc_10, net_binance_10
    if len(parts) < 3:
        await callback.answer("❌ Invalid selection.", show_alert=True)
        return

    network = parts[1]
    try:
        selected_price = int(parts[2])
    except ValueError:
        await callback.answer("❌ Invalid price.", show_alert=True)
        return

    pkg = next((p for p in CREDIT_PACKAGES if p["price"] == selected_price), None)
    if not pkg:
        await callback.answer("❌ Package not found.", show_alert=True)
        return

    total_credits = pkg["base"] + pkg["bonus"]
    usdt_amount = float(pkg["price"])
    bonus_text = f"\n🎁 Bonus (from offset): +{pkg['bonus']} credits" if pkg["bonus"] > 0 else ""

    if network == "trc20":
        wallet = config.get("trc20WalletAddress", "")
        if not wallet or not config.get("trc20Enabled"):
            await callback.message.edit_text(f"❌ TRC-20 payments are not available.\nContact {contact}.")
            return

        unique_amount = bot_data.generate_unique_usdt_amount(usdt_amount)
        order = bot_data.create_order(callback.from_user.id, unique_amount, total_credits, network="trc20")

        buttons = [
            [InlineKeyboardButton(text="❌ Cancel Order", callback_data=f"cancel_{order['id']}")],
            [InlineKeyboardButton(text="💬 Support", url=f"https://t.me/{contact.lstrip('@')}")],
        ]

        await callback.message.edit_text(
            f"💳 **Payment Instructions**\n\n"
            f"🆔 Order ID: `{order['id']}`{bonus_text}\n"
            f"💰 Total Credits: {total_credits}\n\n"
            f"💵 Send EXACTLY: **`{unique_amount}`** USDT\n"
            f"🌐 Network: 🔴 TRON (TRC-20)\n\n"
            f"Payment Address:\n`{wallet}`\n\n"
            f"⏰ Expires in: 15 minutes\n"
            f"✅ Auto-credited after confirmation\n\n"
            f"⚠️ Important: Send the exact amount shown above!",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
        )

        # Send QR code
        try:
            qr_bytes = generate_qr_code(wallet)
            await callback.message.answer_photo(
                photo=BufferedInputFile(qr_bytes, filename="qr_trc20.png"),
                caption=f"🔴 TRC-20 Wallet QR\n`{wallet}`",
                parse_mode="Markdown"
            )
        except Exception as e:
            logger.error(f"Failed to send QR code: {e}")

    elif network == "bsc":
        wallet = config.get("bscWalletAddress", "")
        if not wallet or not config.get("bscEnabled"):
            await callback.message.edit_text(f"❌ BSC payments are not available.\nContact {contact}.")
            return

        unique_amount = bot_data.generate_unique_usdt_amount(usdt_amount)
        order = bot_data.create_order(callback.from_user.id, unique_amount, total_credits, network="bsc")

        buttons = [
            [InlineKeyboardButton(text="❌ Cancel Order", callback_data=f"cancel_{order['id']}")],
            [InlineKeyboardButton(text="💬 Support", url=f"https://t.me/{contact.lstrip('@')}")],
        ]

        await callback.message.edit_text(
            f"💳 **Payment Instructions**\n\n"
            f"🆔 Order ID: `{order['id']}`{bonus_text}\n"
            f"💰 Total Credits: {total_credits}\n\n"
            f"💵 Send EXACTLY: **`{unique_amount}`** USDT\n"
            f"🌐 Network: 🟡 Binance Smart Chain (BEP-20)\n\n"
            f"Payment Address:\n`{wallet}`\n\n"
            f"⏰ Expires in: 15 minutes\n"
            f"✅ Auto-credited after 15 confirmations\n\n"
            f"⚠️ Important: Send the exact amount shown above!",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
        )

        # Send QR code
        try:
            qr_bytes = generate_qr_code(wallet)
            await callback.message.answer_photo(
                photo=BufferedInputFile(qr_bytes, filename="qr_bsc.png"),
                caption=f"🟡 BSC (BEP-20) Wallet QR\n`{wallet}`",
                parse_mode="Markdown"
            )
        except Exception as e:
            logger.error(f"Failed to send QR code: {e}")

    elif network == "binance":
        pay_id = config.get("binancePayId", "")
        if not pay_id or not config.get("binancePayEnabled"):
            await callback.message.edit_text(f"❌ Binance Pay is not available.\nContact {contact}.")
            return

        # Generate a 6-digit note code for identification
        import random
        note_code = str(random.randint(100000, 999999))
        order = bot_data.create_order(callback.from_user.id, usdt_amount, total_credits, network="binance_pay", note_code=note_code)

        buttons = [
            [InlineKeyboardButton(text="✅ I Have Paid", callback_data=f"paid_{order['id']}")],
            [InlineKeyboardButton(text="🔙 Back", callback_data=f"pkg_{selected_price}")],
        ]

        await callback.message.edit_text(
            f"⚡ **Binance Pay (Manual)** ⚡\n\n"
            f"1️⃣ Go to Binance Pay and Send **${usdt_amount}**.\n"
            f"2️⃣ Send to Pay ID: `{pay_id}` (Tap to copy)\n"
            f"3️⃣ ⚠️ IMPORTANT: In the 'Note' field, write:\n\n"
            f"`{note_code}` (Tap to copy note)\n\n"
            f"4️⃣ After paying, click '✅ I Have Paid' below.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
        )


@dp.callback_query(F.data.startswith("paid_"))
async def handle_paid_callback(callback: CallbackQuery):
    """Handle 'I Have Paid' for Binance Pay — notify admin for manual confirmation."""
    await callback.answer("✅ Payment noted! Admin will verify shortly.", show_alert=True)

    order_id = callback.data.replace("paid_", "")
    orders = bot_data.get_all_orders()
    order = next((o for o in orders if o["id"] == order_id), None)

    if not order:
        await callback.message.edit_text("❌ Order not found.")
        return

    await callback.message.edit_text(
        f"⏳ **Payment Submitted for Review**\n\n"
        f"🆔 Order: `{order_id}`\n"
        f"💵 Amount: ${order['usdt_amount']} USDT\n"
        f"📝 Note Code: `{order.get('note_code', 'N/A')}`\n\n"
        f"An admin will verify your payment shortly.\n"
        f"You'll be notified once credits are added.\n\n"
        f"⏰ Usually confirmed within 5-10 minutes.",
        parse_mode="Markdown"
    )


@dp.callback_query(F.data.startswith("cancel_"))
async def handle_cancel_callback(callback: CallbackQuery):
    """Cancel a pending order."""
    await callback.answer()
    order_id = callback.data.replace("cancel_", "")

    # Mark order as expired/cancelled
    orders = bot_data._load_orders()
    if order_id in orders and orders[order_id]["status"] == "pending":
        orders[order_id]["status"] = "cancelled"
        bot_data._save_orders(orders)

    await callback.message.edit_text(
        f"❌ **Order Cancelled**\n\n"
        f"Order `{order_id}` has been cancelled.\n"
        f"Use /crypto to start a new order.",
        parse_mode="Markdown"
    )


@dp.callback_query(F.data == "close_menu")
async def handle_close_callback(callback: CallbackQuery):
    """Handle close button."""
    await callback.answer()
    await callback.message.delete()


@dp.message(Command("verify"))
async def cmd_verify(message: types.Message):
    """Handle /verify [link] command."""
    user = bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    config = get_config()
    services = config.get("services", [])

    # Extract link from the message
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer(
            "🔍 **How to verify:**\n\n"
            "Send your verification link after the command:\n"
            "`/verify https://services.sheerid.com/verify/...`\n\n"
            "Or just paste the link directly!",
            parse_mode="Markdown"
        )
        return

    link = args[1].strip()
    await _process_verification(message, user, link, config, services)


@dp.message(F.text)
async def handle_text(message: types.Message):
    """Handle raw links sent without /verify command."""
    text = message.text.strip()

    # Check if it's a SheerID link
    if "services.sheerid.com/verify" in text or "verificationId=" in text:
        user = bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
        config = get_config()
        services = config.get("services", [])
        await _process_verification(message, user, text, config, services)
        return

    # Ignore other text (don't spam users)


async def _process_verification(message: types.Message, user: dict, link: str, config: dict, services: list):
    """Core verification logic — deduct credits, call API, stream progress."""
    # Check credits (8 credits = 1 verification)
    cost = VERIFICATION_CREDIT_COST

    credits = user.get("credits", 0)
    if credits < cost:
        await message.answer(
            f"❌ **Insufficient Credits**\n\n"
            f"This verification costs **{cost}** credits.\n"
            f"Your balance: **{credits}** credits.\n\n"
            f"💡 Top up with /crypto or claim free credits with /daily",
            parse_mode="Markdown"
        )
        return

    # Deduct credits
    if not bot_data.deduct_credits(message.from_user.id, cost):
        await message.answer("❌ Failed to deduct credits. Please try again.")
        return

    remaining = bot_data.get_user(message.from_user.id).get("credits", 0)

    status_msg = await message.answer(
        f"🔄 **Verification Started**\n\n"
        f"💳 Deducted: {cost} credits (Remaining: {remaining})\n"
        f"⏳ Preparing...",
        parse_mode="Markdown"
    )

    # Call the internal API (no CDK needed — bot uses its own credit system)
    # We'll use a special internal endpoint or pass a bot-internal flag
    payload = {
        "links": [link],
        "cdk": "__BOT_INTERNAL__",
        "bot_user_id": message.from_user.id
    }

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with aconnect_sse(client, "POST", f"{API_URL}/api/verify/dualbot", json=payload) as event_source:
                current_status = "⏳ Preparing..."

                async for sse in event_source.iter_sse():
                    try:
                        event_data = json.loads(sse.data)

                        if event_data.get("type") == "progress":
                            step = event_data.get("step")
                            step_map = {
                                "warmup": "📄 Generating document...",
                                "verify": "📤 Submitting document...",
                                "waiting": "⏳ Waiting for verification...",
                                "cooldown_wait": f"⏳ {event_data.get('message', 'Waiting...')}",
                            }
                            new_status = step_map.get(step, current_status)
                            if new_status != current_status:
                                current_status = new_status
                                try:
                                    await status_msg.edit_text(
                                        f"🔄 **Verification In Progress**\n\n"
                                        f"💳 Cost: {cost} credits\n"
                                        f"{current_status}",
                                        parse_mode="Markdown"
                                    )
                                except Exception:
                                    pass

                        elif event_data.get("type") == "done":
                            results = event_data.get("results", [])
                            if results:
                                r = results[0]
                                status = r.get("status", "unknown")
                                msg_text = r.get("message", "")

                                if status == "approved":
                                    result_text = f"✅ **Verification Successful!**\n\n🎉 {msg_text}"
                                    # Track verification
                                    bot_data.increment_verifications(message.from_user.id)
                                    # Handle first verification referral reward
                                    referrer_id = bot_data.mark_first_verify_done(message.from_user.id)
                                    if referrer_id:
                                        try:
                                            referrer = bot_data.get_user(referrer_id)
                                            await bot.send_message(
                                                referrer_id,
                                                f"🎉 **Referral Reward!**\n\n"
                                                f"Your referral @{message.from_user.username or 'user'} "
                                                f"completed their first verification!\n"
                                                f"🎁 +1 credit added to your balance.\n"
                                                f"💳 New balance: {referrer.get('credits', 0)} credits",
                                                parse_mode="Markdown"
                                            )
                                        except Exception as e:
                                            logger.error(f"Failed to notify referrer: {e}")
                                elif status in ("failed", "error"):
                                    result_text = f"❌ **Verification Failed**\n\n{msg_text}"
                                    # Refund credits on failure
                                    bot_data.add_credits(message.from_user.id, cost, "Refund - verification failed")
                                    remaining = bot_data.get_user(message.from_user.id).get("credits", 0)
                                    result_text += f"\n\n💳 Credits refunded. Balance: {remaining}"
                                elif status == "no_credits":
                                    result_text = "❌ **Bot account out of quota**\n\nPlease try again later."
                                    bot_data.add_credits(message.from_user.id, cost, "Refund - no bot quota")
                                else:
                                    result_text = f"❓ Status: {status}\n{msg_text}"

                                try:
                                    await status_msg.edit_text(result_text, parse_mode="Markdown")
                                except Exception:
                                    await message.answer(result_text, parse_mode="Markdown")
                            else:
                                await status_msg.edit_text("❌ No results received.")

                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse SSE data: {sse.data}")

    except httpx.HTTPStatusError as e:
        error_msg = e.response.text
        try:
            err_json = e.response.json()
            error_msg = err_json.get("detail", error_msg)
        except Exception:
            pass
        # Refund on API error
        bot_data.add_credits(message.from_user.id, cost, "Refund - API error")
        await status_msg.edit_text(f"❌ Error: {error_msg}\n\n💳 Credits refunded.")
    except httpx.ConnectError:
        bot_data.add_credits(message.from_user.id, cost, "Refund - connection error")
        await status_msg.edit_text("❌ Cannot connect to verification backend.\n\n💳 Credits refunded.")
    except Exception as e:
        logger.exception("Verification error")
        bot_data.add_credits(message.from_user.id, cost, "Refund - unexpected error")
        await status_msg.edit_text(f"❌ Unexpected error: {str(e)}\n\n💳 Credits refunded.")


async def main():
    logger.info("Starting SheerID Verifier Bot...")
    await bot.delete_webhook(drop_pending_updates=True)

    # Start crypto payment polling in background
    asyncio.create_task(crypto_service.start_polling(bot))

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
