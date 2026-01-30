"""
LionPATH Schedule Generator - Penn State Student Portal Screenshot
移植自 tgbot-verify 项目，使用外部 HTML 模板 + Playwright 截图方式

生成 Penn State LionPATH 学生课程表截图，作为 VerifyKey 的备选验证文档类型。
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
except ImportError:
    HAS_GEMINI_PHOTO = False
    def get_placeholder_photo():
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

logger = logging.getLogger(__name__)

# 模板路径
TEMPLATE_DIR = Path(__file__).parent / "templates" / "LionPATH"

# 可用模板列表
AVAILABLE_TEMPLATES = {
    "schedule.html": "经典风格 (Student Center)",
    "schedule_modern.html": "现代风格 (卡片式)",
    "schedule_calendar.html": "日历视图 (周课表)",
    "enrollment_verification.html": "注册验证",
    "schedule_browser.html": "浏览器截图 (SheerID推荐)",
    "psu_id_card.html": "PSU学生证 (ID Card)"
}


def get_available_templates() -> list:
    """获取可用的 LionPATH 模板列表"""
    templates = []
    if TEMPLATE_DIR.exists():
        for file in TEMPLATE_DIR.glob("*.html"):
            templates.append({
                "filename": file.name,
                "label": AVAILABLE_TEMPLATES.get(file.name, file.name)
            })
    return templates


def load_template(template_name: str = "schedule.html") -> str:
    """加载指定的 HTML 模板文件"""
    template_path = TEMPLATE_DIR / template_name
    if not template_path.exists():
        # 尝试默认模板
        template_path = TEMPLATE_DIR / "schedule.html"
        if not template_path.exists():
            logger.warning(f"[LionPATH] Template not found, using fallback")
            return None
    logger.info(f"[LionPATH] Loading template: {template_path.name}")
    return template_path.read_text(encoding='utf-8')


def generate_psu_id() -> str:
    """生成随机 PSU ID (9位数字)"""
    return f"9{random.randint(10000000, 99999999)}"


def generate_psu_email(first_name: str, last_name: str) -> str:
    """
    生成 PSU 邮箱
    格式: 3个字母 + 4个数字 @psu.edu
    例如: rvb6089@psu.edu
    """
    import string
    # 3个随机小写字母
    letters = ''.join(random.choices(string.ascii_lowercase, k=3))
    # 4个随机数字
    digits = ''.join([str(random.randint(0, 9)) for _ in range(4)])
    email = f"{letters}{digits}@psu.edu"
    return email


def generate_html(first_name: str, last_name: str, school_id: str = '2565', 
                  psu_id: str = None, email: str = None,
                  template_name: str = "schedule.html") -> tuple:
    """
    生成 Penn State LionPATH HTML

    Args:
        first_name: 名字
        last_name: 姓氏
        school_id: 学校 ID
        psu_id: PSU ID (可选，不传则自动生成)
        email: 邮箱 (可选，不传则自动生成)
        template_name: 模板文件名

    Returns:
        tuple: (HTML 内容, PSU ID, email, major)
    """
    # 使用传入的 ID/email 或生成新的
    psu_id = psu_id or generate_psu_id()
    email = email or generate_psu_email(first_name, last_name)
    name = f"{first_name} {last_name}"
    date = datetime.now().strftime('%m/%d/%Y, %I:%M:%S %p')

    # 随机选择专业
    majors = [
        'Computer Science (BS)',
        'Software Engineering (BS)',
        'Information Sciences and Technology (BS)',
        'Data Science (BS)',
        'Electrical Engineering (BS)',
        'Mechanical Engineering (BS)',
        'Business Administration (BS)',
        'Psychology (BA)',
        'Economics (BS)',
        'Finance (BS)',
        'Marketing (BS)',
        'Biology (BS)',
        'Chemistry (BS)',
        'Physics (BS)',
    ]
    major = random.choice(majors)

    # 动态生成学期信息
    now = datetime.now()
    year = now.year
    month = now.month
    
    if 1 <= month <= 5:
        term = "Spring"
        term_dates = f"(Jan 12 - May 8)"  # Penn State 2026 official calendar
    elif 6 <= month <= 7:
        term = "Summer"
        term_dates = f"(May 18 - Aug 7)"  # Penn State 2026 official calendar
    else:
        term = "Fall"
        term_dates = f"(Aug 24 - Dec 11)"  # Penn State 2026 official calendar
    
    term_display = f"{term} {year}"

    # 根据模板选择生成课程格式
    is_modern = 'modern' in template_name.lower()
    is_calendar = 'calendar' in template_name.lower()
    is_enrollment = 'enrollment' in template_name.lower()
    
    # 生成 verification_date (当前日期，格式: January 30, 2026)
    verification_date = datetime.now().strftime("%B %d, %Y")
    
    # 生成 class standing
    class_standings = ['Freshman', 'Sophomore', 'Junior', 'Senior']
    class_standing = random.choice(class_standings)
    
    if is_calendar:
        calendar_grid, courses_data, total_units = generate_calendar_grid()
        course_count = len(courses_data)
        courses = ''  # Not used in calendar view
    elif is_enrollment:
        # 使用表格格式课程 for enrollment verification
        # 返回包含匹配的专业和年级信息
        courses, total_units, major, class_standing = generate_table_format_courses()
        calendar_grid = ''
        course_count = 0
    elif 'browser' in template_name.lower():
        # 浏览器截图模板 - 使用 Oracle PeopleSoft 风格
        courses, total_units, major, class_standing = generate_browser_format_courses()
        calendar_grid = ''
        course_count = 0
    else:
        courses, total_units = generate_random_courses(modern_format=is_modern)
        calendar_grid = ''
        course_count = 0

    # 加载外部模板
    template = load_template(template_name)
    if template:
        # 使用简单字符串替换
        html = template.replace('{{name}}', name)
        html = html.replace('{{psu_id}}', psu_id)
        html = html.replace('{{major}}', major)
        html = html.replace('{{term_display}}', term_display)
        html = html.replace('{{term_dates}}', term_dates)
        html = html.replace('{{date}}', date)
        html = html.replace('{{year}}', str(year))
        html = html.replace('{{courses}}', courses)
        html = html.replace('{{total_units}}', str(total_units))
        html = html.replace('{{calendar_grid}}', calendar_grid)
        html = html.replace('{{course_count}}', str(course_count))
        html = html.replace('{{verification_date}}', verification_date)
        html = html.replace('{{class_standing}}', class_standing)
        
        # 加载 PSU logo 并转换为 base64 (用于 enrollment_verification 和 browser 模板)
        if is_enrollment or 'browser' in template_name.lower():
            logo_path = TEMPLATE_DIR / 'psu_logo.png'
            if logo_path.exists():
                with open(logo_path, 'rb') as f:
                    logo_base64 = base64.b64encode(f.read()).decode('utf-8')
                    html = html.replace('{{psu_logo}}', f'data:image/png;base64,{logo_base64}')
        
        # PSU ID Card 模板特殊处理
        if 'id_card' in template_name.lower():
            # 加载卡片背景图，替换相对路径为 base64 (Playwright 兼容)
            card_bg_path = TEMPLATE_DIR / 'psu_id_card_bg.png'
            if card_bg_path.exists():
                with open(card_bg_path, 'rb') as f:
                    bg_base64 = base64.b64encode(f.read()).decode('utf-8')
                    # 替换相对路径为 base64
                    html = html.replace("url('psu_id_card_bg.png')", f"url('data:image/png;base64,{bg_base64}')")
            
            # 替换 ID Card 特有的占位符
            html = html.replace('{{first_name}}', first_name.upper())
            html = html.replace('{{last_name}}', last_name.upper())
            
            # 格式化 PSU ID: 9 1234 5678
            formatted_id = f"{psu_id[0]} {psu_id[1:5]} {psu_id[5:]}"
            html = html.replace('{{psu_id}}', formatted_id)
            
            # 签发日期
            issued_date = datetime.now().strftime('%Y-%m-%d')
            html = html.replace('{{issued_date}}', issued_date)
            
            # 使用 Gemini 生成学生照片
            photo_url = get_placeholder_photo()  # 默认占位符
            if HAS_GEMINI_PHOTO:
                try:
                    logger.info(f"[LionPATH] Generating student photo with Gemini...")
                    generated_photo = generate_student_photo_base64(first_name, last_name)
                    if generated_photo:
                        photo_url = generated_photo
                        logger.info(f"[LionPATH] ✓ Generated Gemini photo")
                    else:
                        logger.warning(f"[LionPATH] Gemini photo generation failed, using placeholder")
                except Exception as photo_err:
                    logger.warning(f"[LionPATH] Photo generation error: {photo_err}")
            
            html = html.replace('{{photo}}', photo_url)
    else:
        # 回退到内联模板 (保留原始代码以防模板文件丢失)
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LionPATH - Student Home</title>
    <style>
        :root {{
            --psu-blue: #1E407C; /* Penn State Nittany Navy */
            --psu-light-blue: #96BEE6;
            --bg-gray: #f4f4f4;
            --text-color: #333;
        }}

        body {{
            font-family: "Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif;
            background-color: #e0e0e0; /* 浏览器背景 */
            margin: 0;
            padding: 20px;
            color: var(--text-color);
            display: flex;
            justify-content: center;
        }}

        /* 模拟浏览器窗口 */
        .viewport {{
            width: 100%;
            max-width: 1100px;
            background-color: #fff;
            box-shadow: 0 5px 20px rgba(0,0,0,0.15);
            min-height: 800px;
            display: flex;
            flex-direction: column;
        }}

        /* 顶部导航栏 LionPATH */
        .header {{
            background-color: var(--psu-blue);
            color: white;
            padding: 0 20px;
            height: 60px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }}

        .brand {{
            display: flex;
            align-items: center;
            gap: 15px;
        }}

        /* PSU Logo 模拟 */
        .psu-logo {{
            font-family: "Georgia", serif;
            font-size: 20px;
            font-weight: bold;
            letter-spacing: 1px;
            border-right: 1px solid rgba(255,255,255,0.3);
            padding-right: 15px;
        }}

        .system-name {{
            font-size: 18px;
            font-weight: 300;
        }}

        .user-menu {{
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 20px;
        }}

        .nav-bar {{
            background-color: #f8f8f8;
            border-bottom: 1px solid #ddd;
            padding: 10px 20px;
            font-size: 13px;
            color: #666;
            display: flex;
            gap: 20px;
        }}
        .nav-item {{ cursor: pointer; }}
        .nav-item.active {{ color: var(--psu-blue); font-weight: bold; border-bottom: 2px solid var(--psu-blue); padding-bottom: 8px; }}

        /* 主内容区 */
        .content {{
            padding: 30px;
            flex: 1;
        }}

        .page-header {{
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 20px;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        }}

        .page-title {{
            font-size: 24px;
            color: var(--psu-blue);
            margin: 0;
        }}

        .term-selector {{
            background: #fff;
            border: 1px solid #ccc;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 14px;
            color: #333;
            font-weight: bold;
        }}

        /* 学生信息卡片 */
        .student-card {{
            background: #fcfcfc;
            border: 1px solid #e0e0e0;
            padding: 15px;
            margin-bottom: 25px;
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            font-size: 13px;
        }}
        .info-label {{ color: #777; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }}
        .info-val {{ font-weight: bold; color: #333; font-size: 14px; }}
        .status-badge {{
            background-color: #e6fffa; color: #007a5e;
            padding: 4px 8px; border-radius: 4px; font-weight: bold; border: 1px solid #b2f5ea;
        }}

        /* 课程表 */
        .schedule-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }}

        .schedule-table th {{
            text-align: left;
            padding: 12px;
            background-color: #f0f0f0;
            border-bottom: 2px solid #ccc;
            color: #555;
        }}

        .schedule-table td {{
            padding: 15px 12px;
            border-bottom: 1px solid #eee;
        }}

        .course-code {{ font-weight: bold; color: var(--psu-blue); }}
        .course-title {{ font-weight: 500; }}

        /* 打印适配 */
        @media print {{
            body {{ background: white; padding: 0; }}
            .viewport {{ box-shadow: none; max-width: 100%; min-height: auto; }}
            .nav-bar {{ display: none; }}
            @page {{ margin: 1cm; size: landscape; }}
        }}
    </style>
</head>
<body>

<div class="viewport">
    <div class="header">
        <div class="brand">
            <div class="psu-logo">PennState</div>
            <div class="system-name">LionPATH</div>
        </div>
        <div class="user-menu">
            <span>Welcome, <strong>{name}</strong></span>
            <span>|</span>
            <span>Sign Out</span>
        </div>
    </div>

    <div class="nav-bar">
        <div class="nav-item">Student Home</div>
        <div class="nav-item active">My Class Schedule</div>
        <div class="nav-item">Academics</div>
        <div class="nav-item">Finances</div>
        <div class="nav-item">Campus Life</div>
    </div>

    <div class="content">
        <div class="page-header">
            <h1 class="page-title">My Class Schedule</h1>
            <div class="term-selector">
                Term: <strong>{term_display}</strong> {term_dates}
            </div>
        </div>

        <div class="student-card">
            <div>
                <div class="info-label">Student Name</div>
                <div class="info-val">{name}</div>
            </div>
            <div>
                <div class="info-label">PSU ID</div>
                <div class="info-val">{psu_id}</div>
            </div>
            <div>
                <div class="info-label">Academic Program</div>
                <div class="info-val">{major}</div>
            </div>
            <div>
                <div class="info-label">Enrollment Status</div>
                <div class="status-badge">✅ Enrolled</div>
            </div>
        </div>

        <div style="margin-bottom: 10px; font-size: 12px; color: #666; text-align: right;">
            Data retrieved: <span>{date}</span>
        </div>

        <table class="schedule-table">
            <thead>
                <tr>
                    <th width="10%">Class Nbr</th>
                    <th width="15%">Course</th>
                    <th width="35%">Title</th>
                    <th width="20%">Days & Times</th>
                    <th width="10%">Room</th>
                    <th width="10%">Units</th>
                </tr>
            </thead>
            <tbody>
                {courses}
            </tbody>
        </table>

        <div style="margin-top: 50px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 11px; color: #888; text-align: center;">
            &copy; {year} The Pennsylvania State University. All rights reserved.<br>
            LionPATH is the student information system for Penn State.
        </div>
    </div>
</div>

</body>
</html>
"""

    return html, psu_id, email, major


