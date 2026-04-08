#!/bin/bash

# ================================================
# OnePASS 部署脚本
# 服务器: 159.195.71.45
# 项目路径: /var/www/onepass
# ================================================

set -e

SERVER="root@159.195.71.45"
REMOTE_PATH="/var/www/onepass"

echo "🚀 开始部署 OnePASS..."

# 1. 推送本地代码到 GitHub
echo "📤 推送代码到 GitHub..."
git add .
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')" 2>/dev/null || echo "Nothing to commit"
git push origin main

# 2. 服务器拉取代码并重建容器
echo "📥 服务器拉取代码..."
ssh $SERVER "cd $REMOTE_PATH && git stash && git pull origin main"

echo "🐳 重建 Docker 容器..."
ssh $SERVER "cd $REMOTE_PATH && docker compose build && docker compose up -d"

# 3. 检查容器状态
echo "✅ 检查容器状态..."
ssh $SERVER "docker ps | grep onepass"

echo ""
echo "================================================"
echo "✅ 部署完成!"
echo "================================================"
echo "访问: https://onepass.fun"
echo ""
