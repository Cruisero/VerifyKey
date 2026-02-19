"""
Verification History Logger for VerifyKey
Records each verification result for the real-time status grid.
Storage: JSON file at /app/data/verification_history.json
"""

import json
import os
import threading
import uuid
from datetime import datetime
from typing import Dict, List, Optional

# History storage file
HISTORY_FILE = "/app/data/verification_history.json"

# Max records to keep
MAX_RECORDS = 500

# Thread lock for concurrent access safety
_lock = threading.Lock()


def _load_history() -> List[Dict]:
    """Load history data from file"""
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, 'r') as f:
                return json.load(f)
    except Exception as e:
        print(f"[History] Error loading history: {e}")
    return []


def _save_history(data: List[Dict]) -> bool:
    """Save history data to file"""
    try:
        os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
        with open(HISTORY_FILE, 'w') as f:
            json.dump(data, f, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[History] Error saving history: {e}")
        return False


def log_verification(status: str, verification_id: str = "") -> Dict:
    """
    Log a verification result.
    
    Args:
        status: One of 'pass', 'failed', 'processing', 'cancel'
        verification_id: Optional verification ID
    
    Returns:
        The logged record
    """
    record = {
        "id": str(uuid.uuid4())[:8],
        "status": status,
        "verificationId": verification_id,
        "timestamp": datetime.now().isoformat()
    }
    
    with _lock:
        history = _load_history()
        history.append(record)
        
        # Trim old records
        if len(history) > MAX_RECORDS:
            history = history[-MAX_RECORDS:]
        
        _save_history(history)
    
    return record


def update_verification(record_id: str, status: str) -> bool:
    """
    Update the status of an existing verification record.
    Useful for updating 'processing' → 'pass'/'failed'/'cancel'.
    
    Args:
        record_id: The record ID to update
        status: New status
    
    Returns:
        True if updated successfully
    """
    with _lock:
        history = _load_history()
        for record in history:
            if record["id"] == record_id:
                record["status"] = status
                record["timestamp"] = datetime.now().isoformat()
                _save_history(history)
                return True
    return False


def get_recent_history(limit: int = 200) -> List[Dict]:
    """
    Get recent verification history.
    
    Args:
        limit: Max number of records to return
    
    Returns:
        List of verification records, newest last
    """
    history = _load_history()
    return history[-limit:]


def get_history_stats() -> Dict:
    """Get statistics from verification history"""
    history = _load_history()
    
    stats = {
        "total": len(history),
        "pass": sum(1 for r in history if r["status"] == "pass"),
        "failed": sum(1 for r in history if r["status"] == "failed"),
        "processing": sum(1 for r in history if r["status"] == "processing"),
        "cancel": sum(1 for r in history if r["status"] == "cancel"),
    }
    
    return stats
