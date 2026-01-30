"""
VSID Generator - Headless browser automation for VSID Student ID Generator
https://idgenerator-xi.vercel.app/

Supports 5 document types:
- Student ID (学生证)
- Enrollment Certificate (在读证明)
- Course Schedule (课程表)
- Admission Letter (录取通知书)
- Transcript (成绩单)
"""

import random
import string
import logging
import base64
import concurrent.futures
from datetime import datetime, timedelta
from typing import Tuple, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# VSID website URL
VSID_URL = "https://idgenerator-xi.vercel.app/"

# Document type mappings
DOCUMENT_TYPES = {
    "student_id": {
        "tab_index": 0,  # 学生证 tab
        "label": "学生证 (Student ID)",
        "sheerid_type": "id_card"
    },
    "enrollment": {
        "tab_index": 1,  # 在读证明 tab
        "label": "在读证明 (Enrollment Certificate)",
        "sheerid_type": "enrollment_verification"
    },
    "schedule": {
        "tab_index": 2,  # 课程表 tab
        "label": "课程表 (Course Schedule)",
        "sheerid_type": "class_schedule"
    },
    "admission": {
        "tab_index": 3,  # 录取通知书 tab
        "label": "录取通知书 (Admission Letter)",
        "sheerid_type": "admission_letter"
    },
    "transcript": {
        "tab_index": 4,  # 成绩单 tab
        "label": "成绩单 (Transcript)",
        "sheerid_type": "transcript"
    }
}


def generate_student_id() -> str:
    """Generate a random student ID"""
    year = random.randint(2021, 2024)
    number = random.randint(100000, 999999)
    return f"{year}{number}"


def generate_gpa() -> float:
    """Generate a realistic GPA"""
    return round(random.uniform(3.2, 3.95), 2)


def generate_birth_date() -> str:
    """Generate a birth date for a college student (18-25 years old)"""
    age = random.randint(18, 25)
    year = datetime.now().year - age
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    return f"{year}-{month:02d}-{day:02d}"


def generate_enrollment_year() -> int:
    """Generate enrollment year (1-4 years ago)"""
    return datetime.now().year - random.randint(0, 3)


def generate_valid_until() -> str:
    """Generate valid until date (1-4 years from now)"""
    years_ahead = random.randint(1, 4)
    future_date = datetime.now() + timedelta(days=365 * years_ahead)
    return future_date.strftime("%Y-%m-%d")


def get_random_major() -> str:
    """Get a random major"""
    majors = [
        "Computer Science",
        "Business Administration", 
        "Mechanical Engineering",
        "Psychology",
        "Biology",
        "Economics",
        "Mathematics",
        "Physics",
        "Chemistry",
        "Communications"
    ]
    return random.choice(majors)


def get_random_degree() -> str:
    """Get a random degree type"""
    degrees = ["Bachelor", "Master", "PhD"]
    weights = [0.7, 0.25, 0.05]
    return random.choices(degrees, weights=weights)[0]


def fill_student_id_form(page, first_name: str, last_name: str, university: str, student_data: dict):
    """Fill the Student ID form fields"""
    full_name = f"{first_name} {last_name}"
    
    # Wait for form to be ready
    page.wait_for_selector('input[placeholder*="Name" i], input[name*="name" i]', timeout=10000)
    
    # Fill student info fields
    try:
        # Name field
        name_input = page.locator('input').filter(has_text='').first
        page.fill('input[placeholder*="name" i]', full_name, timeout=3000)
    except:
        pass
    
    # Try to fill various fields with flexible selectors
    field_mappings = [
        ('input[placeholder*="Student ID" i]', student_data.get('student_id', '')),
        ('input[placeholder*="School" i], input[placeholder*="College" i]', student_data.get('school', university)),
        ('input[placeholder*="University" i]', university),
    ]
    
    for selector, value in field_mappings:
        try:
            page.fill(selector, str(value), timeout=2000)
        except:
            pass


def fill_enrollment_form(page, first_name: str, last_name: str, university: str, student_data: dict):
    """Fill the Enrollment Certificate form fields"""
    full_name = f"{first_name} {last_name}"
    
    page.wait_for_timeout(1000)
    
    # Fill fields with try-except for flexibility
    field_attempts = [
        ('input[placeholder*="Full Name" i]', full_name),
        ('input[placeholder*="Student ID" i]', student_data.get('student_id', '')),
        ('input[placeholder*="University" i], input[placeholder*="School" i]', university),
        ('input[placeholder*="Major" i]', student_data.get('major', '')),
        ('input[placeholder*="Birth" i]', student_data.get('birth_date', '')),
    ]
    
    for selector, value in field_attempts:
        try:
            page.fill(selector, str(value), timeout=2000)
        except:
            pass


