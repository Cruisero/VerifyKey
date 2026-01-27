"""
Puppeteer-based Student ID Card Generator
Uses Puppeteer to render HTML template and generate high-quality student ID cards

This module:
1. Generates student photo using Gemini AI
2. Renders the HTML template with Puppeteer
3. Saves form data along with the generated document
"""

import subprocess
import json
import os
import base64
from typing import Optional, Tuple, Dict
from pathlib import Path
import random
import datetime
try:
    import piexif
except ImportError:
    piexif = None

# Path to the Node.js generator script
# In Docker: /tools/generate-student-id.js
# Local: ../tools/generate-student-id.js
DOCKER_TOOLS_PATH = Path("/tools")
LOCAL_TOOLS_PATH = Path(__file__).parent.parent / "tools"
GENERATOR_SCRIPT = DOCKER_TOOLS_PATH / "generate-student-id.js" if DOCKER_TOOLS_PATH.exists() else LOCAL_TOOLS_PATH / "generate-student-id.js"

# Output directory for generated cards
# In Docker: /output
# Local: ../output
DOCKER_OUTPUT_PATH = Path("/output")
LOCAL_OUTPUT_PATH = Path(__file__).parent.parent / "output"
OUTPUT_DIR = DOCKER_OUTPUT_PATH if DOCKER_OUTPUT_PATH.exists() else LOCAL_OUTPUT_PATH


def inject_realistic_exif(image_path: Path):
    """
    Inject realistic camera EXIF metadata into the image
    to bypass fraud detection systems.
    """
    if not piexif:
        print("[PuppeteerGen] Warning: piexif module not found, skipping EXIF injection")
        return

    try:
        # Realistic camera models
        cameras = [
            {"make": "Apple", "model": "iPhone 13", "software": "15.4.1"},
            {"make": "Apple", "model": "iPhone 14 Pro", "software": "16.2"},
            {"make": "Samsung", "model": "SM-G991B", "software": "G991BXXU3AUGM"},  # S21
            {"make": "Google", "model": "Pixel 6", "software": "Android 13"},
            {"make": "OnePlus", "model": "KB2003", "software": "Oxygen OS 11.0.1.1"}
        ]
        
        cam = random.choice(cameras)
        
        # DateTime
        now = datetime.datetime.now()
        dt_str = now.strftime("%Y:%m:%d %H:%M:%S")
        
        # 0th IFD
        zeroth_ifd = {
            piexif.ImageIFD.Make: cam["make"],
            piexif.ImageIFD.Model: cam["model"],
            piexif.ImageIFD.Software: cam["software"],
            piexif.ImageIFD.DateTime: dt_str,
            piexif.ImageIFD.Orientation: 1,
            piexif.ImageIFD.XResolution: (72, 1),
            piexif.ImageIFD.YResolution: (72, 1),
        }
        
        # Exif IFD
        exif_ifd = {
            piexif.ExifIFD.DateTimeOriginal: dt_str,
            piexif.ExifIFD.DateTimeDigitized: dt_str,
            piexif.ExifIFD.ExposureProgram: 2,  # Normal program
            piexif.ExifIFD.ISOSpeedRatings: random.choice([50, 80, 100, 125, 200]),
            piexif.ExifIFD.ExifVersion: b"0232",
            piexif.ExifIFD.ColorSpace: 1,  # sRGB
            piexif.ExifIFD.PixelXDimension: 1000, # Placeholder, will be updated by piexif? No, just metadata
            piexif.ExifIFD.PixelYDimension: 1000,
        }
        
        # GPS (Optional - let's add random US university locations or just generic ones?)
        # For now, let's skip GPS to avoid inconsistency if address is vastly different
        
        exif_dict = {"0th": zeroth_ifd, "Exif": exif_ifd}
        exif_bytes = piexif.dump(exif_dict)
        
        piexif.insert(exif_bytes, str(image_path))
        print(f"[PuppeteerGen] ✓ Injected realistic EXIF: {cam['make']} {cam['model']}")
        
    except Exception as e:
        print(f"[PuppeteerGen] Failed to inject EXIF: {e}")




