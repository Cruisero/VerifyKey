"""
Anti-Detection Module for OnePass SheerID Verification
Based on ThanhNguyxn/SheerID-Verification-Tool techniques

Features:
- TLS fingerprint spoofing with curl_cffi (Chrome impersonation)
- NewRelic tracking headers (required by SheerID)
- Browser-like headers with proper ordering
- Session warm-up before verification
"""

import random
import hashlib
import time
import uuid
import base64
import json

# Browser versions for impersonation (randomly selected for anti-detect)
# curl_cffi supports: chrome, firefox, safari, edge
BROWSER_VERSIONS = [
    # Chrome versions (most common)
    "chrome131",
    "chrome130", 
    "chrome124",
    "chrome120",
    "chrome119",
    # Firefox versions (secondary)
    "firefox120",
    "firefox115",
    # Edge versions (Windows users)
    "edge120",
    "edge119",
    # Safari (macOS users) - less common
    "safari17",
]

# Alias for backward compatibility
CHROME_VERSIONS = BROWSER_VERSIONS

# User agents matching browser versions (randomly selected)
USER_AGENTS = [
    # Chrome on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    # Chrome on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    # Chrome on Linux
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    # Firefox on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    # Firefox on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0",
    # Edge on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0",
    # Safari on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
]

# Screen resolutions (realistic distribution)
RESOLUTIONS = [
    "1920x1080", "1366x768", "1536x864", "1440x900", "1280x720",
    "2560x1440", "1600x900", "1680x1050", "1280x800", "1024x768"
]

# Timezones (US-focused for university verification)
TIMEZONES = [-8, -7, -6, -5, -4]

# Languages (US English primary, some variations)
LANGUAGES = [
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,es;q=0.8",
    "en-US,en;q=0.9,zh;q=0.8",
    "en-GB,en;q=0.9",
    "en,en-US;q=0.9",
]

# Platform hints (must match User-Agent)
PLATFORMS = [
    ("Windows", '"Windows"', '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"'),
    ("Windows", '"Windows"', '"Chromium";v="130", "Google Chrome";v="130", "Not_A Brand";v="24"'),
    ("macOS", '"macOS"', '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"'),
    ("Windows", '"Windows"', '"Chromium";v="120", "Microsoft Edge";v="120", "Not_A Brand";v="24"'),
    ("macOS", '"macOS"', '"Not_A Brand";v="99", "Chromium";v="120", "Safari";v="17"'),
]

DEFAULT_IMPERSONATE = "chrome131"


def get_random_user_agent() -> str:
    """Get a random User-Agent string"""
    return random.choice(USER_AGENTS)


def get_fingerprint() -> str:
    """Generate realistic browser fingerprint hash"""
    components = [
        str(int(time.time() * 1000)),
        str(random.random()),
        random.choice(RESOLUTIONS),
        str(random.choice(TIMEZONES)),
        random.choice(LANGUAGES).split(",")[0],
        random.choice(["Win32", "MacIntel", "Linux x86_64"]),
        str(random.randint(2, 16)),
        str(random.randint(4, 32)),
        str(uuid.uuid4()),
    ]
    return hashlib.md5("|".join(components).encode()).hexdigest()


def generate_newrelic_headers() -> dict:
    """
    Generate NewRelic tracking headers REQUIRED by SheerID API
    These headers help make requests look like they're from real browsers
    """
    trace_id = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    trace_id = trace_id[:32]
    span_id = uuid.uuid4().hex[:16]
    timestamp = int(time.time() * 1000)

    payload = {
        "v": [0, 1],
        "d": {
            "ty": "Browser",
            "ac": "364029",
            "ap": "134291347",
            "id": span_id,
            "tr": trace_id,
            "ti": timestamp
        }
    }

    return {
        "newrelic": base64.b64encode(json.dumps(payload).encode()).decode(),
        "traceparent": f"00-{trace_id}-{span_id}-01",
        "tracestate": f"364029@nr=0-1-364029-134291347-{span_id}----{timestamp}"
    }


