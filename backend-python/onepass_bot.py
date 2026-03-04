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

# Suppress noisy httpx polling logs
logging.getLogger("httpx").setLevel(logging.WARNING)

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


def build_welcome_text(config: dict, balance: int = 0, user_id: int = 0) -> str:
    bot_name = "Gemini_Verifier_bot"
    welcome = config.get("welcomeMessage", "Your premium gateway to instant student verifications.")

    services = config.get("services", [])
    services_text = ""
    if services:
        services_text = "\n📋 **Available Services:**\n"
        for s in services:
            emoji = s.get("emoji", "🌐")
            services_text += f"  {emoji} {s['name']} — {s['credits']} credits\n"

    return (
        f"🚀 **Welcome!**\n\n"
        f"{welcome} 🎓✨\n"
        f"📣 Join the Notification Channel **@Gemini\\_ProV**\n"
        f"{services_text}\n"
        f"💰 **Balance:** {balance} Credits\n"
        f"🆔 **Your ID:** `{user_id}`\n\n"
        f"👇 **Select an option below:**"
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

    contact = config.get("contactSupport", "@Terato1")
    buttons = [
        [
            InlineKeyboardButton(text="💎 Services", callback_data="cmd_services"),
            InlineKeyboardButton(text="💰 Deposit", callback_data="cmd_crypto")
        ],
        [
            InlineKeyboardButton(text="👤 Balance", callback_data="cmd_profile"),
            InlineKeyboardButton(text="📊 Status", callback_data="cmd_status")
        ],
        [
            InlineKeyboardButton(text="🎁 Check In", callback_data="cmd_checkin"),
            InlineKeyboardButton(text="👥 Referrals", callback_data="cmd_referral")
        ],
        [
            InlineKeyboardButton(text="❓ Help", url=f"https://t.me/{contact.lstrip('@')}")
        ]
    ]

    await message.answer(
        build_welcome_text(config, user.get("credits", 0), message.from_user.id),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
    )



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
        emoji = s.get("emoji", "🎵")
        text += f"{emoji} **{s['name']}** — {s['credits']} credits\n"
        
    text += (
        "\n🚫 **DO NOT open the verification link!**\n"
        "Opening the link causes instant rejection.\n\n"
        "✅ **CORRECT WAY:**\n\n"
        "1️⃣ Right-click on the verification button\n"
        "2️⃣ Select \"Copy link address\"\n"
        "3️⃣ Paste the link here directly\n"
        "💡 Send your verification link with `/verify` to get started!"
    )
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 Back", callback_data="cmd_start")]
    ])
    try:
        from aiogram.types import FSInputFile
        photo = FSInputFile("assets/services_tutorial.jpg")
        await message.answer_photo(photo=photo, caption=text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception as e:
        logger.error(f"Failed to send services photo: {e}")
        await message.answer(text, parse_mode="Markdown", reply_markup=keyboard)


@dp.message(Command("balance"))
async def cmd_balance(message: types.Message):
    user = bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    credits = user.get("credits", 0)
    total_v = user.get("total_verifications", 0)

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 Back", callback_data="cmd_start")]
    ])
    await message.answer(
        f"💳 **Your Balance**\n\n"
        f"🔹 Credits: `{credits}`\n"
        f"🔹 Total Verifications: `{total_v}`\n\n"
        f"💡 Top up with /deposit or earn free credits with /checkin",
        parse_mode="Markdown",
        reply_markup=keyboard
    )


@dp.message(Command("checkin"))
async def cmd_checkin(message: types.Message):
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

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 Back", callback_data="cmd_start")]
    ])
    await message.answer(
        f"🤝 **Referral Program**\n\n"
        f"Invite friends and earn **+1 credit** for each friend who completes their first verification!\n\n"
        f"🔗 Your invite link:\n`{ref_link}`\n\n"
        f"📊 **Your Stats:**\n"
        f"👥 Invited: {stats['invited_count']}\n"
        f"✅ Verified: {stats['verified_count']}\n"
        f"🎁 Credits earned: {stats['earned_credits']}",
        parse_mode="Markdown",
        reply_markup=keyboard
    )


