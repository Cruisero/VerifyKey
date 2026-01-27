"""
Document Generator for SheerID Verification
Generates student documents using:
1. Google Gemini AI (primary) - More realistic
2. SVG templates (fallback) - Always available
"""

import random
import base64
import io
import os
import json
from typing import Tuple, Optional

import httpx

# Try to import PIL for image conversion
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# Try to import cairosvg for SVG to PNG conversion
try:
    import cairosvg
    HAS_CAIRO = True
except ImportError:
    HAS_CAIRO = False


# Gemini API configuration - fallback to env var if config not available
def _get_gemini_config():
    """Get Gemini API key and model from config or env"""
    try:
        from config_manager import get_active_generator
        gen = get_active_generator()
        if gen.get("type") == "gemini" and gen.get("apiKey"):
            return gen.get("apiKey"), gen.get("model", "gemini-3-pro-image-preview")
    except:
        pass
    # Fallback to environment variables
    return os.getenv("GEMINI_API_KEY", ""), os.getenv("GEMINI_MODEL", "gemini-3-pro-image-preview")


def generate_with_gemini(prompt: str) -> Optional[bytes]:
    """
    Generate image using Google Gemini AI
    
    Args:
        prompt: Text prompt for image generation
    
    Returns:
        Image bytes or None if failed
    """
    api_key, model = _get_gemini_config()
    
    if not api_key:
        print("[Gemini] No API key configured")
        return None
    
    try:
        print(f"[Gemini] Calling API with model: {model}")
        
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": api_key},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseModalities": ["image", "text"]
                }
            },
            timeout=60
        )
        
        if response.status_code != 200:
            error = response.json()
            print(f"[Gemini] API Error: {error.get('error', {}).get('message', response.status_code)}")
            return None
        
        data = response.json()
        
        # Extract image from response
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        image_part = next(
            (p for p in parts if p.get("inlineData", {}).get("mimeType", "").startswith("image/")),
            None
        )
        
        if image_part:
            image_data = base64.b64decode(image_part["inlineData"]["data"])
            print(f"[Gemini] ✓ Got image: {len(image_data)} bytes")
            return image_data
        
        print("[Gemini] No image in response")
        return None
        
    except Exception as e:
        print(f"[Gemini] Request failed: {e}")
        return None


def generate_transcript_with_gemini(first: str, last: str, university: str, birth_date: str, student_id: str = None) -> Optional[bytes]:
    """Generate academic transcript using Gemini AI - realistic registrar style"""
    
    import time
    if not student_id:
        student_id = f"{random.randint(21, 25)}{random.randint(100000, 999999)}"
    
    # Calculate GPA and credits
    term_gpa = round(3.2 + random.random() * 0.6, 2)
    cum_gpa = round(3.3 + random.random() * 0.5, 2)
    
    current_date = time.strftime("%m/%d/%Y")
    current_year = int(time.strftime("%Y"))
    current_month = int(time.strftime("%m"))
    
    # Determine current and previous semesters
    if current_month >= 1 and current_month <= 5:
        current_semester = f"Spring {current_year}"
        prev_semester = f"Fall {current_year - 1}"
    elif current_month >= 6 and current_month <= 7:
        current_semester = f"Summer {current_year}"
        prev_semester = f"Spring {current_year}"
    else:
        current_semester = f"Fall {current_year}"
        prev_semester = f"Spring {current_year}"
    
    prompt = f"""Generate a REALISTIC official university transcript image. 
The document should look like a REAL American university registrar system printout.

CRITICAL STYLE REQUIREMENTS:
- BLACK AND WHITE ONLY - no colors, no color blocks
- Plain, boring, functional design (like a real government form)
- Dense information layout with table lines
- Monospace or serif font typical of official documents
- Look like a scanned paper document with slight texture

EXACT DOCUMENT STRUCTURE:

{university.upper()}
Office of the University Registrar
Official Academic Transcript
----------------------------------------

Student Name: {first} {last}
Student ID: {student_id}
Date of Birth: {birth_date}

Program: Bachelor of Science
College/School: College of Arts & Sciences
Enrollment Status: Full-time Undergraduate

------------------------------------------------
TERM: {prev_semester}

Course Code | Course Title              | Credits | Grade
----------------------------------------------------------
CAS CS 112  | Intro to Computer Science | 4.0     | A-
MA 124      | Calculus I                | 4.0     | B+
WR 150      | Writing Seminar           | 4.0     | A
PY 211      | General Physics I         | 4.0     | B

Term GPA: {term_gpa}
Credits Earned This Term: 16.0

------------------------------------------------
TERM: {current_semester} (In Progress)

Course Code | Course Title              | Credits | Grade
----------------------------------------------------------
CAS CS 210  | Data Structures           | 4.0     | IP
MA 225      | Calculus II               | 4.0     | IP
PY 212      | General Physics II        | 4.0     | IP
WR 151      | Writing Seminar II        | 4.0     | IP

Credits Attempted: 16.0

------------------------------------------------
Cumulative Credits Earned: 48.0
Cumulative GPA: {cum_gpa}
------------------------------------------------

Issued by: Office of the University Registrar
[Official Seal Area]
Transcript Date: {current_date}

CRITICAL: 
- NO colorful headers or backgrounds
- Plain black text on white/off-white background
- Table grid lines visible
- Looks like a boring official government document
- Include "IP" (In Progress) for current courses, NOT letter grades

Generate ONLY the image."""
    
    return generate_with_gemini(prompt)