def get_headers() -> dict:
    """
    Generate browser-like headers with proper ordering for SheerID
    """
    ua = get_random_user_agent()
    platform = random.choice(PLATFORMS)
    language = random.choice(LANGUAGES)
    
    # NewRelic headers (CRITICAL for SheerID)
    nr_headers = generate_newrelic_headers()

    headers = {
        "accept": "application/json, text/plain, */*",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": language,
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "sec-ch-ua": platform[2],
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": platform[1],
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": ua,
        "content-type": "application/json",
        "clientversion": "2.158.0",  # CRITICAL: SheerID JS library version
        "clientname": "jslib",       # CRITICAL: SheerID client identifier
        "origin": "https://services.sheerid.com",
        "referer": "https://services.sheerid.com/",
        **nr_headers
    }

    return headers


def random_delay(min_ms: int = 300, max_ms: int = 1200):
    """
    Random delay with gamma distribution to mimic human behavior
    """
    try:
        import numpy as np
        shape, scale = 2.0, (max_ms - min_ms) / 4000
        delay = min_ms/1000 + np.random.gamma(shape, scale)
        delay = min(delay, max_ms/1000)
    except ImportError:
        delay = random.randint(min_ms, max_ms) / 1000
        delay += random.uniform(0, 0.15)
    
    time.sleep(delay)


def create_session(proxy: str = None, impersonate: str = None):
    """
    Create HTTP session with curl_cffi for TLS fingerprint spoofing
    
    CRITICAL: curl_cffi with Chrome impersonation makes TLS fingerprint
    match real Chrome browser, bypassing SheerID's JA3/JA4 detection.
    """
    # Random browser version if not specified (anti-detect fingerprinting)
    if impersonate is None:
        imp_version = random.choice(CHROME_VERSIONS)
    else:
        imp_version = impersonate
    
    try:
        from curl_cffi import requests as curl_requests
        from urllib.parse import quote
        
        # For curl_cffi, we pass proxy directly to each request, not to Session
        # This avoids proxy format issues
        session = curl_requests.Session(impersonate=imp_version)
        
        # Store proxy URL for later use (will be passed to each request)
        if proxy:
            # URL encode the proxy credentials if needed
            if "@" in proxy and "://" in proxy:
                # Already formatted: http://user:pass@host:port
                session._proxy_url = proxy
            else:
                session._proxy_url = proxy if proxy.startswith("http") else f"http://{proxy}"
        else:
            session._proxy_url = None
        
        print(f"[Anti-Detect] ✅ Using curl_cffi with {imp_version} impersonation")
        print(f"[Anti-Detect]    TLS fingerprint will match real Chrome browser")
        if session._proxy_url:
            # Mask password in log
            masked = session._proxy_url.split("@")[-1] if "@" in session._proxy_url else session._proxy_url
            print(f"[Anti-Detect]    Proxy: {masked}")
        return session, "curl_cffi", imp_version
        
    except ImportError:
        print("[Anti-Detect] ⚠️  curl_cffi not installed!")
        print("[Anti-Detect]    Install with: pip install curl_cffi")
        
        # Fallback to httpx (detectable but functional)
        import httpx
        proxy_url = proxy if proxy else None
        session = httpx.Client(timeout=30, proxy=proxy_url)
        session._proxy_url = proxy_url
        return session, "httpx", None


def warm_session(session, program_id: str = None, headers: dict = None):
    """
    Warm up session before verification attempt
    Makes requests look more like a real browser by establishing session first
    """
    base_url = "https://services.sheerid.com"
    hdrs = headers or get_headers()
    
    try:
        session.get(f"{base_url}/rest/v2/config", headers=hdrs, timeout=10)
        random_delay(500, 1000)
    except:
        pass
    
    if program_id:
        try:
            session.get(f"{base_url}/rest/v2/program/{program_id}", headers=hdrs, timeout=10)
            random_delay(300, 700)
        except:
            pass
    
    return session