def generate_random_courses(modern_format: bool = False) -> tuple:
    """生成随机课程表 HTML
    
    Args:
        modern_format: True 使用现代卡片格式, False 使用经典表格格式
    
    Returns:
        tuple: (课程 HTML, 总学分)
    """
    
    course_pool = [
        # CMPSC - Computer Science (official Penn State bulletin)
        ('CMPSC 121', 'Introduction to Programming Techniques', 3),
        ('CMPSC 131', 'Programming and Computation I: Fundamentals', 3),
        ('CMPSC 132', 'Programming and Computation II: Data Structures', 3),
        ('CMPSC 221', 'Object-Oriented Programming with Web-Based Applications', 3),
        ('CMPSC 311', 'Introduction to Systems Programming', 3),
        ('CMPSC 360', 'Discrete Mathematics for Computer Science', 3),
        ('CMPSC 465', 'Data Structures and Algorithms', 3),
        ('CMPSC 473', 'Operating Systems Design and Construction', 3),
        ('CMPSC 431W', 'Database Management Systems', 3),
        # MATH - Mathematics (official Penn State bulletin)
        ('MATH 140', 'Calculus with Analytic Geometry I', 4),
        ('MATH 141', 'Calculus with Analytic Geometry II', 4),
        ('MATH 220', 'Matrices', 2),
        ('MATH 230', 'Calculus and Vector Analysis', 4),
        ('MATH 251', 'Ordinary Differential Equations', 4),
        # STAT - Statistics
        ('STAT 200', 'Elementary Statistics', 4),
        ('STAT 318', 'Elementary Probability', 3),
        ('STAT 414', 'Introduction to Probability Theory', 3),
        # PHYS - Physics (official Penn State bulletin)
        ('PHYS 211', 'General Physics: Mechanics', 4),
        ('PHYS 212', 'General Physics: Electricity and Magnetism', 4),
        # Other common courses
        ('ENGL 202C', 'Effective Writing: Technical Writing', 3),
        ('ECON 102', 'Introductory Microeconomic Analysis', 3),
        ('ECON 104', 'Introductory Macroeconomic Analysis', 3),
        ('IST 210', 'Organization of Data', 3),
        ('IST 256', 'Programming for the Web', 3),
        ('CMPEN 270', 'Digital Design Lab', 2),
        ('CMPEN 331', 'Computer Organization and Design', 3),
    ]
    
    time_slots = [
        ('MoWeFr', '8:00AM – 8:50AM'),
        ('MoWeFr', '9:05AM – 9:55AM'),
        ('MoWeFr', '10:10AM – 11:00AM'),
        ('MoWeFr', '11:15AM – 12:05PM'),
        ('MoWeFr', '1:25PM – 2:15PM'),
        ('TuTh', '8:00AM – 9:15AM'),
        ('TuTh', '9:30AM – 10:45AM'),
        ('TuTh', '12:05PM – 1:20PM'),
        ('TuTh', '1:35PM – 2:50PM'),
        ('TuTh', '3:05PM – 4:20PM'),
        ('MoWe', '2:30PM – 3:45PM'),
        ('MoWe', '4:00PM – 5:15PM'),
    ]
    
    rooms = [
        'Willard 062', 'Thomas 102', 'Westgate E201', 'Boucke 304', 'Osmond 112',
        'Sackett 202', 'Hammond 107', 'Fenske 112', 'Walker 203', 'Chambers 111',
        'IST 220', 'Sparks 106', 'Keller 115', 'Forum 114', 'Wartik 108',
    ]
    
    instructors = [
        'Smith, J.', 'Johnson, M.', 'Williams, R.', 'Brown, K.', 'Davis, L.',
        'Miller, S.', 'Wilson, T.', 'Anderson, P.', 'Taylor, C.', 'Thomas, A.',
    ]
    
    # 随机选择 4-5 门课程
    num_courses = random.randint(4, 5)
    selected_courses = random.sample(course_pool, num_courses)
    selected_times = random.sample(time_slots, num_courses)
    selected_rooms = random.sample(rooms, num_courses)
    selected_instructors = random.sample(instructors, num_courses)
    
    rows = []
    total_units = 0
    
    for i, (course_code, title, units) in enumerate(selected_courses):
        class_nbr = str(random.randint(10000, 29999))
        days, time_range = selected_times[i]
        room = selected_rooms[i]
        instructor = selected_instructors[i]
        total_units += units
        
        if modern_format:
            # 现代卡片格式
            row = f"""            <div class="course">
                <div>
                    <div class="code">{course_code}</div>
                    <div class="meta">Class {class_nbr}</div>
                </div>
                <div class="title">{title}</div>
                <div class="meta">{days} · {time_range} · {room}</div>
                <div class="units">{units} Units</div>
            </div>"""
        else:
            # 经典表格格式 (Student Center 风格)
            row = f"""            <tr>
                <td class="status-enrolled">Enrolled</td>
                <td><span class="course-link">{course_code}</span><br><small>Class #{class_nbr}</small></td>
                <td>{title}</td>
                <td>{units}.00</td>
                <td>Graded</td>
                <td>{days} {time_range}</td>
                <td>{room}</td>
                <td>{instructor}</td>
            </tr>"""
        rows.append(row)
    
    return '\n'.join(rows), total_units


