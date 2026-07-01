"""
SheerID Generator - Wrapper for SheerIDVerifier document generation.

This module provides a VerifyKey-compatible interface to generate documents
using SheerIDVerifier's Pillow-based generators (class_schedule, transcript, id_card).
"""

import logging
import random
from datetime import datetime
from io import BytesIO
from typing import Tuple, Optional, Dict, Any

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

# Document dimensions
TRANSCRIPT_WIDTH = 850
TRANSCRIPT_HEIGHT = 1100
ID_CARD_WIDTH = 640
ID_CARD_HEIGHT = 400
SCHEDULE_WIDTH = 900
SCHEDULE_HEIGHT = 600

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _get_current_semester() -> tuple:
    """Get current academic semester."""
    now = datetime.now()
    month = now.month
    year = now.year
    
    if month >= 1 and month <= 5:
        return ("Spring", year)
    elif month >= 6 and month <= 7:
        return ("Summer", year)
    else:
        return ("Fall", year)


def _get_fonts():
    """Load fonts with fallback to default."""
    try:
        font_header = ImageFont.truetype("arial.ttf", 32)
        font_title = ImageFont.truetype("arial.ttf", 24)
        font_text = ImageFont.truetype("arial.ttf", 16)
        font_bold = ImageFont.truetype("arialbd.ttf", 16)
    except OSError:
        default = ImageFont.load_default()
        font_header = font_title = font_text = font_bold = default
    
    return font_header, font_title, font_text, font_bold


def _generate_student_id_number() -> str:
    """Generate random student ID."""
    return str(random.randint(10000000, 99999999))


def _generate_birth_date() -> str:
    """Generate a random birth date for college-age student."""
    year = random.randint(2000, 2006)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    return f"{year}-{month:02d}-{day:02d}"


# ============================================================================
# TRANSCRIPT GENERATION
# ============================================================================