def generate_student_id_with_gemini(first: str, last: str, university: str, student_id: str = None) -> Optional[bytes]:
    """Generate student ID card using Gemini AI - realistic functional design"""
    
    import time
    if not student_id:
        student_id = f"{random.randint(21, 25)}{random.randint(100000, 999999)}"
    
    current_year = int(time.strftime("%Y"))
    
    # Issue date: when student enrolled (1-3 years ago)
    enrollment_year = current_year - random.randint(1, 3)
    issue_date = f"08/{enrollment_year}"
    
    # Expiration: aligned with academic year end
    exp_year = enrollment_year + 4
    if exp_year < current_year:
        exp_year = current_year + 1
    exp_date = f"05/{exp_year}"
    
    # Determine gender for photo
    female_names = ["Mary", "Patricia", "Jennifer", "Linda", "Barbara", "Elizabeth", "Susan", 
                    "Jessica", "Sarah", "Karen", "Lisa", "Nancy", "Betty", "Margaret", "Sandra",
                    "Ashley", "Kimberly", "Emily", "Donna", "Michelle", "Dorothy", "Carol",
                    "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Sharon", "Laura",
                    "Emma", "Olivia", "Ava", "Isabella", "Sophia", "Mia", "Charlotte", "Amelia"]
    
    is_female = first in female_names
    gender = "female" if is_female else "male"
    
    prompt = f"""Generate a REALISTIC university student ID card photo.
The card should look like a REAL university ID - functional, not decorative.

CRITICAL DESIGN PRINCIPLES:
- This is a FUNCTIONAL ID card, not a marketing design
- Simple, clean layout - no fancy graphics or colorful backgrounds
- White or light gray background with minimal accent color (if any)
- Looks like a real plastic card you'd carry in your wallet

CARD LAYOUT (standard university ID format):

FRONT OF CARD:
┌─────────────────────────────────────┐
│ [University Logo] {university}      │
├─────────────────────────────────────┤
│                                     │
│ ┌──────┐   {first} {last}           │
│ │      │   Student ID: {student_id} │
│ │ PHOTO│                            │
│ │      │   Undergraduate            │
│ └──────┘                            │
│                                     │
│         EXP: {exp_date}             │
└─────────────────────────────────────┘

PHOTO REQUIREMENTS:
- Portrait photo of a realistic young {gender} college student (age 18-22)
- Professional headshot style on neutral background
- Natural expression, looking at camera
- The photo MUST look like a real person

CARD STYLE:
- Horizontal orientation (standard credit card size proportions)
- Show the card photographed on a desk surface with slight shadow
- All four corners visible
- No barcode or magnetic strip visible on front
- Matte or semi-gloss card finish
- University name/logo at top
- Photo on left side, text info on right

Generate ONLY the image, no text explanation."""
    
    return generate_with_gemini(prompt)


