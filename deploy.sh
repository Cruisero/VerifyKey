#!/bin/bash

# ================================================
# OnePASS 部署脚本
# 服务器: 159.195.71.45
# 项目路径: /var/www/onepass
# ================================================

set -e

# 配置
SERVER="root@159.195.71.45"
REMOTE_PATH="/var/www/onepass"
LOCAL_PATH="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 开始部署 OnePASS..."

# 1. 创建远程目录
echo "📁 创建远程目录..."
ssh $SERVER "mkdir -p $REMOTE_PATH"

# 2. 同步项目文件（排除 node_modules 和 .git）
echo "📦 同步项目文件..."
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.DS_Store' \
    --exclude '*.log' \
    "$LOCAL_PATH/" "$SERVER:$REMOTE_PATH/"

# 3. 在服务器上构建并启动容器
echo "🐳 构建并启动 Docker 容器..."
ssh $SERVER "cd $REMOTE_PATH && docker compose down && docker compose build --no-cache && docker compose up -d"

# 4. 检查容器状态
echo "✅ 检查容器状态..."
ssh $SERVER "docker ps | grep onepass"

echo ""
echo "================================================"
echo "✅ 部署完成!"
echo "================================================"
echo ""
echo "前端: http://159.195.71.45:3001"
echo "后端: http://159.195.71.45:3002"
echo ""
echo "接下来需要手动配置:"
echo "1. 配置宿主机 Nginx 反向代理"
echo "2. 申请 SSL 证书"
echo ""