def generate_table_format_courses() -> tuple:
    """生成表格格式课程列表 (用于 enrollment verification 模板)
    
    Returns:
        tuple: (表格行 HTML, 总学分, 专业, 年级)
    """
    
    # 课程组合 + 对应专业 + 对应年级 (确保逻辑一致性)
    course_sets = [
        # CS Freshman (大一新生)
        {
            'major': 'Computer Science (BS)',
            'standing': 'Freshman',
            'courses': [
                ('CMPSC 131', 'Programming and Computation I', 3, 'MWF', '9:00 - 9:50 AM', 'Willard 062'),
                ('MATH 140', 'Calculus with Analytic Geometry I', 4, 'MWF', '10:10 - 11:00 AM', 'Thomas 102'),
                ('ENGL 015', 'Rhetoric and Composition', 3, 'TTh', '9:05 - 10:20 AM', 'Sparks 106'),
                ('PHYS 211', 'General Physics: Mechanics', 4, 'TTh', '11:15 AM - 12:30 PM', 'Osmond 112'),
            ]
        },
        # CS Sophomore (大二)
        {
            'major': 'Computer Science (BS)',
            'standing': 'Sophomore',
            'courses': [
                ('CMPSC 132', 'Programming and Computation II', 3, 'MWF', '9:00 - 9:50 AM', 'Westgate E201'),
                ('MATH 141', 'Calculus with Analytic Geometry II', 4, 'MWF', '11:15 AM - 12:05 PM', 'Thomas 102'),
                ('CMPSC 360', 'Discrete Mathematics for CS', 3, 'TTh', '9:05 - 10:20 AM', 'Willard 062'),
                ('PHYS 212', 'Electricity and Magnetism', 4, 'TTh', '1:35 - 2:50 PM', 'Osmond 112'),
            ]
        },
        # CS Junior (大三)
        {
            'major': 'Computer Science (BS)',
            'standing': 'Junior',
            'courses': [
                ('CMPSC 311', 'Introduction to Systems Programming', 3, 'MWF', '10:10 - 11:00 AM', 'Westgate E201'),
                ('CMPSC 465', 'Data Structures and Algorithms', 3, 'TTh', '9:05 - 10:20 AM', 'Sackett 202'),
                ('MATH 220', 'Matrices', 2, 'MWF', '1:25 - 2:15 PM', 'Thomas 102'),
                ('ENGL 202C', 'Effective Writing: Technical Writing', 3, 'TTh', '11:15 AM - 12:30 PM', 'Sparks 106'),
            ]
        },
        # IST Sophomore
        {
            'major': 'Information Sciences and Technology (BS)',
            'standing': 'Sophomore',
            'courses': [
                ('IST 210', 'Organization of Data', 3, 'MWF', '9:00 - 9:50 AM', 'IST 220'),
                ('IST 220', 'Networking and Telecommunications', 3, 'TTh', '9:05 - 10:20 AM', 'Westgate E201'),
                ('STAT 200', 'Elementary Statistics', 4, 'MWF', '11:15 AM - 12:05 PM', 'Forum 114'),
                ('ENGL 202C', 'Effective Writing: Technical Writing', 3, 'TTh', '1:35 - 2:50 PM', 'Sparks 106'),
            ]
        },
        # Business Freshman
        {
            'major': 'Business Administration (BS)',
            'standing': 'Freshman',
            'courses': [
                ('ECON 102', 'Introductory Microeconomic Analysis', 3, 'MWF', '9:00 - 9:50 AM', 'Boucke 304'),
                ('MATH 110', 'Techniques of Calculus I', 4, 'MWF', '10:10 - 11:00 AM', 'Thomas 102'),
                ('ENGL 015', 'Rhetoric and Composition', 3, 'TTh', '9:05 - 10:20 AM', 'Sparks 106'),
                ('BA 100', 'Introduction to Business', 3, 'TTh', '11:15 AM - 12:30 PM', 'Business Building 101'),
            ]
        },
    ]
    
    # 随机选择一个课程组合
    selected_set = random.choice(course_sets)
    
    rows = []
    total_units = 0
    
    for course_code, title, units, days, time_range, room in selected_set['courses']:
        total_units += units
        row = f"""                    <tr>
                        <td class="course-code">{course_code}</td>
                        <td>{title}</td>
                        <td>{units}</td>
                        <td>{days} {time_range}</td>
                        <td>{room}</td>
                    </tr>"""
        rows.append(row)
    
    return '\n'.join(rows), total_units, selected_set['major'], selected_set['standing']


