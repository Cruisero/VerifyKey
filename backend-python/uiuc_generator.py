"""
UIUC i-card Generator - University of Illinois Urbana-Champaign Student ID Card
使用 HTML 模板 + Playwright 截图方式生成 UIUC 学生证

生成 University of Illinois Urbana-Champaign i-card 学生证图片。
"""
import random
import os
import base64
from datetime import datetime
from io import BytesIO
from typing import Tuple, Optional
from pathlib import Path
import logging

# 导入图像后处理模块
try:
    from image_processor import process_screenshot
    HAS_IMAGE_PROCESSOR = True
except ImportError:
    HAS_IMAGE_PROCESSOR = False

# 导入 Gemini 照片生成模块
try:
    from gemini_photo import generate_student_photo_base64, get_placeholder_photo
    HAS_GEMINI_PHOTO = True
    print("[UIUC] ✓ Gemini photo module loaded")
except ImportError as e:
    HAS_GEMINI_PHOTO = False
    print(f"[UIUC] ✗ Gemini photo module not available: {e}")
    def get_placeholder_photo():
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

logger = logging.getLogger(__name__)

# 模板路径
TEMPLATE_DIR = Path(__file__).parent / "templates" / "UIUC"

# 可用模板列表
AVAILABLE_TEMPLATES = {
    "uiuc_id_card.html": "UIUC i-card 学生证",
    "uiuc_enrollment.html": "UIUC 在读证明 (Enrollment Verification)"
}


def get_available_templates() -> list:
    """获取可用的 UIUC 模板列表"""
    templates = []
    if TEMPLATE_DIR.exists():
        for file in TEMPLATE_DIR.glob("*.html"):
            templates.append({
                "filename": file.name,
                "label": AVAILABLE_TEMPLATES.get(file.name, file.name)
            })
    return templates


def load_template(template_name: str = "uiuc_id_card.html") -> str:
    """加载指定的 HTML 模板文件"""
    template_path = TEMPLATE_DIR / template_name
    if not template_path.exists():
        # 尝试默认模板
        template_path = TEMPLATE_DIR / "uiuc_id_card.html"
        if not template_path.exists():
            logger.warning(f"[UIUC] Template not found: {template_name}")
            return None
    logger.info(f"[UIUC] Loading template: {template_path.name}")
    return template_path.read_text(encoding='utf-8')


def generate_uiu() -> str:
    """
    生成 UIU 号码
    格式: 76 + 5位随机数字
    例如: 7658324
    """
    return f"76{random.randint(10000, 99999)}"


def generate_library() -> str:
    """
    生成 Library 号码
    格式: 2 + 13位随机数字
    例如: 21412955895756
    """
    return f"2{random.randint(1000000000000, 9999999999999)}"


def generate_card() -> str:
    """
    生成 Card 号码
    格式: 563665 + 10位随机数字
    例如: 5636659558957451
    """
    return f"563665{random.randint(1000000000, 9999999999)}"


def generate_card_expires() -> str:
    """
    生成 Card Expires 日期
    格式: 2027年随机日期 (MM/DD/YYYY)
    例如: 08/31/2027
    """
    month = random.randint(1, 12)
    # 根据月份确定最大天数
    if month == 2:
        max_day = 28
    elif month in [4, 6, 9, 11]:
        max_day = 30
    else:
        max_day = 31
    day = random.randint(1, max_day)
    return f"{month:02d}/{day:02d}/2027"


def generate_uiuc_email(first_name: str, last_name: str) -> str:
    """
    生成 UIUC 邮箱
    格式: first_initial + last_name + 数字 @illinois.edu
    例如: Emily Anderson -> eanderson2@illinois.edu
    """
    first_initial = first_name[0].lower() if first_name else 'a'
    last = last_name.lower().replace(" ", "").replace("-", "")
    # 随机数字后缀（0-9或无）
    suffix = str(random.randint(2, 99)) if random.random() > 0.3 else ""
    return f"{first_initial}{last}{suffix}@illinois.edu"


