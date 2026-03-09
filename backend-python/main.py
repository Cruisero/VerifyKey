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
from typing import Dict, List, Optional
from datetime import datetime

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
import database

# Load environment variables
load_dotenv()

# Initialize database
auth.init_database()
database.init_db()
cdk_manager.normalize_existing_cdks()
database.start_auto_backup()

# Configuration
PORT = int(os.getenv("PORT", 3002))
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

def broadcast_verify_event(event: dict):
    """Broadcast a verification event to all connected admin SSE subscribers."""
    import json as _json_bc
    for q in _admin_sse_subscribers:
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
    quota: int = 5
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


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
async def register_user(request: RegisterRequest):
    """Register a new user"""
    try:
        username = request.username or request.email.split("@")[0]
        result = auth.register(request.email, request.password, username)
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
    result = tg_manager.add_account(request.apiId, request.apiHash, request.label)
    return result


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
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "failed", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "success":
                            _msg = "该链接已验证成功，无需重复提交"
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": True, "status": "approved", "message": _msg, "alreadyVerified": True}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "docUpload" and _prj:
                            _msg = f"该链接已被拒绝 ({', '.join(_prj)})，请刷新页面获取新链接"
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
        
        # Start all verifications in parallel
        tasks = [asyncio.create_task(process_single_link(link)) for link in clean_links]
        
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
        for r in results:
            vid = r.get("verificationId", "")
            msg = r.get("message", r.get("reason", ""))
            # Record stats for DualBot
            bot_stats_tracker.record("dualbot", r.get("success", False))
            if r.get("status") == "approved":
                verification_history.log_verification("pass", vid, msg, cdk=cdk_label)
            elif r.get("status") in ("failed", "rejected", "error", "cooldown"):
                verification_history.log_verification("failed", vid, msg or f"Rejected: {r.get('status', '')}", cdk=cdk_label)

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
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "failed", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "success":
                            _msg = "该链接已验证成功，无需重复提交"
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": True, "status": "approved", "message": _msg, "alreadyVerified": True}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "docUpload" and _prj:
                            _msg = f"该链接已被拒绝 ({', '.join(_prj)})，请刷新页面获取新链接"
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

    # ---- Sort bots by expected cost (waterfall priority) ----
    def _sort_bots_by_cost_efficiency(bots):
        def _expected_cost(bot):
            bot_id = bot["type"]
            rate = bot_stats_tracker.get_success_rate(bot_id)
            cost = bot["config"].get("costPerVerify", 1.0)
            return cost / max(rate, 0.01)
        return sorted(bots, key=_expected_cost)

    sorted_bots = _sort_bots_by_cost_efficiency(enabled_bots)
    logger.info(f"[Waterfall] Bot priority: {[b['type'] for b in sorted_bots]}")

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
            """Waterfall: try each bot in priority order. If one fails, try the next."""
            vid = link_vid_map.get(link_to_verify, "")

            # VID deduplication
            if vid:
                if vid not in _vid_locks:
                    _vid_locks[vid] = asyncio.Lock()
                vid_lock = _vid_locks[vid]

                if vid_lock.locked():
                    logger.info(f"[Waterfall] VID {vid[:8]}... already being processed, waiting...")
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
              # ---- Waterfall: try bots in priority order ----
              for bot_idx, bot_entry in enumerate(sorted_bots):
                bot_type = bot_entry["type"]
                bot_config = bot_entry["config"]
                max_retries = bot_config.get("maxRetries", 5)
                bot_timeout = bot_config.get("verifyTimeout", bot_config.get("timeout", 180))

                # ---- Check if this bot is suspended ----
                suspension_expiry = _bot_suspensions.get(bot_type, 0)
                if suspension_expiry > _time.time():
                    remaining = int(suspension_expiry - _time.time())
                    logger.info(f"[Waterfall:{bot_type}] Bot is SUSPENDED for {remaining}s more, skipping...")
                    on_prog_event = {"type": "progress", "link": link_to_verify, "vid": vid, "botType": bot_type,
                                     "step": "suspended", "message": f"Bot {bot_type} 已暂停 ({remaining}s)，切换下一个..."}
                    progress_events.append(f"data: {json.dumps(on_prog_event, ensure_ascii=False)}\n\n")
                    broadcast_verify_event(on_prog_event)
                    continue  # Skip to next bot in waterfall

                async def on_progress(progress, _bt=bot_type):
                    event = {"type": "progress", "link": link_to_verify, "vid": vid, "botType": _bt, **progress}
                    progress_events.append(f"data: {json.dumps(event, ensure_ascii=False)}\n\n")
                    broadcast_verify_event(event)

                # Create verifier for singlebots
                single_verifier = None
                if bot_type != "dualbot":
                    single_verifier = GenericSingleBotVerifier(bot_config)

                bot_succeeded = False
                for attempt in range(max_retries):
                    pool_item = _get_next_client_for_bot(bot_type)

                    if not pool_item:
                        # If there are more bots in the waterfall, skip immediately
                        # Only wait for cooldown on the LAST bot
                        is_last_bot = (bot_idx >= len(sorted_bots) - 1)
                        
                        if not is_last_bot:
                            logger.info(f"[Waterfall:{bot_type}] No accounts available, skipping to next bot...")
                            break  # break inner retry loop → continue to next bot
                        
                        # Last bot: wait for cooldown
                        wait_time = _get_shortest_cooldown_for_bot(bot_type)
                        if wait_time > 0:
                            logger.info(f"[Waterfall:{bot_type}] Last bot, waiting {wait_time:.0f}s for cooldown...")
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
                            logger.info(f"[Waterfall:{bot_type}] No accounts available, trying next bot...")
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

                        # If cooldown came from verify stage, the link was already consumed
                        # Do NOT retry — treat as terminal failure
                        if result.get("cooldown_stage") == "verify":
                            logger.warning(f"[Waterfall:{bot_type}] Account {acc_id} cooldown at VERIFY stage — link consumed, stopping retry")
                            last_result = (acc_id, result)
                            bot_succeeded = True
                            break

                        logger.info(f"[Waterfall:{bot_type}] Account {acc_id} cooldown at warmup stage, retrying with another account...")
                        continue

                    # Record stats for this bot
                    bot_stats_tracker.record(bot_type, result.get("success", False))
                    last_result = (acc_id, result)

                    # ---- Check suspension rules BEFORE returning result ----
                    suspension_rules = bot_config.get("suspensionRules", [])
                    result_raw = result.get("raw_response", result.get("message", ""))
                    for srule in suspension_rules:
                        suspend_seconds = srule.get("duration", 300)
                        # Match against message or raw_response
                        should_suspend = False
                        if result_raw and any(k.lower() in result_raw.lower() for k in srule.get("keywords", [])):
                            should_suspend = True
                        
                        if should_suspend:
                            _bot_suspensions[bot_type] = _time.time() + suspend_seconds
                            logger.warning(f"[Waterfall:{bot_type}] SUSPENDED for {suspend_seconds}s! Rule matched: {srule.get('keywords')}")
                            broadcast_verify_event({
                                "type": "bot_suspended",
                                "botType": bot_type,
                                "duration": suspend_seconds,
                                "reason": f"Rule matched: {srule.get('keywords')}",
                                "message": result_raw[:100] if result_raw else ""
                            })
                            # Treat as non-final: fallback to next bot
                            bot_succeeded = False
                            break
                    
                    # If suspension triggered, skip to next bot
                    if _bot_suspensions.get(bot_type, 0) > _time.time():
                        break  # break inner retry → continue to next bot in waterfall

                    if result.get("success"):
                        # Success! Cache and return
                        bot_succeeded = True
                        break

                    if result.get("status") == "no_credits":
                        # Bot has no credits/quota — try next bot in waterfall
                        logger.info(f"[Waterfall] {bot_type} has no credits, trying next bot...")
                        break  # break inner retry loop, continue to next bot

                    if result.get("status") in ("failed", "rejected", "error"):
                        # Verification-level failure — this is a FINAL result, do NOT switch bots
                        # Same link should NOT be sent to a different bot
                        logger.info(f"[Waterfall] {bot_type} returned final result: {result.get('status')}")
                        bot_succeeded = True  # mark as "done" so we don't try next bot
                        break

                    # Other statuses (e.g. approved) — return as-is
                    bot_succeeded = True
                    break

                if bot_succeeded:
                    break  # break outer waterfall loop

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
            """Wrapper: run process_single_link and emit per-link result immediately."""
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
            for r in results:
                vid = r.get("verificationId", "")
                msg = r.get("message", r.get("reason", ""))
                via_label = r.get("botType", "bot")
                if r.get("status") == "approved":
                    verification_history.log_verification("pass", vid, msg, cdk=cdk_label, via=f"bot:{via_label}")
                elif r.get("status") in ("failed", "rejected", "error", "cooldown"):
                    verification_history.log_verification("failed", vid, msg or f"Rejected: {r.get('status', '')}", cdk=cdk_label, via=f"bot:{via_label}")

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
            yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

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
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": False, "status": "failed", "message": _msg}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "success":
                            _msg = "该链接已验证成功，无需重复提交"
                            broadcast_verify_event({"type": "done", "results": [{"verificationId": _pre_vid, "success": True, "status": "approved", "message": _msg, "alreadyVerified": True}]})
                            raise HTTPException(status_code=400, detail=_msg)
                        if _ps == "docUpload" and _prj:
                            _msg = f"该链接已被拒绝 ({', '.join(_prj)})，请刷新页面获取新链接"
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
            elif r.get("status") in ("failed", "rejected", "error", "cooldown"):
                verification_history.log_verification("failed", vid, msg or f"Rejected: {r.get('status', '')}", cdk=cdk_label)

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

