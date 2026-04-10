"""
OnePass Python Backend with curl_cffi Anti-Detection
FastAPI-based API server for SheerID verification

Features:
- TLS fingerprint spoofing (curl_cffi)
- NewRelic tracking headers
- Chrome browser impersonation
- SVG document generation
"""

import os
import json
import asyncio
import re
import contextlib
import time
import base64
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import logging
import uuid

from fastapi import FastAPI, HTTPException, BackgroundTasks, Header, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from verifier import SheerIDVerifier, parse_verification_id, poll_verification_status
from doc_generator import generate_document
from puppeteer_doc_generator import generate_document_puppeteer
from lionpath_generator import generate_lionpath_image, generate_psu_email, get_available_templates
from uiuc_generator import generate_uiuc_image, generate_uiuc_email, get_available_templates as get_uiuc_templates
from sheerid_generator import generate_document as generate_document_sheerid
from vsid_generator import generate_vsid_document, get_available_document_types as get_vsid_document_types
import auth
import cdk_manager
import verification_history
from bot_stats import bot_stats_tracker
from node_health_monitor import node_health_monitor
import database

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize database
auth.init_database()
database.init_db()
cdk_manager.normalize_existing_cdks()
database.start_auto_backup()

# Configuration
PORT = int(os.getenv("PORT", 3003))
PROXY_HOST = os.getenv("PROXY_HOST", "geo.iproyal.com")
PROXY_PORT = os.getenv("PROXY_PORT", "12321")
PROXY_USER = os.getenv("PROXY_USER", "")
PROXY_PASS = os.getenv("PROXY_PASS", "")

# Telegram Userbot instance
from telegram_userbot import SheerIDUserbot
from telegram_manager import TelegramAccountManager
from dual_bot_verifier import DualBotVerifier
from generic_single_bot_verifier import GenericSingleBotVerifier
telegram_bot: Optional[SheerIDUserbot] = None
# Old bot per-account cooldown tracking {account_id: expiry_timestamp}
_oldbot_cooldowns: Dict[str, float] = {}
# Single bots per-account cooldown tracking {bot_id: {account_id: expiry_timestamp}}
_singlebot_cooldowns: Dict[str, Dict[str, float]] = {}
# Bot suspension tracking {bot_id: expiry_timestamp}
_bot_suspensions: Dict[str, float] = {}
tg_manager = TelegramAccountManager()
dual_bot = DualBotVerifier()
# VID deduplication: prevent the same VID from being processed simultaneously
_vid_locks: dict = {}  # vid -> asyncio.Lock
_vid_results: dict = {}  # vid -> result dict (cached for 60s)

# ---- Pending GetGem task persistence (survives container restarts) ----
import time as _time
PENDING_GETGEM_FILE = os.path.join(os.path.dirname(__file__), "data", "pending_getgem_tasks.json")
PENDING_ASYNC_TASKS_FILE = os.path.join(os.path.dirname(__file__), "data", "pending_async_tasks.json")

def _save_pending_getgem_task(vid: str, task_id: str, cdk: str):
    """Save a pending GetGem task so it can be resumed after restart."""
    try:
        os.makedirs(os.path.dirname(PENDING_GETGEM_FILE), exist_ok=True)
        tasks = {}
        if os.path.exists(PENDING_GETGEM_FILE):
            with open(PENDING_GETGEM_FILE, "r") as f:
                tasks = json.load(f)
        tasks[vid] = {"taskId": task_id, "cdk": cdk, "timestamp": _time.time()}
        with open(PENDING_GETGEM_FILE, "w") as f:
            json.dump(tasks, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"[GetGem] Failed to save pending task {vid[:8]}: {e}")

def _remove_pending_getgem_task(vid: str):
    """Remove a completed GetGem task from pending file."""
    try:
        if not os.path.exists(PENDING_GETGEM_FILE):
            return
        with open(PENDING_GETGEM_FILE, "r") as f:
            tasks = json.load(f)
        if vid in tasks:
            del tasks[vid]
            with open(PENDING_GETGEM_FILE, "w") as f:
                json.dump(tasks, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"[GetGem] Failed to remove pending task {vid[:8]}: {e}")

def _load_pending_getgem_tasks() -> dict:
    """Load all pending GetGem tasks."""
    try:
        if os.path.exists(PENDING_GETGEM_FILE):
            with open(PENDING_GETGEM_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f"[GetGem] Failed to load pending tasks: {e}")
    return {}


def _save_pending_async_task(task_type: str, task_id: str, payload: dict):
    try:
        os.makedirs(os.path.dirname(PENDING_ASYNC_TASKS_FILE), exist_ok=True)
        tasks = {}
        if os.path.exists(PENDING_ASYNC_TASKS_FILE):
            with open(PENDING_ASYNC_TASKS_FILE, "r") as f:
                tasks = json.load(f)
        key = f"{task_type}:{task_id}"
        tasks[key] = {
            "type": task_type,
            "task_id": task_id,
            "payload": payload,
            "timestamp": _time.time(),
        }
        with open(PENDING_ASYNC_TASKS_FILE, "w") as f:
            json.dump(tasks, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"[AsyncTask] Failed to save pending task {task_type}:{task_id}: {e}")


def _remove_pending_async_task(task_type: str, task_id: str):
    try:
        if not os.path.exists(PENDING_ASYNC_TASKS_FILE):
            return
        with open(PENDING_ASYNC_TASKS_FILE, "r") as f:
            tasks = json.load(f)
        key = f"{task_type}:{task_id}"
        if key in tasks:
            del tasks[key]
            with open(PENDING_ASYNC_TASKS_FILE, "w") as f:
                json.dump(tasks, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"[AsyncTask] Failed to remove pending task {task_type}:{task_id}: {e}")


def _load_pending_async_tasks() -> dict:
    try:
        if os.path.exists(PENDING_ASYNC_TASKS_FILE):
            with open(PENDING_ASYNC_TASKS_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f"[AsyncTask] Failed to load pending tasks: {e}")
    return {}


def _translate_getgem_error(raw_error: str) -> str:
    """Translate raw GetGem error strings to user-friendly Chinese messages."""
    error_map = {
        "fraudRulesReject": "检测到欺诈行为，请刷新页面获取新链接",
        "maxRetriesExceeded": "已达最大重试次数，请刷新页面获取新链接",
        "expiredVerification": "验证链接已过期，请刷新页面获取新链接",
        "invalidVerification": "无效的验证链接",
        "docReviewReject": "文档审核未通过，请刷新页面获取新链接",
        "docReviewRejection": "文档审核被拒绝，请刷新页面获取新链接",
        "noMatchingRecord": "未找到匹配记录，请检查信息是否正确",
        "alreadyVerified": "此链接已被验证过",
        "programHasEnded": "该验证活动已结束",
        "internalError": "服务器内部错误，请稍后重试",
        "rateLimited": "请求过于频繁，请稍后重试",
        "maxAttemptsReached": "已达最大尝试次数，请刷新页面获取新链接",
    }
    for key, msg in error_map.items():
        if key.lower() in raw_error.lower():
            return msg
    if "rejected:" in raw_error.lower():
        return "验证被拒绝，请刷新页面获取新链接"
    return raw_error


async def _resume_getgem_poll(vid: str, task_id: str, cdk: str):
    """Resume polling a GetGem task after container restart."""
    import httpx
    import config_manager
    config = config_manager.get_config()
    getgem_url = config.get("verification", {}).get("getgemApiUrl", "https://getgem.cc")

    logger.info(f"[GetGem Recovery] Resuming poll for VID {vid[:8]}... taskId={task_id[:8]}...")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            for attempt in range(60):
                await asyncio.sleep(5)
                try:
                    status_resp = await client.get(f"{getgem_url}/api/status/{task_id}")
                    if status_resp.status_code != 200:
                        continue
                    status_data = status_resp.json()

                    if status_data.get("completed"):
                        if status_data.get("success"):
                            logger.info(f"[GetGem Recovery] VID {vid[:8]} APPROVED!")
                            verification_history.log_verification("pass", vid, cdk=cdk)
                            # Deduct CDK
                            if cdk:
                                cdk_manager.use_cdk(cdk, 1)
                            broadcast_verify_event({
                                "type": "progress", "vid": vid, "step": "result",
                                "success": True, "status": "approved",
                                "message": "验证成功（重启恢复）",
                                "interMsg": "Verification approved (recovered after restart)",
                            })
                        else:
                            error = status_data.get("error", "Unknown error")
                            translated = _translate_getgem_error(error)
                            logger.info(f"[GetGem Recovery] VID {vid[:8]} FAILED: {error}")
                            verification_history.log_verification("failed", vid, cdk=cdk)
                            broadcast_verify_event({
                                "type": "progress", "vid": vid, "step": "result",
                                "success": False, "status": "failed",
                                "message": f"验证失败: {translated}",
                                "interMsg": f"Verification failed: {error}",
                            })
                        _remove_pending_getgem_task(vid)
                        return
                except Exception as poll_err:
                    logger.warning(f"[GetGem Recovery] Poll error for {vid[:8]}: {poll_err}")

            # Timeout after 5 minutes of polling
            logger.warning(f"[GetGem Recovery] VID {vid[:8]} poll timed out")
            verification_history.log_verification("failed", vid, cdk=cdk)
            broadcast_verify_event({
                "type": "progress", "vid": vid, "step": "result",
                "success": False, "status": "timeout",
                "message": "轮询超时（重启恢复）",
                "interMsg": "Poll timed out (recovered after restart)",
            })
            _remove_pending_getgem_task(vid)
    except Exception as e:
        logger.error(f"[GetGem Recovery] Fatal error for {vid[:8]}: {e}")
        _remove_pending_getgem_task(vid)

# ========== Admin SSE Event Bus ==========
_admin_sse_subscribers: list = []  # list of asyncio.Queue for connected admin clients
_user_sse_subscribers: dict = {}  # user_id -> list[asyncio.Queue]
_terminal_verify_events: dict = {}  # vid -> {"status": "pass"|"failed", "timestamp": float}

# ========== Manual Override Signal ==========
# VID → {"status": "pass"|"failed", "timestamp": float}
# Running verification tasks check this to early-return when admin manually overrides
_manual_overrides: dict = {}

def set_manual_override(vid: str, status: str):
    """Set a manual override for a verification ID."""
    import time
    _manual_overrides[vid] = {"status": status, "timestamp": time.time()}

def check_manual_override(vid: str):
    """Check if a VID has been manually overridden. Returns status or None."""
    entry = _manual_overrides.get(vid)
    if entry:
        import time
        # Override valid for 10 minutes
        if time.time() - entry["timestamp"] < 600:
            return entry["status"]
        else:
            _manual_overrides.pop(vid, None)
    return None

def consume_manual_override(vid: str):
    """Check and consume a manual override (removes it after reading)."""
    entry = _manual_overrides.pop(vid, None)
    if entry:
        import time
        if time.time() - entry["timestamp"] < 600:
            return entry["status"]
    return None


def _normalize_terminal_status(status: str):
    value = (status or "").lower()
    if value in ("pass", "success", "approved"):
        return "pass"
    if value in ("failed", "fail", "error", "rejected", "cancel", "cancelled", "canceled", "timeout"):
        return "failed"
    return None


def _remember_terminal_verify_event(vid: str, status: str):
    normalized = _normalize_terminal_status(status)
    if not vid or not normalized:
        return
    import time
    _terminal_verify_events[vid] = {"status": normalized, "timestamp": time.time()}

    cutoff = time.time() - (24 * 60 * 60)
    expired = [key for key, value in _terminal_verify_events.items() if value.get("timestamp", 0) < cutoff]
    for key in expired:
        _terminal_verify_events.pop(key, None)


def _has_terminal_verify_event(vid: str):
    if not vid:
        return False
    entry = _terminal_verify_events.get(vid)
    if not entry:
        return False
    import time
    if time.time() - entry.get("timestamp", 0) > 24 * 60 * 60:
        _terminal_verify_events.pop(vid, None)
        return False
    return True


def _build_verify_event_meta(source: str, email: str = "", user_id: int = 0, method: str = "", card_key: str = "", channel: str = ""):
    return {
        "source": source,
        "link": email or "",
        "submitEmail": email or "",
        "userId": f"user:{user_id}" if user_id else "",
        "method": method or source,
        "cardKey": card_key or "",
        "channel": channel or "",
    }


def _parse_event_user_id(event: dict) -> int:
    raw_user_id = event.get("userId") or event.get("user_id") or ""
    if isinstance(raw_user_id, int):
        return raw_user_id
    if isinstance(raw_user_id, str):
        raw_user_id = raw_user_id.strip()
        if raw_user_id.startswith("user:"):
            raw_user_id = raw_user_id.split(":", 1)[1]
        try:
            return int(raw_user_id)
        except Exception:
            return 0
    return 0


def _build_user_active_verifications(user_id: int) -> list:
    if not user_id:
        return []

    source_label_map = {
        "pixel": "pixel",
        "kpixel": "kpixel",
        "vpixel": "vpixel",
        "ypixel": "ypixel",
    }
    default_message_map = {
        "pixel": "⏳ 排队中...",
        "kpixel": "⏳ 排队中...",
        "vpixel": "⏳ 排队中...",
        "ypixel": "⏳ 排队中...",
    }

    active_items = []
    pending_tasks = _load_pending_async_tasks()
    for _, info in (pending_tasks or {}).items():
        task_type = (info or {}).get("type", "")
        if task_type not in source_label_map:
            continue

        task_id = str((info or {}).get("task_id", "") or "")
        payload = (info or {}).get("payload") or {}
        if int(payload.get("user_id") or 0) != int(user_id):
            continue

        existing = _get_user_verification_row(task_id, user_id)
        if existing and _is_terminal_history_status(existing["status"]):
            continue

        status = "processing"
        message = default_message_map.get(task_type, "⏳ 处理中...")
        elapsed = 0
        url = ""

        if task_type == "vpixel":
            cache = _vpixel_job_status.get(task_id) or {}
            cache_status = (cache.get("status") or "").lower()
            status = "processing" if cache_status in ("pending", "running", "") else ("success" if cache_status == "success" else "failed")
            message = cache.get("message") or message
            elapsed = cache.get("elapsed") or 0
            url = cache.get("url") or ""
        elif task_type == "ypixel":
            cache = _ypixel_job_status.get(task_id) or {}
            cache_status = (cache.get("status") or "").lower()
            status = "processing" if cache_status in ("pending", "running", "") else ("success" if cache_status == "success" else "failed")
            message = cache.get("message") or message
            elapsed = cache.get("elapsed") or 0
            url = cache.get("url") or ""

        if status != "processing":
            continue

        active_items.append({
            "id": task_id,
            "verificationId": task_id,
            "type": "pixel",
            "source": source_label_map[task_type],
            "status": status,
            "email": payload.get("email") or "",
            "message": message,
            "timestamp": datetime.utcfromtimestamp((info or {}).get("timestamp") or time.time()).isoformat() + "Z",
            "elapsed": elapsed,
            "url": url,
        })

    active_items.sort(key=lambda item: item.get("timestamp", ""), reverse=True)
    return active_items


def _persist_verification_history_strict(status: str, verification_id: str, message: str = "", cdk: str = "", via: str = "", email: str = ""):
    record = None
    try:
        record = verification_history.log_verification(status, verification_id, message, cdk=cdk, via=via, email=email)
    except Exception as e:
        logger.warning(f"[History] log_verification failed for {verification_id} ({status}/{via}): {e}")

    try:
        conn = database.get_connection()
        row = conn.execute(
            "SELECT id, status, verification_id, message, cdk, timestamp, via, email FROM verification_history WHERE verification_id = ? AND status = ? ORDER BY rowid DESC LIMIT 1",
            (verification_id, status),
        ).fetchone()
        if row:
            return {
                "success": True,
                "record": {
                    "id": row["id"],
                    "status": row["status"],
                    "verificationId": row["verification_id"],
                    "message": row["message"],
                    "cdk": row["cdk"],
                    "timestamp": row["timestamp"],
                    "via": row["via"] if "via" in row.keys() else "",
                    "submitEmail": row["email"] if "email" in row.keys() else "",
                },
                "fallbackInserted": False,
            }
    except Exception as e:
        logger.warning(f"[History] verification read failed for {verification_id} ({status}/{via}): {e}")

    try:
        conn = database.get_connection()
        record_id = (record or {}).get("id") or str(uuid.uuid4())[:8]
        now = datetime.utcnow().isoformat() + "Z"
        try:
            conn.execute(
                "INSERT INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (record_id, status, verification_id, message, cdk, now, via, email),
            )
        except Exception:
            conn.execute(
                "INSERT INTO verification_history (id, status, verification_id, message, cdk, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                (record_id, status, verification_id, message, cdk, now),
            )
        conn.commit()
        logger.warning(f"[History] Fallback inserted record for {verification_id} ({status}/{via})")
        return {
            "success": True,
            "record": {
                "id": record_id,
                "status": status,
                "verificationId": verification_id,
                "message": message,
                "cdk": cdk,
                "timestamp": now,
                "via": via,
            },
            "fallbackInserted": True,
        }
    except Exception as e:
        logger.error(f"[History] Failed to persist record for {verification_id} ({status}/{via}): {e}")
        return {"success": False, "record": record, "error": str(e)}


def _record_submit_failure(source: str, message: str, email: str = "", user_id: int = 0, method: str = "", http_status: int = 0, upstream_status: int = 0, refunded: bool = False, card_key: str = "", channel: str = "", via: str = ""):
    attempt_id = _broadcast_submit_failure(
        source,
        message,
        email=email,
        user_id=user_id,
        method=method,
        http_status=http_status,
        upstream_status=upstream_status,
        refunded=refunded,
        card_key=card_key,
        channel=channel,
    )
    if user_id:
        _persist_verification_history_strict(
            "failed",
            attempt_id,
            message,
            cdk=f"user:{user_id}",
            via=via or source,
            email=email,
        )
    return attempt_id


def _broadcast_submit_failure(source: str, message: str, email: str = "", user_id: int = 0, method: str = "", http_status: int = 0, upstream_status: int = 0, refunded: bool = False, card_key: str = "", channel: str = ""):
    attempt_id = f"submit_{source}_{uuid.uuid4().hex[:12]}"
    broadcast_verify_event({
        "type": "progress",
        "vid": attempt_id,
        "step": "submit_failed",
        "status": "failed",
        "success": False,
        "message": message,
        "requestStage": "submission",
        "httpStatus": http_status or 0,
        "upstreamStatus": upstream_status or http_status or 0,
        "refunded": bool(refunded),
        **_build_verify_event_meta(source, email, user_id, method, card_key, channel),
    })
    return attempt_id


def broadcast_verify_event(event: dict):
    """Broadcast a verification event to all connected admin SSE subscribers."""
    import json as _json_bc

    if event.get("type") == "progress":
        vid = event.get("vid", "")
        if _has_terminal_verify_event(vid) and not event.get("forceTerminalUpdate"):
            return
        if event.get("step") == "result":
            final_status = "pass" if event.get("success") else (event.get("status") or "failed")
            _remember_terminal_verify_event(vid, final_status)
    elif event.get("type") == "done":
        for result in event.get("results", []) or []:
            vid = result.get("verificationId") or result.get("vid") or ""
            final_status = "pass" if result.get("success") else (result.get("status") or "failed")
            _remember_terminal_verify_event(vid, final_status)

    for q in _admin_sse_subscribers:
        try:
            q.put_nowait(event)
        except Exception:
            pass

    user_id = _parse_event_user_id(event)
    if user_id and _user_sse_subscribers.get(user_id):
        for q in list(_user_sse_subscribers.get(user_id) or []):
            try:
                q.put_nowait(event)
            except Exception:
                pass

app = FastAPI(
    title="OnePass Python Backend",
    description="SheerID Verification with curl_cffi Anti-Detection",
    version="2.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response Models
class VerifyRequest(BaseModel):
    verificationIds: List[str]
    programId: Optional[str] = None


class TelegramVerifyRequest(BaseModel):
    links: List[str]  # Full verification URLs
    cdk: Optional[str] = None  # CDK code for quota


class CDKGenerateRequest(BaseModel):
    count: int = 1
    quota: float = 5.0
    note: str = ""


class CDKValidateRequest(BaseModel):
    code: str


class CDKDeleteRequest(BaseModel):
    code: str


class VerifyResult(BaseModel):
    verificationId: str
    status: str
    success: bool
    message: str
    student: Optional[str] = None
    email: Optional[str] = None
    school: Optional[str] = None


class VerifyResponse(BaseModel):
    results: List[VerifyResult]
    stats: dict


def get_proxy_url() -> Optional[str]:
    """Build proxy URL from config.json (saved via admin panel)"""
    import config_manager
    
    config = config_manager.load_config()
    proxy = config.get("proxy", {})
    
    if not proxy.get("enabled"):
        return None
    
    user = proxy.get("user", "")
    password = proxy.get("password", "")
    host = proxy.get("host", "")
    port = proxy.get("port", "")
    
    if not user or not password or not host:
        return None
    
    # Add dynamic session for IP2UP format
    import uuid
    session_id = uuid.uuid4().hex[:16]
    
    # If username already has session info, use as-is; otherwise add session
    if "_" in user and len(user.split("_")) >= 5:
        # User already has full format, just use it
        username = user
    else:
        # Add session info for sticky IP
        username = f"{user}_{session_id}"
    
    proxy_url = f"http://{username}:{password}@{host}:{port}"
    return proxy_url


def verify_single(vid: str, proxy: str = None) -> dict:
    """Verify a single verification ID (synchronous)"""
    
    # Parse verification ID
    parsed_id = parse_verification_id(vid)
    if not parsed_id:
        return {
            "verificationId": vid[:24] if len(vid) > 24 else vid,
            "status": "error",
            "success": False,
            "message": "Invalid verification ID format"
        }
    
    print(f"\n[Verify] Starting: {parsed_id}")
    
    progress_messages = []
    def on_progress(data):
        progress_messages.append(data)
        print(f"[Verify] {data.get('step', '')}: {data.get('message', '')}")
    
    try:
        # Create verifier with anti-detection
        verifier = SheerIDVerifier(
            verification_id=parsed_id,
            proxy=proxy,
            on_progress=on_progress
        )
        
        # Check link first
        check_result = verifier.check_link()
        if not check_result.get("valid"):
            return {
                "verificationId": parsed_id,
                "status": "error",
                "success": False,
                "message": check_result.get("error", "Link check failed")
            }
        
        # Pre-generate student info so we can use it for document generation
        # This ensures the form data and document data match!
        from verifier import select_university, generate_name, generate_email, generate_birth_date, lookup_organization_id
        
        # Read region mode and university source from config
        import config_manager
        config = config_manager.get_config()
        region_mode = config.get("aiGenerator", {}).get("regionMode", "global")
        university_source = config.get("aiGenerator", {}).get("universitySource", "sheerid_api")
        provider = config.get("aiGenerator", {}).get("provider", "gemini")
        
        # OnepassHTML template-to-org mapping (each template has its own fixed school)
        ONEPASSHTML_ORG_MAP = {
            "rit-demand-letter.html": {
                "id": 0,
                "idExtended": None,
                "name": "Roorkee Institute of Technology",
                "country": "IN",
                "domain": "rit.ac.in"
            },
            "rit-enrollment-verify.html": {
                "id": 0,
                "idExtended": None,
                "name": "University of South Florida",
                "country": "US",
                "domain": "usf.edu"
            }
        }
        
        # For LionPATH mode, always use Penn State University
        if provider == "lionpath":
            org = {
                "id": 2565,  # Penn State Main Campus (University Park) - correct ID for current program
                "idExtended": None,  # SheerID API returns null for this org
                "name": "Pennsylvania State University-Main Campus (University Park, PA)",
                "country": "US",
                "domain": "psu.edu"
            }
            print(f"[Verify] LionPATH mode: Using Pennsylvania State University")
        elif provider == "onepasshtml":
            # OnepassHTML: each template has its own fixed school
            # Use the first template's org for SheerID form submission
            onepasshtml_config = config.get("aiGenerator", {}).get("onepasshtml", {})
            onepasshtml_templates = onepasshtml_config.get("templates", [])
            if onepasshtml_templates:
                first_tmpl = onepasshtml_templates[0]
                org = dict(ONEPASSHTML_ORG_MAP.get(first_tmpl, {
                    "id": 0, "idExtended": None,
                    "name": "Unknown University", "country": "US", "domain": "university.edu"
                }))
            else:
                org = dict(ONEPASSHTML_ORG_MAP.get("rit-demand-letter.html"))
            
            # Dynamically resolve correct org ID from SheerID API
            lookup_result = lookup_organization_id(org["name"], org.get("country", "US"))
            if lookup_result:
                org["id"] = lookup_result["id"]
                org["idExtended"] = lookup_result["idExtended"]
                org["name"] = lookup_result["name"]
                print(f"[Verify] OnepassHTML: Resolved org ID {org['id']} for {org['name']}")
            else:
                print(f"[Verify] ⚠️ OnepassHTML: Could not resolve org ID for {org['name']}, submission may fail!")
            print(f"[Verify] OnepassHTML mode: Using {org['name']}")
        else:
            # Select university (use region mode and university source settings)
            org = select_university(country=None, region_mode=region_mode, university_source=university_source) 
        
        first, last = generate_name(org.get("country", "US"))
        email = generate_email(first, last, org["domain"])
        dob = generate_birth_date()
        
        # Store in verifier so verify() method uses the same info
        verifier.org = org
        verifier.student_info = {
            "firstName": first,
            "lastName": last,
            "email": email,
            "birthDate": dob
        }
        verifier.pre_generated = True  # Flag to skip regenerating
        
        print(f"[Verify] Pre-generated student: {first} {last} @ {org['name']}")
        
        # Check config to determine which generator to use
        import config_manager
        config = config_manager.get_config()
        provider = config.get("aiGenerator", {}).get("provider", "gemini")
        
        documents = []  # List of document data for multi-doc upload
        doc_data = None
        filename = None
        form_data = None
        
        # Use LionPATH generator if configured (Penn State portal screenshot)
        # Use LionPATH generator if configured (Penn State portal screenshot)
        if provider == "lionpath":
            lionpath_config = config.get("aiGenerator", {}).get("lionpath", {})
            # Support multiple templates (new) or single template (legacy)
            templates = lionpath_config.get("templates", [])
            if not templates and lionpath_config.get("template"):
                templates = [lionpath_config.get("template")]
            
            # Default fallback
            if not templates:
                templates = ["schedule_browser.html"]

            print(f"[Verify] Generating LionPATH documents with templates: {templates}...")
            
            # Pre-generate student data to ensure consistency across all templates
            from lionpath_generator import generate_psu_id, generate_psu_email
            shared_psu_id = generate_psu_id()
            shared_email = generate_psu_email(first, last)
            print(f"[Verify] Using shared student data: PSU ID={shared_psu_id}, Email={shared_email}")
            
            documents = []
            for tmpl in templates:
                try:
                    print(f"[Verify] Generating LionPATH document: {tmpl}...")
                    d_data, d_filename, student_data = generate_lionpath_image(
                        first, last, template_name=tmpl, 
                        psu_id=shared_psu_id, email=shared_email
                    )
                    if d_data:
                        # Determine document type based on template name
                        doc_type = "id_card" if "id_card" in tmpl else "class_schedule"
                        documents.append({"type": doc_type, "data": d_data, "fileName": d_filename, "mimeType": "image/png"})
                        
                        # Use email from LionPATH for form submission (use from first successful doc)
                        if not email and student_data.get("email"):
                            email = student_data.get("email")
                except Exception as e:
                    print(f"[Verify] ⚠️ Failed to generate template {tmpl}: {e}")
            
            if not documents:
                print(f"[Verify] ❌ No LionPATH documents generated")
        
        # Use SheerID generator (Pillow-based class_schedule/transcript/id_card)
        elif provider == "sheerid":
            sheerid_config = config.get("aiGenerator", {}).get("sheerid", {})
            doc_types = sheerid_config.get("docTypes", ["class_schedule"])
            # Generate ALL selected document types (like Gemini)
            print(f"[Verify] Generating SheerID documents {doc_types} for {first} {last} @ {org['name']}...")
            documents = []
            for doc_type in doc_types:
                doc_data, filename, form_data = generate_document_sheerid(doc_type, first, last, org["name"], dob)
                if doc_data:
                    documents.append({"type": doc_type, "data": doc_data, "fileName": filename, "mimeType": "image/png"})
                    print(f"[Verify] ✓ Generated {doc_type}: {filename}")
        
        # Use VSID Generator (Headless browser automation)
        elif provider == "vsid":
            vsid_config = config.get("aiGenerator", {}).get("vsid", {})
            doc_types = vsid_config.get("docTypes", ["student_id", "schedule"])
            
            print(f"[Verify] Generating VSID documents {doc_types} for {first} {last} @ {org['name']}...")
            
            # Pre-generate shared student data for consistency
            from vsid_generator import generate_student_id as vsid_gen_id
            shared_student_id = vsid_gen_id()
            shared_email = f"{first.lower()}.{last.lower()}@university.edu"
            
            documents = []
            for doc_type in doc_types:
                try:
                    print(f"[Verify] Generating VSID document: {doc_type}...")
                    doc_data, filename, student_data = generate_vsid_document(
                        doc_type, first, last, org["name"],
                        student_id=shared_student_id, email=shared_email
                    )
                    if doc_data:
                        # Map to SheerID document types
                        sheerid_type = {
                            "student_id": "id_card",
                            "enrollment": "enrollment_verification", 
                            "schedule": "class_schedule",
                            "admission": "other",
                            "transcript": "transcript"
                        }.get(doc_type, "other")
                        documents.append({"type": sheerid_type, "data": doc_data, "fileName": filename, "mimeType": "image/png"})
                        print(f"[Verify] ✓ Generated {doc_type}: {filename}")
                except Exception as e:
                    print(f"[Verify] ⚠️ Failed to generate VSID {doc_type}: {e}")
            
            if not documents:
                print(f"[Verify] ❌ No VSID documents generated")
        
        # Use UIUC Generator (University of Illinois Urbana-Champaign i-card)
        elif provider == "uiuc":
            uiuc_config = config.get("aiGenerator", {}).get("uiuc", {})
            templates = uiuc_config.get("templates", ["uiuc_id_card.html"])
            
            # For UIUC mode, always use University of Illinois Urbana-Champaign
            org = {
                "id": 3535,  # UIUC ID in SheerID (verified from verifier.py)
                "idExtended": "3535",
                "name": "University of Illinois at Urbana-Champaign",
                "country": "US",
                "domain": "illinois.edu"
            }
            print(f"[Verify] UIUC mode: Using University of Illinois Urbana-Champaign")
            
            # Update verifier with UIUC org
            verifier.org = org
            email = generate_uiuc_email(first, last)
            verifier.student_info["email"] = email
            
            print(f"[Verify] Generating UIUC i-card for {first} {last}...")
            
            documents = []
            for tmpl in templates:
                try:
                    print(f"[Verify] Generating UIUC document: {tmpl}...")
                    d_data, d_filename, student_data = generate_uiuc_image(
                        first, last, template_name=tmpl
                    )
                    if d_data:
                        # Map template to SheerID document type
                        doc_type = "enrollment_verification" if "enrollment" in tmpl else "id_card"
                        documents.append({"type": doc_type, "data": d_data, "fileName": d_filename, "mimeType": "image/png"})
                        print(f"[Verify] ✓ Generated UIUC {doc_type}: {d_filename}")
                except Exception as e:
                    print(f"[Verify] ⚠️ Failed to generate UIUC template {tmpl}: {e}")
            
            if not documents:
                print(f"[Verify] ❌ No UIUC documents generated")
        
        # Use OnepassHTML generator (fixed-school HTML templates via Puppeteer)
        elif provider == "onepasshtml":
            onepasshtml_config = config.get("aiGenerator", {}).get("onepasshtml", {})
            templates = onepasshtml_config.get("templates", [])
            
            if not templates:
                templates = ["rit-demand-letter.html"]
            
            print(f"[Verify] OnepassHTML mode: Generating with templates: {templates}")
            
            # Resolve OnepassHTML template directory
            from pathlib import Path
            onepasshtml_dir = None
            for p in [Path("/app/templates/OnepassHTML"), Path(__file__).parent / "templates" / "OnepassHTML"]:
                if p.exists():
                    onepasshtml_dir = p
                    break
            
            documents = []
            for tmpl in templates:
                try:
                    # Each template uses its own fixed school
                    tmpl_org = ONEPASSHTML_ORG_MAP.get(tmpl, org)
                    tmpl_path = str(onepasshtml_dir / tmpl) if onepasshtml_dir else tmpl
                    print(f"[Verify] Generating OnepassHTML document: {tmpl} (school: {tmpl_org['name']}, path: {tmpl_path})...")
                    d_data, d_filename, form_data = generate_document_puppeteer(
                        "other",
                        first, last, tmpl_org["name"],
                        country=tmpl_org.get("country", "US"),
                        gender="any",
                        template=tmpl_path,
                        use_gemini_photo=False,
                        format="pdf"
                    )
                    if d_data:
                        doc_type = "other"
                        documents.append({"type": doc_type, "data": d_data, "fileName": d_filename, "mimeType": "application/pdf"})
                        print(f"[Verify] ✓ Generated OnepassHTML {doc_type}: {d_filename}")
                except Exception as e:
                    print(f"[Verify] ⚠️ Failed to generate OnepassHTML template {tmpl}: {e}")
            
            if not documents:
                print(f"[Verify] ❌ No OnepassHTML documents generated")
        
        # Use Puppeteer if configured
        elif provider == "puppeteer":
            # Read puppeteer settings from config (same as test flow)
            puppeteer_config = config.get("aiGenerator", {}).get("puppeteer", {})
            template = puppeteer_config.get("template", "student-id-generator.html")
            use_gemini_photo = puppeteer_config.get("useGeminiPhoto", True)
            
            print(f"[Verify] Generating document with Puppeteer HTML template: {template}, geminiPhoto: {use_gemini_photo}")
            doc_data, filename, form_data = generate_document_puppeteer(
                "id_card",
                first,      # Use the same first name as form
                last,       # Use the same last name as form
                org["name"], # Use the same school as form
                country=org.get("country", "US"), # Pass country for address generation
                birth_date=dob,
                gender="any",
                template=template,
                use_gemini_photo=use_gemini_photo
            )
            if doc_data:
                documents = [{"type": "id_card", "data": doc_data, "fileName": filename, "mimeType": "image/png"}]
        
        # Use Gemini multi-document generator
        elif provider == "gemini":
            gemini_config = config.get("aiGenerator", {}).get("gemini", {})
            document_types = gemini_config.get("documentTypes", ["id_card", "transcript", "schedule"])
            print(f"[Verify] Generating {len(document_types)} documents with Gemini AI: {document_types}")
            from doc_generator import generate_multiple_documents_with_gemini
            
            result = generate_multiple_documents_with_gemini(first, last, org["name"], dob, document_types=document_types)
            documents = result.get("documents", [])
            
            if documents:
                doc_data = documents[0]["data"]  # Primary document for backward compat
                filename = documents[0]["fileName"]
                print(f"[Verify] Generated {len(documents)}/{len(document_types)} documents with Gemini")
            else:
                print(f"[Verify] Gemini generation failed, using SVG fallback...")
        
        # Fallback to SVG generator
        if not documents:
            print(f"[Verify] Using SVG fallback generator...")
            doc_data, filename = generate_document("auto", first, last, org["name"])
            if doc_data:
                documents = [{"type": "id_card", "data": doc_data, "fileName": filename, "mimeType": "image/png"}]
        
        if form_data:
            print(f"[Verify] Form data synced: {first} {last}, ID: {form_data.get('studentId')}")
        
        # Save documents and form data for debugging
        try:
            import os
            import time
            import json
            
            # Create output directory if not exists
            output_dir = "/output/submissions"
            os.makedirs(output_dir, exist_ok=True)
            
            # Generate timestamp prefix
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            prefix = f"{timestamp}_{parsed_id}"
            
            # Save each document image
            for doc in documents:
                doc_type = doc.get("type", "unknown")
                doc_filename = f"{prefix}_{doc_type}.png"
                doc_path = os.path.join(output_dir, doc_filename)
                with open(doc_path, "wb") as f:
                    f.write(doc["data"])
                print(f"[Verify] 💾 Saved: {doc_filename}")
            
            # Save form data as JSON
            submission_data = {
                "verificationId": parsed_id,
                "timestamp": timestamp,
                "student": {
                    "firstName": first,
                    "lastName": last,
                    "email": email,
                    "birthDate": dob
                },
                "university": {
                    "id": org["id"],
                    "idExtended": org.get("idExtended"),
                    "name": org["name"],
                    "country": org.get("country", "US")
                },
                "documents": [
                    {"type": d.get("type"), "fileName": d.get("fileName")} 
                    for d in documents
                ],
                "provider": provider
            }
            
            json_path = os.path.join(output_dir, f"{prefix}_data.json")
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(submission_data, f, indent=2, ensure_ascii=False)
            print(f"[Verify] 💾 Saved: {prefix}_data.json")
            
        except Exception as save_err:
            print(f"[Verify] ⚠️ Failed to save submission data: {save_err}")
        
        # Run verification with documents (supports multi-doc upload)
        result = verifier.verify(documents)
        
        return {
            "verificationId": parsed_id,
            "status": result.get("status", "error"),
            "success": result.get("success", False),
            "message": result.get("message") or result.get("error", "Unknown error"),
            "student": result.get("student"),
            "email": result.get("email"),
            "school": result.get("school")
        }
        
    except Exception as e:
        print(f"[Verify] Error: {e}")
        return {
            "verificationId": parsed_id,
            "status": "error",
            "success": False,
            "message": str(e)
        }


# API Routes

@app.get("/")
async def root():
    return {"message": "OnePass Python Backend with curl_cffi", "version": "2.0.0"}


@app.get("/api/status")
async def status():
    """Health check endpoint"""
    
    # Check curl_cffi availability
    try:
        from curl_cffi import requests as curl_requests
        curl_available = True
        curl_version = "installed"
    except ImportError:
        curl_available = False
        curl_version = "not installed"
    
    return {
        "status": "ok",
        "service": "onepass-python",
        "version": "2.0.0",
        "features": {
            "curl_cffi": curl_available,
            "curl_version": curl_version,
            "tls_spoofing": curl_available,
            "proxy_configured": bool(PROXY_USER and PROXY_PASS)
        },
        "timestamp": datetime.now().isoformat()
    }


@app.post("/api/verify")
async def verify(request: VerifyRequest):
    """
    Verify one or more verification IDs
    Uses curl_cffi for TLS fingerprint spoofing
    """
    
    if not request.verificationIds:
        raise HTTPException(status_code=400, detail="No verification IDs provided")
    
    # Get proxy URL
    proxy = get_proxy_url()
    if proxy:
        # Extract host from proxy URL for logging
        import re
        match = re.search(r'@([^:]+):(\d+)$', proxy)
        if match:
            print(f"[Verify] ✅ Using proxy from config: {match.group(1)}:{match.group(2)}")
        else:
            print(f"[Verify] ✅ Using proxy from config")
    else:
        print("[Verify] ⚠️ No proxy configured in config.json")
    
    results = []
    success_count = 0
    
    for vid in request.verificationIds:
        result = verify_single(vid, proxy)
        
        # If pending, return immediately instead of polling (avoid Cloudflare 524 timeout)
        # The result will be stored and user can check status later
        if result.get("status") == "pending":
            print(f"[Verify] ✅ Submitted successfully, status: pending (no polling to avoid timeout)")
            result["message"] = "已提交成功，正在等待 SheerID 审核（约1-5分钟）"
            result["success"] = True  # Mark as success since submission was successful
        
        results.append(result)
        
        if result.get("success"):
            success_count += 1
        
        # Log verification result to history (skip user-side link issues)
        if result.get("success"):
            verification_history.log_verification("pass", vid, result.get("message", ""))
        elif result.get("status") == "pending":
            verification_history.log_verification("processing", vid, "Pending review")
        elif result.get("status") == "rejected":
            reason = result.get("reason", "unknown")
            if reason not in ("link_opened", "expired", "invalid", "rate_limited"):
                verification_history.log_verification("failed", vid, f"Rejected: {reason}")
        elif result.get("status") == "error":
            verification_history.log_verification("failed", vid, result.get("message", "Error"))
    
    return {
        "results": results,
        "stats": {
            "total": len(request.verificationIds),
            "success": success_count,
            "failed": len(request.verificationIds) - success_count
        }
    }


@app.get("/api/check-status/{verification_id}")
async def check_status(verification_id: str):
    """
    Check current status of a verification (single query)
    
    Returns the current step and any errors/rejection reasons
    """
    import httpx
    
    parsed_id = parse_verification_id(verification_id)
    if not parsed_id:
        raise HTTPException(status_code=400, detail="Invalid verification ID")
    
    try:
        url = f"https://services.sheerid.com/rest/v2/verification/{parsed_id}"
        
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url)
        
        if response.status_code != 200:
            return {
                "verificationId": parsed_id,
                "status": "error",
                "message": f"HTTP {response.status_code}"
            }
        
        data = response.json()
        current_step = data.get("currentStep", "")
        error_ids = data.get("errorIds", [])
        rejection_reasons = data.get("rejectionReasons", [])
        
        return {
            "verificationId": parsed_id,
            "currentStep": current_step,
            "status": current_step,
            "errorIds": error_ids,
            "rejectionReasons": rejection_reasons,
            "created": data.get("created"),
            "updated": data.get("updated"),
            "country": data.get("country"),
            "locale": data.get("locale"),
            "systemErrorMessage": data.get("systemErrorMessage")
        }
        
    except Exception as e:
        return {
            "verificationId": parsed_id,
            "status": "error",
            "message": str(e)
        }


class PollRequest(BaseModel):
    verificationId: str
    maxAttempts: Optional[int] = 30
    interval: Optional[int] = 10


@app.post("/api/poll-status")
async def poll_status_endpoint(request: PollRequest):
    """
    Poll verification status until final result (success/error)
    
    Polls every `interval` seconds for up to `maxAttempts` times 
    (default: 30 attempts = 5 minutes)
    """
    parsed_id = parse_verification_id(request.verificationId)
    if not parsed_id:
        raise HTTPException(status_code=400, detail="Invalid verification ID")
    
    proxy = get_proxy_url()
    
    # Run polling synchronously (it has its own sleep/loop)
    result = poll_verification_status(
        vid=parsed_id,
        max_attempts=request.maxAttempts or 30,
        interval=request.interval or 10,
        proxy=proxy
    )
    
    return result


@app.get("/api/config")
async def get_config_endpoint():
    """Get current configuration (for admin panel)"""
    import config_manager
    config = config_manager.get_config()
    
    # Mask sensitive fields (only API keys, not proxy for admin visibility)
    def mask_key(key):
        if key and len(key) > 6:
            return key[:4] + "..." + key[-2:]
        return "..." if key else ""
    
    # Mask API keys only (proxy credentials are shown for admin)
    if config.get("aiGenerator", {}).get("gemini", {}).get("apiKey"):
        config["aiGenerator"]["gemini"]["apiKey"] = mask_key(config["aiGenerator"]["gemini"]["apiKey"])
    if config.get("aiGenerator", {}).get("batchApi", {}).get("apiKey"):
        config["aiGenerator"]["batchApi"]["apiKey"] = mask_key(config["aiGenerator"]["batchApi"]["apiKey"])
    if config.get("aiGenerator", {}).get("getgem", {}).get("cdk"):
        config["aiGenerator"]["getgem"]["cdk"] = mask_key(config["aiGenerator"]["getgem"]["cdk"])
    
    # Proxy credentials are NOT masked - shown in admin panel
    
    # Mask email SMTP password
    if config.get("email", {}).get("smtpPassword"):
        config["email"]["smtpPassword"] = mask_key(config["email"]["smtpPassword"])
    
    return config


@app.get("/api/templates")
async def get_templates_endpoint():
    """Get available HTML templates for Puppeteer generator"""
    import config_manager
    return {
        "templates": config_manager.get_available_templates(),
        "puppeteerSettings": config_manager.get_puppeteer_settings()
    }


@app.get("/api/lionpath-templates")
async def get_lionpath_templates_endpoint():
    """Get available LionPATH HTML templates"""
    templates = get_available_templates()
    return {
        "templates": templates
    }


@app.get("/api/vsid-doctypes")
async def get_vsid_doctypes_endpoint():
    """Get available VSID document types"""
    return {
        "docTypes": get_vsid_document_types()
    }


@app.get("/api/uiuc-templates")
async def get_uiuc_templates_endpoint():
    """Get available UIUC HTML templates"""
    templates = get_uiuc_templates()
    return {
        "templates": templates
    }


@app.get("/api/onepasshtml-templates")
async def get_onepasshtml_templates_endpoint():
    """Get available OnepassHTML templates (fixed-school templates from backend-python/templates/OnepassHTML/)"""
    from pathlib import Path
    
    # Scan OnepassHTML template directory
    possible_paths = [
        Path("/app/templates/OnepassHTML"),  # Docker
        Path(__file__).parent / "templates" / "OnepassHTML"  # Local
    ]
    
    templates = []
    for tmpl_dir in possible_paths:
        if tmpl_dir.exists():
            for file in tmpl_dir.glob("*.html"):
                templates.append({
                    "filename": file.name,
                    "label": file.stem.replace("-", " ").replace("_", " ").title()
                })
            break
    
    return {"templates": templates}


class TestDocumentRequest(BaseModel):
    provider: str = "puppeteer"
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    university: Optional[str] = None
    gender: Optional[str] = "any"
    # Puppeteer settings
    template: Optional[str] = None
    useGeminiPhoto: Optional[bool] = True
    # Gemini settings
    geminiApiKey: Optional[str] = None
    geminiModel: Optional[str] = None
    # Batch API settings
    batchApiUrl: Optional[str] = None
    batchApiKey: Optional[str] = None


@app.post("/api/config/test-document")
async def test_document_generation(request: TestDocumentRequest):
    """
    Test document generation - generates a sample document using the SAVED server config
    to show exactly what would be submitted during actual verification
    """
    import base64
    import random
    import config_manager
    
    first = request.firstName
    last = request.lastName
    university = request.university
    gender = request.gender or "any"
    
    # If not provided, generate random data using verifier to support international universities
    if not university or not first or not last:
        from verifier import select_university, generate_name
        
        # Get region mode and university source from saved config
        config = config_manager.get_config()
        region_mode = config.get("aiGenerator", {}).get("regionMode", "global")
        university_source = config.get("aiGenerator", {}).get("universitySource", "sheerid_api")
        print(f"[TestDoc] Region: {region_mode}, Source: {university_source}")
        
        # Select university if not provided (use region mode and source from config)
        if not university:
            uni_data = select_university(region_mode=region_mode, university_source=university_source)
            university = uni_data["name"]
            country = uni_data.get("country", "US")
            print(f"[TestDoc] Selected university: {university} (Country: {country})")
        else:
            # Try to guess country if university is provided but names are missing
            # This is a simple fallback
            country = "US" 
            
        # Generate names based on university country if not provided
        if not first or not last:
            gen_first, gen_last = generate_name(country)
            first = first or gen_first
            last = last or gen_last
    
    try:
        # Use request provider if specified, otherwise use saved server config
        config = config_manager.get_config()
        provider = request.provider if request.provider else config.get("aiGenerator", {}).get("provider", "gemini")
        
        print(f"[TestDoc] Using provider: {provider}")
        
        doc_data = None
        filename = None
        form_data = None
        
        # Use LionPATH generator (Penn State portal screenshot)
        if provider == "lionpath":
            lionpath_config = config.get("aiGenerator", {}).get("lionpath", {})
            # Support multiple templates (new) or single template (legacy)
            templates = lionpath_config.get("templates", [])
            if not templates and lionpath_config.get("template"):
                templates = [lionpath_config.get("template")]
            
            # Default fallback
            if not templates:
                templates = ["schedule_browser.html"]

            print(f"[TestDoc] Using LionPATH generator with templates: {templates}...")
            
            # Pre-generate student data to ensure consistency across all templates
            from lionpath_generator import generate_psu_id, generate_psu_email
            shared_psu_id = generate_psu_id()
            shared_email = generate_psu_email(first, last)
            print(f"[TestDoc] Using shared student data: PSU ID={shared_psu_id}, Email={shared_email}")
            
            images = []
            first_student_data = None
            
            for tmpl in templates:
                try:
                    print(f"[TestDoc] Generating LionPATH document: {tmpl}...")
                    d_data, d_filename, s_data = generate_lionpath_image(
                        first, last, template_name=tmpl,
                        psu_id=shared_psu_id, email=shared_email
                    )
                    if d_data:
                        image_base64 = base64.b64encode(d_data).decode('utf-8')
                        doc_type = "id_card" if "id_card" in tmpl else "class_schedule"
                        
                        images.append({
                            "type": doc_type,
                            "image": f"data:image/png;base64,{image_base64}",
                            "filename": d_filename,
                            "template": tmpl
                        })
                        
                        if first_student_data is None:
                            first_student_data = s_data
                except Exception as e:
                    print(f"[TestDoc] ⚠️ Failed to generate template {tmpl}: {e}")

            if images and first_student_data:
                # Build providerNote with form data details
                doc_types_display = ", ".join([img["template"] for img in images])
                provider_note = f"""🦁 LionPATH 文档生成
📄 模板: {doc_types_display}
📧 邮箱: {first_student_data.get('email', 'N/A')}
🆔 PSU ID: {first_student_data.get('psu_id', 'N/A')}
🎓 专业: {first_student_data.get('major', 'N/A')}
🏫 大学: {first_student_data.get('university', 'N/A')}
👤 姓名: {first_student_data.get('fullName', 'N/A')}"""
                
                return {
                    "success": True,
                    "provider": "lionpath",
                    "providerNote": provider_note,
                    "images": images,
                    "image": images[0]["image"], # Backward compatibility
                    "formData": first_student_data,
                    "filename": images[0]["filename"]
                }
            else:
                 return {
                    "success": False,
                    "message": "Failed to generate any LionPATH documents"
                }
        
        # Use SheerID generator (Pillow-based)
        elif provider == "sheerid":
            sheerid_config = config.get("aiGenerator", {}).get("sheerid", {})
            doc_types = sheerid_config.get("docTypes", ["class_schedule"])
            # Generate ALL selected document types (like Gemini)
            print(f"[TestDoc] Using SheerID generator with docTypes: {doc_types}...")
            
            doc_type_names = {
                "class_schedule": "📅 课程表",
                "transcript": "📝 成绩单",
                "id_card": "🪪 学生证"
            }
            
            images = []
            first_form_data = None
            for doc_type in doc_types:
                doc_data, filename, form_data = generate_document_sheerid(doc_type, first, last, university)
                if doc_data:
                    image_base64 = base64.b64encode(doc_data).decode('utf-8')
                    images.append({
                        "type": doc_type,
                        "image": f"data:image/png;base64,{image_base64}",
                        "filename": filename
                    })
                    if first_form_data is None:
                        first_form_data = form_data
                    print(f"[TestDoc] ✓ Generated {doc_type}: {filename}")
            
            if images:
                doc_types_display = ", ".join([doc_type_names.get(dt, dt) for dt in doc_types])
                provider_note = f"""📚 SheerID 文档生成器
📄 类型: {doc_types_display} ({len(images)}个文档)
👤 姓名: {first_form_data.get('fullName', 'N/A')}
🆔 学号: {first_form_data.get('studentId', 'N/A')}
🎂 生日: {first_form_data.get('birthDate', 'N/A')}
🏫 大学: {first_form_data.get('university', 'N/A')}"""
                
                return {
                    "success": True,
                    "provider": "sheerid",
                    "providerNote": provider_note,
                    "images": images,
                    "image": images[0]["image"],  # For backward compatibility
                    "formData": first_form_data,
                    "filename": images[0]["filename"]
                }
        
        # Use VSID Generator (Headless browser automation)
        elif provider == "vsid":
            vsid_config = config.get("aiGenerator", {}).get("vsid", {})
            doc_types = vsid_config.get("docTypes", ["student_id", "schedule"])
            
            print(f"[TestDoc] Using VSID generator with docTypes: {doc_types}...")
            
            doc_type_names = {
                "student_id": "🪪 学生证",
                "enrollment": "📜 在读证明",
                "schedule": "📅 课程表",
                "admission": "📬 录取通知书",
                "transcript": "📊 成绩单"
            }
            
            # Pre-generate shared student data
            from vsid_generator import generate_student_id as vsid_gen_id
            shared_student_id = vsid_gen_id()
            shared_email = f"{first.lower()}.{last.lower()}@university.edu"
            
            images = []
            first_student_data = None
            
            for doc_type in doc_types:
                try:
                    print(f"[TestDoc] Generating VSID document: {doc_type}...")
                    doc_data, filename, student_data = generate_vsid_document(
                        doc_type, first, last, university,
                        student_id=shared_student_id, email=shared_email
                    )
                    if doc_data:
                        image_base64 = base64.b64encode(doc_data).decode('utf-8')
                        images.append({
                            "type": doc_type,
                            "image": f"data:image/png;base64,{image_base64}",
                            "filename": filename
                        })
                        if first_student_data is None:
                            first_student_data = student_data
                        print(f"[TestDoc] ✓ Generated {doc_type}: {filename}")
                except Exception as e:
                    print(f"[TestDoc] ⚠️ Failed to generate VSID {doc_type}: {e}")
            
            if images and first_student_data:
                doc_types_display = ", ".join([doc_type_names.get(dt, dt) for dt in doc_types])
                provider_note = f"""🎓 VSID 文档生成器
📄 类型: {doc_types_display} ({len(images)}个文档)
👤 姓名: {first_student_data.get('fullName', 'N/A')}
🆔 学号: {first_student_data.get('student_id', 'N/A')}
🎓 专业: {first_student_data.get('major', 'N/A')}
🏫 大学: {first_student_data.get('university', 'N/A')}"""
                
                return {
                    "success": True,
                    "provider": "vsid",
                    "providerNote": provider_note,
                    "images": images,
                    "image": images[0]["image"],
                    "formData": first_student_data,
                    "filename": images[0]["filename"]
                }
            else:
                return {
                    "success": False,
                    "message": "Failed to generate any VSID documents"
                }
        
        # Use UIUC Generator (University of Illinois Urbana-Champaign i-card)
        elif provider == "uiuc":
            uiuc_config = config.get("aiGenerator", {}).get("uiuc", {})
            templates = uiuc_config.get("templates", ["uiuc_id_card.html"])
            
            # Force UIUC university for test
            university = "University of Illinois Urbana-Champaign"
            
            print(f"[TestDoc] Using UIUC generator with templates: {templates}...")
            
            images = []
            first_student_data = None
            
            for tmpl in templates:
                try:
                    print(f"[TestDoc] Generating UIUC document: {tmpl}...")
                    d_data, d_filename, student_data = generate_uiuc_image(
                        first, last, template_name=tmpl
                    )
                    if d_data:
                        image_base64 = base64.b64encode(d_data).decode('utf-8')
                        images.append({
                            "type": "id_card",
                            "image": f"data:image/png;base64,{image_base64}",
                            "filename": d_filename,
                            "template": tmpl
                        })
                        if first_student_data is None:
                            first_student_data = student_data
                        print(f"[TestDoc] ✓ Generated UIUC i-card: {d_filename}")
                except Exception as e:
                    print(f"[TestDoc] ⚠️ Failed to generate UIUC template {tmpl}: {e}")
            
            if images and first_student_data:
                provider_note = f"""🎓 UIUC i-card 文档生成
📄 模板: {', '.join([img['template'] for img in images])}
👤 姓名: {first_student_data.get('fullName', 'N/A')}
🆔 UIU: {first_student_data.get('uiu', 'N/A')}
📚 Library: {first_student_data.get('library', 'N/A')}
💳 Card: {first_student_data.get('card', 'N/A')}
📅 Expires: {first_student_data.get('card_expires', 'N/A')}
🏫 大学: {first_student_data.get('university', 'N/A')}"""
                
                return {
                    "success": True,
                    "provider": "uiuc",
                    "providerNote": provider_note,
                    "images": images,
                    "image": images[0]["image"],
                    "formData": first_student_data,
                    "filename": images[0]["filename"]
                }
            else:
                return {
                    "success": False,
                    "message": "Failed to generate any UIUC documents"
                }
        
        # OnepassHTML test document generation (fixed-school templates via Puppeteer)
        elif provider == "onepasshtml":
            onepasshtml_config = config.get("aiGenerator", {}).get("onepasshtml", {})
            templates = onepasshtml_config.get("templates", [])
            
            if not templates:
                templates = ["rit-demand-letter.html"]
            
            # OnepassHTML org mapping (each template has its own fixed school)
            ONEPASSHTML_ORG_MAP = {
                "rit-demand-letter.html": {"name": "Roorkee Institute of Technology", "country": "IN"},
                "rit-enrollment-verify.html": {"name": "University of South Florida", "country": "US"}
            }
            
            print(f"[TestDoc] OnepassHTML mode with templates: {templates}")
            
            # Resolve OnepassHTML template directory
            from pathlib import Path
            onepasshtml_dir = None
            for p in [Path("/app/templates/OnepassHTML"), Path(__file__).parent / "templates" / "OnepassHTML"]:
                if p.exists():
                    onepasshtml_dir = p
                    break
            
            images = []
            first_form_data = None
            
            for tmpl in templates:
                try:
                    # Each template uses its own fixed school
                    tmpl_org = ONEPASSHTML_ORG_MAP.get(tmpl, {"name": "Unknown University", "country": "US"})
                    tmpl_university = tmpl_org["name"]
                    tmpl_country = tmpl_org["country"]
                    tmpl_path = str(onepasshtml_dir / tmpl) if onepasshtml_dir else tmpl
                    print(f"[TestDoc] Generating OnepassHTML document: {tmpl} (school: {tmpl_university}, path: {tmpl_path})...")
                    d_data, d_filename, form_data = generate_document_puppeteer(
                        "other",
                        first, last, tmpl_university,
                        country=tmpl_country,
                        gender=gender,
                        template=tmpl_path,
                        use_gemini_photo=False,
                        format="pdf"
                    )
                    if d_data:
                        image_base64 = base64.b64encode(d_data).decode('utf-8')
                        images.append({
                            "type": "other",
                            "image": f"data:application/pdf;base64,{image_base64}",
                            "filename": d_filename,
                            "template": tmpl
                        })
                        if first_form_data is None:
                            first_form_data = form_data
                        print(f"[TestDoc] ✓ Generated OnepassHTML: {d_filename}")
                except Exception as e:
                    print(f"[TestDoc] ⚠️ Failed to generate OnepassHTML template {tmpl}: {e}")
            
            if images and first_form_data:
                schools = ', '.join([ONEPASSHTML_ORG_MAP.get(img['template'], {}).get('name', 'Unknown') for img in images])
                provider_note = f"""📝 OnepassHTML 固定模板生成
📄 模板: {', '.join([img['template'] for img in images])}
👤 姓名: {first_form_data.get('fullName', 'N/A')}
🏫 学校: {schools}"""
                
                return {
                    "success": True,
                    "provider": "onepasshtml",
                    "providerNote": provider_note,
                    "images": images,
                    "image": images[0]["image"],
                    "formData": first_form_data,
                    "filename": images[0]["filename"]
                }
            else:
                return {
                    "success": False,
                    "message": "Failed to generate any OnepassHTML documents"
                }
        
        elif provider == "puppeteer":
            # Use Puppeteer generator with saved config
            puppeteer_config = config.get("aiGenerator", {}).get("puppeteer", {})
            template = puppeteer_config.get("template", "student-id-generator.html")
            use_gemini_photo = puppeteer_config.get("useGeminiPhoto", True)
            
            print(f"[TestDoc] Using Puppeteer with template: {template}, geminiPhoto: {use_gemini_photo}")
            
            doc_data, filename, form_data = generate_document_puppeteer(
                "id_card",
                first,
                last,
                university,
                country=country,
                gender=gender,
                template=template,
                use_gemini_photo=use_gemini_photo
            )
            
            if doc_data and form_data:
                image_base64 = base64.b64encode(doc_data).decode('utf-8')
                
                return {
                    "success": True,
                    "provider": "puppeteer",
                    "providerNote": f"使用保存的配置: Puppeteer HTML 模板 ({template})",
                    "image": f"data:image/jpeg;base64,{image_base64}",
                    "formData": form_data,
                    "filename": filename
                }
        
        # Fallback to Gemini/SVG generator (default or if puppeteer failed)
        if not doc_data:
            print(f"[TestDoc] Using Gemini multi-document generator...")
            
            from doc_generator import generate_multiple_documents_with_gemini
            from verifier import generate_birth_date
            
            # Get document types from config
            gemini_config = config.get("aiGenerator", {}).get("gemini", {})
            document_types = gemini_config.get("documentTypes", ["id_card", "transcript", "schedule"])
            
            # Generate birth date for transcript
            birth_date = generate_birth_date()
            
            # Generate documents with unified student info
            result = generate_multiple_documents_with_gemini(first, last, university, birth_date, document_types=document_types)
            
            if result["documents"]:
                # Build images array for frontend
                images = []
                for doc in result["documents"]:
                    doc_base64 = base64.b64encode(doc["data"]).decode('utf-8')
                    images.append({
                        "type": doc["type"],
                        "filename": doc["fileName"],
                        "image": f"data:{doc['mimeType']};base64,{doc_base64}"
                    })
                
                # First image as backward-compatible main image
                first_image = images[0] if images else None
                
                return {
                    "success": True,
                    "provider": provider,
                    "providerNote": f"使用保存的配置: GEMINI 文档生成 - 生成 {result['successCount']}/{len(document_types)} 文档",
                    "documentCount": len(images),
                    "images": images,
                    "image": first_image["image"] if first_image else None,
                    "filename": first_image["filename"] if first_image else None,
                    "formData": {
                        "firstName": first,
                        "lastName": last,
                        "fullName": f"{first} {last}".upper(),
                        "email": f"{first.lower()}.{last.lower()}{random.randint(10, 99)}@{university.lower().replace(' ', '').replace('university', '').replace('college', '')[:10]}.edu",
                        "university": university,
                        "studentId": result["studentId"]
                    }
                }
            else:
                return {
                    "success": False,
                    "message": "Document generation failed"
                }
                
    except Exception as e:
        print(f"[TestDoc] Error: {e}")
        return {
            "success": False,
            "message": str(e)
        }


@app.post("/api/config")
async def update_config_endpoint(request: Request, authorization: Optional[str] = Header(None)):
    """Update configuration (admin only)"""
    # Verify admin
    if authorization:
        token = authorization.replace("Bearer ", "")
        user = auth.verify_token(token)
        if not user or user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
    
    # Simple auth check (in production should be more robust)
    # verify_token(authorization)
    
    try:
        data = await request.json()
        import config_manager
        
        # Check if telegram config changed
        old_config = config_manager.get_config()
        old_telegram = old_config.get("verification", {}).get("telegram", {})
        
        # --- Handle GetGem CDK Append Logic ---
        getgem_update = data.get("aiGenerator", {}).get("getgem", {})
        if getgem_update.get("appendCdk") and getgem_update.get("cdk"):
            old_cdk = old_config.get("aiGenerator", {}).get("getgem", {}).get("cdk", "")
            if old_cdk:
                # Append the new CDK with a newline
                data["aiGenerator"]["getgem"]["cdk"] = f"{old_cdk}\n{getgem_update['cdk']}"
        # --- End GetGem Logic ---
        
        updated_config = config_manager.update_config(data)
        
        if updated_config:
            # Handle Telegram Bot restart if config changed
            new_telegram = updated_config.get("verification", {}).get("telegram", {})
            
            # If enabled, apiId/Hash, or botUsername changed
            if (old_telegram.get("enabled") != new_telegram.get("enabled") or
                old_telegram.get("apiId") != new_telegram.get("apiId") or
                old_telegram.get("apiHash") != new_telegram.get("apiHash") or
                old_telegram.get("botUsername") != new_telegram.get("botUsername")):
                
                print("[Config] Telegram config changed, restarting bot...")
                global telegram_bot
                
                # Stop existing bot
                if telegram_bot:
                    await telegram_bot.stop()
                    telegram_bot = None
                
                # Start new bot if enabled
                if new_telegram.get("enabled") and new_telegram.get("apiId") and new_telegram.get("apiHash"):
                    try:
                        api_id = int(new_telegram.get("apiId"))
                        api_hash = new_telegram.get("apiHash")
                        bot_username = new_telegram.get("botUsername") or "@SheerID_Verification_bot"
                        
                        telegram_bot = SheerIDUserbot(api_id, api_hash, bot_username=bot_username)
                        asyncio.create_task(telegram_bot.start())
                        print("[Config] Telegram Bot restarted")
                    except Exception as e:
                        print(f"[Config] Failed to restart Telegram Bot: {e}")
            
            return {"success": True, "config": updated_config}
        else:
            raise HTTPException(status_code=500, detail="Failed to save config")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/verify-puppeteer")
async def verify_puppeteer(request: VerifyRequest):
    """
    Alias endpoint for Puppeteer mode
    With Python backend, we use curl_cffi instead of Puppeteer
    """
    return await verify(request)


# ============ AUTH ROUTES ============

class RegisterRequest(BaseModel):
    email: str
    password: str
    username: Optional[str] = None
    inviteCode: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
async def register_user(request: RegisterRequest):
    """Register a new user"""
    try:
        username = request.username or request.email.split("@")[0]
        result = auth.register(request.email, request.password, username, request.inviteCode)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/auth/login")
async def login_user(request: LoginRequest):
    """Login user"""
    try:
        result = auth.login(request.email, request.password)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/auth/me")
async def get_current_user(authorization: Optional[str] = Header(None)):
    """Get current user from token"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    return {"success": True, "user": user}


@app.get("/api/auth/invite-stats")
async def get_invite_stats(authorization: Optional[str] = Header(None)):
    """Get user's invitation statistics with latest 5 invite details"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    conn = auth.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM users WHERE invited_by = ?", (user["id"],))
    count = cursor.fetchone()[0]
    
    # Get latest 5 invitees with details
    cursor.execute("""
        SELECT id, email, username, created_at, has_consumed
        FROM users WHERE invited_by = ?
        ORDER BY id DESC LIMIT 5
    """, (user["id"],))
    invitee_rows = cursor.fetchall()
    conn.close()
    
    # Build detail list with reward info
    details = []
    for row in invitee_rows:
        r = dict(row)
        email = r.get("email", "")
        # Mask email: show first 2 chars + ***@domain
        if "@" in email:
            local, domain = email.split("@", 1)
            masked = local[:2] + "***@" + domain if len(local) > 2 else local[0] + "***@" + domain
        else:
            masked = email[:3] + "***" if len(email) > 3 else "***"
        
        # Check if this invitee triggered a reward
        rewarded = bool(r.get("has_consumed"))
        
        details.append({
            "email": masked,
            "username": r.get("username", ""),
            "registeredAt": r.get("created_at", ""),
            "rewarded": rewarded,
        })
    
    # Get actual reward total from invitation_rewards table
    try:
        main_conn = database.get_connection()
        reward_row = main_conn.execute(
            "SELECT COALESCE(SUM(reward_amount), 0) as total FROM invitation_rewards WHERE inviter_id = ?",
            (user["id"],)
        ).fetchone()
        total_rewards = reward_row["total"] if reward_row else 0
    except Exception:
        total_rewards = count * 0.2  # fallback
    
    return {"invitedCount": count, "totalRewards": total_rewards, "details": details}


@app.post("/api/auth/credits")
async def update_user_credits(authorization: Optional[str] = Header(None)):
    """Update user credits (admin only)"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # For now, just return current user
    return {"success": True, "user": user}


class ForgotPasswordRequest(BaseModel):
    email: str

@app.post("/api/auth/forgot-password")
async def forgot_password_endpoint(request: ForgotPasswordRequest):
    """Send password reset email"""
    import email_service

    token = auth.create_reset_token(request.email)
    if not token:
        # Don't reveal whether email exists — always return success
        return {"success": True, "message": "如果该邮箱已注册，重置链接将发送到您的邮箱"}

    # Build reset link using Referer or default
    import config_manager
    config = config_manager.get_config()
    site_url = config.get("siteUrl", "").rstrip("/")
    if not site_url:
        site_url = "http://localhost:5173"
    reset_link = f"{site_url}/reset-password?token={token}"

    sent = email_service.send_reset_email(request.email, reset_link)
    if not sent:
        raise HTTPException(status_code=500, detail="邮件发送失败，请联系管理员检查邮箱配置")

    return {"success": True, "message": "如果该邮箱已注册，重置链接将发送到您的邮箱"}


class ResetPasswordRequest(BaseModel):
    token: str
    password: str

@app.post("/api/auth/reset-password")
async def reset_password_endpoint(request: ResetPasswordRequest):
    """Reset password using token"""
    info = auth.verify_reset_token(request.token)
    if not info:
        raise HTTPException(status_code=400, detail="重置链接无效或已过期")

    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="密码长度不能少于 6 位")

    success = auth.reset_password(info["userId"], request.password)
    if not success:
        raise HTTPException(status_code=500, detail="密码重置失败")

    return {"success": True, "message": "密码重置成功，请使用新密码登录"}


@app.post("/api/email/test")
async def test_email_endpoint(authorization: Optional[str] = Header(None)):
    """Test SMTP connection (admin only)"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    import email_service
    result = email_service.test_email_connection()
    return result


# ============ USER MANAGEMENT (ADMIN) ============

@app.get("/api/admin/users")
async def list_users_endpoint(authorization: str = Header(None)):
    """List all users (admin only)"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    users = auth.list_all_users()
    return {"users": users}


@app.post("/api/admin/users/{user_id}/toggle")
async def toggle_user_endpoint(user_id: int, request: Request, authorization: str = Header(None)):
    """Toggle user active/suspended status"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    token = authorization.replace("Bearer ", "")
    admin = auth.verify_token(token)
    if not admin or admin.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    data = await request.json()
    status = data.get("status", "suspended")
    if status not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="Invalid status")

    success = auth.toggle_user_status(user_id, status)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "status": status}


@app.post("/api/admin/users/{user_id}/credits")
async def update_user_credits_endpoint(user_id: int, request: Request, authorization: str = Header(None)):
    """Update user credits (admin only)"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    token = authorization.replace("Bearer ", "")
    admin = auth.verify_token(token)
    if not admin or admin.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    data = await request.json()
    credits = data.get("credits")
    if credits is None or not isinstance(credits, (int, float)):
        raise HTTPException(status_code=400, detail="Invalid credits value")

    success = auth.update_user_credits_admin(user_id, float(credits))
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "credits": float(credits)}


@app.post("/api/admin/users/{user_id}")
async def update_user_admin_endpoint(user_id: int, request: Request, authorization: str = Header(None)):
    """Update user editable fields (admin only)."""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    token = authorization.replace("Bearer ", "")
    admin = auth.verify_token(token)
    if not admin or admin.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    data = await request.json()
    credits = data.get("credits")
    password = (data.get("password") or "").strip()

    if credits is None or not isinstance(credits, (int, float)):
        raise HTTPException(status_code=400, detail="Invalid credits value")
    if float(credits) < 0:
        raise HTTPException(status_code=400, detail="Credits must be >= 0")
    if password and len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    success = auth.update_user_credits_admin(user_id, float(credits))
    if not success:
        raise HTTPException(status_code=404, detail="User not found")

    password_updated = False
    if password:
        password_updated = auth.reset_password(user_id, password)

    return {"success": True, "credits": float(credits), "passwordUpdated": password_updated}


@app.get("/api/admin/users/{user_id}/history")
async def get_admin_user_history_endpoint(user_id: int, authorization: str = Header(None)):
    """Get combined verification/recharge history for a specific user (admin only)."""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    token = authorization.replace("Bearer ", "")
    admin = auth.verify_token(token)
    if not admin or admin.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    target_user = auth.get_user_by_id(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    cdk_tag = f"user:{user_id}"

    pixel_records = verification_history.get_history_by_user(user_id, limit=100)
    pixel_items = [
        {
            "id": r["id"],
            "type": "pixel",
            "status": r["status"],
            "verificationId": r.get("verificationId", ""),
            "email": "",
            "submitInfo": r.get("verificationId", ""),
            "message": (r.get("message") or "").replace("❌", "").replace("✅", "").strip(),
            "via": r.get("via", ""),
            "cdk": r.get("cdk", ""),
            "timestamp": r["timestamp"],
        }
        for r in pixel_records
    ]

    conn = database.get_connection()
    gpt_rows = conn.execute(
        "SELECT id, card_key, status, used_email, used_at, channel FROM gpt_keys WHERE used_by_cdk = ? ORDER BY id DESC LIMIT 100",
        (cdk_tag,)
    ).fetchall()
    gpt_items = [
        {
            "id": f"gpt_{row['id']}",
            "type": "gpt",
            "status": "pass" if row["status"] == "used" else "failed",
            "verificationId": f"gpt_{row['card_key'][:8]}",
            "email": row["used_email"] or "",
            "submitInfo": row["used_email"] or "",
            "message": f"ChatGPT 充值{'成功' if row['status'] == 'used' else '失败'} ({(row['channel'] or 'sbs').upper()})",
            "via": "gpt",
            "cdk": cdk_tag,
            "cardKey": row["card_key"],
            "channel": row["channel"] or "sbs",
            "timestamp": row["used_at"] or "",
        }
        for row in gpt_rows
    ]

    all_items = pixel_items + gpt_items
    all_items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return {"user": target_user, "history": all_items[:100]}


# ============ GPT TEAM MANAGEMENT (ADMIN) ============

class GptTeamCreateRequest(BaseModel):
    email: str
    accountId: Optional[str] = ""
    teamName: Optional[str] = ""
    planType: Optional[str] = ""
    subscriptionPlan: Optional[str] = ""
    expiresAt: Optional[str] = ""
    currentMembers: Optional[int] = 0
    maxMembers: Optional[int] = 6
    status: Optional[str] = "active"
    accessToken: Optional[str] = ""
    refreshToken: Optional[str] = ""
    sessionToken: Optional[str] = ""
    clientId: Optional[str] = ""
    deviceCodeAuthEnabled: Optional[bool] = False


class GptTeamUpdateRequest(BaseModel):
    email: Optional[str] = None
    accountId: Optional[str] = None
    teamName: Optional[str] = None
    planType: Optional[str] = None
    subscriptionPlan: Optional[str] = None
    expiresAt: Optional[str] = None
    currentMembers: Optional[int] = None
    maxMembers: Optional[int] = None
    status: Optional[str] = None
    accessToken: Optional[str] = None
    refreshToken: Optional[str] = None
    sessionToken: Optional[str] = None
    clientId: Optional[str] = None
    deviceCodeAuthEnabled: Optional[bool] = None


class GptTeamImportRequest(BaseModel):
    import_type: str = "batch"
    access_token: Optional[str] = ""
    refresh_token: Optional[str] = ""
    session_token: Optional[str] = ""
    client_id: Optional[str] = ""
    email: Optional[str] = ""
    account_id: Optional[str] = ""
    team_name: Optional[str] = ""
    max_members: Optional[int] = 6
    status: Optional[str] = "active"
    content: Optional[str] = ""


class GptTeamRecordCreateRequest(BaseModel):
    email: str
    code: Optional[str] = ""
    teamId: Optional[int] = 0
    accountId: Optional[str] = ""
    redeemedAt: Optional[str] = ""
    isWarrantyRedemption: Optional[bool] = False


class GptTeamMemberRequest(BaseModel):
    email: str


def _gpt_team_row_to_dict(row):
    return {
        "id": row["id"],
        "email": row["email"] or "",
        "accountId": row["account_id"] or "",
        "teamName": row["team_name"] or "",
        "planType": row["plan_type"] or "",
        "subscriptionPlan": row["subscription_plan"] or "",
        "expiresAt": row["expires_at"] or "",
        "currentMembers": int(row["current_members"] or 0),
        "maxMembers": int(row["max_members"] or 0),
        "status": row["status"] or "active",
        "accessToken": row["access_token"] or "",
        "refreshToken": row["refresh_token"] or "",
        "sessionToken": row["session_token"] or "",
        "clientId": row["client_id"] or "",
        "deviceCodeAuthEnabled": bool(row["device_code_auth_enabled"] or 0),
        "errorCount": int(row["error_count"] or 0),
        "createdAt": row["created_at"] or "",
        "updatedAt": row["updated_at"] or "",
    }


def _normalize_team_payload(raw: dict) -> dict:
    now = datetime.utcnow().isoformat() + "Z"
    email = (raw.get("email") or "").strip()
    return {
        "email": email,
        "account_id": (raw.get("accountId") or raw.get("account_id") or "").strip(),
        "team_name": (raw.get("teamName") or raw.get("team_name") or "").strip(),
        "plan_type": (raw.get("planType") or raw.get("plan_type") or "").strip(),
        "subscription_plan": (raw.get("subscriptionPlan") or raw.get("subscription_plan") or "").strip(),
        "expires_at": (raw.get("expiresAt") or raw.get("expires_at") or "").strip(),
        "current_members": int(raw.get("currentMembers") or raw.get("current_members") or 0),
        "max_members": int(raw.get("maxMembers") or raw.get("max_members") or 6),
        "status": (raw.get("status") or "active").strip().lower(),
        "access_token": (raw.get("accessToken") or raw.get("access_token") or "").strip(),
        "refresh_token": (raw.get("refreshToken") or raw.get("refresh_token") or "").strip(),
        "session_token": (raw.get("sessionToken") or raw.get("session_token") or "").strip(),
        "client_id": (raw.get("clientId") or raw.get("client_id") or "").strip(),
        "device_code_auth_enabled": 1 if bool(raw.get("deviceCodeAuthEnabled") or raw.get("device_code_auth_enabled")) else 0,
        "updated_at": now,
        "created_at": now,
    }


def _decode_jwt_payload_unverified(token: str) -> dict:
    try:
        token = (token or "").strip()
        if token.count(".") < 2:
            return {}
        payload_b64 = token.split(".")[1]
        padding = "=" * ((4 - len(payload_b64) % 4) % 4)
        decoded = base64.urlsafe_b64decode(payload_b64 + padding).decode("utf-8", errors="ignore")
        data = json.loads(decoded)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _extract_email_from_access_token(token: str) -> str:
    data = _decode_jwt_payload_unverified(token)
    profile = data.get("https://api.openai.com/profile") or {}
    email = (profile.get("email") or data.get("email") or "").strip()
    return email


def _extract_account_id_from_access_token(token: str) -> str:
    data = _decode_jwt_payload_unverified(token)
    auth_claim = data.get("https://api.openai.com/auth") or {}
    account_id = (auth_claim.get("chatgpt_account_id") or "").strip()
    return account_id


_gpt_team_sessions = {}


async def _gpt_team_get_session(identifier: str = "default"):
    session = _gpt_team_sessions.get(identifier)
    if session:
        return session
    from curl_cffi.requests import AsyncSession as CurlAsyncSession
    session = CurlAsyncSession(
        impersonate="chrome110",
        timeout=30,
        verify=False,
    )
    _gpt_team_sessions[identifier] = session
    return session


async def _gpt_team_clear_session(identifier: Optional[str] = None):
    if identifier:
        session = _gpt_team_sessions.pop(identifier, None)
        if session:
            with contextlib.suppress(Exception):
                await session.close()
        return
    for key, session in list(_gpt_team_sessions.items()):
        with contextlib.suppress(Exception):
            await session.close()
        _gpt_team_sessions.pop(key, None)


async def _gpt_team_make_request(method: str, url: str, headers: Optional[dict] = None, json_data: Optional[dict] = None, identifier: str = "default") -> dict:
    headers = dict(headers or {})
    if identifier == "default":
        account_id = headers.get("chatgpt-account-id", "")
        if account_id:
            identifier = f"acc_{account_id}"
        else:
            auth_header = headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token_email = _extract_email_from_access_token(auth_header.replace("Bearer ", ""))
                if token_email:
                    identifier = token_email.lower()
    session = await _gpt_team_get_session(identifier)
    base_headers = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://chatgpt.com/",
        "Origin": "https://chatgpt.com",
        "Connection": "keep-alive",
    }
    for key, value in base_headers.items():
        headers.setdefault(key, value)

    try:
        if method == "GET":
            response = await session.get(url, headers=headers)
        elif method == "POST":
            response = await session.post(url, headers=headers, json=json_data)
        elif method == "DELETE":
            response = await session.delete(url, headers=headers, json=json_data)
        else:
            raise ValueError(f"Unsupported method: {method}")
    except Exception as e:
        return {"success": False, "status_code": 0, "error": str(e), "error_code": ""}

    status_code = getattr(response, "status_code", 0)
    raw_text = ""
    with contextlib.suppress(Exception):
        raw_text = response.text
    parsed = {}
    with contextlib.suppress(Exception):
        parsed = response.json()

    if 200 <= status_code < 300:
        return {"success": True, "status_code": status_code, "data": parsed if isinstance(parsed, dict) else {}, "error": None, "error_code": ""}

    error_code = ""
    error_message = raw_text or f"HTTP {status_code}"
    if isinstance(parsed, dict):
        detail = parsed.get("detail", parsed.get("error", error_message))
        if isinstance(detail, dict):
            error_message = detail.get("message") or detail.get("error") or json.dumps(detail, ensure_ascii=False)
            error_code = detail.get("code") or ""
        else:
            error_message = str(detail)
            error_info = parsed.get("error")
            if isinstance(error_info, dict):
                error_code = error_info.get("code") or ""
            else:
                error_code = parsed.get("code") or ""

    if "token_invalidated" in (error_message or "").lower() or error_code == "token_invalidated":
        await _gpt_team_clear_session(identifier)

    return {
        "success": False,
        "status_code": status_code,
        "error": error_message,
        "error_code": error_code,
        "data": parsed if isinstance(parsed, dict) else {},
    }


async def _gpt_team_refresh_access_token_with_session_token(session_token: str, account_id: str = "", identifier: str = "default") -> dict:
    session_token = (session_token or "").strip()
    if not session_token:
        return {"success": False, "error": "缺少 Session Token"}

    url = "https://chatgpt.com/api/auth/session"
    if account_id:
        url += f"?exchange_workspace_token=true&workspace_id={account_id}&reason=setCurrentAccount"
    cookie_name = "__Secure-next-auth.session-token"
    if not session_token.startswith("eyJ"):
        cookie_name = "next-auth.session-token"

    session = await _gpt_team_get_session(identifier if identifier != "default" else f"st_{session_token[:8]}")
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Cookie": f"{cookie_name}={session_token}",
        "Referer": "https://chatgpt.com/",
        "Connection": "keep-alive",
    }
    try:
        response = await session.get(url, headers=headers)
        if response.status_code != 200:
            return {"success": False, "error": response.text or f"HTTP {response.status_code}", "status_code": response.status_code}
        data = response.json()
        access_token = (data.get("accessToken") or "").strip()
        refreshed_session_token = (data.get("sessionToken") or session_token).strip()
        if not access_token:
            return {"success": False, "error": "响应中未包含 accessToken"}
        return {"success": True, "access_token": access_token, "session_token": refreshed_session_token}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def _gpt_team_refresh_access_token_with_refresh_token(refresh_token: str, client_id: str) -> dict:
    refresh_token = (refresh_token or "").strip()
    client_id = (client_id or "").strip()
    if not refresh_token or not client_id:
        return {"success": False, "error": "刷新 Access Token 需要 Refresh Token 和 Client ID"}
    try:
        async with httpx.AsyncClient(timeout=30, verify=False) as client:
            response = await client.post(
                "https://auth.openai.com/oauth/token",
                json={
                    "client_id": client_id,
                    "grant_type": "refresh_token",
                    "redirect_uri": "com.openai.sora://auth.openai.com/android/com.openai.sora/callback",
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/json"},
            )
        if response.status_code != 200:
            return {"success": False, "error": response.text or f"HTTP {response.status_code}", "status_code": response.status_code}
        data = response.json()
        access_token = (data.get("access_token") or "").strip()
        if not access_token:
            return {"success": False, "error": "刷新响应中未包含 access_token"}
        return {
            "success": True,
            "access_token": access_token,
            "refresh_token": (data.get("refresh_token") or refresh_token).strip(),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def _gpt_team_ensure_access_token(team_row, force_refresh: bool = False) -> dict:
    access_token = (team_row["access_token"] or "").strip()
    refresh_token = (team_row["refresh_token"] or "").strip()
    session_token = (team_row["session_token"] or "").strip()
    client_id = (team_row["client_id"] or "").strip()
    account_id = (team_row["account_id"] or "").strip()
    identifier = (team_row["email"] or account_id or f"team_{team_row['id']}").strip()

    if access_token and not force_refresh:
        return {
            "success": True,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "session_token": session_token,
            "identifier": identifier,
        }

    if session_token:
        refreshed = await _gpt_team_refresh_access_token_with_session_token(session_token, account_id=account_id, identifier=identifier)
        if refreshed.get("success"):
            return {
                "success": True,
                "access_token": refreshed["access_token"],
                "refresh_token": refresh_token,
                "session_token": refreshed.get("session_token", session_token),
                "identifier": identifier,
            }

    if refresh_token and client_id:
        refreshed = await _gpt_team_refresh_access_token_with_refresh_token(refresh_token, client_id)
        if refreshed.get("success"):
            return {
                "success": True,
                "access_token": refreshed["access_token"],
                "refresh_token": refreshed.get("refresh_token", refresh_token),
                "session_token": session_token,
                "identifier": identifier,
            }

    if access_token:
        return {
            "success": True,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "session_token": session_token,
            "identifier": identifier,
        }
    return {"success": False, "error": "Token 已过期且无法刷新"}


async def _gpt_team_get_account_info(access_token: str, identifier: str = "default") -> dict:
    result = await _gpt_team_make_request(
        "GET",
        "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27",
        headers={"Authorization": f"Bearer {access_token}"},
        identifier=identifier,
    )
    if not result.get("success"):
        return {"success": False, "accounts": [], "error": result.get("error") or "获取账户信息失败"}
    data = result.get("data") or {}
    accounts_data = data.get("accounts") or {}
    team_accounts = []
    if isinstance(accounts_data, dict):
        for aid, info in accounts_data.items():
            account = (info or {}).get("account") or {}
            entitlement = (info or {}).get("entitlement") or {}
            if account.get("plan_type") != "team":
                continue
            team_accounts.append({
                "account_id": aid,
                "name": account.get("name") or "",
                "plan_type": account.get("plan_type") or "",
                "account_user_role": account.get("account_user_role") or "",
                "subscription_plan": entitlement.get("subscription_plan") or "",
                "expires_at": entitlement.get("expires_at") or "",
                "has_active_subscription": bool(entitlement.get("has_active_subscription")),
            })
    return {"success": True, "accounts": team_accounts, "error": None}


async def _gpt_team_get_account_settings(access_token: str, account_id: str, identifier: str = "default") -> dict:
    return await _gpt_team_make_request(
        "GET",
        f"https://chatgpt.com/backend-api/accounts/{account_id}/settings",
        headers={
            "Authorization": f"Bearer {access_token}",
            "chatgpt-account-id": account_id,
        },
        identifier=identifier,
    )


async def _gpt_team_get_members(access_token: str, account_id: str, identifier: str = "default") -> dict:
    all_members = []
    offset = 0
    limit = 50
    while True:
        result = await _gpt_team_make_request(
            "GET",
            f"https://chatgpt.com/backend-api/accounts/{account_id}/users?limit={limit}&offset={offset}",
            headers={"Authorization": f"Bearer {access_token}"},
            identifier=identifier,
        )
        if not result.get("success"):
            return {"success": False, "members": [], "total": 0, "error": result.get("error") or "获取成员失败"}
        data = result.get("data") or {}
        items = data.get("items") or []
        total = int(data.get("total") or 0)
        all_members.extend(items if isinstance(items, list) else [])
        if len(all_members) >= total or not items:
            break
        offset += limit
    return {"success": True, "members": all_members, "total": len(all_members), "error": None}


async def _gpt_team_get_invites(access_token: str, account_id: str, identifier: str = "default") -> dict:
    result = await _gpt_team_make_request(
        "GET",
        f"https://chatgpt.com/backend-api/accounts/{account_id}/invites",
        headers={
            "Authorization": f"Bearer {access_token}",
            "chatgpt-account-id": account_id,
        },
        identifier=identifier,
    )
    if not result.get("success"):
        return {"success": False, "items": [], "total": 0, "error": result.get("error") or "获取邀请失败"}
    data = result.get("data") or {}
    items = data.get("items") or []
    return {"success": True, "items": items if isinstance(items, list) else [], "total": len(items or []), "error": None}


async def _gpt_team_send_invite(access_token: str, account_id: str, email: str, identifier: str = "default") -> dict:
    return await _gpt_team_make_request(
        "POST",
        f"https://chatgpt.com/backend-api/accounts/{account_id}/invites",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "chatgpt-account-id": account_id,
        },
        json_data={"email_addresses": [email], "role": "standard-user", "resend_emails": True},
        identifier=identifier,
    )


async def _gpt_team_delete_member(access_token: str, account_id: str, user_id: str, identifier: str = "default") -> dict:
    return await _gpt_team_make_request(
        "DELETE",
        f"https://chatgpt.com/backend-api/accounts/{account_id}/users/{user_id}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "chatgpt-account-id": account_id,
        },
        identifier=identifier,
    )


async def _gpt_team_delete_invite(access_token: str, account_id: str, email: str, identifier: str = "default") -> dict:
    return await _gpt_team_make_request(
        "DELETE",
        f"https://chatgpt.com/backend-api/accounts/{account_id}/invites",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "chatgpt-account-id": account_id,
        },
        json_data={"email_address": email},
        identifier=identifier,
    )


def _gpt_team_pick_account(team_row, accounts: list) -> Optional[dict]:
    if not accounts:
        return None
    account_id = (team_row["account_id"] or "").strip()
    for account in accounts:
        if (account.get("account_id") or "") == account_id:
            return account
    for account in accounts:
        if account.get("has_active_subscription"):
            return account
    return accounts[0]


async def _gpt_team_sync(team_id: int, force_refresh: bool = False) -> dict:
    conn = database.get_connection()
    team_row = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()
    if not team_row:
        return {"success": False, "error": f"Team ID {team_id} 不存在"}

    ensured = await _gpt_team_ensure_access_token(team_row, force_refresh=force_refresh)
    if not ensured.get("success"):
        return {"success": False, "error": ensured.get("error") or "Token 已过期且无法刷新"}

    access_token = ensured["access_token"]
    refresh_token = ensured.get("refresh_token", "")
    session_token = ensured.get("session_token", "")
    identifier = ensured.get("identifier") or (team_row["email"] or f"team_{team_id}")

    token_email = _extract_email_from_access_token(access_token)
    if token_email and team_row["email"] and token_email.lower() != team_row["email"].lower():
        return {"success": False, "error": f"Token 对应账号 ({token_email}) 与 Team 邮箱 ({team_row['email']}) 不一致"}

    account_info = await _gpt_team_get_account_info(access_token, identifier=identifier)
    if not account_info.get("success"):
        return {"success": False, "error": account_info.get("error") or "获取账户信息失败"}

    current_account = _gpt_team_pick_account(team_row, account_info.get("accounts") or [])
    if not current_account:
        return {"success": False, "error": "该 Token 没有关联任何 Team 账户"}

    members_result = await _gpt_team_get_members(access_token, current_account["account_id"], identifier=identifier)
    if not members_result.get("success"):
        return {"success": False, "error": members_result.get("error") or "获取成员列表失败"}

    invites_result = await _gpt_team_get_invites(access_token, current_account["account_id"], identifier=identifier)
    if not invites_result.get("success"):
        return {"success": False, "error": invites_result.get("error") or "获取邀请列表失败"}

    settings_result = await _gpt_team_get_account_settings(access_token, current_account["account_id"], identifier=identifier)
    beta_settings = ((settings_result.get("data") or {}).get("beta_settings") or {}) if settings_result.get("success") else {}
    device_code_auth_enabled = 1 if bool(beta_settings.get("codex_device_code_auth")) else 0

    current_members = int(members_result.get("total") or 0) + int(invites_result.get("total") or 0)
    expires_at_raw = (current_account.get("expires_at") or "").strip()
    normalized_expires_at = expires_at_raw
    status = "active"
    if current_members >= int(team_row["max_members"] or 6):
        status = "full"
    if expires_at_raw:
        with contextlib.suppress(Exception):
            expires_dt = datetime.fromisoformat(expires_at_raw.replace("+00:00", ""))
            if expires_dt < datetime.now():
                status = "expired"

    now = datetime.utcnow().isoformat() + "Z"
    conn.execute(
        """
        UPDATE gpt_team_accounts
        SET email = ?, account_id = ?, team_name = ?, plan_type = ?, subscription_plan = ?,
            expires_at = ?, current_members = ?, status = ?, access_token = ?, refresh_token = ?,
            session_token = ?, device_code_auth_enabled = ?, error_count = 0, updated_at = ?
        WHERE id = ?
        """,
        (
            token_email or (team_row["email"] or ""),
            current_account.get("account_id") or team_row["account_id"] or "",
            current_account.get("name") or team_row["team_name"] or "",
            current_account.get("plan_type") or team_row["plan_type"] or "",
            current_account.get("subscription_plan") or team_row["subscription_plan"] or "",
            normalized_expires_at,
            current_members,
            status,
            access_token,
            refresh_token,
            session_token,
            device_code_auth_enabled,
            now,
            team_id,
        ),
    )
    conn.commit()

    member_emails = set()
    for member in members_result.get("members") or []:
        if member.get("email"):
            member_emails.add(member["email"].lower())
    for invite in invites_result.get("items") or []:
        if invite.get("email_address"):
            member_emails.add(invite["email_address"].lower())

    return {
        "success": True,
        "message": f"同步成功,当前成员数: {current_members}",
        "member_emails": sorted(member_emails),
        "team": _gpt_team_row_to_dict(conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()),
        "accountId": current_account.get("account_id") or "",
    }


async def _gpt_team_members_payload(team_id: int) -> dict:
    sync_result = await _gpt_team_sync(team_id)
    if not sync_result.get("success"):
        return {"success": False, "members": [], "total": 0, "error": sync_result.get("error") or "同步失败"}

    conn = database.get_connection()
    team_row = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()
    if not team_row:
        return {"success": False, "members": [], "total": 0, "error": "Team 不存在"}

    ensured = await _gpt_team_ensure_access_token(team_row)
    if not ensured.get("success"):
        return {"success": False, "members": [], "total": 0, "error": ensured.get("error") or "Token 不可用"}

    access_token = ensured["access_token"]
    identifier = ensured.get("identifier") or (team_row["email"] or f"team_{team_id}")
    account_id = (team_row["account_id"] or sync_result.get("accountId") or "").strip()

    members_result = await _gpt_team_get_members(access_token, account_id, identifier=identifier)
    if not members_result.get("success"):
        return {"success": False, "members": [], "total": 0, "error": members_result.get("error") or "获取成员失败"}
    invites_result = await _gpt_team_get_invites(access_token, account_id, identifier=identifier)
    if not invites_result.get("success"):
        return {"success": False, "members": [], "total": 0, "error": invites_result.get("error") or "获取邀请失败"}

    all_members = []
    for member in members_result.get("members") or []:
        all_members.append({
            "user_id": member.get("id") or "",
            "email": member.get("email") or "",
            "name": member.get("name") or "",
            "role": member.get("role") or "",
            "added_at": member.get("created_time") or "",
            "status": "joined",
        })
    for invite in invites_result.get("items") or []:
        all_members.append({
            "user_id": "",
            "email": invite.get("email_address") or "",
            "name": invite.get("email_address") or "",
            "role": "standard-user",
            "added_at": invite.get("created_time") or invite.get("invite_link_expiry_time") or "",
            "status": "invited",
        })
    return {"success": True, "members": all_members, "total": len(all_members), "error": None, "team": _gpt_team_row_to_dict(team_row)}


async def _pick_team_for_user_invite() -> Optional[dict]:
    conn = database.get_connection()
    rows = conn.execute(
        """
        SELECT * FROM gpt_team_accounts
        WHERE status IN ('active', 'full', 'error', 'expired')
        ORDER BY
            CASE WHEN status='active' THEN 0 WHEN status='full' THEN 1 ELSE 2 END,
            updated_at DESC,
            id ASC
        LIMIT 20
        """
    ).fetchall()
    for row in rows:
        sync_result = await _gpt_team_sync(row["id"])
        if not sync_result.get("success"):
            continue
        team = sync_result.get("team") or {}
        current_members = int(team.get("currentMembers") or 0)
        max_members = int(team.get("maxMembers") or 0)
        if (team.get("status") or "").lower() == "active" and max_members > 0 and current_members < max_members:
            return team
    return None


def _parse_team_import_text(text: str) -> List[dict]:
    jwt_pattern = r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"
    email_pattern = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
    account_id_pattern = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    refresh_token_pattern = r"rt[_-][A-Za-z0-9._-]+"
    session_token_pattern = r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)?"
    client_id_pattern = r"app_[A-Za-z0-9]+"
    results = []

    for raw_line in (text or "").strip().split("\n"):
        line = (raw_line or "").strip()
        if not line:
            continue
        token = None
        email = None
        account_id = None
        refresh_token = None
        session_token = None
        client_id = None

        parts = [p.strip() for p in re.split(r"----|\||\t|\s{2,}", line) if p.strip()]
        if len(parts) >= 2:
            for part in parts:
                if not token and re.fullmatch(jwt_pattern, part):
                    token = part
                elif not email and re.fullmatch(email_pattern, part):
                    email = part
                elif not account_id and re.fullmatch(account_id_pattern, part, re.IGNORECASE):
                    account_id = part
                elif not refresh_token and re.match(refresh_token_pattern, part):
                    refresh_token = part
                elif not session_token and re.match(session_token_pattern, part):
                    if token:
                        session_token = part
                    else:
                        token = part
                elif not client_id and re.match(client_id_pattern, part):
                    client_id = part

        if not token:
            tokens = re.findall(jwt_pattern, line)
            if tokens:
                token = tokens[0]
                if len(tokens) > 1:
                    session_token = tokens[1]
            if not email:
                emails = re.findall(email_pattern, line)
                email = emails[0] if emails else None
            if not account_id:
                account_ids = re.findall(account_id_pattern, line, re.IGNORECASE)
                account_id = account_ids[0] if account_ids else None
            if not refresh_token:
                rts = re.findall(refresh_token_pattern, line)
                refresh_token = rts[0] if rts else None
            if not client_id:
                cids = re.findall(client_id_pattern, line)
                client_id = cids[0] if cids else None

        if token or session_token or refresh_token:
            results.append({
                "token": token,
                "email": email,
                "account_id": account_id,
                "refresh_token": refresh_token,
                "session_token": session_token,
                "client_id": client_id,
            })

    return results


def _import_gpt_team_single(access_token: Optional[str], email: Optional[str], account_id: Optional[str], refresh_token: Optional[str], session_token: Optional[str], client_id: Optional[str], team_name: Optional[str], max_members: Optional[int], status: Optional[str]) -> dict:
    try:
        access_token = (access_token or "").strip()
        refresh_token = (refresh_token or "").strip()
        session_token = (session_token or "").strip()
        client_id = (client_id or "").strip()
        team_name = (team_name or "").strip()
        status = ((status or "active").strip().lower() or "active")
        max_members = int(max_members or 6)
        if max_members < 1:
            max_members = 6

        if not any([access_token, refresh_token, session_token]):
            return {
                "success": False,
                "team_id": None,
                "email": email,
                "message": None,
                "error": "必须提供 Access Token、Refresh Token 或 Session Token 其中之一",
            }

        if not access_token:
            return {
                "success": False,
                "team_id": None,
                "email": email,
                "message": None,
                "error": "缺少有效的 Access Token，且无法通过 Session/Refresh Token 刷新",
            }

        token_email = _extract_email_from_access_token(access_token)
        email = (email or "").strip() or token_email
        if not email:
            return {
                "success": False,
                "team_id": None,
                "email": None,
                "message": None,
                "error": "无法从 Token 中提取邮箱,请手动提供邮箱",
            }
        if token_email and token_email.lower() != email.lower():
            return {
                "success": False,
                "team_id": None,
                "email": email,
                "message": None,
                "error": f"Token 对应的账号身份 ({token_email}) 与提供的邮箱 ({email}) 不符，导入已中止。请检查是否有其他账号正在登录导致 Session 污染。",
            }

        account_id = (account_id or "").strip() or _extract_account_id_from_access_token(access_token)
        if not account_id:
            return {
                "success": False,
                "team_id": None,
                "email": email,
                "message": None,
                "error": "无法从 Token 中提取 Account ID,请手动提供 Account ID",
            }

        conn = database.get_connection()
        exist_by_account = conn.execute(
            "SELECT id FROM gpt_team_accounts WHERE account_id = ? LIMIT 1",
            (account_id,),
        ).fetchone()
        if exist_by_account:
            return {
                "success": False,
                "team_id": None,
                "email": email,
                "message": None,
                "error": "该 Team 账号已在系统中",
            }

        now = datetime.utcnow().isoformat() + "Z"
        conn.execute(
            """
            INSERT INTO gpt_team_accounts (
                email, account_id, team_name, plan_type, subscription_plan, expires_at,
                current_members, max_members, status, access_token, refresh_token,
                session_token, client_id, device_code_auth_enabled, error_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                email,
                account_id,
                team_name,
                "",
                "",
                "",
                0,
                max_members,
                status,
                access_token,
                refresh_token,
                session_token,
                client_id,
                0,
                now,
                now,
            ),
        )
        team_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        conn.commit()
        return {
            "success": True,
            "team_id": team_id,
            "email": email,
            "message": "成功导入 1 个 Team 账号",
            "error": None,
        }
    except Exception as e:
        return {
            "success": False,
            "team_id": None,
            "email": email,
            "message": None,
            "error": f"导入失败: {str(e)}",
        }


@app.get("/api/admin/gpt-team/dashboard")
async def admin_gpt_team_dashboard(
    authorization: Optional[str] = Header(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=200),
    search: str = Query(""),
    status: str = Query(""),
):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    search = (search or "").strip()
    status = (status or "").strip().lower()

    where = ["1=1"]
    params: List = []
    if search:
        where.append("(email LIKE ? OR account_id LIKE ? OR team_name LIKE ?)")
        kw = f"%{search}%"
        params.extend([kw, kw, kw])
    if status:
        where.append("status = ?")
        params.append(status)

    where_sql = " AND ".join(where)
    total_row = conn.execute(f"SELECT COUNT(*) AS c FROM gpt_team_accounts WHERE {where_sql}", params).fetchone()
    total = int(total_row["c"] if total_row else 0)
    offset = (page - 1) * per_page
    rows = conn.execute(
        f"""
        SELECT * FROM gpt_team_accounts
        WHERE {where_sql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        """,
        [*params, per_page, offset],
    ).fetchall()
    teams = [_gpt_team_row_to_dict(r) for r in rows]

    stats_row = conn.execute(
        """
        SELECT
            COUNT(*) AS total_teams,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS available_teams
        FROM gpt_team_accounts
        """
    ).fetchone()
    rec_row = conn.execute("SELECT COUNT(*) AS total_records FROM gpt_team_usage_records").fetchone()
    stats = {
        "totalTeams": int((stats_row["total_teams"] if stats_row else 0) or 0),
        "availableTeams": int((stats_row["available_teams"] if stats_row else 0) or 0),
        "totalRecords": int((rec_row["total_records"] if rec_row else 0) or 0),
    }

    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    return {
        "stats": stats,
        "teams": teams,
        "pagination": {
            "currentPage": page,
            "perPage": per_page,
            "total": total,
            "totalPages": total_pages,
        },
    }


@app.post("/api/admin/gpt-team/teams")
async def admin_gpt_team_create(team: GptTeamCreateRequest, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    payload = _normalize_team_payload(team.dict())
    if not payload["email"]:
        raise HTTPException(status_code=400, detail="email 不能为空")
    conn = database.get_connection()
    conn.execute(
        """
        INSERT INTO gpt_team_accounts (
            email, account_id, team_name, plan_type, subscription_plan, expires_at,
            current_members, max_members, status, access_token, refresh_token,
            session_token, client_id, device_code_auth_enabled, error_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
            account_id=excluded.account_id,
            team_name=excluded.team_name,
            plan_type=excluded.plan_type,
            subscription_plan=excluded.subscription_plan,
            expires_at=excluded.expires_at,
            current_members=excluded.current_members,
            max_members=excluded.max_members,
            status=excluded.status,
            access_token=excluded.access_token,
            refresh_token=excluded.refresh_token,
            session_token=excluded.session_token,
            client_id=excluded.client_id,
            device_code_auth_enabled=excluded.device_code_auth_enabled,
            updated_at=excluded.updated_at
        """,
        (
            payload["email"], payload["account_id"], payload["team_name"], payload["plan_type"],
            payload["subscription_plan"], payload["expires_at"], payload["current_members"],
            payload["max_members"], payload["status"], payload["access_token"], payload["refresh_token"],
            payload["session_token"], payload["client_id"], payload["device_code_auth_enabled"],
            payload["created_at"], payload["updated_at"],
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM gpt_team_accounts WHERE email = ? LIMIT 1", (payload["email"],)).fetchone()
    return {"success": True, "team": _gpt_team_row_to_dict(row)}


@app.get("/api/admin/gpt-team/teams/{team_id}")
async def admin_gpt_team_get(team_id: int, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    row = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Team 不存在")
    return {"success": True, "team": _gpt_team_row_to_dict(row)}


@app.put("/api/admin/gpt-team/teams/{team_id}")
async def admin_gpt_team_update(team_id: int, body: GptTeamUpdateRequest, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    update_raw = {k: v for k, v in body.dict().items() if v is not None}
    if not update_raw:
        return {"success": True}
    payload = _normalize_team_payload(update_raw)
    conn = database.get_connection()
    existing = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Team 不存在")

    merged = {
        "email": payload["email"] or existing["email"],
        "account_id": payload["account_id"] if "accountId" in update_raw or "account_id" in update_raw else existing["account_id"],
        "team_name": payload["team_name"] if "teamName" in update_raw or "team_name" in update_raw else existing["team_name"],
        "plan_type": payload["plan_type"] if "planType" in update_raw or "plan_type" in update_raw else existing["plan_type"],
        "subscription_plan": payload["subscription_plan"] if "subscriptionPlan" in update_raw or "subscription_plan" in update_raw else existing["subscription_plan"],
        "expires_at": payload["expires_at"] if "expiresAt" in update_raw or "expires_at" in update_raw else existing["expires_at"],
        "current_members": payload["current_members"] if "currentMembers" in update_raw or "current_members" in update_raw else existing["current_members"],
        "max_members": payload["max_members"] if "maxMembers" in update_raw or "max_members" in update_raw else existing["max_members"],
        "status": payload["status"] if "status" in update_raw else existing["status"],
        "access_token": payload["access_token"] if "accessToken" in update_raw or "access_token" in update_raw else existing["access_token"],
        "refresh_token": payload["refresh_token"] if "refreshToken" in update_raw or "refresh_token" in update_raw else existing["refresh_token"],
        "session_token": payload["session_token"] if "sessionToken" in update_raw or "session_token" in update_raw else existing["session_token"],
        "client_id": payload["client_id"] if "clientId" in update_raw or "client_id" in update_raw else existing["client_id"],
        "device_code_auth_enabled": payload["device_code_auth_enabled"] if "deviceCodeAuthEnabled" in update_raw or "device_code_auth_enabled" in update_raw else existing["device_code_auth_enabled"],
    }
    merged["updated_at"] = datetime.utcnow().isoformat() + "Z"
    conn.execute(
        """
        UPDATE gpt_team_accounts
        SET email=?, account_id=?, team_name=?, plan_type=?, subscription_plan=?, expires_at=?,
            current_members=?, max_members=?, status=?, access_token=?, refresh_token=?,
            session_token=?, client_id=?, device_code_auth_enabled=?, updated_at=?
        WHERE id=?
        """,
        (
            merged["email"], merged["account_id"], merged["team_name"], merged["plan_type"], merged["subscription_plan"],
            merged["expires_at"], merged["current_members"], merged["max_members"], merged["status"], merged["access_token"],
            merged["refresh_token"], merged["session_token"], merged["client_id"], merged["device_code_auth_enabled"],
            merged["updated_at"], team_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()
    return {"success": True, "team": _gpt_team_row_to_dict(row)}


@app.delete("/api/admin/gpt-team/teams/{team_id}")
async def admin_gpt_team_delete(team_id: int, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    conn.execute("DELETE FROM gpt_team_accounts WHERE id = ?", (team_id,))
    conn.commit()
    return {"success": True, "id": team_id}


@app.post("/api/admin/gpt-team/teams/{team_id}/refresh")
async def admin_gpt_team_refresh(team_id: int, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    result = await _gpt_team_sync(team_id, force_refresh=True)
    if not result.get("success"):
        return JSONResponse(status_code=400, content=result)
    return result


@app.get("/api/admin/gpt-team/teams/{team_id}/members/list")
async def admin_gpt_team_members(team_id: int, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    result = await _gpt_team_members_payload(team_id)
    if not result.get("success"):
        return JSONResponse(status_code=400, content=result)
    return result


@app.post("/api/admin/gpt-team/teams/{team_id}/members/add")
async def admin_gpt_team_add_member(team_id: int, body: GptTeamMemberRequest, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    email = (body.email or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="email 不能为空")

    sync_result = await _gpt_team_sync(team_id)
    if not sync_result.get("success"):
        return JSONResponse(status_code=400, content=sync_result)

    conn = database.get_connection()
    team_row = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()
    if not team_row:
        raise HTTPException(status_code=404, detail="Team 不存在")
    if int(team_row["current_members"] or 0) >= int(team_row["max_members"] or 6):
        raise HTTPException(status_code=400, detail="Team 已满员")

    ensured = await _gpt_team_ensure_access_token(team_row)
    if not ensured.get("success"):
        return JSONResponse(status_code=400, content=ensured)

    result = await _gpt_team_send_invite(
        ensured["access_token"],
        team_row["account_id"],
        email,
        identifier=ensured.get("identifier") or team_row["email"] or f"team_{team_id}",
    )
    if not result.get("success"):
        return JSONResponse(status_code=400, content={"success": False, "error": result.get("error") or "添加成员失败"})

    await _gpt_team_sync(team_id)
    return {"success": True, "message": f"已邀请 {email}"}


@app.post("/api/admin/gpt-team/teams/{team_id}/members/{user_id}/delete")
async def admin_gpt_team_delete_member(team_id: int, user_id: str, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    team_row = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()
    if not team_row:
        raise HTTPException(status_code=404, detail="Team 不存在")

    ensured = await _gpt_team_ensure_access_token(team_row)
    if not ensured.get("success"):
        return JSONResponse(status_code=400, content=ensured)

    result = await _gpt_team_delete_member(
        ensured["access_token"],
        team_row["account_id"],
        user_id,
        identifier=ensured.get("identifier") or team_row["email"] or f"team_{team_id}",
    )
    if not result.get("success"):
        return JSONResponse(status_code=400, content={"success": False, "error": result.get("error") or "删除成员失败"})

    await _gpt_team_sync(team_id)
    return {"success": True, "message": "成员已删除"}


@app.post("/api/admin/gpt-team/teams/{team_id}/invites/revoke")
async def admin_gpt_team_revoke_invite(team_id: int, body: GptTeamMemberRequest, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    email = (body.email or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="email 不能为空")

    conn = database.get_connection()
    team_row = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team_id,)).fetchone()
    if not team_row:
        raise HTTPException(status_code=404, detail="Team 不存在")

    ensured = await _gpt_team_ensure_access_token(team_row)
    if not ensured.get("success"):
        return JSONResponse(status_code=400, content=ensured)

    result = await _gpt_team_delete_invite(
        ensured["access_token"],
        team_row["account_id"],
        email,
        identifier=ensured.get("identifier") or team_row["email"] or f"team_{team_id}",
    )
    if not result.get("success"):
        return JSONResponse(status_code=400, content={"success": False, "error": result.get("error") or "撤回邀请失败"})

    await _gpt_team_sync(team_id)
    return {"success": True, "message": f"已撤回 {email} 的邀请"}


@app.post("/api/admin/gpt-team/import")
async def admin_gpt_team_import(body: GptTeamImportRequest, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    if body.import_type == "single":
        result = _import_gpt_team_single(
            access_token=body.access_token,
            email=body.email,
            account_id=body.account_id,
            refresh_token=body.refresh_token,
            session_token=body.session_token,
            client_id=body.client_id,
            team_name=body.team_name,
            max_members=body.max_members,
            status=body.status,
        )
        if not result.get("success"):
            return JSONResponse(status_code=400, content=result)
        return result

    if body.import_type != "batch":
        return JSONResponse(status_code=400, content={"success": False, "error": "无效的导入类型"})

    async def progress_generator():
        try:
            parsed_data = _parse_team_import_text(body.content or "")
            if not parsed_data:
                yield json.dumps({"type": "error", "error": "未能从文本中提取任何 Token"}, ensure_ascii=False) + "\n"
                return

            seen = set()
            unique_data = []
            for item in parsed_data:
                token = item.get("token")
                email = item.get("email")
                if not email and token:
                    email = _extract_email_from_access_token(token)
                    if email:
                        item["email"] = email
                dedup_key = (email or "").lower() if email else token
                if dedup_key and dedup_key not in seen:
                    seen.add(dedup_key)
                    unique_data.append(item)

            parsed_data = unique_data
            total = len(parsed_data)
            yield json.dumps({"type": "start", "total": total}, ensure_ascii=False) + "\n"

            success_count = 0
            failed_count = 0
            for i, data in enumerate(parsed_data):
                result = _import_gpt_team_single(
                    access_token=data.get("token"),
                    email=data.get("email"),
                    account_id=data.get("account_id"),
                    refresh_token=data.get("refresh_token"),
                    session_token=data.get("session_token"),
                    client_id=data.get("client_id"),
                    team_name="",
                    max_members=6,
                    status="active",
                )
                if result.get("success"):
                    success_count += 1
                else:
                    failed_count += 1

                yield json.dumps({
                    "type": "progress",
                    "current": i + 1,
                    "total": total,
                    "success_count": success_count,
                    "failed_count": failed_count,
                    "last_result": {
                        "email": result.get("email") or data.get("email") or "未知",
                        "account_id": data.get("account_id", "未指定"),
                        "success": bool(result.get("success")),
                        "team_id": result.get("team_id"),
                        "message": result.get("message"),
                        "error": result.get("error"),
                    },
                }, ensure_ascii=False) + "\n"

            yield json.dumps({
                "type": "finish",
                "total": total,
                "success_count": success_count,
                "failed_count": failed_count,
            }, ensure_ascii=False) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "error": f"批量导入过程中发生异常: {str(e)}"}, ensure_ascii=False) + "\n"

    return StreamingResponse(progress_generator(), media_type="application/x-ndjson")


@app.get("/api/admin/gpt-team/records")
async def admin_gpt_team_records(
    authorization: Optional[str] = Header(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=200),
    email: str = Query(""),
    code: str = Query(""),
    team_id: int = Query(0),
    start_date: str = Query(""),
    end_date: str = Query(""),
):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    where = ["1=1"]
    params: List = []
    if email.strip():
        where.append("r.email LIKE ?")
        params.append(f"%{email.strip()}%")
    if code.strip():
        where.append("r.code LIKE ?")
        params.append(f"%{code.strip()}%")
    if team_id:
        where.append("r.team_id = ?")
        params.append(team_id)
    if start_date.strip():
        where.append("substr(r.redeemed_at,1,10) >= ?")
        params.append(start_date.strip())
    if end_date.strip():
        where.append("substr(r.redeemed_at,1,10) <= ?")
        params.append(end_date.strip())

    where_sql = " AND ".join(where)
    all_rows = conn.execute(
        f"""
        SELECT r.*, t.team_name, t.email AS team_email
        FROM gpt_team_usage_records r
        LEFT JOIN gpt_team_accounts t ON r.team_id = t.id
        WHERE {where_sql}
        ORDER BY r.id DESC
        """,
        params,
    ).fetchall()
    records = [
        {
            "id": row["id"],
            "email": row["email"] or "",
            "code": row["code"] or "",
            "teamId": int(row["team_id"] or 0),
            "teamName": row["team_name"] or "",
            "teamEmail": row["team_email"] or "",
            "accountId": row["account_id"] or "",
            "redeemedAt": row["redeemed_at"] or "",
            "isWarrantyRedemption": bool(row["is_warranty_redemption"] or 0),
        }
        for row in all_rows
    ]

    total = len(records)
    now = datetime.now()
    today = now.date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    stats = {"total": total, "today": 0, "thisWeek": 0, "thisMonth": 0}
    for r in records:
        ts = (r.get("redeemedAt") or "").strip()
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", ""))
            d = dt.date()
            if d >= today:
                stats["today"] += 1
            if d >= week_start:
                stats["thisWeek"] += 1
            if d >= month_start:
                stats["thisMonth"] += 1
        except Exception:
            continue

    start = (page - 1) * per_page
    end = start + per_page
    paginated = records[start:end]
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    return {
        "records": paginated,
        "stats": stats,
        "pagination": {
            "currentPage": page,
            "perPage": per_page,
            "total": total,
            "totalPages": total_pages,
        },
    }


@app.post("/api/admin/gpt-team/records")
async def admin_gpt_team_add_record(body: GptTeamRecordCreateRequest, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    if not (body.email or "").strip():
        raise HTTPException(status_code=400, detail="email 不能为空")
    redeemed_at = (body.redeemedAt or "").strip() or (datetime.utcnow().isoformat() + "Z")
    conn = database.get_connection()
    conn.execute(
        """
        INSERT INTO gpt_team_usage_records (email, code, team_id, account_id, redeemed_at, is_warranty_redemption)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            body.email.strip(),
            (body.code or "").strip(),
            int(body.teamId or 0),
            (body.accountId or "").strip(),
            redeemed_at,
            1 if bool(body.isWarrantyRedemption) else 0,
        ),
    )
    conn.commit()
    return {"success": True}


@app.delete("/api/admin/gpt-team/records/{record_id}")
async def admin_gpt_team_delete_record(record_id: int, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    conn.execute("DELETE FROM gpt_team_usage_records WHERE id = ?", (record_id,))
    conn.commit()
    return {"success": True, "id": record_id}


# ============ DOCUMENT CAPTURE ROUTES ============

from document_capture import (
    capture_verification_documents,
    list_captured_submissions,
    get_captured_submission,
    fetch_verification_details
)


@app.get("/api/capture/{verification_id}")
async def capture_documents(verification_id: str):
    """
    Capture documents and metadata for a verification ID
    
    This fetches verification details from SheerID and attempts to
    download any associated documents.
    
    Note: This endpoint doesn't use proxy since it's read-only
    and doesn't need anti-detection measures.
    """
    from verifier import parse_verification_id
    
    parsed_id = parse_verification_id(verification_id)
    if not parsed_id:
        raise HTTPException(status_code=400, detail="Invalid verification ID")
    
    # Don't use proxy for capture - just reading data
    result = capture_verification_documents(parsed_id, proxy=None)
    
    return result


@app.get("/api/captured")
async def list_captures():
    """
    List all captured submissions
    
    Returns a list of all verification IDs that have been captured,
    along with metadata about each capture.
    """
    submissions = list_captured_submissions()
    return {
        "success": True,
        "count": len(submissions),
        "submissions": submissions
    }


@app.get("/api/captured/{verification_id}")
async def get_capture_details(verification_id: str):
    """
    Get details of a specific captured submission
    
    Returns metadata and file paths for a previously captured verification.
    """
    result = get_captured_submission(verification_id)
    
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Not found"))
    
    return result


@app.get("/api/verification-details/{verification_id}")
async def get_verification_details(verification_id: str):
    """
    Get full verification details from SheerID without saving
    
    Useful for inspecting a verification without capturing.
    """
    from verifier import parse_verification_id
    
    parsed_id = parse_verification_id(verification_id)
    if not parsed_id:
        raise HTTPException(status_code=400, detail="Invalid verification ID")
    
    proxy = get_proxy_url()
    details = fetch_verification_details(parsed_id, proxy)
    
    if not details.get("success"):
        raise HTTPException(
            status_code=details.get("status_code", 500),
            detail=details.get("error", "Failed to fetch verification details")
        )
    
    return details



# Telegram Userbot Events
@app.on_event("startup")
async def startup_event():
    global telegram_bot
    import config_manager
    config = config_manager.get_config()

    # Start node health monitor
    try:
        await node_health_monitor.start()
        print("[Startup] Node health monitor started")
    except Exception as e:
        print(f"[Startup] Node health monitor error: {e}")
    
    # Multi-account auto-connect (new system)
    try:
        print("[Startup] Connecting Telegram accounts...")
        result = await asyncio.wait_for(tg_manager.auto_connect(), timeout=30)
        print(f"[Startup] Telegram auto-connect result: {result}")
        # Register old bot (SheerIDUserbot) handler on all pool clients
        if telegram_bot:
            for _acc_id, _client in tg_manager.get_all_clients().items():
                telegram_bot.register_handler(_client)
    except asyncio.TimeoutError:
        print("[Startup] WARNING: Telegram auto-connect timed out after 30s, will continue without it")
    except Exception as e:
        print(f"[Startup] WARNING: Telegram auto-connect failed: {e}")
    
    # Update dual bot config
    dual_config = config.get("verification", {}).get("dualBot", {})
    if dual_config.get("warmupBot"):
        dual_bot.warmup_bot = dual_config["warmupBot"].lstrip("@")
    if dual_config.get("verifyBot"):
        dual_bot.verify_bot = dual_config["verifyBot"].lstrip("@")
    # Sync full config for response rules parsing
    dual_bot.config = dual_config
    
    # Legacy single-account startup (backward compat)
    telegram_config = config.get("verification", {}).get("telegram", {})
    if telegram_config.get("enabled"):
        try:
            api_id = telegram_config.get("apiId")
            api_hash = telegram_config.get("apiHash")
            app_bot_username = telegram_config.get("botUsername") or "@SheerID_Verification_bot"
            
            if api_id and api_hash:
                print(f"[Telegram] Starting legacy Userbot (ID: {api_id})...")
                telegram_bot = SheerIDUserbot(int(api_id), api_hash, bot_username=app_bot_username)
                asyncio.create_task(telegram_bot.start())
            else:
                print("[Telegram] Missing API ID/Hash, skipping startup")
        except Exception as e:
            print(f"[Telegram] Startup failed: {e}")

    # ---- Resume pending GetGem tasks ----
    pending = _load_pending_getgem_tasks()
    if pending:
        # Filter out tasks older than 10 minutes (they've definitely timed out on GetGem side)
        now = _time.time()
        stale_vids = [v for v, t in pending.items() if now - t.get("timestamp", 0) > 600]
        for sv in stale_vids:
            print(f"[GetGem Recovery] Skipping stale task {sv[:8]}... (age > 10min)")
            _remove_pending_getgem_task(sv)
        
        active = {v: t for v, t in pending.items() if v not in stale_vids}
        if active:
            print(f"[Startup] Resuming {len(active)} pending GetGem tasks...")
            for vid, info in active.items():
                asyncio.create_task(_resume_getgem_poll(vid, info["taskId"], info.get("cdk", "")))

    pending_async = _load_pending_async_tasks()
    if pending_async:
        now = _time.time()
        handlers = {
            "pixel": _resume_pending_pixel_task,
            "kpixel": _resume_pending_kpixel_task,
            "vpixel": _resume_pending_vpixel_task,
            "ypixel": _resume_pending_ypixel_task,
            "gpt": _resume_pending_gpt_task,
        }
        print(f"[Startup] Found {len(pending_async)} pending async tasks...")
        for key, info in pending_async.items():
            task_type = info.get("type", "")
            task_id = info.get("task_id", "")
            payload = info.get("payload", {}) or {}
            age = now - info.get("timestamp", 0)
            if age > 7200:
                print(f"[Startup] Dropping stale async task {key} (age > 2h)")
                _remove_pending_async_task(task_type, task_id)
                continue
            if task_type == "pixel":
                _pixel_job_context[task_id] = payload
            elif task_type == "kpixel":
                _kpixel_job_context[str(task_id)] = payload
            elif task_type == "vpixel":
                _vpixel_job_context[task_id] = payload
            elif task_type == "ypixel":
                _ypixel_job_context[task_id] = payload
            handler = handlers.get(task_type)
            if handler:
                asyncio.create_task(handler(task_id, payload))

    # Start email alert monitor
    try:
        start_alert_monitor()
    except Exception as e:
        print(f"[Startup] Alert monitor error: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    if telegram_bot:
        await telegram_bot.stop()
    await tg_manager.disconnect()

def sync_telegram_bot(account_id: str):
    """Sync the global telegram_bot instance with an account from tg_manager"""
    global telegram_bot
    acc = tg_manager._find_account(account_id)
    if not acc or not acc.get("sessionString"):
        return

    try:
        api_id = int(acc["apiId"])
        api_hash = acc["apiHash"]
        session_string = acc["sessionString"]
        
        # We don't call .start() here because tg_manager already connected the client.
        # We just need an instance of SheerIDUserbot that shares the client or session.
        # For simplicity and to avoid side effects, we'll create a new instance 
        # but the connection status check in /api/telegram/status will now look at both.
        
        from telegram_userbot import SheerIDUserbot
        telegram_bot = SheerIDUserbot(api_id, api_hash, session_string=session_string)
        # Mark as connected since tg_manager just activated it
        telegram_bot.is_connected = True 
        print(f"[Telegram] Global Userbot synced with account: {account_id}")
    except Exception as e:
        print(f"[Telegram] Failed to sync global Userbot: {e}")


@app.post("/api/telegram/daily")
async def telegram_daily():
    """Claim daily free credits from SheerID Bot"""
    if not telegram_bot or not telegram_bot.is_connected:
        raise HTTPException(status_code=503, detail="Not connected")
    
    result = await telegram_bot.claim_daily()
    return result


@app.get("/api/telegram/balance")
async def telegram_balance():
    """Check SheerID Bot credit balance"""
    if not telegram_bot or not telegram_bot.is_connected:
        raise HTTPException(status_code=503, detail="Not connected")
    
    result = await telegram_bot.check_balance()
    return result


@app.get("/api/telegram/status")
async def telegram_status():
    """Get Telegram Userbot connection status (supports multi-account)"""
    # Connected if legacy bot is connected OR manager has an active client
    is_bot_connected = telegram_bot is not None and telegram_bot.is_connected
    is_manager_connected = tg_manager.is_connected
    
    connected = is_bot_connected or is_manager_connected
    
    last_daily = telegram_bot._last_daily_claim.isoformat() if telegram_bot and telegram_bot._last_daily_claim else None
    
    return {
        "connected": connected,
        "bot_username": telegram_bot.bot_username if telegram_bot else "SheerID_Verification_bot",
        "last_daily_claim": last_daily,
        "multiAccount": {
            "activeAccountId": tg_manager.active_account_id,
            "managerConnected": is_manager_connected,
        }
    }


@app.post("/api/telegram/reconnect")
async def telegram_reconnect():
    """Manually reconnect all enabled Telegram accounts"""
    result = await tg_manager.auto_connect()
    # Re-register old bot handlers on reconnected pool clients
    if telegram_bot:
        for _acc_id, _client in tg_manager.get_all_clients().items():
            telegram_bot.register_handler(_client)
    return {
        "success": result.get("success", False),
        "connected": tg_manager.is_connected,
        "activeAccountId": tg_manager.active_account_id,
        "message": "重连成功" if result.get("success") else "重连失败，请检查账号配置"
    }


# ========== Telegram Account Management ==========

class TelegramAccountAddRequest(BaseModel):
    apiId: str
    apiHash: str
    label: Optional[str] = ""

class TelegramLoginRequest(BaseModel):
    phone: str

class TelegramVerifyCodeRequest(BaseModel):
    phone: str
    code: str
    phone_code_hash: str
    password: Optional[str] = None


@app.get("/api/telegram/accounts")
async def list_telegram_accounts():
    """List all configured Telegram accounts"""
    return {"accounts": tg_manager.get_accounts()}


@app.post("/api/telegram/accounts/check-connections")
async def check_telegram_connections():
    """Actively check connection status of all Telegram accounts."""
    results = await tg_manager.check_all_connections()
    return {"results": results}


@app.post("/api/telegram/accounts")
async def add_telegram_account(request: TelegramAccountAddRequest):
    """Add a new Telegram account"""
    try:
        api_id = (request.apiId or "").strip()
        api_hash = (request.apiHash or "").strip()
        label = (request.label or "").strip()
        if not api_id or not api_hash:
            raise HTTPException(status_code=400, detail="apiId 和 apiHash 不能为空")
        result = tg_manager.add_account(api_id, api_hash, label)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[TGManager] add account failed")
        raise HTTPException(status_code=500, detail=f"添加账号失败: {e}")


@app.delete("/api/telegram/accounts/{account_id}")
async def remove_telegram_account(account_id: str):
    """Remove a Telegram account"""
    if tg_manager.active_account_id == account_id:
        await tg_manager.disconnect()
    tg_manager.remove_account(account_id)
    return {"success": True}


@app.put("/api/telegram/accounts/{account_id}/toggle")
async def toggle_telegram_account(account_id: str, request: Request):
    """Enable/disable or update bot assignments for a Telegram account."""
    data = await request.json()
    updates = {}
    if "enabled" in data:
        updates["enabled"] = data["enabled"]
    if "assignedBots" in data:
        updates["assignedBots"] = data["assignedBots"]
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    success = tg_manager.update_account(account_id, updates)
    if not success:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"success": True}


@app.post("/api/telegram/accounts/{account_id}/login")
async def telegram_login_request(account_id: str, request: TelegramLoginRequest):
    """Step 1: Send verification code to phone"""
    result = await tg_manager.login_request(account_id, request.phone)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Login failed"))
    return result


@app.post("/api/telegram/accounts/{account_id}/verify")
async def telegram_login_verify(account_id: str, request: TelegramVerifyCodeRequest):
    """Step 2: Submit verification code to complete login"""
    result = await tg_manager.login_verify(
        account_id, request.phone, request.code, request.phone_code_hash, request.password
    )
    if not result.get("success") and not result.get("needs_password"):
        raise HTTPException(status_code=400, detail=result.get("error", "Verification failed"))
    return result


@app.post("/api/telegram/accounts/{account_id}/activate")
async def activate_telegram_account(account_id: str):
    """Switch the active Telegram account"""
    result = await tg_manager.activate(account_id)
    if result.get("success"):
        sync_telegram_bot(account_id)
        # Register old bot handler on the newly activated client
        if telegram_bot and account_id in tg_manager._clients:
            telegram_bot.register_handler(tg_manager._clients[account_id])
    elif not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Activation failed"))
    return result



# ========== Dual Bot Verification ==========

class DualBotVerifyRequest(BaseModel):
    links: List[str]
    cdk: Optional[str] = None


@app.post("/api/verify/dualbot")
async def verify_via_dualbot(request: DualBotVerifyRequest):
    """
    Verify using Dual Bot pipeline with SSE streaming progress:
    @SatsetHelperbot (warmup) → @AutoGeminiProbot (verify) → auto bypass on failure
    """
    if not tg_manager.is_connected:
        raise HTTPException(status_code=503, detail="程序离线，请联系管理员")

    if not request.links:
        raise HTTPException(status_code=400, detail="No verification links provided")

    if len(request.links) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 links per request")

    # Validate CDK (skip for bot-internal requests)
    is_bot_internal = request.cdk == "__BOT_INTERNAL__"
    cdk_check = {"valid": True, "remaining": 999}  # Default for bot-internal

    if not is_bot_internal:
        if not request.cdk:
            raise HTTPException(status_code=400, detail="请提供 CDK 激活码")

        cdk_check = cdk_manager.validate_cdk(request.cdk)
        if not cdk_check["valid"]:
            raise HTTPException(status_code=403, detail=cdk_check["message"])

    clean_links = [link.strip() for link in request.links if link.strip()]
    if not clean_links:
        raise HTTPException(status_code=400, detail="No valid links provided")

    # Validate link format: only accept clean SheerID URLs without extra query params
    import re as _re_val
    clean_url_pattern = r'^https://services\.sheerid\.com/verify/[a-fA-F0-9]+/\?verificationId=[a-fA-F0-9]+$'
    for link in clean_links:
        if not _re_val.match(clean_url_pattern, link):
            raise HTTPException(
                status_code=400,
                detail=f"链接格式错误，请刷新页面获取重新获取链接。注意右击按钮获取！"
            )

    # Pre-check VID status: reject already-failed/expired links before processing
    import httpx as _httpx_pre
    for link in clean_links:
        _vid_m = _re_val.search(r'verificationId=([a-fA-F0-9]+)', link)
        if _vid_m:
            _pre_vid = _vid_m.group(1)
            try:
                async with _httpx_pre.AsyncClient(timeout=10) as _pc:
                    _pr = await _pc.get(f"https://services.sheerid.com/rest/v2/verification/{_pre_vid}")
                    if _pr.status_code == 200:
                        _pd = _pr.json()
                        _ps = _pd.get("currentStep", "")
                        _pe = _pd.get("errorIds", [])
                        _prj = _pd.get("rejectionReasons", [])

                        if _ps == "error":
                            _msg = f"该链接已失败 ({', '.join(_pe) if _pe else '未知错误'})，请刷新页面获取新链接"
                            verification_history.log_verification("failed", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "failed", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "success":
                            _msg = "该链接已验证成功，无需重复提交"
                            verification_history.log_verification("pass", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": True, "status": "approved", "message": _msg, "alreadyVerified": True}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "docUpload" and _prj:
                            _msg = f"该链接已被拒绝 ({', '.join(_prj)})，请刷新页面获取新链接"
                            verification_history.log_verification("failed", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "rejected", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
            except HTTPException:
                raise  # Re-raise HTTP exceptions
            except Exception as _pre_err:
                import logging
                logging.warning(f"VID pre-check failed for {_pre_vid[:8]}: {_pre_err}")

    if not is_bot_internal:
        if cdk_check["remaining"] < len(clean_links):
            raise HTTPException(
                status_code=403,
                detail=f"CDK 额度不足，需要 {len(clean_links)} 次，剩余 {cdk_check['remaining']} 次"
            )

    # Get dual bot config
    import config_manager as cm
    cfg = cm.get_config()
    dual_config = cfg.get("verification", {}).get("dualBot", {})
    auto_bypass = dual_config.get("autoBypass", True)
    warmup_bot = dual_config.get("warmupBot")
    verify_bot = dual_config.get("verifyBot")

    # Extract VIDs for link-to-vid mapping
    import re as re_mod
    def extract_vid(link):
        m = re_mod.search(r'verificationId=([A-Za-z0-9-]+)', link)
        return m.group(1) if m else link[-12:]

    link_vid_map = {link: extract_vid(link) for link in clean_links}

    # Broadcast initial 'submitted' event so Admin page shows immediately
    for link in clean_links:
        vid = link_vid_map.get(link, '')
        broadcast_verify_event({"type": "progress", "link": link, "vid": vid, "step": "submitted", "message": "等待验证..."})

    async def event_stream():
        import json
        
        # Lock to ensure FIFO ordering when all accounts are in cooldown
        cooldown_wait_lock = asyncio.Lock()
        
        async def process_single_link(link_to_verify):
            vid = link_vid_map.get(link_to_verify, "")
            max_retries = dual_config.get("maxRetries", 5)
            verify_timeout = dual_config.get("verifyTimeout", 120)
            
            # VID deduplication: if this VID is already being processed, wait for it
            if vid:
                if vid not in _vid_locks:
                    _vid_locks[vid] = asyncio.Lock()
                vid_lock = _vid_locks[vid]
                
                if vid_lock.locked():
                    # Another request is already processing this VID, wait for it
                    logger.info(f"[Verify] VID {vid[:8]}... already being processed, waiting for result...")
                    async with vid_lock:
                        # Return the cached result from the first request
                        if vid in _vid_results:
                            cached = _vid_results[vid]
                            logger.info(f"[Verify] Returning cached result for {vid[:8]}: {cached.get('status')}")
                            return cached.get('acc_id'), cached.get('result', cached)
                        return None, {"success": False, "status": "error", "message": "Duplicate VID, no result cached"}
            else:
                vid_lock = None
            
            async def on_progress(progress):
                event = {"type": "progress", "link": link_to_verify, "vid": vid, **progress}
                yield_data = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                progress_events.append(yield_data)
                broadcast_verify_event(event)

            lock_ctx = vid_lock if vid_lock else asyncio.Lock()  # fallback
            async with lock_ctx:
              for attempt in range(max_retries):
                pool_item = tg_manager.get_next_client(bot_type="dualbot")
                
                if not pool_item:
                    wait_time = tg_manager.get_shortest_cooldown_wait()
                    if wait_time > 0:
                        logger.info(f"[Verify] All accounts in cooldown, waiting {wait_time:.0f}s...")
                        on_prog_event = {"type": "progress", "link": link_to_verify, "vid": vid, "step": "cooldown_wait", "message": f"等待可用账号 ({int(wait_time)}s)..."}
                        progress_events.append(f"data: {json.dumps(on_prog_event, ensure_ascii=False)}\n\n")
                        async with cooldown_wait_lock:
                            pool_item = tg_manager.get_next_client(bot_type="dualbot")
                            if not pool_item:
                                wait_time = tg_manager.get_shortest_cooldown_wait()
                                if wait_time > 0:
                                    await asyncio.sleep(wait_time + 2)
                                pool_item = tg_manager.get_next_client(bot_type="dualbot")
                    
                    if not pool_item:
                        result = {"success": False, "status": "error", "message": "所有账号冷却中，请稍后重试"}
                        if vid:
                            _vid_results[vid] = {"acc_id": None, "result": result}
                        return None, result
                
                acc_id, client = pool_item
                result = await dual_bot.verify(
                    client=client,
                    link=link_to_verify,
                    account_id=acc_id,
                    warmup_bot=warmup_bot,
                    verify_bot=verify_bot,
                    auto_bypass=auto_bypass,
                    timeout=verify_timeout,
                    on_progress=on_progress
                )
                
                if result.get("status") == "cooldown":
                    logger.info(f"[Verify] Account {acc_id} in cooldown, retrying...")
                    tg_manager.set_cooldown(acc_id, result.get("cooldown_seconds", 90))
                    if result.get("remaining_quota") is not None:
                        tg_manager.update_quota(acc_id, result["remaining_quota"])
                    continue
                
                # Cache result for deduplication
                if vid:
                    _vid_results[vid] = {"acc_id": acc_id, "result": result}
                    # Auto-cleanup after 60s
                    async def cleanup_vid(v):
                        await asyncio.sleep(60)
                        _vid_results.pop(v, None)
                        _vid_locks.pop(v, None)
                    asyncio.create_task(cleanup_vid(vid))
                
                return acc_id, result
              
              result = {"success": False, "status": "error", "message": "所有账号冷却中，请稍后重试"}
              if vid:
                  _vid_results[vid] = {"acc_id": None, "result": result}
              return None, result

        # Shared progress events list (appended by callbacks, consumed by stream)
        progress_events = []
        
        # Wrapper to persist history in task context (survives client disconnect)
        async def process_and_log(link):
            acc_id, r = await process_single_link(link)
            try:
                r_vid = r.get("verificationId", link_vid_map.get(link, ""))
                r_msg = r.get("message", r.get("reason", ""))
                cdk_label = request.cdk if not is_bot_internal else "BOT"
                bot_stats_tracker.record("dualbot", r.get("success", False))
                if r.get("status") == "approved":
                    verification_history.log_verification("pass", r_vid, r_msg, cdk=cdk_label)
                elif not r.get("success") and not r.get("alreadyVerified"):
                    actual_status = r.get("status", "failed")
                    verification_history.log_verification(actual_status, r_vid, r_msg or f"Rejected: {actual_status}", cdk=cdk_label)
            except Exception as hist_err:
                logging.warning(f"[DualBot] Failed to log verification history: {hist_err}")
            return acc_id, r

        # Start all verifications in parallel
        tasks = [asyncio.create_task(process_and_log(link)) for link in clean_links]
        
        # Stream progress events while tasks are running
        while not all(t.done() for t in tasks):
            # Flush any accumulated progress events
            while progress_events:
                yield progress_events.pop(0)
            await asyncio.sleep(0.3)
        
        # Flush remaining progress events
        while progress_events:
            yield progress_events.pop(0)

        # Gather results safely so SSE stream doesn't perish on network exceptions
        paired_results = []
        for t in tasks:
            try:
                paired_results.append(t.result())
            except Exception as e:
                import traceback
                logging.error(f"DualBot Task failed with exception: {traceback.format_exc()}")
                paired_results.append((None, {"success": False, "status": "error", "message": f"系统内部异常: {str(e)}"}))
        
        # Extract results and update quotas
        results = []
        for acc_id, r in paired_results:
            results.append(r)
            if acc_id and r.get("remaining_quota") is not None:
                tg_manager.update_quota(acc_id, r["remaining_quota"])

        # Log and deduct (skip for bot-internal requests)
        successful = sum(1 for r in results if r.get("success") and not r.get("alreadyVerified"))
        cdk_remaining = cdk_check["remaining"] if not is_bot_internal else -1
        if successful > 0 and not is_bot_internal:
            deduct = cdk_manager.use_cdk(request.cdk, successful)
            cdk_remaining = deduct.get("remaining", cdk_remaining)

        cdk_label = request.cdk if not is_bot_internal else "BOT"
        # NOTE: verification_history logging is now done in process_and_log() above
        # so results are persisted even if the SSE stream is cancelled by client disconnect.

        # Send final done event with all results
        done_event = {
            "type": "done",
            "results": results,
            "stats": {
                "total": len(results),
                "approved": successful,
                "failed": sum(1 for r in results if not r.get("success"))
            },
            "cdkRemaining": cdk_remaining
        }
        broadcast_verify_event(done_event)
        yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable Nginx proxy buffering
            "Connection": "keep-alive",
        }
    )


# ========== Unified Multi-Bot Verification ==========

class UnifiedVerifyRequest(BaseModel):
    links: List[str]
    cdk: Optional[str] = None


@app.post("/api/verify/unified")
async def verify_unified(request: UnifiedVerifyRequest):
    """
    Unified multi-bot verification endpoint.
    Round-robin distributes links across ALL enabled bots (DualBot + SingleBots).
    Each link stays with its assigned bot type for retries (only switches accounts).
    """
    import logging
    logger = logging.getLogger(__name__)

    if not tg_manager.is_connected:
        raise HTTPException(status_code=503, detail="程序离线，请联系管理员")

    if not request.links:
        raise HTTPException(status_code=400, detail="No verification links provided")

    if len(request.links) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 links per request")

    # Validate CDK
    is_bot_internal = request.cdk == "__BOT_INTERNAL__"
    cdk_check = {"valid": True, "remaining": 999}

    if not is_bot_internal:
        if not request.cdk:
            raise HTTPException(status_code=400, detail="请提供 CDK 激活码")
        cdk_check = cdk_manager.validate_cdk(request.cdk)
        if not cdk_check["valid"]:
            raise HTTPException(status_code=403, detail=cdk_check["message"])

    clean_links = [link.strip() for link in request.links if link.strip()]
    if not clean_links:
        raise HTTPException(status_code=400, detail="No valid links provided")

    # Validate link format
    import re as _re_u
    clean_url_pattern = r'^https://services\.sheerid\.com/verify/[a-fA-F0-9]+/\?verificationId=[a-fA-F0-9]+$'
    for link in clean_links:
        if not _re_u.match(clean_url_pattern, link):
            raise HTTPException(
                status_code=400,
                detail=f"链接格式错误，请刷新页面获取重新获取链接。注意右击按钮获取！"
            )

    # Pre-check VID status
    import httpx as _httpx_u
    for link in clean_links:
        _vid_m = _re_u.search(r'verificationId=([a-fA-F0-9]+)', link)
        if _vid_m:
            _pre_vid = _vid_m.group(1)
            try:
                async with _httpx_u.AsyncClient(timeout=10) as _pc:
                    _pr = await _pc.get(f"https://services.sheerid.com/rest/v2/verification/{_pre_vid}")
                    if _pr.status_code == 200:
                        _pd = _pr.json()
                        _ps = _pd.get("currentStep", "")
                        _pe = _pd.get("errorIds", [])
                        _prj = _pd.get("rejectionReasons", [])
                        if _ps == "error":
                            _msg = f"该链接已失败 ({', '.join(_pe) if _pe else '未知错误'})，请刷新页面获取新链接"
                            verification_history.log_verification("failed", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "failed", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "success":
                            _msg = "该链接已验证成功，无需重复提交"
                            verification_history.log_verification("pass", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": True, "status": "approved", "message": _msg, "alreadyVerified": True}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "docUpload" and _prj:
                            _msg = f"该链接已被拒绝 ({', '.join(_prj)})，请刷新页面获取新链接"
                            verification_history.log_verification("failed", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "rejected", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
            except HTTPException:
                raise
            except Exception as _pre_err:
                logging.warning(f"VID pre-check failed for {_pre_vid[:8]}: {_pre_err}")

    if not is_bot_internal:
        if cdk_check["remaining"] < len(clean_links):
            raise HTTPException(
                status_code=403,
                detail=f"CDK 额度不足，需要 {len(clean_links)} 次，剩余 {cdk_check['remaining']} 次"
            )

    # ---- Collect all enabled bots ----
    import config_manager as _cm_u
    _cfg_u = _cm_u.get_config()

    enabled_bots = []  # list of {"type": "dualbot"|bot_id, "config": {...}}

    # Check DualBot
    dual_config = _cfg_u.get("verification", {}).get("dualBot", {})
    if dual_config.get("enabled"):
        enabled_bots.append({
            "type": "dualbot",
            "config": dual_config
        })

    # Check SingleBots
    single_bots_cfg = _cfg_u.get("verification", {}).get("singleBots", [])
    for sb in single_bots_cfg:
        if sb.get("enabled"):
            enabled_bots.append({
                "type": sb["id"],
                "config": sb
            })

    if not enabled_bots:
        raise HTTPException(status_code=400, detail="没有启用任何验证 Bot，请在管理后台启用至少一个")

    # ---- Build bot map for probabilistic selection ----
    from node_health_monitor import node_health_monitor as _nhm
    _bot_type_ids = [b["type"] for b in enabled_bots]
    _bot_map = {b["type"]: b for b in enabled_bots}
    logger.info(f"[Route] Enabled bots: {_bot_type_ids}, allocation: {_nhm.get_allocation(_bot_type_ids)}")

    # Extract VIDs
    def _extract_vid_u(link):
        m = _re_u.search(r'verificationId=([A-Za-z0-9-]+)', link)
        return m.group(1) if m else link[-12:]

    link_vid_map = {link: _extract_vid_u(link) for link in clean_links}

    # Broadcast initial 'submitted' event so Admin page shows immediately
    for link in clean_links:
        vid = link_vid_map.get(link, '')
        broadcast_verify_event({"type": "progress", "link": link, "vid": vid, "step": "submitted", "message": "等待验证..."})

    async def event_stream():
        import json
        import time as _time

        # Track which VIDs have received final results (for safety-net in finally)
        _completed_vids = set()
        _all_vids = set(link_vid_map.values())

        cooldown_wait_lock = asyncio.Lock()

        # ---- Client getters for singlebot types (with local cooldown tracking) ----
        def _get_next_client_for_bot(bot_id):
            """Get next available client assigned to a specific bot type, skipping cooldowns."""
            now = _time.time()
            config = _cm_u.get_config()
            accounts = config.get("telegramAccounts", [])

            if bot_id == "dualbot":
                return tg_manager.get_next_client(bot_type="dualbot")

            # SingleBot: use local cooldown tracking
            if bot_id not in _singlebot_cooldowns:
                _singlebot_cooldowns[bot_id] = {}

            valid_ids = []
            for acc in accounts:
                if not acc.get("enabled", True):
                    continue
                assigned = acc.get("assignedBots", [])
                if bot_id not in assigned:
                    continue
                if _singlebot_cooldowns[bot_id].get(acc["id"], 0) > now:
                    continue
                valid_ids.append(acc["id"])

            all_clients = tg_manager.get_all_clients()
            available = [(aid, all_clients[aid]) for aid in valid_ids
                         if aid in all_clients and all_clients[aid].is_connected()]

            if not available:
                return None

            if not hasattr(_get_next_client_for_bot, '_idx'):
                _get_next_client_for_bot._idx = {}
            if bot_id not in _get_next_client_for_bot._idx:
                _get_next_client_for_bot._idx[bot_id] = 0
            _get_next_client_for_bot._idx[bot_id] = (_get_next_client_for_bot._idx[bot_id] + 1) % len(available)
            return available[_get_next_client_for_bot._idx[bot_id]]

        def _get_shortest_cooldown_for_bot(bot_id):
            if bot_id == "dualbot":
                return tg_manager.get_shortest_cooldown_wait()
            now = _time.time()
            if bot_id not in _singlebot_cooldowns:
                return 0
            active = [exp - now for exp in _singlebot_cooldowns[bot_id].values() if exp > now]
            return min(active) if active else 0

        async def process_single_link(link_to_verify):
            """Probabilistic routing: select bot by weighted probability, fallback on non-terminal failure."""
            vid = link_vid_map.get(link_to_verify, "")

            # VID deduplication
            if vid:
                if vid not in _vid_locks:
                    _vid_locks[vid] = asyncio.Lock()
                vid_lock = _vid_locks[vid]

                if vid_lock.locked():
                    logger.info(f"[Route] VID {vid[:8]}... already being processed, waiting...")
                    async with vid_lock:
                        if vid in _vid_results:
                            cached = _vid_results[vid]
                            return cached.get('acc_id'), cached.get('result', cached)
                        return None, {"success": False, "status": "error", "message": "Duplicate VID, no result cached"}
            else:
                vid_lock = None

            lock_ctx = vid_lock if vid_lock else asyncio.Lock()
            last_result = None

            async with lock_ctx:
              # ---- Probabilistic routing: pick bot by weight, fallback on non-terminal failure ----
              remaining_bot_ids = list(_bot_type_ids)  # copy — we remove as we try
              selected_bot_type = _nhm.select_node(remaining_bot_ids)
              logger.info(f"[Route] VID {vid[:8]}... selected bot: {selected_bot_type} (from {remaining_bot_ids})")

              while selected_bot_type and remaining_bot_ids:
                bot_entry = _bot_map[selected_bot_type]
                bot_type = selected_bot_type
                bot_config = bot_entry["config"]
                max_retries = bot_config.get("maxRetries", 5)
                bot_timeout = bot_config.get("verifyTimeout", bot_config.get("timeout", 180))

                # ---- Check if this bot is suspended ----
                suspension_expiry = _bot_suspensions.get(bot_type, 0)
                if suspension_expiry > _time.time():
                    remaining = int(suspension_expiry - _time.time())
                    logger.info(f"[Route:{bot_type}] Bot is SUSPENDED for {remaining}s more, re-selecting...")
                    on_prog_event = {"type": "progress", "link": link_to_verify, "vid": vid, "botType": bot_type,
                                     "step": "suspended", "message": f"节点暂停中，切换下一个..."}
                    user_event = {k: v for k, v in on_prog_event.items() if k != "botType"}
                    progress_events.append(f"data: {json.dumps(user_event, ensure_ascii=False)}\n\n")
                    broadcast_verify_event(on_prog_event)
                    # Remove and re-select
                    remaining_bot_ids = [b for b in remaining_bot_ids if b != bot_type]
                    selected_bot_type = _nhm.select_node(remaining_bot_ids) if remaining_bot_ids else None
                    logger.info(f"[Route] Re-selected bot: {selected_bot_type} (remaining: {remaining_bot_ids})")
                    continue

                async def on_progress(progress, _bt=bot_type):
                    event = {"type": "progress", "link": link_to_verify, "vid": vid, "botType": _bt, **progress}
                    user_event = {k: v for k, v in event.items() if k != "botType"}
                    progress_events.append(f"data: {json.dumps(user_event, ensure_ascii=False)}\n\n")
                    broadcast_verify_event(event)

                # Create verifier for singlebots
                single_verifier = None
                if bot_type != "dualbot":
                    single_verifier = GenericSingleBotVerifier(bot_config)

                bot_succeeded = False
                should_reselect = False
                for attempt in range(max_retries):
                    pool_item = _get_next_client_for_bot(bot_type)

                    if not pool_item:
                        # No accounts available — check if we can re-select another bot
                        if len(remaining_bot_ids) > 1:
                            logger.info(f"[Route:{bot_type}] No accounts available, re-selecting another bot...")
                            should_reselect = True
                            break
                        
                        # Last bot: wait for cooldown
                        wait_time = _get_shortest_cooldown_for_bot(bot_type)
                        if wait_time > 0:
                            logger.info(f"[Route:{bot_type}] Last available bot, waiting {wait_time:.0f}s for cooldown...")
                            on_prog_event = {"type": "progress", "link": link_to_verify, "vid": vid, "botType": bot_type,
                                             "step": "cooldown_wait", "message": f"排队中..."}
                            progress_events.append(f"data: {json.dumps(on_prog_event, ensure_ascii=False)}\n\n")
                            broadcast_verify_event(on_prog_event)
                            async with cooldown_wait_lock:
                                pool_item = _get_next_client_for_bot(bot_type)
                                if not pool_item:
                                    wait_time = _get_shortest_cooldown_for_bot(bot_type)
                                    if wait_time > 0:
                                        await asyncio.sleep(wait_time + 2)
                                    pool_item = _get_next_client_for_bot(bot_type)

                        if not pool_item:
                            logger.info(f"[Route:{bot_type}] No accounts available after wait, re-selecting...")
                            should_reselect = True
                            break

                    acc_id, client = pool_item

                    # ---- Dispatch to the correct verifier ----
                    if bot_type == "dualbot":
                        result = await dual_bot.verify(
                            client=client,
                            link=link_to_verify,
                            account_id=acc_id,
                            warmup_bot=bot_config.get("warmupBot"),
                            verify_bot=bot_config.get("verifyBot"),
                            auto_bypass=bot_config.get("autoBypass", True),
                            timeout=bot_timeout,
                            on_progress=on_progress
                        )
                    else:
                        result = await single_verifier.verify(
                            client=client,
                            link=link_to_verify,
                            account_id=acc_id,
                            timeout=bot_timeout,
                            on_progress=on_progress
                        )

                    # Handle cooldown → retry ONLY if warmup-stage cooldown (link NOT consumed)
                    if result.get("status") == "cooldown":
                        cd_seconds = result.get("cooldown_seconds", 90)
                        if bot_type == "dualbot":
                            tg_manager.set_cooldown(acc_id, cd_seconds)
                        else:
                            _singlebot_cooldowns[bot_type][acc_id] = _time.time() + cd_seconds
                        if result.get("remaining_quota") is not None:
                            tg_manager.update_quota(acc_id, result["remaining_quota"])

                        if result.get("cooldown_stage") == "verify":
                            logger.warning(f"[Route:{bot_type}] Account {acc_id} cooldown at VERIFY stage — link consumed, stopping")
                            last_result = (acc_id, result)
                            bot_succeeded = True
                            break

                        logger.info(f"[Route:{bot_type}] Account {acc_id} cooldown at warmup stage, retrying with another account...")
                        continue

                    # Record stats for this bot
                    bot_stats_tracker.record(bot_type, result.get("success", False))
                    last_result = (acc_id, result)

                    # ---- Check suspension rules BEFORE returning result ----
                    suspension_rules = bot_config.get("suspensionRules", [])
                    result_raw = result.get("raw_response", result.get("message", ""))
                    for srule in suspension_rules:
                        suspend_seconds = srule.get("duration", 300)
                        should_suspend = False
                        if result_raw and any(k.lower() in result_raw.lower() for k in srule.get("keywords", [])):
                            should_suspend = True
                        
                        if should_suspend:
                            _bot_suspensions[bot_type] = _time.time() + suspend_seconds
                            logger.warning(f"[Route:{bot_type}] SUSPENDED for {suspend_seconds}s! Rule matched: {srule.get('keywords')}")
                            broadcast_verify_event({
                                "type": "bot_suspended",
                                "botType": bot_type,
                                "duration": suspend_seconds,
                                "reason": f"Rule matched: {srule.get('keywords')}",
                                "message": result_raw[:100] if result_raw else ""
                            })
                            bot_succeeded = False
                            should_reselect = True
                            break
                    
                    # If suspension triggered, re-select another bot
                    if _bot_suspensions.get(bot_type, 0) > _time.time():
                        should_reselect = True
                        break

                    if result.get("success"):
                        bot_succeeded = True
                        break

                    if result.get("status") == "no_credits":
                        logger.info(f"[Route] {bot_type} has no credits, re-selecting another bot...")
                        should_reselect = True
                        break

                    if result.get("status") in ("failed", "rejected", "error"):
                        # Terminal result — do NOT re-select; return as-is
                        logger.info(f"[Route] {bot_type} returned terminal result: {result.get('status')}")
                        bot_succeeded = True
                        break

                    # Other statuses — return as-is
                    bot_succeeded = True
                    break

                if bot_succeeded:
                    break  # exit the while loop

                if should_reselect:
                    # Remove current bot and probabilistically pick another
                    remaining_bot_ids = [b for b in remaining_bot_ids if b != bot_type]
                    selected_bot_type = _nhm.select_node(remaining_bot_ids) if remaining_bot_ids else None
                    logger.info(f"[Route] Re-selected bot: {selected_bot_type} (remaining: {remaining_bot_ids})")
                    continue
                else:
                    break  # exhausted retries for this bot, no re-select

              # Cache final result for deduplication
              if last_result and vid:
                  _vid_results[vid] = {"acc_id": last_result[0], "result": last_result[1]}
                  async def cleanup_vid(v):
                      await asyncio.sleep(60)
                      _vid_results.pop(v, None)
                      _vid_locks.pop(v, None)
                  asyncio.create_task(cleanup_vid(vid))

              if last_result:
                  return last_result

              result = {"success": False, "status": "error", "message": "所有 Bot 均无法完成验证"}
              if vid:
                  _vid_results[vid] = {"acc_id": None, "result": result}
              return None, result

        progress_events = []

        async def process_and_emit(link):
            """Wrapper: run process_single_link and emit per-link result immediately.
            Also logs to verification_history here (not in generator) so results survive client disconnect."""
            vid = link_vid_map.get(link, "")
            try:
                result = await process_single_link(link)
                acc_id, r = result if result else (None, {"success": False, "status": "error", "message": "系统内部异常"})
            except Exception as exc:
                import traceback
                logging.error(f"[Unified] process_single_link exception: {traceback.format_exc()}")
                acc_id = None
                r = {"success": False, "status": "error", "message": f"验证出错: {str(exc)}"}
                result = (acc_id, r)

            # Mark this VID as completed
            if vid:
                _completed_vids.add(vid)

            # Persist to verification_history immediately (survives client disconnect)
            try:
                r_vid = r.get("verificationId", vid)
                r_msg = r.get("message", r.get("reason", ""))
                r_via = r.get("botType", "bot")
                cdk_label = request.cdk if not is_bot_internal else "BOT"
                if r.get("status") == "approved":
                    verification_history.log_verification("pass", r_vid, r_msg, cdk=cdk_label, via=f"bot:{r_via}")
                elif not r.get("success") and not r.get("alreadyVerified"):
                    actual_status = r.get("status", "failed")
                    verification_history.log_verification(actual_status, r_vid, r_msg or f"Rejected: {actual_status}", cdk=cdk_label, via=f"bot:{r_via}")
            except Exception as hist_err:
                logging.warning(f"[Unified] Failed to log verification history: {hist_err}")

            # Emit per-link result event immediately (always, including errors)
            link_result_event = {
                "type": "progress", "link": link, "vid": vid,
                "step": "result",
                "success": r.get("success", False),
                "status": r.get("status", "error"),
                "message": r.get("message", ""),
                "interMsg": r.get("interMsg", ""),
                "claimLink": r.get("claimLink"),
            }
            progress_events.append(f"data: {json.dumps(link_result_event, ensure_ascii=False)}\n\n")
            broadcast_verify_event(link_result_event)
            return result

        try:
            tasks = [asyncio.create_task(process_and_emit(link)) for link in clean_links]

            while not all(t.done() for t in tasks):
                while progress_events:
                    yield progress_events.pop(0)
                await asyncio.sleep(0.3)

            while progress_events:
                yield progress_events.pop(0)

            # Collect results safely
            paired_results = []
            for t in tasks:
                try:
                    paired_results.append(t.result())
                except Exception as e:
                    import traceback
                    logging.error(f"Unified task failed: {traceback.format_exc()}")
                    paired_results.append((None, {"success": False, "status": "error", "message": f"系统内部异常: {str(e)}"}))

            results = []
            for acc_id, r in paired_results:
                results.append(r)
                if acc_id and r.get("remaining_quota") is not None:
                    tg_manager.update_quota(acc_id, r["remaining_quota"])

            # Log and deduct CDK
            successful = sum(1 for r in results if r.get("success") and not r.get("alreadyVerified"))
            cdk_remaining = cdk_check["remaining"] if not is_bot_internal else -1
            if successful > 0 and not is_bot_internal:
                deduct = cdk_manager.use_cdk(request.cdk, successful)
                cdk_remaining = deduct.get("remaining", cdk_remaining)

            cdk_label = request.cdk if not is_bot_internal else "BOT"
            # NOTE: verification_history logging is now done in process_and_emit() above
            # so results are persisted even if the SSE stream is cancelled by client disconnect.

            # ---- Delayed recheck: for timeout/error results, check SheerID after 2 minutes ----
            failed_vids = [r.get("verificationId") for r in results 
                           if not r.get("success") and r.get("verificationId") 
                           and r.get("status") in ("timeout", "error")
                           and not r.get("alreadyVerified")]
            
            if failed_vids and not is_bot_internal:
                async def _delayed_recheck(_vids, _cdk_code, _cdk_label):
                    await asyncio.sleep(120)  # Wait 2 minutes
                    import httpx
                    recheck_success = 0
                    for vid in _vids:
                        try:
                            async with httpx.AsyncClient(timeout=10) as http_client:
                                resp = await http_client.get(f"https://services.sheerid.com/rest/v2/verification/{vid}")
                                if resp.status_code == 200:
                                    step = resp.json().get("currentStep", "")
                                    if step == "success":
                                        recheck_success += 1
                                        logger.info(f"[DelayedRecheck] VID {vid[:12]} actually SUCCEEDED! Deducting CDK.")
                                        verification_history.log_verification("pass", vid, "延迟复查：验证实际已通过", cdk=_cdk_label)
                                        broadcast_verify_event({
                                            "type": "recheck_success",
                                            "vid": vid,
                                            "message": "延迟复查发现验证已通过"
                                        })
                        except Exception as e:
                            logger.warning(f"[DelayedRecheck] Error checking {vid[:12]}: {e}")
                    
                    if recheck_success > 0:
                        deduct = cdk_manager.use_cdk(_cdk_code, recheck_success)
                        logger.info(f"[DelayedRecheck] Deducted {recheck_success} CDK credits. Remaining: {deduct.get('remaining', '?')}")
                
                asyncio.create_task(_delayed_recheck(failed_vids, request.cdk, cdk_label))

            done_event = {
                "type": "done",
                "results": results,
                "stats": {
                    "total": len(results),
                    "approved": successful,
                    "failed": sum(1 for r in results if not r.get("success"))
                },
                "cdkRemaining": cdk_remaining
            }
            broadcast_verify_event(done_event)
            # Strip botType from user-facing SSE stream
            user_results = [{k: v for k, v in r.items() if k != "botType"} for r in results]
            user_done = {**done_event, "results": user_results}
            yield f"data: {json.dumps(user_done, ensure_ascii=False)}\n\n"

        except Exception as gen_err:
            logging.error(f"[Unified] event_stream generator crashed: {gen_err}")
            raise
        finally:
            # ---- Safety net: broadcast failure for any VIDs that got 'submitted' but never got a result ----
            orphaned_vids = _all_vids - _completed_vids
            if orphaned_vids:
                logging.warning(f"[Unified] Safety net: {len(orphaned_vids)} orphaned VIDs, broadcasting failure events")
                for vid in orphaned_vids:
                    fail_event = {
                        "type": "progress", "vid": vid,
                        "step": "result",
                        "success": False,
                        "status": "error",
                        "message": "验证异常终止",
                    }
                    broadcast_verify_event(fail_event)
                # Also broadcast a done event for orphaned VIDs
                broadcast_verify_event({
                    "type": "done",
                    "results": [{"verificationId": vid, "success": False, "status": "error", "message": "验证异常终止"} for vid in orphaned_vids],
                    "stats": {"total": len(orphaned_vids), "approved": 0, "failed": len(orphaned_vids)}
                })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


# ========== Bot Stats API ==========

@app.get("/api/bot-stats")
async def get_bot_stats():
    """Get real-time success rate stats for all bots (1-hour sliding window)."""
    import config_manager as _cm_bs
    _cfg_bs = _cm_bs.get_config()

    stats = bot_stats_tracker.get_all_stats()

    # Merge with config info (costPerVerify, name)
    bot_info = []

    dual_config = _cfg_bs.get("verification", {}).get("dualBot", {})
    if dual_config.get("enabled"):
        s = stats.get("dualbot", {"total": 0, "success": 0, "failed": 0, "rate": 0.5})
        cost = dual_config.get("costPerVerify", 1.0)
        bot_info.append({
            "id": "dualbot",
            "name": "DualBot",
            "costPerVerify": cost,
            "expectedCost": round(cost / max(s["rate"], 0.01), 2),
            **s
        })

    for sb in _cfg_bs.get("verification", {}).get("singleBots", []):
        if sb.get("enabled"):
            s = stats.get(sb["id"], {"total": 0, "success": 0, "failed": 0, "rate": 0.5})
            cost = sb.get("costPerVerify", 1.0)
            bot_info.append({
                "id": sb["id"],
                "name": sb.get("name", sb["id"]),
                "costPerVerify": cost,
                "expectedCost": round(cost / max(s["rate"], 0.01), 2),
                **s
            })

    # Sort by expectedCost ascending (same order used for waterfall)
    bot_info.sort(key=lambda b: b["expectedCost"])

    return {"bots": bot_info, "windowMinutes": bot_stats_tracker.window_minutes}


class BotStatsWindowRequest(BaseModel):
    windowMinutes: int


@app.post("/api/bot-stats/window")
async def set_bot_stats_window(request: BotStatsWindowRequest):
    """Update the sliding window duration for bot stats tracking."""
    bot_stats_tracker.set_window(request.windowMinutes)
    return {"windowMinutes": bot_stats_tracker.window_minutes}


# ========== Single Bot Verification ==========

class SingleBotVerifyRequest(BaseModel):
    botId: str
    links: List[str]
    cdk: Optional[str] = None


@app.post("/api/verify/blackbot")
async def verify_via_blackbot_shim(request: Request):
    # Backward compatibility shim for older frontends or clients
    body = await request.json()
    req = SingleBotVerifyRequest(
        botId="blackbot",
        links=body.get("links", []),
        cdk=body.get("cdk")
    )
    return await verify_via_singlebot(req)


@app.post("/api/verify/singlebot")
async def verify_via_singlebot(request: SingleBotVerifyRequest):
    """
    Verify using any configured single-bot via GenericSingleBotVerifier.
    Supports SSE streaming progress.
    """
    if not tg_manager.is_connected:
        raise HTTPException(status_code=503, detail="程序离线，请联系管理员")

    if not request.links:
        raise HTTPException(status_code=400, detail="No verification links provided")

    if len(request.links) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 links per request")

    # Validate CDK (skip for bot-internal requests)
    is_bot_internal = request.cdk == "__BOT_INTERNAL__"
    cdk_check = {"valid": True, "remaining": 999}

    if not is_bot_internal:
        if not request.cdk:
            raise HTTPException(status_code=400, detail="请提供 CDK 激活码")
        cdk_check = cdk_manager.validate_cdk(request.cdk)
        if not cdk_check["valid"]:
            raise HTTPException(status_code=403, detail=cdk_check["message"])

    clean_links = [link.strip() for link in request.links if link.strip()]
    if not clean_links:
        raise HTTPException(status_code=400, detail="No valid links provided")

    # Validate link format
    import re as _re_bb
    clean_url_pattern = r'^https://services\.sheerid\.com/verify/[a-fA-F0-9]+/\?verificationId=[a-fA-F0-9]+$'
    for link in clean_links:
        if not _re_bb.match(clean_url_pattern, link):
            raise HTTPException(
                status_code=400,
                detail=f"链接格式错误，请刷新页面获取重新获取链接。注意右击按钮获取！"
            )

    # Pre-check VID status
    import httpx as _httpx_bb
    for link in clean_links:
        _vid_m = _re_bb.search(r'verificationId=([a-fA-F0-9]+)', link)
        if _vid_m:
            _pre_vid = _vid_m.group(1)
            try:
                async with _httpx_bb.AsyncClient(timeout=10) as _pc:
                    _pr = await _pc.get(f"https://services.sheerid.com/rest/v2/verification/{_pre_vid}")
                    if _pr.status_code == 200:
                        _pd = _pr.json()
                        _ps = _pd.get("currentStep", "")
                        _pe = _pd.get("errorIds", [])
                        _prj = _pd.get("rejectionReasons", [])

                        if _ps == "error":
                            _msg = f"该链接已失败 ({', '.join(_pe) if _pe else '未知错误'})，请刷新页面获取新链接"
                            verification_history.log_verification("failed", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "failed", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "success":
                            _msg = "该链接已验证成功，无需重复提交"
                            verification_history.log_verification("pass", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": True, "status": "approved", "message": _msg, "alreadyVerified": True}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "docUpload" and _prj:
                            _msg = f"该链接已被拒绝 ({', '.join(_prj)})，请刷新页面获取新链接"
                            verification_history.log_verification("failed", _pre_vid, _msg, cdk=request.cdk or "")
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "rejected", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
            except HTTPException:
                raise
            except Exception as _pre_err:
                import logging
                logging.warning(f"[SingleBot] VID pre-check failed for {_pre_vid[:8]}: {_pre_err}")

    if not is_bot_internal:
        if cdk_check["remaining"] < len(clean_links):
            raise HTTPException(
                status_code=403,
                detail=f"CDK 额度不足，需要 {len(clean_links)} 次，剩余 {cdk_check['remaining']} 次"
            )

    # Load bot configuration
    import config_manager as _cm_bb
    _cfg_bb = _cm_bb.get_config()
    single_bots = _cfg_bb.get("verification", {}).get("singleBots", [])
    
    bot_config = next((b for b in single_bots if b.get("id") == request.botId), None)
    if not bot_config:
        # Fallback to singlebots from telegram or legacy blackbot config if missing
        if request.botId == "blackbot":
            from_legacy = _cfg_bb.get("verification", {}).get("blackBot", {})
            bot_config = {
                "id": "blackbot",
                "username": from_legacy.get("botUsername", "Black_Verifier"),
                "autoBypass": from_legacy.get("autoBypass", True)
            }
        else:
            raise HTTPException(status_code=400, detail=f"未找到该单 Bot 验证配置 ({request.botId})")

    # Instantiate the generic verifier with the configuration
    single_verifier = GenericSingleBotVerifier(bot_config)
    
    import re as re_mod_bb
    def extract_vid_bb(link):
        m = re_mod_bb.search(r'verificationId=([A-Za-z0-9-]+)', link)
        return m.group(1) if m else link[-12:]

    link_vid_map = {link: extract_vid_bb(link) for link in clean_links}
    
    # Initialize bot cooldown tracking map if not exists
    if request.botId not in _singlebot_cooldowns:
        _singlebot_cooldowns[request.botId] = {}

    async def event_stream():
        import json
        import time as _time

        cooldown_wait_lock = asyncio.Lock()

        def _get_next_singlebot_client():
            """Get next available client assigned to this specific botId, skipping cooldowns."""
            now = _time.time()
            config = _cm_bb.get_config()
            accounts = config.get("telegramAccounts", [])

            valid_ids = []
            for acc in accounts:
                if not acc.get("enabled", True):
                    continue
                assigned = acc.get("assignedBots", [])
                if request.botId not in assigned:
                    continue
                if _singlebot_cooldowns[request.botId].get(acc["id"], 0) > now:
                    continue
                valid_ids.append(acc["id"])

            all_clients = tg_manager.get_all_clients()
            available = [(aid, all_clients[aid]) for aid in valid_ids
                         if aid in all_clients and all_clients[aid].is_connected()]

            if not available:
                return None

            if not hasattr(_get_next_singlebot_client, '_idx'):
                _get_next_singlebot_client._idx = 0
            _get_next_singlebot_client._idx = (_get_next_singlebot_client._idx + 1) % len(available)
            return available[_get_next_singlebot_client._idx]

        def _get_shortest_singlebot_cooldown():
            now = _time.time()
            active = [exp - now for exp in _singlebot_cooldowns[request.botId].values() if exp > now]
            return min(active) if active else 0

        async def process_single_link(link_to_verify):
            vid = link_vid_map.get(link_to_verify, "")
            max_retries = bot_config.get("maxRetries", 5)
            bot_timeout = bot_config.get("timeout", 180)

            # VID deduplication
            if vid:
                if vid not in _vid_locks:
                    _vid_locks[vid] = asyncio.Lock()
                vid_lock = _vid_locks[vid]

                if vid_lock.locked():
                    logger.info(f"[SingleBot] VID {vid[:8]}... already being processed, waiting...")
                    async with vid_lock:
                        if vid in _vid_results:
                            cached = _vid_results[vid]
                            return cached.get('acc_id'), cached.get('result', cached)
                        return None, {"success": False, "status": "error", "message": "Duplicate VID, no result cached"}
            else:
                vid_lock = None

            async def on_progress(progress):
                event = {"type": "progress", "link": link_to_verify, "vid": vid, **progress}
                progress_events.append(f"data: {json.dumps(event, ensure_ascii=False)}\n\n")
                broadcast_verify_event(event)

            lock_ctx = vid_lock if vid_lock else asyncio.Lock()
            async with lock_ctx:
              for attempt in range(max_retries):
                pool_item = _get_next_singlebot_client()

                if not pool_item:
                    wait_time = _get_shortest_singlebot_cooldown()
                    if wait_time > 0:
                        logger.info(f"[SingleBot] All accounts in cooldown, waiting {wait_time:.0f}s...")
                        on_prog_event = {"type": "progress", "link": link_to_verify, "vid": vid, "step": "cooldown_wait", "message": f"等待可用账号 ({int(wait_time)}s)..."}
                        progress_events.append(f"data: {json.dumps(on_prog_event, ensure_ascii=False)}\n\n")
                        broadcast_verify_event(on_prog_event)
                        async with cooldown_wait_lock:
                            pool_item = _get_next_singlebot_client()
                            if not pool_item:
                                wait_time = _get_shortest_singlebot_cooldown()
                                if wait_time > 0:
                                    await asyncio.sleep(wait_time + 2)
                                pool_item = _get_next_singlebot_client()

                    if not pool_item:
                        result = {"success": False, "status": "error", "message": "所有账号冷却中，请稍后重试"}
                        if vid:
                            _vid_results[vid] = {"acc_id": None, "result": result}
                        return None, result

                acc_id, client = pool_item
                result = await single_verifier.verify(
                    client=client,
                    link=link_to_verify,
                    account_id=acc_id,
                    timeout=bot_timeout,
                    on_progress=on_progress
                )

                if result.get("status") == "cooldown":
                    logger.info(f"[SingleBot] Account {acc_id} in cooldown, retrying...")
                    _singlebot_cooldowns[request.botId][acc_id] = _time.time() + result.get("cooldown_seconds", 90)
                    continue

                # Cache result for deduplication
                if vid:
                    _vid_results[vid] = {"acc_id": acc_id, "result": result}
                    async def cleanup_vid(v):
                        await asyncio.sleep(60)
                        _vid_results.pop(v, None)
                        _vid_locks.pop(v, None)
                    asyncio.create_task(cleanup_vid(vid))

                return acc_id, result

              result = {"success": False, "status": "error", "message": "所有账号冷却中，请稍后重试"}
              if vid:
                  _vid_results[vid] = {"acc_id": None, "result": result}
              return None, result

        progress_events = []
        tasks = [asyncio.create_task(process_single_link(link)) for link in clean_links]

        while not all(t.done() for t in tasks):
            while progress_events:
                yield progress_events.pop(0)
            await asyncio.sleep(0.3)

        while progress_events:
            yield progress_events.pop(0)

        # Collect results and handle exceptions gracefully so SSE doesn't perish
        paired_results = []
        for t in tasks:
            try:
                paired_results.append(t.result())
            except Exception as e:
                import traceback
                logging.error(f"Task failed with exception: {traceback.format_exc()}")
                paired_results.append((None, {"success": False, "status": "error", "message": f"系统内部异常: {str(e)}"}))

        results = []
        for acc_id, r in paired_results:
            results.append(r)

        # Log and deduct
        successful = sum(1 for r in results if r.get("success") and not r.get("alreadyVerified"))
        cdk_remaining = cdk_check["remaining"] if not is_bot_internal else -1
        if successful > 0 and not is_bot_internal:
            deduct = cdk_manager.use_cdk(request.cdk, successful)
            cdk_remaining = deduct.get("remaining", cdk_remaining)

        cdk_label = request.cdk if not is_bot_internal else "BOT"
        for r in results:
            vid = r.get("verificationId", "")
            msg = r.get("message", r.get("reason", ""))
            # Record stats for this bot type
            bot_stats_tracker.record(request.botId, r.get("success", False))
            if r.get("status") == "approved":
                verification_history.log_verification("pass", vid, msg, cdk=cdk_label)
            elif not r.get("success") and not r.get("alreadyVerified"):
                actual_status = r.get("status", "failed")
                verification_history.log_verification(actual_status, vid, msg or f"Rejected: {actual_status}", cdk=cdk_label)

        done_event = {
            "type": "done",
            "results": results,
            "stats": {
                "total": len(results),
                "approved": successful,
                "failed": sum(1 for r in results if not r.get("success"))
            },
            "cdkRemaining": cdk_remaining
        }
        broadcast_verify_event(done_event)
        yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


# ========== Telegram Bot Admin API ==========

def _verify_admin_token(authorization: Optional[str]):
    """Verify admin token from Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization required")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

@app.get("/api/admin/bot-config")
async def get_bot_config(authorization: Optional[str] = Header(None)):
    """Get Telegram bot configuration."""
    _verify_admin_token(authorization)
    import crypto_service
    config = crypto_service.load_bot_config()
    return config

@app.post("/api/admin/bot-config")
async def update_bot_config(request: Request, authorization: Optional[str] = Header(None)):
    """Update Telegram bot configuration."""
    _verify_admin_token(authorization)
    import crypto_service
    body = await request.json()
    config = crypto_service.load_bot_config()
    config.update(body)
    crypto_service.save_bot_config(config)
    return {"success": True, "config": config}

@app.get("/api/admin/bot-stats")
async def get_bot_stats(authorization: Optional[str] = Header(None)):
    """Get Telegram bot aggregate statistics."""
    _verify_admin_token(authorization)
    import bot_data
    stats = bot_data.get_stats()
    
    try:
        import verification_history
        import cdk_manager
        
        # Calculate real verifications (excluding auto-generated and empty VIDs) using SQLite
        import database
        conn = database.get_connection()
        
        # Total real verifications (non-empty, non-auto VIDs)
        row = conn.execute(
            "SELECT COUNT(*) as total, SUM(CASE WHEN status='pass' THEN 1 ELSE 0 END) as success "
            "FROM verification_history WHERE verification_id != '' AND verification_id NOT LIKE 'auto-%'"
        ).fetchone()
        total_real_attempts = row["total"]
        total_real_success = row["success"] or 0
        
        # 1-hour success rate
        from datetime import datetime, timedelta, timezone
        one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        row_1h = conn.execute(
            "SELECT COUNT(*) as total, SUM(CASE WHEN status='pass' THEN 1 ELSE 0 END) as success "
            "FROM verification_history WHERE verification_id != '' AND verification_id NOT LIKE 'auto-%' AND timestamp >= ?",
            (one_hour_ago,)
        ).fetchone()
        recent_1h_attempts = row_1h["total"]
        recent_1h_success = row_1h["success"] or 0
        hourly_success_rate = round((recent_1h_success / recent_1h_attempts) * 100, 2) if recent_1h_attempts > 0 else 0
        
        # 5-hour success rate
        five_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
        row_5h = conn.execute(
            "SELECT COUNT(*) as total, SUM(CASE WHEN status='pass' THEN 1 ELSE 0 END) as success "
            "FROM verification_history WHERE verification_id != '' AND verification_id NOT LIKE 'auto-%' AND timestamp >= ?",
            (five_hours_ago,)
        ).fetchone()
        recent_5h_attempts = row_5h["total"]
        recent_5h_success = row_5h["success"] or 0
        five_hour_success_rate = round((recent_5h_success / recent_5h_attempts) * 100, 2) if recent_5h_attempts > 0 else 0
            
        # Bot credits consumed (local)
        bot_spent = stats.get("total_spent_credits", 0)
        
        # CDK consumed (API)
        cdk_stats = cdk_manager.get_cdk_stats()
        api_cdk_used = cdk_stats.get("totalUsed", 0)
        
        stats["site_total_success"] = total_real_success
        stats["site_1h_success_rate"] = hourly_success_rate
        stats["site_5h_success_rate"] = five_hour_success_rate
        stats["site_cdk_api"] = api_cdk_used
        stats["site_cdk_local"] = bot_spent
    except Exception as e:
        print(f"[Admin] Error adding site stats: {e}")
        
    return stats

@app.post("/api/admin/reset-overview-stats")
async def reset_overview_stats(authorization: Optional[str] = Header(None)):
    """Reset all overview statistics (verification history + bot stats)."""
    _verify_admin_token(authorization)
    import verification_history
    deleted = verification_history.clear_history()
    # Also clear bot_stats sliding window
    for bot_id in list(bot_stats_tracker._records.keys()):
        bot_stats_tracker.clear(bot_id)
    return {"ok": True, "deleted": deleted}

@app.get("/api/admin/bot-orders")
async def get_bot_orders(authorization: Optional[str] = Header(None)):
    """Get all bot crypto payment orders."""
    _verify_admin_token(authorization)
    import bot_data
    orders = bot_data.get_all_orders()
    orders.sort(key=lambda o: o.get("created_at", ""), reverse=True)
    return {"orders": orders}

@app.get("/api/admin/bot-verify-log")
async def get_bot_verify_log(
    authorization: Optional[str] = Header(None),
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=500),
):
    """Get paginated bot verification log entries."""
    _verify_admin_token(authorization)
    import bot_verify_log
    return bot_verify_log.get_paginated(page=page, page_size=pageSize)


@app.get("/api/admin/verify-stream")
async def admin_verify_stream(request: Request, authorization: Optional[str] = Query(None)):
    """SSE endpoint for real-time verification progress in Admin dashboard."""
    # Verify admin token from query param (EventSource can't set headers)
    if authorization:
        token = authorization.replace("Bearer ", "")
        user = auth.verify_token(token)
        if not user or user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")

    import json as _json_sse

    queue = asyncio.Queue()
    _admin_sse_subscribers.append(queue)

    async def event_generator():
        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {_json_sse.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive ping
                    yield f": keepalive\n\n"
        finally:
            _admin_sse_subscribers.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


@app.get("/api/user/verify-stream")
async def user_verify_stream(request: Request, authorization: Optional[str] = Query(None)):
    """SSE endpoint for the logged-in user's own verification progress."""
    if not authorization:
        raise HTTPException(status_code=401, detail="请先登录")

    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期")

    user_id = int(user.get("id") or 0)
    if not user_id:
        raise HTTPException(status_code=401, detail="登录已过期")

    import json as _json_sse

    queue = asyncio.Queue()
    _user_sse_subscribers.setdefault(user_id, []).append(queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {_json_sse.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            subscribers = _user_sse_subscribers.get(user_id) or []
            with contextlib.suppress(ValueError):
                subscribers.remove(queue)
            if not subscribers:
                _user_sse_subscribers.pop(user_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )

@app.get("/api/admin/bot-users")
async def get_bot_users(authorization: Optional[str] = Header(None)):
    """Get all Telegram bot users."""
    _verify_admin_token(authorization)
    import bot_data
    users = bot_data.get_all_users()
    users.sort(key=lambda u: u.get("created_at", ""), reverse=True)
    return {"users": users}


@app.post("/api/admin/bot-confirm-order")
async def confirm_bot_order(request: Request, authorization: Optional[str] = Header(None)):
    """Manually confirm a crypto payment order (e.g. Binance Pay)."""
    _verify_admin_token(authorization)
    import bot_data
    body = await request.json()
    order_id = body.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id is required")

    tx_ref = f"admin_manual_{int(__import__('time').time())}"
    confirmed = bot_data.confirm_order(order_id, tx_ref)
    if not confirmed:
        raise HTTPException(status_code=404, detail="Order not found or already confirmed")

    return {"success": True, "order": confirmed}


# ========== Bypass API Endpoints ==========

class BypassRequest(BaseModel):
    link: str  # Full verification URL


@app.post("/api/bypass")
async def bypass_link_endpoint(request: BypassRequest, authorization: Optional[str] = Header(None)):
    """
    Bypass a SheerID verification link by repeatedly uploading dummy documents.
    Returns a Server-Sent Events stream with live logs.
    """
    from fastapi.responses import StreamingResponse
    import httpx
    import re
    import base64

    link = request.link.strip()
    # Extract VID
    match = re.search(r'verificationId=([a-zA-Z0-9-]+)', link)
    if not match:
        raise HTTPException(status_code=400, detail="无法从链接中提取 verificationId")
    vid = match.group(1)

    async def event_stream():
        import time
        base_url = "https://services.sheerid.com/rest/v2"

        def log(msg, level="info"):
            ts = time.strftime("%H:%M:%S")
            return f"data: {json.dumps({'time': ts, 'level': level, 'message': msg})}\n\n"

        yield log(f"开始处理 VID: {vid[:12]}...")

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Step 1: Check current status
                yield log("检查链接状态...")
                check = await client.get(f"{base_url}/verification/{vid}")
                if check.status_code != 200:
                    yield log(f"检查失败: HTTP {check.status_code}", "error")
                    yield f"data: {json.dumps({'done': True, 'success': False})}\n\n"
                    return

                step = check.json().get("currentStep", "unknown")
                yield log(f"当前状态: {step}")

                # Step 2: Wait for pending to clear
                if step == "pending":
                    yield log("链接正在处理中 (pending)，等待完成...", "warn")
                    for poll in range(40):  # 120s max
                        await asyncio.sleep(3)
                        check = await client.get(f"{base_url}/verification/{vid}")
                        if check.status_code == 200:
                            step = check.json().get("currentStep", "")
                        else:
                            step = f"error_{check.status_code}"

                        if step != "pending":
                            yield log(f"状态已变更: {step}")
                            break
                        if poll % 3 == 0:
                            yield log(f"仍在等待 pending... ({(poll+1)*3}s)")
                    else:
                        yield log("等待超时 (120s)，尝试继续...", "warn")

                # Step 3: Handle SSO / collectStudentPersonalInfo
                if step in ("sso", "collectStudentPersonalInfo"):
                    yield log(f"跳过 SSO 步骤...")
                    await client.delete(f"{base_url}/verification/{vid}/step/sso")
                    yield log("SSO 已跳过")

                if step == "success":
                    yield log("✅ 链接已经是成功状态，不需要 bypass", "success")
                    yield f"data: {json.dumps({'done': True, 'success': True, 'step': 'success'})}\n\n"
                    return

                # Step 4: Loop bypass uploads
                tiny_png = base64.b64decode(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                )
                upload_count = 0
                max_uploads = 10

                for i in range(max_uploads):
                    yield log(f"上传 Bypass 文件 ({i+1}/{max_uploads})...")
                    
                    # Check step first
                    check = await client.get(f"{base_url}/verification/{vid}")
                    if check.status_code == 429:
                        yield log(f"✅ HTTP 429 - 已触发频率限制 (Good!)", "success")
                        upload_count = i
                        break
                    
                    if check.status_code != 200:
                        yield log(f"检查失败: HTTP {check.status_code}", "error")
                        break

                    current = check.json().get("currentStep", "")
                    if current == "success":
                        yield log("✅ 链接已变为成功状态", "success")
                        yield f"data: {json.dumps({'done': True, 'success': True, 'step': 'success'})}\n\n"
                        return
                    if current == "pending":
                        yield log("等待 pending 处理...")
                        await asyncio.sleep(3)
                        continue

                    # Request upload URL
                    upload_body = {"files": [{"fileName": "bypass.png", "mimeType": "image/png", "fileSize": 68}]}
                    upload_resp = await client.post(
                        f"{base_url}/verification/{vid}/step/docUpload",
                        json=upload_body
                    )

                    if upload_resp.status_code == 429:
                        yield log(f"✅ HTTP 429 - 已触发频率限制 (上传请求)", "success")
                        upload_count = i
                        break

                    if upload_resp.status_code != 200:
                        yield log(f"上传请求失败: HTTP {upload_resp.status_code}", "error")
                        break

                    docs = upload_resp.json().get("documents", [])
                    if not docs or not docs[0].get("uploadUrl"):
                        yield log("无法获取上传 URL", "error")
                        break

                    # Upload dummy PNG
                    s3_resp = await client.put(
                        docs[0]["uploadUrl"],
                        content=tiny_png,
                        headers={"Content-Type": "image/png"}
                    )
                    if not (200 <= s3_resp.status_code < 300):
                        yield log(f"S3 上传失败: HTTP {s3_resp.status_code}", "error")
                        break

                    # Complete upload
                    complete = await client.post(f"{base_url}/verification/{vid}/step/completeDocUpload")
                    yield log(f"✅ 第 {i+1} 次上传完成 (Complete: {complete.status_code})", "success")
                    upload_count = i + 1

                    await asyncio.sleep(2)

                yield log(f"Bypass 完成! 共成功上传 {upload_count} 次", "success")
                yield f"data: {json.dumps({'done': True, 'success': True, 'uploads': upload_count})}\n\n"

        except Exception as e:
            yield log(f"错误: {str(e)}", "error")
            yield f"data: {json.dumps({'done': True, 'success': False, 'error': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ========== CDK API Endpoints ==========

@app.post("/api/cdk/validate")
async def validate_cdk_endpoint(request: CDKValidateRequest):
    """Validate a CDK code and return remaining quota"""
    result = cdk_manager.validate_cdk(request.code)
    return result


@app.post("/api/cdk/redeem")
async def redeem_cdk_endpoint(request: CDKValidateRequest, authorization: Optional[str] = Header(None)):
    """Redeem a CDK code: transfer all credits to user account. Requires login."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录后再兑换积分")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    result = cdk_manager.redeem_cdk(request.code, user["id"])
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    # Trigger invite reward: invitee redeemed CDK = purchased credits, reward inviter
    try:
        auth.trigger_invite_reward(user["id"])
    except Exception as e:
        print(f"[CDK Redeem] Error triggering invite reward: {e}")

    # Return updated user credits
    updated_user = auth.get_user_by_id(user["id"])
    return {
        "success": True,
        "credits_added": result["credits_added"],
        "new_balance": updated_user["credits"] if updated_user else 0,
        "message": result["message"]
    }

@app.post("/api/cdk/generate")
async def generate_cdk_endpoint(request: CDKGenerateRequest, authorization: Optional[str] = Header(None)):
    """Generate CDK codes (admin only)"""
    # Verify admin
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    
    token = authorization.split(' ')[1]
    user_data = auth.verify_token(token)
    if not user_data or user_data.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if request.count < 1 or request.count > 100:
        raise HTTPException(status_code=400, detail="Count must be 1-100")
    if request.quota not in [1, 1.5, 5, 10, 20, 50, 100]:
        raise HTTPException(status_code=400, detail="Quota must be 1, 1.5, 5, 10, 20, 50, or 100")
    
    codes = cdk_manager.generate_cdks(request.count, request.quota, request.note)
    return {"success": True, "codes": codes, "count": len(codes), "quota": request.quota}


@app.get("/api/cdk/list")
async def list_cdks_endpoint(authorization: Optional[str] = Header(None)):
    """List all CDKs (admin only)"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    
    token = authorization.split(' ')[1]
    user_data = auth.verify_token(token)
    if not user_data or user_data.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    cdks = cdk_manager.get_all_cdks()
    stats = cdk_manager.get_cdk_stats()
    return {"cdks": cdks, "stats": stats}


@app.post("/api/cdk/delete")
async def delete_cdk_endpoint(request: CDKDeleteRequest, authorization: Optional[str] = Header(None)):
    """Delete a CDK (admin only)"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    
    token = authorization.split(' ')[1]
    user_data = auth.verify_token(token)
    if not user_data or user_data.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    success = cdk_manager.delete_cdk(request.code)
    if not success:
        raise HTTPException(status_code=404, detail="CDK not found")
    return {"success": True, "message": "CDK 已删除"}


class CDKBatchDeleteRequest(BaseModel):
    codes: List[str]


@app.post("/api/cdk/batch-delete")
async def batch_delete_cdk_endpoint(request: CDKBatchDeleteRequest, authorization: Optional[str] = Header(None)):
    """Batch delete CDKs (admin only)"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    
    token = authorization.split(' ')[1]
    user_data = auth.verify_token(token)
    if not user_data or user_data.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not request.codes:
        raise HTTPException(status_code=400, detail="No codes provided")
    
    deleted = cdk_manager.batch_delete_cdks(request.codes)
    return {"success": True, "deleted": deleted, "message": f"已删除 {deleted} 个 CDK"}


@app.post("/api/cdk/consume")
async def consume_cdk_endpoint(request: CDKDeleteRequest, authorization: Optional[str] = Header(None)):
    """Manually consume 1 quota from a CDK (admin only)"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    
    token = authorization.split(' ')[1]
    user_data = auth.verify_token(token)
    if not user_data or user_data.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = cdk_manager.use_cdk(request.code, 1)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return {"success": True, "remaining": result["remaining"], "message": result["message"]}


@app.get("/api/cdk/stats")
async def cdk_stats_endpoint():
    """Get CDK statistics"""
    return cdk_manager.get_cdk_stats()


@app.get("/api/cdk/history/{code}")
async def cdk_history_endpoint(code: str, authorization: Optional[str] = Header(None)):
    """Get verification history for a specific CDK code"""
    _verify_admin_token(authorization)
    records = verification_history.get_history_by_cdk(code)
    return {"code": code, "records": records, "total": len(records)}


# ========== Database Backup Endpoints ==========

@app.get("/api/backup/list")
async def backup_list_endpoint(authorization: Optional[str] = Header(None)):
    """Get list of available database backups"""
    _verify_admin_token(authorization)
    return {"backups": database.get_backup_list()}


@app.post("/api/backup/create")
async def backup_create_endpoint(authorization: Optional[str] = Header(None)):
    """Create a new database backup"""
    _verify_admin_token(authorization)
    try:
        path = database.create_backup()
        return {"success": True, "path": path, "backups": database.get_backup_list()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/backup/download")
async def backup_download_endpoint(authorization: Optional[str] = Header(None)):
    """Download the latest database backup"""
    _verify_admin_token(authorization)
    
    # Create a fresh backup for download
    try:
        backup_path = database.create_backup()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")
    
    from fastapi.responses import FileResponse
    filename = os.path.basename(backup_path)
    return FileResponse(
        path=backup_path,
        media_type="application/octet-stream",
        filename=filename
    )


@app.get("/api/verify/history")
async def get_verification_history_endpoint():
    """Get recent verification history for the real-time status grid (public, sanitized).
    Only returns final results (pass/failed) — not timeout/no_credits/error/etc.
    Stats are computed from ALL records (not limited by the grid window).
    """
    history = verification_history.get_recent_history(200)
    # Only include final results for the status grid
    final_only = [h for h in history if h["status"] in ("pass", "failed")]
    # Compute stats from ALL records, not just the windowed 200
    all_stats = verification_history.get_history_stats()
    stats = {
        "total": all_stats.get("pass", 0) + all_stats.get("failed", 0),
        "pass": all_stats.get("pass", 0),
        "failed": all_stats.get("failed", 0),
        "processing": 0,
        "cancel": 0,
    }
    sanitized = [
        {"id": h["id"], "status": h["status"], "timestamp": h["timestamp"]}
        for h in final_only
    ]
    return {
        "history": sanitized,
        "stats": stats
    }


@app.get("/api/user/verify-history")
async def get_user_verification_history(authorization: Optional[str] = Header(None)):
    """Get verification & GPT recharge history for the logged-in user (max 50 records)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期")

    user_id = user.get("id")
    cdk_tag = f"user:{user_id}"

    # 1) Pixel verification history
    pixel_records = verification_history.get_history_by_user(user_id, limit=50)
    pixel_items = []
    import re as _re
    for r in pixel_records:
        raw_msg = r.get("message") or ""
        # Extract URL from message
        url_match = _re.search(r'(https?://\S+)', raw_msg)
        url = url_match.group(1) if url_match else ""
        # Clean the message: strip emoji, URLs
        clean_msg = raw_msg.replace("❌", "").replace("✅", "").strip()
        if url:
            clean_msg = clean_msg.replace(url, "").strip()
        # Strip trailing colon/spaces
        clean_msg = _re.sub(r'[:：]\s*$', '', clean_msg).strip()
        pixel_items.append({
            "id": r["id"],
            "type": "pixel",
            "status": r["status"],  # pass / failed
            "email": r.get("submitEmail", "") or r.get("email", ""),
            "message": clean_msg,
            "url": url,
            "timestamp": r["timestamp"],
        })

    # 2) GPT recharge history (from gpt_keys table)
    conn = database.get_connection()
    gpt_rows = conn.execute(
        "SELECT card_key, status, used_email, used_at, channel FROM gpt_keys WHERE used_by_cdk = ? ORDER BY id DESC LIMIT 50",
        (cdk_tag,)
    ).fetchall()
    gpt_items = [
        {
            "id": f"gpt_{row['card_key'][:8]}",
            "type": "gpt",
            "status": "pass" if row["status"] == "used" else "failed",
            "email": row["used_email"] or "",
            "message": f"ChatGPT 充值{'成功' if row['status'] == 'used' else '失败'}",
            "timestamp": row["used_at"] or "",
        }
        for row in gpt_rows
    ]

    gpt_team_rows = conn.execute(
        """
        SELECT id, status, verification_id, message, timestamp, email
        FROM verification_history
        WHERE cdk = ? AND via = 'gpt_team'
        ORDER BY rowid DESC
        LIMIT 50
        """,
        (cdk_tag,)
    ).fetchall()
    gpt_team_items = [
        {
            "id": row["id"],
            "type": "gpt",
            "status": row["status"],
            "email": row["email"] if "email" in row.keys() else "",
            "message": row["message"] or "Team 邀请",
            "timestamp": row["timestamp"] or "",
        }
        for row in gpt_team_rows
    ]

    # 3) Merge and sort by timestamp descending, limit 50
    all_items = pixel_items + gpt_items + gpt_team_items
    all_items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return {"history": all_items[:50]}


@app.get("/api/user/active-verifications")
async def get_user_active_verifications(authorization: Optional[str] = Header(None)):
    """Get the logged-in user's current in-progress verification tasks."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期")

    user_id = int(user.get("id") or 0)
    if not user_id:
        raise HTTPException(status_code=401, detail="登录已过期")

    return {"items": _build_user_active_verifications(user_id)}


@app.get("/api/admin/today-tasks")
async def get_admin_today_tasks(authorization: Optional[str] = Header(None)):
    """Get today's verification history formatted for LiveTaskMonitor component."""
    _verify_admin_token(authorization)

    conn = database.get_connection()
    # Get today's date range (UTC)
    from datetime import datetime as _dt, timezone as _tz
    today_start = _dt.now(_tz.utc).strftime("%Y-%m-%dT00:00:00")

    # Query verification_history for today's records from pixel/kpixel/vpixel/ypixel/gpt sources
    cursor = conn.execute(
        "SELECT id, status, verification_id, message, cdk, timestamp, via, email "
        "FROM verification_history "
        "WHERE timestamp >= ? AND via IN ('pixel', 'pixel_auto', 'kpixel', 'vpixel', 'ypixel', 'gpt') "
        "ORDER BY rowid DESC LIMIT 500",
        (today_start,)
    )
    rows = cursor.fetchall()

    # Map DB status names to LiveTaskMonitor status names
    status_map = {"pass": "success", "failed": "failed", "processing": "processing", "cancel": "failed"}

    tasks = []
    for r in rows:
        db_status = r["status"]
        tasks.append({
            "vid": r["verification_id"] or r["id"],
            "source": r["via"] if "via" in r.keys() else "",
            "email": r["email"] if "email" in r.keys() else "",
            "status": status_map.get(db_status, db_status),
            "message": r["message"] or "",
            "step": "result" if db_status in ("pass", "failed") else "",
            "stage": 0,
            "totalStages": 0,
            "stageLabel": "",
            "queuePosition": -1,
            "elapsed": 0,
            "url": "",
            "error": "",
            "channel": "",
            "userId": r["cdk"] or "",
            "timestamp": r["timestamp"],
            "updatedAt": r["timestamp"],
        })

    return {"tasks": tasks}


@app.get("/api/admin/verify-history")
async def get_admin_verification_history(
    authorization: Optional[str] = Header(None),
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=500),
    search: str = Query("", description="Search keyword"),
):
    """Get paginated verification history with all fields (admin only)"""
    _verify_admin_token(authorization)
    result = verification_history.get_paginated_history(page=page, page_size=pageSize, ignore_reset=True, search=search)
    stats = verification_history.get_history_stats(respect_reset=False)
    result["stats"] = stats
    return result


class AddVerificationRecord(BaseModel):
    status: str  # pass, failed, processing, cancel
    verificationId: Optional[str] = ""
    count: Optional[int] = 1  # How many records to add


@app.post("/api/verify/history")
async def add_verification_history(request: AddVerificationRecord):
    """Admin: Manually add verification history records"""
    valid_statuses = ["pass", "failed", "processing", "cancel"]
    if request.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    count = min(max(request.count or 1, 1), 50)  # Clamp 1-50
    records = []
    for _ in range(count):
        record = verification_history.log_verification(
            request.status,
            request.verificationId or ""
        )
        records.append(record)

    return {"added": len(records), "records": records}


@app.delete("/api/verify/history/{record_id}")
async def delete_verification_history(record_id: str):
    """Admin: Delete a specific verification history record"""
    success = verification_history.delete_verification(record_id)
    if not success:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"deleted": True, "id": record_id}


class ManualOverrideRequest(BaseModel):
    status: str  # 'pass' or 'failed'


async def _fetch_upstream_result_url(vid: str, via: str) -> str:
    """Fetch the real verification result URL from the upstream Pixel API.
    
    When admin manually marks a record as pass, we need to query the upstream
    API to get the actual subscription URL so users can access their reward.
    
    Args:
        vid: The verification/job ID stored in the DB
        via: The channel identifier (pixel, pixel_auto, kpixel, vpixel, ypixel, etc.)
    
    Returns:
        The result URL string, or empty string if not available.
    """
    import re as _re_url
    try:
        via_lower = (via or "").lower()
        
        # UPixel: GET {baseUrl}/api/jobs/{job_id}  →  response.url
        if via_lower in ("pixel", "pixel_auto", "pixel_api"):
            pixel_cfg = _get_pixel_config()
            if not pixel_cfg.get("apiKey"):
                return ""
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{pixel_cfg['baseUrl']}/api/jobs/{vid}",
                    headers={"X-API-Key": pixel_cfg["apiKey"]},
                )
            if resp.status_code == 200:
                data = resp.json()
                url = data.get("url", "")
                if url:
                    return url
                # Also try extracting from message field
                msg = data.get("message", "")
                if msg:
                    m = _re_url.search(r'(https?://\S+)', msg)
                    if m:
                        return m.group(1)
            return ""
        
        # KPixel: POST {baseUrl} with action=get_status  →  response.data.message (contains URL)
        if via_lower == "kpixel":
            kpixel_cfg = _get_kpixel_config()
            if not kpixel_cfg.get("cdkey"):
                return ""
            # KPixel task_id is an integer stored as string
            try:
                task_id = int(vid)
            except (ValueError, TypeError):
                return ""
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(kpixel_cfg["baseUrl"], json={
                    "action": "get_status",
                    "cdkey": kpixel_cfg["cdkey"],
                    "task_id": task_id,
                })
            if resp.status_code == 200:
                data = resp.json()
                if data.get("success"):
                    info = data.get("data", {})
                    message = info.get("message", "")
                    if message:
                        m = _re_url.search(r'(https?://\S+)', message)
                        if m:
                            return m.group(1)
                        # KPixel sometimes returns the URL directly as the message
                        return message
            return ""
        
        # VPixel: POST {baseUrl}/task/query with card=...  →  response.data fields
        if via_lower == "vpixel":
            vpixel_cfg = _get_vpixel_config()
            if not vpixel_cfg.get("card"):
                return ""
            # VPixel poll_id has vp_ prefix; the actual task_id may differ
            # Try querying with the VID as-is
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{vpixel_cfg['baseUrl']}/task/query",
                    json={"card": vpixel_cfg["card"], "task_id": vid},
                )
            if resp.status_code == 200:
                data = resp.json()
                result_data = data.get("data", {})
                # VPixel returns result in 'message' or 'url' field
                url = result_data.get("url", "") or result_data.get("result_url", "")
                if url:
                    return url
                msg = result_data.get("message", "") or result_data.get("result", "")
                if msg:
                    m = _re_url.search(r'(https?://\S+)', msg)
                    if m:
                        return m.group(1)
            return ""
        
        # YPixel: GET {baseUrl}/task/{task_id}  →  response fields
        if via_lower == "ypixel":
            ypixel_cfg = _get_ypixel_config()
            # YPixel poll_id may have yp_ prefix; extract the real task_id
            real_task_id = vid
            if vid.startswith("yp_"):
                # The actual task ID might be after the prefix
                parts = vid.split("_", 2)
                if len(parts) >= 3:
                    real_task_id = parts[2]
                elif len(parts) == 2:
                    real_task_id = parts[1]
            async with httpx.AsyncClient(timeout=10) as client:
                # Try the poll_id first (some YPixel APIs use the full poll_id)
                resp = await client.get(f"{ypixel_cfg['baseUrl']}/task/{vid}")
                if resp.status_code != 200 and real_task_id != vid:
                    resp = await client.get(f"{ypixel_cfg['baseUrl']}/task/{real_task_id}")
            if resp.status_code == 200:
                data = resp.json()
                # YPixel may return URL in various fields
                url = data.get("url", "") or data.get("result_url", "")
                if url:
                    return url
                msg = data.get("message", "") or data.get("result", "")
                if msg:
                    m = _re_url.search(r'(https?://\S+)', msg)
                    if m:
                        return m.group(1)
            return ""
        
        # Unknown via — try to infer from VID prefix
        if vid.startswith("yp_"):
            return await _fetch_upstream_result_url(vid, "ypixel")
        elif vid.startswith("vp_"):
            return await _fetch_upstream_result_url(vid, "vpixel")
        elif vid.startswith("kp_"):
            return await _fetch_upstream_result_url(vid, "kpixel")
        else:
            # Default: try UPixel
            return await _fetch_upstream_result_url(vid, "pixel")
    
    except Exception as e:
        logging.warning(f"[override] Failed to fetch upstream result for VID={vid} via={via}: {e}")
        return ""


@app.patch("/api/verify/history/{record_id}")
async def override_verification_status(record_id: str, request: ManualOverrideRequest):
    """Admin: Manually override a verification record's status (pass/failed) with credit/CDK adjustment.
    When marking as pass, fetches real result URL from upstream API so users get the actual subscription link."""
    if request.status not in ("pass", "failed"):
        raise HTTPException(status_code=400, detail="Status must be 'pass' or 'failed'")
    
    # Get current record to check old status, CDK, VID, and via
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT status, cdk, verification_id, via FROM verification_history WHERE id = ?", (record_id,)
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    
    old_status = row["status"]
    cdk_code = row["cdk"]
    vid = row["verification_id"] or ""
    via = row["via"] if "via" in row.keys() else ""
    
    # Credit / CDK quota adjustment
    credit_message = ""
    if cdk_code and cdk_code != "__BOT_INTERNAL__":
        if cdk_code.startswith("user:"):
            # User credit system (积分)
            try:
                uid = int(cdk_code.split(":")[1])
                # Determine credit cost based on VID prefix and via channel
                if vid.startswith("yp_") or via == "ypixel":
                    cost = 1.0
                elif vid.startswith("vp_") or via == "vpixel":
                    cost = 1.5
                elif vid.startswith("kp_") or via == "kpixel":
                    cost = 1.5
                elif via == "pixel_auto":
                    cost = 1.5
                else:
                    cost = 1.0

                if request.status == "pass" and old_status != "pass":
                    auth.deduct_credits(uid, cost)
                    credit_message = f"已扣除用户 {uid} 积分 {cost}"

                elif request.status == "failed" and old_status == "pass":
                    auth.update_credits(uid, cost)
                    credit_message = f"已返还用户 {uid} 积分 {cost}"
            except Exception as e:
                credit_message = f"积分操作失败: {e}"
        else:
            # CDK-based system
            if request.status == "pass" and old_status != "pass":
                result = cdk_manager.use_cdk(cdk_code, 1)
                credit_message = f"CDK {cdk_code}: {result['message']}"
            elif request.status == "failed" and old_status == "pass":
                result = cdk_manager.refund_cdk(cdk_code, 1)
                credit_message = f"CDK {cdk_code}: {result['message']}"
    
    # When marking as pass, fetch real result URL from upstream API
    real_url = ""
    if request.status == "pass" and vid:
        real_url = await _fetch_upstream_result_url(vid, via)
    
    if request.status == "pass":
        if real_url:
            override_msg = f"✅ 订阅成功: {real_url}"
        else:
            override_msg = "管理员手动标记为通过"
    else:
        override_msg = "认证失败"
    
    success = verification_history.update_verification(record_id, request.status, override_msg)
    if not success:
        raise HTTPException(status_code=404, detail="Record not found")
    # Also set the manual override signal so running verification tasks can detect it
    if vid:
        set_manual_override(vid, request.status)
        _remember_terminal_verify_event(vid, request.status)
    # Broadcast the update via SSE so admin page refreshes
    broadcast_verify_event({"type": "history_updated", "id": record_id, "status": request.status})
    
    if vid:
        event_payload = {
            "type": "progress",
            "vid": vid,
            "step": "result",
            "status": "approved" if request.status == "pass" else "failed",
            "success": request.status == "pass",
            "message": override_msg,
        }
        if real_url:
            event_payload["url"] = real_url
        if cdk_code and cdk_code.startswith("user:"):
            event_payload["userId"] = cdk_code
        broadcast_verify_event(event_payload)
        
    return {"updated": True, "id": record_id, "status": request.status, "creditMessage": credit_message, "url": real_url}



class VidMessageOverrideRequest(BaseModel):
    vid: str
    message: str

@app.post("/api/admin/override-message")
async def override_verification_message(request: VidMessageOverrideRequest, authorization: str = Header(None)):
    """Admin: Override the message of a verification and push SSE."""
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT id, status, via FROM verification_history WHERE verification_id = ? ORDER BY rowid DESC LIMIT 1",
        (request.vid,)
    )
    existing = cursor.fetchone()
    
    if existing:
        verification_history.update_verification(existing["id"], existing["status"], request.message)
    else:
        verification_history.log_verification("failed", request.vid, request.message)
        
    cdk_field = ""
    if existing:
        cdk_row = conn.execute("SELECT cdk FROM verification_history WHERE id = ?", (existing["id"],)).fetchone()
        if cdk_row:
            cdk_field = cdk_row["cdk"] or ""

    event_payload = {
        "type": "progress",
        "vid": request.vid,
        "step": "result",
        "status": existing["status"] if existing else "failed",
        "success": (existing["status"] == "pass") if existing else False,
        "message": request.message,
    }
    if cdk_field and cdk_field.startswith("user:"):
        event_payload["userId"] = cdk_field
        
    broadcast_verify_event(event_payload)
    # Also trigger admin log update
    record_id_for_sse = existing["id"] if existing else 0
    if record_id_for_sse:
        broadcast_verify_event({"type": "history_updated", "id": record_id_for_sse, "status": existing["status"] if existing else "failed", "message": request.message})
    
    return {"updated": True, "vid": request.vid, "message": request.message}



class VidOverrideRequest(BaseModel):
    vid: str
    status: str  # 'pass' or 'failed'

@app.post("/api/admin/override-vid")
async def override_verification_by_vid(request: VidOverrideRequest):
    """Admin: Override a verification by VID (for processing entries not yet in DB).
    Sets the manual override signal so running verification tasks early-return.
    Also persists the result to verification_history so it survives page reloads.
    When marking as pass, fetches real result URL from upstream API."""
    if request.status not in ("pass", "failed"):
        raise HTTPException(status_code=400, detail="Status must be 'pass' or 'failed'")
    
    set_manual_override(request.vid, request.status)
    
    # Persist to DB: check if VID already exists in history
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT id, status, via FROM verification_history WHERE verification_id = ? ORDER BY rowid DESC LIMIT 1",
        (request.vid,)
    )
    existing = cursor.fetchone()
    
    # Fetch real URL from upstream when marking as pass
    via = ""
    if existing and "via" in existing.keys():
        via = existing["via"] or ""
    real_url = ""
    if request.status == "pass":
        real_url = await _fetch_upstream_result_url(request.vid, via)
    
    if request.status == "pass":
        if real_url:
            override_msg = f"✅ 订阅成功: {real_url}"
        else:
            override_msg = "管理员手动标记为通过"
    else:
        override_msg = "认证失败"
    
    if existing:
        # Update existing record
        verification_history.update_verification(existing["id"], request.status, override_msg)
    else:
        # Create new record so it appears in history API
        verification_history.log_verification(request.status, request.vid, override_msg)
    
    cdk_field = ""
    if existing:
        cdk_row = conn.execute("SELECT cdk FROM verification_history WHERE id = ?", (existing["id"],)).fetchone()
        if cdk_row:
            cdk_field = cdk_row["cdk"] or ""

    # Broadcast a per-link result event so admin SSE log updates immediately
    event_payload = {
        "type": "progress",
        "vid": request.vid,
        "step": "result",
        "status": "approved" if request.status == "pass" else "failed",
        "success": request.status == "pass",
        "message": override_msg,
    }
    if real_url:
        event_payload["url"] = real_url
    if cdk_field and cdk_field.startswith("user:"):
        event_payload["userId"] = cdk_field
        
    broadcast_verify_event(event_payload)

    # Credit handling: check existing record for cdk field
    credit_message = ""
    if existing:
        old_status = existing["status"]

        if cdk_field and cdk_field.startswith("user:"):
            # User credit system
            try:
                uid = int(cdk_field.split(":")[1])
                # Determine credit cost based on VID prefix and via channel
                vid = request.vid or ""
                if vid.startswith("yp_") or via == "ypixel":
                    cost = 1.0
                elif vid.startswith("vp_") or via == "vpixel":
                    cost = 1.5
                elif vid.startswith("kp_") or via == "kpixel":
                    cost = 1.5
                elif via == "pixel_auto":
                    cost = 1.5
                else:
                    cost = 1.0

                if request.status == "pass" and old_status != "pass":
                    auth.deduct_credits(uid, cost)

                    credit_message = f"已扣除用户 {uid} 积分 {cost}"
                elif request.status == "failed" and old_status == "pass":
                    auth.update_credits(uid, cost)
                    credit_message = f"已返还用户 {uid} 积分 {cost}"
            except Exception as e:
                credit_message = f"积分操作失败: {e}"
        elif cdk_field and cdk_field != "__BOT_INTERNAL__":
            # CDK-based system
            if request.status == "pass" and old_status != "pass":
                result = cdk_manager.use_cdk(cdk_field, 1)
                credit_message = f"CDK {cdk_field}: {result['message']}"
            elif request.status == "failed" and old_status == "pass":
                result = cdk_manager.refund_cdk(cdk_field, 1)
                credit_message = f"CDK {cdk_field}: {result['message']}"

    return {"ok": True, "vid": request.vid, "status": request.status, "creditMessage": credit_message, "url": real_url}


@app.delete("/api/verify/history")
async def clear_verification_history():
    """Admin: Clear all verification history"""
    count = verification_history.clear_history()
    return {"cleared": True, "count": count}


@app.post("/api/verify/history/reset")
async def reset_verification_display():
    """Reset the display — only shows records created after this point. DB records preserved."""
    reset_at = verification_history.reset_display()
    return {"ok": True, "resetAt": reset_at}


# ========== Auto-Record Rules (Persistent) ==========
import json as _json
from datetime import datetime, timezone
_AUTO_RECORD_FILE = os.path.join(os.path.dirname(__file__), "data", "auto_record_rules.json")
_auto_record_tasks: dict = {}  # rule_id -> asyncio.Task

def _load_auto_rules():
    try:
        if os.path.exists(_AUTO_RECORD_FILE):
            with open(_AUTO_RECORD_FILE, "r") as f:
                return _json.load(f)
    except Exception:
        pass
    return []

def _save_auto_rules(rules):
    os.makedirs(os.path.dirname(_AUTO_RECORD_FILE), exist_ok=True)
    with open(_AUTO_RECORD_FILE, "w") as f:
        _json.dump(rules, f, ensure_ascii=False)

async def _auto_rule_loop(rule_id: str):
    """Background loop for a single auto-record rule"""
    import random as _random
    while True:
        try:
            rules = _load_auto_rules()
            rule = next((r for r in rules if r["id"] == rule_id), None)
            if not rule or not rule.get("enabled"):
                break
            
            # Check duration expiry
            duration_hours = rule.get("durationHours", 0)
            started_at = rule.get("startedAt")
            if duration_hours > 0 and started_at:
                elapsed_hours = (datetime.now(timezone.utc) - datetime.fromisoformat(started_at)).total_seconds() / 3600
                if elapsed_hours >= duration_hours:
                    rule["enabled"] = False
                    _save_auto_rules(rules)
                    print(f"[AutoRecord] Rule {rule_id} expired after {duration_hours}h")
                    break
            
            count = max(1, int(rule.get("count", 1)))
            success_rate = min(100, max(0, float(rule.get("successRate", 100))))
            
            for i in range(count):
                # Determine status based on success rate
                if _random.random() * 100 < success_rate:
                    status = "pass"
                else:
                    status = "failed"
                ts = int(datetime.now(timezone.utc).timestamp())
                unique_vid = f"auto-{rule_id[:6]}-{ts}-{i}"
                verification_history.log_verification(status, unique_vid)
            
            interval_sec = rule.get("intervalMinutes", 5) * 60
            await asyncio.sleep(interval_sec)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[AutoRecord] Rule {rule_id} error: {e}")
            await asyncio.sleep(30)

def _start_rule_task(rule):
    rule_id = rule["id"]
    if rule_id in _auto_record_tasks:
        _auto_record_tasks[rule_id].cancel()
    _auto_record_tasks[rule_id] = asyncio.create_task(_auto_rule_loop(rule_id))

def _stop_rule_task(rule_id):
    task = _auto_record_tasks.pop(rule_id, None)
    if task:
        task.cancel()

@app.get("/api/verify/auto-record")
async def get_auto_record_rules():
    rules = _load_auto_rules()
    now = datetime.now(timezone.utc)
    for r in rules:
        r["running"] = r["id"] in _auto_record_tasks and not _auto_record_tasks[r["id"]].done()
        duration_hours = r.get("durationHours", 0)
        started_at = r.get("startedAt")
        if duration_hours > 0 and started_at and r["running"]:
            elapsed_hours = (now - datetime.fromisoformat(started_at)).total_seconds() / 3600
            r["remainingHours"] = max(0, round(duration_hours - elapsed_hours, 2))
        else:
            r["remainingHours"] = None
    return {"rules": rules}

@app.post("/api/verify/auto-record")
async def create_auto_record_rule(request: Request):
    data = await request.json()
    rules = _load_auto_rules()
    import uuid
    rule = {
        "id": str(uuid.uuid4())[:8],
        "status": data.get("status", "pass"),
        "intervalMinutes": max(1, int(data.get("intervalMinutes", 5))),
        "count": max(1, int(data.get("count", 1))),
        "successRate": min(100, max(0, float(data.get("successRate", 100)))),
        "durationHours": max(0, float(data.get("durationHours", 0))),
        "enabled": data.get("enabled", True),
        "startedAt": datetime.now(timezone.utc).isoformat() if data.get("enabled", True) else None
    }
    rules.append(rule)
    _save_auto_rules(rules)
    if rule["enabled"]:
        _start_rule_task(rule)
    return {"rule": rule}

@app.put("/api/verify/auto-record/{rule_id}")
async def toggle_auto_record_rule(rule_id: str, request: Request):
    data = await request.json()
    rules = _load_auto_rules()
    rule = next((r for r in rules if r["id"] == rule_id), None)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    if "enabled" in data:
        rule["enabled"] = data["enabled"]
        if data["enabled"]:
            rule["startedAt"] = datetime.now(timezone.utc).isoformat()
        else:
            rule["startedAt"] = None
    if "intervalMinutes" in data:
        rule["intervalMinutes"] = max(1, int(data["intervalMinutes"]))
    if "status" in data:
        rule["status"] = data["status"]
    if "durationHours" in data:
        rule["durationHours"] = max(0, float(data["durationHours"]))
    if "count" in data:
        rule["count"] = max(1, int(data["count"]))
    if "successRate" in data:
        rule["successRate"] = min(100, max(0, float(data["successRate"])))
    
    _save_auto_rules(rules)
    
    if rule["enabled"]:
        _start_rule_task(rule)
    else:
        _stop_rule_task(rule_id)
    
    return {"rule": rule}

@app.delete("/api/verify/auto-record/{rule_id}")
async def delete_auto_record_rule(rule_id: str):
    _stop_rule_task(rule_id)
    rules = _load_auto_rules()
    rules = [r for r in rules if r["id"] != rule_id]
    _save_auto_rules(rules)
    return {"deleted": True}

@app.on_event("startup")
async def startup_auto_records():
    rules = _load_auto_rules()
    for rule in rules:
        if rule.get("enabled"):
            _start_rule_task(rule)
            print(f"[AutoRecord] Auto-started rule {rule['id']}: {rule['status']} every {rule.get('intervalMinutes', 5)}min")

# ========== Telegram Verification ==========

@app.post("/api/verify/telegram")
async def verify_via_telegram(request: TelegramVerifyRequest):
    """
    Verify by sending full verification links to Telegram SheerID Bot.
    Uses unified account pool with round-robin and per-account cooldown.
    """
    # Check if pool has any connected clients
    if not tg_manager.is_connected:
        raise HTTPException(
            status_code=503, 
            detail="没有可用的账号连接，请在管理面板添加或重连账号"
        )
    
    if not telegram_bot:
        raise HTTPException(
            status_code=503, 
            detail="老 Bot 未初始化，请检查配置"
        )
    
    if not request.links:
        raise HTTPException(status_code=400, detail="No verification links provided")
    
    if len(request.links) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 links per request")
    
    # Validate CDK
    if not request.cdk:
        raise HTTPException(status_code=400, detail="请提供 CDK 激活码")
    
    cdk_check = cdk_manager.validate_cdk(request.cdk)
    if not cdk_check["valid"]:
        raise HTTPException(status_code=403, detail=cdk_check["message"])
    
    # Clean up links
    clean_links = [link.strip() for link in request.links if link.strip()]
    if not clean_links:
        raise HTTPException(status_code=400, detail="No valid links provided")

    # Validate link format
    import re as _re_val2
    clean_url_pattern = r'^https://services\.sheerid\.com/verify/[a-fA-F0-9]+/\?verificationId=[a-fA-F0-9]+$'
    for link in clean_links:
        if not _re_val2.match(clean_url_pattern, link):
            raise HTTPException(
                status_code=400,
                detail=f"链接格式错误，请刷新页面获取重新获取链接。注意右击按钮获取！"
            )
    
    # Check if CDK has enough quota
    if cdk_check["remaining"] < len(clean_links):
        raise HTTPException(
            status_code=403, 
            detail=f"CDK 额度不足，需要 {len(clean_links)} 次，剩余 {cdk_check['remaining']} 次"
        )
    
    import re
    import time as _time
    
    def _get_next_oldbot_client():
        """Get next available oldbot-assigned client, skipping old-bot-cooldown accounts."""
        now = _time.time()
        # Use the manager's bot_type filter to get only oldbot-assigned accounts
        # But we need to also skip accounts that are in _oldbot_cooldowns
        # So we iterate through all oldbot-assigned connected accounts manually
        import config_manager as _cm
        config = _cm.get_config()
        accounts = config.get("telegramAccounts", [])
        
        oldbot_ids = []
        for acc in accounts:
            if not acc.get("enabled", True):
                continue
            assigned = acc.get("assignedBots", ["dualbot"])
            if "oldbot" not in assigned:
                continue
            if _oldbot_cooldowns.get(acc["id"], 0) > now:
                continue
            oldbot_ids.append(acc["id"])
        
        all_clients = tg_manager.get_all_clients()
        available = [(aid, all_clients[aid]) for aid in oldbot_ids
                     if aid in all_clients and all_clients[aid].is_connected()]
        
        if not available:
            return None
        
        if not hasattr(_get_next_oldbot_client, '_idx'):
            _get_next_oldbot_client._idx = 0
        _get_next_oldbot_client._idx = (_get_next_oldbot_client._idx + 1) % len(available)
        return available[_get_next_oldbot_client._idx]
    
    def _get_shortest_oldbot_cooldown():
        """Return seconds until the soonest old-bot cooldown expires. 0 if none."""
        now = _time.time()
        active = [exp - now for exp in _oldbot_cooldowns.values() if exp > now]
        return min(active) if active else 0
    
    async def process_link(link):
        vid_match = re.search(r'verificationId=([a-zA-Z0-9]+)', link)
        display_id = vid_match.group(1) if vid_match else link[:30]
        
        max_retries = 5
        for attempt in range(max_retries):
            pool_item = _get_next_oldbot_client()
            
            if not pool_item:
                # All accounts in cooldown, wait for shortest
                wait_time = _get_shortest_oldbot_cooldown()
                if wait_time > 0:
                    logger.info(f"[OldBot] All accounts in cooldown, waiting {wait_time:.0f}s...")
                    await asyncio.sleep(wait_time + 2)
                    pool_item = _get_next_oldbot_client()
                
                if not pool_item:
                    return {
                        "link": link,
                        "verificationId": display_id,
                        "status": "error",
                        "success": False,
                        "message": "所有账号冷却中，请稍后重试"
                    }
            
            acc_id, client = pool_item
            
            # Register handler if not already done
            telegram_bot.register_handler(client)
            
            result = await telegram_bot.verify_with_client(client, link)
            
            # Handle cooldown — mark this account and retry with next
            if result.get("status") == "cooldown":
                wait_seconds = result.get("cooldown_seconds", 90)
                _oldbot_cooldowns[acc_id] = _time.time() + wait_seconds
                logger.info(f"[OldBot] Account {acc_id} cooldown {wait_seconds}s, retrying with next...")
                continue
            
            return {
                "link": link,
                "verificationId": result.get("verificationId") or display_id,
                "status": result.get("status", "unknown"),
                "success": result.get("success", False),
                "message": result.get("message", ""),
                "credits": result.get("credits"),
                "claimLink": result.get("claimLink"),
                "reason": result.get("reason"),
                "raw_response": result.get("raw_response")
            }
        
        # Exhausted retries
        return {
            "link": link,
            "verificationId": display_id,
            "status": "cooldown",
            "success": False,
            "message": "所有账号冷却中，请稍后重试"
        }
    
    # Broadcast initial 'submitted' event so Admin page shows immediately
    import re as _re_sub
    for link in clean_links:
        _vm = _re_sub.search(r'verificationId=([a-zA-Z0-9]+)', link)
        _sv = _vm.group(1) if _vm else link[:30]
        broadcast_verify_event({"type": "progress", "link": link, "vid": _sv, "step": "submitted", "message": "等待验证..."})

    results = await asyncio.gather(*[process_link(link) for link in clean_links])
    results = list(results)
    
    # Log verification results to history
    for r in results:
        vid = r.get("verificationId", "")
        reason = r.get("reason", "")
        if r["status"] == "approved":
            verification_history.log_verification("pass", vid, cdk=request.cdk)
        elif r["status"] == "rejected" and reason not in ("link_opened", "expired", "invalid", "rate_limited"):
            verification_history.log_verification("failed", vid, cdk=request.cdk)
        elif r["status"] in ("error",):
            verification_history.log_verification("failed", vid, cdk=request.cdk)
    
    # Deduct CDK quota for successful verifications
    successful = sum(1 for r in results if r["status"] == "approved" and not r.get("alreadyVerified"))
    cdk_remaining = cdk_check["remaining"]
    if successful > 0:
        deduct = cdk_manager.use_cdk(request.cdk, successful)
        cdk_remaining = deduct.get("remaining", cdk_remaining)
    
    done_event = {
        "type": "done",
        "results": results,
        "stats": {
            "total": len(results),
            "approved": successful,
            "rejected": sum(1 for r in results if r["status"] == "rejected")
        },
        "cdkRemaining": cdk_remaining
    }
    broadcast_verify_event(done_event)

    return done_event


# ========== GetGem.cc API Verification ==========

class GetGemVerifyRequest(BaseModel):
    verificationIds: List[str]
    cdk: Optional[str] = None  # User's local CDK (for quota tracking)


@app.post("/api/verify/getgem")
async def verify_via_getgem(request: GetGemVerifyRequest):
    """
    Verify by forwarding verification IDs to GetGem.cc API.
    Uses SSE streaming to send real-time progress like DualBot.
    """
    import config_manager
    import httpx

    config = config_manager.get_config()
    getgem_config = config.get("aiGenerator", {}).get("getgem", {})
    getgem_cdk = getgem_config.get("cdk", "")
    getgem_url = getgem_config.get("apiUrl", "https://getgem.cc")

    if not getgem_cdk:
        raise HTTPException(status_code=400, detail="API CDK 未配置，请在管理面板中设置")

    if not request.verificationIds:
        raise HTTPException(status_code=400, detail="No verification IDs provided")
    
    if len(request.verificationIds) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 IDs per request")

    # Validate local CDK (for quota tracking)
    cdk_remaining = None
    if request.cdk:
        cdk_check = cdk_manager.validate_cdk(request.cdk)
        if not cdk_check["valid"]:
            raise HTTPException(status_code=403, detail=cdk_check["message"])
        if cdk_check["remaining"] < len(request.verificationIds):
            raise HTTPException(
                status_code=403,
                detail=f"CDK 额度不足，需要 {len(request.verificationIds)} 次，剩余 {cdk_check['remaining']} 次"
            )
        cdk_remaining = cdk_check["remaining"]

    async def event_stream():
        import json as _json

        def fmt(data):
            broadcast_verify_event(data)
            return f"data: {_json.dumps(data, ensure_ascii=False)}\n\n"

        all_results = []

        # Broadcast initial 'submitted' event so Admin page shows immediately
        for _sv in request.verificationIds:
            broadcast_verify_event({"type": "progress", "vid": _sv, "step": "submitted", "message": "等待验证..."})

        for vid in request.verificationIds:
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                    # Step 1: warmup — submitting
                    yield fmt({"type": "progress", "vid": vid, "step": "warmup", "message": "文档生成中..."})

                    # Parse multiple CDKs (can be separated by newline or comma)
                    cdk_list = [c.strip() for c in getgem_cdk.replace(',', '\n').split('\n') if c.strip()]
                    if not cdk_list:
                        all_results.append({
                            "verificationId": vid,
                            "status": "error",
                            "success": False,
                            "message": "Error: No valid API CDKs found in configuration."
                        })
                        continue

                    submit_resp = None
                    error_detail = ""
                    
                    for current_cdk in cdk_list:
                        submit_resp = await client.post(
                            f"{getgem_url}/api/verify",
                            json={"verificationId": vid, "cdk": current_cdk}
                        )
                        
                        if submit_resp.status_code == 200:
                            break # Success, break out of the fallback loop
                            
                        # If failed, check if it's a balance/auth issue to determine if we should fallback
                        try:
                            err = submit_resp.json()
                            error_detail = err.get("detail") or err.get("message") or err.get("error") or str(err)
                        except:
                            error_detail = submit_resp.text[:200]
                            
                        error_detail_lower = error_detail.lower()
                        is_balance_error = submit_resp.status_code in (400, 403) and ("balance" in error_detail_lower or "cdk" in error_detail_lower or "quota" in error_detail_lower or "余额" in error_detail_lower or "额度" in error_detail_lower)
                        
                        if is_balance_error:
                            import logging
                            logging.warning(f"[GetGem] CDK {current_cdk[:8]}... failed with balance/auth error, trying next if available.")
                            continue # Try next CDK
                        else:
                            break # Non-balance error, stop trying other CDKs and report this error

                    if submit_resp and submit_resp.status_code != 200:
                        # Mask backend CDK/balance errors from the end user (in case all CDKs failed)
                        if "balance" in error_detail.lower() or "cdk" in error_detail.lower() or "quota" in error_detail.lower() or "余额" in error_detail.lower() or "额度" in error_detail.lower():
                            error_detail = "System is currently busy, please try again later."
                            
                        all_results.append({
                            "verificationId": vid,
                            "status": "error",
                            "success": False,
                            "message": f"Verification failed: {error_detail}"
                        })
                        continue

                    submit_data = submit_resp.json()
                    
                    # Handle immediate rejection (e.g. expired link)
                    if submit_data.get("status") == "rejected":
                        msg = submit_data.get("message", "Verification rejected")
                        error_ids = submit_data.get("errorIds", [])
                        
                        if "expiredVerification" in error_ids or "已过期" in msg:
                            msg = "The link has expired or been rejected, please get a new link."
                        elif "invalidVerification" in error_ids or "无效" in msg:
                            msg = "Invalid verification link."
                        elif any('\u4e00' <= c <= '\u9fff' for c in msg):
                            msg = "Verification was rejected by the provider."

                        all_results.append({
                            "verificationId": vid,
                            "status": "rejected",
                            "success": False,
                            "message": msg,
                            "reason": submit_data.get("reason"),
                            "interMsg": submit_data.get("interMsg")
                        })
                        continue

                    # Handle immediate success (e.g. already_success — link was already verified)
                    if submit_data.get("status") == "success":
                        import logging
                        logging.info(f"[GetGem] Immediate success for {vid[:8]}: reason={submit_data.get('reason')}, redirectUrl={submit_data.get('redirectUrl')}")
                        all_results.append({
                            "verificationId": vid,
                            "status": "approved",
                            "success": True,
                            "message": submit_data.get("message", "验证成功"),
                            "interMsg": "Verification successful",
                            "redirectUrl": submit_data.get("redirectUrl"),
                            "alreadyVerified": submit_data.get("reason") == "already_success"
                        })
                        result_found = True
                        continue

                    task_id = submit_data.get("taskId")

                    if not task_id:
                        import logging
                        logging.error(f"[GetGem DEBUG] Missing taskId in response: {submit_data}")
                        # Perhaps the API uses a different key?
                        # Try to handle alternative response formats
                        task_id = submit_data.get("task_id") or submit_data.get("id") or submit_data.get("verifyId")

                    if not task_id:
                        all_results.append({
                            "verificationId": vid,
                            "status": "error",
                            "success": False,
                            "message": f"提交失败: 未返回任务ID (Response: {submit_data})"
                        })
                        continue

                    # Step 2: verify — submitted
                    _save_pending_getgem_task(vid, task_id, request.cdk or "")
                    yield fmt({"type": "progress", "vid": vid, "step": "verify", "message": "提交文档中..."})

                    await asyncio.sleep(2)

                    # Step 3: waiting — polling for result
                    yield fmt({"type": "progress", "vid": vid, "step": "waiting", "message": "等待验证..."})

                    interval = 5
                    max_attempts = 60
                    result_found = False

                    for attempt in range(max_attempts):
                        await asyncio.sleep(interval)

                        status_resp = await client.get(f"{getgem_url}/api/status/{task_id}")

                        if status_resp.status_code == 429:
                            interval = min(interval * 2, 30)
                            continue

                        if status_resp.status_code != 200:
                            continue

                        status_data = status_resp.json()
                        interval = 5

                        if status_data.get("completed"):
                            if status_data.get("success"):
                                all_results.append({
                                    "verificationId": vid,
                                    "status": "approved",
                                    "success": True,
                                    "message": "验证成功",
                                    "redirectUrl": status_data.get("redirectUrl"),
                                    "taskId": task_id
                                })
                                result_found = True
                                break
                            else:
                                last_error = status_data.get('error', 'Unknown error')
                                translated_error = _translate_getgem_error(last_error)
                                yield fmt({"type": "progress", "vid": vid, "step": "failed", "message": f"验证失败: {translated_error}，重试中..."})

                                retry_ok = False
                                for _retry in range(6):
                                    await asyncio.sleep(5)
                                    retry_resp = await client.get(f"{getgem_url}/api/status/{task_id}")
                                    if retry_resp.status_code == 200:
                                        rd = retry_resp.json()
                                        if rd.get("completed") and rd.get("success"):
                                            retry_ok = True
                                            all_results.append({
                                                "verificationId": vid,
                                                "status": "approved",
                                                "success": True,
                                                "message": "验证成功",
                                                "redirectUrl": rd.get("redirectUrl"),
                                                "taskId": task_id
                                            })
                                            break
                                if not retry_ok:
                                    all_results.append({
                                        "verificationId": vid,
                                        "status": "rejected",
                                        "success": False,
                                        "message": f"验证失败: {translated_error}",
                                        "taskId": task_id
                                    })
                                result_found = True
                                break

                    if not result_found:
                        all_results.append({
                            "verificationId": vid,
                            "status": "timeout",
                            "success": False,
                            "message": "轮询超时（5分钟）",
                            "taskId": task_id
                        })

                    # Remove from pending file (polling complete)
                    _remove_pending_getgem_task(vid)

            except Exception as e:
                _remove_pending_getgem_task(vid)
                all_results.append({
                    "verificationId": vid,
                    "status": "error",
                    "success": False,
                    "message": f"错误: {str(e)}"
                })

        # Log verification results to history
        for r in all_results:
            vid_log = r.get("verificationId", "")
            msg = r.get("message", "")
            if r["status"] == "approved":
                bot_stats_tracker.record("getgem", True)
                verification_history.log_verification("pass", vid_log, message=msg, cdk=request.cdk or "", via="getgem")
            elif not r.get("success") and not r.get("alreadyVerified"):
                bot_stats_tracker.record("getgem", False)
                actual_status = r.get("status", "failed")
                verification_history.log_verification(actual_status, vid_log, message=msg or f"Rejected: {actual_status}", cdk=request.cdk or "", via="getgem")

        # Deduct local CDK quota
        nonlocal cdk_remaining
        successful = sum(1 for r in all_results if r["status"] == "approved")
        if request.cdk and successful > 0:
            deduct = cdk_manager.use_cdk(request.cdk, successful)
            cdk_remaining = deduct.get("remaining", cdk_remaining)

        # Send final done event
        yield fmt({
            "type": "done",
            "results": all_results,
            "stats": {
                "total": len(all_results),
                "approved": successful,
                "rejected": sum(1 for r in all_results if r["status"] == "rejected")
            },
            "cdkRemaining": cdk_remaining
        })

    from starlette.responses import StreamingResponse
    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/getgem/status")
async def getgem_status():
    """Check GetGem.cc API health and CDK balance"""
    import config_manager
    import httpx

    config = config_manager.get_config()
    getgem_config = config.get("aiGenerator", {}).get("getgem", {})
    getgem_cdk = getgem_config.get("cdk", "")
    getgem_url = getgem_config.get("apiUrl", "https://getgem.cc")

    result = {"connected": False, "cdkBalance": None, "health": None}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            # Parse multiple CDKs (can be separated by newline or comma)
            cdk_list = [c.strip() for c in getgem_cdk.replace(',', '\n').split('\n') if c.strip()]
            
            # Check CDK balance if configured, this serves as health check
            if cdk_list:
                total_remaining = 0
                total_uses = 0
                any_valid = False
                last_error = ""
                
                valid_cdks = []
                has_removed = False
                
                for cdk in cdk_list:
                    cdk_resp = await client.get(f"{getgem_url}/api/cdk/status/{cdk}")
                    if cdk_resp.status_code == 200:
                        data = cdk_resp.json()
                        rem = data.get("remaining_uses", 0)
                        
                        if rem > 0:
                            valid_cdks.append(cdk)
                            total_remaining += rem
                            total_uses += data.get("total_uses", 0)
                            any_valid = True
                        else:
                            has_removed = True
                    elif cdk_resp.status_code == 404:
                        has_removed = True
                        last_error = f"CDK {cdk[:8]}... 不存在或无效"
                    else:
                        valid_cdks.append(cdk) # Retain on transient/unknown errors
                        last_error = f"API 异常状态码对于 {cdk[:8]}...: {cdk_resp.status_code}"
                        
                if any_valid:
                    result["connected"] = True
                    result["cdkBalance"] = {"remaining_uses": total_remaining, "total_uses": total_uses}
                else:
                    result["error"] = last_error or "所有 CDK 均已耗尽或检查失败"
                    
                if has_removed:
                    config["aiGenerator"]["getgem"]["cdk"] = "\n".join(valid_cdks)
                    config_manager.save_config(config)
                    
            else:
                # If no CDK, just ping the domain base to see if it's alive
                base_resp = await client.get(f"{getgem_url}")
                if base_resp.status_code < 500:
                    result["connected"] = True
            # Removed old health check fallback
    except Exception as e:
        result["error"] = str(e)

    return result


# ========== Mixed-Mode Unified Verification ==========

class MixedVerifyRequest(BaseModel):
    verificationIds: List[str]
    links: Optional[List[str]] = None
    cdk: Optional[str] = None


@app.post("/api/verify/mixed")
async def verify_mixed_mode(request: MixedVerifyRequest):
    """
    Unified mixed-mode verification: splits links between GetGem API and Telegram Bot
    based on configurable allocation, with automatic fallback.
    Uses SSE streaming for real-time progress.
    """
    import config_manager
    import httpx

    config = config_manager.get_config()
    ai_config = config.get("aiGenerator", {})
    routing = ai_config.get("routingStrategy", {})

    mode = routing.get("mode", "mixed")
    allocation = routing.get("allocation", {"getgem": 50, "bot": 50})
    # (Fallback removed — each VID goes directly to its assigned node)
    auto_degrade_threshold = routing.get("autoDegradeThreshold", 30)

    # GetGem config
    getgem_config = ai_config.get("getgem", {})
    getgem_cdk = getgem_config.get("cdk", "")
    getgem_url = getgem_config.get("apiUrl", "https://getgem.cc")

    # Check what's available
    getgem_available = bool(getgem_cdk)
    
    # Check Bot availability
    dual_config = config.get("verification", {}).get("dualBot", {})
    single_bots_cfg = config.get("verification", {}).get("singleBots", [])
    bot_available = dual_config.get("enabled", False) or any(sb.get("enabled") for sb in single_bots_cfg)

    if not getgem_available and not bot_available:
        raise HTTPException(status_code=400, detail="没有可用的验证节点，请在管理面板中配置 GetGem API 或 Telegram Bot")

    if not request.verificationIds:
        raise HTTPException(status_code=400, detail="No verification IDs provided")
    if len(request.verificationIds) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 IDs per request")

    # Validate local CDK
    cdk_remaining = None
    if request.cdk:
        cdk_check = cdk_manager.validate_cdk(request.cdk)
        if not cdk_check["valid"]:
            raise HTTPException(status_code=403, detail=cdk_check["message"])
        if cdk_check["remaining"] < len(request.verificationIds):
            raise HTTPException(
                status_code=403,
                detail=f"CDK 额度不足，需要 {len(request.verificationIds)} 次，剩余 {cdk_check['remaining']} 次"
            )
        cdk_remaining = cdk_check["remaining"]

    # ---- Determine capacity-aware allocation via node_health_monitor ----
    from node_health_monitor import node_health_monitor as _nhm, NODE_CONCURRENCY, capacity_tracker as _cap
    import config_manager as _cm_alloc
    _cfg_alloc = _cm_alloc.get_config()

    # Compute dynamic capacities for each node (real-time available, not max)
    capacities = {}

    # GetGem: fixed API capacity minus currently in-use
    if getgem_available:
        max_cap = NODE_CONCURRENCY.get("getgem", 10)
        capacities["getgem"] = _cap.available("getgem", max_cap)

    # Bot nodes: capacity = (concurrency_per_account × connected_accounts) minus in-use
    if bot_available:
        all_connected = tg_manager.get_all_clients()  # {account_id: client}
        tg_accounts = _cfg_alloc.get("telegramAccounts", [])
        for bot_type in ("oldbot", "blackbot", "dualbot"):
            per_account = NODE_CONCURRENCY.get(bot_type, 1)
            account_count = 0
            for acc in tg_accounts:
                if not acc.get("enabled", True):
                    continue
                if bot_type not in acc.get("assignedBots", ["dualbot"]):
                    continue
                if acc["id"] in all_connected and all_connected[acc["id"]].is_connected():
                    account_count += 1
            if account_count > 0:
                max_cap = per_account * account_count
                avail = _cap.available(bot_type, max_cap)
                if avail > 0:
                    capacities[bot_type] = avail

    if not capacities:
        raise HTTPException(status_code=400, detail="没有任何可用的验证节点")

    # Allocate VIDs by capacity + weight
    total = len(request.verificationIds)
    alloc = _nhm.allocate_by_capacity(total, capacities)

    if not alloc or sum(alloc.values()) == 0:
        raise HTTPException(status_code=400, detail="无法分配验证链接，所有节点不可用")

    # Build VID → original link mapping (for bot path to use correct program ID in URL)
    _vid_to_link = {}
    if request.links:
        import re as _re_links
        for link in request.links:
            m = _re_links.search(r'verificationId=([a-zA-Z0-9-]+)', link)
            if m:
                _vid_to_link[m.group(1)] = link

    # Split VIDs into node groups based on allocation counts
    node_vids = {}  # node_id -> [vid, ...]
    idx = 0
    for nid, count in alloc.items():
        node_vids[nid] = request.verificationIds[idx:idx + count]
        idx += count
    # Assign any remaining VIDs (from rounding) to the highest-capacity node
    if idx < total:
        top_node = max(alloc, key=alloc.get)
        node_vids[top_node] = node_vids.get(top_node, []) + request.verificationIds[idx:]

    alloc_log = ", ".join(f"{k}={len(node_vids.get(k, []))}" for k in alloc)
    print(f"[MixedMode] Smart routing: {alloc_log} (allocation: {alloc})")

    async def event_stream():
        import json as _json

        progress_events = []

        def fmt(data):
            broadcast_verify_event(data)
            progress_events.append(f"data: {_json.dumps(data, ensure_ascii=False)}\n\n")

        # Broadcast initial events
        for vid in request.verificationIds:
            assigned_node = next((nid for nid, vids in node_vids.items() if vid in vids), "unknown")
            fmt({"type": "progress", "vid": vid, "step": "submitted", "via": assigned_node, "message": f"等待验证 ({assigned_node})..."})

        all_results = []

        # ---- GetGem processor ----
        async def process_getgem_vid(vid):
            """Process a single VID via GetGem API."""
            _cap.acquire("getgem")
            try:
                fmt({"type": "progress", "vid": vid, "step": "warmup", "via": "getgem", "message": "GetGem: 文档生成中..."})
                async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                    cdk_list = [c.strip() for c in getgem_cdk.replace(',', '\n').split('\n') if c.strip()]
                    if not cdk_list:
                        return {"verificationId": vid, "status": "error", "success": False,
                                "message": "GetGem API CDK 未配置", "via": "getgem"}

                    submit_resp = None
                    error_detail = ""
                    for current_cdk in cdk_list:
                        submit_resp = await client.post(
                            f"{getgem_url}/api/verify",
                            json={"verificationId": vid, "cdk": current_cdk}
                        )
                        if submit_resp.status_code == 200:
                            error_detail = ""
                            break
                        error_detail = submit_resp.json().get("error", submit_resp.text[:100]) if submit_resp else "No response"
                        if "balance" in error_detail.lower() or "cdk" in error_detail.lower():
                            continue
                        else:
                            break

                    if submit_resp and submit_resp.status_code != 200:
                        return {"verificationId": vid, "status": "error", "success": False,
                                "message": _translate_getgem_error(error_detail), "via": "getgem"}

                    submit_data = submit_resp.json()

                    # Handle immediate rejection
                    if submit_data.get("status") == "rejected":
                        error_ids = submit_data.get("errorIds", [])
                        msg = submit_data.get("message", "Verification rejected")
                        if "expiredVerification" in error_ids:
                            msg = "验证链接已过期，请刷新页面获取新链接"
                        elif "invalidVerification" in error_ids:
                            msg = "无效的验证链接"
                        else:
                            msg = _translate_getgem_error(msg)
                        return {"verificationId": vid, "status": "rejected", "success": False,
                                "message": msg, "via": "getgem"}

                    task_id = submit_data.get("taskId")
                    if not task_id:
                        return {"verificationId": vid, "status": "error", "success": False,
                                "message": "未获取到 taskId", "via": "getgem"}

                    # Poll for result
                    fmt({"type": "progress", "vid": vid, "step": "waiting", "via": "getgem", "message": "GetGem: 等待验证结果..."})
                    for _ in range(60):
                        await asyncio.sleep(5)
                        status_resp = await client.get(f"{getgem_url}/api/status/{task_id}")
                        if status_resp.status_code != 200:
                            continue
                        status_data = status_resp.json()
                        if not status_data.get("completed"):
                            continue
                        if status_data.get("success"):
                            _cap.record_result("getgem", True)
                            return {"verificationId": vid, "status": "approved", "success": True,
                                    "message": "验证成功", "via": "getgem", "taskId": task_id}
                        else:
                            err_msg = status_data.get("message", "验证失败")
                            _cap.record_result("getgem", False)
                            return {"verificationId": vid, "status": "failed", "success": False,
                                    "message": _translate_getgem_error(err_msg), "via": "getgem", "taskId": task_id}

                    _cap.record_result("getgem", False)
                    return {"verificationId": vid, "status": "timeout", "success": False,
                            "message": "GetGem 验证超时", "via": "getgem"}
            except Exception as e:
                _cap.record_result("getgem", False)
                return {"verificationId": vid, "status": "error", "success": False,
                        "message": f"GetGem 错误: {str(e)}", "via": "getgem"}
            finally:
                _cap.release("getgem")

        # ---- Bot processor (single VID → single bot, no fallback) ----
        async def process_bot_vid(vid, bot_type):
            """Process a single VID via a specific bot type. No fallback."""
            _cap.acquire(bot_type)
            try:
                link = _vid_to_link.get(vid, f"https://services.sheerid.com/verify/{vid}/?verificationId={vid}")
                via_label = f"bot:{bot_type}"
                fmt({"type": "progress", "vid": vid, "step": "warmup", "via": via_label, "message": f"{bot_type}: 提交验证中..."})

                import config_manager as _cm
                _cfg = _cm.get_config()

                # Get client for this bot
                pool_item = None
                if bot_type == "dualbot":
                    pool_item = tg_manager.get_next_client(bot_type="dualbot")
                else:
                    accounts = _cfg.get("telegramAccounts", [])
                    all_clients = tg_manager.get_all_clients()
                    for acc in accounts:
                        if bot_type in acc.get("assignedBots", []) and acc.get("enabled"):
                            ci = all_clients.get(acc["id"])
                            if ci and ci.is_connected():
                                pool_item = (acc["id"], ci)
                                break

                if not pool_item:
                    return {"verificationId": vid, "status": "error", "success": False,
                            "message": f"没有可用的 {bot_type} 客户端", "via": via_label}

                acc_id, client = pool_item
                try:
                    async def on_progress(progress, _bt=bot_type):
                        fmt({"type": "progress", "vid": vid, "via": f"bot:{_bt}", **progress})

                    bot_config = {}
                    if bot_type == "dualbot":
                        bot_config = _cfg.get("verification", {}).get("dualBot", {})
                        bot_timeout = bot_config.get("timeout", 120)
                        result = await dual_bot.verify(
                            client=client, link=link, account_id=acc_id,
                            warmup_bot=bot_config.get("warmupBot"),
                            verify_bot=bot_config.get("verifyBot"),
                            auto_bypass=bot_config.get("autoBypass", True),
                            timeout=bot_timeout, on_progress=on_progress
                        )
                    else:
                        # SingleBot
                        for sb in _cfg.get("verification", {}).get("singleBots", []):
                            if sb.get("id") == bot_type:
                                bot_config = sb
                                break
                        bot_timeout = bot_config.get("timeout", 120)
                        single_verifier = GenericSingleBotVerifier(bot_config)
                        result = await single_verifier.verify(
                            client=client, link=link, account_id=acc_id,
                            timeout=bot_timeout, on_progress=on_progress
                        )

                    bot_stats_tracker.record(bot_type, result.get("success", False))
                    _cap.record_result(bot_type, result.get("success", False))

                    if result.get("success"):
                        return {"verificationId": vid, "status": "approved", "success": True,
                                "message": result.get("message", "验证成功"), "via": via_label,
                                "claimLink": result.get("claimLink")}
                    else:
                        return {"verificationId": vid, "status": result.get("status", "failed"),
                                "success": False, "message": result.get("message", "验证失败"),
                                "via": via_label}
                except Exception as e:
                    return {"verificationId": vid, "status": "error", "success": False,
                            "message": f"Bot 错误: {str(e)}", "via": via_label}
            finally:
                _cap.release(bot_type)

        # ---- Launch all VIDs in parallel (each to its assigned node) ----
        tasks = []
        for nid, vids in node_vids.items():
            for vid in vids:
                if nid == "getgem":
                    tasks.append(asyncio.create_task(process_getgem_vid(vid)))
                else:
                    tasks.append(asyncio.create_task(process_bot_vid(vid, nid)))

        # Stream progress while waiting for all tasks to complete
        while tasks and not all(t.done() for t in tasks):
            while progress_events:
                yield progress_events.pop(0)
            await asyncio.sleep(0.3)
        while progress_events:
            yield progress_events.pop(0)

        # Collect results
        for t in tasks:
            try:
                result = await t
                if result:
                    all_results.append(result)
            except Exception as e:
                logging.error(f"[MixedMode] Task error: {e}")

        # ---- Apply manual overrides (admin marked pass/fail while verification was running) ----
        for i, r in enumerate(all_results):
            vid = r.get("verificationId", "")
            override_status = consume_manual_override(vid)
            if override_status:
                all_results[i] = {
                    **r,
                    "status": "approved" if override_status == "pass" else "failed",
                    "success": override_status == "pass",
                    "message": "管理员手动标记为通过" if override_status == "pass" else "认证失败",
                    "via": r.get("via", "") + " (manual)",
                }

        # ---- Log results and deduct CDK ----
        for r in all_results:
            vid_log = r.get("verificationId", "")
            msg = r.get("message", "")
            via = r.get("via", "")
            if r.get("status") == "approved":
                bot_stats_tracker.record("getgem" if "getgem" in via else "bot", True)
                verification_history.log_verification("pass", vid_log, message=msg, cdk=request.cdk or "", via=via)
            elif not r.get("success") and not r.get("alreadyVerified"):
                bot_stats_tracker.record("getgem" if "getgem" in via else "bot", False)
                actual_status = r.get("status", "failed")
                verification_history.log_verification(actual_status, vid_log, message=msg or f"Rejected: {actual_status}", cdk=request.cdk or "", via=via)

        nonlocal cdk_remaining
        successful = sum(1 for r in all_results if r.get("status") == "approved")
        if request.cdk and successful > 0:
            deduct = cdk_manager.use_cdk(request.cdk, successful)
            cdk_remaining = deduct.get("remaining", cdk_remaining)

        # Broadcast done event to admin SSE so the overview log updates from "processing" to final status
        done_payload = {'type': 'done', 'results': all_results, 'stats': {'total': len(all_results), 'approved': successful, 'rejected': sum(1 for r in all_results if not r.get('success'))}, 'cdkRemaining': cdk_remaining}
        broadcast_verify_event(done_payload)
        yield f"data: {_json.dumps(done_payload, ensure_ascii=False)}\n\n"

    from starlette.responses import StreamingResponse
    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ========== Node Health Monitor API ==========

@app.get("/api/admin/node-health")
async def get_node_health():
    """Admin: Get all node statuses and monitor config."""
    from node_health_monitor import capacity_tracker as _cap_api
    return {
        "nodes": node_health_monitor.get_all_statuses(),
        "config": node_health_monitor.get_config(),
        "allocation": node_health_monitor.get_allocation(["getgem", "oldbot", "blackbot", "dualbot"]),
        "cooldowns": _cap_api.get_all_cooldowns(),
    }


@app.post("/api/admin/node-health/config")
async def update_node_health_config(request: dict):
    """Admin: Update monitor thresholds, mode, and locked allocation."""
    node_health_monitor.update_config(
        thresholds=request.get("thresholds"),
        mode=request.get("mode"),
        locked_allocation=request.get("lockedAllocation"),
    )
    return {"ok": True, "config": node_health_monitor.get_config()}


@app.post("/api/admin/node-health/refresh")
async def force_refresh_node_health():
    """Admin: Force immediate re-poll of all external APIs."""
    statuses = await node_health_monitor.force_refresh()
    return {
        "nodes": statuses,
        "allocation": node_health_monitor.get_allocation(["getgem", "oldbot", "blackbot", "dualbot"]),
    }


@app.post("/api/admin/node-health/toggle")
async def toggle_node_enabled(request: dict):
    """Admin: Enable/disable a specific node."""
    node_id = request.get("nodeId")
    enabled = request.get("enabled", True)
    if not node_id:
        raise HTTPException(status_code=400, detail="nodeId required")
    node_health_monitor.set_node_enabled(node_id, enabled)
    node_health_monitor._save_config()
    return {"ok": True, "nodeId": node_id, "enabled": enabled}


@app.post("/api/admin/node-health/weight")
async def set_node_weight(request: dict):
    """Admin: Set cost weight for a specific node."""
    node_id = request.get("nodeId")
    weight = request.get("weight", 1.0)
    if not node_id:
        raise HTTPException(status_code=400, detail="nodeId required")
    node_health_monitor.set_node_weight(node_id, float(weight))
    node_health_monitor._save_config()
    return {"ok": True, "nodeId": node_id, "weight": weight}


@app.post("/api/admin/node-health/clear-cooldown")
async def clear_node_cooldown(request: dict):
    """Admin: Manually clear cooldown for a specific node."""
    node_id = request.get("nodeId")
    if not node_id:
        raise HTTPException(status_code=400, detail="nodeId required")
    from node_health_monitor import capacity_tracker as _cap_api
    with _cap_api._lock:
        _cap_api._cooldown_until.pop(node_id, None)
        _cap_api._consecutive_failures.pop(node_id, None)
    return {"ok": True, "nodeId": node_id, "message": f"{node_id} cooldown cleared"}


@app.post("/api/admin/node-health/auto-maintenance")
async def toggle_auto_maintenance(request: dict):
    """Admin: Enable/disable auto maintenance mode."""
    enabled = request.get("enabled", False)
    node_health_monitor.set_auto_maintenance(bool(enabled))
    return {"ok": True, "autoMaintenance": enabled}


@app.get("/api/admin/notif-check")
async def check_notification_listener():
    """Admin: Diagnose DualBot notification listener status."""
    diag = {
        "handlerRegistered": tg_manager._notif_registered,
        "channel": "NotifSuccess",
        "connectedClients": len(tg_manager.get_all_clients()),
        "canResolveChannel": False,
        "recentMessages": [],
        "error": None,
    }
    try:
        # Try to resolve the channel entity via any connected client
        result = tg_manager.get_next_client()
        if not result:
            diag["error"] = "No connected Telegram client"
            return diag
        account_id, client = result
        entity = await client.get_entity("NotifSuccess")
        diag["canResolveChannel"] = True
        diag["channelInfo"] = f"{getattr(entity, 'title', '')} (id={entity.id})"
        # Fetch last 3 messages
        msgs = await client.get_messages(entity, limit=3)
        diag["recentMessages"] = [
            {"text": (m.text or "")[:120], "date": str(m.date)} for m in msgs
        ]
    except Exception as e:
        diag["error"] = str(e)
    return diag
# ========== Routing Stats API ==========

@app.get("/api/routing/stats")
async def get_routing_stats():
    """Get real-time success rates and recommended allocation for all verification nodes."""
    import config_manager
    config = config_manager.get_config()
    routing = config.get("aiGenerator", {}).get("routingStrategy", {})

    stats = bot_stats_tracker.get_all_stats()
    getgem_stats = stats.get("getgem", {"total": 0, "success": 0, "failed": 0, "rate": 0.5})
    
    # Aggregate bot stats
    bot_total = 0
    bot_success = 0
    bot_nodes = []
    for bot_id, s in stats.items():
        if bot_id == "getgem":
            continue
        bot_total += s["total"]
        bot_success += s["success"]
        bot_nodes.append({"id": bot_id, **s})
    
    bot_rate = bot_success / bot_total if bot_total > 0 else 0.5

    # Calculate recommended allocation
    total_rate = max(getgem_stats["rate"] + bot_rate, 0.01)
    rec_getgem = round(getgem_stats["rate"] / total_rate * 100)
    rec_bot = 100 - rec_getgem

    return {
        "getgem": getgem_stats,
        "bot": {"total": bot_total, "success": bot_success, "failed": bot_total - bot_success, "rate": round(bot_rate, 4)},
        "botNodes": bot_nodes,
        "recommended": {"getgem": rec_getgem, "bot": rec_bot},
        "current": routing.get("allocation", {"getgem": 50, "bot": 50}),
        "windowMinutes": bot_stats_tracker.window_minutes
    }


# ========== PUBLIC API v1 ==========
# CDK-authenticated API for external users

import uuid
from datetime import datetime as dt

# In-memory task store (in production, use Redis or DB)
_api_tasks = {}  # task_id -> task info dict

class PublicVerifyRequest(BaseModel):
    verificationId: str
    cdk: str

class PublicBatchVerifyRequest(BaseModel):
    verificationIds: List[str]
    cdk: str


def _validate_cdk_header(cdk: str) -> dict:
    """Validate CDK and return info or raise HTTPException."""
    if not cdk:
        raise HTTPException(status_code=401, detail="Missing CDK. Provide CDK via 'cdk' field or 'X-CDK-Key' header.")
    result = cdk_manager.validate_cdk(cdk)
    if not result["valid"]:
        raise HTTPException(status_code=403, detail=result["message"])
    return result


async def _dispatch_verification(vid: str, cdk_code: str) -> dict:
    """
    Dispatch a single verification to the configured provider.
    Returns a result dict with status, success, message, etc.
    """
    import config_manager
    config = config_manager.get_config()
    provider = config.get("aiGenerator", {}).get("provider", "gemini")

    # GetGem provider
    if provider == "getgem":
        import httpx
        getgem_config = config.get("aiGenerator", {}).get("getgem", {})
        getgem_cdk = getgem_config.get("cdk", "")
        getgem_url = getgem_config.get("apiUrl", "https://getgem.cc")
        if not getgem_cdk:
            return {"status": "error", "success": False, "message": "API CDK not configured on server"}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                resp = await client.post(f"{getgem_url}/api/verify", json={"verificationId": vid, "cdk": getgem_cdk})
                if resp.status_code != 200:
                    return {"status": "error", "success": False, "message": f"Submit failed ({resp.status_code})"}
                data = resp.json()
                task_id = data.get("taskId")
                if not task_id:
                    return {"status": "error", "success": False, "message": "No taskId returned"}
                # Poll
                interval = 5
                for _ in range(60):
                    await asyncio.sleep(interval)
                    sr = await client.get(f"{getgem_url}/api/status/{task_id}")
                    if sr.status_code == 429:
                        interval = min(interval * 2, 30)
                        continue
                    if sr.status_code != 200:
                        continue
                    sd = sr.json()
                    interval = 5
                    if sd.get("completed"):
                        if sd.get("success"):
                            return {"status": "approved", "success": True, "message": "Verification approved", "redirectUrl": sd.get("redirectUrl")}
                        else:
                            # GetGem may retry internally — re-poll before declaring failure
                            last_err = sd.get("error", "Verification rejected")
                            for _retry in range(6):
                                await asyncio.sleep(5)
                                rr = await client.get(f"{getgem_url}/api/status/{task_id}")
                                if rr.status_code == 200:
                                    rd = rr.json()
                                    if rd.get("completed") and rd.get("success"):
                                        return {"status": "approved", "success": True, "message": "Verification approved", "redirectUrl": rd.get("redirectUrl")}
                            return {"status": "rejected", "success": False, "message": last_err}
                return {"status": "timeout", "success": False, "message": "Polling timeout (5min)"}
        except Exception as e:
            return {"status": "error", "success": False, "message": str(e)}

    # Telegram provider — use unified multi-bot pool (DualBot + SingleBots)
    elif provider == "telegram":
        if not tg_manager.is_connected:
            return {"status": "error", "success": False, "message": "Not connected"}
        try:
            import re as _re_dp
            import time as _time_dp

            # Build verification link
            link = f"https://services.sheerid.com/verify/{vid}/?verificationId={vid}"

            # Collect all enabled bots (same logic as /api/verify/unified)
            dual_config = config.get("verification", {}).get("dualBot", {})
            single_bots_cfg = config.get("verification", {}).get("singleBots", [])

            enabled_bots = []
            if dual_config.get("enabled"):
                enabled_bots.append({"type": "dualbot", "config": dual_config})
            for sb in single_bots_cfg:
                if sb.get("enabled"):
                    enabled_bots.append({"type": sb["id"], "config": sb})

            if not enabled_bots:
                return {"status": "error", "success": False, "message": "系统错误，请联系管理员"}

            # Sort bots by node_health_monitor allocation weight
            from node_health_monitor import node_health_monitor as _nhm_dp
            _dp_ordered = _nhm_dp.get_ordered_nodes([b["type"] for b in enabled_bots])
            _dp_order_map = {nid: i for i, nid in enumerate(_dp_ordered)}
            sorted_bots = sorted(enabled_bots, key=lambda b: _dp_order_map.get(b["type"], 999))

            # Helper: get next client for a bot type
            def _get_client_dp(bot_id):
                now = _time_dp.time()
                if bot_id == "dualbot":
                    return tg_manager.get_next_client(bot_type="dualbot")
                if bot_id not in _singlebot_cooldowns:
                    _singlebot_cooldowns[bot_id] = {}
                accounts = config.get("telegramAccounts", [])
                valid_ids = []
                for acc in accounts:
                    if not acc.get("enabled", True):
                        continue
                    if bot_id not in acc.get("assignedBots", []):
                        continue
                    if _singlebot_cooldowns[bot_id].get(acc["id"], 0) > now:
                        continue
                    valid_ids.append(acc["id"])
                all_clients = tg_manager.get_all_clients()
                available = [(aid, all_clients[aid]) for aid in valid_ids
                             if aid in all_clients and all_clients[aid].is_connected()]
                if not available:
                    return None
                if not hasattr(_get_client_dp, '_idx'):
                    _get_client_dp._idx = {}
                if bot_id not in _get_client_dp._idx:
                    _get_client_dp._idx[bot_id] = 0
                _get_client_dp._idx[bot_id] = (_get_client_dp._idx[bot_id] + 1) % len(available)
                return available[_get_client_dp._idx[bot_id]]

            def _get_cooldown_dp(bot_id):
                if bot_id == "dualbot":
                    return tg_manager.get_shortest_cooldown_wait()
                now = _time_dp.time()
                if bot_id not in _singlebot_cooldowns:
                    return 0
                active = [exp - now for exp in _singlebot_cooldowns[bot_id].values() if exp > now]
                return min(active) if active else 0

            # Waterfall: try each bot in priority order
            last_result = None
            for bot_entry in sorted_bots:
                bot_type = bot_entry["type"]
                bot_config = bot_entry["config"]
                max_retries = bot_config.get("maxRetries", 5)
                bot_timeout = bot_config.get("verifyTimeout", bot_config.get("timeout", 180))

                single_verifier = None
                if bot_type != "dualbot":
                    single_verifier = GenericSingleBotVerifier(bot_config)

                async def noop_progress(progress):
                    pass  # Public API doesn't support SSE streaming

                bot_succeeded = False
                for attempt in range(max_retries):
                    pool_item = _get_client_dp(bot_type)

                    if not pool_item:
                        wait_time = _get_cooldown_dp(bot_type)
                        if wait_time > 0:
                            await asyncio.sleep(wait_time + 2)
                            pool_item = _get_client_dp(bot_type)
                        if not pool_item:
                            break  # No accounts for this bot, try next

                    acc_id, client = pool_item

                    if bot_type == "dualbot":
                        result = await dual_bot.verify(
                            client=client,
                            link=link,
                            account_id=acc_id,
                            warmup_bot=bot_config.get("warmupBot"),
                            verify_bot=bot_config.get("verifyBot"),
                            auto_bypass=bot_config.get("autoBypass", True),
                            timeout=bot_timeout,
                            on_progress=noop_progress
                        )
                    else:
                        result = await single_verifier.verify(
                            client=client,
                            link=link,
                            account_id=acc_id,
                            timeout=bot_timeout,
                            on_progress=noop_progress
                        )

                    if result.get("status") == "cooldown":
                        cd_seconds = result.get("cooldown_seconds", 90)
                        if bot_type == "dualbot":
                            tg_manager.set_cooldown(acc_id, cd_seconds)
                        else:
                            _singlebot_cooldowns[bot_type][acc_id] = _time_dp.time() + cd_seconds
                        if result.get("remaining_quota") is not None:
                            tg_manager.update_quota(acc_id, result["remaining_quota"])

                        # Verify-stage cooldown = link already consumed, do NOT retry
                        if result.get("cooldown_stage") == "verify":
                            last_result = result
                            bot_succeeded = True
                            break

                        continue

                    bot_stats_tracker.record(bot_type, result.get("success", False))
                    last_result = result

                    if result.get("success") or result.get("status") in ("failed", "rejected", "error"):
                        bot_succeeded = True
                        break

                    if result.get("status") == "no_credits":
                        break  # Try next bot

                    bot_succeeded = True
                    break

                if bot_succeeded:
                    break

            if last_result:
                return {
                    "status": last_result.get("status", "unknown"),
                    "success": last_result.get("success", False),
                    "message": last_result.get("message", ""),
                    "redirectUrl": last_result.get("claimLink") or last_result.get("redirectUrl")
                }

            return {"status": "error", "success": False, "message": "所有 Bot 均无法完成验证，请稍后重试"}

        except Exception as e:
            return {"status": "error", "success": False, "message": str(e)}

    # Direct API provider (curl_cffi)
    else:
        try:
            proxy = get_proxy_url()
            result = verify_single(vid, proxy=proxy)
            return {
                "status": "approved" if result.get("success") else "rejected",
                "success": result.get("success", False),
                "message": result.get("message", "")
            }
        except Exception as e:
            return {"status": "error", "success": False, "message": str(e)}


@app.get("/api/v1/health")
async def public_health():
    """Public health check — no authentication required."""
    import config_manager
    config = config_manager.get_config()
    provider = config.get("aiGenerator", {}).get("provider", "gemini")
    return {
        "status": "ok",
        "provider": provider,
        "version": "1.0.0",
        "timestamp": dt.now().isoformat()
    }


@app.post("/api/v1/verify")
async def public_verify(request: PublicVerifyRequest):
    """
    Submit a single verification request.
    Requires a valid CDK with remaining quota.
    Returns a taskId for polling status.
    """
    cdk_info = _validate_cdk_header(request.cdk)

    if cdk_info["remaining"] < 1:
        raise HTTPException(status_code=403, detail="CDK has no remaining quota")

    task_id = str(uuid.uuid4())
    _api_tasks[task_id] = {
        "taskId": task_id,
        "verificationId": request.verificationId,
        "cdk": request.cdk,
        "status": "pending",
        "completed": False,
        "success": False,
        "error": None,
        "redirectUrl": None,
        "createdAt": dt.now().isoformat()
    }

    # Run verification in background
    async def run_task():
        _api_tasks[task_id]["status"] = "processing"
        result = await _dispatch_verification(request.verificationId, request.cdk)
        _api_tasks[task_id]["status"] = result["status"]
        _api_tasks[task_id]["completed"] = True
        _api_tasks[task_id]["success"] = result.get("success", False)
        _api_tasks[task_id]["redirectUrl"] = result.get("redirectUrl")
        _api_tasks[task_id]["error"] = result.get("message") if not result.get("success") else None
        _api_tasks[task_id]["completedAt"] = dt.now().isoformat()

        # Log to history (skip user-side link issues)
        vid = request.verificationId
        if result["status"] == "approved":
            verification_history.log_verification("pass", vid, cdk=request.cdk)
            cdk_manager.use_cdk(request.cdk, 1)
        elif result["status"] == "rejected":
            reason = result.get("reason", "unknown")
            if reason not in ("link_opened", "expired", "invalid", "rate_limited"):
                verification_history.log_verification("failed", vid, cdk=request.cdk)
        elif result["status"] == "error":
            verification_history.log_verification("failed", vid, cdk=request.cdk)

    asyncio.create_task(run_task())

    return {
        "taskId": task_id,
        "verificationId": request.verificationId,
        "status": "pending",
        "message": "Verification task created"
    }


@app.post("/api/v1/verify/batch")
async def public_verify_batch(request: PublicBatchVerifyRequest):
    """
    Submit multiple verification requests at once.
    Each ID creates a separate task. Max 10 per request.
    """
    cdk_info = _validate_cdk_header(request.cdk)

    if not request.verificationIds:
        raise HTTPException(status_code=400, detail="No verification IDs provided")

    if len(request.verificationIds) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 IDs per batch request")

    if cdk_info["remaining"] < len(request.verificationIds):
        raise HTTPException(
            status_code=403,
            detail=f"Insufficient CDK quota: need {len(request.verificationIds)}, remaining {cdk_info['remaining']}"
        )

    tasks = []
    for vid in request.verificationIds:
        task_id = str(uuid.uuid4())
        _api_tasks[task_id] = {
            "taskId": task_id,
            "verificationId": vid,
            "cdk": request.cdk,
            "status": "pending",
            "completed": False,
            "success": False,
            "error": None,
            "redirectUrl": None,
            "createdAt": dt.now().isoformat()
        }

        async def run_task(tid=task_id, v=vid):
            _api_tasks[tid]["status"] = "processing"
            result = await _dispatch_verification(v, request.cdk)
            _api_tasks[tid]["status"] = result["status"]
            _api_tasks[tid]["completed"] = True
            _api_tasks[tid]["success"] = result.get("success", False)
            _api_tasks[tid]["redirectUrl"] = result.get("redirectUrl")
            _api_tasks[tid]["error"] = result.get("message") if not result.get("success") else None
            _api_tasks[tid]["completedAt"] = dt.now().isoformat()

            if result["status"] == "approved":
                verification_history.log_verification("pass", v, cdk=request.cdk)
                cdk_manager.use_cdk(request.cdk, 1)
            elif result["status"] == "rejected":
                reason = result.get("reason", "unknown")
                if reason not in ("link_opened", "expired", "invalid", "rate_limited"):
                    verification_history.log_verification("failed", v, cdk=request.cdk)
            elif result["status"] == "error":
                verification_history.log_verification("failed", v, cdk=request.cdk)

        asyncio.create_task(run_task())
        tasks.append({"taskId": task_id, "verificationId": vid, "status": "pending"})

    return {
        "tasks": tasks,
        "total": len(tasks),
        "message": f"{len(tasks)} verification tasks created"
    }


@app.get("/api/v1/status/{task_id}")
async def public_task_status(task_id: str):
    """
    Check the status of a verification task.
    Poll this endpoint until 'completed' is true.
    """
    task = _api_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        "taskId": task["taskId"],
        "verificationId": task["verificationId"],
        "status": task["status"],
        "completed": task["completed"],
        "success": task["success"],
        "error": task["error"],
        "redirectUrl": task["redirectUrl"],
        "createdAt": task["createdAt"],
        "completedAt": task.get("completedAt")
    }


@app.get("/api/v1/cdk/status")
async def public_cdk_status(x_cdk_key: Optional[str] = Header(None), cdk: Optional[str] = None):
    """
    Check CDK quota status.
    Pass CDK via 'X-CDK-Key' header or 'cdk' query parameter.
    """
    code = x_cdk_key or cdk
    if not code:
        raise HTTPException(status_code=400, detail="Provide CDK via 'X-CDK-Key' header or 'cdk' query param")

    result = cdk_manager.validate_cdk(code)
    if not result["valid"]:
        raise HTTPException(status_code=403, detail=result["message"])

    return {
        "code": code[:4] + "..." + code[-4:] if len(code) > 8 else "***",
        "total_uses": result.get("quota", 0),
        "remaining_uses": result.get("remaining", 0),
        "used_uses": result.get("quota", 0) - result.get("remaining", 0),
        "valid": True
    }


# ========== Maintenance Mode ==========

@app.get("/api/maintenance")
async def get_maintenance_status():
    """Get maintenance mode status (public, no auth needed)"""
    import config_manager
    config = config_manager.get_config()
    maintenance = config.get("maintenance", {"enabled": False, "message": "", "estimatedEnd": None})
    return {
        "enabled": maintenance.get("enabled", False),
        "message": maintenance.get("message", "系统维护中，请稍后再试"),
        "estimatedEnd": maintenance.get("estimatedEnd")
    }


@app.post("/api/maintenance")
async def toggle_maintenance(request: Request, authorization: Optional[str] = Header(None)):
    """Toggle maintenance mode (admin only)"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    data = await request.json()
    import config_manager
    
    result = config_manager.update_config({
        "maintenance": {
            "enabled": bool(data.get("enabled", False)),
            "message": data.get("message", "系统维护中，请稍后再试"),
            "estimatedEnd": data.get("estimatedEnd")
        }
    })
    
    if result:
        status = "ENABLED" if data.get("enabled") else "DISABLED"
        print(f"[Maintenance] Mode {status} by {user.get('email', 'unknown')}")
        return {
            "success": True,
            "maintenance": result.get("maintenance", {})
        }
    else:
        raise HTTPException(status_code=500, detail="保存失败")


# ========== Per-Service Maintenance Status ==========

@app.get("/api/service-status")
async def get_service_status():
    """Public: get per-service availability (auto-detect + manual override)."""
    import config_manager
    config = config_manager.get_config()
    manual = config.get("serviceMaintenance", {})

    # --- UPixel auto-detect ---
    upixel_ok = False
    upixel_reason = ""
    pixel_cfg = config.get("pixelApi", {})
    if manual.get("upixel"):
        upixel_reason = "管理员手动维护中"
    elif not pixel_cfg.get("enabled"):
        upixel_reason = "未启用"
    elif not pixel_cfg.get("apiKey"):
        upixel_reason = "未配置 API Key"
    else:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                h_resp = await client.get(f"{pixel_cfg.get('baseUrl', 'https://iqless.icu')}/api/health")
                if h_resp.status_code == 200:
                    h_data = h_resp.json()
                    if h_data.get("status") in ("ok", "healthy"):
                        # Check balance
                        b_resp = await client.get(
                            f"{pixel_cfg.get('baseUrl', 'https://iqless.icu')}/api/balance",
                            headers={"X-API-Key": pixel_cfg.get("apiKey", "")}
                        )
                        if b_resp.status_code == 200:
                            b_data = b_resp.json()
                            bal = b_data.get("balance", b_data.get("credits", 0))
                            if bal and bal > 0:
                                upixel_ok = True
                            else:
                                upixel_reason = "API 余额不足"
                        else:
                            # Instead of failing, assume the API is up but doesn't implement balance checking
                            upixel_ok = True
                            upixel_reason = ""
                    else:
                        upixel_reason = "API 离线"
                else:
                    upixel_reason = "API 离线"
        except Exception:
            upixel_reason = "无法连接 API"

    # --- KPixel auto-detect ---
    kpixel_ok = False
    kpixel_reason = ""
    kpixel_cfg = config.get("kpixelApi", {})
    if manual.get("kpixel"):
        kpixel_reason = "管理员手动维护中"
    elif not kpixel_cfg.get("enabled"):
        kpixel_reason = "未启用"
    elif not kpixel_cfg.get("cdkey"):
        kpixel_reason = "未配置 CDKey"
    else:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(kpixel_cfg.get("baseUrl", ""), json={
                    "action": "get_balance",
                    "cdkey": kpixel_cfg.get("cdkey", ""),
                })
                if resp.status_code == 200:
                    data = resp.json()
                    remaining = data.get("remaining_uses", data.get("balance", 0))
                    if remaining and remaining > 0:
                        kpixel_ok = True
                    else:
                        kpixel_reason = "API 余额不足"
                else:
                    kpixel_reason = "API 离线"
        except Exception:
            kpixel_reason = "无法连接 API"

    # --- VPixel auto-detect (shares 高级验证 tier with KPixel) ---
    vpixel_ok = False
    vpixel_reason = ""
    vpixel_cfg = config.get("vpixelApi", {})
    if manual.get("vpixel"):
        vpixel_reason = "管理员手动维护中"
    elif not vpixel_cfg.get("enabled"):
        vpixel_reason = "未启用"
    else:
        # Check card pool for available cards
        _vpc_count = database.get_connection().execute(
            "SELECT COUNT(*) FROM vpixel_cards WHERE status='available'"
        ).fetchone()[0]
        if _vpc_count == 0:
            vpixel_reason = "无可用卡密"
        else:
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.get(f"{vpixel_cfg.get('baseUrl', 'http://1688ai.vip')}/tasks/get_queue_up")
                    if resp.status_code == 200:
                        vpixel_ok = True
                    else:
                        vpixel_reason = "API 离线"
            except Exception:
                vpixel_reason = "无法连接 API"

    # Combined pro-tier availability: available if EITHER KPixel or VPixel or UPixel is up
    pro_available = kpixel_ok or vpixel_ok or upixel_ok
    pro_reason = ""
    if not pro_available:
        # Show the first meaningful reason
        if kpixel_reason and vpixel_reason:
            pro_reason = f"KPixel: {kpixel_reason}; VPixel: {vpixel_reason}"
        else:
            pro_reason = kpixel_reason or vpixel_reason

    # --- YPixel auto-detect ---
    ypixel_ok = False
    ypixel_reason = ""
    ypixel_cfg = config.get("ypixelApi", {})
    if manual.get("ypixel"):
        ypixel_reason = "管理员手动维护中"
    elif not ypixel_cfg.get("enabled"):
        ypixel_reason = "未启用"
    else:
        try:
            _ypc_count = database.get_connection().execute(
                "SELECT COUNT(*) FROM ypixel_cards WHERE status='available' AND remaining > 0"
            ).fetchone()[0]
            if _ypc_count == 0:
                ypixel_reason = "无可用卡密"
            else:
                ypixel_ok = True
        except Exception:
            ypixel_reason = "数据库查询失败"

    # Combined standard-tier: available if EITHER UPixel or YPixel is up
    standard_available = upixel_ok or ypixel_ok

    # --- GPT per-channel auto-detect ---
    gpt_channels_status = {}
    for ch in GPT_CHANNELS:
        maint_key = f"gpt_{ch}"
        if manual.get(maint_key):
            gpt_channels_status[ch] = {"available": False, "reason": "管理员手动维护中"}
        else:
            try:
                if ch == "tg":
                    if not _get_gpt_tg_config().get("enabled"):
                        gpt_channels_status[ch] = {"available": False, "reason": "TG Bot 通道未启用"}
                        continue
                    if not tg_manager.is_connected:
                        gpt_channels_status[ch] = {"available": False, "reason": "TG 账号未连接"}
                        continue
                    if not _has_available_gptbot_account(config):
                        gpt_channels_status[ch] = {"available": False, "reason": "无可用 GPTBot 账号"}
                        continue
                    gpt_channels_status[ch] = {"available": True, "reason": ""}
                    continue
                conn = database.get_connection()
                avail = conn.execute("SELECT COUNT(*) FROM gpt_keys WHERE status='available' AND channel=?", (ch,)).fetchone()[0]
                if avail > 0:
                    gpt_channels_status[ch] = {"available": True, "reason": ""}
                else:
                    gpt_channels_status[ch] = {"available": False, "reason": "无可用卡密"}
            except Exception:
                gpt_channels_status[ch] = {"available": False, "reason": "数据库查询失败"}
    gpt_ok = any(c["available"] for c in gpt_channels_status.values())
    gpt_reason = "" if gpt_ok else "所有充值通道不可用"

    # --- GPT Team auto-detect ---
    gpt_team_ok = False
    gpt_team_reason = ""
    if manual.get("gpt_team"):
        gpt_team_reason = "管理员手动维护中"
    else:
        try:
            conn = database.get_connection()
            active_with_seats = conn.execute(
                """
                SELECT COUNT(*) FROM gpt_team_accounts
                WHERE status = 'active' AND current_members < max_members
                """
            ).fetchone()[0]
            if active_with_seats > 0:
                gpt_team_ok = True
            else:
                gpt_team_reason = "暂无可用 Team 名额"
        except Exception:
            gpt_team_reason = "数据库查询失败"

    return {
        "upixel": {"available": upixel_ok, "reason": upixel_reason,
                   "ypixelUp": ypixel_ok, "standardAvailable": standard_available},
        "ypixel": {"available": ypixel_ok, "reason": ypixel_reason},
        "kpixel": {"available": pro_available, "reason": pro_reason,
                   "kpixelUp": kpixel_ok, "vpixelUp": vpixel_ok},
        "gpt": {"available": gpt_ok, "reason": gpt_reason, "channels": gpt_channels_status},
        "gpt_team": {"available": gpt_team_ok, "reason": gpt_team_reason},
        "manual": {
            "upixel": manual.get("upixel", False),
            "kpixel": manual.get("kpixel", False),
            "vpixel": manual.get("vpixel", False),
            "ypixel": manual.get("ypixel", False),
            "gpt_sbs": manual.get("gpt_sbs", False),
            "gpt_red": manual.get("gpt_red", False),
            "gpt_vip": manual.get("gpt_vip", False),
            "gpt_aic": manual.get("gpt_aic", False),
            "gpt_nitro": manual.get("gpt_nitro", False),
            "gpt_tg": manual.get("gpt_tg", False),
            "gpt_team": manual.get("gpt_team", False),
        }
    }


@app.post("/api/service-status")
async def toggle_service_maintenance(request: Request, authorization: Optional[str] = Header(None)):
    """Admin: toggle per-service manual maintenance."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")

    data = await request.json()
    import config_manager

    current = config_manager.get_config()
    sm = current.get("serviceMaintenance", {})
    # Only update provided fields
    for key in ("upixel", "kpixel", "vpixel", "ypixel", "gpt_sbs", "gpt_red", "gpt_vip", "gpt_aic", "gpt_nitro", "gpt_tg", "gpt_team"):
        if key in data:
            sm[key] = bool(data[key])

    result = config_manager.update_config({"serviceMaintenance": sm})
    if result:
        print(f"[ServiceMaint] Updated by {user.get('email', 'unknown')}: {sm}")
        return {"success": True, "serviceMaintenance": sm}
    else:
        raise HTTPException(status_code=500, detail="保存失败")


# ============================================================
# Email Alert Monitor — background thread checks service health
# ============================================================

import threading
import time as _time_mod

_alert_cooldowns = {}  # key -> last_sent_timestamp

def _run_alert_check():
    """Single pass: check all services and send alert email if issues found."""
    import config_manager as _acm
    import email_service

    alert_cfg = email_service.get_alert_config()
    if not alert_cfg.get("enabled") or not alert_cfg.get("email"):
        return

    cooldown_sec = int(alert_cfg.get("cooldownMinutes", 60)) * 60
    config = _acm.get_config()
    manual = config.get("serviceMaintenance", {})
    alerts = []

    # --- UPixel ---
    upixel_cfg = config.get("pixelApi", {})
    if upixel_cfg.get("enabled") and upixel_cfg.get("apiKey") and not manual.get("upixel"):
        try:
            import httpx as _hx
            resp = _hx.get(f"{upixel_cfg.get('baseUrl', '')}/api/health", timeout=5)
            if resp.status_code != 200:
                alerts.append({"service": "UPixel", "status": "离线", "reason": "API 无响应"})
            else:
                b_resp = _hx.get(
                    f"{upixel_cfg.get('baseUrl', '')}/api/balance",
                    headers={"Authorization": f"Bearer {upixel_cfg.get('apiKey', '')}"},
                    timeout=5,
                )
                if b_resp.status_code == 200:
                    b_data = b_resp.json()
                    bal = b_data.get("balance", b_data.get("credits", 0))
                    if not bal or bal <= 0:
                        alerts.append({"service": "UPixel", "status": "余额耗尽", "reason": f"当前余额: {bal}"})
                    elif bal <= 10:
                        alerts.append({"service": "UPixel", "status": "余额不足", "reason": f"当前余额: {bal}"})
                else:
                    alerts.append({"service": "UPixel", "status": "异常", "reason": "无法查询余额"})
        except Exception as e:
            alerts.append({"service": "UPixel", "status": "离线", "reason": f"连接失败"})

    # --- KPixel ---
    kpixel_cfg = config.get("kpixelApi", {})
    if kpixel_cfg.get("enabled") and kpixel_cfg.get("cdkey") and not manual.get("kpixel"):
        try:
            import httpx as _hx
            resp = _hx.post(
                kpixel_cfg.get("baseUrl", ""),
                json={"action": "get_balance", "cdkey": kpixel_cfg.get("cdkey", "")},
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                remaining = data.get("remaining_uses", data.get("balance", 0))
                if not remaining or remaining <= 0:
                    alerts.append({"service": "KPixel", "status": "余额不足", "reason": f"剩余: {remaining}"})
            else:
                alerts.append({"service": "KPixel", "status": "离线", "reason": f"HTTP {resp.status_code}"})
        except Exception:
            alerts.append({"service": "KPixel", "status": "离线", "reason": "连接失败"})

    # --- VPixel card pool ---
    vpixel_cfg = config.get("vpixelApi", {})
    if vpixel_cfg.get("enabled") and not manual.get("vpixel"):
        try:
            conn = database.get_connection()
            avail = conn.execute("SELECT COUNT(*) FROM vpixel_cards WHERE status='available' AND COALESCE(remaining, 1) > 0").fetchone()[0]
            if avail == 0:
                alerts.append({"service": "VPixel", "status": "卡密耗尽", "reason": "可用卡密: 0"})
            elif avail <= 3:
                alerts.append({"service": "VPixel", "status": "卡密不足", "reason": f"可用卡密: {avail}"})
        except Exception:
            alerts.append({"service": "VPixel", "status": "异常", "reason": "数据库查询失败"})

    # --- YPixel card pool ---
    ypixel_cfg = config.get("ypixelApi", {})
    if ypixel_cfg.get("enabled") and not manual.get("ypixel"):
        try:
            conn = database.get_connection()
            avail = conn.execute("SELECT COUNT(*) FROM ypixel_cards WHERE status='available' AND remaining > 0").fetchone()[0]
            if avail == 0:
                alerts.append({"service": "YPixel", "status": "卡密耗尽", "reason": "可用卡密: 0"})
            elif avail <= 3:
                alerts.append({"service": "YPixel", "status": "卡密不足", "reason": f"可用卡密: {avail}"})
        except Exception:
            alerts.append({"service": "YPixel", "status": "异常", "reason": "数据库查询失败"})

    # --- GPT channels ---
    for ch_name, ch_label in [("sbs", "GPT-SBS"), ("red", "GPT-RED"), ("vip", "GPT-VIP"), ("aic", "GPT-AIC")]:
        if manual.get(f"gpt_{ch_name}"):
            continue
        try:
            conn = database.get_connection()
            avail = conn.execute("SELECT COUNT(*) FROM gpt_keys WHERE status='available' AND channel=?", (ch_name,)).fetchone()[0]
            if avail == 0:
                alerts.append({"service": ch_label, "status": "卡密耗尽", "reason": "可用卡密: 0"})
        except Exception:
            pass

    if not alerts:
        return

    # Apply cooldown
    now = _time_mod.time()
    new_alerts = []
    for a in alerts:
        key = f"{a['service']}:{a['status']}"
        last_sent = _alert_cooldowns.get(key, 0)
        if now - last_sent >= cooldown_sec:
            new_alerts.append(a)
            _alert_cooldowns[key] = now

    if not new_alerts:
        return

    print(f"[AlertMonitor] Sending alert for {len(new_alerts)} issues to {alert_cfg['email']}")
    email_service.send_alert_email(alert_cfg["email"], new_alerts)


def _alert_monitor_loop():
    """Background thread: run alert checks every 5 minutes."""
    _time_mod.sleep(30)
    while True:
        try:
            _run_alert_check()
        except Exception as e:
            print(f"[AlertMonitor] Error: {e}")
        _time_mod.sleep(300)


def start_alert_monitor():
    """Start the alert monitor background thread."""
    t = threading.Thread(target=_alert_monitor_loop, daemon=True, name="alert-monitor")
    t.start()
    print("[AlertMonitor] Background alert monitor started (interval: 5min)")


@app.get("/api/alerts/config")
async def alerts_get_config(authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    import email_service
    return email_service.get_alert_config()


@app.post("/api/alerts/config")
async def alerts_update_config(request: Request, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    body = await request.json()
    import config_manager
    updates = {}
    if "enabled" in body:
        updates["enabled"] = bool(body["enabled"])
    if "email" in body:
        updates["email"] = body["email"]
    if "cooldownMinutes" in body:
        updates["cooldownMinutes"] = int(body["cooldownMinutes"])
    result = config_manager.update_config({"alertConfig": updates})
    if result:
        return {"success": True}
    raise HTTPException(status_code=500, detail="保存失败")


@app.post("/api/alerts/test")
async def alerts_send_test(authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    import email_service
    alert_cfg = email_service.get_alert_config()
    to = alert_cfg.get("email", "")
    if not to:
        raise HTTPException(status_code=400, detail="未配置警报邮箱")
    ok = email_service.send_alert_email(to, [
        {"service": "测试", "status": "测试警报", "reason": "这是一封测试邮件，确认警报通知正常工作。"},
    ])
    if ok:
        return {"success": True, "message": f"测试邮件已发送到 {to}"}
    raise HTTPException(status_code=500, detail="发送失败，请检查 SMTP 配置")


# ========== Pixel API Proxy Routes (Google One via iqless.icu) ==========

import httpx

# Track active Pixel API polling tasks: job_id -> asyncio.Task
_pixel_polling_tasks: dict = {}
_pixel_job_context: dict = {}
_kpixel_job_context: dict = {}
_vpixel_job_context: dict = {}
_ypixel_job_context: dict = {}


# ========== Pixel Job Sweep (server-side safety net) ==========

async def _pixel_job_sweep():
    """
    Periodic sweep: every 5 minutes, find all 'processing' pixel jobs
    and check their upstream status. Auto-finalize any that reached a
    terminal state. This is the safety net for when users close their
    browser before a job completes.
    """
    import config_manager
    await asyncio.sleep(30)  # Wait for server to fully start
    print("[PixelSweep] Background job sweep started (every 5 min)")

    while True:
        try:
            cfg = config_manager.load_config()
            pixel = cfg.get("pixelApi", {})
            api_key = pixel.get("apiKey", "")
            base_url = pixel.get("baseUrl", "https://iqless.icu")

            if not api_key:
                await asyncio.sleep(300)
                continue

            conn = database.get_connection()
            rows = conn.execute(
                "SELECT verification_id, cdk, email, via FROM verification_history "
                "WHERE status = 'processing' AND via IN ('pixel', 'pixel_auto') "
                "ORDER BY rowid DESC LIMIT 200"
            ).fetchall()

            if not rows:
                await asyncio.sleep(300)
                continue

            finalized_count = 0
            for row in rows:
                vid = row["verification_id"]
                if not vid:
                    continue

                # Skip if frontend is actively polling (context exists)
                if _pixel_job_context.get(vid):
                    continue

                cdk_val = row["cdk"] or ""
                email = row["email"] or ""
                user_id = 0
                if cdk_val.startswith("user:"):
                    try:
                        user_id = int(cdk_val.replace("user:", ""))
                    except ValueError:
                        pass
                if not user_id:
                    continue

                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.get(
                            f"{base_url}/api/jobs/{vid}",
                            headers={"X-API-Key": api_key},
                        )
                    sse_source = "pixel_auto" if "auto" in (row.get("via") or "") else "pixel"
                    if resp.status_code in (404, 502, 503):
                        # Upstream lost this job — mark failed and refund
                        sweep_cost = 1.5 if "auto" in (sse_source or "") else 1.0
                        _finalize_user_failure(vid, user_id, "失败: 上游任务已丢失", via=sse_source, refund_cost=sweep_cost, email=email)
                        _complete_async_task("pixel", vid)
                        _pixel_job_context.pop(vid, None)
                        finalized_count += 1
                        continue
                    if resp.status_code != 200:
                        continue

                    data = resp.json()
                    upstream_status = data.get("status", "")

                    if upstream_status == "success":
                        url = data.get("url", "")
                        sweep_cost = 1.5 if "auto" in (sse_source or "") else 1.0
                        _finalize_user_success(vid, user_id, sweep_cost, f"✅ 订阅成功: {url}" if url else "✅ 订阅成功", via=sse_source, email=email)
                        _complete_async_task("pixel", vid)
                        _pixel_job_context.pop(vid, None)
                        finalized_count += 1
                    elif upstream_status in ("failed", "cancelled"):
                        err = data.get("error", "UNKNOWN_ERROR")
                        rm = data.get("result_msg", "")
                        disp = rm if rm else err
                        sweep_cost = 1.5 if "auto" in (sse_source or "") else 1.0
                        _finalize_user_failure(vid, user_id, f"失败: {disp}", via=sse_source, refund_cost=sweep_cost, email=email)
                        _complete_async_task("pixel", vid)
                        _pixel_job_context.pop(vid, None)
                        finalized_count += 1
                    # queued/running — leave for next sweep

                except Exception as e:
                    logging.debug(f"[PixelSweep] Error checking {vid}: {e}")
                    continue

                await asyncio.sleep(0.5)  # Rate limit upstream calls

            if finalized_count > 0:
                print(f"[PixelSweep] Finalized {finalized_count} orphaned jobs out of {len(rows)} processing")

        except Exception as e:
            logging.warning(f"[PixelSweep] Sweep error: {e}")

        await asyncio.sleep(300)  # Every 5 minutes


@app.on_event("startup")
async def startup_pixel_sweep():
    asyncio.create_task(_pixel_job_sweep())


def _get_pixel_config():
    """Get Pixel API config from config_manager."""
    import config_manager
    cfg = config_manager.load_config()
    pixel = cfg.get("pixelApi", {})
    return {
        "enabled": pixel.get("enabled", False),
        "apiKey": pixel.get("apiKey", ""),
        "baseUrl": pixel.get("baseUrl", "https://iqless.icu"),
    }


def _user_cdk_tag(user_id: int) -> str:
    return f"user:{user_id}" if user_id else ""


def _get_user_verification_row(verification_id: str, user_id: int):
    if not verification_id or not user_id:
        return None
    conn = database.get_connection()
    return conn.execute(
        "SELECT id, status, message FROM verification_history WHERE verification_id = ? AND cdk = ? ORDER BY rowid DESC LIMIT 1",
        (verification_id, _user_cdk_tag(user_id)),
    ).fetchone()


def _is_terminal_history_status(status: str) -> bool:
    return (status or "").lower() in ("pass", "failed")


def _upsert_user_verification_result(verification_id: str, user_id: int, status: str, message: str, via: str = "", email: str = ""):
    if not verification_id or not user_id:
        return {"updated": False, "status": status}

    conn = database.get_connection()
    now = datetime.utcnow().isoformat() + "Z"
    cdk_tag = _user_cdk_tag(user_id)
    existing = _get_user_verification_row(verification_id, user_id)

    if existing:
        if existing["status"] == status and (existing["message"] or "") == (message or ""):
            return {"updated": False, "status": existing["status"]}
        conn.execute(
            "UPDATE verification_history SET status = ?, message = ?, timestamp = ?, via = ?, email = ? WHERE id = ?",
            (status, message, now, via, email, existing["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4())[:8], status, verification_id, message, cdk_tag, now, via, email),
        )
    conn.commit()
    return {"updated": True, "status": status}


def _deduct_user_credits_or_raise(user_id: int, cost: float, detail: str):
    if not user_id or cost <= 0:
        return {"deducted": False}
    result = auth.deduct_credits(user_id, cost)
    if not result:
        raise HTTPException(status_code=400, detail=detail)
    logging.info(f"[credits] Reserved {cost} credits from user {user_id}")

    return {"deducted": True}


def _refund_user_credits(user_id: int, cost: float, verification_id: str, via: str = ""):
    if not user_id or cost <= 0:
        return {"refunded": False}
    try:
        auth.update_credits(user_id, cost)
        logging.info(f"[{via or 'task'}] Refunded {cost} credits to user {user_id} for {verification_id}")
        return {"refunded": True}
    except Exception as e:
        logging.warning(f"[{via or 'task'}] Credit refund failed for user {user_id} on {verification_id}: {e}")
        return {"refunded": False}


def _deduct_user_credits_for_reconciliation(user_id: int, cost: float, verification_id: str, via: str = ""):
    if not user_id or cost <= 0:
        return {"deducted": False, "forced": False}
    try:
        result = auth.deduct_credits(user_id, cost)
        if result:
            logging.info(f"[{via or 'task'}] Re-deducted {cost} credits from user {user_id} for late success {verification_id}")
            return {"deducted": True, "forced": False}
        # Insufficient credits — log warning but do NOT force negative balance
        logging.warning(f"[{via or 'task'}] Late-success deduction skipped for user {user_id} (insufficient credits) for {verification_id}")
        return {"deducted": False, "forced": False, "reason": "insufficient_credits"}
    except Exception as e:
        logging.warning(f"[{via or 'task'}] Late-success deduction failed for user {user_id} on {verification_id}: {e}")
        return {"deducted": False, "forced": False, "error": str(e)}


def _finalize_user_success(verification_id: str, user_id: int, cost: float, message: str, via: str = "", email: str = ""):
    existing = _get_user_verification_row(verification_id, user_id)
    if existing and existing["status"] == "pass":
        return {
            "finalized": True,
            "deducted": False,
            "already_done": True,
            "status": "pass",
        }

    if existing and existing["status"] == "failed":
        deduction = _deduct_user_credits_for_reconciliation(user_id, cost, verification_id, via=via)
        note = "（晚到成功，已补扣）"
        if deduction.get("forced"):
            note = "（晚到成功，已强制补扣）"
        elif not deduction.get("deducted"):
            note = "（晚到成功，补扣失败）"
        final_message = f"{message} {note}".strip()
        _upsert_user_verification_result(verification_id, user_id, "pass", final_message, via=via, email=email)
        return {
            "finalized": True,
            "deducted": deduction.get("deducted", False),
            "already_done": False,
            "status": "pass",
            "reconciled": True,
            "forcedDeduction": deduction.get("forced", False),
        }

    _upsert_user_verification_result(verification_id, user_id, "pass", message, via=via, email=email)
    return {"finalized": True, "deducted": False, "already_done": False}


def _finalize_user_failure(verification_id: str, user_id: int, message: str, via: str = "", refund_cost: float = 0, email: str = ""):
    existing = _get_user_verification_row(verification_id, user_id)
    if existing and _is_terminal_history_status(existing["status"]):
        # Even if already recorded, still attempt refund if cost > 0
        # Previous bug: skipping refund here caused credits to be lost
        if refund_cost and existing["status"] == "failed":
            refund_result = _refund_user_credits(user_id, refund_cost, verification_id, via=via)
            logging.info(f"[{via or 'task'}] Late refund attempt for already-finalized {verification_id}: refunded={refund_result.get('refunded')}")
        return {
            "finalized": existing["status"] == "failed",
            "status": existing["status"],
            "already_done": True,
        }
    refund_result = _refund_user_credits(user_id, refund_cost, verification_id, via=via) if refund_cost else {"refunded": False}
    result = _upsert_user_verification_result(verification_id, user_id, "failed", message, via=via, email=email)
    result["refunded"] = refund_result.get("refunded", False)
    return result

def _is_timeout_error(exc: Exception) -> bool:
    return isinstance(exc, (asyncio.TimeoutError, TimeoutError, httpx.TimeoutException))


def _register_async_task(task_type: str, task_id: str, payload: dict):
    _save_pending_async_task(task_type, task_id, payload)


def _complete_async_task(task_type: str, task_id: str):
    _remove_pending_async_task(task_type, task_id)


async def _resume_pending_pixel_task(task_id: str, payload: dict):
    """Recover a pending Pixel task after service restart: one-shot upstream query to finalize."""
    cost = payload.get("cost", 1.0)
    mode = payload.get("mode", "semi-auto")
    user_id = int(payload.get("user_id", 0) or 0)
    email = payload.get("email", "")
    sse_source = "pixel_auto" if mode == "auto" else "pixel"
    event_meta = _build_verify_event_meta(sse_source, email, user_id, "pixel_api")

    # Store context so GET endpoint can also finalize if frontend polls
    _pixel_job_context[task_id] = payload

    try:
        pixel_cfg = _get_pixel_config()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{pixel_cfg['baseUrl']}/api/jobs/{task_id}",
                headers={"X-API-Key": pixel_cfg["apiKey"]},
            )
        if resp.status_code != 200:
            logging.warning(f"[Pixel] Restart recovery: upstream returned {resp.status_code} for {task_id}")
            return

        data = resp.json()
        status = data.get("status", "")

        if status == "success":
            url = data.get("url", "")
            result = _finalize_user_success(task_id, user_id, cost, f"✅ 订阅成功: {url}" if url else "✅ 订阅成功", via=sse_source, email=email)
            _complete_async_task("pixel", task_id)
            if not result.get("already_done"):
                broadcast_verify_event({
                    "type": "progress", "vid": task_id, "step": "result",
                    "status": "approved", "success": True,
                    "message": "✅ 获取成功（重启恢复）",
                    "url": url, "recovered": True,
                    **event_meta,
                })
        elif status == "failed":
            error = data.get("error", "UNKNOWN_ERROR")
            _finalize_user_failure(task_id, user_id, f"失败: {error}", via=sse_source, refund_cost=cost, email=email)
            _complete_async_task("pixel", task_id)
            broadcast_verify_event({
                "type": "progress", "vid": task_id, "step": "result",
                "status": "failed", "success": False,
                "message": f"❌ {error}（重启恢复）",
                "recovered": True,
                **event_meta,
            })
        else:
            # Still queued/running — leave in pending tasks, frontend GET endpoint will finalize when ready
            logging.info(f"[Pixel] Restart recovery: {task_id} still {status}, leaving as pending")
    except Exception as e:
        logging.warning(f"[Pixel] Restart recovery error for {task_id}: {e}")
    finally:
        if task_id not in _pixel_job_context:
            _pixel_job_context.pop(task_id, None)



async def _resume_pending_kpixel_task(task_id: str, payload: dict):
    try:
        await _kpixel_poll_job(int(task_id), payload["email"], int(payload["user_id"]), _get_kpixel_config())
    finally:
        _kpixel_job_context.pop(str(task_id), None)


async def _resume_pending_vpixel_task(task_id: str, payload: dict):
    try:
        await _vpixel_poll_job(payload["card"], payload.get("account_line", ""), payload["email"], int(payload["user_id"]), _get_vpixel_config(), task_id)
    finally:
        _vpixel_job_context.pop(task_id, None)


async def _resume_pending_ypixel_task(task_id: str, payload: dict):
    try:
        cfg = _get_ypixel_config()
        await _ypixel_poll_job(payload["remote_task_id"], payload["card_key"], payload["email"], int(payload["user_id"]), cfg, task_id)
    finally:
        _ypixel_job_context.pop(task_id, None)


async def _resume_pending_gpt_task(task_id: str, payload: dict):
    card_key = payload.get("card_key", "")
    email = payload.get("email", "")
    channel = payload.get("channel", "sbs")
    user_id = int(payload.get("user_id", 0) or 0)
    event_meta = _build_verify_event_meta("gpt", email or "GPT充值", user_id, f"gpt_{channel}", card_key, channel)
    if card_key:
        _release_gpt_key(card_key)
    broadcast_verify_event({
        "type": "progress",
        "step": "result", "status": "failed", "success": False,
        "message": "❌ 充值任务因服务重启中断，已恢复为失败",
        "recovered": True,
        "vid": task_id,
        **event_meta,
    })
    _complete_async_task("gpt", task_id)




class PixelJobRequest(BaseModel):
    email: str
    password: str
    totp_secret: str
    cdk: str = ""
    priority: int = 0
    mode: str = "semi-auto"


@app.post("/api/pixel/jobs")
async def pixel_submit_job(request: PixelJobRequest, authorization: Optional[str] = Header(None)):
    """Submit a Pixel API job — validates user credits, proxies to iqless.icu, starts background poller."""
    pixel_cfg = _get_pixel_config()
    if not pixel_cfg["enabled"] or not pixel_cfg["apiKey"]:
        _broadcast_submit_failure(
            "pixel",
            "Pixel API 未启用或未配置 API Key",
            email=request.email,
            method="pixel_api",
            http_status=503,
        )
        raise HTTPException(status_code=503, detail="Pixel API 未启用或未配置 API Key")

    # Auth via JWT token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="账号已被禁用")
    user_id = user.get("id")
    credits = user.get("credits", 0)
    cost = 1.5 if request.mode == "auto" else 1.0
    sse_source = "pixel_auto" if request.mode == "auto" else "pixel"
    import verification_history
    import uuid
    existing_success = verification_history.get_successful_history_by_email(request.email, user_id)
    if existing_success:
        job_id = existing_success.get("verificationId") or existing_success.get("id") or ("auto-" + str(uuid.uuid4())[:8])
        event_meta = _build_verify_event_meta(sse_source, request.email, user_id, "pixel_api")
        msg = existing_success.get("message", "")
        url = msg.replace("✅ 获取成功: ", "").replace("✅ 订阅成功: ", "").replace("✅ 获取成功", "").replace("✅ 订阅成功", "").strip()
        if not url.startswith("http"):
            url = ""
        
        broadcast_verify_event({
            "type": "progress",
            "vid": job_id,
            "step": "result", "status": "approved",
            "success": True,
            "message": "✅ 验证已成功（获取历史记录）",
            "url": url,
            "forceTerminalUpdate": True,
            **event_meta,
        })
        return {
            "job_id": job_id,
            "status": "success",
            "queue_position": -1,
            "estimated_wait_seconds": 0,
        }

    if credits < cost:
        raise HTTPException(status_code=400, detail=f"积分不足（需要 {cost} 积分）")

    _deduct_user_credits_or_raise(user_id, cost, f"积分不足（需要 {cost} 积分）")

    # Proxy to Pixel API
    base_url = pixel_cfg["baseUrl"]
    headers = {
        "X-API-Key": pixel_cfg["apiKey"],
        "Content-Type": "application/json",
    }
    normalized_totp_secret = re.sub(r"\s+", "", request.totp_secret or "")
    payload = {
        "email": request.email,
        "password": request.password,
        "totp_secret": normalized_totp_secret,
        "priority": request.priority,
        "mode": request.mode,
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{base_url}/api/jobs", headers=headers, json=payload)

        if resp.status_code == 200:
            data = resp.json()
            job_id = data.get("job_id", "")
            # Store job context for GET endpoint to use during finalization
            # (no background polling — frontend polls GET /api/pixel/jobs/{id} which auto-finalizes)
            _pixel_job_context[job_id] = {"email": request.email, "user_id": user_id, "cost": cost, "mode": request.mode}
            _register_async_task("pixel", job_id, _pixel_job_context[job_id])

            # Write initial processing record to DB so sweep can find this job
            # even if the user closes browser and in-memory context is lost
            sse_source_tag = "pixel_auto" if request.mode == "auto" else "pixel"
            _upsert_user_verification_result(
                job_id, user_id, "processing",
                "任务已提交，等待设备处理...",
                via=sse_source_tag, email=request.email
            )

            # Broadcast initial submitted event for admin SSE
            event_meta = _build_verify_event_meta(sse_source_tag, request.email, user_id, "pixel_api")
            broadcast_verify_event({
                "type": "progress",
                "vid": job_id,
                "step": "submitted",
                "message": "任务已提交，等待设备处理...",
                **event_meta,
            })

            return {
                "job_id": job_id,
                "status": data.get("status", "queued"),
                "queue_position": data.get("queue_position", -1),
                "estimated_wait_seconds": data.get("estimated_wait_seconds", 0),
            }
        else:
            refund_result = _refund_user_credits(user_id, cost, request.email, via="pixel_submit")
            # 409 Conflict = email already has an active job — just inform, don't record as failure
            if resp.status_code == 409:
                raise HTTPException(status_code=409, detail="该邮箱已在队列中，请等待当前任务完成")
            # Other errors: parse upstream response
            try:
                err = resp.json()
                detail = err.get("detail", {})
                if isinstance(detail, dict):
                    msg = detail.get("message", f"Pixel API 错误: HTTP {resp.status_code}")
                    code = detail.get("code", "")
                else:
                    msg = str(detail)
                    code = ""
            except Exception:
                msg = f"Pixel API 错误: HTTP {resp.status_code}"
                code = ""
            final_detail = f"{code}: {msg}" if code else msg
            _record_submit_failure(
                "pixel",
                final_detail,
                email=request.email,
                user_id=user_id,
                method="pixel_api",
                http_status=resp.status_code,
                upstream_status=resp.status_code,
                refunded=refund_result.get("refunded", False),
                via=sse_source,
            )
            raise HTTPException(status_code=resp.status_code, detail=final_detail)

    except httpx.HTTPError as e:
        refund_result = _refund_user_credits(user_id, cost, request.email, via="pixel_submit")
        _record_submit_failure(
            "pixel",
            f"无法连接 Pixel API: {str(e)}",
            email=request.email,
            user_id=user_id,
            method="pixel_api",
            http_status=502,
            refunded=refund_result.get("refunded", False),
            via=sse_source,
        )
        raise HTTPException(status_code=502, detail=f"无法连接 Pixel API: {str(e)}")


@app.get("/api/pixel/jobs/{job_id}")
async def pixel_get_job(job_id: str):
    """Get Pixel job status. Auto-finalizes on terminal states (success/failed)."""
    import database
    conn = database.get_connection()
    # Check local DB first for already-finalized jobs
    row = conn.execute("SELECT status, message FROM verification_history WHERE verification_id = ? AND status IN ('pass', 'failed') ORDER BY rowid DESC LIMIT 1", (job_id,)).fetchone()
    if row:
        status = row["status"]
        msg = row["message"]
        if status == "pass":
            url = msg.replace("✅ 获取成功: ", "").replace("✅ 订阅成功: ", "").replace("✅ 验证已成功（获取历史记录）", "").strip()
            if not url.startswith("http"):
                url = ""
            return {"job_id": job_id, "status": "success", "url": url, "queue_position": -1, "estimated_wait_seconds": 0}
        else:
            return {"job_id": job_id, "status": "failed", "error": msg, "queue_position": -1, "estimated_wait_seconds": 0}

    pixel_cfg = _get_pixel_config()
    if not pixel_cfg["apiKey"]:
        raise HTTPException(status_code=503, detail="Pixel API 未配置")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{pixel_cfg['baseUrl']}/api/jobs/{job_id}",
                headers={"X-API-Key": pixel_cfg["apiKey"]},
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        data = resp.json()
        upstream_status = data.get("status", "")
        ctx = _pixel_job_context.get(job_id) or {}

        # Fallback: if no in-memory context (e.g. server restarted), recover from DB
        if not ctx.get("user_id") and upstream_status in ("success", "failed", "cancelled"):
            try:
                conn = database.get_connection()
                row = conn.execute(
                    "SELECT cdk, email, via FROM verification_history WHERE verification_id = ? ORDER BY rowid DESC LIMIT 1",
                    (job_id,)
                ).fetchone()
                if row:
                    cdk_val = row["cdk"] or ""
                    db_email = row["email"] or ""
                    uid_from_db = 0
                    if cdk_val.startswith("user:"):
                        try:
                            uid_from_db = int(cdk_val.replace("user:", ""))
                        except ValueError:
                            pass
                    if uid_from_db:
                        # Determine cost by via/mode: pixel_auto=1.5, pixel=1.0
                        row_via = row["via"] if "via" in row.keys() else ""
                        recover_cost = 1.5 if "auto" in (row_via or "") else 1.0
                        ctx = {"user_id": uid_from_db, "email": db_email, "cost": recover_cost, "mode": "auto" if "auto" in (row_via or "") else "semi-auto"}
                        _pixel_job_context[job_id] = ctx
            except Exception:
                pass

        cost = ctx.get("cost", 1.0)
        user_id = ctx.get("user_id")
        email = ctx.get("email", "")
        sse_source = "pixel_auto" if ctx.get("mode") == "auto" else "pixel"
        event_meta = _build_verify_event_meta(sse_source, email, user_id, "pixel_api") if user_id else {}

        # Auto-finalize on terminal states (idempotent via _finalize_user_*)
        if upstream_status == "success" and user_id:
            url = data.get("url", "")
            result = _finalize_user_success(job_id, user_id, cost, f"✅ 订阅成功: {url}" if url else "✅ 订阅成功", via=sse_source, email=email)
            _complete_async_task("pixel", job_id)
            # Stop any lingering background poll
            task = _pixel_polling_tasks.pop(job_id, None)
            if task and not task.done():
                task.cancel()
            if not result.get("already_done"):
                broadcast_verify_event({
                    "type": "progress",
                    "vid": job_id,
                    "step": "result",
                    "status": "approved",
                    "success": True,
                    "message": "✅ 获取成功（补偿确认）" if result.get("reconciled") else "✅ 获取成功",
                    "url": url,
                    "forceTerminalUpdate": bool(result.get("reconciled")),
                    "reconciledLateSuccess": bool(result.get("reconciled")),
                    **event_meta,
                })
            _pixel_job_context.pop(job_id, None)
            data["status"] = "success"

        elif upstream_status == "failed" and user_id:
            error = data.get("error", "UNKNOWN_ERROR")
            result_msg = data.get("result_msg", "")
            display_msg = result_msg if (error in ("MANUAL_CANCEL", "INVALID_ACCOUNT") and result_msg) else error
            result = _finalize_user_failure(job_id, user_id, f"失败: {display_msg}", via=sse_source, refund_cost=cost, email=email)
            _complete_async_task("pixel", job_id)
            task = _pixel_polling_tasks.pop(job_id, None)
            if task and not task.done():
                task.cancel()
            if not result.get("already_done"):
                broadcast_verify_event({
                    "type": "progress",
                    "vid": job_id,
                    "step": "result",
                    "status": "failed",
                    "success": False,
                    "message": f"❌ {display_msg}",
                    "error": error,
                    "result_msg": result_msg,
                    **event_meta,
                })
            _pixel_job_context.pop(job_id, None)

        elif upstream_status == "cancelled" and user_id:
            error = data.get("error", "MANUAL_CANCEL")
            result = _finalize_user_failure(job_id, user_id, f"已取消: {error}", via=sse_source, refund_cost=cost, email=email)
            _complete_async_task("pixel", job_id)
            task = _pixel_polling_tasks.pop(job_id, None)
            if task and not task.done():
                task.cancel()
            if not result.get("already_done"):
                broadcast_verify_event({
                    "type": "progress",
                    "vid": job_id,
                    "step": "result",
                    "status": "cancelled",
                    "success": False,
                    "message": "🚫 任务已取消，积分已退还",
                    **event_meta,
                })
            _pixel_job_context.pop(job_id, None)

        elif upstream_status in ("queued", "running") and event_meta:
            # Broadcast progress for admin SSE
            queue_pos = data.get("queue_position", -1)
            estimated_wait = data.get("estimated_wait_seconds", 0)
            stage = data.get("stage", 0)
            total_stages = data.get("total_stages", 6)
            stage_label = data.get("stage_label", "")
            if upstream_status == "queued":
                if queue_pos >= 0:
                    msg = f"⏳ 排队中 (前方 {queue_pos} 个任务)"
                else:
                    msg = "⏳ 排队中..."
            else:
                pct = min(round((stage / total_stages) * 100), 99) if total_stages > 0 else 0
                msg = f"🔄 {pct}%"
            broadcast_verify_event({
                "type": "progress",
                "vid": job_id,
                "step": "processing",
                "status": upstream_status,
                "stage": stage,
                "totalStages": total_stages,
                "stageLabel": stage_label,
                "queuePosition": queue_pos,
                "message": msg,
                **event_meta,
            })

        return data

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/pixel/jobs/{job_id}/confirm")
async def pixel_confirm_job(job_id: str, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    pixel_cfg = _get_pixel_config()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{pixel_cfg['baseUrl']}/api/jobs/{job_id}",
            headers={"X-API-Key": pixel_cfg["apiKey"]},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    status = data.get("status", "")
    ctx = _pixel_job_context.get(job_id) or {}
    cost = ctx.get("cost", 1.0)
    sse_source = "pixel_auto" if ctx.get("mode") == "auto" else "pixel"
    event_meta = _build_verify_event_meta(sse_source, ctx.get("email", ""), user.get("id"), "pixel_api")
    if status == "success":
        url = data.get("url", "")
        result = _finalize_user_success(job_id, user.get("id"), cost, f"✅ 订阅成功: {url}" if url else "✅ 订阅成功", via=sse_source, email=ctx.get("email", ""))
        _complete_async_task("pixel", job_id)
        broadcast_verify_event({
            "type": "progress",
            "vid": job_id,
            "step": "result",
            "status": "approved",
            "success": True,
            "message": "✅ 获取成功（补偿确认）" if result.get("reconciled") else "✅ 获取成功",
            "url": url,
            "forceTerminalUpdate": bool(result.get("reconciled")),
            "reconciledLateSuccess": bool(result.get("reconciled")),
            **event_meta,
        })
        return {"success": True, "status": "success", "confirmed": True, "finalized": result}
    if status == "failed":
        error = data.get("error", "UNKNOWN_ERROR")
        _finalize_user_failure(job_id, user.get("id"), f"失败: {error}", via="pixel", refund_cost=cost, email=ctx.get("email", ""))
        _complete_async_task("pixel", job_id)
        return {"success": True, "status": "failed", "confirmed": True}
    return {"success": True, "status": status or "pending", "confirmed": False}


@app.post("/api/pixel/jobs/{job_id}/cancel")
async def pixel_cancel_job(job_id: str, authorization: Optional[str] = Header(None)):
    """Cancel a queued Pixel job — calls upstream cancel API, refunds credits."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    ctx = _pixel_job_context.get(job_id) or {}
    user_id = ctx.get("user_id", 0)
    cost = ctx.get("cost", 1.0)
    email = ctx.get("email", "")
    sse_source = "pixel_auto" if ctx.get("mode") == "auto" else "pixel"

    # Regular users can only cancel their own jobs
    is_admin = user.get("role") == "admin"
    if not is_admin and user.get("id") != user_id:
        raise HTTPException(status_code=403, detail="只能取消自己的任务")

    # Call upstream cancel API
    pixel_cfg = _get_pixel_config()
    upstream_cancelled = False
    upstream_error = ""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{pixel_cfg['baseUrl']}/api/jobs/{job_id}/cancel",
                headers={"X-API-Key": pixel_cfg["apiKey"]},
            )
        if resp.status_code == 200:
            data = resp.json()
            upstream_cancelled = data.get("success", False)
        else:
            try:
                err_data = resp.json()
                upstream_error = err_data.get("message", f"HTTP {resp.status_code}")
            except Exception:
                upstream_error = f"HTTP {resp.status_code}"
    except Exception as e:
        upstream_error = str(e)

    if not upstream_cancelled and upstream_error:
        # If upstream says task is not cancellable (e.g. already running), return error
        if "running" in upstream_error.lower() or "invalid_status" in upstream_error.lower():
            raise HTTPException(status_code=409, detail=f"任务无法取消: {upstream_error}")

    # Cancel local polling task if any
    task = _pixel_polling_tasks.pop(job_id, None)
    if task and not task.done():
        task.cancel()

    # Finalize as failed + refund
    cancel_msg = "用户取消" if not is_admin else "管理员取消"
    event_meta = _build_verify_event_meta(sse_source, email, user_id, "pixel_api") if user_id else {}
    _finalize_user_failure(job_id, user_id or user.get("id", 0), f"已取消: {cancel_msg}", via=sse_source, refund_cost=cost, email=email)
    _complete_async_task("pixel", job_id)
    _pixel_job_context.pop(job_id, None)

    broadcast_verify_event({
        "type": "progress",
        "vid": job_id,
        "step": "result",
        "status": "cancelled",
        "success": False,
        "message": f"🚫 {cancel_msg}，积分已退还",
        "forceTerminalUpdate": True,
        **event_meta,
    })
    return {"success": True, "cancelled": True, "job_id": job_id, "refunded": True}


@app.get("/api/pixel/health")
async def pixel_health():
    """Proxy: Pixel API health check (no auth required on remote side)."""
    pixel_cfg = _get_pixel_config()
    base_url = pixel_cfg.get("baseUrl", "https://iqless.icu")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{base_url}/api/health")
        if resp.status_code == 200:
            return resp.json()
        return {"status": "error", "httpStatus": resp.status_code}
    except Exception as e:
        return {"status": "offline", "error": str(e)}


@app.get("/api/pixel/balance")
async def pixel_balance():
    """Proxy: get Pixel API key balance."""
    pixel_cfg = _get_pixel_config()
    if not pixel_cfg["apiKey"]:
        raise HTTPException(status_code=503, detail="Pixel API 未配置")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{pixel_cfg['baseUrl']}/api/balance",
                headers={"X-API-Key": pixel_cfg["apiKey"]},
            )
        if resp.status_code == 200:
            return resp.json()
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/pixel/queue")
async def pixel_queue():
    """Proxy: get Pixel API queue status."""
    pixel_cfg = _get_pixel_config()
    if not pixel_cfg["apiKey"]:
        raise HTTPException(status_code=503, detail="Pixel API 未配置")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{pixel_cfg['baseUrl']}/api/queue",
                headers={"X-API-Key": pixel_cfg["apiKey"]},
            )
        if resp.status_code == 200:
            return resp.json()
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/admin/recover-timeout-jobs")
async def admin_recover_timeout_jobs(authorization: Optional[str] = Header(None)):
    """Recover jobs that were marked as timeout failures — re-query upstream for actual status."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    admin = auth.verify_token(token)
    if not admin or admin.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")

    import database
    conn = database.get_connection()

    # Find all timeout failures (Pixel/UPixel only) from today
    today = datetime.now().strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT id, verification_id, message, via, email
           FROM verification_history
           WHERE status = 'failed'
             AND timestamp >= ?
             AND (message LIKE '%排队超时%' OR message LIKE '%轮询超时%' OR message LIKE '%运行%超时%')
             AND (via IN ('pixel', 'pixel_auto') OR via = '')
           ORDER BY rowid DESC""",
        (today,)
    ).fetchall()

    if not rows:
        return {"recovered": 0, "total": 0, "results": [], "message": "没有找到今天的超时记录"}

    pixel_cfg = _get_pixel_config()
    if not pixel_cfg["apiKey"]:
        raise HTTPException(status_code=503, detail="Pixel API 未配置")

    results = []
    recovered = 0

    async with httpx.AsyncClient(timeout=15) as client:
        for row in rows:
            vid = row["verification_id"]
            email = row["email"] or ""
            via = row["via"] or "pixel"

            if not vid:
                results.append({"vid": vid, "action": "skip", "reason": "no verification_id"})
                continue

            try:
                resp = await client.get(
                    f"{pixel_cfg['baseUrl']}/api/jobs/{vid}",
                    headers={"X-API-Key": pixel_cfg["apiKey"]},
                )
                if resp.status_code != 200:
                    results.append({"vid": vid, "action": "skip", "reason": f"upstream HTTP {resp.status_code}"})
                    continue

                data = resp.json()
                upstream_status = data.get("status", "unknown")

                if upstream_status == "success":
                    url = data.get("url", "")
                    # Find user_id from the cdk field (format: "user:123")
                    cdk = conn.execute("SELECT cdk FROM verification_history WHERE verification_id = ? ORDER BY rowid DESC LIMIT 1", (vid,)).fetchone()
                    cdk_val = cdk["cdk"] if cdk else ""
                    user_id = 0
                    if cdk_val and cdk_val.startswith("user:"):
                        try:
                            user_id = int(cdk_val.replace("user:", ""))
                        except ValueError:
                            pass

                    if user_id:
                        # Update record to success (this will also handle credit reconciliation)
                        result = _finalize_user_success(vid, user_id, 0, f"✅ 订阅成功: {url}" if url else "✅ 订阅成功", via=via, email=email)
                        sse_source = via or "pixel"
                        event_meta = _build_verify_event_meta(sse_source, email, user_id, "pixel_api")
                        broadcast_verify_event({
                            "type": "progress", "vid": vid, "step": "result",
                            "status": "approved", "success": True,
                            "message": "✅ 获取成功（超时恢复）",
                            "url": url, "recovered": True,
                            **event_meta,
                        })
                        recovered += 1
                        results.append({"vid": vid, "email": email, "action": "recovered_success", "url": url})
                    else:
                        # Can't find user_id, just update the record directly
                        conn.execute(
                            "UPDATE verification_history SET status = 'pass', message = ? WHERE verification_id = ? AND status = 'failed'",
                            (f"✅ 订阅成功: {url}" if url else "✅ 订阅成功（超时恢复）", vid)
                        )
                        conn.commit()
                        recovered += 1
                        results.append({"vid": vid, "email": email, "action": "recovered_success_no_user", "url": url})

                elif upstream_status == "failed":
                    error = data.get("error", "UNKNOWN_ERROR")
                    result_msg = data.get("result_msg", "")
                    display_error = result_msg if result_msg else error
                    # Update DB record with real error (replace misleading timeout message)
                    conn.execute(
                        "UPDATE verification_history SET message = ? WHERE verification_id = ? AND status = 'failed'",
                        (f"失败: {display_error}", vid)
                    )
                    conn.commit()
                    results.append({"vid": vid, "email": email, "action": "confirmed_failed", "error": error, "updated": True})

                elif upstream_status in ("queued", "running"):
                    # Still active — spawn background poller to track to completion
                    cdk = conn.execute("SELECT cdk FROM verification_history WHERE verification_id = ? ORDER BY rowid DESC LIMIT 1", (vid,)).fetchone()
                    cdk_val = cdk["cdk"] if cdk else ""
                    user_id = 0
                    if cdk_val and cdk_val.startswith("user:"):
                        try:
                            user_id = int(cdk_val.replace("user:", ""))
                        except ValueError:
                            pass

                    if user_id:
                        # Restore context
                        recover_cost = 1.5 if "auto" in (row.get("via") or "") else 1.0
                        _pixel_job_context[vid] = {"email": email, "user_id": user_id, "cost": recover_cost, "mode": "auto" if "auto" in (row.get("via") or "") else "semi-auto"}
                        conn.execute(
                            "UPDATE verification_history SET status = 'processing', message = '⏳ 已恢复，正在查询上游...' WHERE verification_id = ? AND status = 'failed'",
                            (vid,)
                        )
                        conn.commit()

                        # Spawn background poller for this job
                        async def _recovery_poll(job_id, api_key, base_url):
                            """Poll upstream every 15s until terminal state, then finalize."""
                            import asyncio
                            max_attempts = 240  # 240 × 15s = 1 hour max
                            for attempt in range(max_attempts):
                                await asyncio.sleep(15)
                                try:
                                    ctx = _pixel_job_context.get(job_id)
                                    if not ctx:
                                        return  # Already finalized by another path (e.g. frontend GET)
                                    async with httpx.AsyncClient(timeout=15) as c:
                                        r = await c.get(
                                            f"{base_url}/api/jobs/{job_id}",
                                            headers={"X-API-Key": api_key},
                                        )
                                    if r.status_code != 200:
                                        continue
                                    d = r.json()
                                    st = d.get("status", "")
                                    uid = ctx.get("user_id")
                                    cost = ctx.get("cost", 0)
                                    em = ctx.get("email", "")
                                    sse_src = "pixel_auto" if ctx.get("mode") == "auto" else "pixel"
                                    evt_meta = _build_verify_event_meta(sse_src, em, uid, "pixel_api") if uid else {}

                                    if st == "success":
                                        url = d.get("url", "")
                                        result = _finalize_user_success(job_id, uid, cost, f"✅ 订阅成功: {url}" if url else "✅ 订阅成功", via=sse_src, email=em)
                                        _complete_async_task("pixel", job_id)
                                        if not result.get("already_done"):
                                            broadcast_verify_event({"type": "progress", "vid": job_id, "step": "result", "status": "approved", "success": True, "message": "✅ 获取成功（恢复确认）", "url": url, **evt_meta})
                                        _pixel_job_context.pop(job_id, None)
                                        return
                                    elif st in ("failed", "cancelled"):
                                        err = d.get("error", "UNKNOWN_ERROR")
                                        rm = d.get("result_msg", "")
                                        disp = rm if rm else err
                                        _finalize_user_failure(job_id, uid, f"失败: {disp}", via=sse_src, refund_cost=cost, email=em)
                                        _complete_async_task("pixel", job_id)
                                        broadcast_verify_event({"type": "progress", "vid": job_id, "step": "result", "status": "failed", "success": False, "message": f"❌ {disp}", **evt_meta})
                                        _pixel_job_context.pop(job_id, None)
                                        return
                                    # Still queued/running — broadcast progress
                                    qp = d.get("queue_position", -1)
                                    stg = d.get("stage", 0)
                                    ts = d.get("total_stages", 6)
                                    if st == "queued" and qp >= 0:
                                        msg = f"⏳ 排队中 (前方 {qp} 个任务)"
                                    elif st == "running":
                                        pct = min(round((stg / ts) * 100), 99) if ts > 0 else 0
                                        msg = f"🔄 {pct}%"
                                    else:
                                        msg = "⏳ 排队中..."
                                    if evt_meta:
                                        broadcast_verify_event({"type": "progress", "vid": job_id, "step": "processing", "status": st, "message": msg, **evt_meta})
                                except Exception as poll_err:
                                    print(f"[Recovery Poll] {job_id} error: {poll_err}")
                                    continue
                            # Timed out after 1 hour of polling
                            _pixel_job_context.pop(job_id, None)

                        asyncio.create_task(_recovery_poll(vid, pixel_cfg["apiKey"], pixel_cfg["baseUrl"]))
                        recovered += 1
                        results.append({"vid": vid, "email": email, "action": "restored_polling", "upstream_status": upstream_status})
                    else:
                        results.append({"vid": vid, "email": email, "action": "skip_active_no_user", "upstream_status": upstream_status})
                else:
                    results.append({"vid": vid, "email": email, "action": "unknown_status", "upstream_status": upstream_status})

            except Exception as e:
                results.append({"vid": vid, "action": "error", "error": str(e)})

    return {
        "total": len(rows),
        "recovered": recovered,
        "results": results,
        "message": f"共 {len(rows)} 条超时记录，恢复了 {recovered} 条",
    }



@app.get("/api/pixel/history")
async def pixel_history(limit: int = 50, offset: int = 0):
    """Proxy: get Pixel API success history."""
    pixel_cfg = _get_pixel_config()
    if not pixel_cfg["apiKey"]:
        raise HTTPException(status_code=503, detail="Pixel API 未配置")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{pixel_cfg['baseUrl']}/api/history",
                headers={"X-API-Key": pixel_cfg["apiKey"]},
                params={"limit": limit, "offset": offset},
            )
        if resp.status_code == 200:
            return resp.json()
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/pixel/config")
async def pixel_get_config(authorization: Optional[str] = Header(None)):
    """Get Pixel API configuration (admin only)."""
    _verify_admin_token(authorization)
    pixel_cfg = _get_pixel_config()
    # Mask API key
    api_key = pixel_cfg.get("apiKey", "")
    if api_key and len(api_key) > 12:
        masked = api_key[:8] + "..." + api_key[-4:]
    else:
        masked = api_key
    return {
        "enabled": pixel_cfg["enabled"],
        "apiKey": masked,
        "baseUrl": pixel_cfg["baseUrl"],
        "hasKey": bool(api_key),
    }


@app.post("/api/pixel/config")
async def pixel_update_config(request: Request, authorization: Optional[str] = Header(None)):
    """Update Pixel API configuration (admin only)."""
    _verify_admin_token(authorization)
    import config_manager
    body = await request.json()

    updates = {}
    if "enabled" in body:
        updates["enabled"] = bool(body["enabled"])
    if "apiKey" in body and body["apiKey"]:
        updates["apiKey"] = body["apiKey"]
    if "baseUrl" in body:
        updates["baseUrl"] = body["baseUrl"]

    result = config_manager.update_config({"pixelApi": updates})
    if result:
        return {"success": True}
    raise HTTPException(status_code=500, detail="保存失败")


@app.get("/api/result")
async def get_result_by_email(email: str, authorization: Optional[str] = Header(None)):
    """Query verification result by email — no credits required.
    
    Allows users who have insufficient credits to still retrieve their
    already-completed verification result (e.g., UPixel subscription URL).
    
    Returns the most recent successful (pass) record for this user's email.
    If a job is still in progress, returns running status.
    If not found, returns HTTP 404.
    """
    # Auth via JWT token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="账号已被禁用")

    if not email:
        raise HTTPException(status_code=400, detail="请提供 email 参数")

    user_id = user.get("id")
    import verification_history

    # 1. Check for a successful (pass) record
    existing_success = verification_history.get_successful_history_by_email(email, user_id)
    if existing_success:
        msg = existing_success.get("message", "")
        via = existing_success.get("via", "")
        # Extract URL from message field (stored as "✅ 订阅成功: https://..." or similar)
        url = (
            msg.replace("✅ 获取成功: ", "")
               .replace("✅ 订阅成功: ", "")
               .replace("✅ 获取成功（补偿确认）", "")
               .replace("✅ 验证已成功（获取历史记录）", "")
               .replace("✅ 获取成功", "")
               .replace("✅ 订阅成功", "")
               .strip()
        )
        if not url.startswith("http"):
            url = ""
        return {
            "email": email,
            "status": "success",
            "mode": "auto" if ("auto" in via) else "semi-auto",
            "url": url,
            "result_msg": msg,
            "created_at": existing_success.get("timestamp", ""),
        }

    # 2. Check if this email has an active in-progress pixel job
    for job_id, ctx in list(_pixel_job_context.items()):
        if ctx.get("email") == email and ctx.get("user_id") == user_id:
            return {
                "email": email,
                "status": "running",
                "mode": "auto" if ctx.get("mode") == "auto" else "semi-auto",
                "job_id": job_id,
            }

    # 3. Check other pixel provider contexts
    for job_id, ctx in list(_kpixel_job_context.items()):
        if ctx.get("email") == email and ctx.get("user_id") == user_id:
            return {"email": email, "status": "running", "mode": "semi-auto", "job_id": job_id}

    for job_id, ctx in list(_vpixel_job_context.items()):
        if ctx.get("email") == email and ctx.get("user_id") == user_id:
            return {"email": email, "status": "running", "mode": "semi-auto", "job_id": job_id}

    # 4. Not found
    raise HTTPException(
        status_code=404,
        detail={"code": "not_found", "message": "未找到该邮箱的记录"},
    )


# ========== KPixel API (Pro Tier) ==========

def _get_kpixel_config():
    """Get KPixel API config from config_manager."""
    import config_manager
    cfg = config_manager.load_config()
    kp = cfg.get("kpixelApi", {})
    return {
        "enabled": kp.get("enabled", False),
        "cdkey": kp.get("cdkey", ""),
        "baseUrl": kp.get("baseUrl", "https://2key.kckc1818.com/openapi.php"),
        "creditCost": kp.get("creditCost", 1.5),
    }


_kpixel_polling_tasks: dict = {}


async def _kpixel_poll_job(task_id: int, email: str, user_id: int, kpixel_cfg: dict):
    """Background task: poll KPixel API job status and broadcast SSE events."""
    import time
    base_url = kpixel_cfg["baseUrl"]
    cdkey = kpixel_cfg["cdkey"]
    credit_cost = kpixel_cfg.get("creditCost", 1.5)
    start_time = time.time()
    event_meta = _build_verify_event_meta("kpixel", email, user_id, "kpixel_api")

    broadcast_verify_event({
        "type": "progress",
        "vid": str(task_id),
        "step": "submitted",
        "message": "任务已提交，等待设备处理...",
        **event_meta,
    })

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                wait_seconds = _next_pixel_poll_interval(time.time() - start_time)
                if wait_seconds is None:
                    _finalize_user_failure(str(task_id), user_id, "KPixel 失败: 轮询超时", via="kpixel", refund_cost=credit_cost, email=email)
                    _complete_async_task("kpixel", str(task_id))
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": str(task_id),
                        "step": "result", "status": "failed",
                        "success": False,
                        "message": "❌ 轮询超时",
                        "elapsed": round(time.time() - start_time, 1),
                        **event_meta,
                    })
                    break

                await asyncio.sleep(wait_seconds)
                try:
                    resp = await client.post(base_url, json={
                        "action": "get_status",
                        "cdkey": cdkey,
                        "task_id": task_id,
                    })
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    if not data.get("success"):
                        continue
                except Exception:
                    continue

                info = data.get("data", {})
                status = info.get("status", "")
                message = info.get("message", "")
                elapsed = time.time() - start_time

                # Map status for SSE
                if status == "Pending":
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": str(task_id),
                        "step": "processing", "status": "queued",
                        "message": "⏳ 排队中...",
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })
                elif status == "Running":
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": str(task_id),
                        "step": "processing", "status": "running",
                        "message": f"🔄 运行中... {message}" if message else "🔄 运行中...",
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })
                elif status == "Success":
                    result = _finalize_user_success(str(task_id), user_id, credit_cost, f"KPixel 成功: {message}", via="kpixel", email=email)
                    _complete_async_task("kpixel", str(task_id))
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": str(task_id),
                        "step": "result", "status": "approved",
                        "success": True,
                        "message": f"✅ {message}（补偿确认）" if result.get("reconciled") else (f"✅ {message}" if message else "✅ 验证成功"),
                        "elapsed": round(elapsed, 1),
                        "forceTerminalUpdate": bool(result.get("reconciled")),
                        "reconciledLateSuccess": bool(result.get("reconciled")),
                        **event_meta,
                    })
                    break
                elif status == "Failed":
                    _finalize_user_failure(str(task_id), user_id, f"KPixel 失败: {message}", via="kpixel", refund_cost=credit_cost, email=email)
                    _complete_async_task("kpixel", str(task_id))
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": str(task_id),
                        "step": "result", "status": "failed",
                        "success": False,
                        "message": f"❌ {message}" if message else "❌ 验证失败",
                        "error": message,
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })
                    break

    except asyncio.CancelledError:
        _finalize_user_failure(str(task_id), user_id, "KPixel 失败: 轮询取消", via="kpixel", refund_cost=credit_cost, email=email)
        _complete_async_task("kpixel", str(task_id))
    except Exception as e:
        logging.error(f"[KPixel] Poll error for task {task_id}: {e}")
        _finalize_user_failure(str(task_id), user_id, f"KPixel 失败: {'轮询超时' if _is_timeout_error(e) else f'轮询错误: {str(e)}'}", via="kpixel", refund_cost=credit_cost, email=email)
        _complete_async_task("kpixel", str(task_id))
        broadcast_verify_event({
            "type": "progress",
            "vid": str(task_id),
            "step": "result", "status": "failed",
            "success": False,
            "message": f"❌ 轮询错误: {str(e)}",
            **event_meta,
        })
    finally:
        _kpixel_polling_tasks.pop(task_id, None)


class KPixelJobRequest(BaseModel):
    email: str
    password: str
    twofa: str
    cdk: str = ""


@app.post("/api/kpixel/jobs")
async def kpixel_submit_job(request: KPixelJobRequest, authorization: Optional[str] = Header(None)):
    """Submit a Pro-tier job — round-robins between KPixel and VPixel when both enabled."""
    global _pro_tier_counter

    kpixel_cfg = _get_kpixel_config()
    vpixel_cfg = _get_vpixel_config()

    kpixel_available = kpixel_cfg["enabled"] and kpixel_cfg["cdkey"]
    # VPixel: check card pool for available cards
    vpixel_available = vpixel_cfg["enabled"]
    _vpixel_card_row = None
    if vpixel_available:
        _vpc_conn = database.get_connection()
        _vpixel_card_row = _vpc_conn.execute(
            "SELECT id, card_key, remaining, total_count FROM vpixel_cards WHERE status='available' AND COALESCE(remaining, 1) > 0 ORDER BY COALESCE(remaining, 1) DESC, id ASC LIMIT 1"
        ).fetchone()
        if not _vpixel_card_row:
            vpixel_available = False

    # Check service maintenance flags
    import config_manager as _cfg_mgr
    _maint = _cfg_mgr.get_config().get("serviceMaintenance", {})
    if _maint.get("kpixel"):
        kpixel_available = False
    if _maint.get("vpixel"):
        vpixel_available = False

    # Real-time KPixel balance check — skip if 0 balance
    if kpixel_available:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(kpixel_cfg.get("baseUrl", ""), json={
                    "action": "get_balance",
                    "cdkey": kpixel_cfg.get("cdkey", ""),
                })
                if resp.status_code == 200:
                    bal_data = resp.json()
                    remaining = bal_data.get("remaining_uses", bal_data.get("balance", 0))
                    if not remaining or remaining <= 0:
                        print("[ProTier] KPixel balance is 0, marking unavailable")
                        kpixel_available = False
                else:
                    print(f"[ProTier] KPixel balance check failed: HTTP {resp.status_code}")
                    kpixel_available = False
        except Exception as e:
            print(f"[ProTier] KPixel balance check error: {e}")
            kpixel_available = False

    # Note: VPixel has no balance API — get_queue_up returns queue length, not credits.
    # We rely on the submit response to detect quota issues and fallback to KPixel.

    if not kpixel_available and not vpixel_available:
        _broadcast_submit_failure(
            "pro",
            "服务端错误，请稍后重试",
            email=request.email,
            method="pro_submit",
            http_status=503,
        )
        raise HTTPException(status_code=503, detail="服务端错误，请稍后重试")

    credit_cost = kpixel_cfg.get("creditCost", 1.5) if kpixel_available else vpixel_cfg.get("creditCost", 1.5)

    # Auth via JWT token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="账号已被禁用")
    user_id = user.get("id")
    credits = user.get("credits", 0)

    import verification_history
    import uuid
    existing_success = verification_history.get_successful_history_by_email(request.email, user_id)
    if existing_success:
        job_id = existing_success.get("verificationId") or existing_success.get("id") or ("auto-" + str(uuid.uuid4())[:8])
        event_meta = _build_verify_event_meta("pro_submit", request.email, user_id, "pro_submit")
        msg = existing_success.get("message", "")
        url = msg.replace("✅ 获取成功: ", "").replace("✅ 订阅成功: ", "").replace("✅ 获取成功", "").replace("✅ 订阅成功", "").strip()
        if not url.startswith("http"):
            url = ""
        
        broadcast_verify_event({
            "type": "progress",
            "vid": job_id,
            "step": "result", "status": "approved",
            "success": True,
            "message": "✅ 验证已成功（获取历史记录）",
            "url": url,
            "forceTerminalUpdate": True,
            **event_meta,
        })
        return {
            "task_id": job_id,
            "status": "success",
            "message": "获取历史成功"
        }

    if credits < credit_cost:
        raise HTTPException(status_code=400, detail=f"积分不足（需要 {credit_cost} 积分）")

    _deduct_user_credits_or_raise(user_id, credit_cost, f"积分不足（需要 {credit_cost} 积分）")

    # Round-robin: decide which service to use
    use_vpixel = False
    if kpixel_available and vpixel_available:
        # Both available — alternate
        use_vpixel = (_pro_tier_counter % 2 == 1)
        _pro_tier_counter += 1
    elif vpixel_available:
        use_vpixel = True
    # else: use kpixel (default)

    if use_vpixel:
        # ---- Route to VPixel (pick card from pool) ----
        vpc_id = _vpixel_card_row["id"]
        vpc_card = _vpixel_card_row["card_key"]
        account_line = f"{request.email}--{request.password}--{request.twofa}"
        from datetime import datetime as _dt

        # Reserve the card immediately
        _vpc_conn = database.get_connection()
        _vpc_conn.execute(
            "UPDATE vpixel_cards SET status='reserved', used_by_email=?, used_by_user=?, used_at=? WHERE id=? AND status='available'",
            (request.email, user_id, _dt.now().isoformat(), vpc_id),
        )
        _vpc_conn.commit()

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{vpixel_cfg['baseUrl']}/tasks/submit",
                    json={
                        "card": vpc_card,
                        "accounts": [account_line],
                        "timestamp": _dt.utcnow().isoformat() + "Z",
                    },
                    headers={"Content-Type": "application/json"},
                )
            data = resp.json()
            if data.get("success"):
                _vpc_conn.execute(
                    "UPDATE vpixel_cards SET status='reserved', used_by_email=?, used_by_user=?, used_at=? WHERE id=?",
                    (request.email, user_id, _dt.now().isoformat(), vpc_id),
                )
                _vpc_conn.commit()
                import time as _t
                poll_id = f"vp_{int(_t.time())}_{request.email[:8]}"
                task = asyncio.create_task(
                    _vpixel_poll_job(vpc_card, account_line, request.email, user_id, vpixel_cfg, poll_id)
                )
                _vpixel_polling_tasks[poll_id] = task
                _vpixel_job_context[poll_id] = {
                    "email": request.email,
                    "user_id": user_id,
                    "cost": credit_cost,
                    "card": vpc_card,
                    "base_url": vpixel_cfg["baseUrl"],
                    "account_line": account_line,
                }
                _register_async_task("vpixel", poll_id, _vpixel_job_context[poll_id])
                return {
                    "job_id": poll_id,
                    "task_id": poll_id,
                    "status": "queued",
                    "source": "vpixel",
                }
            else:
                # Submit failed — release the card back to available, do not swallow it
                _vpc_conn.execute(
                    "UPDATE vpixel_cards SET status='available', used_by_email='', used_by_user=0, used_at='' WHERE id=?",
                    (vpc_id,),
                )
                _vpc_conn.commit()
                # VPixel failed, try KPixel as fallback if available
                if kpixel_available:
                    print(f"[ProTier] VPixel submit failed ({data.get('message')}), card {vpc_card} released, falling back to KPixel")
                    use_vpixel = False  # fall through to KPixel below
                else:
                    print(f"[ProTier] VPixel submit error: {data.get('message')}")
                    refund_result = _refund_user_credits(user_id, credit_cost, request.email, via="pro_submit")
                    _record_submit_failure(
                        "vpixel",
                        data.get("message", "VPixel 提交失败"),
                        email=request.email,
                        user_id=user_id,
                        method="vpixel_card_pool",
                        http_status=500,
                        refunded=refund_result.get("refunded", False),
                        card_key=vpc_card,
                        via="vpixel",
                    )
                    raise HTTPException(status_code=500, detail="服务端错误，请稍后重试")
        except httpx.HTTPError as e:
            # Connection error — release card back to available
            _vpc_conn.execute("UPDATE vpixel_cards SET status='available', used_by_email='', used_by_user=0, used_at='' WHERE id=?", (vpc_id,))
            _vpc_conn.commit()
            if kpixel_available:
                print(f"[ProTier] VPixel connection failed ({e}), falling back to KPixel")
                use_vpixel = False
            else:
                print(f"[ProTier] VPixel connection error: {e}")
                refund_result = _refund_user_credits(user_id, credit_cost, request.email, via="pro_submit")
                _record_submit_failure(
                    "vpixel",
                    f"VPixel 连接失败: {str(e)}",
                    email=request.email,
                    user_id=user_id,
                    method="vpixel_card_pool",
                    http_status=502,
                    refunded=refund_result.get("refunded", False),
                    card_key=vpc_card,
                    via="vpixel",
                )
                raise HTTPException(status_code=500, detail="服务端错误，请稍后重试")

    if not use_vpixel:
        # ---- Route to KPixel ----
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(kpixel_cfg["baseUrl"], json={
                    "action": "submit_task",
                    "cdkey": kpixel_cfg["cdkey"],
                    "email": request.email,
                    "password": request.password,
                    "twofa": request.twofa,
                })

            data = resp.json()
            if data.get("success"):
                task_id = data.get("task_id", 0)
                task = asyncio.create_task(_kpixel_poll_job(task_id, request.email, user_id, kpixel_cfg))
                _kpixel_polling_tasks[task_id] = task
                _kpixel_job_context[str(task_id)] = {"email": request.email, "user_id": user_id, "cost": credit_cost}
                _register_async_task("kpixel", str(task_id), _kpixel_job_context[str(task_id)])
                return {
                    "job_id": str(task_id),
                    "task_id": task_id,
                    "status": "queued",
                    "remaining_uses": data.get("remaining_uses", -1),
                    "source": "kpixel",
                }
            else:
                print(f"[ProTier] KPixel submit error: {data.get('message')}")
                refund_result = _refund_user_credits(user_id, credit_cost, request.email, via="pro_submit")
                _record_submit_failure(
                    "kpixel",
                    data.get("message", "KPixel 提交失败"),
                    email=request.email,
                    user_id=user_id,
                    method="kpixel_api",
                    http_status=500,
                    refunded=refund_result.get("refunded", False),
                    via="kpixel",
                )
                raise HTTPException(status_code=500, detail="服务端错误，请稍后重试")

        except httpx.HTTPError as e:
            print(f"[ProTier] KPixel connection error: {e}")
            refund_result = _refund_user_credits(user_id, credit_cost, request.email, via="pro_submit")
            _record_submit_failure(
                "kpixel",
                f"KPixel 连接失败: {str(e)}",
                email=request.email,
                user_id=user_id,
                method="kpixel_api",
                http_status=502,
                refunded=refund_result.get("refunded", False),
                via="kpixel",
            )
            raise HTTPException(status_code=500, detail="服务端错误，请稍后重试")



@app.post("/api/kpixel/jobs/{task_id}/status")
async def kpixel_get_status(task_id: int):
    """Query KPixel job status."""
    kpixel_cfg = _get_kpixel_config()
    if not kpixel_cfg["cdkey"]:
        raise HTTPException(status_code=503, detail="KPixel API 未配置")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(kpixel_cfg["baseUrl"], json={
                "action": "get_status",
                "cdkey": kpixel_cfg["cdkey"],
                "task_id": task_id,
            })
        return resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/kpixel/jobs/{task_id}/confirm")
async def kpixel_confirm_job(task_id: int, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    kpixel_cfg = _get_kpixel_config()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(kpixel_cfg["baseUrl"], json={
            "action": "get_status",
            "cdkey": kpixel_cfg["cdkey"],
            "task_id": task_id,
        })
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    info = data.get("data", {})
    status = info.get("status", "")
    message = info.get("message", "")
    ctx = _kpixel_job_context.get(str(task_id)) or {}
    cost = ctx.get("cost", kpixel_cfg.get("creditCost", 1.5))
    event_meta = _build_verify_event_meta("kpixel", ctx.get("email", ""), user.get("id"), "kpixel_api")
    if status == "Success":
        result = _finalize_user_success(str(task_id), user.get("id"), cost, f"KPixel 成功: {message}", via="kpixel", email=ctx.get("email", ""))
        _complete_async_task("kpixel", str(task_id))
        broadcast_verify_event({
            "type": "progress",
            "vid": str(task_id),
            "step": "result",
            "status": "approved",
            "success": True,
            "message": f"✅ {message}（补偿确认）" if result.get("reconciled") else (f"✅ {message}" if message else "✅ 验证成功"),
            "forceTerminalUpdate": bool(result.get("reconciled")),
            "reconciledLateSuccess": bool(result.get("reconciled")),
            **event_meta,
        })
        return {"success": True, "status": "success", "confirmed": True, "finalized": result}
    if status == "Failed":
        _finalize_user_failure(str(task_id), user.get("id"), f"KPixel 失败: {message}", via="kpixel", refund_cost=cost, email=ctx.get("email", ""))
        _complete_async_task("kpixel", str(task_id))
        return {"success": True, "status": "failed", "confirmed": True}
    return {"success": True, "status": status or "pending", "confirmed": False}


@app.post("/api/kpixel/jobs/{task_id}/cancel")
async def kpixel_cancel_job(task_id: int):
    """Cancel a pending KPixel job."""
    kpixel_cfg = _get_kpixel_config()
    if not kpixel_cfg["cdkey"]:
        raise HTTPException(status_code=503, detail="KPixel API 未配置")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(kpixel_cfg["baseUrl"], json={
                "action": "cancel_task",
                "cdkey": kpixel_cfg["cdkey"],
                "task_id": task_id,
            })
        return resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/kpixel/balance")
async def kpixel_balance():
    """Query KPixel API remaining uses."""
    kpixel_cfg = _get_kpixel_config()
    if not kpixel_cfg["cdkey"]:
        raise HTTPException(status_code=503, detail="KPixel API 未配置")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(kpixel_cfg["baseUrl"], json={
                "action": "get_balance",
                "cdkey": kpixel_cfg["cdkey"],
            })
        return resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/kpixel/config")
async def kpixel_get_config(authorization: Optional[str] = Header(None)):
    """Get KPixel API configuration (admin only)."""
    _verify_admin_token(authorization)
    kpixel_cfg = _get_kpixel_config()
    masked_key = ""
    if kpixel_cfg["cdkey"]:
        k = kpixel_cfg["cdkey"]
        masked_key = k[:4] + "..." + k[-4:] if len(k) > 8 else k[:2] + "..."
    return {
        "enabled": kpixel_cfg["enabled"],
        "cdkey": masked_key,
        "hasKey": bool(kpixel_cfg["cdkey"]),
        "baseUrl": kpixel_cfg["baseUrl"],
        "creditCost": kpixel_cfg["creditCost"],
    }


@app.post("/api/kpixel/config")
async def kpixel_update_config(request: Request, authorization: Optional[str] = Header(None)):
    """Update KPixel API configuration (admin only)."""
    _verify_admin_token(authorization)
    import config_manager
    body = await request.json()

    updates = {}
    if "enabled" in body:
        updates["enabled"] = bool(body["enabled"])
    if "cdkey" in body and body["cdkey"]:
        updates["cdkey"] = body["cdkey"]
    if "baseUrl" in body:
        updates["baseUrl"] = body["baseUrl"]
    if "creditCost" in body:
        updates["creditCost"] = float(body["creditCost"])

    result = config_manager.update_config({"kpixelApi": updates})
    if result:
        return {"success": True}
    raise HTTPException(status_code=500, detail="保存失败")


# ========== VPixel API (1688ai.vip) — Shares "高级验证" with KPixel ==========

def _get_vpixel_config():
    """Get VPixel API config from config_manager."""
    import config_manager
    cfg = config_manager.load_config()
    vp = cfg.get("vpixelApi", {})
    return {
        "enabled": vp.get("enabled", False),
        "card": vp.get("card", ""),
        "baseUrl": vp.get("baseUrl", "http://1688ai.vip"),
        "creditCost": vp.get("creditCost", 1.5),
    }


def _extract_vpixel_card_quota(payload: dict) -> tuple:
    """Extract best-effort quota metadata from VPixel responses."""
    if not isinstance(payload, dict):
        return None, None
    data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}
    card_code_obj = data.get("card_code_obj", {}) if isinstance(data.get("card_code_obj"), dict) else {}

    def _pick(*keys):
        for source in (card_code_obj, payload, data):
            for key in keys:
                value = source.get(key)
                if isinstance(value, (int, float)):
                    return int(value)
                if isinstance(value, str) and value.strip().isdigit():
                    return int(value.strip())
        return None

    total_count = _pick("total_count", "total_uses", "quota_total", "quota", "total_quota")
    remaining = _pick("remaining", "remaining_uses", "balance", "quota_remaining")
    if remaining is None:
        used_quota = _pick("used_quota")
        if total_count is not None and used_quota is not None:
            remaining = max(total_count - used_quota, 0)
    return remaining, total_count


def _extract_vpixel_card_quota_from_html(html: str) -> tuple:
    """Extract quota from VPixel order query HTML page."""
    if not html or not isinstance(html, str):
        return None, None

    plain = re.sub(r"<[^>]+>", " ", html)
    plain = re.sub(r"&nbsp;|&#160;", " ", plain, flags=re.IGNORECASE)
    plain = re.sub(r"\s+", " ", plain)

    def _pick_number(label: str):
        patterns = [
            rf"{label}\s*</[^>]+>\s*<[^>]*>\s*(\d+)",
            rf"{label}\s*(\d+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                try:
                    return int(match.group(1))
                except Exception:
                    return None
        plain_match = re.search(rf"{label}\s*[:：]?\s*(\d+)", plain, re.IGNORECASE)
        if plain_match:
            try:
                return int(plain_match.group(1))
            except Exception:
                return None
        return None

    total_count = _pick_number("总可提交数量")
    submitted = _pick_number("已提交数量")
    remaining = _pick_number("剩余可用")

    if remaining is None and total_count is not None and submitted is not None:
        remaining = max(total_count - submitted, 0)
    if total_count is None and remaining is not None and submitted is not None:
        total_count = remaining + submitted

    return remaining, total_count


async def _vpixel_probe_card(client: httpx.AsyncClient, base_url: str, card_key: str) -> dict:
    """Best-effort VPixel card validation and quota lookup."""
    try:
        resp = await client.get(
            f"{base_url}/tasks/card/{card_key}",
            params={"page": 1, "page_size": 1},
        )
    except Exception as e:
        return {"valid": False, "message": f"验证请求失败: {str(e)}", "remaining": 0, "total_count": 0}

    try:
        data = resp.json()
    except Exception:
        data = {}

    if resp.status_code != 200:
        return {
            "valid": False,
            "message": (data.get("message") if isinstance(data, dict) else "") or f"HTTP {resp.status_code}",
            "remaining": 0,
            "total_count": 0,
        }

    if isinstance(data, dict) and data.get("success") is False:
        return {
            "valid": False,
            "message": data.get("message") or "验证失败",
            "remaining": 0,
            "total_count": 0,
        }

    items = []
    card_code_obj = {}
    if isinstance(data, dict):
        payload_data = data.get("data", {})
        if isinstance(payload_data, dict) and isinstance(payload_data.get("items"), list):
            items = payload_data.get("items") or []
            if isinstance(payload_data.get("card_code_obj"), dict):
                card_code_obj = payload_data.get("card_code_obj") or {}

    remaining, total_count = _extract_vpixel_card_quota(data)
    api_has_card_signal = bool(card_code_obj) or remaining is not None or total_count is not None or bool(items)

    if bool(card_code_obj):
        if total_count is None:
            total_count = int(card_code_obj.get("total_quota") or 0)
        if remaining is None:
            total_quota = int(card_code_obj.get("total_quota") or 0)
            used_quota = int(card_code_obj.get("used_quota") or 0)
            remaining = max(total_quota - used_quota, 0)

    if not bool(card_code_obj) and api_has_card_signal and (remaining is None or total_count is None or (remaining == 1 and total_count == 1)):
        try:
            page_resp = await client.get(
                f"{base_url}/order_qurey.html",
                params={"card": card_key},
            )
            if page_resp.status_code == 200:
                html_remaining, html_total_count = _extract_vpixel_card_quota_from_html(page_resp.text)
                if html_remaining is not None:
                    remaining = html_remaining
                if html_total_count is not None:
                    total_count = html_total_count
        except Exception:
            pass

    if not api_has_card_signal:
        return {
            "valid": False,
            "message": "未识别到有效卡密信息",
            "remaining": 0,
            "total_count": 0,
        }

    if remaining is None:
        remaining = 1
    if total_count is None:
        total_count = max(remaining, 1)

    return {
        "valid": remaining > 0,
        "message": "验证通过" if remaining > 0 else "额度已用完",
        "remaining": remaining,
        "total_count": total_count,
    }


_vpixel_polling_tasks: dict = {}
# VPixel job status cache: poll_id -> {status, message, elapsed, ...}
_vpixel_job_status: dict = {}

# Round-robin counter for pro tier (KPixel vs VPixel)
_pro_tier_counter: int = 0


async def _vpixel_poll_job(card: str, account_line: str, email: str, user_id: int, vpixel_cfg: dict, poll_id: str):
    """Background task: poll VPixel API job status and broadcast SSE events.
    VPixel status codes: 1=waiting, 2=processing, 3=success, 4=failed
    Also writes to _vpixel_job_status cache for frontend polling.
    """
    import time
    import logging
    base_url = vpixel_cfg["baseUrl"]
    credit_cost = vpixel_cfg.get("creditCost", 1.5)
    start_time = time.time()
    event_meta = _build_verify_event_meta("vpixel", email, user_id, "vpixel_card_pool", card)

    # Init status cache
    _vpixel_job_status[poll_id] = {"status": "Pending", "message": "排队中...", "elapsed": 0}

    broadcast_verify_event({
        "type": "progress",
        "vid": poll_id,
        "step": "submitted",
        "message": "任务已提交，等待设备处理...",
        **event_meta,
    })

    STATUS_MAP = {1: "queued", 2: "running", 3: "success", 4: "failed"}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                wait_seconds = _next_pixel_poll_interval(time.time() - start_time)
                if wait_seconds is None:
                    try:
                        conn = database.get_connection()
                        conn.execute("UPDATE vpixel_cards SET status='available', used_by_email='', used_by_user=0, used_at='' WHERE card_key=? AND status='reserved'", (card,))
                        conn.commit()
                    except Exception:
                        pass
                    _finalize_user_failure(poll_id, user_id, "VPixel 失败: 轮询超时", via="vpixel", refund_cost=credit_cost, email=email)
                    _complete_async_task("vpixel", poll_id)
                    _vpixel_job_status[poll_id] = {"status": "Failed", "message": "轮询超时", "elapsed": round(time.time() - start_time, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "result", "status": "failed", "success": False,
                        "message": "❌ 轮询超时",
                        "elapsed": round(time.time() - start_time, 1),
                        **event_meta,
                    })
                    break

                await asyncio.sleep(wait_seconds)
                try:
                    resp = await client.get(
                        f"{base_url}/tasks/card/{card}",
                        params={"page": 1, "page_size": 50}
                    )
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    if not data.get("success"):
                        continue
                except Exception:
                    continue

                # Find our account in the results
                items = data.get("data", {}).get("items", [])
                target_item = None
                for item in items:
                    if item.get("account_info", "").startswith(email):
                        target_item = item
                        break

                if not target_item:
                    # Account not yet in results, still waiting
                    _vpixel_job_status[poll_id] = {"status": "Pending", "message": "排队中...", "elapsed": round(time.time() - start_time, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "processing", "status": "queued",
                        "message": "⏳ 排队中...",
                        "elapsed": round(time.time() - start_time, 1),
                        **event_meta,
                    })
                    continue

                raw_status = target_item.get("status", 1)
                mapped_status = STATUS_MAP.get(raw_status, "queued")
                result_msg = target_item.get("result", "")
                elapsed = time.time() - start_time

                if mapped_status == "queued":
                    _vpixel_job_status[poll_id] = {"status": "Pending", "message": "排队中...", "elapsed": round(elapsed, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "processing", "status": "queued",
                        "message": "⏳ 排队中...",
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })
                elif mapped_status == "running":
                    _vpixel_job_status[poll_id] = {"status": "Running", "message": result_msg or "运行中...", "elapsed": round(elapsed, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "processing", "status": "running",
                        "message": f"🔄 运行中... {result_msg}" if result_msg else "🔄 运行中...",
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })
                elif mapped_status == "success":
                    try:
                        quota_probe = await _vpixel_probe_card(client, base_url, card)
                        remaining = quota_probe.get("remaining", 0)
                        total_count = quota_probe.get("total_count", max(remaining, 1))
                        conn = database.get_connection()
                        conn.execute(
                            "UPDATE vpixel_cards SET remaining=?, total_count=?, status=?, used_by_email=?, used_by_user=?, used_at=? WHERE card_key=?",
                            (
                                remaining,
                                total_count,
                                "used" if remaining <= 0 else "available",
                                email if remaining <= 0 else "",
                                user_id if remaining <= 0 else 0,
                                dt.utcnow().isoformat() + "Z" if remaining <= 0 else "",
                                card,
                            ),
                        )
                        conn.commit()
                    except Exception:
                        try:
                            conn = database.get_connection()
                            row = conn.execute("SELECT remaining, total_count FROM vpixel_cards WHERE card_key=?", (card,)).fetchone()
                            remaining = max(int((row["remaining"] if row else 1) or 1) - 1, 0)
                            total_count = int((row["total_count"] if row else max(remaining, 1)) or max(remaining, 1))
                            conn.execute(
                                "UPDATE vpixel_cards SET remaining=?, total_count=?, status=?, used_by_email=?, used_by_user=?, used_at=? WHERE card_key=?",
                                (
                                    remaining,
                                    total_count,
                                    "used" if remaining <= 0 else "available",
                                    email if remaining <= 0 else "",
                                    user_id if remaining <= 0 else 0,
                                    dt.utcnow().isoformat() + "Z" if remaining <= 0 else "",
                                    card,
                                ),
                            )
                            conn.commit()
                        except Exception:
                            pass
                    result = _finalize_user_success(poll_id, user_id, credit_cost, f"VPixel 成功: {result_msg}", via="vpixel", email=email)
                    _complete_async_task("vpixel", poll_id)
                    _vpixel_job_status[poll_id] = {"status": "Success", "message": result_msg or "验证成功", "elapsed": round(elapsed, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "result", "status": "approved",
                        "success": True,
                        "message": f"✅ {result_msg}（补偿确认）" if result.get("reconciled") else (f"✅ {result_msg}" if result_msg else "✅ 验证成功"),
                        "elapsed": round(elapsed, 1),
                        "forceTerminalUpdate": bool(result.get("reconciled")),
                        "reconciledLateSuccess": bool(result.get("reconciled")),
                        **event_meta,
                    })
                    break
                elif mapped_status == "failed":
                    # Release the card back to available
                    try:
                        conn = database.get_connection()
                        conn.execute("UPDATE vpixel_cards SET status='available', used_by_email='', used_by_user=0, used_at='' WHERE card_key=? AND status='reserved'", (card,))
                        conn.commit()
                    except Exception:
                        pass
                    _finalize_user_failure(poll_id, user_id, f"VPixel 失败: {result_msg}", via="vpixel", refund_cost=credit_cost, email=email)
                    _complete_async_task("vpixel", poll_id)
                    _vpixel_job_status[poll_id] = {"status": "Failed", "message": result_msg or "验证失败", "elapsed": round(elapsed, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "result", "status": "failed",
                        "success": False,
                        "message": f"❌ {result_msg}" if result_msg else "❌ 验证失败",
                        "error": result_msg,
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })
                    break

    except asyncio.CancelledError:
        # Release card on cancellation
        try:
            conn = database.get_connection()
            conn.execute("UPDATE vpixel_cards SET status='available', used_by_email='', used_by_user=0, used_at='' WHERE card_key=? AND status='reserved'", (card,))
            conn.commit()
        except Exception:
            pass
        _finalize_user_failure(poll_id, user_id, "VPixel 失败: 轮询取消", via="vpixel", refund_cost=credit_cost, email=email)
        _complete_async_task("vpixel", poll_id)
    except Exception as e:
        logging.error(f"[VPixel] Poll error for {email}: {e}")
        # Release card on error
        try:
            conn = database.get_connection()
            conn.execute("UPDATE vpixel_cards SET status='available', used_by_email='', used_by_user=0, used_at='' WHERE card_key=? AND status='reserved'", (card,))
            conn.commit()
        except Exception:
            pass
        _finalize_user_failure(poll_id, user_id, f"VPixel 失败: {'轮询超时' if _is_timeout_error(e) else f'轮询错误: {str(e)}'}", via="vpixel", refund_cost=credit_cost, email=email)
        _complete_async_task("vpixel", poll_id)
        _vpixel_job_status[poll_id] = {"status": "Failed", "message": f"轮询错误: {str(e)}", "elapsed": 0}
        broadcast_verify_event({
            "type": "progress",
            "vid": poll_id,
            "step": "result", "status": "failed",
            "success": False,
            "message": f"❌ 轮询错误: {str(e)}",
            **event_meta,
        })
    finally:
        _vpixel_polling_tasks.pop(poll_id, None)


@app.post("/api/vpixel/jobs/{poll_id}/status")
async def vpixel_get_job_status(poll_id: str):
    """Get VPixel job status from in-memory cache (same format as KPixel status)."""
    status_entry = _vpixel_job_status.get(poll_id)
    if not status_entry:
        return {"success": False, "message": "Job not found"}
    return {
        "success": True,
        "data": {
            "status": status_entry.get("status", "Pending"),
            "message": status_entry.get("message", ""),
            "elapsed": status_entry.get("elapsed", 0),
        }
    }


@app.post("/api/vpixel/jobs/{poll_id}/confirm")
async def vpixel_confirm_job(poll_id: str, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    ctx = _vpixel_job_context.get(poll_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="任务上下文不存在")

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{ctx['base_url']}/tasks/card/{ctx['card']}",
            params={"page": 1, "page_size": 50},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    items = data.get("data", {}).get("items", [])
    target_item = next((item for item in items if item.get("account_info", "").startswith(ctx["email"])), None)
    if not target_item:
        return {"success": True, "status": "pending", "confirmed": False}

    raw_status = target_item.get("status", 1)
    mapped_status = {1: "queued", 2: "running", 3: "success", 4: "failed"}.get(raw_status, "queued")
    result_msg = target_item.get("result", "")
    event_meta = _build_verify_event_meta("vpixel", ctx.get("email", ""), user.get("id"), "vpixel_card_pool", ctx.get("card", ""))
    if mapped_status == "success":
        result = _finalize_user_success(poll_id, user.get("id"), ctx["cost"], f"VPixel 成功: {result_msg}", via="vpixel", email=ctx.get("email", ""))
        _complete_async_task("vpixel", poll_id)
        broadcast_verify_event({
            "type": "progress",
            "vid": poll_id,
            "step": "result",
            "status": "approved",
            "success": True,
            "message": f"✅ {result_msg}（补偿确认）" if result.get("reconciled") else (f"✅ {result_msg}" if result_msg else "✅ 验证成功"),
            "forceTerminalUpdate": bool(result.get("reconciled")),
            "reconciledLateSuccess": bool(result.get("reconciled")),
            **event_meta,
        })
        return {"success": True, "status": "success", "confirmed": True, "finalized": result}
    if mapped_status == "failed":
        _finalize_user_failure(poll_id, user.get("id"), f"VPixel 失败: {result_msg}", via="vpixel", refund_cost=ctx["cost"], email=ctx.get("email", ""))
        _complete_async_task("vpixel", poll_id)
        return {"success": True, "status": "failed", "confirmed": True}
    return {"success": True, "status": mapped_status, "confirmed": False}


class VPixelJobRequest(BaseModel):
    email: str
    password: str
    twofa: str
    cdk: str = ""


@app.post("/api/vpixel/jobs")
async def vpixel_submit_job(request: VPixelJobRequest, authorization: Optional[str] = Header(None)):
    """Submit a VPixel job — validates user credits, posts to 1688ai.vip, starts background poller."""
    vpixel_cfg = _get_vpixel_config()
    if not vpixel_cfg["enabled"]:
        _broadcast_submit_failure(
            "vpixel",
            "VPixel API 未启用",
            email=request.email,
            method="vpixel_card_pool",
            http_status=503,
        )
        raise HTTPException(status_code=503, detail="VPixel API 未启用")

    credit_cost = vpixel_cfg.get("creditCost", 1.5)

    # Auth via JWT token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    user_id = user.get("id")
    credits = user.get("credits", 0)

    import verification_history
    import uuid
    existing_success = verification_history.get_successful_history_by_email(request.email, user_id)
    if existing_success:
        job_id = existing_success.get("verificationId") or existing_success.get("id") or ("auto-" + str(uuid.uuid4())[:8])
        event_meta = _build_verify_event_meta("vpixel_card_pool", request.email, user_id, "vpixel_card_pool")
        msg = existing_success.get("message", "")
        url = msg.replace("✅ 获取成功: ", "").replace("✅ 订阅成功: ", "").replace("✅ 获取成功", "").replace("✅ 订阅成功", "").strip()
        if not url.startswith("http"):
            url = ""
        
        broadcast_verify_event({
            "type": "progress",
            "vid": job_id,
            "step": "result", "status": "approved",
            "success": True,
            "message": "✅ 验证已成功（获取历史记录）",
            "url": url,
            "forceTerminalUpdate": True,
            **event_meta,
        })
        return {
            "poll_id": job_id,
            "status": "success",
            "message": "获取历史成功"
        }

    if credits < credit_cost:
        raise HTTPException(status_code=400, detail=f"积分不足（需要 {credit_cost} 积分）")

    conn = database.get_connection()
    card_row = conn.execute(
        "SELECT id, card_key FROM vpixel_cards WHERE status='available' AND COALESCE(remaining, 1) > 0 ORDER BY COALESCE(remaining, 1) DESC, id ASC LIMIT 1"
    ).fetchone()
    if not card_row:
        _broadcast_submit_failure(
            "vpixel",
            "VPixel 无可用卡密",
            email=request.email,
            user_id=user_id,
            method="vpixel_card_pool",
            http_status=503,
        )
        raise HTTPException(status_code=503, detail="VPixel 无可用卡密")

    card_id = card_row["id"]
    card_key = card_row["card_key"]

    _deduct_user_credits_or_raise(user_id, credit_cost, f"积分不足（需要 {credit_cost} 积分）")

    # Format account line for VPixel: email--password--2fa
    account_line = f"{request.email}--{request.password}--{request.twofa}"
    conn.execute(
        "UPDATE vpixel_cards SET status='reserved', used_by_email=?, used_by_user=?, used_at=? WHERE id=?",
        (request.email, user_id, dt.utcnow().isoformat() + "Z", card_id),
    )
    conn.commit()

    # Submit to VPixel API
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{vpixel_cfg['baseUrl']}/tasks/submit",
                json={
                    "card": card_key,
                    "accounts": [account_line],
                    "timestamp": dt.utcnow().isoformat() + "Z",
                },
                headers={"Content-Type": "application/json"},
            )

        data = resp.json()
        if data.get("success"):
            import time as _t
            poll_id = f"vp_{int(_t.time())}_{request.email[:8]}"
            # Start background polling
            task = asyncio.create_task(
                _vpixel_poll_job(vpixel_cfg["card"], account_line, request.email, user_id, vpixel_cfg, poll_id)
            )
            _vpixel_polling_tasks[poll_id] = task
            _vpixel_job_context[poll_id] = {
                "email": request.email,
                "user_id": user_id,
                "cost": credit_cost,
                "card": card_key,
                "base_url": vpixel_cfg["baseUrl"],
                "account_line": account_line,
            }
            _register_async_task("vpixel", poll_id, _vpixel_job_context[poll_id])
            return {
                "job_id": poll_id,
                "task_id": poll_id,
                "status": "queued",
                "source": "vpixel",
            }
        else:
            conn.execute(
                "UPDATE vpixel_cards SET status='available', used_by_email='', used_by_user=0, used_at='' WHERE id=?",
                (card_id,),
            )
            conn.commit()
            refund_result = _refund_user_credits(user_id, credit_cost, request.email, via="vpixel_submit")
            failure_message = data.get("message", "VPixel 提交失败")
            _record_submit_failure(
                "vpixel",
                failure_message,
                email=request.email,
                user_id=user_id,
                method="vpixel_card_pool",
                http_status=400,
                refunded=refund_result.get("refunded", False),
                card_key=card_key,
                via="vpixel",
            )
            raise HTTPException(status_code=400, detail=failure_message)

    except httpx.HTTPError as e:
        conn.execute(
            "UPDATE vpixel_cards SET status='available', used_by_email='', used_by_user=0, used_at='' WHERE id=?",
            (card_id,),
        )
        conn.commit()
        refund_result = _refund_user_credits(user_id, credit_cost, request.email, via="vpixel_submit")
        _record_submit_failure(
            "vpixel",
            f"无法连接 VPixel API: {str(e)}",
            email=request.email,
            user_id=user_id,
            method="vpixel_card_pool",
            http_status=502,
            refunded=refund_result.get("refunded", False),
            card_key=card_key,
            via="vpixel",
        )
        raise HTTPException(status_code=502, detail=f"无法连接 VPixel API: {str(e)}")


@app.get("/api/vpixel/queue")
async def vpixel_queue():
    """Get VPixel current queue size."""
    vpixel_cfg = _get_vpixel_config()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{vpixel_cfg['baseUrl']}/tasks/get_queue_up")
        if resp.status_code == 200:
            return resp.json()
        return {"queue": -1}
    except Exception as e:
        return {"queue": -1, "error": str(e)}


@app.get("/api/vpixel/config")
async def vpixel_get_config(authorization: Optional[str] = Header(None)):
    """Get VPixel API configuration (admin only)."""
    _verify_admin_token(authorization)
    vpixel_cfg = _get_vpixel_config()
    masked_card = ""
    if vpixel_cfg["card"]:
        c = vpixel_cfg["card"]
        masked_card = c[:4] + "..." + c[-4:] if len(c) > 8 else c[:2] + "..."
    return {
        "enabled": vpixel_cfg["enabled"],
        "card": masked_card,
        "hasCard": bool(vpixel_cfg["card"]),
        "baseUrl": vpixel_cfg["baseUrl"],
        "creditCost": vpixel_cfg["creditCost"],
    }


@app.post("/api/vpixel/config")
async def vpixel_update_config(request: Request, authorization: Optional[str] = Header(None)):
    """Update VPixel API configuration (admin only)."""
    _verify_admin_token(authorization)
    import config_manager
    body = await request.json()

    updates = {}
    if "enabled" in body:
        updates["enabled"] = bool(body["enabled"])
    if "card" in body and body["card"]:
        updates["card"] = body["card"]
    if "baseUrl" in body:
        updates["baseUrl"] = body["baseUrl"]
    if "creditCost" in body:
        updates["creditCost"] = float(body["creditCost"])

    result = config_manager.update_config({"vpixelApi": updates})
    if result:
        return {"success": True}
    raise HTTPException(status_code=500, detail="保存失败")


# ---------- VPixel Card Pool Management ----------

@app.post("/api/vpixel/cards")
async def vpixel_cards_add(request: Request, authorization: Optional[str] = Header(None)):
    """Batch-add VPixel cards (admin only)."""
    _verify_admin_token(authorization)
    body = await request.json()
    keys_raw = body.get("keys", "")
    keys = [k.strip() for k in keys_raw.strip().split("\n") if k.strip()]
    if not keys:
        raise HTTPException(status_code=400, detail="请输入至少一个卡密")

    from datetime import datetime
    vpixel_cfg = _get_vpixel_config()
    base_url = vpixel_cfg["baseUrl"]
    conn = database.get_connection()
    valid_count = 0
    invalid_count = 0
    duplicate_count = 0
    results = []

    async with httpx.AsyncClient(timeout=30) as client:
        for key in keys:
            existing = conn.execute("SELECT id FROM vpixel_cards WHERE card_key=?", (key,)).fetchone()
            if existing:
                duplicate_count += 1
                results.append({"key": key, "status": "duplicate", "msg": "已存在"})
                continue

            probe = await _vpixel_probe_card(client, base_url, key)
            remaining = probe.get("remaining", 0)
            total_count = probe.get("total_count", 0)
            ok = bool(probe.get("valid"))
            msg = probe.get("message", "")
            status = "available" if ok and remaining > 0 else "invalid"

            try:
                conn.execute(
                    "INSERT INTO vpixel_cards (card_key, status, created_at, remaining, total_count) VALUES (?, ?, ?, ?, ?)",
                    (key, status, datetime.now().isoformat(), remaining, total_count),
                )
            except Exception:
                duplicate_count += 1
                results.append({"key": key, "status": "duplicate", "msg": "已存在"})
                continue

            if ok and remaining > 0:
                valid_count += 1
                results.append({"key": key, "status": "valid", "msg": msg or "验证通过", "remaining": remaining, "total_count": total_count})
            else:
                invalid_count += 1
                results.append({"key": key, "status": "invalid", "msg": msg or "验证失败", "remaining": remaining, "total_count": total_count})
    conn.commit()
    return {
        "success": True,
        "valid": valid_count,
        "invalid": invalid_count,
        "duplicate": duplicate_count,
        "total_input": len(keys),
        "results": results,
    }


@app.get("/api/vpixel/cards")
async def vpixel_cards_list(authorization: Optional[str] = Header(None)):
    """List all VPixel cards (admin only)."""
    _verify_admin_token(authorization)
    conn = database.get_connection()
    rows = conn.execute("SELECT * FROM vpixel_cards ORDER BY id DESC").fetchall()
    return {"keys": [dict(r) for r in rows]}


@app.get("/api/vpixel/cards/stats")
async def vpixel_cards_stats(authorization: Optional[str] = Header(None)):
    """Get VPixel card stats (admin only)."""
    _verify_admin_token(authorization)
    conn = database.get_connection()
    total = conn.execute("SELECT COUNT(*) FROM vpixel_cards").fetchone()[0]
    available = conn.execute("SELECT COUNT(*) FROM vpixel_cards WHERE status='available' AND COALESCE(remaining, 1) > 0").fetchone()[0]
    used = conn.execute("SELECT COUNT(*) FROM vpixel_cards WHERE status='used'").fetchone()[0]
    return {"total": total, "available": available, "used": used}


@app.delete("/api/vpixel/cards/{card_id}")
async def vpixel_cards_delete(card_id: int, authorization: Optional[str] = Header(None)):
    """Delete a VPixel card (admin only)."""
    _verify_admin_token(authorization)
    conn = database.get_connection()
    conn.execute("DELETE FROM vpixel_cards WHERE id=?", (card_id,))
    conn.commit()
    return {"success": True}


# ==============================================================
# YPixel — Standard-tier verification via pixel.yh-mo.xyz
# ==============================================================

_ypixel_job_status = {}   # poll_id -> {status, message, elapsed, url}
_ypixel_polling_tasks = {}   # poll_id -> asyncio.Task

def _get_ypixel_config():
    import config_manager
    cfg = config_manager.get_config().get("ypixelApi", {})
    return {
        "enabled": cfg.get("enabled", False),
        "baseUrl": cfg.get("baseUrl", "https://pixel.yh-mo.xyz"),
        "creditCost": cfg.get("creditCost", 1.0),
    }


async def _ypixel_poll_job(task_id: str, card_key: str, email: str, user_id: int, ypixel_cfg: dict, poll_id: str):
    """Background task: poll YPixel task status until completion."""
    import time
    import logging
    base_url = ypixel_cfg["baseUrl"]
    credit_cost = ypixel_cfg.get("creditCost", 1.0)
    start_time = time.time()
    event_meta = _build_verify_event_meta("ypixel", email, user_id, "ypixel_card_pool", card_key)

    _ypixel_job_status[poll_id] = {"status": "Pending", "message": "排队中...", "elapsed": 0}

    broadcast_verify_event({
        "type": "progress",
        "vid": poll_id,
        "step": "submitted", "message": "任务已提交，等待处理...",
        **event_meta,
    })

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                wait_seconds = _next_pixel_poll_interval(time.time() - start_time)
                if wait_seconds is None:
                    try:
                        conn = database.get_connection()
                        conn.execute("UPDATE ypixel_cards SET status='available', used_by_email=NULL, used_at=NULL WHERE card_key=? AND status='reserved'", (card_key,))
                        conn.commit()
                    except Exception:
                        pass
                    _finalize_user_failure(poll_id, user_id, "YPixel 失败: 任务超时", via="ypixel", refund_cost=credit_cost, email=email)
                    _complete_async_task("ypixel", poll_id)
                    _ypixel_job_status[poll_id] = {"status": "Failed", "message": "任务超时", "elapsed": round(time.time() - start_time, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "result", "status": "failed", "success": False,
                        "message": "❌ 任务超时",
                        "elapsed": round(time.time() - start_time, 1),
                        **event_meta,
                    })
                    break

                await asyncio.sleep(wait_seconds)
                try:
                    resp = await client.get(f"{base_url}/api/task/{task_id}")
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                except Exception:
                    continue

                elapsed = time.time() - start_time
                task_status = data.get("status", "")

                # Extract per-account data from the accounts array
                accounts = data.get("accounts", [])
                acct = None
                for a in accounts:
                    if a.get("email", "").lower() == email.lower():
                        acct = a
                        break
                if not acct and accounts:
                    acct = accounts[0]  # fallback to first account

                acct_status = acct.get("status", "") if acct else ""
                result_url = (acct.get("result_link", "") or acct.get("result", "")) if acct else ""
                message = (acct.get("message", "") or data.get("message", "")) if acct else data.get("message", "")

                # Task completed and account succeeded
                if task_status in ("completed", "done") and acct_status == "success":
                    result = _finalize_user_success(poll_id, user_id, credit_cost, f"YPixel 成功: {result_url or message or '验证成功'}", via="ypixel", email=email)
                    _complete_async_task("ypixel", poll_id)
                    # Decrement card remaining quota
                    try:
                        conn = database.get_connection()
                        conn.execute(
                            "UPDATE ypixel_cards SET remaining = MAX(remaining - 1, 0), used_by_email=?, used_at=? WHERE card_key=?",
                            (email, __import__('datetime').datetime.now().isoformat(), card_key),
                        )
                        # Check if remaining is now 0 → mark as used; otherwise release back to available
                        row = conn.execute("SELECT remaining FROM ypixel_cards WHERE card_key=?", (card_key,)).fetchone()
                        if row and row[0] <= 0:
                            conn.execute("UPDATE ypixel_cards SET status='used' WHERE card_key=?", (card_key,))
                        else:
                            conn.execute("UPDATE ypixel_cards SET status='available' WHERE card_key=?", (card_key,))
                        conn.commit()
                    except Exception:
                        pass
                    display_msg = result_url or message or "验证成功"
                    _ypixel_job_status[poll_id] = {"status": "Success", "message": display_msg, "elapsed": round(elapsed, 1), "url": result_url}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "result", "status": "approved", "success": True,
                        "message": f"✅ {display_msg}（补偿确认）" if result.get("reconciled") else f"✅ {display_msg}",
                        "elapsed": round(elapsed, 1),
                        "forceTerminalUpdate": bool(result.get("reconciled")),
                        "reconciledLateSuccess": bool(result.get("reconciled")),
                        **event_meta,
                    })
                    break

                # Task completed but account failed, or task itself failed
                elif task_status in ("completed", "done") and acct_status in ("failed", "error"):
                    # Release card back to available
                    try:
                        conn = database.get_connection()
                        conn.execute("UPDATE ypixel_cards SET status='available', used_by_email=NULL, used_at=NULL WHERE card_key=? AND status='reserved'", (card_key,))
                        conn.commit()
                    except Exception:
                        pass
                    err_msg = message or "验证失败"
                    _finalize_user_failure(poll_id, user_id, f"YPixel 失败: {err_msg}", via="ypixel", refund_cost=credit_cost, email=email)
                    _complete_async_task("ypixel", poll_id)
                    _ypixel_job_status[poll_id] = {"status": "Failed", "message": err_msg, "elapsed": round(elapsed, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "result", "status": "failed", "success": False,
                        "message": f"❌ {err_msg}",
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })
                    break

                elif task_status in ("failed", "error"):
                    # Release card back to available
                    try:
                        conn = database.get_connection()
                        conn.execute("UPDATE ypixel_cards SET status='available', used_by_email=NULL, used_at=NULL WHERE card_key=? AND status='reserved'", (card_key,))
                        conn.commit()
                    except Exception:
                        pass
                    err_msg = message or "任务失败"
                    _finalize_user_failure(poll_id, user_id, f"YPixel 失败: {err_msg}", via="ypixel", refund_cost=credit_cost, email=email)
                    _complete_async_task("ypixel", poll_id)
                    _ypixel_job_status[poll_id] = {"status": "Failed", "message": err_msg, "elapsed": round(elapsed, 1)}
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "result", "status": "failed", "success": False,
                        "message": f"❌ {err_msg}",
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })
                    break

                else:
                    # pending / processing
                    progress_msg = message or ("运行中..." if task_status in ("processing", "running") else "排队中...")
                    _ypixel_job_status[poll_id] = {
                        "status": "Running" if task_status in ("processing", "running") else "Pending",
                        "message": progress_msg, "elapsed": round(elapsed, 1),
                    }
                    broadcast_verify_event({
                        "type": "progress",
                        "vid": poll_id,
                        "step": "processing",
                        "status": "running" if task_status in ("processing", "running") else "queued",
                        "message": f"🔄 {progress_msg}" if task_status in ("processing", "running") else f"⏳ {progress_msg}",
                        "elapsed": round(elapsed, 1),
                        **event_meta,
                    })

    except asyncio.CancelledError:
        try:
            conn = database.get_connection()
            conn.execute("UPDATE ypixel_cards SET status='available', used_by_email=NULL, used_at=NULL WHERE card_key=? AND status='reserved'", (card_key,))
            conn.commit()
        except Exception:
            pass
        _finalize_user_failure(poll_id, user_id, "YPixel 失败: 轮询取消", via="ypixel", refund_cost=credit_cost, email=email)
        _complete_async_task("ypixel", poll_id)
    except Exception as e:
        logging.error(f"[YPixel] Poll error for {email}: {e}")
        try:
            conn = database.get_connection()
            conn.execute("UPDATE ypixel_cards SET status='available', used_by_email=NULL, used_at=NULL WHERE card_key=? AND status='reserved'", (card_key,))
            conn.commit()
        except Exception:
            pass
        _finalize_user_failure(poll_id, user_id, f"YPixel 失败: {'轮询超时' if _is_timeout_error(e) else f'轮询错误: {str(e)}'}", via="ypixel", refund_cost=credit_cost, email=email)
        _complete_async_task("ypixel", poll_id)
        _ypixel_job_status[poll_id] = {"status": "Failed", "message": f"轮询错误", "elapsed": 0}
    finally:
        _ypixel_polling_tasks.pop(poll_id, None)


@app.post("/api/ypixel/jobs/{poll_id}/status")
async def ypixel_get_job_status(poll_id: str):
    """Get YPixel job status from in-memory cache."""
    status_entry = _ypixel_job_status.get(poll_id)
    if not status_entry:
        return {"success": False, "message": "Job not found"}
    return {
        "success": True,
        "data": {
            "status": status_entry.get("status", "Pending"),
            "message": status_entry.get("message", ""),
            "elapsed": status_entry.get("elapsed", 0),
            "url": status_entry.get("url", ""),
        }
    }


@app.post("/api/ypixel/jobs/{poll_id}/confirm")
async def ypixel_confirm_job(poll_id: str, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    ctx = _ypixel_job_context.get(poll_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="任务上下文不存在")

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{ctx['base_url']}/api/task/{ctx['task_id']}")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    task_status = data.get("status", "")
    accounts = data.get("accounts", [])
    acct = next((a for a in accounts if a.get("email", "").lower() == ctx["email"].lower()), None)
    if not acct and accounts:
        acct = accounts[0]
    acct_status = acct.get("status", "") if acct else ""
    result_url = (acct.get("result_link", "") or acct.get("result", "")) if acct else ""
    message = (acct.get("message", "") or data.get("message", "")) if acct else data.get("message", "")
    event_meta = _build_verify_event_meta("ypixel", ctx.get("email", ""), user.get("id"), "ypixel_card_pool", ctx.get("card_key", ""))

    if task_status in ("completed", "done") and acct_status == "success":
        result = _finalize_user_success(poll_id, user.get("id"), ctx["cost"], f"YPixel 成功: {result_url or message or '验证成功'}", via="ypixel", email=ctx.get("email", ""))
        _complete_async_task("ypixel", poll_id)
        display_msg = result_url or message or "验证成功"
        broadcast_verify_event({
            "type": "progress",
            "vid": poll_id,
            "step": "result",
            "status": "approved",
            "success": True,
            "message": f"✅ {display_msg}（补偿确认）" if result.get("reconciled") else f"✅ {display_msg}",
            "forceTerminalUpdate": bool(result.get("reconciled")),
            "reconciledLateSuccess": bool(result.get("reconciled")),
            **event_meta,
        })
        return {"success": True, "status": "success", "confirmed": True, "finalized": result}
    if (task_status in ("completed", "done") and acct_status in ("failed", "error")) or task_status in ("failed", "error"):
        _finalize_user_failure(poll_id, user.get("id"), f"YPixel 失败: {message or '任务失败'}", via="ypixel", refund_cost=ctx["cost"], email=ctx.get("email", ""))
        _complete_async_task("ypixel", poll_id)
        return {"success": True, "status": "failed", "confirmed": True}
    return {"success": True, "status": task_status or "pending", "confirmed": False}


class YPixelJobRequest(BaseModel):
    email: str
    password: str
    twofa: str = ""
    recovery_email: str = ""


@app.post("/api/ypixel/jobs")
async def ypixel_submit_job(request: YPixelJobRequest, authorization: Optional[str] = Header(None)):
    """Submit a YPixel job — picks a card from pool, posts to pixel.yh-mo.xyz."""
    ypixel_cfg = _get_ypixel_config()
    if not ypixel_cfg["enabled"]:
        _broadcast_submit_failure(
            "ypixel",
            "YPixel 服务未启用",
            email=request.email,
            method="ypixel_card_pool",
            http_status=503,
        )
        raise HTTPException(status_code=503, detail="服务端错误")

    credit_cost = ypixel_cfg.get("creditCost", 1.0)

    # Auth
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="账号已被禁用")
    user_id = user.get("id")
    credits = user.get("credits", 0)
    if credits < credit_cost:
        raise HTTPException(status_code=400, detail="服务端错误")

    # Pick an available card from pool
    conn = database.get_connection()
    card_row = conn.execute("SELECT id, card_key FROM ypixel_cards WHERE status='available' AND remaining > 0 ORDER BY remaining DESC, id ASC LIMIT 1").fetchone()
    if not card_row:
        _broadcast_submit_failure(
            "ypixel",
            "YPixel 无可用卡密",
            email=request.email,
            user_id=user_id,
            method="ypixel_card_pool",
            http_status=503,
        )
        raise HTTPException(status_code=503, detail="服务端错误")
    card_id = card_row["id"]
    card_key = card_row["card_key"]

    _deduct_user_credits_or_raise(user_id, credit_cost, "服务端错误")

    # Reserve the card
    conn.execute("UPDATE ypixel_cards SET status='reserved', used_by_email=? WHERE id=?", (request.email, card_id))
    conn.commit()

    # Format account line: email----password----recovery_email----2fa
    parts = [request.email, request.password]
    parts.append(request.recovery_email or "")
    parts.append(request.twofa or "")
    account_line = "----".join(parts)

    # Submit to YPixel API
    import time as _t
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{ypixel_cfg['baseUrl']}/api/submit-task",
                json={"card_key": card_key, "accounts_text": account_line},
                headers={"Content-Type": "application/json"},
            )
        data = resp.json()

        if resp.status_code == 200 and (data.get("task_id") or data.get("success")):
            task_id = str(data.get("task_id", ""))
            poll_id = f"yp_{int(_t.time())}_{request.email[:8]}"

            task = asyncio.create_task(
                _ypixel_poll_job(task_id, card_key, request.email, user_id, ypixel_cfg, poll_id)
            )
            _ypixel_polling_tasks[poll_id] = task
            _ypixel_job_context[poll_id] = {
                "task_id": task_id,
                "card_key": card_key,
                "email": request.email,
                "user_id": user_id,
                "cost": credit_cost,
                "base_url": ypixel_cfg["baseUrl"],
                "remote_task_id": task_id,
            }
            _register_async_task("ypixel", poll_id, _ypixel_job_context[poll_id])

            return {
                "job_id": poll_id,
                "task_id": poll_id,
                "status": "queued",
                "source": "ypixel",
            }
        else:
            # Submit failed — mark card as invalid
            conn.execute("UPDATE ypixel_cards SET status='invalid' WHERE id=?", (card_id,))
            conn.commit()
            err_msg = data.get("message", data.get("error", "提交失败"))
            refund_result = _refund_user_credits(user_id, credit_cost, request.email, via="ypixel_submit")
            _record_submit_failure(
                "ypixel",
                err_msg,
                email=request.email,
                user_id=user_id,
                method="ypixel_card_pool",
                http_status=400,
                refunded=refund_result.get("refunded", False),
                card_key=card_key,
                via="ypixel",
            )
            raise HTTPException(status_code=400, detail="服务端错误")

    except httpx.HTTPError as e:
        # Connection error — release card back
        conn.execute("UPDATE ypixel_cards SET status='available', used_by_email='' WHERE id=?", (card_id,))
        conn.commit()
        refund_result = _refund_user_credits(user_id, credit_cost, request.email, via="ypixel_submit")
        _record_submit_failure(
            "ypixel",
            f"YPixel 连接失败: {str(e)}",
            email=request.email,
            user_id=user_id,
            method="ypixel_card_pool",
            http_status=502,
            refunded=refund_result.get("refunded", False),
            card_key=card_key,
            via="ypixel",
        )
        raise HTTPException(status_code=502, detail="服务端错误")


# --- YPixel Config ---

@app.get("/api/ypixel/config")
async def ypixel_get_config(authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    cfg = _get_ypixel_config()
    return {
        "enabled": cfg["enabled"],
        "baseUrl": cfg["baseUrl"],
        "creditCost": cfg["creditCost"],
    }


@app.post("/api/ypixel/config")
async def ypixel_update_config(request: Request, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    import config_manager
    body = await request.json()
    updates = {}
    if "enabled" in body:
        updates["enabled"] = bool(body["enabled"])
    if "baseUrl" in body:
        updates["baseUrl"] = body["baseUrl"]
    if "creditCost" in body:
        updates["creditCost"] = float(body["creditCost"])
    result = config_manager.update_config({"ypixelApi": updates})
    if result:
        return {"success": True}
    raise HTTPException(status_code=500, detail="保存失败")


# --- YPixel Card Pool Management ---

@app.post("/api/ypixel/cards")
async def ypixel_cards_add(request: Request, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    body = await request.json()
    keys_raw = body.get("keys", "")
    keys = [k.strip() for k in keys_raw.strip().split("\n") if k.strip()]
    if not keys:
        raise HTTPException(status_code=400, detail="请输入至少一个卡密")

    from datetime import datetime
    ypixel_cfg = _get_ypixel_config()
    base_url = ypixel_cfg.get("baseUrl", "https://pixel.yh-mo.xyz")

    conn = database.get_connection()
    valid_count = 0
    invalid_count = 0
    duplicate_count = 0
    results = []

    async with httpx.AsyncClient(timeout=30) as client:
        for key in keys:
            # Check for duplicates first
            existing = conn.execute("SELECT id FROM ypixel_cards WHERE card_key=?", (key,)).fetchone()
            if existing:
                duplicate_count += 1
                results.append({"key": key, "status": "duplicate", "msg": "已存在"})
                continue

            # Validate against YPixel API
            remaining = 0
            total_count = 0
            try:
                resp = await client.post(
                    f"{base_url}/api/verify-card",
                    json={"card_key": key},
                    headers={"Content-Type": "application/json"},
                )
                data = resp.json()
                ok = data.get("valid", False)
                remaining = data.get("remaining", 0)
                total_count = data.get("total_count", 0)
                msg = data.get("message", "")
            except Exception as e:
                ok = False
                msg = f"验证请求失败: {str(e)}"

            status = "available" if ok else "invalid"
            try:
                conn.execute(
                    "INSERT INTO ypixel_cards (card_key, status, created_at, remaining, total_count) VALUES (?, ?, ?, ?, ?)",
                    (key, status, datetime.now().isoformat(), remaining, total_count),
                )
            except Exception:
                duplicate_count += 1
                results.append({"key": key, "status": "duplicate", "msg": "已存在"})
                continue

            if ok:
                valid_count += 1
                results.append({"key": key, "status": "valid", "msg": msg or "验证通过", "remaining": remaining, "total_count": total_count})
            else:
                invalid_count += 1
                results.append({"key": key, "status": "invalid", "msg": msg or "验证失败"})

    conn.commit()
    return {
        "success": True,
        "valid": valid_count,
        "invalid": invalid_count,
        "duplicate": duplicate_count,
        "total_input": len(keys),
        "results": results,
    }


@app.get("/api/ypixel/cards")
async def ypixel_cards_list(authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    rows = conn.execute("SELECT * FROM ypixel_cards ORDER BY id DESC").fetchall()
    return {"keys": [dict(r) for r in rows]}


@app.get("/api/ypixel/cards/stats")
async def ypixel_cards_stats(authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    total = conn.execute("SELECT COUNT(*) FROM ypixel_cards").fetchone()[0]
    available = conn.execute("SELECT COUNT(*) FROM ypixel_cards WHERE status='available' AND remaining > 0").fetchone()[0]
    used = conn.execute("SELECT COUNT(*) FROM ypixel_cards WHERE status='used'").fetchone()[0]
    return {"total": total, "available": available, "used": used}


@app.delete("/api/ypixel/cards/{card_id}")
async def ypixel_cards_delete(card_id: int, authorization: Optional[str] = Header(None)):
    _verify_admin_token(authorization)
    conn = database.get_connection()
    conn.execute("DELETE FROM ypixel_cards WHERE id=?", (card_id,))
    conn.commit()
    return {"success": True}


# ==============================================================
# GPT Recharge — Dual Channel Card Key Pool + Proxy
# ==============================================================
# Channel "sbs" → chong.databrain.sbs  (old)
# Channel "red" → redeemgpt.com        (new)
# ==============================================================

GPT_SBS_RECHARGE_BASE = "https://chong.databrain.sbs"
GPT_RED_RECHARGE_BASE = "https://gpt.86gamestore.com/api"
GPT_RED_ORIGIN = "https://redeemgpt.com"
GPT_VIP_RECHARGE_BASE = "https://ht.gptai.vip/api"
GPT_VIP_ORIGIN = "https://shop.gptai.vip"
GPT_AIC_RECHARGE_BASE = "https://aichong.plus/api"
GPT_AIC_ORIGIN = "https://aichong.plus"
GPT_NITRO_RECHARGE_BASE = "https://receipt-api.nitro.xin"
GPT_NITRO_ORIGIN = "https://receipt.nitro.xin"
GPT_RECHARGE_COST = 1.5  # CDK points per successful recharge
GPT_TEAM_INVITE_COST = 0.3
GPT_KEY_CHANNELS = ("sbs", "red", "vip", "aic", "nitro")
GPT_CHANNELS = (*GPT_KEY_CHANNELS, "tg")

import uuid as _uuid
import asyncio as _asyncio
from telethon import events

_gpt_tg_account_locks: Dict[str, asyncio.Lock] = {}


def _get_gpt_tg_lock(account_id: str) -> asyncio.Lock:
    if account_id not in _gpt_tg_account_locks:
        _gpt_tg_account_locks[account_id] = asyncio.Lock()
    return _gpt_tg_account_locks[account_id]


def _get_gpt_tg_config() -> dict:
    import config_manager
    cfg = config_manager.get_config().get("verification", {}).get("gptRechargeBot", {}) or {}
    return {
        "enabled": bool(cfg.get("enabled", False)),
        "targetBot": (cfg.get("targetBot") or "@AutoRechargeProbot").strip(),
        "sendFormat": cfg.get("sendFormat") or "{accessToken}",
        "botFirstFallbackToKey": bool(cfg.get("botFirstFallbackToKey", False)),
        "preCommandEnabled": bool(cfg.get("preCommandEnabled", True)),
        "preCommand": (cfg.get("preCommand") or "⚡ 激活plus母号").strip(),
        "preCommandTimeout": int(cfg.get("preCommandTimeout", 45)),
        "processingKeywords": cfg.get("processingKeywords") or ["PROCESSING", "处理中", "WAIT", "⏳", "RUNNING"],
        "responseRules": cfg.get("responseRules") or [],
        "cooldown": cfg.get("cooldown") or {"keywords": ["COOLDOWN", "RATE LIMIT", "TOO MANY"], "timePattern": r"(\d+)\s*[MS]"},
        "timeout": int(cfg.get("timeout", 120)),
        "maxRetries": int(cfg.get("maxRetries", 5)),
    }


def _extract_access_token_from_session(session_text: str) -> str:
    """Extract accessToken from user-submitted session payload.
    Supports JSON payload and loose key-value text copied from browser devtools.
    """
    raw = (session_text or "").strip()
    if not raw:
        return ""

    # 1) JSON payload path: account.accessToken
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            account_obj = obj.get("account")
            if isinstance(account_obj, dict):
                token = account_obj.get("accessToken")
                if isinstance(token, str) and token.strip():
                    return token.strip()
            token = obj.get("accessToken")
            if isinstance(token, str) and token.strip():
                return token.strip()
    except Exception:
        pass

    # 2) Fallback regex for loose text: accessToken "...." / accessToken: "...." / accessToken='....'
    m = re.search(r'accessToken\s*[:=]?\s*["\']([^"\']+)["\']', raw, flags=re.IGNORECASE)
    if m and m.group(1).strip():
        return m.group(1).strip()

    # 3) Fallback regex without quotes (stop at whitespace/newline)
    m2 = re.search(r'accessToken\s*[:=]?\s*([A-Za-z0-9\-\._~\+/]+=*)', raw, flags=re.IGNORECASE)
    if m2 and m2.group(1).strip():
        return m2.group(1).strip()

    return ""


def _has_available_gptbot_account(config: Optional[dict] = None) -> bool:
    if config is None:
        import config_manager
        cfg = config_manager.get_config()
    else:
        cfg = config
    tg_cfg = _get_gpt_tg_config()
    if not tg_cfg.get("enabled"):
        return False
    if not tg_manager.is_connected:
        return False

    tg_accounts = cfg.get("telegramAccounts", [])
    live_clients = tg_manager.get_all_clients()
    now_ts = time.time()
    return any(
        acc.get("enabled", True)
        and "gptbot" in (acc.get("assignedBots") or [])
        and acc.get("id") in live_clients
        and tg_manager._cooldowns.get(acc.get("id"), 0) <= now_ts
        for acc in tg_accounts
    )


def _parse_gpt_tg_response(text: str, cfg: dict) -> dict:
    raw = text or ""
    upper = " ".join(raw.upper().split())

    # Match explicit response rules first
    for rule in cfg.get("responseRules", []) or []:
        kws = [str(k).upper() for k in (rule.get("keywords") or []) if str(k).strip()]
        if kws and any(k in upper for k in kws):
            status = rule.get("status", "failed")
            result = {
                "success": bool(rule.get("success", False)),
                "status": status,
                "message": rule.get("message", "任务完成"),
                "raw": raw,
            }
            if status == "cooldown":
                cd_cfg = cfg.get("cooldown", {}) or {}
                pattern = cd_cfg.get("timePattern") or r"(\d+)\s*[MS]"
                m = re.search(pattern, upper, flags=re.IGNORECASE)
                if m:
                    value = int(m.group(1))
                    if "M" in upper and "S" not in upper:
                        value *= 60
                    result["cooldown_seconds"] = value
                else:
                    result["cooldown_seconds"] = 90
            return result

    # Processing keywords
    for kw in cfg.get("processingKeywords", []) or []:
        if str(kw).strip() and str(kw).upper() in upper:
            return {"success": None, "status": "processing", "message": "处理中", "raw": raw}

    # Conservative fallback
    if any(k in upper for k in ("SUCCESS", "SUCCESSFUL", "✅", "DONE", "COMPLETED", "充值成功")):
        return {"success": True, "status": "approved", "message": "充值成功", "raw": raw}
    if any(k in upper for k in ("COOLDOWN", "RATE LIMIT", "TOO MANY")):
        return {"success": False, "status": "cooldown", "message": "账号冷却中", "cooldown_seconds": 90, "raw": raw}
    if any(k in upper for k in ("FAIL", "FAILED", "ERROR", "❌", "INVALID", "EXPIRED", "充值失败")):
        return {"success": False, "status": "failed", "message": "充值失败", "raw": raw}
    return {"success": None, "status": "processing", "message": "处理中", "raw": raw}


async def _send_gpt_tg_and_wait(client, bot_username: str, outbound: str, cfg: dict) -> dict:
    loop = asyncio.get_event_loop()
    future = loop.create_future()
    bot_name = bot_username.lstrip("@")

    async def handler(event):
        if future.done():
            return
        reply_text = event.message.text or event.message.message or ""
        if not reply_text:
            reply_text = event.message.caption or ""
        if not reply_text:
            return
        parsed = _parse_gpt_tg_response(reply_text, cfg)
        if parsed.get("status") == "processing":
            return
        future.set_result(parsed)

    client.add_event_handler(handler, events.NewMessage(from_users=bot_name))
    client.add_event_handler(handler, events.MessageEdited(from_users=bot_name))
    try:
        await client.send_message(bot_name, outbound)
        return await asyncio.wait_for(future, timeout=max(30, int(cfg.get("timeout", 120))))
    except asyncio.TimeoutError:
        return {"success": False, "status": "timeout", "message": "TG Bot 响应超时"}
    finally:
        with contextlib.suppress(Exception):
            client.remove_event_handler(handler, events.NewMessage)
        with contextlib.suppress(Exception):
            client.remove_event_handler(handler, events.MessageEdited)


async def _send_tg_and_wait_any_reply(client, bot_username: str, outbound: str, timeout: int = 45) -> Optional[str]:
    """Send a TG message and wait for the next bot reply text."""
    loop = asyncio.get_event_loop()
    future = loop.create_future()
    bot_name = bot_username.lstrip("@")

    async def handler(event):
        if future.done():
            return
        reply_text = event.message.text or event.message.message or ""
        if not reply_text:
            reply_text = event.message.caption or ""
        if not reply_text:
            return
        future.set_result(reply_text)

    client.add_event_handler(handler, events.NewMessage(from_users=bot_name))
    client.add_event_handler(handler, events.MessageEdited(from_users=bot_name))
    try:
        await client.send_message(bot_name, outbound)
        text = await asyncio.wait_for(future, timeout=max(10, int(timeout or 45)))
        return text
    except asyncio.TimeoutError:
        return None
    finally:
        with contextlib.suppress(Exception):
            client.remove_event_handler(handler, events.NewMessage)
        with contextlib.suppress(Exception):
            client.remove_event_handler(handler, events.MessageEdited)


async def _gpt_recharge_via_tg_bot(card_key: str, account: str, email: str):
    cfg = _get_gpt_tg_config()
    if not cfg.get("enabled"):
        return {"success": False, "status": "failed", "message": "TG 通道未启用"}
    if not tg_manager.is_connected:
        return {"success": False, "status": "failed", "message": "TG 账号未连接"}

    send_format = cfg.get("sendFormat", "{accessToken}")
    access_token = _extract_access_token_from_session(account)
    if "{accessToken}" in send_format and not access_token:
        return {"success": False, "status": "failed", "message": "未从 session 信息中提取到 accessToken"}
    outbound = (
        send_format
        .replace("{card_key}", card_key)
        .replace("{account}", account)
        .replace("{email}", email or "")
        .replace("{accessToken}", access_token)
    )
    max_retries = max(1, int(cfg.get("maxRetries", 5)))

    for _ in range(max_retries):
        pool_item = tg_manager.get_next_client(bot_type="gptbot")
        if not pool_item:
            wait_seconds = tg_manager.get_shortest_cooldown_wait()
            if wait_seconds > 0:
                await asyncio.sleep(min(wait_seconds, 30))
                continue
            return {"success": False, "status": "failed", "message": "没有可用的 TG 充值账号"}

        acc_id, client = pool_item
        lock = _get_gpt_tg_lock(acc_id)
        async with lock:
            # Optional pre-command flow: e.g. "⚡ 激活plus母号" -> wait reply -> then send accessToken
            if cfg.get("preCommandEnabled") and "{accessToken}" in send_format:
                pre_cmd = (cfg.get("preCommand") or "").strip()
                if pre_cmd:
                    pre_reply = await _send_tg_and_wait_any_reply(
                        client,
                        cfg.get("targetBot", "@AutoRechargeProbot"),
                        pre_cmd,
                        int(cfg.get("preCommandTimeout", 45)),
                    )
                    if not pre_reply:
                        return {"success": False, "status": "timeout", "message": "预指令发送后无响应"}
            result = await _send_gpt_tg_and_wait(client, cfg.get("targetBot", "@AutoRechargeProbot"), outbound, cfg)

        result["account_id"] = acc_id
        if result.get("status") == "cooldown":
            tg_manager.set_cooldown(acc_id, int(result.get("cooldown_seconds") or 90))
            continue
        return result

    return {"success": False, "status": "failed", "message": "所有 TG 账号均在冷却中，请稍后重试"}


def _release_gpt_key(card_key: str):
    conn = database.get_connection()
    conn.execute(
        "UPDATE gpt_keys SET status='available' WHERE card_key=? AND status='reserved'",
        (card_key,),
    )
    conn.commit()


def _reserve_any_gpt_key_for_user(user_id: int, excluded_channels: Optional[List[str]] = None) -> Optional[dict]:
    """Reserve one available key for user (used for TG->card fallback)."""
    conn = database.get_connection()
    excluded_channels = excluded_channels or []
    key_placeholders = ",".join("?" for _ in GPT_KEY_CHANNELS)
    key_channel_params = list(GPT_KEY_CHANNELS)
    if excluded_channels and len(excluded_channels) < len(GPT_KEY_CHANNELS):
        placeholders = ",".join("?" for _ in excluded_channels)
        row = conn.execute(
            f"SELECT id, card_key, channel FROM gpt_keys WHERE status='available' AND channel IN ({key_placeholders}) AND channel NOT IN ({placeholders}) LIMIT 1",
            key_channel_params + excluded_channels,
        ).fetchone()
    elif excluded_channels:
        row = None
    else:
        row = conn.execute(
            f"SELECT id, card_key, channel FROM gpt_keys WHERE status='available' AND channel IN ({key_placeholders}) LIMIT 1",
            key_channel_params,
        ).fetchone()
    if not row:
        return None
    now = datetime.now().isoformat()
    conn.execute(
        "UPDATE gpt_keys SET status='reserved', used_by_cdk=?, used_at=? WHERE id=?",
        (f"user:{user_id}", now, row["id"]),
    )
    conn.commit()
    return {"id": row["id"], "card_key": row["card_key"], "channel": row["channel"] or "sbs"}

def _gpt_sign():
    """Generate a sign value (UUID v4) matching the SBS API's expectation."""
    return str(_uuid.uuid4())


def _red_api_check(card_key: str) -> dict:
    """Validate a RED channel card key via curl_cffi (bypasses Cloudflare)."""
    from curl_cffi import requests as curl_requests
    import random
    imp = random.choice(["chrome110", "chrome100"])
    session = curl_requests.Session(impersonate=imp)
    resp = session.post(
        f"{GPT_RED_RECHARGE_BASE}/check",
        json={"cdkey": card_key},
        headers={
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "origin": GPT_RED_ORIGIN,
            "referer": f"{GPT_RED_ORIGIN}/",
        },
        timeout=30,
    )
    return resp.json()


def _red_api_activate(card_key: str, session_info: str) -> dict:
    """Submit RED channel recharge via curl_cffi (bypasses Cloudflare)."""
    from curl_cffi import requests as curl_requests
    import random
    imp = random.choice(["chrome110", "chrome100"])
    session = curl_requests.Session(impersonate=imp)
    resp = session.post(
        f"{GPT_RED_RECHARGE_BASE}/activate",
        json={"cdkey": card_key, "session_info": session_info, "force": 1},
        headers={
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "origin": GPT_RED_ORIGIN,
            "referer": f"{GPT_RED_ORIGIN}/",
        },
        timeout=60,
    )
    return resp.json()


async def _vip_api_check(card_key: str) -> dict:
    """Validate a VIP channel card key via httpx."""
    import httpx
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GPT_VIP_RECHARGE_BASE}/redeem/verify",
            json={"cardCode": card_key},
            headers={
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "origin": GPT_VIP_ORIGIN,
                "referer": f"{GPT_VIP_ORIGIN}/",
            },
        )
        return resp.json()


async def _vip_api_submit(card_key: str, token_content: str) -> dict:
    """Submit VIP channel recharge via httpx."""
    import httpx
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{GPT_VIP_RECHARGE_BASE}/redeem/submit",
            json={"cardCode": card_key, "tokenContent": token_content},
            headers={
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "origin": GPT_VIP_ORIGIN,
                "referer": f"{GPT_VIP_ORIGIN}/",
            },
        )
        return resp.json()


async def _aic_api_check(card_key: str) -> dict:
    """Validate an AIC channel card key via httpx."""
    import httpx
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GPT_AIC_RECHARGE_BASE}/redeem/verify",
            json={"cardCode": card_key, "channel": "primary"},
            headers={
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "origin": GPT_AIC_ORIGIN,
                "referer": f"{GPT_AIC_ORIGIN}/",
            },
        )
        return resp.json()


async def _aic_api_submit(card_key: str, token_content: str) -> dict:
    """Submit AIC channel recharge via httpx."""
    import httpx
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{GPT_AIC_RECHARGE_BASE}/redeem/submit",
            json={"cardCode": card_key, "tokenContent": token_content, "allowOverwrite": False, "channel": "primary"},
            headers={
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "origin": GPT_AIC_ORIGIN,
                "referer": f"{GPT_AIC_ORIGIN}/",
            },
        )
        return resp.json()


async def _nitro_api_check(card_key: str) -> dict:
    """Validate a Nitro channel card key via httpx."""
    import httpx
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GPT_NITRO_RECHARGE_BASE}/cdks/public/check",
            json={"code": card_key},
            headers={
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "x-product-id": "chatgpt",
                "origin": GPT_NITRO_ORIGIN,
                "referer": f"{GPT_NITRO_ORIGIN}/",
            },
        )
        return resp.json()


async def _nitro_api_submit(card_key: str, token_content: str) -> dict:
    """Submit Nitro channel recharge via httpx."""
    import httpx
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{GPT_NITRO_RECHARGE_BASE}/external/public/check-user",
            json={"cdk": card_key, "user": token_content},
            headers={
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "x-product-id": "chatgpt",
                "origin": GPT_NITRO_ORIGIN,
                "referer": f"{GPT_NITRO_ORIGIN}/",
            },
        )
        return resp.json()


# --- Admin: Add card keys in bulk (with external API validation) ---
@app.post("/api/gpt-keys/add")
async def gpt_keys_add(request: Request, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授权")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")

    body = await request.json()
    keys_text = body.get("keys", "")
    channel = body.get("channel", "sbs").strip().lower()
    if channel not in GPT_KEY_CHANNELS:
        channel = "sbs"
    keys = [k.strip() for k in keys_text.strip().split("\n") if k.strip()]
    if not keys:
        raise HTTPException(status_code=400, detail="没有有效的卡密")

    import httpx
    conn = database.get_connection()
    now = datetime.now().isoformat()
    valid_count = 0
    invalid_count = 0
    duplicate_count = 0
    results = []  # per-key results

    async with httpx.AsyncClient(timeout=30) as client:
        for key in keys:
            # Check for duplicates first
            existing = conn.execute("SELECT id FROM gpt_keys WHERE card_key=?", (key,)).fetchone()
            if existing:
                duplicate_count += 1
                results.append({"key": key, "status": "duplicate", "msg": "已存在"})
                continue

            # Validate against external API
            try:
                if channel == "red":
                    data = await _asyncio.to_thread(_red_api_check, key)
                    ok = data.get("success") or data.get("flag", False)
                    msg = data.get("msg", "")
                    gift = (data.get("data") or {}).get("gift_name", "") if ok else ""
                elif channel == "vip":
                    data = await _vip_api_check(key)
                    vip_data = data.get("data") or {}
                    ok = vip_data.get("valid", False) and vip_data.get("exists", False)
                    msg = vip_data.get("message", data.get("msg", ""))
                    gift = vip_data.get("productName", "") if ok else ""
                elif channel == "aic":
                    data = await _aic_api_check(key)
                    aic_data = data.get("data") or {}
                    ok = aic_data.get("valid", False) and aic_data.get("exists", False)
                    msg = aic_data.get("message", data.get("msg", ""))
                    gift = "AIC Plus" if ok else ""
                elif channel == "nitro":
                    data = await _nitro_api_check(key)
                    ok = bool(data.get("app_product_name"))
                    msg = data.get("message", data.get("msg", ""))
                    gift = data.get("app_product_name", "Nitro Plus") if ok else ""
                else:
                    resp = await client.post(
                        f"{GPT_SBS_RECHARGE_BASE}/api/vip/c",
                        json={"cdk": key, "sign": _gpt_sign(), "timestamp": int(datetime.now().timestamp() * 1000)}
                    )
                    data = resp.json()
                    ok = resp.status_code == 200 and data.get("code") == 1
                    msg = data.get("message", "")
                    gift = data.get("data", "") if ok else ""
            except Exception as e:
                ok = False
                msg = f"验证请求失败: {str(e)}"
                gift = ""

            status = "available" if ok else "invalid"
            try:
                conn.execute(
                    "INSERT INTO gpt_keys (card_key, status, created_at, channel) VALUES (?, ?, ?, ?)",
                    (key, status, now, channel)
                )
            except Exception:
                duplicate_count += 1
                results.append({"key": key, "status": "duplicate", "msg": "已存在"})
                continue

            if ok:
                valid_count += 1
                results.append({"key": key, "status": "valid", "msg": gift or "验证通过"})
            else:
                invalid_count += 1
                results.append({"key": key, "status": "invalid", "msg": msg or "验证失败"})

    conn.commit()
    return {
        "success": True,
        "valid": valid_count,
        "invalid": invalid_count,
        "duplicate": duplicate_count,
        "total_input": len(keys),
        "channel": channel,
        "results": results,
    }


# --- Admin: List card keys ---
@app.get("/api/gpt-keys/list")
async def gpt_keys_list(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授权")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")

    conn = database.get_connection()
    key_placeholders = ",".join("?" for _ in GPT_KEY_CHANNELS)
    rows = conn.execute(
        f"SELECT * FROM gpt_keys WHERE channel IN ({key_placeholders}) ORDER BY id DESC",
        list(GPT_KEY_CHANNELS)
    ).fetchall()
    return {"keys": [dict(r) for r in rows]}


# --- Admin: Stats ---
@app.get("/api/gpt-keys/stats")
async def gpt_keys_stats(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授权")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")

    conn = database.get_connection()
    key_placeholders = ",".join("?" for _ in GPT_KEY_CHANNELS)
    key_params = list(GPT_KEY_CHANNELS)
    total = conn.execute(
        f"SELECT COUNT(*) FROM gpt_keys WHERE channel IN ({key_placeholders})",
        key_params
    ).fetchone()[0]
    available = conn.execute(
        f"SELECT COUNT(*) FROM gpt_keys WHERE status='available' AND channel IN ({key_placeholders})",
        key_params
    ).fetchone()[0]
    used = conn.execute(
        f"SELECT COUNT(*) FROM gpt_keys WHERE status='used' AND channel IN ({key_placeholders})",
        key_params
    ).fetchone()[0]

    # Per-channel stats
    channels = {}
    for ch in GPT_KEY_CHANNELS:
        ch_total = conn.execute("SELECT COUNT(*) FROM gpt_keys WHERE channel=?", (ch,)).fetchone()[0]
        ch_avail = conn.execute("SELECT COUNT(*) FROM gpt_keys WHERE channel=? AND status='available'", (ch,)).fetchone()[0]
        ch_used = conn.execute("SELECT COUNT(*) FROM gpt_keys WHERE channel=? AND status='used'", (ch,)).fetchone()[0]
        channels[ch] = {"total": ch_total, "available": ch_avail, "used": ch_used}

    return {"total": total, "available": available, "used": used, "channels": channels}


# --- Admin: Delete a card key ---
@app.delete("/api/gpt-keys/{key_id}")
async def gpt_keys_delete(key_id: int, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授权")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")

    conn = database.get_connection()
    conn.execute("DELETE FROM gpt_keys WHERE id=?", (key_id,))
    conn.commit()
    return {"success": True}


# --- User: Exchange CDK points for a card key (with channel failover) ---
@app.post("/api/gpt/exchange")
async def gpt_exchange(request: Request, authorization: Optional[str] = Header(None)):
    # Auth via JWT token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    # Check credits (verify_token returns full user dict with 'id' and 'credits')
    user_id = user.get("id")
    credits = user.get("credits", 0)
    if credits < GPT_RECHARGE_COST:
        raise HTTPException(status_code=400, detail=f"积分不足（需要 {GPT_RECHARGE_COST} 积分，剩余 {credits}）")

    try:
        # Pick an available key — skip channels under maintenance, round-robin
        conn = database.get_connection()
        import config_manager as _cfg_mgr
        _cfg = _cfg_mgr.get_config() or {}
        _maint = (_cfg.get("serviceMaintenance") or {})
        _tg_cfg = _get_gpt_tg_config()

        # Bot-first strategy: prefer TG as primary channel when enabled by config.
        if (
            _tg_cfg.get("botFirstFallbackToKey")
            and not bool(_maint.get("gpt_tg"))
            and _has_available_gptbot_account(_cfg)
        ):
            return {
                "success": True,
                "card_key": "",
                "masked": "TG BOT",
                "key_id": 0,
                "channel": "tg",
            }

        excluded_channels = [ch for ch in GPT_KEY_CHANNELS if bool(_maint.get(f"gpt_{ch}"))]
        placeholders = ",".join("?" for _ in excluded_channels) if excluded_channels else None
        key_placeholders = ",".join("?" for _ in GPT_KEY_CHANNELS)
        key_channel_params = list(GPT_KEY_CHANNELS)
        if excluded_channels and len(excluded_channels) < len(GPT_KEY_CHANNELS):
            row = conn.execute(
                f"SELECT id, card_key, channel FROM gpt_keys WHERE status='available' AND channel IN ({key_placeholders}) AND channel NOT IN ({placeholders}) LIMIT 1",
                key_channel_params + excluded_channels
            ).fetchone()
        elif not excluded_channels:
            row = conn.execute(
                f"SELECT id, card_key, channel FROM gpt_keys WHERE status='available' AND channel IN ({key_placeholders}) LIMIT 1",
                key_channel_params
            ).fetchone()
        else:
            row = None

        # If key channels unavailable, fallback to TG bot channel (no card key required).
        if not row:
            if not bool(_maint.get("gpt_tg")) and _has_available_gptbot_account(_cfg):
                return {
                    "success": True,
                    "card_key": "",
                    "masked": "TG BOT",
                    "key_id": 0,
                    "channel": "tg",
                }
            if len(excluded_channels) == len(GPT_KEY_CHANNELS) and bool(_maint.get("gpt_tg")):
                raise HTTPException(status_code=503, detail="所有充值通道维护中")
            raise HTTPException(status_code=400, detail="暂无可用充值通道，请联系管理员")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[GPT Exchange] Unexpected error")
        raise HTTPException(status_code=500, detail=f"GPT 兑换失败: {e}")

    key_id, card_key, channel = row["id"], row["card_key"], row["channel"] or "sbs"

    # Mark key as reserved
    now = datetime.now().isoformat()
    conn.execute(
        "UPDATE gpt_keys SET status='reserved', used_by_cdk=?, used_at=? WHERE id=?",
        (f"user:{user_id}", now, key_id)
    )
    conn.commit()

    # Validate card key via external API based on channel
    import httpx
    try:
        if channel == "red":
            data = await _asyncio.to_thread(_red_api_check, card_key)
            ok = data.get("success") or data.get("flag", False)
            if not ok:
                msg = data.get("msg", "卡密验证失败")
                conn.execute("UPDATE gpt_keys SET status='invalid' WHERE id=?", (key_id,))
                conn.commit()
                raise HTTPException(status_code=400, detail=msg)
            gift_info = data.get("data", {})
            masked = gift_info.get("gift_name", "")
        elif channel == "vip":
            data = await _vip_api_check(card_key)
            vip_data = data.get("data") or {}
            ok = vip_data.get("valid", False) and vip_data.get("exists", False)
            if not ok:
                msg = vip_data.get("message", data.get("msg", "卡密验证失败"))
                conn.execute("UPDATE gpt_keys SET status='invalid' WHERE id=?", (key_id,))
                conn.commit()
                raise HTTPException(status_code=400, detail=msg)
            masked = vip_data.get("productName", "")
        elif channel == "aic":
            data = await _aic_api_check(card_key)
            aic_data = data.get("data") or {}
            ok = aic_data.get("valid", False) and aic_data.get("exists", False)
            if not ok:
                msg = aic_data.get("message", data.get("msg", "卡密验证失败"))
                conn.execute("UPDATE gpt_keys SET status='invalid' WHERE id=?", (key_id,))
                conn.commit()
                raise HTTPException(status_code=400, detail=msg)
            masked = "AIC Plus"
        elif channel == "nitro":
            data = await _nitro_api_check(card_key)
            ok = bool(data.get("app_product_name"))
            if not ok:
                msg = data.get("message", data.get("msg", "卡密验证失败"))
                conn.execute("UPDATE gpt_keys SET status='invalid' WHERE id=?", (key_id,))
                conn.commit()
                raise HTTPException(status_code=400, detail=msg)
            masked = data.get("app_product_name", "Nitro Plus")
        else:
            # SBS channel
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{GPT_SBS_RECHARGE_BASE}/api/vip/c",
                    json={"cdk": card_key, "sign": _gpt_sign(), "timestamp": int(datetime.now().timestamp() * 1000)}
                )
                data = resp.json()
            if resp.status_code != 200 or data.get("code") != 1:
                conn.execute("UPDATE gpt_keys SET status='invalid' WHERE id=?", (key_id,))
                conn.commit()
                raise HTTPException(status_code=400, detail=data.get("message", "卡密验证失败"))
            masked = data.get("data", "")
    except HTTPException:
        raise
    except Exception as e:
        conn.execute("UPDATE gpt_keys SET status='available', used_by_cdk='', used_at='' WHERE id=?", (key_id,))
        conn.commit()
        raise HTTPException(status_code=502, detail=f"外部 API 错误: {str(e)}")

    return {
        "success": True,
        "card_key": card_key,
        "masked": masked,
        "key_id": key_id,
        "channel": channel,
    }


@app.post("/api/gpt/team-invite")
async def gpt_team_invite(request: Request, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    user_id = user.get("id")
    credits = float(user.get("credits", 0) or 0)
    if credits < GPT_TEAM_INVITE_COST:
        raise HTTPException(status_code=400, detail=f"积分不足（需要 {GPT_TEAM_INVITE_COST} 积分，剩余 {credits}）")

    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="请输入有效邮箱")

    cdk_label = f"user:{user_id}"
    invite_vid = f"gpt_team_{uuid.uuid4().hex[:10]}"
    event_meta = _build_verify_event_meta("gpt", email, user_id, "gpt_team", "", "team")

    broadcast_verify_event({
        "type": "progress",
        "vid": invite_vid,
        "step": "submitted",
        "message": "⏳ 正在创建 Team 邀请...",
        **event_meta,
    })

    team = await _pick_team_for_user_invite()
    if not team:
        _persist_verification_history_strict("failed", invite_vid, "暂无可用 Team 名额", cdk=cdk_label, via="gpt_team")
        _broadcast_submit_failure(
            "gpt",
            "暂无可用 Team 名额",
            email=email,
            user_id=user_id,
            method="gpt_team",
            http_status=503,
            refunded=False,
            channel="team",
        )
        raise HTTPException(status_code=503, detail="暂无可用 Team 名额")

    auth_result = auth.deduct_credits(user_id, GPT_TEAM_INVITE_COST)
    if not auth_result:
        raise HTTPException(status_code=400, detail=f"积分不足（需要 {GPT_TEAM_INVITE_COST} 积分，剩余 {credits}）")


    try:
        conn = database.get_connection()
        team_row = conn.execute("SELECT * FROM gpt_team_accounts WHERE id = ? LIMIT 1", (team["id"],)).fetchone()
        if not team_row:
            raise HTTPException(status_code=404, detail="Team 不存在")

        ensured = await _gpt_team_ensure_access_token(team_row)
        if not ensured.get("success"):
            raise HTTPException(status_code=400, detail=ensured.get("error") or "Team Token 不可用")

        invite_result = await _gpt_team_send_invite(
            ensured["access_token"],
            team_row["account_id"],
            email,
            identifier=ensured.get("identifier") or team_row["email"] or f"team_{team['id']}",
        )
        if not invite_result.get("success"):
            raise HTTPException(status_code=400, detail=invite_result.get("error") or "邀请失败")

        conn.execute(
            """
            INSERT INTO gpt_team_usage_records (email, code, team_id, account_id, redeemed_at, is_warranty_redemption)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                email,
                "TEAM_INVITE",
                int(team["id"]),
                team_row["account_id"] or "",
                datetime.utcnow().isoformat() + "Z",
                0,
            ),
        )
        conn.commit()

        await _gpt_team_sync(team["id"])
        message = f"Team 邀请已发送（{team_row['email']} / {team_row['team_name'] or '未命名 Team'}）"
        _persist_verification_history_strict("pass", invite_vid, message, cdk=cdk_label, via="gpt_team")
        broadcast_verify_event({
            "type": "progress",
            "vid": invite_vid,
            "step": "result",
            "status": "approved",
            "success": True,
            "message": "✅ Team 邀请已发送",
            "teamId": int(team["id"]),
            "teamName": team_row["team_name"] or "",
            **event_meta,
        })
        return {
            "success": True,
            "email": email,
            "team_id": int(team["id"]),
            "team_name": team_row["team_name"] or "",
            "message": message,
        }
    except HTTPException as e:
        with contextlib.suppress(Exception):
            auth.update_credits(user_id, GPT_TEAM_INVITE_COST)
        _persist_verification_history_strict("failed", invite_vid, str(e.detail), cdk=cdk_label, via="gpt_team")
        _broadcast_submit_failure(
            "gpt",
            str(e.detail),
            email=email,
            user_id=user_id,
            method="gpt_team",
            http_status=e.status_code,
            refunded=True,
            channel="team",
        )
        raise
    except Exception as e:
        with contextlib.suppress(Exception):
            auth.update_credits(user_id, GPT_TEAM_INVITE_COST)
        _persist_verification_history_strict("failed", invite_vid, str(e), cdk=cdk_label, via="gpt_team")
        _broadcast_submit_failure(
            "gpt",
            str(e),
            email=email,
            user_id=user_id,
            method="gpt_team",
            http_status=500,
            refunded=True,
            channel="team",
        )
        raise HTTPException(status_code=500, detail=f"Team 邀请失败: {e}")


# --- User: Recharge (proxy to external API, route by channel) ---
@app.post("/api/gpt/recharge")
async def gpt_recharge(request: Request, authorization: Optional[str] = Header(None)):
    # Auth via JWT token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.replace("Bearer ", "")
    user = auth.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    user_id = user.get("id")

    body = await request.json()
    card_key = body.get("card_key", "").strip()
    account = body.get("account", "").strip()  # session JSON or extracted account
    email = body.get("email", "").strip()
    channel = body.get("channel", "sbs").strip().lower()
    tg_cfg = _get_gpt_tg_config()

    if not account:
        raise HTTPException(status_code=400, detail="参数不完整")
    if channel != "tg" and not card_key:
        raise HTTPException(status_code=400, detail="参数不完整")
    if channel not in GPT_CHANNELS:
        raise HTTPException(status_code=400, detail=f"无效通道: {channel}")

    # 先扣积分：检查余额并预扣
    credits = user.get("credits", 0)
    if credits < GPT_RECHARGE_COST:
        raise HTTPException(status_code=400, detail=f"积分不足（需要 {GPT_RECHARGE_COST} 积分，剩余 {credits}）")
    deduct_result = auth.deduct_credits(user_id, GPT_RECHARGE_COST)
    if not deduct_result:
        raise HTTPException(status_code=400, detail=f"积分不足（需要 {GPT_RECHARGE_COST} 积分）")

    import time as _gpt_time
    gpt_vid = f"gpt_{int(_gpt_time.time())}_{email[:8] if email else 'unknown'}"
    cdk_label = f"user:{user_id}" if user_id else ""
    _register_async_task("gpt", gpt_vid, {
        "user_id": user_id,
        "email": email,
        "channel": channel,
        "card_key": card_key,
    })

    # SSE: submitted
    event_meta = _build_verify_event_meta("gpt", email or "GPT充值", user_id, f"gpt_{channel}", card_key, channel)
    broadcast_verify_event({
        "type": "progress",
        "vid": gpt_vid,
        "step": "submitted",
        "message": f"⏳ 正在充值 ({channel.upper()} 通道)...",
        **event_meta,
    })

    def _log_gpt_final(status: str, message: str):
        result = _persist_verification_history_strict(status, gpt_vid, message, cdk=cdk_label, via="gpt")
        if not result.get("success"):
            logger.warning(f"[GPT Recharge] Failed to persist {status} record for {gpt_vid}: {result.get('error', 'unknown error')}")

    import httpx
    try:
        if channel == "red":
            # RED channel: curl_cffi bypasses Cloudflare
            data = await _asyncio.to_thread(_red_api_activate, card_key, account)
            ok = data.get("success") or data.get("flag", False)
            if not ok:
                msg = data.get("msg", "充值失败，请稍后重试")
                _log_gpt_final("failed", msg)
                if card_key:
                    _release_gpt_key(card_key)
                _complete_async_task("gpt", gpt_vid)
                _broadcast_submit_failure(
                    "gpt",
                    msg,
                    email=email or "GPT充值",
                    user_id=user_id,
                    method=f"gpt_{channel}",
                    http_status=400,
                    refunded=False,
                    card_key=card_key,
                    channel=channel,
                )
                raise HTTPException(status_code=400, detail=msg)
        elif channel == "vip":
            # VIP channel: POST /redeem/submit
            data = await _vip_api_submit(card_key, account)
            ok = data.get("success", False) or data.get("code") == 200
            if not ok:
                msg = data.get("msg", data.get("message", "充值失败，请稍后重试"))
                _log_gpt_final("failed", msg)
                if card_key:
                    _release_gpt_key(card_key)
                _complete_async_task("gpt", gpt_vid)
                _broadcast_submit_failure(
                    "gpt",
                    msg,
                    email=email or "GPT充值",
                    user_id=user_id,
                    method=f"gpt_{channel}",
                    http_status=400,
                    refunded=False,
                    card_key=card_key,
                    channel=channel,
                )
                raise HTTPException(status_code=400, detail=msg)
        elif channel == "aic":
            # AIC channel: POST /redeem/submit
            data = await _aic_api_submit(card_key, account)
            ok = data.get("success", False) or data.get("code") == 200
            if not ok:
                msg = data.get("msg", data.get("message", "充值失败，请稍后重试"))
                _log_gpt_final("failed", msg)
                if card_key:
                    _release_gpt_key(card_key)
                _complete_async_task("gpt", gpt_vid)
                _broadcast_submit_failure(
                    "gpt",
                    msg,
                    email=email or "GPT充值",
                    user_id=user_id,
                    method=f"gpt_{channel}",
                    http_status=400,
                    refunded=False,
                    card_key=card_key,
                    channel=channel,
                )
                raise HTTPException(status_code=400, detail=msg)
        elif channel == "tg":
            data = await _gpt_recharge_via_tg_bot(card_key, account, email)
            if not data.get("success"):
                # Optional compensation: bot-first mode can auto-fallback to key channel before failing user.
                can_fallback_to_key = bool(tg_cfg.get("botFirstFallbackToKey"))
                if can_fallback_to_key:
                    import config_manager as _cfg_mgr
                    _cfg = _cfg_mgr.get_config() or {}
                    _maint = (_cfg.get("serviceMaintenance") or {})
                    excluded_channels = [ch for ch in GPT_KEY_CHANNELS if bool(_maint.get(f"gpt_{ch}"))]
                    reserved = _reserve_any_gpt_key_for_user(user_id, excluded_channels)
                    if reserved:
                        card_key = reserved["card_key"]
                        channel = reserved["channel"]
                        broadcast_verify_event({
                            "type": "progress",
                            "vid": gpt_vid,
                            "step": "processing",
                            "message": f"⚠️ TG 通道失败，自动切换到卡密通道 ({channel.upper()})...",
                            **event_meta,
                        })
                        # Continue below into key-channel branch by falling through to next loop iteration block.
                        if channel == "red":
                            data = await _asyncio.to_thread(_red_api_activate, card_key, account)
                            ok = data.get("success") or data.get("flag", False)
                            if not ok:
                                msg = data.get("msg", "充值失败，请稍后重试")
                                _log_gpt_final("failed", msg)
                                if card_key:
                                    _release_gpt_key(card_key)
                                _complete_async_task("gpt", gpt_vid)
                                _broadcast_submit_failure(
                                    "gpt",
                                    msg,
                                    email=email or "GPT充值",
                                    user_id=user_id,
                                    method=f"gpt_{channel}",
                                    http_status=400,
                                    refunded=False,
                                    card_key=card_key,
                                    channel=channel,
                                )
                                raise HTTPException(status_code=400, detail=msg)
                        elif channel == "vip":
                            data = await _vip_api_submit(card_key, account)
                            ok = data.get("success", False) or data.get("code") == 200
                            if not ok:
                                msg = data.get("msg", data.get("message", "充值失败，请稍后重试"))
                                _log_gpt_final("failed", msg)
                                if card_key:
                                    _release_gpt_key(card_key)
                                _complete_async_task("gpt", gpt_vid)
                                _broadcast_submit_failure(
                                    "gpt",
                                    msg,
                                    email=email or "GPT充值",
                                    user_id=user_id,
                                    method=f"gpt_{channel}",
                                    http_status=400,
                                    refunded=False,
                                    card_key=card_key,
                                    channel=channel,
                                )
                                raise HTTPException(status_code=400, detail=msg)
                        elif channel == "aic":
                            data = await _aic_api_submit(card_key, account)
                            ok = data.get("success", False) or data.get("code") == 200
                            if not ok:
                                msg = data.get("msg", data.get("message", "充值失败，请稍后重试"))
                                _log_gpt_final("failed", msg)
                                if card_key:
                                    _release_gpt_key(card_key)
                                _complete_async_task("gpt", gpt_vid)
                                _broadcast_submit_failure(
                                    "gpt",
                                    msg,
                                    email=email or "GPT充值",
                                    user_id=user_id,
                                    method=f"gpt_{channel}",
                                    http_status=400,
                                    refunded=False,
                                    card_key=card_key,
                                    channel=channel,
                                )
                                raise HTTPException(status_code=400, detail=msg)
                        elif channel == "nitro":
                            data = await _nitro_api_submit(card_key, account)
                            ok = data.get("message") != "token is invalid." and ("invalid" not in str(data.get("message", "")).lower())
                            if not ok:
                                msg = data.get("message", "充值失败，AuthSession无效或错误")
                                _log_gpt_final("failed", msg)
                                if card_key:
                                    _release_gpt_key(card_key)
                                _complete_async_task("gpt", gpt_vid)
                                _broadcast_submit_failure(
                                    "gpt",
                                    msg,
                                    email=email or "GPT充值",
                                    user_id=user_id,
                                    method=f"gpt_{channel}",
                                    http_status=400,
                                    refunded=False,
                                    card_key=card_key,
                                    channel=channel,
                                )
                                raise HTTPException(status_code=400, detail=msg)
                        else:
                            async with httpx.AsyncClient(timeout=60) as client:
                                resp = await client.post(
                                    f"{GPT_SBS_RECHARGE_BASE}/api/vip/r",
                                    json={
                                        "cdk": card_key,
                                        "account": account,
                                        "type": "gpt",
                                        "sign": _gpt_sign(),
                                        "timestamp": int(datetime.now().timestamp() * 1000),
                                    }
                                )
                                data = resp.json()
                            if resp.status_code != 200 or data.get("code") != 1:
                                msg = data.get("message", "充值失败，请稍后重试")
                                _log_gpt_final("failed", msg)
                                if card_key:
                                    _release_gpt_key(card_key)
                                _complete_async_task("gpt", gpt_vid)
                                _broadcast_submit_failure(
                                    "gpt",
                                    msg,
                                    email=email or "GPT充值",
                                    user_id=user_id,
                                    method=f"gpt_{channel}",
                                    http_status=resp.status_code or 400,
                                    upstream_status=resp.status_code,
                                    refunded=False,
                                    card_key=card_key,
                                    channel=channel,
                                )
                                raise HTTPException(status_code=400, detail=msg)
                    else:
                        msg = f"{data.get('message', 'TG BOT 充值失败')}（且无可用卡密通道）"
                        _log_gpt_final("failed", msg)
                        _complete_async_task("gpt", gpt_vid)
                        _broadcast_submit_failure(
                            "gpt",
                            msg,
                            email=email or "GPT充值",
                            user_id=user_id,
                            method=f"gpt_tg",
                            http_status=400,
                            refunded=False,
                            card_key=card_key,
                            channel="tg",
                        )
                        raise HTTPException(status_code=400, detail=msg)
                else:
                    msg = data.get("message", "TG BOT 充值失败")
                    _log_gpt_final("failed", msg)
                    if card_key:
                        _release_gpt_key(card_key)
                    _complete_async_task("gpt", gpt_vid)
                    _broadcast_submit_failure(
                        "gpt",
                        msg,
                        email=email or "GPT充值",
                        user_id=user_id,
                        method=f"gpt_{channel}",
                        http_status=400,
                        refunded=False,
                        card_key=card_key,
                        channel=channel,
                    )
                    raise HTTPException(status_code=400, detail=msg)
        else:
            # SBS channel: POST /api/vip/r
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{GPT_SBS_RECHARGE_BASE}/api/vip/r",
                    json={
                        "cdk": card_key,
                        "account": account,
                        "type": "gpt",
                        "sign": _gpt_sign(),
                        "timestamp": int(datetime.now().timestamp() * 1000),
                    }
                )
                data = resp.json()
            if resp.status_code != 200 or data.get("code") != 1:
                msg = data.get("message", "充值失败，请稍后重试")
                _log_gpt_final("failed", msg)
                if card_key:
                    _release_gpt_key(card_key)
                _complete_async_task("gpt", gpt_vid)
                _broadcast_submit_failure(
                    "gpt",
                    msg,
                    email=email or "GPT充值",
                    user_id=user_id,
                    method=f"gpt_{channel}",
                    http_status=resp.status_code or 400,
                    upstream_status=resp.status_code,
                    refunded=False,
                    card_key=card_key,
                    channel=channel,
                )
                raise HTTPException(status_code=400, detail=msg)
    except HTTPException:
        # 充值失败，退还预扣积分
        auth.update_credits(user_id, GPT_RECHARGE_COST)
        raise
    except Exception as e:
        if card_key:
            _release_gpt_key(card_key)
        _complete_async_task("gpt", gpt_vid)
        failure_msg = f"{'充值超时' if _is_timeout_error(e) else f'充值请求失败: {str(e)}'}"
        # 退还预扣积分
        auth.update_credits(user_id, GPT_RECHARGE_COST)
        _log_gpt_final("failed", failure_msg)
        _broadcast_submit_failure(
            "gpt",
            failure_msg,
            email=email or "GPT充值",
            user_id=user_id,
            method=f"gpt_{channel}",
            http_status=502,
            refunded=False,
            card_key=card_key,
            channel=channel,
        )
        raise HTTPException(status_code=502, detail=failure_msg)

    # Success — credits already pre-deducted, no further deduction needed

    # Mark card key as used
    if card_key:
        conn = database.get_connection()
        now = datetime.now().isoformat()
        conn.execute(
            "UPDATE gpt_keys SET status='used', used_email=?, used_at=? WHERE card_key=?",
            (email, now, card_key)
        )
        conn.commit()
    _complete_async_task("gpt", gpt_vid)
    _log_gpt_final("pass", f"充值成功 ({channel.upper()})")

    # SSE: success
    broadcast_verify_event({
        "type": "progress",
        "vid": gpt_vid,
        "step": "result", "status": "approved", "success": True,
        "message": f"✅ 充值成功 ({channel.upper()})",
        **event_meta,
    })

    return {"success": True, "message": "充值成功", "channel": channel}


if __name__ == "__main__":
    import uvicorn
    
    print(f"🚀 OnePass Python Backend starting on port {PORT}")
    print(f"📋 Mode: curl_cffi TLS fingerprint spoofing")
    
    # Check dependencies
    try:
        from curl_cffi import requests
        print("✅ curl_cffi: Available")
    except ImportError:
        print("⚠️  curl_cffi: Not installed (pip install curl_cffi)")
    
    if PROXY_USER and PROXY_PASS:
        print(f"🔒 Proxy: {PROXY_HOST}:{PROXY_PORT}")
    else:
        print("⚠️  Proxy: Not configured")
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=False,
        log_level="info"
    )
