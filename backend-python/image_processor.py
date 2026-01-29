"""
图像真实化处理模块
添加微小变化以规避 AI 欺诈检测
"""

import io
import random
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
import numpy as np


def add_realistic_effects(image_bytes: bytes) -> bytes:
    """
    对截图添加真实感效果，模拟真实屏幕截图的特征
    
    Args:
        image_bytes: 原始 PNG 图片字节
        
    Returns:
        处理后的 PNG 图片字节
    """
    # 加载图片
    img = Image.open(io.BytesIO(image_bytes))
    img = img.convert('RGB')
    
    # 1. 轻微的颜色偏移 (模拟不同显示器色差)
    enhancer = ImageEnhance.Color(img)
    color_factor = random.uniform(0.98, 1.02)
    img = enhancer.enhance(color_factor)
    
    # 2. 轻微的亮度变化 (模拟屏幕亮度差异)
    enhancer = ImageEnhance.Brightness(img)
    brightness_factor = random.uniform(0.98, 1.02)
    img = enhancer.enhance(brightness_factor)
    
    # 3. 极轻微的对比度调整
    enhancer = ImageEnhance.Contrast(img)
    contrast_factor = random.uniform(0.99, 1.01)
    img = enhancer.enhance(contrast_factor)
    
    # 4. 添加极轻微的高斯噪点 (模拟屏幕像素噪点)
    img_array = np.array(img, dtype=np.float32)
    noise_intensity = random.uniform(0.5, 1.5)
    noise = np.random.normal(0, noise_intensity, img_array.shape)
    img_array = np.clip(img_array + noise, 0, 255).astype(np.uint8)
    img = Image.fromarray(img_array)
    
    # 5. 随机添加 1-2 个极淡的污点 (模拟屏幕灰尘/指纹)
    if random.random() < 0.3:  # 30% 概率添加
        draw = ImageDraw.Draw(img)
        for _ in range(random.randint(1, 2)):
            x = random.randint(50, img.width - 50)
            y = random.randint(50, img.height - 50)
            radius = random.randint(2, 5)
            # 极淡的灰色点
            opacity = random.randint(230, 245)
            draw.ellipse([x-radius, y-radius, x+radius, y+radius], 
                        fill=(opacity, opacity, opacity))
    
    # 6. 轻微的锐度变化
    enhancer = ImageEnhance.Sharpness(img)
    sharpness_factor = random.uniform(0.95, 1.05)
    img = enhancer.enhance(sharpness_factor)
    
    # 7. 随机 JPEG 质量压缩再转回 PNG (模拟截图工具压缩)
    if random.random() < 0.5:  # 50% 概率
        jpeg_buffer = io.BytesIO()
        jpeg_quality = random.randint(92, 98)
        img.save(jpeg_buffer, format='JPEG', quality=jpeg_quality)
        jpeg_buffer.seek(0)
        img = Image.open(jpeg_buffer)
    
    # 保存为 PNG
    output = io.BytesIO()
    img.save(output, format='PNG', optimize=True)
    output.seek(0)
    
    return output.read()


def strip_metadata(image_bytes: bytes) -> bytes:
    """
    移除图片的 EXIF 和其他元数据
    
    Args:
        image_bytes: 原始图片字节
        
    Returns:
        无元数据的图片字节
    """
    img = Image.open(io.BytesIO(image_bytes))
    
    # 创建新图片，不带元数据
    data = list(img.getdata())
    img_no_exif = Image.new(img.mode, img.size)
    img_no_exif.putdata(data)
    
    output = io.BytesIO()
    img_no_exif.save(output, format='PNG')
    output.seek(0)
    
    return output.read()


def randomize_dimensions(image_bytes: bytes) -> bytes:
    """
    轻微随机化图片尺寸 (±1-3 像素)
    
    Args:
        image_bytes: 原始图片字节
        
    Returns:
        调整尺寸后的图片字节
    """
    img = Image.open(io.BytesIO(image_bytes))
    
    # 随机调整尺寸 ±1-3 像素
    width_delta = random.randint(-3, 3)
    height_delta = random.randint(-3, 3)
    
    new_width = img.width + width_delta
    new_height = img.height + height_delta
    
    # 使用高质量重采样
    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
    
    output = io.BytesIO()
    img.save(output, format='PNG')
    output.seek(0)
    
    return output.read()


def process_screenshot(image_bytes: bytes, aggressive: bool = False) -> bytes:
    """
    完整的截图真实化处理流程
    
    Args:
        image_bytes: 原始截图字节
        aggressive: 是否使用更激进的处理
        
    Returns:
        处理后的图片字节
    """
    # 1. 移除元数据
    result = strip_metadata(image_bytes)
    
    # 2. 添加真实感效果
    result = add_realistic_effects(result)
    
    # 3. 轻微随机尺寸 (可选)
    if aggressive and random.random() < 0.3:
        result = randomize_dimensions(result)
    
    return result


# 测试
if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python image_processor.py <input.png>")
        sys.exit(1)
    
    with open(sys.argv[1], 'rb') as f:
        original = f.read()
    
    processed = process_screenshot(original)
    
    output_name = sys.argv[1].replace('.png', '_processed.png')
    with open(output_name, 'wb') as f:
        f.write(processed)
    
    print(f"✓ Original: {len(original)} bytes")
    print(f"✓ Processed: {len(processed)} bytes")
    print(f"✓ Saved to: {output_name}")
