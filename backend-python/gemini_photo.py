"""
Gemini Photo Generator for PSU ID Card
使用 Google Gemini API 生成学生证照片
"""
import os
import base64
import httpx
import random
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Gemini API 配置 (默认值，实际会从配置中读取)
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-exp-image-generation"


def get_gemini_config() -> tuple:
    """从配置中获取 Gemini API Key 和 Model"""
    try:
        from config_manager import get_config
        config = get_config()
        gemini_config = config.get("aiGenerator", {}).get("gemini", {})
        
        api_key = gemini_config.get("apiKey", "")
        model = gemini_config.get("model", DEFAULT_GEMINI_MODEL)
        
        if api_key:
            print(f"[GeminiPhoto] Found API key in config (length: {len(api_key)}, starts with: {api_key[:8]}...)")
        else:
            print("[GeminiPhoto] No API key found in config")
        
        print(f"[GeminiPhoto] Using model: {model}")
        return api_key, model
    except Exception as e:
        print(f"[GeminiPhoto] Failed to get config: {e}")
        logger.warning(f"[GeminiPhoto] Failed to get config: {e}")
        # 回退到环境变量
        env_key = os.environ.get("GEMINI_API_KEY", "")
        if env_key:
            print(f"[GeminiPhoto] Using API key from environment variable")
        return env_key, DEFAULT_GEMINI_MODEL


def generate_student_photo(first_name: str, last_name: str, gender: str = None) -> Optional[bytes]:
    """
    使用 Gemini AI 生成学生证照片
    
    Args:
        first_name: 名
        last_name: 姓
        gender: 性别 ('male', 'female', None=随机)
    
    Returns:
        bytes: 图片数据，失败返回 None
    """
    api_key, model = get_gemini_config()
    if not api_key:
        logger.warning("[GeminiPhoto] No GEMINI_API_KEY found in config or environment")
        print("[GeminiPhoto] No GEMINI_API_KEY found - returning None")
        return None
    
    # 构建 API URL（使用配置中的模型）
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    
    # 如果没有指定性别，随机选择
    if gender is None:
        gender = random.choice(['male', 'female'])
    
    # 随机特征使照片更自然多样
    age = random.randint(18, 25)
    ethnicities = ['Caucasian', 'Asian', 'Hispanic', 'African American', 'Middle Eastern', 'South Asian']
    ethnicity = random.choice(ethnicities)
    
    # 生成照片的 prompt
    prompt = f"""Generate a realistic university student ID card portrait photo:

REQUIREMENTS:
- Gender: {gender}
- Age: {age} years old  
- Ethnicity: {ethnicity}
- Neutral, friendly expression with slight smile
- Looking directly at camera
- Close-up headshot, face fills 70-80% of the frame
- Plain light blue or gray solid background, no gradients
- Even professional lighting, no harsh shadows
- Shoulders and upper chest visible at bottom
- NO white borders, NO frames, NO margins around the image
- Photo should extend to all edges with no padding
- Aspect ratio: portrait (3:4 or similar)
- High resolution, sharp details

Generate ONLY the photo image extending to all edges. No text, no frames, no borders."""

    try:
        print(f"[GeminiPhoto] Calling API for {first_name} {last_name} ({gender}, {age}yo, {ethnicity})")
        print(f"[GeminiPhoto] API URL: {api_url}")
        logger.info(f"[GeminiPhoto] Generating photo for {first_name} {last_name} ({gender}, {age}yo, {ethnicity})")
        
        response = httpx.post(
            f"{api_url}?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseModalities": ["image", "text"]
                }
            },
            timeout=60.0
        )
        
        print(f"[GeminiPhoto] API response status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"[GeminiPhoto] API error: {response.status_code} - {response.text[:500]}")
            logger.error(f"[GeminiPhoto] API error: {response.status_code} - {response.text[:200]}")
            return None
        
        data = response.json()
        print(f"[GeminiPhoto] Response keys: {data.keys()}")
        
        # 从响应中提取图片
        candidates = data.get("candidates", [])
        if not candidates:
            print(f"[GeminiPhoto] No candidates in response. Full response: {str(data)[:500]}")
            logger.warning("[GeminiPhoto] No candidates in response")
            return None
        
        print(f"[GeminiPhoto] Got {len(candidates)} candidates")
        parts = candidates[0].get("content", {}).get("parts", [])
        print(f"[GeminiPhoto] Got {len(parts)} parts")
        
        for i, part in enumerate(parts):
            print(f"[GeminiPhoto] Part {i}: {list(part.keys())}")
            inline_data = part.get("inlineData")
            if inline_data and inline_data.get("mimeType", "").startswith("image/"):
                image_base64 = inline_data.get("data")
                if image_base64:
                    image_bytes = base64.b64decode(image_base64)
                    print(f"[GeminiPhoto] ✓ Got image: {len(image_bytes)} bytes")
                    logger.info(f"[GeminiPhoto] ✓ Generated photo: {len(image_bytes)} bytes")
                    return image_bytes
        
        print(f"[GeminiPhoto] No image found in parts")
        logger.warning("[GeminiPhoto] No image found in response parts")
        return None
        
    except httpx.TimeoutException:
        logger.error("[GeminiPhoto] Request timeout")
        return None
    except Exception as e:
        logger.error(f"[GeminiPhoto] Error: {e}")
        return None


def generate_student_photo_base64(first_name: str, last_name: str, gender: str = None) -> Optional[str]:
    """
    生成学生证照片并返回 base64 格式
    
    Returns:
        str: data:image/png;base64,... 格式的图片，失败返回 None
    """
    photo_bytes = generate_student_photo(first_name, last_name, gender)
    if photo_bytes:
        b64 = base64.b64encode(photo_bytes).decode('utf-8')
        return f"data:image/png;base64,{b64}"
    return None


# 备用：使用占位符图片 (白色 190x225 像素)
def get_placeholder_photo() -> str:
    """返回占位符照片的 base64 (白色方块，匹配模板中的照片区域)"""
    try:
        from PIL import Image
        from io import BytesIO
        
        # 创建白色图片 (190x225 是模板中照片区域的大小)
        img = Image.new('RGB', (190, 225), color=(255, 255, 255))
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return f"data:image/png;base64,{b64}"
    except ImportError:
        # 如果没有 PIL，使用预生成的白色图片 base64
        # 这是一个 10x10 的白色 PNG
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAADklEQVR4nGP4////GWQSAGPkBv+Qz5y/AAAAAElFTkSuQmCC"