def generate_schedule_with_gemini(first: str, last: str, university: str, student_id: str = None) -> Optional[bytes]:
    """Generate weekly class schedule using Gemini AI"""
    
    import time
    if not student_id:
        student_id = f"{random.randint(21, 25)}{random.randint(100000, 999999)}"
    
    current_year = int(time.strftime("%Y"))
    current_month = int(time.strftime("%m"))
    current_date = time.strftime("%m/%d/%Y")
    
    # Determine CURRENT semester based on month
    if current_month >= 1 and current_month <= 5:
        current_semester = f"Spring {current_year}"
    elif current_month >= 6 and current_month <= 7:
        current_semester = f"Summer {current_year}"
    else:
        current_semester = f"Fall {current_year}"
    
    prompt = f"""Generate a REALISTIC university class schedule printout.
This should look like a report from an actual registrar system, NOT a colorful poster.

CRITICAL STYLE REQUIREMENTS:
- BLACK AND WHITE ONLY - no colorful course blocks
- Table-based layout with visible grid lines
- Looks like a plain system printout, not a design
- Monospace or plain serif font
- This is a REPORT, not a poster

EXACT DOCUMENT FORMAT:

{university}
Student Class Schedule
─────────────────────────────────────────────────────────

Student: {first} {last}           ID: {student_id}
Term: {current_semester}          Printed: {current_date}

─────────────────────────────────────────────────────────
Course Code | Days | Time        | Location | Instructor
─────────────────────────────────────────────────────────
CAS CS 210  | M W  | 10:00-11:20 | SCI 201  | J. Smith
MA 225      | T R  | 09:00-10:15 | CAS 105  | L. Chen
WR 150      | M W  | 13:00-14:20 | ENG 302  | A. Brown
PY 212      | T R  | 14:00-15:15 | PHO 115  | M. Davis
PY 212L     | F    | 14:00-17:00 | PHO LAB  | Staff
─────────────────────────────────────────────────────────

Total Credits: 16.0
Enrollment Status: Full-time

CRITICAL FORMATTING:
- Use "M W" "T R" "F" for days (not full day names)
- Use 24h or AM/PM time format consistently
- Location = Building code + Room number (SCI 201, CAS 105)
- Include INSTRUCTOR column with last initial + last name
- Plain table lines, no color blocks for courses
- NO weekly grid view - just a simple table list
- Looks like it was printed from a university portal

Generate ONLY the image."""
    
    return generate_with_gemini(prompt)


def generate_multiple_documents_with_gemini(
    first: str, 
    last: str, 
    university: str, 
    birth_date: str = None,
    config: dict = None
) -> dict:
    """
    Generate multiple documents (student ID, transcript, schedule) with unified student info
    
    Returns:
        dict with keys: documents, student_id, success_count, all_success
    """
    import concurrent.futures
    import time
    
    # Generate unified student ID for all documents
    student_id = f"{random.randint(21, 25)}{random.randint(100000, 999999)}"
    birth = birth_date or "2003-05-15"
    
    print(f"[MultiDoc] Generating 3 documents for {first} {last} at {university}")
    print(f"[MultiDoc] Unified Student ID: {student_id}")
    
    documents = []
    
    # Generate all three documents with UNIFIED student_id
    def gen_id_card():
        data = generate_student_id_with_gemini(first, last, university, student_id)
        if data:
            return {"type": "id_card", "fileName": "student_id.png", "mimeType": "image/png", "data": data}
        return None
    
    def gen_transcript():
        data = generate_transcript_with_gemini(first, last, university, birth, student_id)
        if data:
            return {"type": "transcript", "fileName": "transcript.png", "mimeType": "image/png", "data": data}
        return None
    
    def gen_schedule():
        data = generate_schedule_with_gemini(first, last, university, student_id)
        if data:
            return {"type": "schedule", "fileName": "schedule.png", "mimeType": "image/png", "data": data}
        return None
    
    # Run all three generations in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(gen_id_card),
            executor.submit(gen_transcript),
            executor.submit(gen_schedule)
        ]
        
        for future in concurrent.futures.as_completed(futures):
            try:
                result = future.result()
                if result:
                    documents.append(result)
                    print(f"[MultiDoc] ✓ Generated {result['type']}")
            except Exception as e:
                print(f"[MultiDoc] Generation error: {e}")
    
    success_count = len(documents)
    print(f"[MultiDoc] Generated {success_count}/3 documents")
    
    return {
        "documents": documents,
        "studentId": student_id,
        "successCount": success_count,
        "allSuccess": success_count == 3
    }


def random_int(min_val: int, max_val: int) -> int:
    """Generate random integer in range"""
    return random.randint(min_val, max_val)