def _generate_transcript_pillow(
    first_name: str,
    last_name: str,
    school_name: str,
    birth_date: str,
    student_id: str
) -> bytes:
    """Generate academic transcript image using Pillow."""
    w, h = TRANSCRIPT_WIDTH, TRANSCRIPT_HEIGHT
    img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    font_header, font_title, font_text, font_bold = _get_fonts()
    
    # Header
    draw.text((w // 2, 50), school_name.upper(), fill=(0, 0, 0), font=font_header, anchor="mm")
    draw.text((w // 2, 90), "OFFICIAL ACADEMIC TRANSCRIPT", fill=(50, 50, 50), font=font_title, anchor="mm")
    draw.line([(50, 110), (w - 50, 110)], fill=(0, 0, 0), width=2)
    
    # Student info
    y = 150
    draw.text((50, y), f"Student Name: {first_name} {last_name}", fill=(0, 0, 0), font=font_bold)
    draw.text((w - 300, y), f"Student ID: {student_id}", fill=(0, 0, 0), font=font_text)
    y += 30
    draw.text((50, y), f"Date of Birth: {birth_date}", fill=(0, 0, 0), font=font_text)
    draw.text((w - 300, y), f"Date Issued: {datetime.now().strftime('%Y-%m-%d')}", fill=(0, 0, 0), font=font_text)
    y += 25
    
    # Major
    majors = ["Computer Science (BS)", "Business Administration (BS)", "Engineering (BS)", 
              "Psychology (BA)", "Biology (BS)", "Economics (BA)"]
    major = random.choice(majors)
    draw.text((50, y), f"Major: {major}", fill=(0, 0, 0), font=font_text)
    y += 35
    
    # Enrollment status
    draw.rectangle([(50, y), (w - 50, y + 40)], fill=(240, 240, 240))
    draw.text((w // 2, y + 20), "CURRENT STATUS: ENROLLED", fill=(0, 100, 0), font=font_bold, anchor="mm")
    y += 60
    
    # Generate random courses
    semesters = [("Fall 2024", 6), ("Spring 2025", 5), ("Fall 2025", 5), ("Spring 2026", 4)]
    courses_data = [
        ("CS 101", "Introduction to Programming", 3, "A"),
        ("MATH 201", "Calculus II", 4, "A-"),
        ("ENGL 101", "English Composition", 3, "B+"),
        ("PHYS 101", "Physics I", 4, "A"),
        ("CS 201", "Data Structures", 3, "A"),
        ("CS 301", "Algorithms", 3, "B+"),
        ("STAT 301", "Statistics", 3, "A-"),
        ("ECON 101", "Microeconomics", 3, "B"),
        ("CS 350", "Operating Systems", 3, "A"),
        ("CS 320", "Database Systems", 3, "A-"),
    ]
    
    total_credits = 0
    random.shuffle(courses_data)
    course_idx = 0
    
    for semester_name, num_courses in semesters[:2]:  # Show 2 semesters
        if y > h - 200:
            break
            
        draw.text((50, y), semester_name, font=font_bold, fill=(0, 0, 100))
        y += 25
        
        # Table header
        draw.text((50, y), "Course", font=font_bold, fill=(0, 0, 0))
        draw.text((150, y), "Title", font=font_bold, fill=(0, 0, 0))
        draw.text((550, y), "Credits", font=font_bold, fill=(0, 0, 0))
        draw.text((650, y), "Grade", font=font_bold, fill=(0, 0, 0))
        y += 18
        draw.line([(50, y), (w - 50, y)], fill=(150, 150, 150), width=1)
        y += 8
        
        for _ in range(min(num_courses, len(courses_data) - course_idx)):
            if course_idx >= len(courses_data):
                break
            code, title, credits, grade = courses_data[course_idx]
            course_idx += 1
            total_credits += credits
            
            draw.text((50, y), code, font=font_text, fill=(0, 0, 0))
            draw.text((150, y), title[:40], font=font_text, fill=(0, 0, 0))
            draw.text((550, y), str(credits), font=font_text, fill=(0, 0, 0))
            draw.text((650, y), grade, font=font_text, fill=(0, 0, 0))
            y += 22
        
        y += 15
    
    # Summary at bottom
    y = h - 120
    draw.line([(50, y), (w - 50, y)], fill=(0, 0, 0), width=2)
    y += 20
    
    gpa = round(random.uniform(3.2, 3.9), 2)
    draw.text((50, y), f"Cumulative GPA: {gpa}", font=font_bold, fill=(0, 0, 0))
    draw.text((300, y), f"Total Credits: {total_credits}", font=font_bold, fill=(0, 0, 0))
    draw.text((550, y), "Standing: Good", font=font_bold, fill=(0, 100, 0))
    
    # Footer
    draw.text((w // 2, h - 40), "This document is electronically generated.", fill=(100, 100, 100), font=font_text, anchor="mm")
    
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ============================================================================
# STUDENT ID CARD GENERATION
# ============================================================================

def _generate_student_id_pillow(
    first_name: str,
    last_name: str,
    school_name: str,
    student_id: str
) -> bytes:
    """Generate student ID card image using Pillow."""
    w, h = ID_CARD_WIDTH, ID_CARD_HEIGHT
    
    # Random background color
    bg_color = (random.randint(240, 255), random.randint(240, 255), random.randint(240, 255))
    img = Image.new("RGB", (w, h), bg_color)
    draw = ImageDraw.Draw(img)
    
    font_header, font_title, font_text, font_bold = _get_fonts()
    
    # Header with school color
    header_color = (random.randint(0, 50), random.randint(0, 50), random.randint(50, 150))
    draw.rectangle([(0, 0), (w, 80)], fill=header_color)
    draw.text((w // 2, 40), school_name.upper()[:40], fill=(255, 255, 255), font=font_title, anchor="mm")
    
    # Photo placeholder
    draw.rectangle([(30, 100), (160, 280)], outline=(100, 100, 100), width=2, fill=(220, 220, 220))
    draw.text((95, 190), "PHOTO", fill=(150, 150, 150), font=font_text, anchor="mm")
    
    # Student info
    x_info = 190
    y = 110
    draw.text((x_info, y), f"{first_name} {last_name}", fill=(0, 0, 0), font=font_bold)
    
    y += 40
    draw.text((x_info, y), "Student ID:", fill=(100, 100, 100), font=font_text)
    draw.text((x_info + 100, y), student_id, fill=(0, 0, 0), font=font_title)
    
    y += 35
    draw.text((x_info, y), "Role:", fill=(100, 100, 100), font=font_text)
    draw.text((x_info + 100, y), "Student", fill=(0, 0, 0), font=font_title)
    
    y += 35
    draw.text((x_info, y), "Valid Thru:", fill=(100, 100, 100), font=font_text)
    draw.text((x_info + 100, y), f"05/{datetime.now().year + 1}", fill=(0, 0, 0), font=font_title)
    
    # Barcode strip
    draw.rectangle([(0, 320), (w, 380)], fill=(255, 255, 255))
    for i in range(40):
        x = 50 + i * 14
        if random.random() > 0.3:
            draw.rectangle([(x, 330), (x + 8, 370)], fill=(0, 0, 0))
    
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ============================================================================
# CLASS SCHEDULE GENERATION
# ============================================================================

def _generate_class_schedule_pillow(
    first_name: str,
    last_name: str,
    school_name: str,
    student_id: str
) -> bytes:
    """Generate class schedule image using Pillow."""
    w, h = SCHEDULE_WIDTH, SCHEDULE_HEIGHT
    img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    font_header, font_title, font_text, font_bold = _get_fonts()
    
    semester, year = _get_current_semester()
    
    # Header
    header_color = (26, 54, 93)  # Dark blue
    draw.rectangle([(0, 0), (w, 70)], fill=header_color)
    draw.text((30, 35), school_name.upper()[:50], fill=(255, 255, 255), font=font_title, anchor="lm")
    draw.text((w - 30, 35), f"{first_name} {last_name}", fill=(255, 255, 255), font=font_text, anchor="rm")
    
    # Term banner
    draw.rectangle([(0, 70), (w, 110)], fill=(232, 244, 253))
    draw.text((30, 90), f"{semester} {year} - Registered Classes", fill=(43, 108, 176), font=font_bold, anchor="lm")
    
    # Enrollment status
    y = 130
    draw.text((30, y), "My Class Schedule", fill=(0, 0, 0), font=font_bold)
    draw.rectangle([(w - 120, y - 10), (w - 20, y + 20)], fill=(198, 246, 213))
    draw.text((w - 70, y + 5), "Enrolled", fill=(39, 103, 73), font=font_text, anchor="mm")
    
    # Table header
    y = 170
    draw.rectangle([(20, y), (w - 20, y + 30)], fill=(247, 250, 252))
    cols = [30, 100, 380, 450, 550, 700]
    headers = ["Course", "Title", "Cr", "Days", "Time", "Location"]
    for i, (x, header) in enumerate(zip(cols, headers)):
        draw.text((x, y + 15), header, fill=(74, 85, 104), font=font_bold, anchor="lm")
    
    # Generate courses
    courses = [
        ("CS 301", "Data Structures and Algorithms", 3, "MWF", "9:30-10:45 AM", "Science 412"),
        ("MATH 301", "Linear Algebra", 3, "TR", "11:00-12:15 PM", "Math 201"),
        ("PHYS 202", "Physics II", 4, "MWF", "2:00-3:15 PM", "Engineering 105"),
        ("ENGL 201", "Technical Writing", 3, "MW", "4:00-5:15 PM", "Liberal Arts 301"),
        ("CS 320", "Database Systems", 3, "TR", "1:00-2:15 PM", "Tech Center 220"),
    ]
    
    y = 210
    total_credits = 0
    for code, title, credits, days, time, location in courses:
        total_credits += credits
        draw.text((cols[0], y), code, fill=(43, 108, 176), font=font_bold)
        draw.text((cols[1], y), title[:30], fill=(45, 55, 72), font=font_text)
        draw.text((cols[2], y), str(credits), fill=(45, 55, 72), font=font_text)
        draw.text((cols[3], y), days, fill=(74, 85, 104), font=font_text)
        draw.text((cols[4], y), time, fill=(74, 85, 104), font=font_text)
        draw.text((cols[5], y), location, fill=(113, 128, 150), font=font_text)
        y += 35
        draw.line([(20, y - 10), (w - 20, y - 10)], fill=(226, 232, 240), width=1)
    
    # Summary
    y = h - 80
    draw.rectangle([(20, y), (w - 20, y + 50)], fill=(247, 250, 252))
    draw.text((50, y + 25), f"Total Courses: {len(courses)}", fill=(45, 55, 72), font=font_bold, anchor="lm")
    draw.text((250, y + 25), f"Total Credits: {total_credits}", fill=(43, 108, 176), font=font_bold, anchor="lm")
    draw.text((450, y + 25), "Status: Full-Time", fill=(45, 55, 72), font=font_bold, anchor="lm")
    draw.text((650, y + 25), "Standing: Good", fill=(39, 103, 73), font=font_bold, anchor="lm")
    
    # Footer
    draw.text((w // 2, h - 15), f"Generated: {datetime.now().strftime('%B %d, %Y at %I:%M %p')}", 
              fill=(160, 174, 192), font=font_text, anchor="mm")
    
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ============================================================================
# PUBLIC API
# ============================================================================

def generate_document(
    doc_type: str,
    first_name: str,
    last_name: str,
    school_name: str,
    birth_date: str = None
) -> Tuple[bytes, str, Dict[str, Any]]:
    """
    Generate a document using SheerID-style Pillow generators.
    
    Args:
        doc_type: One of 'class_schedule', 'transcript', 'id_card'
        first_name: Student's first name
        last_name: Student's last name
        school_name: University name
        birth_date: Student's birth date (optional, auto-generated if not provided)
    
    Returns:
        Tuple of (image_bytes, filename, form_data_dict)
    """
    student_id = _generate_student_id_number()
    birth_date = birth_date or _generate_birth_date()
    
    logger.info(f"[SheerID Generator] Generating {doc_type} for {first_name} {last_name} @ {school_name}")
    
    if doc_type == "class_schedule":
        data = _generate_class_schedule_pillow(first_name, last_name, school_name, student_id)
        filename = f"schedule_{first_name.lower()}_{last_name.lower()}_{int(datetime.now().timestamp() * 1000)}.png"
    elif doc_type == "transcript":
        data = _generate_transcript_pillow(first_name, last_name, school_name, birth_date, student_id)
        filename = f"transcript_{first_name.lower()}_{last_name.lower()}_{int(datetime.now().timestamp() * 1000)}.png"
    elif doc_type == "id_card":
        data = _generate_student_id_pillow(first_name, last_name, school_name, student_id)
        filename = f"id_card_{first_name.lower()}_{last_name.lower()}_{int(datetime.now().timestamp() * 1000)}.png"
    else:
        raise ValueError(f"Unknown document type: {doc_type}. Use 'class_schedule', 'transcript', or 'id_card'")
    
    form_data = {
        "firstName": first_name,
        "lastName": last_name,
        "fullName": f"{first_name} {last_name}",
        "studentId": student_id,
        "birthDate": birth_date,
        "university": school_name,
        "docType": doc_type
    }
    
    logger.info(f"[SheerID Generator] ✓ Generated {filename} ({len(data)} bytes)")
    
    return data, filename, form_data