@app.get("/api/admin/bot-orders")
async def get_bot_orders(authorization: Optional[str] = Header(None)):
    """Get all bot crypto payment orders."""
    _verify_admin_token(authorization)
    import bot_data
    orders = bot_data.get_all_orders()
    orders.sort(key=lambda o: o.get("created_at", ""), reverse=True)
    return {"orders": orders}

@app.get("/api/admin/bot-verify-log")
async def get_bot_verify_log(authorization: Optional[str] = Header(None)):
    """Get recent bot verification log entries."""
    _verify_admin_token(authorization)
    import bot_verify_log
    return {"log": bot_verify_log.get_recent(50)}


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
    if request.quota not in [1, 5, 20, 50, 100]:
        raise HTTPException(status_code=400, detail="Quota must be 1, 5, 20, 50, or 100")
    
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
    """Get recent verification history for the real-time status grid (public, sanitized)"""
    history = verification_history.get_recent_history(200)
    stats = verification_history.get_history_stats()
    # Strip sensitive fields for public endpoint — only expose what the status grid needs
    sanitized = [
        {"id": h["id"], "status": h["status"], "timestamp": h["timestamp"]}
        for h in history
    ]
    return {
        "history": sanitized,
        "stats": stats
    }


@app.get("/api/admin/verify-history")
async def get_admin_verification_history(authorization: Optional[str] = Header(None)):
    """Get full verification history with all fields (admin only)"""
    _verify_admin_token(authorization)
    history = verification_history.get_recent_history(200)
    stats = verification_history.get_history_stats()
    return {
        "history": history,
        "stats": stats
    }


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

