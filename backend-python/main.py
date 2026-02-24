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
from typing import List, Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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

# Load environment variables
load_dotenv()

# Initialize database
auth.init_database()

# Configuration
PORT = int(os.getenv("PORT", 3002))
PROXY_HOST = os.getenv("PROXY_HOST", "geo.iproyal.com")
PROXY_PORT = os.getenv("PROXY_PORT", "12321")
PROXY_USER = os.getenv("PROXY_USER", "")
PROXY_PASS = os.getenv("PROXY_PASS", "")

# Telegram Userbot instance
from telegram_userbot import SheerIDUserbot
telegram_bot: Optional[SheerIDUserbot] = None

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
        
        # Log verification result to history
        if result.get("success"):
            verification_history.log_verification("pass", vid)
        elif result.get("status") == "pending":
            verification_history.log_verification("processing", vid)
        elif result.get("status") == "rejected":
            reason = result.get("reason", "unknown")
            if reason in ("link_opened", "expired", "invalid", "rate_limited"):
                verification_history.log_verification("cancel", vid)
            else:
                verification_history.log_verification("failed", vid)
        elif result.get("status") == "error":
            verification_history.log_verification("failed", vid)
        else:
            verification_history.log_verification("cancel", vid)
    
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
        
        updated_config = config_manager.update_config(data)
        
        if updated_config:
            # Handle Telegram Bot restart if config changed
            new_telegram = updated_config.get("verification", {}).get("telegram", {})
            
            # If enabled changed, or apiId/Hash changed
            if (old_telegram.get("enabled") != new_telegram.get("enabled") or
                old_telegram.get("apiId") != new_telegram.get("apiId") or
                old_telegram.get("apiHash") != new_telegram.get("apiHash")):
                
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
                        bot_username = new_telegram.get("botUsername") or "@SheerID_Bot"
                        
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
    telegram_config = config.get("verification", {}).get("telegram", {})
    
    if telegram_config.get("enabled"):
        try:
            api_id = telegram_config.get("apiId")
            api_hash = telegram_config.get("apiHash")
            # Default to SheerID_Bot if not specified
            app_bot_username = telegram_config.get("botUsername") or "@SheerID_Bot"
            
            if api_id and api_hash:
                print(f"[Telegram] Starting Userbot (ID: {api_id})...")
                # Ensure api_id is int
                telegram_bot = SheerIDUserbot(int(api_id), api_hash, bot_username=app_bot_username)
                
                # Start in background task to not block server startup
                asyncio.create_task(telegram_bot.start())
            else:
                print("[Telegram] Missing API ID/Hash, skipping startup")
        except Exception as e:
            print(f"[Telegram] Startup failed: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    global telegram_bot
    if telegram_bot:
        await telegram_bot.stop()


@app.post("/api/telegram/daily")
async def telegram_daily():
    """Claim daily free credits from SheerID Bot"""
    if not telegram_bot or not telegram_bot.is_connected:
        raise HTTPException(status_code=503, detail="Telegram Userbot is not connected")
    
    result = await telegram_bot.claim_daily()
    return result


@app.get("/api/telegram/balance")
async def telegram_balance():
    """Check SheerID Bot credit balance"""
    if not telegram_bot or not telegram_bot.is_connected:
        raise HTTPException(status_code=503, detail="Telegram Userbot is not connected")
    
    result = await telegram_bot.check_balance()
    return result


@app.get("/api/telegram/status")
async def telegram_status():
    """Get Telegram Userbot connection status"""
    connected = telegram_bot is not None and telegram_bot.is_connected
    last_daily = telegram_bot._last_daily_claim.isoformat() if telegram_bot and telegram_bot._last_daily_claim else None
    
    return {
        "connected": connected,
        "bot_username": telegram_bot.bot_username if telegram_bot else None,
        "last_daily_claim": last_daily
    }


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
    if request.quota not in [1, 2, 5, 20, 100]:
        raise HTTPException(status_code=400, detail="Quota must be 1, 2, 5, 20, or 100")
    
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


@app.get("/api/cdk/stats")
async def cdk_stats_endpoint():
    """Get CDK statistics"""
    return cdk_manager.get_cdk_stats()


@app.get("/api/verify/history")
async def get_verification_history_endpoint():
    """Get recent verification history for the real-time status grid"""
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


@app.delete("/api/verify/history")
async def clear_verification_history():
    """Admin: Clear all verification history"""
    count = verification_history.clear_history()
    return {"cleared": True, "count": count}


# ========== Telegram Verification ==========

@app.post("/api/verify/telegram")
async def verify_via_telegram(request: TelegramVerifyRequest):
    """
    Verify by sending full verification links to Telegram SheerID Bot.
    Requires a valid CDK with sufficient quota.
    Links are processed concurrently — results are matched by verificationId.
    """
    if not telegram_bot or not telegram_bot.is_connected:
        raise HTTPException(
            status_code=503, 
            detail="Telegram Userbot is not connected. Please enable it in settings."
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
    
    # Check if CDK has enough quota
    if cdk_check["remaining"] < len(clean_links):
        raise HTTPException(
            status_code=403, 
            detail=f"CDK 额度不足，需要 {len(clean_links)} 次，剩余 {cdk_check['remaining']} 次"
        )
    
    # Send all links concurrently
    import re
    
    async def process_link(link):
        vid_match = re.search(r'verificationId=([a-zA-Z0-9]+)', link)
        display_id = vid_match.group(1) if vid_match else link[:30]
        
        result = await telegram_bot.verify(link)
        
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
    
    results = await asyncio.gather(*[process_link(link) for link in clean_links])
    results = list(results)
    
    # Log verification results to history
    for r in results:
        vid = r.get("verificationId", "")
        if r["status"] == "approved":
            verification_history.log_verification("pass", vid)
        elif r["status"] == "rejected":
            reason = r.get("reason", "unknown")
            if reason in ("link_opened", "expired", "invalid", "rate_limited"):
                verification_history.log_verification("cancel", vid)
            else:
                verification_history.log_verification("failed", vid)
        elif r["status"] in ("error",):
            verification_history.log_verification("failed", vid)
        elif r["status"] in ("timeout", "no_credits"):
            verification_history.log_verification("cancel", vid)
        else:
            verification_history.log_verification("processing", vid)
    
    # Deduct CDK quota for successful verifications
    successful = sum(1 for r in results if r["status"] == "approved")
    cdk_remaining = cdk_check["remaining"]
    if successful > 0:
        deduct = cdk_manager.use_cdk(request.cdk, successful)
        cdk_remaining = deduct.get("remaining", cdk_remaining)
    
    return {
        "results": results,
        "stats": {
            "total": len(results),
            "approved": successful,
            "rejected": sum(1 for r in results if r["status"] == "rejected")
        },
        "cdkRemaining": cdk_remaining
    }


# ========== GetGem.cc API Verification ==========

class GetGemVerifyRequest(BaseModel):
    verificationIds: List[str]
    cdk: Optional[str] = None  # User's local CDK (for quota tracking)


@app.post("/api/verify/getgem")
async def verify_via_getgem(request: GetGemVerifyRequest):
    """
    Verify by forwarding verification IDs to GetGem.cc API.
    Uses GetGem CDK from saved config for authentication.
    Local CDK is used for quota tracking only.
    """
    import config_manager
    import httpx

    config = config_manager.get_config()
    getgem_config = config.get("aiGenerator", {}).get("getgem", {})
    getgem_cdk = getgem_config.get("cdk", "")
    getgem_url = getgem_config.get("apiUrl", "https://getgem.cc")

    if not getgem_cdk:
        raise HTTPException(status_code=400, detail="GetGem CDK 未配置，请在管理面板中设置")

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

    async def process_single(vid: str):
        """Submit one verification to GetGem and poll until completion."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                # Step 1: Submit verification
                submit_resp = await client.post(
                    f"{getgem_url}/api/verify",
                    json={"verificationId": vid, "cdk": getgem_cdk}
                )
                
                if submit_resp.status_code != 200:
                    error_detail = ""
                    try:
                        err = submit_resp.json()
                        error_detail = err.get("detail") or err.get("message") or err.get("error") or str(err)
                    except:
                        error_detail = submit_resp.text[:200]
                    return {
                        "verificationId": vid,
                        "status": "error",
                        "success": False,
                        "message": f"提交失败 ({submit_resp.status_code}): {error_detail}"
                    }

                submit_data = submit_resp.json()
                task_id = submit_data.get("taskId")
                
                if not task_id:
                    return {
                        "verificationId": vid,
                        "status": "error",
                        "success": False,
                        "message": f"提交失败: 未返回 taskId — {submit_data}"
                    }

                # Step 2: Poll for result
                interval = 5
                max_attempts = 60  # 5 minutes max
                for attempt in range(max_attempts):
                    await asyncio.sleep(interval)
                    
                    status_resp = await client.get(f"{getgem_url}/api/status/{task_id}")
                    
                    if status_resp.status_code == 429:
                        # Rate limited — exponential backoff
                        interval = min(interval * 2, 30)
                        continue
                    
                    if status_resp.status_code != 200:
                        continue
                    
                    status_data = status_resp.json()
                    interval = 5  # Reset on success
                    
                    if status_data.get("completed"):
                        if status_data.get("success"):
                            return {
                                "verificationId": vid,
                                "status": "approved",
                                "success": True,
                                "message": f"✅ 验证成功",
                                "redirectUrl": status_data.get("redirectUrl"),
                                "taskId": task_id
                            }
                        else:
                            return {
                                "verificationId": vid,
                                "status": "rejected",
                                "success": False,
                                "message": f"❌ 验证失败: {status_data.get('error', 'Unknown error')}",
                                "taskId": task_id
                            }
                
                # Timeout
                return {
                    "verificationId": vid,
                    "status": "timeout",
                    "success": False,
                    "message": "⏰ 轮询超时（5分钟）",
                    "taskId": task_id
                }
        
        except Exception as e:
            return {
                "verificationId": vid,
                "status": "error",
                "success": False,
                "message": f"❌ 错误: {str(e)}"
            }

    # Process all IDs concurrently
    results = await asyncio.gather(*[process_single(vid) for vid in request.verificationIds])
    results = list(results)

    # Log verification results to history
    for r in results:
        vid = r.get("verificationId", "")
        if r["status"] == "approved":
            verification_history.log_verification("pass", vid)
        elif r["status"] == "rejected":
            reason = r.get("reason", "unknown")
            if reason in ("link_opened", "expired", "invalid", "rate_limited"):
                verification_history.log_verification("cancel", vid)
            else:
                verification_history.log_verification("failed", vid)
        elif r["status"] in ("error",):
            verification_history.log_verification("failed", vid)
        elif r["status"] in ("timeout",):
            verification_history.log_verification("cancel", vid)
        else:
            verification_history.log_verification("processing", vid)

    # Deduct local CDK quota for successful verifications
    successful = sum(1 for r in results if r["status"] == "approved")
    if request.cdk and successful > 0:
        deduct = cdk_manager.use_cdk(request.cdk, successful)
        cdk_remaining = deduct.get("remaining", cdk_remaining)

    return {
        "results": results,
        "stats": {
            "total": len(results),
            "approved": successful,
            "rejected": sum(1 for r in results if r["status"] == "rejected")
        },
        "cdkRemaining": cdk_remaining
    }


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
            # Check health
            health_resp = await client.get(f"{getgem_url}/api/health")
            if health_resp.status_code == 200:
                result["connected"] = True
                result["health"] = health_resp.json()

            # Check CDK balance if configured
            if getgem_cdk:
                cdk_resp = await client.get(f"{getgem_url}/api/cdk/status/{getgem_cdk}")
                if cdk_resp.status_code == 200:
                    result["cdkBalance"] = cdk_resp.json()
    except Exception as e:
        result["error"] = str(e)

    return result


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
            return {"status": "error", "success": False, "message": "GetGem CDK not configured on server"}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                resp = await client.post(f"{getgem_url}/api/verify", json={"verificationId": vid, "cdk": getgem_cdk})
                if resp.status_code != 200:
                    return {"status": "error", "success": False, "message": f"GetGem submit failed ({resp.status_code})"}
                data = resp.json()
                task_id = data.get("taskId")
                if not task_id:
                    return {"status": "error", "success": False, "message": "GetGem returned no taskId"}
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
                            return {"status": "rejected", "success": False, "message": sd.get("error", "Verification rejected")}
                return {"status": "timeout", "success": False, "message": "Polling timeout (5min)"}
        except Exception as e:
            return {"status": "error", "success": False, "message": str(e)}

    # Telegram provider
    elif provider == "telegram":
        if not telegram_bot or not telegram_bot.is_connected:
            return {"status": "error", "success": False, "message": "Telegram Userbot not connected"}
        try:
            # Build verification link
            link = f"https://services.sheerid.com/verify/{vid}/"
            result = await telegram_bot.verify(link)
            return {
                "status": result.get("status", "unknown"),
                "success": result.get("success", False),
                "message": result.get("message", ""),
                "redirectUrl": result.get("claimLink")
            }
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

        # Log to history
        vid = request.verificationId
        if result["status"] == "approved":
            verification_history.log_verification("pass", vid)
            cdk_manager.use_cdk(request.cdk, 1)
        elif result["status"] == "rejected":
            reason = result.get("reason", "unknown")
            if reason in ("link_opened", "expired", "invalid", "rate_limited"):
                verification_history.log_verification("cancel", vid)
            else:
                verification_history.log_verification("failed", vid)
        elif result["status"] == "error":
            verification_history.log_verification("failed", vid)
        else:
            verification_history.log_verification("cancel", vid)

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
                verification_history.log_verification("pass", v)
                cdk_manager.use_cdk(request.cdk, 1)
            elif result["status"] == "rejected":
                reason = result.get("reason", "unknown")
                if reason in ("link_opened", "expired", "invalid", "rate_limited"):
                    verification_history.log_verification("cancel", v)
                else:
                    verification_history.log_verification("failed", v)
            elif result["status"] == "error":
                verification_history.log_verification("failed", v)
            else:
                verification_history.log_verification("cancel", v)

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
