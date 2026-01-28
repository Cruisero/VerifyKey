"""
Document Capture Module for SheerID Verification Analysis

This module provides functionality to capture and download documents
that have been submitted to SheerID for any given verificationId.

Usage:
    result = capture_verification_documents(verification_id)
    # Returns dict with documents saved to captured_submissions/{vid}/
"""

import os
import json
import httpx
from datetime import datetime
from typing import Optional, Dict, List

from anti_detect import create_session, get_headers, warm_session

# Base URL for SheerID API
SHEERID_API_URL = "https://services.sheerid.com/rest/v2"

# Directory to store captured documents
CAPTURE_DIR = os.path.join(os.path.dirname(__file__), "..", "captured_submissions")


def ensure_capture_dir(vid: str) -> str:
    """Create and return the capture directory for a verification ID"""
    dir_path = os.path.join(CAPTURE_DIR, vid)
    os.makedirs(dir_path, exist_ok=True)
    return dir_path


def fetch_verification_details(vid: str, proxy: str = None) -> Dict:
    """
    Fetch full verification details from SheerID API
    
    Args:
        vid: Verification ID
        proxy: Optional proxy URL
    
    Returns:
        dict with verification details including documents info
    """
    session, lib_name, impersonate = create_session(proxy)
    headers = get_headers()
    
    try:
        # Warm up session
        warm_session(session, headers=headers)
        
        # Fetch verification details
        url = f"{SHEERID_API_URL}/verification/{vid}"
        
        kwargs = {"headers": headers, "timeout": 30}
        if proxy:
            kwargs["proxies"] = {"http": proxy, "https": proxy}
        
        response = session.get(url, **kwargs)
        
        if response.status_code != 200:
            return {
                "success": False,
                "error": f"HTTP {response.status_code}",
                "status_code": response.status_code
            }
        
        data = response.json()
        
        return {
            "success": True,
            "verificationId": vid,
            "currentStep": data.get("currentStep"),
            "programId": data.get("programId"),
            "segment": data.get("segment"),
            "organization": data.get("organization"),
            "personInfo": data.get("personInfo"),
            "documents": data.get("documents", []),
            "submissionUrl": data.get("submissionUrl"),
            "metadata": data.get("metadata"),
            "created": data.get("created"),
            "updated": data.get("updated"),
            "rejectionReasons": data.get("rejectionReasons", []),
            "errorIds": data.get("errorIds", []),
            "raw_data": data
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
    finally:
        session.close()


def download_document(url: str, save_path: str, proxy: str = None) -> bool:
    """
    Download a document from URL and save to file
    
    Args:
        url: Document URL (usually S3 presigned URL)
        save_path: Local path to save the document
        proxy: Optional proxy URL
    
    Returns:
        True if successful, False otherwise
    """
    try:
        kwargs = {"timeout": 60}
        if proxy:
            kwargs["proxies"] = {"http": proxy, "https": proxy}
        
        with httpx.Client(**kwargs) as client:
            response = client.get(url)
            
            if response.status_code == 200:
                with open(save_path, 'wb') as f:
                    f.write(response.content)
                print(f"[Capture] ✅ Downloaded: {os.path.basename(save_path)}")
                return True
            else:
                print(f"[Capture] ❌ Failed to download: HTTP {response.status_code}")
                return False
                
    except Exception as e:
        print(f"[Capture] ❌ Download error: {e}")
        return False


def fetch_document_urls(vid: str, proxy: str = None) -> List[Dict]:
    """
    Attempt to fetch document download URLs for a verification
    
    Note: This may not work for all verifications as SheerID may
    restrict access to documents after submission.
    
    Args:
        vid: Verification ID
        proxy: Optional proxy URL
    
    Returns:
        List of document info dicts with potential download URLs
    """
    session, lib_name, impersonate = create_session(proxy)
    headers = get_headers()
    
    try:
        warm_session(session, headers=headers)
        
        # Try to fetch documents endpoint
        # Note: This endpoint may or may not exist depending on SheerID version
        url = f"{SHEERID_API_URL}/verification/{vid}/document"
        
        kwargs = {"headers": headers, "timeout": 30}
        if proxy:
            kwargs["proxies"] = {"http": proxy, "https": proxy}
        
        response = session.get(url, **kwargs)
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"[Capture] Document endpoint returned: {response.status_code}")
            return []
            
    except Exception as e:
        print(f"[Capture] Error fetching document URLs: {e}")
        return []
    finally:
        session.close()