@app.patch("/api/verify/history/{record_id}")
async def override_verification_status(record_id: str, request: ManualOverrideRequest):
    """Admin: Manually override a verification record's status (pass/failed) with CDK quota adjustment"""
    if request.status not in ("pass", "failed"):
        raise HTTPException(status_code=400, detail="Status must be 'pass' or 'failed'")
    
    # Get current record to check old status and CDK
    conn = database.get_connection()
    cursor = conn.execute(
        "SELECT status, cdk FROM verification_history WHERE id = ?", (record_id,)
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    
    old_status = row["status"]
    cdk_code = row["cdk"]
    
    # CDK quota adjustment
    cdk_message = ""
    if cdk_code and cdk_code != "__BOT_INTERNAL__":
        if request.status == "pass" and old_status != "pass":
            # Marking as Pass → deduct 1 CDK quota
            result = cdk_manager.use_cdk(cdk_code, 1)
            cdk_message = f" | CDK {cdk_code}: {result['message']}"
        elif request.status == "failed" and old_status == "pass":
            # Marking Pass→Failed → refund 1 CDK quota
            result = cdk_manager.refund_cdk(cdk_code, 1)
            cdk_message = f" | CDK {cdk_code}: {result['message']}"
    
    success = verification_history.update_verification(record_id, request.status)
    if not success:
        raise HTTPException(status_code=404, detail="Record not found")
    # Broadcast the update via SSE so admin page refreshes
    broadcast_verify_event({"type": "history_updated", "id": record_id, "status": request.status})
    return {"updated": True, "id": record_id, "status": request.status, "cdkMessage": cdk_message}


@app.delete("/api/verify/history")
async def clear_verification_history():
    """Admin: Clear all verification history"""
    count = verification_history.clear_history()
    return {"cleared": True, "count": count}


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
            
            status = rule.get("status", "pass")
            unique_vid = f"auto-{rule_id[:6]}-{int(datetime.now(timezone.utc).timestamp())}"
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
            elif r["status"] in ("rejected", "error", "timeout"):
                bot_stats_tracker.record("getgem", False)
                verification_history.log_verification("failed", vid_log, message=msg, cdk=request.cdk or "", via="getgem")

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
    fallback_enabled = routing.get("fallbackEnabled", True)
    fallback_errors = routing.get("fallbackErrors", ["timeout", "internalError", "rateLimited", "cooldown", "error"])
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

    # ---- Determine actual allocation ----
    getgem_rate = bot_stats_tracker.get_success_rate("getgem")
    bot_rate = bot_stats_tracker.get_success_rate("dualbot")  # Use dualbot as representative

    # Auto-degrade: if success rate below threshold, route everything to the other node
    effective_getgem_pct = allocation.get("getgem", 50)
    effective_bot_pct = allocation.get("bot", 50)

    if mode == "api_only" or not bot_available:
        effective_getgem_pct, effective_bot_pct = 100, 0
    elif mode == "bot_only" or not getgem_available:
        effective_getgem_pct, effective_bot_pct = 0, 100
    else:
        # Auto-degrade based on success rate
        if getgem_rate * 100 < auto_degrade_threshold and bot_rate * 100 >= auto_degrade_threshold:
            effective_getgem_pct, effective_bot_pct = 0, 100
            print(f"[MixedMode] GetGem auto-degraded (rate={getgem_rate:.0%} < {auto_degrade_threshold}%)")
        elif bot_rate * 100 < auto_degrade_threshold and getgem_rate * 100 >= auto_degrade_threshold:
            effective_getgem_pct, effective_bot_pct = 100, 0
            print(f"[MixedMode] Bot auto-degraded (rate={bot_rate:.0%} < {auto_degrade_threshold}%)")

    # Split VIDs by allocation
    total = len(request.verificationIds)
    getgem_count = round(total * effective_getgem_pct / 100) if effective_getgem_pct > 0 else 0
    getgem_count = min(getgem_count, total)
    bot_count = total - getgem_count

    getgem_vids = request.verificationIds[:getgem_count]
    bot_vids = request.verificationIds[getgem_count:]

    print(f"[MixedMode] Routing {len(getgem_vids)} to GetGem, {len(bot_vids)} to Bot (allocation: {effective_getgem_pct}/{effective_bot_pct})")

    async def event_stream():
        import json as _json

        progress_events = []

        def fmt(data):
            broadcast_verify_event(data)
            progress_events.append(f"data: {_json.dumps(data, ensure_ascii=False)}\n\n")

        # Broadcast initial events
        for vid in request.verificationIds:
            via_label = "getgem" if vid in getgem_vids else "bot"
            fmt({"type": "progress", "vid": vid, "step": "submitted", "via": via_label, "message": f"等待验证 ({via_label})..."})

        all_results = []

        # ---- GetGem group (async) ----
        async def process_getgem_batch(vids):
            results = []
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                cdk_list = [c.strip() for c in getgem_cdk.replace(',', '\n').split('\n') if c.strip()]
                if not cdk_list:
                    for vid in vids:
                        results.append({"verificationId": vid, "status": "error", "success": False,
                                        "message": "GetGem API CDK 未配置", "via": "getgem"})
                    return results

                for vid in vids:
                    try:
                        fmt({"type": "progress", "vid": vid, "step": "warmup", "via": "getgem", "message": "GetGem: 文档生成中..."})

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
                            results.append({"verificationId": vid, "status": "error", "success": False,
                                            "message": _translate_getgem_error(error_detail), "via": "getgem"})
                            continue

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
                            results.append({"verificationId": vid, "status": "rejected", "success": False,
                                            "message": msg, "via": "getgem"})
                            continue

                        task_id = submit_data.get("taskId")
                        if not task_id:
                            results.append({"verificationId": vid, "status": "error", "success": False,
                                            "message": "未获取到 taskId", "via": "getgem"})
                            continue

                        # Poll for result
                        fmt({"type": "progress", "vid": vid, "step": "waiting", "via": "getgem", "message": "GetGem: 等待验证结果..."})
                        result_found = False
                        for _ in range(60):
                            await asyncio.sleep(5)
                            status_resp = await client.get(f"{getgem_url}/api/status/{task_id}")
                            if status_resp.status_code != 200:
                                continue
                            status_data = status_resp.json()
                            if not status_data.get("completed"):
                                continue
                            if status_data.get("success"):
                                results.append({"verificationId": vid, "status": "approved", "success": True,
                                                "message": "验证成功", "via": "getgem", "taskId": task_id})
                            else:
                                last_error = status_data.get("error", "Unknown error")
                                results.append({"verificationId": vid, "status": "rejected", "success": False,
                                                "message": f"验证失败: {_translate_getgem_error(last_error)}",
                                                "via": "getgem", "taskId": task_id})
                            result_found = True
                            break

                        if not result_found:
                            results.append({"verificationId": vid, "status": "timeout", "success": False,
                                            "message": "轮询超时（5分钟）", "via": "getgem", "taskId": task_id})

                    except Exception as e:
                        results.append({"verificationId": vid, "status": "error", "success": False,
                                        "message": f"错误: {str(e)}", "via": "getgem"})
            return results

        # ---- Bot group (reuse unified bot pool logic) ----
        async def process_bot_batch(vids):
            results = []
            if not vids:
                return results

            # Build links from VIDs for bot verification
            links = [f"https://services.sheerid.com/verify/{vid}/?verificationId={vid}" for vid in vids]

            import config_manager as _cm
            _cfg = _cm.get_config()
            enabled_bots = []
            d_cfg = _cfg.get("verification", {}).get("dualBot", {})
            if d_cfg.get("enabled"):
                enabled_bots.append({"type": "dualbot", "config": d_cfg})
            for sb in _cfg.get("verification", {}).get("singleBots", []):
                if sb.get("enabled"):
                    enabled_bots.append({"type": sb["id"], "config": sb})

            if not enabled_bots:
                for vid in vids:
                    results.append({"verificationId": vid, "status": "error", "success": False,
                                    "message": "没有可用的 Telegram Bot", "via": "bot"})
                return results

            # Sort bots by expected cost
            def _sort(bots):
                def _ec(bot):
                    rate = bot_stats_tracker.get_success_rate(bot["type"])
                    cost = bot["config"].get("costPerVerify", 1.0)
                    return cost / max(rate, 0.01)
                return sorted(bots, key=_ec)
            sorted_bots = _sort(enabled_bots)

            for i, vid in enumerate(vids):
                link = links[i]
                fmt({"type": "progress", "vid": vid, "step": "warmup", "via": "bot", "message": "Bot: 提交验证中..."})

                last_result = None
                for bot_entry in sorted_bots:
                    bot_type = bot_entry["type"]
                    bot_config = bot_entry["config"]
                    bot_timeout = bot_config.get("timeout", 120)

                    pool_item = None
                    if bot_type == "dualbot":
                        pool_item = tg_manager.get_next_client(bot_type="dualbot")
                    else:
                        # SingleBot client retrieval
                        accounts = _cfg.get("telegramAccounts", [])
                        all_clients = tg_manager.get_all_clients()
                        for acc in accounts:
                            if bot_type in acc.get("assignedBots", []) and acc.get("enabled"):
                                ci = all_clients.get(acc["id"])
                                if ci and ci.is_connected():
                                    pool_item = (acc["id"], ci)
                                    break

                    if not pool_item:
                        continue

                    acc_id, client = pool_item
                    try:
                        async def on_progress(progress, _bt=bot_type):
                            fmt({"type": "progress", "vid": vid, "via": f"bot:{_bt}", **progress})

                        if bot_type == "dualbot":
                            result = await dual_bot.verify(
                                client=client, link=link, account_id=acc_id,
                                warmup_bot=bot_config.get("warmupBot"),
                                verify_bot=bot_config.get("verifyBot"),
                                auto_bypass=bot_config.get("autoBypass", True),
                                timeout=bot_timeout, on_progress=on_progress
                            )
                        else:
                            single_verifier = GenericSingleBotVerifier(bot_config)
                            result = await single_verifier.verify(
                                client=client, link=link, account_id=acc_id,
                                timeout=bot_timeout, on_progress=on_progress
                            )

                        bot_stats_tracker.record(bot_type, result.get("success", False))

                        via_label = f"bot:{bot_type}"
                        if result.get("success"):
                            results.append({"verificationId": vid, "status": "approved", "success": True,
                                            "message": result.get("message", "验证成功"), "via": via_label,
                                            "claimLink": result.get("claimLink")})
                            last_result = None
                            break
                        else:
                            last_result = {"verificationId": vid, "status": result.get("status", "failed"),
                                           "success": False, "message": result.get("message", "验证失败"),
                                           "via": via_label}
                            # If verified-stage failure, don't try next bot
                            if result.get("status") in ("failed", "rejected"):
                                break
                            # Cooldown at warmup → try next bot
                            if result.get("status") == "cooldown" and result.get("cooldown_stage") != "verify":
                                continue
                            break

                    except Exception as e:
                        last_result = {"verificationId": vid, "status": "error", "success": False,
                                       "message": f"Bot 错误: {str(e)}", "via": f"bot:{bot_type}"}
                        break

                if last_result:
                    results.append(last_result)

            return results

        # ---- Run both groups in parallel ----
        getgem_task = asyncio.create_task(process_getgem_batch(getgem_vids)) if getgem_vids else None
        bot_task = asyncio.create_task(process_bot_batch(bot_vids)) if bot_vids else None

        # Stream progress while waiting
        pending = [t for t in [getgem_task, bot_task] if t]
        while pending and not all(t.done() for t in pending):
            while progress_events:
                yield progress_events.pop(0)
            await asyncio.sleep(0.3)
        while progress_events:
            yield progress_events.pop(0)

        if getgem_task:
            try:
                all_results.extend(await getgem_task)
            except Exception as e:
                logging.error(f"[MixedMode] GetGem task crashed: {e}")
                for vid in getgem_vids:
                    all_results.append({"verificationId": vid, "status": "error", "success": False, "message": f"GetGem 错误: {str(e)}", "via": "getgem"})
                    broadcast_verify_event({"type": "progress", "vid": vid, "step": "result", "success": False, "status": "error", "message": f"GetGem 错误: {str(e)}"})
        if bot_task:
            try:
                all_results.extend(await bot_task)
            except Exception as e:
                logging.error(f"[MixedMode] Bot task crashed: {e}")
                for vid in bot_vids:
                    all_results.append({"verificationId": vid, "status": "error", "success": False, "message": f"Bot 错误: {str(e)}", "via": "bot"})
                    broadcast_verify_event({"type": "progress", "vid": vid, "step": "result", "success": False, "status": "error", "message": f"Bot 错误: {str(e)}"})

        # ---- Fallback: retry failed items with the other node ----
        if fallback_enabled:
            fallback_items = []
            for r in all_results:
                if r.get("success"):
                    continue
                # Check if error type is in the fallback whitelist
                error_msg = r.get("message", "")
                status = r.get("status", "")
                should_fallback = status in fallback_errors
                if not should_fallback:
                    for err_key in fallback_errors:
                        if err_key.lower() in error_msg.lower():
                            should_fallback = True
                            break
                if should_fallback:
                    fallback_items.append(r)

            if fallback_items:
                print(f"[MixedMode] Fallback: {len(fallback_items)} items to retry")
                for fb in fallback_items:
                    vid = fb["verificationId"]
                    original_via = fb.get("via", "")
                    fmt({"type": "progress", "vid": vid, "step": "fallback",
                         "message": f"正在切换备用节点重试...", "via": "fallback"})

                # Determine fallback target
                fallback_getgem_vids = []
                fallback_bot_vids = []
                for fb in fallback_items:
                    if fb.get("via", "").startswith("bot") and getgem_available:
                        fallback_getgem_vids.append(fb["verificationId"])
                    elif fb.get("via") == "getgem" and bot_available:
                        fallback_bot_vids.append(fb["verificationId"])

                fb_getgem_task = asyncio.create_task(process_getgem_batch(fallback_getgem_vids)) if fallback_getgem_vids else None
                fb_bot_task = asyncio.create_task(process_bot_batch(fallback_bot_vids)) if fallback_bot_vids else None

                fb_pending = [t for t in [fb_getgem_task, fb_bot_task] if t]
                while fb_pending and not all(t.done() for t in fb_pending):
                    while progress_events:
                        yield progress_events.pop(0)
                    await asyncio.sleep(0.3)
                while progress_events:
                    yield progress_events.pop(0)

                fb_results = []
                if fb_getgem_task:
                    fb_results.extend(await fb_getgem_task)
                if fb_bot_task:
                    fb_results.extend(await fb_bot_task)

                # Replace original failed results with fallback results
                fb_map = {r["verificationId"]: r for r in fb_results}
                for i, r in enumerate(all_results):
                    vid = r["verificationId"]
                    if vid in fb_map:
                        fb_r = fb_map[vid]
                        fb_r["via"] = f"fallback:{fb_r.get('via', '')}"
                        all_results[i] = fb_r

        # ---- Log results and deduct CDK ----
        for r in all_results:
            vid_log = r.get("verificationId", "")
            msg = r.get("message", "")
            via = r.get("via", "")
            if r.get("status") == "approved":
                bot_stats_tracker.record("getgem" if "getgem" in via else "bot", True)
                verification_history.log_verification("pass", vid_log, message=msg, cdk=request.cdk or "", via=via)
            elif r.get("status") in ("rejected", "error", "timeout"):
                bot_stats_tracker.record("getgem" if "getgem" in via else "bot", False)
                verification_history.log_verification("failed", vid_log, message=msg, cdk=request.cdk or "", via=via)

        nonlocal cdk_remaining
        successful = sum(1 for r in all_results if r.get("status") == "approved")
        if request.cdk and successful > 0:
            deduct = cdk_manager.use_cdk(request.cdk, successful)
            cdk_remaining = deduct.get("remaining", cdk_remaining)

        yield f"data: {_json.dumps({'type': 'done', 'results': all_results, 'stats': {'total': len(all_results), 'approved': successful, 'rejected': sum(1 for r in all_results if not r.get('success'))}, 'cdkRemaining': cdk_remaining}, ensure_ascii=False)}\n\n"

    from starlette.responses import StreamingResponse
    return StreamingResponse(event_stream(), media_type="text/event-stream")


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

            # Sort bots by cost efficiency (same as unified endpoint)
            def _expected_cost_dp(bot):
                rate = bot_stats_tracker.get_success_rate(bot["type"])
                cost = bot["config"].get("costPerVerify", 1.0)
                return cost / max(rate, 0.01)
            sorted_bots = sorted(enabled_bots, key=_expected_cost_dp)

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