def generate_class_standing() -> str:
    """
    生成学生年级
    """
    standings = ["Freshman", "Sophomore", "Junior", "Senior"]
    weights = [15, 20, 30, 35]  # Senior更常见
    return random.choices(standings, weights=weights)[0]


def generate_major() -> str:
    """
    生成随机专业 (UIUC热门专业)
    """
    majors = [
        "Computer Science",
        "Electrical Engineering",
        "Mechanical Engineering",
        "Civil Engineering",
        "Business Administration",
        "Economics",
        "Psychology",
        "Biology",
        "Chemistry",
        "Mathematics",
        "Physics",
        "Accountancy",
        "Finance",
        "Communication",
        "Political Science",
        "Statistics",
        "Data Science",
        "Information Sciences"
    ]
    return random.choice(majors)


def generate_gpa() -> str:
    """
    生成 GPA (2.5 - 4.0范围，保留两位小数)
    """
    gpa = round(random.uniform(2.5, 4.0), 2)
    return f"{gpa:.2f}"


def generate_matriculation_year() -> int:
    """
    生成入学年份 (仅 2024 或 2025)
    """
    return random.choice([2024, 2025])


def generate_html(first_name: str, last_name: str,
                  uiu: str = None, library: str = None, 
                  card: str = None, card_expires: str = None,
                  template_name: str = "uiuc_id_card.html",
                  class_standing: str = None, major: str = None,
                  gpa: str = None, matriculation_year: int = None) -> tuple:
    """
    生成 UIUC HTML (支持 i-card 和 enrollment 模板)

    Args:
        first_name: 名字
        last_name: 姓氏
        uiu: UIU 号码 (可选，不传则自动生成)
        library: Library 号码 (可选，不传则自动生成)
        card: Card 号码 (可选，不传则自动生成)
        card_expires: 过期日期 (可选，不传则自动生成)
        template_name: 模板文件名
        class_standing: 年级 (enrollment模板使用)
        major: 专业 (enrollment模板使用)
        gpa: GPA (enrollment模板使用)
        matriculation_year: 入学年份 (enrollment模板使用)

    Returns:
        tuple: (HTML 内容, 学生数据字典)
    """
    # 使用传入的值或生成新的
    uiu = uiu or generate_uiu()
    library = library or generate_library()
    card = card or generate_card()
    card_expires = card_expires or generate_card_expires()
    email = generate_uiuc_email(first_name, last_name)
    
    # Enrollment 模板专用字段
    class_standing = class_standing or generate_class_standing()
    major = major or generate_major()
    gpa = gpa or generate_gpa()
    matriculation_year = matriculation_year or generate_matriculation_year()
    
    full_name = f"{first_name} {last_name}"
    current_date = datetime.now().strftime("%B %d, %Y")  # e.g., January 26, 2026

    # 加载外部模板
    template = load_template(template_name)
    
    if template:
        # 对于 i-card 模板，加载背景图
        if "id_card" in template_name:
            bg_path = TEMPLATE_DIR / 'uiuc_bg.png'
            if bg_path.exists():
                with open(bg_path, 'rb') as f:
                    bg_base64 = base64.b64encode(f.read()).decode('utf-8')
                    template = template.replace("url('uiuc_bg.png')", f"url('data:image/png;base64,{bg_base64}')")
        
            # 使用 Gemini 生成学生照片 (仅 i-card 需要)
            photo_url = get_placeholder_photo()  # 默认占位符
            logger.info(f"[UIUC] HAS_GEMINI_PHOTO = {HAS_GEMINI_PHOTO}")
            print(f"[UIUC] HAS_GEMINI_PHOTO = {HAS_GEMINI_PHOTO}")
            
            if HAS_GEMINI_PHOTO:
                try:
                    logger.info(f"[UIUC] Generating student photo with Gemini for {first_name} {last_name}...")
                    print(f"[UIUC] Generating student photo with Gemini for {first_name} {last_name}...")
                    generated_photo = generate_student_photo_base64(first_name, last_name)
                    if generated_photo:
                        photo_url = generated_photo
                        logger.info(f"[UIUC] ✓ Generated Gemini photo (length: {len(generated_photo)})")
                        print(f"[UIUC] ✓ Generated Gemini photo")
                    else:
                        logger.warning(f"[UIUC] Gemini photo generation returned None, using placeholder")
                        print(f"[UIUC] Gemini photo generation returned None")
                except Exception as photo_err:
                    logger.warning(f"[UIUC] Photo generation error: {photo_err}")
                    print(f"[UIUC] Photo generation error: {photo_err}")
            else:
                logger.info(f"[UIUC] Skipping Gemini photo (module not available)")
                print(f"[UIUC] Skipping Gemini photo (module not available)")
            
            # i-card 模板占位符
            html = template.replace('{{photo}}', photo_url)
            html = html.replace('{{first_name}}', first_name.upper())
            html = html.replace('{{last_name}}', last_name.upper())
        else:
            # enrollment 模板不需要照片
            html = template
        
        # 通用占位符 (所有模板都可能使用)
        html = html.replace('{{full_name}}', full_name)
        html = html.replace('{{uiu}}', uiu)
        html = html.replace('{{library}}', library)
        html = html.replace('{{card}}', card)
        html = html.replace('{{card_expires}}', card_expires)
        html = html.replace('{{email}}', email)
        
        # Enrollment 模板专用占位符
        html = html.replace('{{date}}', current_date)
        html = html.replace('{{class_standing}}', class_standing)
        html = html.replace('{{major}}', major)
        html = html.replace('{{gpa}}', gpa)
        html = html.replace('{{matriculation_year}}', str(matriculation_year))
    else:
        raise Exception(f"[UIUC] Template not found: {template_name}")

    # 返回学生数据字典
    student_data = {
        "uiu": uiu,
        "library": library,
        "card": card,
        "card_expires": card_expires,
        "email": email,
        "class_standing": class_standing,
        "major": major,
        "gpa": gpa,
        "matriculation_year": matriculation_year,
        "fullName": full_name,
        "firstName": first_name,
        "lastName": last_name,
        "university": "University of Illinois Urbana-Champaign"
    }

    return html, student_data