def generate_browser_format_courses() -> tuple:
    """生成浏览器截图模板的课程列表 (Oracle PeopleSoft 风格)
    
    Returns:
        tuple: (表格行 HTML, 总学分, 专业, 年级)
    """
    
    # 教授名字池
    instructors = [
        'Dr. Sarah Chen', 'Prof. Michael Johnson', 'Dr. Emily Davis',
        'Prof. Robert Williams', 'Dr. Jennifer Martinez', 'Prof. David Brown',
        'Dr. Lisa Anderson', 'Prof. James Wilson', 'Dr. Maria Garcia',
        'Prof. Thomas Moore', 'Dr. Karen Taylor', 'Prof. Christopher Lee'
    ]
    
    # 课程组合 + 对应专业 + 对应年级
    course_sets = [
        # CS Freshman
        {
            'major': 'Computer Science (BS)',
            'standing': 'Freshman',
            'courses': [
                ('CMPSC 131', 'Programming and Computation I: Fundamentals', 3, 'MWF', '9:05 AM - 9:55 AM'),
                ('MATH 140', 'Calculus With Analytic Geometry I', 4, 'MWF', '10:10 AM - 11:00 AM'),
                ('ENGL 015', 'Rhetoric and Composition', 3, 'TTh', '9:05 AM - 10:20 AM'),
                ('PHYS 211', 'General Physics: Mechanics', 4, 'TTh', '11:15 AM - 12:30 PM'),
            ]
        },
        # CS Sophomore
        {
            'major': 'Computer Science (BS)',
            'standing': 'Sophomore',
            'courses': [
                ('CMPSC 132', 'Programming and Computation II: Data Structures', 3, 'MWF', '9:05 AM - 9:55 AM'),
                ('MATH 141', 'Calculus With Analytic Geometry II', 4, 'MWF', '11:15 AM - 12:05 PM'),
                ('CMPSC 360', 'Discrete Mathematics for Computer Science', 3, 'TTh', '9:05 AM - 10:20 AM'),
                ('PHYS 212', 'General Physics: Electricity and Magnetism', 4, 'TTh', '1:35 PM - 2:50 PM'),
            ]
        },
        # CS Junior
        {
            'major': 'Computer Science (BS)',
            'standing': 'Junior',
            'courses': [
                ('CMPSC 311', 'Introduction to Systems Programming', 3, 'MWF', '10:10 AM - 11:00 AM'),
                ('CMPSC 465', 'Data Structures and Algorithms', 3, 'TTh', '9:05 AM - 10:20 AM'),
                ('CMPSC 473', 'Operating Systems Design and Construction', 3, 'MWF', '1:25 PM - 2:15 PM'),
                ('ENGL 202C', 'Effective Writing: Technical Writing', 3, 'TTh', '11:15 AM - 12:30 PM'),
            ]
        },
        # IST Sophomore
        {
            'major': 'Information Sciences and Technology (BS)',
            'standing': 'Sophomore',
            'courses': [
                ('IST 210', 'Organization of Data', 3, 'MWF', '9:05 AM - 9:55 AM'),
                ('IST 220', 'Networking and Telecommunications', 3, 'TTh', '9:05 AM - 10:20 AM'),
                ('STAT 200', 'Elementary Statistics', 4, 'MWF', '11:15 AM - 12:05 PM'),
                ('ENGL 202C', 'Effective Writing: Technical Writing', 3, 'TTh', '1:35 PM - 2:50 PM'),
            ]
        },
    ]
    
    # 教室池
    rooms = [
        'Willard Building 075', 'Thomas Building 102', 'Westgate Building E201',
        'Sparks Building 106', 'Osmond Laboratory 112', 'Forum Building 114',
        'Sackett Building 202', 'Boucke Building 304', 'IST Building 220',
        'Hammond Building 112', 'Deike Building 217', 'Walker Building 140'
    ]
    
    selected_set = random.choice(course_sets)
    random.shuffle(instructors)
    random.shuffle(rooms)
    
    rows = []
    total_units = 0
    
    for i, (course_code, title, units, days, time_range) in enumerate(selected_set['courses']):
        total_units += units
        class_nbr = str(random.randint(10000, 29999))
        instructor = instructors[i % len(instructors)]
        room = rooms[i % len(rooms)]
        
        row = f"""                <tr>
                    <td><span class="status-enrolled">Enrolled</span></td>
                    <td><span class="course-link">{course_code}</span><br><small>Class #{class_nbr}</small></td>
                    <td>{title}</td>
                    <td class="units-column">{units}.00</td>
                    <td>Graded</td>
                    <td>{days}<br>{time_range}</td>
                    <td>{room}</td>
                    <td>{instructor}</td>
                </tr>"""
        rows.append(row)
    
    return '\n'.join(rows), total_units, selected_set['major'], selected_set['standing']


