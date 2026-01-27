#!/bin/bash
# 下载最新一次提交的文档和JSON数据
# Usage: ./download-latest-submission.sh

SERVER="root@159.195.71.45"
REMOTE_DIR="/var/www/onepass/output/submissions"
LOCAL_DIR="./downloaded_submissions"

# 创建本地目录
mkdir -p "$LOCAL_DIR"

echo "🔍 查找最新提交..."

# 获取最新的提交前缀（基于时间戳排序）
LATEST_PREFIX=$(ssh $SERVER "ls -1 $REMOTE_DIR/*.json 2>/dev/null | sort -r | head -1 | xargs -I {} basename {} _data.json")

if [ -z "$LATEST_PREFIX" ]; then
    echo "❌ 没有找到提交记录"
    exit 1
fi

echo "📦 最新提交: $LATEST_PREFIX"

# 下载所有匹配的文件
echo "⬇️  下载文件..."
scp "$SERVER:$REMOTE_DIR/${LATEST_PREFIX}*" "$LOCAL_DIR/"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 下载完成!"
    echo "📁 保存位置: $LOCAL_DIR/"
    echo ""
    echo "📄 文件列表:"
    ls -la "$LOCAL_DIR/${LATEST_PREFIX}"* 2>/dev/null
    echo ""
    
    # 显示JSON内容
    JSON_FILE="$LOCAL_DIR/${LATEST_PREFIX}_data.json"
    if [ -f "$JSON_FILE" ]; then
        echo "📋 表单数据:"
        cat "$JSON_FILE" | python3 -m json.tool 2>/dev/null || cat "$JSON_FILE"
    fi
else
    echo "❌ 下载失败"
    exit 1
fi
