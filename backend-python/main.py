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

from verifier import SheerIDVerifier, parse_verification_id
from doc_generator import generate_document
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
    """Build proxy URL from environment variables"""
    # TEMPORARILY DISABLED: IPRoyal proxy returning 407 - credentials may be expired
    # TODO: Update proxy credentials in .env file
    print("[Proxy] ⚠️  Proxy temporarily disabled - credentials not working")
    return None
    
    # Original code (re-enable when proxy credentials are fixed):
    # if not PROXY_USER or not PROXY_PASS:
    #     return None
    # session_id = f"sess_{datetime.now().timestamp():.0f}"
    # return f"http://{PROXY_USER}_{session_id}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}"


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
        
        # Generate document
        print(f"[Verify] Generating document...")
        doc_data, filename = generate_document(
            "auto",
            "John",  # Will be replaced by verifier
            "Doe",
            "University"
        )
        
        # Run verification
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


@app.get("/api/config")
async def get_config_endpoint():
    """Get current configuration (for admin panel)"""
    import config_manager
    return config_manager.get_config()


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
