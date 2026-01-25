"""
SheerID Verifier with Anti-Detection
Uses curl_cffi for TLS fingerprint spoofing
"""

import re
import random
import os
from typing import Optional, Dict, Tuple, Callable

from anti_detect import (
    create_session, get_headers, get_fingerprint, 
    random_delay, warm_session
)

SHEERID_API_URL = "https://services.sheerid.com/rest/v2"

# US Universities with CORRECT SheerID organization IDs (from orgsearch.sheerid.net)
UNIVERSITIES = [
    {"id": 3113, "idExtended": "3113", "name": "Stanford University", "domain": "stanford.edu", "country": "US"},
    {"id": 1426, "idExtended": "1426", "name": "Harvard University", "domain": "harvard.edu", "country": "US"},
    {"id": 3499, "idExtended": "3499", "name": "University of California-Los Angeles", "domain": "ucla.edu", "country": "US"},
    {"id": 2629, "idExtended": "2629", "name": "University of California-Berkeley", "domain": "berkeley.edu", "country": "US"},
    {"id": 2812, "idExtended": "2812", "name": "University of Michigan-Ann Arbor", "domain": "umich.edu", "country": "US"},
    {"id": 2711, "idExtended": "2711", "name": "New York University", "domain": "nyu.edu", "country": "US"},
    {"id": 1564, "idExtended": "1564", "name": "Yale University", "domain": "yale.edu", "country": "US"},
    {"id": 1563, "idExtended": "1563", "name": "Columbia University", "domain": "columbia.edu", "country": "US"},
    {"id": 1461, "idExtended": "1461", "name": "Massachusetts Institute of Technology", "domain": "mit.edu", "country": "US"},
    {"id": 3169, "idExtended": "3169", "name": "University of Texas at Austin", "domain": "utexas.edu", "country": "US"},
]

# Common first and last names
FIRST_NAMES = [
    "James", "Michael", "David", "John", "Robert", "William", "Richard", "Thomas",
    "Emily", "Sarah", "Jessica", "Ashley", "Amanda", "Jennifer", "Megan", "Rachel",
    "Daniel", "Matthew", "Anthony", "Christopher", "Andrew", "Kevin", "Brian", "Eric",
    "Lauren", "Stephanie", "Nicole", "Elizabeth", "Samantha", "Katherine", "Michelle"
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson",
    "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson",
    "White", "Harris", "Clark", "Lewis", "Robinson", "Walker", "Young", "King"
]


def select_university() -> dict:
    """Select random US university"""
    return random.choice(UNIVERSITIES)


def generate_name() -> Tuple[str, str]:
    """Generate random first and last name"""
    return random.choice(FIRST_NAMES), random.choice(LAST_NAMES)


def generate_email(first: str, last: str, domain: str) -> str:
    """Generate realistic student email"""
    patterns = [
        f"{first.lower()}.{last.lower()}@{domain}",
        f"{first.lower()}{last.lower()[0]}@{domain}",
        f"{first.lower()[0]}{last.lower()}@{domain}",
        f"{first.lower()}{random.randint(1, 99)}@{domain}",
    ]
    return random.choice(patterns)


def generate_birth_date() -> str:
    """Generate valid student birth date (18-26 years old)"""
    year = random.randint(2000, 2006)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    return f"{year}-{month:02d}-{day:02d}"


