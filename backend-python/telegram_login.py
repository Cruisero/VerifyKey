"""
Telegram Login Script - Run this interactively to create session file.
Usage: python telegram_login.py <api_id> <api_hash>
"""
import sys
import asyncio
from telethon import TelegramClient

async def main():
    if len(sys.argv) < 3:
        print("Usage: python telegram_login.py <api_id> <api_hash>")
        print("Example: python telegram_login.py 12345678 abcdef123456")
        sys.exit(1)
    
    api_id = int(sys.argv[1])
    api_hash = sys.argv[2]
    
    print(f"Logging in with API ID: {api_id}")
    
    # Save session in data/ dir so it persists across Docker rebuilds
    import os
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    os.makedirs(data_dir, exist_ok=True)
    session_path = os.path.join(data_dir, "verifykey")
    print(f"Session will be saved as '{session_path}.session'")
    print()
    
    client = TelegramClient(session_path, api_id, api_hash)
    await client.start()
    
    me = await client.get_me()
    print(f"\n✅ Login successful! Logged in as: {me.username or me.first_name}")
    print("Session file 'verifykey.session' has been created.")
    print("You can now restart the backend and the Userbot will connect automatically.")
    
    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