def fill_schedule_form(page, first_name: str, last_name: str, university: str, student_data: dict):
    """Fill the Course Schedule form fields"""
    full_name = f"{first_name} {last_name}"
    
    page.wait_for_timeout(1000)
    
    field_attempts = [
        ('input[placeholder*="Student Name" i], input[placeholder*="Name" i]', full_name),
        ('input[placeholder*="Student ID" i]', student_data.get('student_id', '')),
        ('input[placeholder*="School" i], input[placeholder*="University" i]', university),
        ('input[placeholder*="Major" i]', student_data.get('major', '')),
        ('input[placeholder*="Department" i]', student_data.get('department', 'School of ' + student_data.get('major', 'Arts'))),
    ]
    
    for selector, value in field_attempts:
        try:
            page.fill(selector, str(value), timeout=2000)
        except:
            pass


def fill_admission_form(page, first_name: str, last_name: str, university: str, student_data: dict):
    """Fill the Admission Letter form fields"""
    full_name = f"{first_name} {last_name}"
    
    page.wait_for_timeout(1000)
    
    field_attempts = [
        ('input[placeholder*="Name" i]', full_name),
        ('input[placeholder*="Student ID" i]', student_data.get('student_id', '')),
        ('input[placeholder*="University" i]', university),
    ]
    
    for selector, value in field_attempts:
        try:
            page.fill(selector, str(value), timeout=2000)
        except:
            pass


def fill_transcript_form(page, first_name: str, last_name: str, university: str, student_data: dict):
    """Fill the Transcript form fields"""
    full_name = f"{first_name} {last_name}"
    
    page.wait_for_timeout(1000)
    
    field_attempts = [
        ('input[placeholder*="Student Name" i], input[placeholder*="Name" i]', full_name),
        ('input[placeholder*="Student ID" i]', student_data.get('student_id', '')),
        ('input[placeholder*="School" i], input[placeholder*="University" i]', university),
        ('input[placeholder*="Major" i]', student_data.get('major', '')),
        ('input[placeholder*="GPA" i]', str(student_data.get('gpa', ''))),
    ]
    
    for selector, value in field_attempts:
        try:
            page.fill(selector, str(value), timeout=2000)
        except:
            pass