def generate_uiuc_image(first_name: str, last_name: str,
                        template_name: str = "uiuc_id_card.html",
                        uiu: str = None, library: str = None,
                        card: str = None, card_expires: str = None,
                        class_standing: str = None, major: str = None,
                        gpa: str = None, matriculation_year: int = None) -> Tuple[bytes, str, dict]:
    """
    生成 UIUC 文档截图 PNG

    Args:
        first_name: 名字
        last_name: 姓氏
        template_name: 模板文件名
        uiu: UIU 号码 (可选，不传则自动生成)
        library: Library 号码 (可选，不传则自动生成)
        card: Card 号码 (可选，不传则自动生成)
        card_expires: 过期日期 (可选，不传则自动生成)
        class_standing: 年级 (enrollment模板使用)
        major: 专业 (enrollment模板使用)
        gpa: GPA (enrollment模板使用)
        matriculation_year: 入学年份 (enrollment模板使用)

    Returns:
        Tuple[bytes, str, dict]: (PNG 图片数据, 文件名, 学生数据字典)
    """
    try:
        import concurrent.futures
        
        def run_playwright():
            from playwright.sync_api import sync_playwright
            
            # 生成 HTML 和学生数据
            html_content, student_data = generate_html(
                first_name, last_name, uiu, library, card, card_expires, 
                template_name, class_standing, major, gpa, matriculation_year
            )
            
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                
                # 根据模板类型设置不同的视口大小
                if "enrollment" in template_name:
                    # 信函大小 (Letter: 8.5 x 11 英寸 @ 96 DPI)
                    page = browser.new_page(viewport={'width': 900, 'height': 1200})
                else:
                    # ID 卡片大小
                    page = browser.new_page(viewport={'width': 1100, 'height': 700})
                
                page.set_content(html_content, wait_until='load')
                page.wait_for_timeout(500)  # 等待样式加载
                
                # 截取相应元素
                if "enrollment" in template_name:
                    letter_element = page.locator('.letter-container')
                    if letter_element.count() > 0:
                        screenshot_bytes = letter_element.screenshot(type='png')
                    else:
                        screenshot_bytes = page.screenshot(type='png', full_page=True)
                else:
                    card_element = page.locator('.id-card')
                    if card_element.count() > 0:
                        screenshot_bytes = card_element.screenshot(type='png')
                    else:
                        screenshot_bytes = page.screenshot(type='png', full_page=False)
                
                browser.close()
            
            return screenshot_bytes, student_data
        
        logger.info(f"[UIUC] Generating document for {first_name} {last_name} with template {template_name}")
        
        # Run playwright in a separate thread to avoid asyncio loop conflict
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(run_playwright)
            screenshot_bytes, student_data = future.result(timeout=60)  # 增加超时，因为需要生成照片
        
        # 应用图像后处理（仅对 id_card 应用，enrollment 保持清晰）
        if HAS_IMAGE_PROCESSOR and "id_card" in template_name:
            try:
                screenshot_bytes = process_screenshot(screenshot_bytes, aggressive=False)
                logger.info("[UIUC] ✓ Applied realistic image effects")
            except Exception as proc_err:
                logger.warning(f"[UIUC] Image processing failed, using original: {proc_err}")

        # 生成文件名 - 使用随机 ID 代替姓名
        import string
        random_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        doc_type = "enrollment_verification" if "enrollment" in template_name else "student_id"
        filename = f"uiuc_{doc_type}_{random_id}.png"
        logger.info(f"[UIUC] ✓ Generated: {filename} ({len(screenshot_bytes)} bytes)")
        
        return screenshot_bytes, filename, student_data

    except ImportError:
        raise Exception("需要安装 playwright: pip install playwright && playwright install chromium")
    except Exception as e:
        logger.error(f"[UIUC] 生成图片失败: {e}")
        raise Exception(f"生成图片失败: {str(e)}")