def generate_transcript_svg(first: str, last: str, university: str, birth_date: str) -> str:
    """Generate academic transcript SVG"""
    
    student_id = f"{random_int(21, 25)}{random_int(100000, 999999)}"
    gpa = round(3.2 + random.random() * 0.8, 2)
    
    # Generate courses
    courses = [
        ("Introduction to Computer Science", "A", 4),
        ("Calculus I", "A-", 4),
        ("English Composition", "B+", 3),
        ("Physics I", "A", 4),
        ("Data Structures", "A-", 3),
        ("Linear Algebra", "B+", 3),
    ]
    
    course_rows = ""
    y_pos = 340
    for course, grade, credits in courses:
        course_rows += f'''
        <text x="60" y="{y_pos}" font-size="11" fill="#333">{course}</text>
        <text x="380" y="{y_pos}" font-size="11" fill="#333" text-anchor="middle">{credits}</text>
        <text x="440" y="{y_pos}" font-size="11" fill="#333" text-anchor="middle">{grade}</text>
        '''
        y_pos += 25
    
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <defs>
        <linearGradient id="header" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#1a365d;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#2c5282;stop-opacity:1" />
        </linearGradient>
    </defs>
    
    <!-- Background -->
    <rect width="600" height="800" fill="#fafafa"/>
    
    <!-- Header -->
    <rect x="0" y="0" width="600" height="90" fill="url(#header)"/>
    
    <!-- University Name -->
    <text x="300" y="45" font-family="Georgia, serif" font-size="22" fill="white" text-anchor="middle" font-weight="bold">
        {university}
    </text>
    <text x="300" y="70" font-family="Arial, sans-serif" font-size="14" fill="white" text-anchor="middle">
        OFFICIAL ACADEMIC TRANSCRIPT
    </text>
    
    <!-- Student Information -->
    <rect x="40" y="110" width="520" height="100" fill="white" stroke="#e2e8f0" stroke-width="1" rx="4"/>
    
    <text x="60" y="140" font-family="Arial, sans-serif" font-size="12" fill="#666">Student Name:</text>
    <text x="160" y="140" font-family="Arial, sans-serif" font-size="12" fill="#333" font-weight="bold">{first} {last}</text>
    
    <text x="360" y="140" font-family="Arial, sans-serif" font-size="12" fill="#666">Student ID:</text>
    <text x="440" y="140" font-family="Arial, sans-serif" font-size="12" fill="#333" font-weight="bold">{student_id}</text>
    
    <text x="60" y="170" font-family="Arial, sans-serif" font-size="12" fill="#666">Date of Birth:</text>
    <text x="160" y="170" font-family="Arial, sans-serif" font-size="12" fill="#333" font-weight="bold">{birth_date}</text>
    
    <text x="360" y="170" font-family="Arial, sans-serif" font-size="12" fill="#666">Degree Program:</text>
    <text x="480" y="170" font-family="Arial, sans-serif" font-size="12" fill="#333" font-weight="bold">Bachelor of Science</text>
    
    <text x="60" y="200" font-family="Arial, sans-serif" font-size="12" fill="#666">Enrollment Status:</text>
    <text x="180" y="200" font-family="Arial, sans-serif" font-size="12" fill="#22c55e" font-weight="bold">Active - Full Time</text>
    
    <!-- Term Header -->
    <text x="60" y="250" font-family="Arial, sans-serif" font-size="14" fill="#1a365d" font-weight="bold">
        Fall 2025 Semester
    </text>
    
    <!-- Course Table Header -->
    <rect x="40" y="265" width="520" height="30" fill="#f1f5f9"/>
    <text x="60" y="285" font-family="Arial, sans-serif" font-size="11" fill="#475569" font-weight="bold">Course Title</text>
    <text x="380" y="285" font-family="Arial, sans-serif" font-size="11" fill="#475569" font-weight="bold" text-anchor="middle">Credits</text>
    <text x="440" y="285" font-family="Arial, sans-serif" font-size="11" fill="#475569" font-weight="bold" text-anchor="middle">Grade</text>
    
    <!-- Course Rows -->
    <rect x="40" y="295" width="520" height="200" fill="white" stroke="#e2e8f0" stroke-width="1"/>
    {course_rows}
    
    <!-- GPA Summary -->
    <rect x="40" y="510" width="520" height="60" fill="#f0fdf4" stroke="#22c55e" stroke-width="1" rx="4"/>
    <text x="60" y="540" font-family="Arial, sans-serif" font-size="14" fill="#166534" font-weight="bold">
        Cumulative GPA: {gpa}
    </text>
    <text x="60" y="560" font-family="Arial, sans-serif" font-size="11" fill="#166534">
        Credit Hours Completed: 21 | Academic Standing: Good Standing
    </text>
    
    <!-- Footer -->
    <line x1="40" y1="700" x2="200" y2="700" stroke="#333" stroke-width="1"/>
    <text x="120" y="720" font-family="Arial, sans-serif" font-size="10" fill="#666" text-anchor="middle">
        Registrar Signature
    </text>
    
    <text x="300" y="760" font-family="Arial, sans-serif" font-size="9" fill="#999" text-anchor="middle">
        This is an official document of {university}
    </text>
    <text x="300" y="775" font-family="Arial, sans-serif" font-size="8" fill="#999" text-anchor="middle">
        Issued: {int(birth_date.split('-')[0]) + 5}-01-15 | Document ID: TR-{student_id}
    </text>