def generate_international_address(country: str = "US") -> str:
    """Generate a realistic looking address for a specific country"""
    number = random.randint(10, 9999)
    
    if country == "US":
        streets = ["University Ave", "College Blvd", "Main St", "Broadway", "Park Ave"]
        cities = ["College Town", "Springfield", "Riverside", "Franklin", "Clinton"]
        state = random.choice(["CA", "NY", "TX", "FL", "IL", "PA", "OH", "GA"])
        return f"{number} {random.choice(streets)}, {random.choice(cities)}, {state}"
        
    elif country in ["GB", "IE", "AU", "NZ", "CA"]: # English speaking
        streets = ["High St", "Station Rd", "Victoria St", "Church Ln", "Main St"]
        cities = ["London", "Manchester", "Bristol", "Oxford", "Cambridge"] if country == "GB" else ["Sydney", "Melbourne", "Toronto", "Vancouver"]
        postcode = f"{random.choice(['CB', 'OX', 'SW', 'M', 'L'])}{random.randint(1, 20)} {random.randint(1, 9)}{random.choice(['A', 'B', 'C'])}{random.choice(['A', 'B', 'C'])}"
        return f"{number} {random.choice(streets)}, {random.choice(cities)}, {postcode}"
        
    elif country in ["FR", "BE", "CH"]: # French
        streets = ["Rue de la Paix", "Avenue de la République", "Boulevard Saint-Michel", "Rue des Écoles"]
        cities = ["Paris", "Lyon", "Marseille", "Toulouse", "Nice"]
        zipcode = random.randint(10000, 99000)
        return f"{number} {random.choice(streets)}, {zipcode} {random.choice(cities)}"
        
    elif country in ["DE", "AT"]: # German
        streets = ["Hauptstraße", "Bahnhofstraße", "Schulstraße", "Gartenstraße"]
        cities = ["Berlin", "München", "Hamburg", "Köln", "Frankfurt"]
        zipcode = random.randint(10000, 99999)
        return f"{random.choice(streets)} {number}, {zipcode} {random.choice(cities)}"
        
    elif country in ["ES", "MX", "AR", "CL", "CO", "PE"]: # Spanish
        streets = ["Calle Mayor", "Avenida de la Constitución", "Plaza de España", "Calle Real"]
        cities = ["Madrid", "Barcelona", "Valencia", "Sevilla"] if country == "ES" else ["Buenos Aires", "Santiago", "Bogotá", "Lima"]
        return f"{random.choice(streets)} {number}, {random.randint(1000, 9999)} {random.choice(cities)}"
        
    elif country == "IL": # Israel
        streets = ["Ben Yehuda St", "Dizengoff St", "Rothschild Blvd", "King George St"]
        cities = ["Tel Aviv", "Jerusalem", "Haifa", "Rishon LeZion"]
        return f"{number} {random.choice(streets)}, {random.choice(cities)}"
        
    elif country in ["JP", "KR", "CN", "TW", "HK"]: # East Asia (English format often used in intl docs)
        cities = ["Tokyo", "Seoul", "Beijing", "Taipei"]
        districts = ["Central", "North", "South", "West"]
        return f"{number} {random.choice(districts)} District, {random.choice(cities)}"
        
    else: # Generic International
        return f"{number} University Road, Campus City, {country}"


