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
        "dualBot": {
            "enabled": False,
            "costPerVerify": 1.0,
            "warmupBot": "@SatsetHelperbot",
            "verifyBot": "@AutoGeminiProbot",
            "autoBypass": True,
            "processingKeywords": [
                "SEDANG MEMPROSES", "SEDANG DI PROSES", "PROCESSING YOUR", "PROCESSING...",
                "WAIT...", "⏳", "LOADING", "MOHON TUNGGU", "TUNGGU SEBENTAR"
            ],
            "responseRules": [
                {
                    "keywords": ["🎉", "VERIFICATION SUCCESSFUL", "SUCCESSFULLY VERIFIED"],
                    "status": "approved",
                    "success": True,
                    "message": "验证通过",
                    "messageKey": "msgApproved"
                },
                {
                    "keywords": ["FRAUD", "DETECTING FRAUD"],
                    "status": "failed",
                    "success": False,
                    "message": "检测到欺诈行为，请刷新页面获取新链接",
                    "messageKey": "msgFraudDetected",
                    "failureReasonKey": "reasonFraud"
                },
                {
                    "keywords": ["HABIS", "KURANG", "TIDAK BISA"],
                    "status": "failed",
                    "success": False,
                    "message": "程序崩溃，请重试",
                    "messageKey": "msgCrashed",
                    "failureReasonKey": "reasonNoBotCredits"
                },
                {
                    "keywords": ["FAILED", "❌", "REJECTED", "UNSUCCESSFUL", "ERROR", "EXPIRED", "SUSAH"],
                    "status": "failed",
                    "success": False,
                    "message": "验证失败",
                    "messageKey": "msgVerifyFailedDetail",
                    "failureReasonKey": "reasonDocRejected"
                },
                {
                    "keywords": ["CONGRATULATIONS", "APPROVED", "VERIFIED", "SUCCESS", "✅", "SETUJU", "BERHASIL"],
                    "status": "approved",
                    "success": True,
                    "message": "验证通过",
                    "messageKey": "msgApproved"
                }
            ],
            "warmupSuccessKeywords": ["PROSES SELESAI", "PROCESS FINISHED", "SELESAI!"],
            "cooldown": {
                "keywords": ["COOLDOWN"],
                "timePattern": r"(\d+)\s*M"
            },
            "quota": {
                "remainingPattern": r"TOTAL\s+TERSEDIA[:\s]*\*{0,2}(\d+)\*{0,2}"
            },
            "maxRetries": 5,
            "warmupTimeout": 90,
            "verifyTimeout": 120
        },
        "gptRechargeBot": {
            "enabled": False,
            "targetBot": "@AutoRechargeProbot",
            "sendFormat": "{accessToken}",
            "botFirstFallbackToKey": False,
            "preCommandEnabled": True,
            "preCommand": "⚡ 激活plus母号",
            "preCommandTimeout": 45,
            "processingKeywords": ["PROCESSING", "处理中", "WAIT", "⏳", "RUNNING"],
            "responseRules": [
                {
                    "keywords": ["SUCCESS", "SUCCESSFUL", "充值成功", "✅", "DONE", "COMPLETED"],
                    "status": "approved",
                    "success": True,
                    "message": "充值成功"
                },
                {
                    "keywords": ["COOLDOWN", "RATE LIMIT", "TOO MANY"],
                    "status": "cooldown",
                    "success": False,
                    "message": "账号冷却中"
                },
                {
                    "keywords": ["FAILED", "FAIL", "ERROR", "❌", "INVALID", "EXPIRED", "充值失败"],
                    "status": "failed",
                    "success": False,
                    "message": "充值失败"
                }
            ],
            "cooldown": {
                "keywords": ["COOLDOWN", "RATE LIMIT", "TOO MANY"],
                "timePattern": "(\\d+)\\s*[MS]"
            },
            "timeout": 120,
            "maxRetries": 5
        },
        "singleBots": [
            {
                "id": "blackbot",
                "name": "Black Bot",
                "username": "@Black_Verifier",
                "enabled": False,
                "costPerVerify": 1.0,
                "autoBypass": True,
                "sendFormat": "{link}",
                "autoClickButtons": ["API Key", "API"],
                "responseRules": [
                    {
                        "keywords": ["VERIFICATION SUCCESSFUL"],
                        "status": "approved",
                        "success": True,
                        "message": "验证通过",
                        "messageKey": "msgApproved"
                    },
                    {
                        "keywords": ["FRAUD REJECT", "FRAUD"],
                        "status": "failed",
                        "success": False,
                        "message": "检测到欺诈行为，请刷新页面获取新链接",
                        "failureReasonKey": "reasonFraud",
                        "messageKey": "msgFraudDetected"
                    },
                    {
                        "keywords": ["VERIFICATION REJECTED"],
                        "status": "failed",
                        "success": False,
                        "message": "文档验证失败，SheerID 拒绝了上传的文件",
                        "failureReasonKey": "reasonDocRejected",
                        "messageKey": "msgVerifyFailedDetail"
                    },
                    {
                        "keywords": ["TASK FAILED"],
                        "status": "failed",
                        "success": False,
                        "message": "任务失败",
                        "failureReasonKey": "reasonTaskFailed",
                        "messageKey": "msgVerifyFailedDetail"
                    },
                    {
                        "keywords": ["VERIFICATION TIMED OUT", "TIMED OUT"],
                        "status": "failed",
                        "success": False,
                        "message": "验证超时，链接审核时间过长",
                        "failureReasonKey": "reasonTimedOut",
                        "messageKey": "msgVerifyFailedDetail"
                    },
                    {
                        "keywords": ["FAILED", "❌", "REJECTED", "ERROR", "EXPIRED"],
                        "status": "failed",
                        "success": False,
                        "message": "验证失败",
                        "failureReasonKey": "reasonFailed",
                        "messageKey": "msgVerifyFailedDetail"
                    }
                ],
                "processingKeywords": ["PROCESSING", "⏳", "WAIT", "LOADING"],
                "cooldown": {
                    "keywords": ["COOLDOWN", "RATE LIMIT", "TOO MANY"],
                    "timePattern": r"(\d+)\s*M"
                },
                "quota": {
                    "remainingPattern": r"(\d+)\s+VERIFICATIONS?\s+REMAINING"
                },
                "maxRetries": 5,
                "timeout": 180
            },
            {
                "id": "oldbot",
                "name": "SheerID Bot",
                "username": "@SheerID_Verification_bot",
                "enabled": False,
                "costPerVerify": 1.0,
                "autoBypass": False,
                "sendFormat": "{link}",
                "autoClickButtons": [],
                "concurrentPerAccount": 3,
                "responseRules": [
                    {
                        "keywords": ["YOUR LINK HAS BEEN VERIFIED SUCCESSFULLY", "SUCCESSFULLY", "CONGRATULATIONS", "VERIFICATION APPROVED", "STATUS: VERIFIED"],
                        "status": "approved",
                        "success": True,
                        "message": "验证成功",
                        "messageKey": "msgApproved"
                    },
                    {
                        "keywords": ["FAILED TO VERIFY", "REJECTED", "ERROR", "EXPIRED", "❌"],
                        "status": "failed",
                        "success": False,
                        "message": "验证失败",
                        "failureReasonKey": "reasonFailed",
                        "messageKey": "msgVerifyFailedDetail"
                    }
                ],
                "processingKeywords": ["PROCESSING YOUR VERIFICATION", "⏳"],
                "cooldown": {
                    "keywords": ["COOLDOWN", "RATE LIMIT"],
                    "timePattern": "(\\d+)\\s*M"
                },
                "maxRetries": 5,
                "timeout": 120
            }
        ],
        "maxConcurrent": 2,
        "delayBetweenMs": 2000,
        "useCurlCffi": True  # Use curl_cffi for TLS spoofing
    },
    
    # Telegram accounts (multi-account support)
    "telegramAccounts": [],
    
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

    # Per-service manual maintenance overrides
    "serviceMaintenance": {
        "upixel": False,
        "kpixel": False,
        "vpixel": False,
        "gpt": False,
        "gpt_tg": False,
        "gpt_team": False
    },
    
    # Tips inline (shown on verify page)
    "tipsInline": {
        "content": "在 one.google.com/ai-student 的蓝色按钮上右键复制链接，不要点进去！建议用无痕窗口登录账户获取。\n如果验证链接中 verificationId= 后面是空的，建议直接换号。\n一次消耗一个配额，成功后自动扣除。"
    },
    
    # Pixel API (Google One via iqless.icu) — "UPixel" 普通验证
    "pixelApi": {
        "enabled": False,
        "apiKey": "",  # ak_XXXX-XXXX-... format
        "baseUrl": "https://iqless.icu",
        "creditCost": 1.0
    },
    
    # KPixel API (Google One via kckc1818.com) — "KPixel" Pro 验证
    "kpixelApi": {
        "enabled": False,
        "cdkey": "",  # K-XXXX... format
        "baseUrl": "https://2key.kckc1818.com/openapi.php",
        "creditCost": 1.5
    },
    
    # VPixel API (Google One via 1688ai.vip) — 与 KPixel 共享 "高级验证" 通道
    "vpixelApi": {
        "enabled": False,
        "card": "",           # 卡密 code
        "baseUrl": "http://1688ai.vip",
        "creditCost": 1.5
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