class SheerIDVerifier:
    """SheerID Verification with curl_cffi anti-detection"""
    
    def __init__(self, verification_id: str, proxy: str = None, on_progress: Callable = None):
        self.vid = verification_id
        self.fingerprint = get_fingerprint()
        self.on_progress = on_progress or (lambda x: None)
        
        # Create session with TLS fingerprint spoofing
        self.session, self.lib_name, self.impersonate = create_session(proxy)
        self.headers = get_headers()
        
        self.org = None
        self.student_info = None
    
    def __del__(self):
        if hasattr(self, 'session'):
            try:
                self.session.close()
            except:
                pass
    
    def _request(self, method: str, endpoint: str, body: dict = None) -> Tuple[dict, int]:
        """Make request with anti-detection headers"""
        random_delay(300, 800)
        
        url = f"{SHEERID_API_URL}{endpoint}"
        
        # Get proxy URL from session if available
        proxy_url = getattr(self.session, '_proxy_url', None)
        
        try:
            # curl_cffi requires proxy as parameter to each request for authentication to work
            kwargs = {"headers": self.headers, "timeout": 30}
            if proxy_url:
                kwargs["proxy"] = proxy_url
            
            if method.upper() == "GET":
                resp = self.session.get(url, **kwargs)
            elif method.upper() == "POST":
                resp = self.session.post(url, json=body, **kwargs)
            elif method.upper() == "DELETE":
                resp = self.session.delete(url, **kwargs)
            elif method.upper() == "PUT":
                resp = self.session.put(url, json=body, **kwargs)
            else:
                raise ValueError(f"Unknown method: {method}")
            
            try:
                data = resp.json() if resp.text else {}
            except:
                data = {"_text": resp.text}
            
            return data, resp.status_code
            
        except Exception as e:
            raise Exception(f"Request failed: {e}")
    
    def _upload_s3(self, url: str, data: bytes) -> bool:
        """Upload document to S3"""
        try:
            # Get proxy URL from session if available
            proxy_url = getattr(self.session, '_proxy_url', None)
            kwargs = {"data": data, "headers": {"Content-Type": "image/png"}, "timeout": 60}
            if proxy_url:
                kwargs["proxy"] = proxy_url
            
            resp = self.session.put(url, **kwargs)
            return 200 <= resp.status_code < 300
        except Exception as e:
            print(f"[S3 Upload] Error: {e}")
            return False
    
    def check_link(self) -> dict:
        """Check if verification link is valid"""
        if not self.vid:
            return {"valid": False, "error": "Invalid verification ID"}
        
        data, status = self._request("GET", f"/verification/{self.vid}")
        
        if status != 200:
            return {"valid": False, "error": f"HTTP {status}"}
        
        step = data.get("currentStep", "")
        valid_steps = ["collectStudentPersonalInfo", "docUpload", "sso"]
        
        if step in valid_steps:
            return {"valid": True, "step": step}
        elif step == "success":
            return {"valid": False, "error": "Already verified"}
        elif step == "pending":
            return {"valid": False, "error": "Pending review"}
        
        return {"valid": False, "error": f"Invalid step: {step}"}
    
    def verify(self, doc_data: bytes) -> dict:
        """Run full verification"""
        if not self.vid:
            return {"success": False, "error": "Invalid verification ID"}
        
        try:
            # Warm up session first
            self.on_progress({"step": "warming", "message": "Warming up session..."})
            warm_session(self.session, headers=self.headers)
            
            # Check current step
            self.on_progress({"step": "checking", "message": "Checking verification status..."})
            check_data, check_status = self._request("GET", f"/verification/{self.vid}")
            current_step = check_data.get("currentStep", "") if check_status == 200 else ""
            
            if current_step == "success":
                return {"success": True, "status": "success", "message": "Already verified"}
            if current_step == "pending":
                return {"success": True, "status": "pending", "message": "Already pending review"}
            
            # Generate student info
            self.org = select_university()
            first, last = generate_name()
            email = generate_email(first, last, self.org["domain"])
            dob = generate_birth_date()
            
            self.student_info = {
                "firstName": first,
                "lastName": last,
                "email": email,
                "birthDate": dob
            }
            
            self.on_progress({
                "step": "info_generated",
                "message": f"Student: {first} {last}",
                "details": {
                    "name": f"{first} {last}",
                    "email": email,
                    "school": self.org["name"],
                    "birthDate": dob
                }
            })
            
            # Step 1: Submit student info (if needed)
            if current_step == "collectStudentPersonalInfo":
                self.on_progress({"step": "submitting", "message": "Submitting student info..."})
                
                body = {
                    "firstName": first,
                    "lastName": last,
                    "birthDate": dob,
                    "email": email,
                    "phoneNumber": "",
                    "organization": {
                        "id": self.org["id"],
                        "idExtended": self.org["idExtended"],
                        "name": self.org["name"]
                    },
                    "deviceFingerprintHash": self.fingerprint,
                    "locale": "en-US",
                    "metadata": {
                        "marketConsentValue": False,
                        "verificationId": self.vid,
                        "refererUrl": f"https://services.sheerid.com/verify/?verificationId={self.vid}",
                    }
                }
                
                data, status = self._request("POST", f"/verification/{self.vid}/step/collectStudentPersonalInfo", body)
                
                if status != 200:
                    # Log detailed error for debugging
                    print(f"[Verify] Submit failed with status {status}")
                    print(f"[Verify] Response data: {data}")
                    error_msg = data.get("message", "") if isinstance(data, dict) else str(data)
                    error_ids = data.get("errorIds", []) if isinstance(data, dict) else []
                    return {"success": False, "error": f"Submit failed: {status}", "details": error_msg, "errorIds": error_ids}
                
                if data.get("currentStep") == "error":
                    error_ids = data.get("errorIds", [])
                    print(f"[Verify] SheerID error: {error_ids}")
                    return {"success": False, "error": f"Error: {error_ids}"}
                
                current_step = data.get("currentStep", "")
                self.on_progress({"step": "submitted", "message": f"Current step: {current_step}"})
            
            # Step 2: Skip SSO if needed
            if current_step == "sso":
                self.on_progress({"step": "skipping_sso", "message": "Skipping SSO..."})
                self._request("DELETE", f"/verification/{self.vid}/step/sso")
            
            # Step 3: Request upload URL
            self.on_progress({"step": "uploading", "message": "Requesting upload URL..."})
            
            upload_data, upload_status = self._request(
                "POST", 
                f"/verification/{self.vid}/step/docUpload/document",
                {"file": "transcript.png", "type": "image/png", "mimeType": "image/png"}
            )
            
            if upload_status != 200:
                return {"success": False, "error": f"Upload URL request failed: {upload_status}"}
            
            upload_url = upload_data.get("uploadUrl")
            asset_id = upload_data.get("assetId")
            
            if not upload_url:
                return {"success": False, "error": "No upload URL in response"}
            
            # Step 4: Upload document to S3
            self.on_progress({"step": "uploading", "message": "Uploading document..."})
            
            if not self._upload_s3(upload_url, doc_data):
                return {"success": False, "error": "S3 upload failed"}
            
            # Step 5: Complete upload
            self.on_progress({"step": "completing", "message": "Completing upload..."})
            
            complete_data, complete_status = self._request(
                "PUT",
                f"/verification/{self.vid}/step/docUpload/document/{asset_id}"
            )
            
            # Step 6: Submit for review
            self.on_progress({"step": "submitting", "message": "Submitting for review..."})
            
            submit_data, submit_status = self._request(
                "POST",
                f"/verification/{self.vid}/step/docUpload",
                {}
            )
            
            final_step = submit_data.get("currentStep", "")
            
            if final_step == "pending":
                return {
                    "success": True,
                    "status": "pending",
                    "message": "Submitted for review",
                    "student": f"{first} {last}",
                    "email": email,
                    "school": self.org["name"]
                }
            elif final_step == "success":
                return {
                    "success": True,
                    "status": "success",
                    "message": "Verified!",
                    "student": f"{first} {last}",
                    "email": email,
                    "school": self.org["name"]
                }
            elif final_step == "error":
                error_ids = submit_data.get("errorIds", [])
                return {"success": False, "error": f"Verification error: {error_ids}"}
            else:
                return {"success": False, "error": f"Unexpected step: {final_step}", "data": submit_data}
            
        except Exception as e:
            return {"success": False, "error": str(e)}


def parse_verification_id(url_or_id: str) -> Optional[str]:
    """Extract verification ID from URL or return as-is if already ID"""
    if not url_or_id:
        return None
    
    # Already just an ID (hex string)
    if re.match(r'^[a-f0-9]{24}$', url_or_id.lower()):
        return url_or_id.lower()
    
    # Extract from URL
    match = re.search(r'verificationId=([a-f0-9]+)', url_or_id, re.IGNORECASE)
    if match:
        return match.group(1).lower()
    
    # Try extracting from path
    match = re.search(r'/([a-f0-9]{24})(?:\?|$|/)', url_or_id, re.IGNORECASE)
    if match:
        return match.group(1).lower()
    
    return None