def generate_vsid_document(
    doc_type: str,
    first_name: str,
    last_name: str,
    university: str = "International University",
    student_id: str = None,
    email: str = None
) -> Tuple[bytes, str, dict]:
    """
    Generate a document using VSID Generator via Playwright
    
    Args:
        doc_type: One of 'student_id', 'enrollment', 'schedule', 'admission', 'transcript'
        first_name: Student's first name
        last_name: Student's last name
        university: University name
        student_id: Optional pre-generated student ID
        email: Optional pre-generated email
        
    Returns:
        Tuple[bytes, str, dict]: (PNG image data, filename, student data dict)
    """
    if doc_type not in DOCUMENT_TYPES:
        raise ValueError(f"Unknown document type: {doc_type}. Valid types: {list(DOCUMENT_TYPES.keys())}")
    
    doc_info = DOCUMENT_TYPES[doc_type]
    
    # Generate student data
    student_data = {
        "student_id": student_id or generate_student_id(),
        "email": email or f"{first_name.lower()}.{last_name.lower()}@university.edu",
        "major": get_random_major(),
        "degree": get_random_degree(),
        "birth_date": generate_birth_date(),
        "enrollment_year": generate_enrollment_year(),
        "valid_until": generate_valid_until(),
        "gpa": generate_gpa(),
        "university": university,
        "firstName": first_name,
        "lastName": last_name,
        "fullName": f"{first_name} {last_name}"
    }
    
    def run_playwright():
        from playwright.sync_api import sync_playwright
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1400, 'height': 1000})
            page = context.new_page()
            
            # Pre-set localStorage to skip disclaimer (before navigation)
            page.add_init_script("""
                localStorage.setItem('disclaimerAccepted', 'true');
                localStorage.setItem('vsid_disclaimer_accepted', 'true');
                localStorage.setItem('disclaimer_accepted', 'true');
            """)
            
            logger.info(f"[VSID] Navigating to {VSID_URL}")
            page.goto(VSID_URL, wait_until='networkidle')
            page.wait_for_timeout(1500)  # Wait for React to load
            
            # If disclaimer still appears, use JS to bypass it instantly
            try:
                page.evaluate("""
                    // Try to close modal by clicking any visible agree button
                    const agreeBtn = document.querySelector('button[class*="bg-primary"]') || 
                                     document.querySelector('button:not(:disabled)');
                    if (agreeBtn && agreeBtn.textContent.includes('同意')) {
                        agreeBtn.disabled = false;
                        agreeBtn.click();
                    }
                    // Or forcefully remove the modal overlay
                    const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="overlay"]');
                    modals.forEach(m => m.remove());
                    // Remove any body scroll locks
                    document.body.style.overflow = 'auto';
                    document.body.style.pointerEvents = 'auto';
                """)
                page.wait_for_timeout(500)
                logger.info("[VSID] ✓ Bypassed disclaimer via JS")
            except Exception as e:
                logger.warning(f"[VSID] JS bypass: {e}")
            
            # Tab text mapping
            tab_texts = {
                "student_id": "学生证",
                "enrollment": "在读证明",
                "schedule": "课程表",
                "admission": "录取通知书",
                "transcript": "成绩单"
            }
            
            # Document types that require clicking the Preview sub-tab
            needs_preview_click = ["schedule", "admission", "transcript"]
            
            # Click the correct main tab
            tab_text = tab_texts.get(doc_type, "学生证")
            try:
                main_tab = page.locator(f'button[role="tab"]:has-text("{tab_text}")')
                if main_tab.count() > 0:
                    main_tab.first.click()
                    page.wait_for_timeout(1500)
                    logger.info(f"[VSID] Clicked main tab: {tab_text}")
            except Exception as e:
                logger.warning(f"[VSID] Could not click main tab {tab_text}: {e}")
            
            # Fill the form based on document type
            form_fillers = {
                "student_id": fill_student_id_form,
                "enrollment": fill_enrollment_form,
                "schedule": fill_schedule_form,
                "admission": fill_admission_form,
                "transcript": fill_transcript_form
            }
            
            try:
                form_fillers[doc_type](page, first_name, last_name, university, student_data)
                logger.info(f"[VSID] Filled form for {doc_type}")
            except Exception as e:
                logger.warning(f"[VSID] Form filling error: {e}")
            
            # Wait for form to update preview
            page.wait_for_timeout(1000)
            
            # For schedule/admission/transcript, click the Preview sub-tab
            if doc_type in needs_preview_click:
                try:
                    preview_button = page.locator('button[role="tab"]:has-text("预览")').first
                    if preview_button.is_visible():
                        preview_button.click()
                        page.wait_for_timeout(2000)  # Wait for preview to render
                        logger.info(f"[VSID] Clicked Preview sub-tab")
                except Exception as e:
                    logger.warning(f"[VSID] Could not click Preview sub-tab: {e}")
            
            # Wait for everything to render
            page.wait_for_timeout(1500)
            
            # Screenshot the #student-card element (used by all document types)
            screenshot_bytes = None
            try:
                student_card = page.locator('#student-card')
                if student_card.count() > 0 and student_card.first.is_visible():
                    # Wait a bit more for any animations
                    page.wait_for_timeout(500)
                    screenshot_bytes = student_card.first.screenshot(type='png')
                    logger.info(f"[VSID] Captured #student-card ({len(screenshot_bytes)} bytes)")
            except Exception as e:
                logger.warning(f"[VSID] Could not capture #student-card: {e}")
            
            # Fallback: try other selectors
            if not screenshot_bytes or len(screenshot_bytes) < 5000:
                fallback_selectors = [
                    '.flex.justify-center.p-2 > div',
                    '[class*="relative"][class*="rounded"]',
                    '.bg-white.shadow-lg',
                    'main'
                ]
                for selector in fallback_selectors:
                    try:
                        element = page.locator(selector).first
                        if element.is_visible():
                            screenshot_bytes = element.screenshot(type='png')
                            if len(screenshot_bytes) > 10000:
                                logger.info(f"[VSID] Captured with fallback selector: {selector}")
                                break
                    except:
                        continue
            
            # Last fallback: full viewport
            if not screenshot_bytes or len(screenshot_bytes) < 5000:
                screenshot_bytes = page.screenshot(type='png', full_page=False)
                logger.info("[VSID] Using full page screenshot as final fallback")
            
            browser.close()
            return screenshot_bytes
    
    try:
        logger.info(f"[VSID] Generating {doc_info['label']} for {first_name} {last_name}")
        
        # Run playwright in a separate thread to avoid asyncio conflicts
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(run_playwright)
            screenshot_bytes = future.result(timeout=60)
        
        # Generate filename
        timestamp = int(datetime.now().timestamp() * 1000)
        filename = f"vsid_{doc_type}_{first_name.lower()}_{last_name.lower()}_{timestamp}.png"
        
        logger.info(f"[VSID] ✓ Generated: {filename} ({len(screenshot_bytes)} bytes)")
        
        return screenshot_bytes, filename, student_data
        
    except ImportError:
        raise Exception("需要安装 playwright: pip install playwright && playwright install chromium")
    except Exception as e:
        logger.error(f"[VSID] 生成失败: {e}")
        raise Exception(f"VSID 生成失败: {str(e)}")


def get_available_document_types() -> list:
    """Get list of available VSID document types"""
    return [
        {
            "value": key,
            "label": info["label"],
            "sheerid_type": info["sheerid_type"]
        }
        for key, info in DOCUMENT_TYPES.items()
    ]
