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
import auth

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
    """Build proxy URL from environment variables - IP2UP format"""
    if not PROXY_USER or not PROXY_PASS:
        return None
    
    # IP2UP username format: [account]_[country]_[province]_[city]_[session]_[sessionTime]_[flag]
    # country: 200 = US
    # session: random string for sticky IP
    # sessionTime: 0 = no time limit
    # flag: 1 = auto replenish, 0 = no replenish
    import uuid
    session_id = uuid.uuid4().hex[:16]
    
    # Format: account_country_province_city_session_sessionTime_flag
    # Using US (200), no province (0), no city (0), random session, no time limit, auto replenish
    username = f"{PROXY_USER}_200_0_0_{session_id}_0_1"
    
    proxy_url = f"http://{username}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}"
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
        from verifier import select_university, generate_name, generate_email, generate_birth_date
        from verifier import select_university, generate_name, generate_email, generate_birth_date
        
        # Select university (Force US for now to avoid invalidOrganization errors with international IDs)
        org = select_university(country="US") 
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
        
        doc_data = None
        filename = None
        form_data = None
        
        # Use Puppeteer if configured
        if provider == "puppeteer":
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
                birth_date=dob,
                gender="any",
                template=template,
                use_gemini_photo=use_gemini_photo
            )
        
        # Fallback to Gemini/SVG generator if Puppeteer not selected or failed
        if not doc_data:
            if provider == "puppeteer":
                print(f"[Verify] Puppeteer failed, using fallback generator...")
            else:
                print(f"[Verify] Generating document with {provider}...")
            doc_data, filename = generate_document(
                "auto",
                first,
                last,
                org["name"]
            )
            form_data = None
        
        if form_data:
            print(f"[Verify] Form data synced: {first} {last}, ID: {form_data.get('studentId')}")
        
        # Run verification with pre-generated info
        result = verifier.verify(doc_data)
        
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
        print(f"[Verify] Using proxy: {PROXY_HOST}:{PROXY_PORT}")
    else:
        print("[Verify] No proxy configured")
    
    results = []
    success_count = 0
    
    for vid in request.verificationIds:
        result = verify_single(vid, proxy)
        
        # If pending, poll for final result (wait up to 3 minutes)
        if result.get("status") == "pending":
            print(f"[Verify] Initial status pending for {vid}, polling for result...")
            # Poll with shorter interval for faster feedback
            # 36 attempts * 5 seconds = 180 seconds (3 minutes) timeout
            poll_result = poll_verification_status(vid, max_attempts=36, interval=5, proxy=proxy)
            
            # Merge poll result fields into original result
            result.update(poll_result)
            
            # Update status and success based on poll result
            if poll_result.get("status") == "success":
                result["success"] = True
                result["status"] = "success"
                result["message"] = "Verification approved!"
            elif poll_result.get("status") == "rejected":
                result["success"] = False
                result["status"] = "rejected"
                result["message"] = poll_result.get("message", "Verification rejected")
            elif poll_result.get("status") == "timeout":
                result["message"] = "Verification is still pending review (timeout)"
        
        results.append(result)
        
        if result.get("success"):
            success_count += 1
    
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
    return config_manager.get_config()


@app.get("/api/templates")
async def get_templates_endpoint():
    """Get available HTML templates for Puppeteer generator"""
    import config_manager
    return {
        "templates": config_manager.get_available_templates(),
        "puppeteerSettings": config_manager.get_puppeteer_settings()
    }


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
        
        # Select university if not provided (use fast local lookup for test)
        if not university:
            uni_data = select_university()
            university = uni_data["name"]
            country = uni_data.get("country", "US")
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
        # Use the SAVED server config (same as actual verification)
        config = config_manager.get_config()
        provider = config.get("aiGenerator", {}).get("provider", "gemini")
        
        print(f"[TestDoc] Using saved config provider: {provider}")
        
        doc_data = None
        filename = None
        form_data = None
        
        if provider == "puppeteer":
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
            print(f"[TestDoc] Using Gemini/SVG generator...")
            doc_data, filename = generate_document("auto", first, last, university)
            
            if doc_data:
                image_base64 = base64.b64encode(doc_data).decode('utf-8')
                mime_type = "image/jpeg" if filename.endswith(".jpg") else "image/png"
                
                return {
                    "success": True,
                    "provider": provider,
                    "providerNote": f"使用保存的配置: {provider.upper()} 文档生成",
                    "image": f"data:{mime_type};base64,{image_base64}",
                    "formData": {
                        "firstName": first,
                        "lastName": last,
                        "fullName": f"{first} {last}".upper(),
                        "university": university
                    },
                    "filename": filename
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
    
    import config_manager
    body = await request.json()
    updated = config_manager.update_config(body)
    
    if updated:
        return {"success": True, "config": updated}
    else:
        raise HTTPException(status_code=500, detail="Failed to update config")


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