def generate_calendar_grid() -> tuple:
    """生成日历视图 HTML 课程表
    
    Returns:
        tuple: (calendar HTML, courses list, total units)
    """
    
    # 预定义的合理课程组合 (避免前置课程冲突)
    # 每组课程都是学术上合理的组合，不会同时选修有先后顺序的课程
    course_sets = [
        # CS 大一/大二课程组合
        [
            ('CMPSC 131', 'Programming and Computation I', 3, 'MWF', '9:00 AM'),
            ('MATH 140', 'Calculus with Analytic Geometry I', 4, 'MWF', '10:00 AM'),
            ('ENGL 202C', 'Effective Writing: Technical Writing', 3, 'TTh', '9:00 AM'),
            ('PHYS 211', 'General Physics: Mechanics', 4, 'TTh', '11:00 AM'),
        ],
        # CS 大二课程组合
        [
            ('CMPSC 132', 'Programming and Computation II', 3, 'MWF', '9:00 AM'),
            ('MATH 141', 'Calculus with Analytic Geometry II', 4, 'MWF', '11:00 AM'),
            ('CMPSC 360', 'Discrete Mathematics for CS', 3, 'TTh', '9:00 AM'),
            ('STAT 200', 'Elementary Statistics', 4, 'TTh', '1:00 PM'),
        ],
        # CS 大三课程组合
        [
            ('CMPSC 311', 'Introduction to Systems Programming', 3, 'MWF', '10:00 AM'),
            ('CMPSC 465', 'Data Structures and Algorithms', 3, 'TTh', '9:00 AM'),
            ('MATH 220', 'Matrices', 2, 'MWF', '1:00 PM'),
            ('PHYS 212', 'Electricity and Magnetism', 4, 'TTh', '11:00 AM'),
        ],
        # CS 大三/四课程组合
        [
            ('CMPSC 473', 'Operating Systems Design', 3, 'MWF', '9:00 AM'),
            ('CMPSC 221', 'Object-Oriented Programming', 3, 'TTh', '10:00 AM'),
            ('IST 210', 'Organization of Data', 3, 'MWF', '11:00 AM'),
            ('ECON 102', 'Introductory Microeconomic Analysis', 3, 'TTh', '1:00 PM'),
        ],
        # IST/商科组合
        [
            ('IST 210', 'Organization of Data', 3, 'MWF', '9:00 AM'),
            ('ECON 102', 'Introductory Microeconomic Analysis', 3, 'TTh', '9:00 AM'),
            ('STAT 200', 'Elementary Statistics', 4, 'MWF', '11:00 AM'),
            ('ENGL 202C', 'Effective Writing: Technical Writing', 3, 'TTh', '11:00 AM'),
        ],
    ]
    
    rooms = [
        'Willard 062', 'Thomas 102', 'Westgate E201', 'Boucke 304', 'Osmond 112',
        'Sackett 202', 'Hammond 107', 'Fenske 112', 'Walker 203', 'Chambers 111',
        'IST 220', 'Sparks 106', 'Keller 115', 'Forum 114', 'Wartik 108',
    ]
    
    color_classes = ['', 'alt-1', 'alt-2', 'alt-3', 'alt-4']
    
    # 随机选择一个课程组合
    selected_set = random.choice(course_sets)
    selected_rooms = random.sample(rooms, len(selected_set))
    
    total_units = sum(c[2] for c in selected_set)
    courses_data = []
    
    # 构建课程数据
    for i, (course_code, title, units, days, time_str) in enumerate(selected_set):
        room = selected_rooms[i]
        color = color_classes[i % len(color_classes)]
        courses_data.append({
            'code': course_code,
            'title': title,
            'units': units,
            'time': time_str,
            'days': days,
            'room': room,
            'color': color
        })
    
    # 定义时间槽显示
    display_times = [
        '8:00 AM',
        '9:00 AM', 
        '10:00 AM',
        '11:00 AM',
        '12:00 PM',
        '1:00 PM',
        '2:00 PM',
    ]
    
    # 生成日历 HTML
    html_rows = []
    
    for time_display in display_times:
        # 时间列
        html_rows.append(f'                <div class="time-slot">{time_display}</div>')
        
        # 5 天列 (Mon-Fri)
        for day_idx, day in enumerate(['M', 'T', 'W', 'Th', 'F']):
            cell_content = ''
            
            # 查找这个时间和日期是否有课
            for course in courses_data:
                course_time = course['time'].split(':')[0]  # Get hour
                slot_time = time_display.split(':')[0]
                
                # 简单匹配：同一个小时
                if course_time == slot_time:
                    # 检查是否是这一天
                    days = course['days']
                    has_class = False
                    
                    if days == 'MWF' and day in ['M', 'W', 'F']:
                        has_class = True
                    elif days == 'TTh' and day in ['T', 'Th']:
                        has_class = True
                    
                    if has_class:
                        color_class = f" {course['color']}" if course['color'] else ""
                        cell_content = f'''<div class="course-block{color_class}">
                            <div class="course-code">{course['code']}</div>
                            <div class="course-room">{course['room']}</div>
                        </div>'''
                        break
            
            html_rows.append(f'                <div class="day-cell">{cell_content}</div>')
    
    calendar_html = '\n'.join(html_rows)
    return calendar_html, courses_data, total_units


