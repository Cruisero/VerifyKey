"""
Test script - use separate session to avoid conflict with main backend
"""
import asyncio
from telethon import TelegramClient, events

async def test():
    # Use separate session name to avoid lock conflict
    client = TelegramClient("test_session", 34115138, "16f38fb2725e11c04d79d487efa7459a")
    await client.start()
    me = await client.get_me()
    print(f"Logged in as: {me.first_name} (ID: {me.id})")
    
    responses = []
    
    @client.on(events.NewMessage(from_users="SheerID_Bot"))
    async def handler(event):
        text = event.message.text or "(no text)"
        print(f"[BOT RESPONSE] {text}")
        if event.message.buttons:
            for row in event.message.buttons:
                for btn in row:
                    btn_data = getattr(btn, "data", None)
                    print(f"  BTN: '{btn.text}' data={btn_data}")
        if event.message.media:
            print(f"  MEDIA: {type(event.message.media).__name__}")
        responses.append(text)
    
    # Test /daily
    print("\n=== Sending /daily ===")
    await client.send_message("SheerID_Bot", "/daily")
    await asyncio.sleep(10)
    
    # Test /balance
    print("\n=== Sending /balance ===")
    await client.send_message("SheerID_Bot", "/balance")
    await asyncio.sleep(10)
    
    # Test /verify
    print("\n=== Sending /verify ===")
    await client.send_message("SheerID_Bot", "/verify")
    await asyncio.sleep(10)
    
    print(f"\nTotal responses captured: {len(responses)}")
    
    # Cleanup test session
    import os
    await client.disconnect()
    try:
        os.remove("test_session.session")
    except:
        pass

asyncio.run(test())