</svg>'''
    
    return svg


def generate_student_id_svg(first: str, last: str, university: str) -> str:
    """Generate student ID card SVG"""
    
    student_id = f"{random_int(21, 25)}{random_int(100000, 999999)}"
    valid_thru = f"08/{random_int(2026, 2028)}"
    
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="500" height="320" viewBox="0 0 500 320">
    <defs>
        <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#1e40af;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:1" />
        </linearGradient>
    </defs>
    
    <!-- Card Background -->
    <rect width="500" height="320" rx="12" fill="url(#cardBg)"/>
    
    <!-- University Name -->
    <text x="250" y="40" font-family="Georgia, serif" font-size="20" fill="white" text-anchor="middle" font-weight="bold">
        {university}
    </text>
    <text x="250" y="60" font-family="Arial, sans-serif" font-size="11" fill="rgba(255,255,255,0.8)" text-anchor="middle">
        STUDENT IDENTIFICATION CARD
    </text>
    
    <!-- Photo Placeholder -->
    <rect x="30" y="85" width="120" height="150" rx="8" fill="white"/>
    <rect x="35" y="90" width="110" height="140" rx="6" fill="#e2e8f0"/>
    <text x="90" y="165" font-family="Arial, sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">
        PHOTO
    </text>
    
    <!-- Student Info -->
    <text x="170" y="110" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.7)">Student Name</text>
    <text x="170" y="130" font-family="Arial, sans-serif" font-size="18" fill="white" font-weight="bold">{first} {last}</text>
    
    <text x="170" y="165" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.7)">Student ID</text>
    <text x="170" y="185" font-family="Arial, sans-serif" font-size="16" fill="white" font-weight="bold">{student_id}</text>
    
    <text x="170" y="215" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.7)">Valid Through</text>
    <text x="170" y="235" font-family="Arial, sans-serif" font-size="14" fill="white">{valid_thru}</text>
    
    <!-- Status Badge -->
    <rect x="350" y="105" width="120" height="30" rx="15" fill="#22c55e"/>
    <text x="410" y="125" font-family="Arial, sans-serif" font-size="12" fill="white" text-anchor="middle" font-weight="bold">
        ACTIVE
    </text>
    
    <!-- Barcode -->
    <rect x="30" y="260" width="440" height="40" rx="4" fill="white"/>
    <text x="250" y="285" font-family="monospace" font-size="14" fill="#333" text-anchor="middle" letter-spacing="8">
        ||||| {student_id} |||||
    </text>
</svg>'''
    
    return svg


def svg_to_png(svg_content: str) -> bytes:
    """Convert SVG string to PNG bytes"""
    if HAS_CAIRO:
        try:
            png_data = cairosvg.svg2png(bytestring=svg_content.encode('utf-8'))
            return png_data
        except Exception as e:
            print(f"[DocGen] CairoSVG error: {e}")
    
    # Fallback: return SVG as-is (some systems can handle it)
    return svg_content.encode('utf-8')


def generate_document(doc_type: str, first: str, last: str, university: str, birth_date: str = None) -> Tuple[bytes, str]:
    """
    Generate verification document
    
    Priority:
    1. Gemini AI (more realistic)
    2. SVG templates (fallback)
    
    Args:
        doc_type: 'transcript', 'id_card', or 'auto'
        first: First name
        last: Last name
        university: University name
        birth_date: Birth date (optional)
    
    Returns:
        Tuple of (document bytes, filename)
    """
    if doc_type == "auto":
        doc_type = "id_card"  # Always use student ID card with portrait photo
    
    birth = birth_date or "2003-05-15"
    
    # Try Gemini AI first
    print(f"[DocGen] Trying Gemini AI for {doc_type}...")
    
    if doc_type == "transcript":
        gemini_result = generate_transcript_with_gemini(first, last, university, birth)
        filename = "transcript.png"
    else:
        gemini_result = generate_student_id_with_gemini(first, last, university)
        filename = "student_id.png"
    
    if gemini_result:
        print(f"[DocGen] ✓ Generated {doc_type} with Gemini AI: {len(gemini_result)} bytes")
        return gemini_result, filename
    
    # Fallback to SVG
    print(f"[DocGen] Gemini failed, using SVG fallback...")
    
    if doc_type == "transcript":
        svg = generate_transcript_svg(first, last, university, birth)
    else:
        svg = generate_student_id_svg(first, last, university)
    
    png_data = svg_to_png(svg)
    
    print(f"[DocGen] ✓ Generated {doc_type} with SVG: {len(png_data)} bytes")
    
    return png_data, filename