def generate_student_id_puppeteer(
    first: str,
    last: str,
    university: str,
    country: str = "US",
    birth_date: str = None,
    student_id: str = None,
    phone: str = None,
    address: str = None,
    academic_year: str = None,
    gender: str = "any",
    photo_path: str = None,
    save_form_data: bool = True,
    template: str = None
) -> Tuple[Optional[bytes], Optional[str], Optional[Dict]]:
    """
    Generate student ID card using Puppeteer HTML template renderer
    
    Args:
        first: First name
        last: Last name
        university: University name
        country: Country code (2-letter ISO)
        birth_date: Birth date (e.g., "March 15, 2002")
        student_id: Student ID number
        phone: Phone number
        address: Address
        academic_year: Academic year (e.g., "2026")
        gender: Gender for photo generation ("male", "female", or "any")
        photo_path: Optional path to photo file
        save_form_data: Whether to save form data alongside the image
    
    Returns:
        Tuple of (image_bytes, filename, form_data_dict)
    """
    import time
    import random
    
    # Generate default values if not provided
    if not birth_date:
        year = 2000 + random.randint(0, 5)
        months = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"]
        month = random.choice(months)
        day = random.randint(1, 28)
        birth_date = f"{month} {day}, {year}"
    
    if not student_id:
        prefix = 20 + random.randint(0, 5)
        number = random.randint(100000, 999999)
        student_id = f"{prefix}-{number}"
    
    if not phone:
        if country == "US" or country == "CA":
            phone = f"+1 {random.randint(200, 999)}-{random.randint(100, 999)}-{random.randint(1000, 9999)}"
        else:
            phone = f"+{random.randint(20, 99)} {random.randint(100, 999)}-{random.randint(1000, 9999)}"
    
    if not address:
        address = generate_international_address(country)
    
    if not academic_year:
        academic_year = str(int(time.strftime("%Y")) + 1)
    
    # Full name for the card
    full_name = f"{first.upper()} {last.upper()}"
    
    # Generate unique output filename
    timestamp = int(time.time() * 1000)
    safe_name = f"{first}_{last}".lower().replace(" ", "_")
    output_filename = f"id_{safe_name}_{timestamp}.jpg"
    output_path = OUTPUT_DIR / output_filename
    
    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Build command arguments
    cmd = [
        "node",
        str(GENERATOR_SCRIPT),
        f"--name={full_name}",
        f"--university={university}",
        f"--id={student_id}",
        f"--dob={birth_date}",
        f"--phone={phone}",
        f"--address={address}",
        f"--year={academic_year}",
        f"--gender={gender}",
        f"--output={output_path}",
        "--format=jpeg",
        "--quality=95"
    ]
    
    # Add template if specified
    if template:
        cmd.append(f"--template={template}")
        print(f"[PuppeteerGen] Using template: {template}")
    
    if photo_path:
        cmd.append(f"--photo={photo_path}")
    
    print(f"[PuppeteerGen] Running: node generate-student-id.js")
    print(f"[PuppeteerGen] Student: {full_name} @ {university}")
    
    try:
        # Get Gemini API Key from config for photo generation
        import config_manager
        config = config_manager.get_config()
        gemini_api_key = config.get("aiGenerator", {}).get("gemini", {}).get("apiKey", "")
        gemini_model = config.get("aiGenerator", {}).get("gemini", {}).get("model", "gemini-2.0-flash-exp-image-generation")
        
        # Prepare environment with Gemini API Key
        import os
        env = os.environ.copy()
        if gemini_api_key:
            env["GEMINI_API_KEY"] = gemini_api_key
            env["GEMINI_MODEL"] = gemini_model
            print(f"[PuppeteerGen] Using Gemini API Key for photo generation")
        else:
            print(f"[PuppeteerGen] No Gemini API Key, will use fallback photos")
        
        # Run the Node.js script
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout for Gemini API photo/logo generation
            cwd=str(GENERATOR_SCRIPT.parent),
            env=env
        )
        
        if result.returncode != 0:
            print(f"[PuppeteerGen] Error: {result.stderr}")
            return None, None, None
        
        print(f"[PuppeteerGen] Output: {result.stdout[-500:] if len(result.stdout) > 500 else result.stdout}")
        
        # Read the generated image
        if not output_path.exists():
            print(f"[PuppeteerGen] Output file not found: {output_path}")
            return None, None, None
        
        # Inject EXIF metadata before reading
        inject_realistic_exif(output_path)
        
        with open(output_path, 'rb') as f:
            image_bytes = f.read()
        
        print(f"[PuppeteerGen] ✓ Generated: {output_filename} ({len(image_bytes)} bytes)")
        
        # Prepare form data
        form_data = {
            "firstName": first,
            "lastName": last,
            "fullName": full_name,
            "university": university,
            "studentId": student_id,
            "birthDate": birth_date,
            "phone": phone,
            "address": address,
            "academicYear": academic_year,
            "gender": gender,
            "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "outputFile": str(output_path)
        }
        
        # Save form data if requested
        if save_form_data:
            form_data_path = output_path.with_suffix('.json')
            with open(form_data_path, 'w') as f:
                json.dump(form_data, f, indent=2)
            print(f"[PuppeteerGen] ✓ Form data saved: {form_data_path.name}")
        
        return image_bytes, output_filename, form_data
        
    except subprocess.TimeoutExpired:
        print("[PuppeteerGen] Timeout - generation took too long")
        return None, None, None
    except Exception as e:
        print(f"[PuppeteerGen] Exception: {e}")
        return None, None, None


def generate_document_puppeteer(
    doc_type: str,
    first: str,
    last: str,
    university: str,
    country: str = "US",
    birth_date: str = None,
    gender: str = "any",
    template: str = "student-id-generator.html",
    use_gemini_photo: bool = True
) -> Tuple[bytes, str, Dict]:
    """
    Generate verification document using Puppeteer
    
    This is a drop-in replacement for doc_generator.generate_document
    that uses Puppeteer-based HTML template rendering.
    
    Args:
        doc_type: 'id_card' or 'auto' (both generate ID card)
        first: First name
        last: Last name
        university: University name
        country: Country code (2-letter ISO)
        birth_date: Birth date (optional)
        gender: Gender for photo ("male", "female", "any")
        template: HTML template filename to use
        use_gemini_photo: Whether to use Gemini AI for photo generation
    
    Returns:
        Tuple of (document bytes, filename, form_data dict)
    """
    print(f"[DocGen-Puppeteer] Generating student ID card for {first} {last}...")
    print(f"[DocGen-Puppeteer] Template: {template}, Use Gemini Photo: {use_gemini_photo}")
    
    image_bytes, filename, form_data = generate_student_id_puppeteer(
        first=first,
        last=last,
        university=university,
        country=country,
        birth_date=birth_date,
        gender=gender,
        save_form_data=True,
        template=template
    )
    
    if image_bytes:
        print(f"[DocGen-Puppeteer] ✓ Generated: {filename} ({len(image_bytes)} bytes)")
        return image_bytes, filename, form_data
    else:
        print("[DocGen-Puppeteer] ✗ Failed to generate document")
        # Return empty tuple to indicate failure
        return None, None, None


# Test function
if __name__ == "__main__":
    print("\n🎓 Testing Puppeteer Student ID Generator\n")
    
    # Test generation
    image_bytes, filename, form_data = generate_student_id_puppeteer(
        first="Emily",
        last="Johnson",
        university="Stanford University",
        gender="female"
    )
    
    if image_bytes:
        print(f"\n✅ Success!")
        print(f"   File: {filename}")
        print(f"   Size: {len(image_bytes)} bytes")
        print(f"   Form Data: {json.dumps(form_data, indent=2)}")
    else:
        print("\n❌ Failed to generate")