def generate_document(first_name: str, last_name: str, **kwargs) -> Tuple[Optional[bytes], str]:
    """
    VerifyKey 兼容接口 - 生成 UIUC 文档
    
    Args:
        first_name: 名字
        last_name: 姓氏
        **kwargs: 其他参数（忽略）
    
    Returns:
        Tuple[bytes, str]: (图片数据, 文件名)
    """
    img_data, filename, _ = generate_uiuc_image(first_name, last_name)
    return img_data, filename


# 测试代码
if __name__ == '__main__':
    import sys
    import io

    # 修复 Windows 控制台编码问题
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

    print("测试 UIUC i-card 图片生成...")

    first_name = "Charlotte"
    last_name = "Blair"

    print(f"姓名: {first_name} {last_name}")
    print(f"UIU: {generate_uiu()}")
    print(f"Library: {generate_library()}")
    print(f"Card: {generate_card()}")
    print(f"Card Expires: {generate_card_expires()}")
    print(f"邮箱: {generate_uiuc_email(first_name, last_name)}")

    try:
        img_data, filename, student_data = generate_uiuc_image(first_name, last_name)

        # 保存测试图片
        with open('test_uiuc.png', 'wb') as f:
            f.write(img_data)

        print(f"✓ 图片生成成功! 大小: {len(img_data)} bytes")
        print(f"✓ 已保存为 test_uiuc.png")
        print(f"✓ 学生数据: {student_data}")

    except Exception as e:
        print(f"✗ 错误: {e}")
