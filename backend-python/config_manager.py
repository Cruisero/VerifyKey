"""
Configuration Manager for OnePass Python Backend
Manages AI generator settings and batch.1key.me API configuration
"""

import json
import os
from typing import Optional
from datetime import datetime

# Config file path (inside docker /app/data, locally in current dir)
CONFIG_FILE = "/app/data/config.json"

# Default configuration
DEFAULT_CONFIG = {
    # AI Generator settings
    "aiGenerator": {
        "provider": "gemini",  # 'svg' | 'gemini' | 'batch_api' | 'puppeteer'
        
        # Gemini Official API settings
        "gemini": {
            "enabled": True,
            "apiKey": os.getenv("GEMINI_API_KEY", ""),
            "model": "gemini-3-pro-image-preview"
        },
        
        # batch.1key.me API settings
        "batchApi": {
            "enabled": False,
            "apiUrl": "https://batch.1key.me/api/batch",
            "apiKey": ""
        },
        
        # GetGem.cc API settings
        "getgem": {
            "enabled": False,
            "apiUrl": "https://getgem.cc",
            "cdk": ""
        },
        
        # Puppeteer HTML Template settings (NEW)
        "puppeteer": {
            "enabled": False,
            "template": "student-id-generator.html",  # Selected template file
            "useGeminiPhoto": True,  # Use Gemini AI to generate student photo
            "templatesDir": "templates"  # Templates directory relative to project root
        },
        
        # Region mode: 'global' (all countries) or 'us_only' (only US schools)
        "regionMode": "global",
        
        # University source: 'sheerid_api' (dynamic) or 'custom_list' (local list)
        "universitySource": "sheerid_api",
        
        # SVG Fallback (always available)
        "svgFallback": {
            "enabled": True
        }
    },
    
    # Verification settings
    "verification": {
        "telegram": {
            "enabled": False,
            "apiId": "",
            "apiHash": "",
            "botUsername": "@SheerID_Verification_bot"
        },
        "maxConcurrent": 2,
        "delayBetweenMs": 2000,
        "useCurlCffi": True  # Use curl_cffi for TLS spoofing
    },
    
    # Proxy settings
    "proxy": {
        "enabled": True,
        "host": os.getenv("PROXY_HOST", "geo.iproyal.com"),
        "port": os.getenv("PROXY_PORT", "12321"),
        "user": os.getenv("PROXY_USER", ""),
        "password": os.getenv("PROXY_PASS", "")
    },
    
    # Anti-detection settings
    "antiDetect": {
        "library": "curl_cffi",
        "impersonate": "chrome131",
        "newrelicHeaders": True
    },
    
    # Maintenance mode
    "maintenance": {
        "enabled": False,
        "message": "系统维护中，请稍后再试",
        "estimatedEnd": None
    },
    
    # Last updated
    "updatedAt": None
}


def _deep_merge(target: dict, source: dict) -> dict:
    """Deep merge two dictionaries"""
    result = target.copy()
    for key, value in source.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config() -> dict:
    """Load configuration from file"""
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                config = json.load(f)
            # Merge with defaults to ensure all fields exist
            return _deep_merge(DEFAULT_CONFIG, config)
    except Exception as e:
        print(f"[Config] Error loading config: {e}")
    return DEFAULT_CONFIG.copy()


def save_config(config: dict) -> bool:
    """Save configuration to file"""
    try:
        config["updatedAt"] = datetime.now().isoformat()
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        return True
    except Exception as e:
        print(f"[Config] Error saving config: {e}")
        return False


def get_config() -> dict:
    """Get current configuration"""
    return load_config()


def update_config(updates: dict) -> Optional[dict]:
    """Update configuration"""
    current = load_config()
    updated = _deep_merge(current, updates)
    return updated if save_config(updated) else None


def get_active_generator() -> dict:
    """Get active AI generator settings"""
    config = load_config()
    provider = config.get("aiGenerator", {}).get("provider", "svg")
    
    if provider == "gemini":
        gemini = config.get("aiGenerator", {}).get("gemini", {})
        return {
            "type": "gemini",
            "apiKey": gemini.get("apiKey", ""),
            "model": gemini.get("model", "gemini-3-pro-image-preview"),
            "fallbackToSvg": config.get("aiGenerator", {}).get("svgFallback", {}).get("enabled", True)
        }
    
    elif provider == "batch_api":
        batch = config.get("aiGenerator", {}).get("batchApi", {})
        return {
            "type": "batch_api",
            "apiUrl": batch.get("apiUrl", "https://batch.1key.me/api/batch"),
            "apiKey": batch.get("apiKey", ""),
            "fallbackToSvg": config.get("aiGenerator", {}).get("svgFallback", {}).get("enabled", True)
        }
    
    else:  # svg
        return {
            "type": "svg",
            "fallbackToSvg": True
        }


def get_proxy_url() -> Optional[str]:
    """Get proxy URL from config"""
    config = load_config()
    proxy = config.get("proxy", {})
    
    if not proxy.get("enabled"):
        return None
    
    user = proxy.get("user", "")
    password = proxy.get("password", "")
    host = proxy.get("host", "")
    port = proxy.get("port", "")
    
    if not user or not password:
        return None
    
    # Add dynamic session
    session_id = f"sess_{datetime.now().timestamp():.0f}"
    return f"http://{user}_{session_id}:{password}@{host}:{port}"


def get_available_templates() -> list:
    """Get list of available HTML templates from the templates directory"""
    from pathlib import Path
    
    # Templates directory (relative to project root)
    # In Docker: /app/templates, Locally: ../templates relative to this file
    possible_paths = [
        Path("/app/templates"),
        Path(__file__).parent.parent / "templates"
    ]
    
    templates = []
    
    for templates_dir in possible_paths:
        if templates_dir.exists():
            for file in templates_dir.glob("*.html"):
                templates.append({
                    "name": file.stem.replace("-", " ").replace("_", " ").title(),
                    "filename": file.name,
                    "path": str(file)
                })
            break
    
    return templates


def get_puppeteer_settings() -> dict:
    """Get Puppeteer template settings"""
    config = load_config()
    puppeteer = config.get("aiGenerator", {}).get("puppeteer", {})
    
    return {
        "enabled": puppeteer.get("enabled", False),
        "template": puppeteer.get("template", "student-id-generator.html"),
        "useGeminiPhoto": puppeteer.get("useGeminiPhoto", True),
        "availableTemplates": get_available_templates()
    }

