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

# Google One Student Verification Program ID (from ThanhNguyxn)
PROGRAM_ID = "67c8c14f5f17a83b745e3f82"

# US Universities with VERIFIED SheerID IDs (from ThanhNguyxn/SheerID-Verification-Tool)
# These IDs are confirmed to work with high success rates
UNIVERSITIES = [
    # High priority - highest success rates
    {"id": 2565, "idExtended": "2565", "name": "Pennsylvania State University-Main Campus", "domain": "psu.edu", "country": "US", "weight": 100},
    {"id": 3499, "idExtended": "3499", "name": "University of California, Los Angeles", "domain": "ucla.edu", "country": "US", "weight": 98},
    {"id": 3491, "idExtended": "3491", "name": "University of California, Berkeley", "domain": "berkeley.edu", "country": "US", "weight": 97},
    {"id": 1953, "idExtended": "1953", "name": "Massachusetts Institute of Technology", "domain": "mit.edu", "country": "US", "weight": 95},
    {"id": 3113, "idExtended": "3113", "name": "Stanford University", "domain": "stanford.edu", "country": "US", "weight": 95},
    {"id": 2285, "idExtended": "2285", "name": "New York University", "domain": "nyu.edu", "country": "US", "weight": 96},
    {"id": 1426, "idExtended": "1426", "name": "Harvard University", "domain": "harvard.edu", "country": "US", "weight": 92},
    {"id": 590759, "idExtended": "590759", "name": "Yale University", "domain": "yale.edu", "country": "US", "weight": 90},
    {"id": 2626, "idExtended": "2626", "name": "Princeton University", "domain": "princeton.edu", "country": "US", "weight": 90},
    {"id": 698, "idExtended": "698", "name": "Columbia University", "domain": "columbia.edu", "country": "US", "weight": 92},
    {"id": 3508, "idExtended": "3508", "name": "University of Chicago", "domain": "uchicago.edu", "country": "US", "weight": 88},
    {"id": 943, "idExtended": "943", "name": "Duke University", "domain": "duke.edu", "country": "US", "weight": 88},
    {"id": 751, "idExtended": "751", "name": "Cornell University", "domain": "cornell.edu", "country": "US", "weight": 90},
    {"id": 2420, "idExtended": "2420", "name": "Northwestern University", "domain": "northwestern.edu", "country": "US", "weight": 88},
    {"id": 3568, "idExtended": "3568", "name": "University of Michigan", "domain": "umich.edu", "country": "US", "weight": 95},
    {"id": 3686, "idExtended": "3686", "name": "University of Texas at Austin", "domain": "utexas.edu", "country": "US", "weight": 94},
    {"id": 1314, "idExtended": "1314", "name": "Georgia Institute of Technology-Main Campus (Atlanta, GA)", "domain": "gatech.edu", "country": "US", "weight": 93},
    {"id": 602, "idExtended": "602", "name": "Carnegie Mellon University", "domain": "cmu.edu", "country": "US", "weight": 92},
    {"id": 3477, "idExtended": "3477", "name": "University of California, San Diego", "domain": "ucsd.edu", "country": "US", "weight": 93},
    {"id": 378, "idExtended": "378", "name": "Arizona State University", "domain": "asu.edu", "country": "US", "weight": 92},
    # Community colleges - may have higher success
    {"id": 2874, "idExtended": "2874", "name": "Santa Monica College", "domain": "smc.edu", "country": "US", "weight": 85},
    {"id": 2350, "idExtended": "2350", "name": "Northern Virginia Community College", "domain": "nvcc.edu", "country": "US", "weight": 84},
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
    """Select US university with weighted random (higher weight = more likely)"""
    weights = [u.get("weight", 50) for u in UNIVERSITIES]
    total = sum(weights)
    r = random.uniform(0, total)
    cumulative = 0
    for u in UNIVERSITIES:
        cumulative += u.get("weight", 50)
        if r <= cumulative:
            return u
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
            
            # Use pre-generated student info if available (from main.py)
            # This ensures document and form have matching data!
            if hasattr(self, 'pre_generated') and self.pre_generated and hasattr(self, 'student_info'):
                first = self.student_info["firstName"]
                last = self.student_info["lastName"]
                email = self.student_info["email"]
                dob = self.student_info["birthDate"]
                print(f"[Verify] Using pre-generated info: {first} {last}")
            else:
                # Generate new student info (fallback)
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
                    "country": self.org.get("country", "US"),  # Add country field
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
                        "refererUrl": f"https://services.sheerid.com/verify/{PROGRAM_ID}/?verificationId={self.vid}",
                        "flags": '{"collect-info-step-email-first":"default","doc-upload-considerations":"default","doc-upload-may24":"default","doc-upload-redesign-use-legacy-message-keys":false,"docUpload-assertion-checklist":"default","font-size":"default","include-cvec-field-france-student":"not-labeled-optional"}',
                        "submissionOptIn": "By submitting the personal information above, I acknowledge that my personal information is being collected under the privacy policy of the business from which I am seeking a discount"
                    }
                }
                
                # Debug: Log country field
                print(f"[Verify] Submitting with country: {body.get('country')}, org: {self.org.get('name')}")
                
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
            
            # Step 2: Skip SSO if needed (ThanhNguyxn's PastKing logic)
            # Must skip SSO at both 'sso' AND 'collectStudentPersonalInfo' steps
            if current_step in ["sso", "collectStudentPersonalInfo"]:
                self.on_progress({"step": "skipping_sso", "message": "Skipping SSO..."})
                self._request("DELETE", f"/verification/{self.vid}/step/sso")
            
            # Step 3: Request upload URL (ThanhNguyxn's approach)
            self.on_progress({"step": "uploading", "message": "Requesting upload URL..."})
            
            # Use docUpload endpoint like ThanhNguyxn
            upload_body = {"files": [{"fileName": "transcript.png", "mimeType": "image/png", "fileSize": len(doc_data)}]}
            upload_data, upload_status = self._request(
                "POST", 
                f"/verification/{self.vid}/step/docUpload",
                upload_body
            )
            
            if upload_status != 200:
                print(f"[Verify] Upload request failed: {upload_status}")
                print(f"[Verify] Upload response: {upload_data}")
                return {"success": False, "error": f"Upload URL request failed: {upload_status}"}
            
            # Get upload URL from documents array
            documents = upload_data.get("documents", [])
            if not documents:
                return {"success": False, "error": "No documents in upload response"}
            
            upload_url = documents[0].get("uploadUrl")
            
            if not upload_url:
                return {"success": False, "error": "No upload URL in response"}
            
            # Step 4: Upload document to S3
            self.on_progress({"step": "uploading", "message": "Uploading document..."})
            
            if not self._upload_s3(upload_url, doc_data):
                return {"success": False, "error": "S3 upload failed"}
            
            print("[Verify] ✅ Document uploaded to S3")
            
            # Step 5: Complete document upload (ThanhNguyxn's approach)
            self.on_progress({"step": "completing", "message": "Completing upload..."})
            
            complete_data, complete_status = self._request(
                "POST",
                f"/verification/{self.vid}/step/completeDocUpload"
            )
            
            print(f"[Verify] Complete upload response: {complete_data.get('currentStep', 'unknown')}")
            
            final_step = complete_data.get("currentStep", "")
            
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
                error_ids = complete_data.get("errorIds", [])
                return {"success": False, "error": f"Verification error: {error_ids}"}
            else:
                return {"success": False, "error": f"Unexpected step: {final_step}", "data": complete_data}
            
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