@dp.message(Command("status"))
async def cmd_status(message: types.Message):
    """Show service status (manually configured data)."""
    bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    config = get_config()

    # Read manually configured status data
    status_cfg = config.get("statusConfig", {})
    is_online = status_cfg.get("online", True)
    success_rate = status_cfg.get("successRate", 95)
    success_count = status_cfg.get("successCount", 0)
    fail_count = status_cfg.get("failCount", 0)
    notice = status_cfg.get("notice", "")

    status_emoji = "🟢" if is_online else "🔴"
    status_text = "Online" if is_online else "Offline"

    text = (
        f"📊 **Service Status**\n\n"
        f"{status_emoji} Status: **{status_text}**\n"
        f"📈 Success Rate: **{success_rate}%**\n"
        f"✅ Verified Today: **{success_count}**\n"
        f"❌ Failed Today: **{fail_count}**\n"
    )

    if notice:
        text += f"\n📢 **Notice:** {notice}\n"

    text += f"\n🕐 Last updated: {status_cfg.get('lastUpdated', 'N/A')}"

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 Back", callback_data="cmd_start")]
    ])
    await message.answer(text, parse_mode="Markdown", reply_markup=keyboard)


@dp.message(Command("deposit"))
async def cmd_deposit(message: types.Message):
    """Step 1: Show credit packages with inline keyboard buttons."""
    config = get_config()
    bot_data.get_or_create_user(message.from_user.id, message.from_user.username or "")
    contact = config.get("contactSupport", "@Terato1")

    # Build inline keyboard with package buttons (2 per row)
    buttons = []
    row = []
    for i, pkg in enumerate(CREDIT_PACKAGES):
        total = pkg["base"] + pkg["bonus"]
        label = f"{pkg['emoji']} ${pkg['price']}({total} Credit)"
        row.append(InlineKeyboardButton(text=label, callback_data=f"pkg_{pkg['price']}"))
        if len(row) == 2 or i == len(CREDIT_PACKAGES) - 1:
            buttons.append(row)
            row = []

    buttons.append([InlineKeyboardButton(text=f"💬 Support", url=f"https://t.me/{contact.lstrip('@')}")])
    buttons.append([InlineKeyboardButton(text="🔙 Back", callback_data="cmd_start")])

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
            [InlineKeyboardButton(text="✅ I Paid - Verify Now", callback_data=f"paid_{order['id']}")],
            [InlineKeyboardButton(text="❌ Cancel Order", callback_data=f"cancel_{order['id']}")],
            [InlineKeyboardButton(text="💬 Support", url=f"https://t.me/{contact.lstrip('@')}")],
        ]

        caption = (
            f"💳 Payment Instructions\n\n"
            f"🆔 Order: {order['id']}\n"
            f"💰 Credits: {total_credits}{bonus_text}\n\n"
            f"💵 Send EXACTLY: {unique_amount} USDT\n"
            f"🌐 Network: 🔴 TRON (TRC-20)\n\n"
            f"📬 Address:\n{wallet}\n\n"
            f"⏰ Expires: 15 min | ✅ Auto-confirm\n"
            f"⚠️ Send the exact amount above!"
        )

        try:
            qr_bytes = generate_qr_code(wallet)
            await callback.message.delete()
            sent = await callback.message.answer_photo(
                photo=BufferedInputFile(qr_bytes, filename="qr_trc20.png"),
                caption=caption,
                reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
            )
            # Save message info so auto-confirm can edit this message
            bot_data.update_order_message_info(order['id'], sent.chat.id, sent.message_id)
        except Exception as e:
            logger.error(f"Failed to send QR payment msg: {e}")
            await callback.message.edit_text(caption, reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

    elif network == "bsc":
        wallet = config.get("bscWalletAddress", "")
        if not wallet or not config.get("bscEnabled"):
            await callback.message.edit_text(f"❌ BSC payments are not available.\nContact {contact}.")
            return

        unique_amount = bot_data.generate_unique_usdt_amount(usdt_amount)
        order = bot_data.create_order(callback.from_user.id, unique_amount, total_credits, network="bsc")

        buttons = [
            [InlineKeyboardButton(text="✅ I Paid - Verify Now", callback_data=f"paid_{order['id']}")],
            [InlineKeyboardButton(text="❌ Cancel Order", callback_data=f"cancel_{order['id']}")],
            [InlineKeyboardButton(text="💬 Support", url=f"https://t.me/{contact.lstrip('@')}")],
        ]

        caption = (
            f"💳 Payment Instructions\n\n"
            f"🆔 Order: {order['id']}\n"
            f"💰 Credits: {total_credits}{bonus_text}\n\n"
            f"💵 Send EXACTLY: {unique_amount} USDT\n"
            f"🌐 Network: 🟡 BSC (BEP-20)\n\n"
            f"📬 Address:\n{wallet}\n\n"
            f"⏰ Expires: 15 min | ✅ Auto-confirm\n"
            f"⚠️ Send the exact amount above!"
        )

        try:
            qr_bytes = generate_qr_code(wallet)
            await callback.message.delete()
            sent = await callback.message.answer_photo(
                photo=BufferedInputFile(qr_bytes, filename="qr_bsc.png"),
                caption=caption,
                reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
            )
            bot_data.update_order_message_info(order['id'], sent.chat.id, sent.message_id)
        except Exception as e:
            logger.error(f"Failed to send QR payment msg: {e}")
            await callback.message.edit_text(caption, reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

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
    """Handle 'I Paid' — edit same message caption to show status."""
    order_id = callback.data.replace("paid_", "")
    orders = bot_data.get_all_orders()
    order = next((o for o in orders if o["id"] == order_id), None)

    if not order:
        await callback.answer("❌ Order not found.", show_alert=True)
        return

    # Check if order was already confirmed
    if order.get("status") == "confirmed":
        user = bot_data.get_user(order["telegram_id"])
        balance = user.get("credits", 0) if user else 0
        await callback.answer("✅ Already confirmed!", show_alert=True)
        try:
            await callback.message.delete()
        except Exception:
            pass
        await callback.message.answer(
            f"✅ **Payment Confirmed!**\n\n"
            f"🆔 Order: `{order_id}`\n"
            f"💰 Credits added: `{order['credits_to_add']}`\n"
            f"💳 Balance: `{balance}` credits\n\n"
            f"Thank you for your purchase!",
            parse_mode="Markdown"
        )
        return

    network = order.get("network", "")
    config = get_config()
    contact = config.get("contactSupport", "@Terato1")

    if network == "binance_pay":
        # Binance Pay — manual review
        await callback.answer()
        
        # Notify Admin
        import os
        admin_chat_id = os.getenv("ADMIN_CHAT_ID")
        if admin_chat_id:
            try:
                admin_keyboard = InlineKeyboardMarkup(inline_keyboard=[
                    [
                        InlineKeyboardButton(text="✅ Confirm Payment", callback_data=f"admin_confirm_{order_id}"),
                        InlineKeyboardButton(text="❌ Reject", callback_data=f"admin_reject_{order_id}")
                    ]
                ])
                await bot.send_message(
                    chat_id=int(admin_chat_id),
                    text=(
                        f"🚨 **New Binance Pay Order** 🚨\n\n"
                        f"👤 User: `{callback.from_user.id}` (@{callback.from_user.username or 'N/A'})\n"
                        f"🆔 Order: `{order_id}`\n"
                        f"💵 Amount: `${order['usdt_amount']}`\n"
                        f"📝 Note Code: `{order.get('note_code', 'N/A')}`\n\n"
                        f"Please verify this payment in Binance."
                    ),
                    parse_mode="Markdown",
                    reply_markup=admin_keyboard
                )
            except Exception as e:
                logger.error(f"Failed to send admin notification: {e}")

        try:
            amount = order.get('usdt_amount', 0)
            note = order.get('note_code', 'N/A')
            await callback.message.edit_text(
                text=(
                    f"✅ **Request Sent!**\n\n"
                    f"Admins will verify your payment of ${amount} with Note **{note}**.\n"
                    f"You will be notified once approved."
                ),
                parse_mode="Markdown",
                reply_markup=None
            )
        except Exception:
            pass
    else:
        # TRC20 / BSC — auto-detect
        await callback.answer("🔍 Checking blockchain...", show_alert=False)

        network_name = "TRC-20" if network == "trc20" else "BSC"
        buttons = [
            [InlineKeyboardButton(text="✅ I Paid - Verify Now", callback_data=f"paid_{order_id}")],
            [InlineKeyboardButton(text="❌ Cancel Order", callback_data=f"cancel_{order_id}")],
            [InlineKeyboardButton(text="💬 Support", url=f"https://t.me/{contact.lstrip('@')}")],
        ]

        try:
            await callback.message.edit_caption(
                caption=(
                    f"⏳ Payment Not Detected Yet\n\n"
                    f"Don't worry! It usually takes 1-2 minutes for the blockchain to process your transaction.\n\n"
                    f"💡 Please Wait:\n"
                    f"• We are automatically checking every 10 seconds.\n"
                    f"• You can click '✅ I Paid' again in a minute.\n\n"
                    f"⏰ Order expires in: Check timer above\n"
                    f"📊 Network: {network_name}\n"
                    f"💵 Amount: ${order['usdt_amount']} USDT"
                ),
                reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
            )
        except Exception:
            pass


@dp.callback_query(F.data.startswith("admin_confirm_"))
async def handle_admin_confirm(callback: CallbackQuery):
    """Admin confirms a payment directly from bot notification."""
    import os
    admin_chat_id = os.getenv("ADMIN_CHAT_ID")
    if not admin_chat_id or str(callback.from_user.id) != admin_chat_id:
        await callback.answer("❌ Unauthorized", show_alert=True)
        return

    order_id = callback.data.replace("admin_confirm_", "")
    tx_ref = f"admin_tg_{int(__import__('time').time())}"
    
    order = bot_data.confirm_order(order_id, tx_ref)
    if order:
        await callback.answer("✅ Order Confirmed!")
        await callback.message.edit_text(
            f"{callback.message.text}\n\n✅ **[Confirmed]** by Admin.",
            reply_markup=None
        )
        
        # Notify the user their credits arrived
        user = bot_data.get_user(order["telegram_id"])
        balance = user.get("credits", 0) if user else 0
        try:
            await bot.send_message(
                order["telegram_id"],
                f"✅ **Payment Confirmed!**\n\n"
                f"💰 Received: `{order['usdt_amount']:.2f}` USDT\n"
                f"🌐 Network: Binance Pay\n"
                f"🎁 Credits added: `{order['credits_to_add']}`\n"
                f"💳 Balance: `{balance}` credits\n\n"
                f"Thank you for your purchase!",
                parse_mode="Markdown"
            )
        except Exception as e:
            logger.error(f"Failed to notify user: {e}")
    else:
        await callback.answer("❌ Order already processed or not found.", show_alert=True)
        await callback.message.edit_reply_markup(reply_markup=None)


@dp.callback_query(F.data.startswith("admin_reject_"))
async def handle_admin_reject(callback: CallbackQuery):
    """Admin rejects a payment directly from bot notification."""
    import os
    admin_chat_id = os.getenv("ADMIN_CHAT_ID")
    if not admin_chat_id or str(callback.from_user.id) != admin_chat_id:
        await callback.answer("❌ Unauthorized", show_alert=True)
        return

    order_id = callback.data.replace("admin_reject_", "")
    
    order = bot_data.reject_order(order_id)
    if order:
        await callback.answer("❌ Order Rejected!")
        await callback.message.edit_text(
            f"{callback.message.text}\n\n❌ **[Rejected]** by Admin.",
            reply_markup=None
        )
        
        # Notify the user it was rejected
        config = get_config()
        contact = config.get("contactSupport", "@Terato1")
        try:
            await bot.send_message(
                order["telegram_id"],
                f"❌ **Deposit Rejected**\n\n"
                f"Nothing received to Binance.\n"
                f"Contact admin with screenshot: {contact}",
                parse_mode="Markdown"
            )
        except Exception as e:
            logger.error(f"Failed to notify user of rejection: {e}")
    else:
        await callback.answer("❌ Order already processed or not found.", show_alert=True)
        await callback.message.edit_reply_markup(reply_markup=None)


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

    try:
        await callback.message.delete()
    except Exception:
        pass
    await callback.message.answer(
        f"❌ **Order Cancelled**\n\n"
        f"Order `{order_id}` has been cancelled.\n"
        f"Use /deposit to start a new order.",
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
    import bot_verify_log
    username = message.from_user.username or ""
    # Check credits (8 credits = 1 verification)
    cost = VERIFICATION_CREDIT_COST

    credits = user.get("credits", 0)
    if credits < cost:
        await message.answer(
            f"❌ **Insufficient Credits**\n\n"
            f"This verification costs **{cost}** credits.\n"
            f"Your balance: **{credits}** credits.\n\n"
            f"💡 Top up with /deposit or claim free credits with /checkin",
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

                async for sse in event_source.aiter_sse():
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
                                    bot_verify_log.log_bot_verify(link, username, message.from_user.id, "success", msg_text)
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
                                    bot_verify_log.log_bot_verify(link, username, message.from_user.id, "failed", msg_text)
                                    # Refund credits on failure
                                    bot_data.add_credits(message.from_user.id, cost, "Refund - verification failed")
                                    remaining = bot_data.get_user(message.from_user.id).get("credits", 0)
                                    result_text += f"\n\n💳 Credits refunded. Balance: {remaining}"
                                elif status == "no_credits":
                                    result_text = "❌ **Bot account out of quota**\n\nPlease try again later."
                                    bot_verify_log.log_bot_verify(link, username, message.from_user.id, "error", "No bot quota")
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
        bot_verify_log.log_bot_verify(link, username, message.from_user.id, "error", str(error_msg))
        bot_data.add_credits(message.from_user.id, cost, "Refund - API error")
        await status_msg.edit_text(f"❌ Error: {error_msg}\n\n💳 Credits refunded.")
    except httpx.ConnectError:
        bot_verify_log.log_bot_verify(link, username, message.from_user.id, "error", "Connection error")
        bot_data.add_credits(message.from_user.id, cost, "Refund - connection error")
        await status_msg.edit_text("❌ Cannot connect to verification backend.\n\n💳 Credits refunded.")
    except Exception as e:
        logger.exception("Verification error")
        bot_data.add_credits(message.from_user.id, cost, "Refund - unexpected error")
        await status_msg.edit_text(f"❌ Unexpected error: {str(e)}\n\n💳 Credits refunded.")


@dp.callback_query(F.data.startswith("cmd_"))
async def handle_main_menu_buttons(callback: CallbackQuery):
    """Handle buttons from the /start menu."""
    cmd = callback.data.replace("cmd_", "")
    await callback.answer()
    
    # Create a mock message that preserves the original chat but spoof the from_user
    mock_msg = callback.message
    
    # aiogram 3 Message objects are immutable Pydantic models, so we model_copy
    mock_msg = mock_msg.model_copy(update={"from_user": callback.from_user})
    
    if cmd == "services":
        # /start is a text message, but /services has a photo. 
        # Telegram doesn't allow editing a text message into a photo message directly.
        # So we delete the old message and send a new photo message.
        await callback.message.delete()
        await cmd_services(mock_msg)
        return
        
    # For others, we need to extract the logic that generates the text and keyboard,
    # or temporarily monkeypatch the answer method of mock_msg to use edit_text instead.
    # The safest way is to intercept mock_msg.answer
        
    # We will override the answer method of the mock message to edit the current message instead
    async def mock_answer(*args, **kwargs):
        try:
            # If the current message has a photo (e.g., coming BACK from /services), 
            # we can't edit it to a pure text message easily, so we delete and send new.
            if callback.message.photo:
                await callback.message.delete()
                await callback.message.answer(*args, **kwargs)
            else:
                await callback.message.edit_text(*args, **kwargs)
        except Exception as e:
            logger.warning(f"Could not edit message, falling back to answer: {e}")
            await callback.message.answer(*args, **kwargs)

    # In aiogram 3, we can't easily mock methods on the Pydantic model directly.
    # Instead of mocking, let's just write the specific handler logic here for editing.
    config = get_config()
    user = bot_data.get_or_create_user(callback.from_user.id, callback.from_user.username or "")
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 Back", callback_data="cmd_start")]
    ])

    try:
        if cmd == "profile": # This routes to balance
            credits = user.get("credits", 0)
            total_v = user.get("total_verifications", 0)
            text = (
                f"💳 **Your Balance**\n\n"
                f"🔹 Credits: `{credits}`\n"
                f"🔹 Total Verifications: `{total_v}`\n\n"
                f"💡 Top up with /deposit or earn free credits with /checkin"
            )
            
        elif cmd == "referral":
            stats = bot_data.get_referral_stats(callback.from_user.id)
            bot_info = await bot.get_me()
            ref_link = f"https://t.me/{bot_info.username}?start=ref_{stats['referral_code']}"
            text = (
                f"🤝 **Referral Program**\n\n"
                f"Invite friends and earn **+1 credit** for each friend who completes their first verification!\n\n"
                f"🔗 Your invite link:\n`{ref_link}`\n\n"
                f"📊 **Your Stats:**\n"
                f"👥 Invited: {stats['invited_count']}\n"
                f"✅ Verified: {stats['verified_count']}\n"
                f"🎁 Credits earned: {stats['earned_credits']}"
            )
            
        elif cmd == "crypto":
            contact = config.get("contactSupport", "@Terato1")
            buttons = []
            row = []
            for i, pkg in enumerate(CREDIT_PACKAGES):
                total = pkg["base"] + pkg["bonus"]
                label = f"{pkg['emoji']} ${pkg['price']}({total} Credit)"
                row.append(InlineKeyboardButton(text=label, callback_data=f"pkg_{pkg['price']}"))
                if len(row) == 2 or i == len(CREDIT_PACKAGES) - 1:
                    buttons.append(row)
                    row = []
            buttons.append([InlineKeyboardButton(text=f"💬 Support", url=f"https://t.me/{contact.lstrip('@')}")])
            buttons.append([InlineKeyboardButton(text="🔙 Back", callback_data="cmd_start")])
            keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)
            
            text = (
                f"💰 **Top Up Credits** 💰\n\n"
                f"💡 How it works:\n"
                f"• $1 = 10 Credits\n"
                f"• {VERIFICATION_CREDIT_COST} Credits = 1 Verification\n"
                f"• Credits are added instantly after payment\n\n"
                f"Select a package below to pay with USDT:"
            )
            
        elif cmd == "checkin":
            daily_amount = config.get("dailyCredits", 1)
            success, balance, msg = bot_data.claim_daily(callback.from_user.id, daily_amount)
            if success:
                text = (
                    f"🎁 **Daily Reward Claimed!**\n\n"
                    f"✅ +{daily_amount} credit(s)\n"
                    f"💳 Balance: `{balance}` credits\n\n"
                    f"Come back tomorrow for more!"
                )
            else:
                text = (
                    f"⏰ **Already Claimed Today**\n\n"
                    f"💳 Balance: `{balance}` credits\n"
                    f"Come back tomorrow! 🕐"
                )

        elif cmd == "status":
            status_cfg = config.get("statusConfig", {})
            is_online = status_cfg.get("online", True)
            success_rate = status_cfg.get("successRate", 95)
            success_count = status_cfg.get("successCount", 0)
            fail_count = status_cfg.get("failCount", 0)
            notice = status_cfg.get("notice", "")
            status_emoji = "🟢" if is_online else "🔴"
            status_text = "Online" if is_online else "Offline"
            text = (
                f"📊 **Service Status**\n\n"
                f"{status_emoji} Status: **{status_text}**\n"
                f"📈 Success Rate: **{success_rate}%**\n"
                f"✅ Verified Today: **{success_count}**\n"
                f"❌ Failed Today: **{fail_count}**\n"
            )
            if notice:
                text += f"\n📢 **Notice:** {notice}\n"
            text += f"\n🕐 Last updated: {status_cfg.get('lastUpdated', 'N/A')}"

        elif cmd == "start":
            # Handle the Back button to return to the main menu
            contact = config.get("contactSupport", "@Terato1")
            buttons = [
                [
                    InlineKeyboardButton(text="💎 Services", callback_data="cmd_services"),
                    InlineKeyboardButton(text="💰 Deposit", callback_data="cmd_crypto")
                ],
                [
                    InlineKeyboardButton(text="👤 Balance", callback_data="cmd_profile"),
                    InlineKeyboardButton(text="📊 Status", callback_data="cmd_status")
                ],
                [
                    InlineKeyboardButton(text="🎁 Check In", callback_data="cmd_checkin"),
                    InlineKeyboardButton(text="👥 Referrals", callback_data="cmd_referral")
                ],
                [
                    InlineKeyboardButton(text="❓ Help", url=f"https://t.me/{contact.lstrip('@')}")
                ]
            ]
            keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)
            text = build_welcome_text(config, user.get("credits", 0), callback.from_user.id)
            
        else:
            return # Unknown command

        # If the current message has a photo (e.g. going back from Services), 
        # we can't edit it to text. Delete and resend.
        if callback.message.photo:
            await callback.message.delete()
            await callback.message.answer(text, parse_mode="Markdown", reply_markup=keyboard)
        else:
            await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=keyboard)

    except Exception as e:
        logger.error(f"Error handling inline button {cmd}: {e}")
        # Fallback if editing fails (e.g. message is identical)
        try:
            await callback.message.answer(text, parse_mode="Markdown", reply_markup=keyboard)
        except:
            pass


async def main():
    logger.info("Starting SheerID Verifier Bot...")
    await bot.delete_webhook(drop_pending_updates=True)

    # Start crypto payment polling in background
    asyncio.create_task(crypto_service.start_polling(bot))

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