def capture_verification_documents(vid: str, proxy: str = None) -> Dict:
    """
    Main function to capture all documents and metadata for a verification
    
    Args:
        vid: Verification ID
        proxy: Optional proxy URL
    
    Returns:
        dict with capture results including saved file paths
    """
    print(f"[Capture] 🔍 Starting capture for verification: {vid}")
    
    # Create capture directory
    capture_dir = ensure_capture_dir(vid)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Fetch verification details
    details = fetch_verification_details(vid, proxy)
    
    if not details.get("success"):
        return {
            "success": False,
            "error": details.get("error", "Failed to fetch verification details"),
            "verificationId": vid
        }
    
    # Save metadata
    metadata_path = os.path.join(capture_dir, f"metadata_{timestamp}.json")
    with open(metadata_path, 'w', encoding='utf-8') as f:
        # Remove raw_data to keep file clean, but preserve important info
        save_data = {k: v for k, v in details.items() if k != "raw_data"}
        save_data["captured_at"] = timestamp
        json.dump(save_data, f, indent=2, ensure_ascii=False, default=str)
    
    print(f"[Capture] 📄 Saved metadata to: {metadata_path}")
    
    # Attempt to fetch and download documents
    downloaded_files = []
    documents_info = details.get("documents", [])
    
    # Try direct document URLs if available
    if documents_info:
        for i, doc in enumerate(documents_info):
            doc_url = doc.get("url") or doc.get("downloadUrl") or doc.get("uploadUrl")
            if doc_url:
                file_ext = doc.get("mimeType", "image/png").split("/")[-1]
                file_name = f"document_{i+1}_{timestamp}.{file_ext}"
                file_path = os.path.join(capture_dir, file_name)
                
                if download_document(doc_url, file_path, proxy):
                    downloaded_files.append({
                        "type": doc.get("type", "unknown"),
                        "fileName": file_name,
                        "path": file_path
                    })
    
    # Try alternative document endpoint
    if not downloaded_files:
        doc_urls = fetch_document_urls(vid, proxy)
        for i, doc in enumerate(doc_urls):
            doc_url = doc.get("url") or doc.get("downloadUrl")
            if doc_url:
                file_name = f"document_{i+1}_{timestamp}.png"
                file_path = os.path.join(capture_dir, file_name)
                
                if download_document(doc_url, file_path, proxy):
                    downloaded_files.append({
                        "type": doc.get("type", "unknown"),
                        "fileName": file_name,
                        "path": file_path
                    })
    
    result = {
        "success": True,
        "verificationId": vid,
        "captureDir": capture_dir,
        "metadataPath": metadata_path,
        "currentStep": details.get("currentStep"),
        "organization": details.get("organization"),
        "personInfo": details.get("personInfo"),
        "documentsFound": len(documents_info),
        "documentsDownloaded": len(downloaded_files),
        "downloadedFiles": downloaded_files,
        "rejectionReasons": details.get("rejectionReasons", []),
        "capturedAt": timestamp
    }
    
    if not downloaded_files:
        result["note"] = "Documents metadata captured but actual files may not be accessible. SheerID may restrict document downloads after submission."
    
    print(f"[Capture] ✅ Capture complete: {len(downloaded_files)} documents downloaded")
    
    return result


def list_captured_submissions() -> List[Dict]:
    """
    List all captured submissions
    
    Returns:
        List of submission info dicts
    """
    submissions = []
    
    if not os.path.exists(CAPTURE_DIR):
        return submissions
    
    for vid in os.listdir(CAPTURE_DIR):
        vid_dir = os.path.join(CAPTURE_DIR, vid)
        if os.path.isdir(vid_dir):
            # Find most recent metadata file
            metadata_files = [f for f in os.listdir(vid_dir) if f.startswith("metadata_")]
            
            if metadata_files:
                metadata_files.sort(reverse=True)
                latest_metadata = os.path.join(vid_dir, metadata_files[0])
                
                try:
                    with open(latest_metadata, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        submissions.append({
                            "verificationId": vid,
                            "capturedAt": data.get("captured_at"),
                            "currentStep": data.get("currentStep"),
                            "organization": data.get("organization"),
                            "personInfo": data.get("personInfo"),
                            "documentsDownloaded": len([f for f in os.listdir(vid_dir) if f.startswith("document_")])
                        })
                except Exception as e:
                    submissions.append({
                        "verificationId": vid,
                        "error": str(e)
                    })
            else:
                # Directory exists but no metadata
                doc_count = len([f for f in os.listdir(vid_dir) if f.startswith("document_")])
                submissions.append({
                    "verificationId": vid,
                    "documentsDownloaded": doc_count,
                    "note": "No metadata file found"
                })
    
    return submissions


def get_captured_submission(vid: str) -> Dict:
    """
    Get details of a specific captured submission
    
    Args:
        vid: Verification ID
    
    Returns:
        dict with submission details and file paths
    """
    vid_dir = os.path.join(CAPTURE_DIR, vid)
    
    if not os.path.exists(vid_dir):
        return {
            "success": False,
            "error": f"No capture found for verification ID: {vid}"
        }
    
    # Get all files
    files = os.listdir(vid_dir)
    metadata_files = sorted([f for f in files if f.startswith("metadata_")], reverse=True)
    document_files = [f for f in files if f.startswith("document_")]
    
    result = {
        "success": True,
        "verificationId": vid,
        "captureDir": vid_dir,
        "documentFiles": document_files
    }
    
    # Load latest metadata
    if metadata_files:
        latest_metadata = os.path.join(vid_dir, metadata_files[0])
        try:
            with open(latest_metadata, 'r', encoding='utf-8') as f:
                result["metadata"] = json.load(f)
        except Exception as e:
            result["metadataError"] = str(e)
    
    return result


# Test function
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        vid = sys.argv[1]
        print(f"Capturing verification: {vid}")
        result = capture_verification_documents(vid)
        print(json.dumps(result, indent=2, default=str))
    else:
        print("Usage: python document_capture.py <verification_id>")
        print("\nListing existing captures:")
        captures = list_captured_submissions()
        print(json.dumps(captures, indent=2, default=str))