def poll_verification_status(vid: str, max_attempts: int = 30, interval: int = 10, proxy: str = None) -> dict:
    """
    Poll SheerID API to monitor verification status until final result
    
    Args:
        vid: Verification ID
        max_attempts: Maximum number of polling attempts (default 30 = 5 minutes with 10s interval)
        interval: Seconds between polls (default 10)
        proxy: Optional proxy URL
    
    Returns:
        dict with final status
    """
    import time
    import httpx
    
    print(f"[Monitor] Starting to poll verification {vid}")
    print(f"[Monitor] Max attempts: {max_attempts}, Interval: {interval}s")
    
    for attempt in range(1, max_attempts + 1):
        try:
            # Build request
            url = f"https://services.sheerid.com/rest/v2/verification/{vid}"
            
            # Use proxy if specified
            client_kwargs = {"timeout": 30}
            if proxy:
                client_kwargs["proxy"] = proxy
            
            with httpx.Client(**client_kwargs) as client:
                response = client.get(url)
                
            if response.status_code != 200:
                print(f"[Monitor] Attempt {attempt}: HTTP {response.status_code}")
                time.sleep(interval)
                continue
            
            data = response.json()
            current_step = data.get("currentStep", "")
            error_ids = data.get("errorIds", [])
            rejection_reasons = data.get("rejectionReasons", [])
            
            print(f"[Monitor] Attempt {attempt}/{max_attempts}: step={current_step}, errors={error_ids}")
            
            # Final states
            if current_step == "success":
                return {
                    "success": True,
                    "status": "success",
                    "message": "Verification approved!",
                    "verificationId": vid,
                    "attempts": attempt
                }
            
            if current_step == "error":
                return {
                    "success": False,
                    "status": "error",
                    "message": f"Verification failed: {error_ids}",
                    "errorIds": error_ids,
                    "verificationId": vid,
                    "attempts": attempt
                }
            
            # Check for rejection reasons (docUpload with rejection means re-upload needed)
            if current_step == "docUpload" and rejection_reasons:
                return {
                    "success": False,
                    "status": "rejected",
                    "message": f"Document rejected: {rejection_reasons}",
                    "rejectionReasons": rejection_reasons,
                    "verificationId": vid,
                    "attempts": attempt
                }
            
            # Still pending - continue polling
            if current_step == "pending":
                print(f"[Monitor] Status: pending, waiting {interval}s...")
                time.sleep(interval)
                continue
            
            # Other states (collectStudentPersonalInfo, docUpload without rejection)
            print(f"[Monitor] Status: {current_step}, waiting {interval}s...")
            time.sleep(interval)
            
        except Exception as e:
            print(f"[Monitor] Attempt {attempt} error: {e}")
            time.sleep(interval)
    
    # Timeout
    return {
        "success": False,
        "status": "timeout",
        "message": f"Polling timed out after {max_attempts} attempts",
        "verificationId": vid,
        "attempts": max_attempts
    }
