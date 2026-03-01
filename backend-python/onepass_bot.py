import asyncio
import json
import logging
import os
import re
from typing import Dict, Optional

from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
import httpx
from httpx_sse import connect_sse
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

API_URL = "http://backend:3002/api/verify/dualbot"
BOT_TOKEN = os.getenv("API_BOT_TOKEN")

if not BOT_TOKEN:
    logger.error("API_BOT_TOKEN not found in environment variables!")
    exit(1)

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Simple JSON storage for user CDKs (Mounts to /app/data in Docker so it persists)
DATA_FILE = "/app/data/user_cdks.json"

def load_user_cdks() -> Dict[str, str]:
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading user CDKs: {e}")
    return {}

def save_user_cdk(user_id: str, cdk: str):
    data = load_user_cdks()
    data[str(user_id)] = cdk
    try:
        with open(DATA_FILE, "w") as f:
            json.dump(data, f)
    except Exception as e:
        logger.error(f"Error saving user CDKs: {e}")

def get_user_cdk(user_id: str) -> Optional[str]:
    data = load_user_cdks()
    return data.get(str(user_id))

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    await message.answer(
        "👋 欢迎使用 OnePASS API 认证机器人！\n\n"
        "**使用流程**：\n"
        "1. 使用 `/cdk 你的激活码` 绑定额度\n"
        "2. 发送 SheerID 验证链接给我，我会自动处理并实时返回进度。\n\n"
        "支持批量发送多个链接（每行一个）。",
        parse_mode="Markdown"
    )

@dp.message(Command("cdk"))
async def cmd_cdk(message: types.Message):
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        current_cdk = get_user_cdk(message.from_user.id)
        if current_cdk:
            await message.answer(f"你当前绑定的 CDK 为: `{current_cdk}`\n如需更换，请发送 `/cdk 新激活码`", parse_mode="Markdown")
        else:
            await message.answer("请提供你购买的 CDK 激活码。格式: `/cdk XXXXXX`", parse_mode="Markdown")
        return
    
    cdk = args[1].strip()
    save_user_cdk(message.from_user.id, cdk)
    await message.answer(f"✅ 成功绑定 CDK: `{cdk}`\n现在可以直接发链接给我了！", parse_mode="Markdown")

@dp.message(F.text)
async def handle_links(message: types.Message):
    text = message.text.strip()
    
    # Simple check if text contains SheerID link format
    if "services.sheerid.com/verify" not in text and "verificationId=" not in text:
        # Ignore non-link messages, but if it looks like they are trying to chat, remind them
        if not text.startswith("/"):
            await message.answer("请发送包含 `services.sheerid.com/verify` 的链接以进行认证。如果还没有绑定 CDK，请先发送 `/cdk 你的激活码`。", parse_mode="Markdown")
        return

    user_cdk = get_user_cdk(message.from_user.id)
    if not user_cdk:
        await message.answer("⚠️ 你还没有绑定 CDK 激活码！\n请先使用 `/cdk 你的激活码` 进行绑定。", parse_mode="Markdown")
        return

    # Extract all links (one per line)
    lines = text.split("\n")
    links = [line.strip() for line in lines if "sheerid.com" in line or "verificationId=" in line]
    
    if not links:
        await message.answer("未检测到有效的验证链接，请确保链接包含 sheerid.com 或 verificationId")
        return

    if len(links) > 5:
        await message.answer("⚠️ 一次最多处理 5 条链接")
        return

    status_message = await message.answer(f"🚗 收到 {len(links)} 条链接，准备开始验证...")
    
    payload = {
        "links": links,
        "cdk": user_cdk
    }

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with connect_sse(client, "POST", API_URL, json=payload) as event_source:
                link_status = {link: "⏳ 准备中" for link in links}
                
                async def update_telegram_message(force=False):
                    status_text = "🔄 **认证执行中**\n\n"
                    for i, link in enumerate(links):
                        vid_match = re.search(r'verificationId=([A-Za-z0-9-]+)', link)
                        vid = vid_match.group(1)[:8] + "..." if vid_match else f"链接 {i+1}"
                        status_text += f"🔹 `{vid}`: {link_status[link]}\n"
                    
                    try:
                        await status_message.edit_text(status_text, parse_mode="Markdown", disable_web_page_preview=True)
                    except Exception as e:
                        # Ignore "Message is not modified" errors
                        pass

                await update_telegram_message()

                async for sse in event_source.iter_sse():
                    try:
                        event_data = json.loads(sse.data)
                        
                        if event_data.get("type") == "progress":
                            link = event_data.get("link")
                            step = event_data.get("step")
                            msg = event_data.get("message")
                            
                            step_prefixes = {
                                "warmup": "📄 文档生成中...",
                                "verify": "📤 提交文档中...",
                                "waiting": "⏳ 等待验证...",
                                "cooldown_wait": f"⏳ {msg}"
                            }
                            
                            if link in link_status:
                                link_status[link] = step_prefixes.get(step, msg)
                                await update_telegram_message()
                                
                        elif event_data.get("type") == "done":
                            results = event_data.get("results", [])
                            for res in results:
                                link = res.get("link")
                                if link in link_status:
                                    status = res.get("status")
                                    if status == "approved":
                                        link_status[link] = f"✅ 成功 ({res.get('message', 'Approved')})"
                                    elif status == "failed" or status == "error":
                                        link_status[link] = f"❌ 失败 ({res.get('message', 'Failed')})"
                                    elif status == "no_credits":
                                        link_status[link] = "❌ 账号额度不足"
                                    elif status == "rejected":
                                        link_status[link] = "❌ 被拒绝"
                                    else:
                                        link_status[link] = f"❓ 未知状态 ({status})"
                                        
                            cdk_rem = event_data.get("cdkRemaining", "?")
                            
                            final_text = "✅ **验证任务完成**\n\n"
                            for i, link in enumerate(links):
                                vid_match = re.search(r'verificationId=([A-Za-z0-9-]+)', link)
                                vid = vid_match.group(1)[:8] + "..." if vid_match else f"链接 {i+1}"
                                final_text += f"🔹 `{vid}`: {link_status[link]}\n"
                                
                            final_text += f"\n💳 CDK 剩余次数: {cdk_rem}"
                            await status_message.edit_text(final_text, parse_mode="Markdown", disable_web_page_preview=True)
                            
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse SSE data: {sse.data}")
                        
    except httpx.HTTPStatusError as e:
        error_msg = e.response.text
        try:
            err_json = e.response.json()
            error_msg = err_json.get("detail", error_msg)
        except:
            pass
        await message.answer(f"❌ 请求失败: {error_msg}")
    except httpx.ConnectError:
        await message.answer("❌ 无法连接到后端的 OnePASS API，请检查服务是否正常启动。")
    except Exception as e:
        logger.exception("Error processing link")
        await message.answer(f"❌ 发生意外错误: {str(e)}")

async def main():
    logger.info("Starting OnePASS API Bot...")
    # Drop pending updates to avoid processing old messages on restart
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
