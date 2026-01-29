"""
LionPATH Schedule Generator - Penn State Student Portal Screenshot
移植自 tgbot-verify 项目，保留原始的 HTML 字符串拼接 + Playwright 截图方式

生成 Penn State LionPATH 学生课程表截图，作为 VerifyKey 的备选验证文档类型。
"""
import random
from datetime import datetime
from io import BytesIO
from typing import Tuple, Optional
import logging

logger = logging.getLogger(__name__)


def generate_psu_id() -> str:
    """生成随机 PSU ID (9位数字)"""
    return f"9{random.randint(10000000, 99999999)}"


def generate_psu_email(first_name: str, last_name: str) -> str:
    """
    生成 PSU 邮箱
    格式: firstName.lastName + 3-4位数字 @psu.edu
    """
    digit_count = random.choice([3, 4])
    digits = ''.join([str(random.randint(0, 9)) for _ in range(digit_count)])
    email = f"{first_name.lower()}.{last_name.lower()}{digits}@psu.edu"
    return email


def generate_html(first_name: str, last_name: str, school_id: str = '2565') -> str:
    """
    生成 Penn State LionPATH HTML

    Args:
        first_name: 名字
        last_name: 姓氏
        school_id: 学校 ID

    Returns:
        str: HTML 内容
    """
    psu_id = generate_psu_id()
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
        term_dates = f"(Jan 13 - May 9)"
    elif 6 <= month <= 7:
        term = "Summer"
        term_dates = f"(May 19 - Aug 8)"
    else:
        term = "Fall"
        term_dates = f"(Aug 25 - Dec 12)"
    
    term_display = f"{term} {year}"

    # 随机课程生成
    courses = generate_random_courses()

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

    return html


def generate_random_courses() -> str:
    """生成随机课程表 HTML"""
    
    course_pool = [
        ('CMPSC 465', 'Data Structures and Algorithms', '3.00'),
        ('CMPSC 473', 'Operating Systems Design', '3.00'),
        ('CMPSC 431W', 'Database Management Systems', '3.00'),
        ('CMPSC 360', 'Discrete Mathematics', '3.00'),
        ('CMPSC 311', 'Systems Programming', '3.00'),
        ('MATH 230', 'Calculus and Vector Analysis', '4.00'),
        ('MATH 220', 'Matrices', '2.00'),
        ('MATH 251', 'Ordinary Differential Equations', '4.00'),
        ('STAT 318', 'Elementary Probability', '3.00'),
        ('STAT 414', 'Introduction to Probability Theory', '3.00'),
        ('PHYS 211', 'General Physics: Mechanics', '4.00'),
        ('PHYS 212', 'General Physics: Electricity and Magnetism', '4.00'),
        ('ENGL 202C', 'Technical Writing', '3.00'),
        ('ECON 102', 'Introductory Microeconomic Analysis', '3.00'),
        ('ECON 104', 'Introductory Macroeconomic Analysis', '3.00'),
        ('IST 210', 'Organization of Data', '3.00'),
        ('IST 256', 'Programming for the Web', '3.00'),
    ]
    
    time_slots = [
        'MoWeFr 8:00AM - 8:50AM',
        'MoWeFr 9:05AM - 9:55AM',
        'MoWeFr 10:10AM - 11:00AM',
        'MoWeFr 11:15AM - 12:05PM',
        'MoWeFr 1:25PM - 2:15PM',
        'TuTh 8:00AM - 9:15AM',
        'TuTh 9:30AM - 10:45AM',
        'TuTh 12:05PM - 1:20PM',
        'TuTh 1:35PM - 2:50PM',
        'TuTh 3:05PM - 4:20PM',
        'MoWe 2:30PM - 3:45PM',
        'MoWe 4:00PM - 5:15PM',
    ]
    
    rooms = [
        'Willard 062', 'Thomas 102', 'Westgate E201', 'Boucke 304', 'Osmond 112',
        'Sackett 202', 'Hammond 107', 'Fenske 112', 'Walker 203', 'Chambers 111',
        'IST 220', 'Sparks 106', 'Keller 115', 'Forum 114', 'Wartik 108',
    ]
    
    # 随机选择 4-6 门课程
    num_courses = random.randint(4, 6)
    selected_courses = random.sample(course_pool, num_courses)
    selected_times = random.sample(time_slots, num_courses)
    selected_rooms = random.sample(rooms, num_courses)
    
    rows = []
    for i, (course_code, title, units) in enumerate(selected_courses):
        class_nbr = str(random.randint(10000, 29999))
        time_slot = selected_times[i]
        room = selected_rooms[i]
        
        row = f"""                <tr>
                    <td>{class_nbr}</td>
                    <td class="course-code">{course_code}</td>
                    <td class="course-title">{title}</td>
                    <td>{time_slot}</td>
                    <td>{room}</td>
                    <td>{units}</td>
                </tr>"""
        rows.append(row)
    
    return '\n'.join(rows)


def generate_lionpath_image(first_name: str, last_name: str, school_id: str = '2565') -> Tuple[bytes, str]:
    """
    生成 Penn State LionPATH 截图 PNG

    Args:
        first_name: 名字
        last_name: 姓氏
        school_id: 学校 ID

    Returns:
        Tuple[bytes, str]: (PNG 图片数据, 文件名)
    """
    try:
        import concurrent.futures
        
        def run_playwright():
            from playwright.sync_api import sync_playwright
            
            html_content = generate_html(first_name, last_name, school_id)
            
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(viewport={'width': 1200, 'height': 900})
                page.set_content(html_content, wait_until='load')
                page.wait_for_timeout(500)  # 等待样式加载
                screenshot_bytes = page.screenshot(type='png', full_page=True)
                browser.close()
            
            return screenshot_bytes
        
        logger.info(f"[LionPATH] Generating schedule for {first_name} {last_name}")
        
        # Run playwright in a separate thread to avoid asyncio loop conflict
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(run_playwright)
            screenshot_bytes = future.result(timeout=30)

        filename = f"lionpath_{first_name.lower()}_{last_name.lower()}_{int(datetime.now().timestamp() * 1000)}.png"
        logger.info(f"[LionPATH] ✓ Generated: {filename} ({len(screenshot_bytes)} bytes)")
        
        return screenshot_bytes, filename

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