def generate_lionpath_image(first_name: str, last_name: str, school_id: str = '2565',
                            template_name: str = "schedule.html") -> Tuple[bytes, str, dict]:
    """
    生成 Penn State LionPATH 截图 PNG

    Args:
        first_name: 名字
        last_name: 姓氏
        school_id: 学校 ID
        template_name: 模板文件名

    Returns:
        Tuple[bytes, str, dict]: (PNG 图片数据, 文件名, 学生数据字典)
        学生数据字典包含: psu_id, email, major, university
    """
    try:
        import concurrent.futures
        
        # 预先生成数据以保持一致性
        psu_id = generate_psu_id()
        email = generate_psu_email(first_name, last_name)
        
        def run_playwright():
            from playwright.sync_api import sync_playwright
            
            html_content, _, _, major = generate_html(first_name, last_name, school_id, psu_id, email, template_name)
            
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(viewport={'width': 1200, 'height': 900})
                page.set_content(html_content, wait_until='load')
                page.wait_for_timeout(500)  # 等待样式加载
                # 截取可见区域而不是全页面，避免底部空白
                screenshot_bytes = page.screenshot(type='png', full_page=False)
                browser.close()
            
            return screenshot_bytes, major
        
        logger.info(f"[LionPATH] Generating schedule for {first_name} {last_name} with template {template_name}")
        
        # Run playwright in a separate thread to avoid asyncio loop conflict
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(run_playwright)
            screenshot_bytes, major = future.result(timeout=30)
        
        # 应用图像后处理（添加真实感效果）
        if HAS_IMAGE_PROCESSOR:
            try:
                screenshot_bytes = process_screenshot(screenshot_bytes, aggressive=False)
                logger.info("[LionPATH] ✓ Applied realistic image effects")
            except Exception as proc_err:
                logger.warning(f"[LionPATH] Image processing failed, using original: {proc_err}")

        filename = f"lionpath_{first_name.lower()}_{last_name.lower()}_{int(datetime.now().timestamp() * 1000)}.png"
        logger.info(f"[LionPATH] ✓ Generated: {filename} ({len(screenshot_bytes)} bytes)")
        
        # 返回学生数据字典供表单提交使用
        student_data = {
            "psu_id": psu_id,
            "email": email,
            "major": major,
            "university": "Pennsylvania State University",
            "firstName": first_name,
            "lastName": last_name,
            "fullName": f"{first_name} {last_name}"
        }
        
        return screenshot_bytes, filename, student_data

    except ImportError:
        raise Exception("需要安装 playwright: pip install playwright && playwright install chromium")
    except Exception as e:
        logger.error(f"[LionPATH] 生成图片失败: {e}")
        raise Exception(f"生成图片失败: {str(e)}")


def generate_document(first_name: str, last_name: str, **kwargs) -> Tuple[Optional[bytes], str]:
    """
    VerifyKey 兼容接口 - 生成 LionPATH 文档
    
    Args:
        first_name: 名字
        last_name: 姓氏
        **kwargs: 其他参数（忽略）
    
    Returns:
        Tuple[bytes, str]: (图片数据, 文件名)
    """
    return generate_lionpath_image(first_name, last_name)


# 测试代码
if __name__ == '__main__':
    import sys
    import io

    # 修复 Windows 控制台编码问题
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

    print("测试 LionPATH 图片生成...")

    first_name = "Emily"
    last_name = "Johnson"

    print(f"姓名: {first_name} {last_name}")
    print(f"PSU ID: {generate_psu_id()}")
    print(f"邮箱: {generate_psu_email(first_name, last_name)}")

    try:
        img_data, filename = generate_lionpath_image(first_name, last_name)

        # 保存测试图片
        with open('test_lionpath.png', 'wb') as f:
            f.write(img_data)

        print(f"✓ 图片生成成功! 大小: {len(img_data)} bytes")
        print(f"✓ 已保存为 test_lionpath.png")

    except Exception as e:
        print(f"✗ 错误: {e}")
