import json

path = '/Users/bradpit/Code/VerifyKey/data/bot_config.json'
try:
    with open(path, 'r') as f:
        data = json.load(f)
    for s in data.get('services', []):
        if s.get('name') == 'Spotify':
            s['name'] = 'Gemini'
            s['emoji'] = '🎵' # Keeping the emoji for now as requested
    
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print("Config updated.")
except Exception as e:
    print(f"Error: {e}")
