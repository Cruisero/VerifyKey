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

# 2. 服务器拉取代码并按 Git diff 判断需要更新的服务
echo "📥 服务器拉取代码..."
ssh $SERVER "cd $REMOTE_PATH && \
OLD_REV=\$(git rev-parse HEAD) && \
git stash && \
git pull origin main && \
NEW_REV=\$(git rev-parse HEAD) && \
CHANGED_FILES=\$(git diff --name-only \$OLD_REV \$NEW_REV) && \
echo '🧭 本次 Git 变更文件:' && \
if [ -n \"\$CHANGED_FILES\" ]; then echo \"\$CHANGED_FILES\" | sed 's/^/  - /'; else echo '  - 无'; fi && \
SERVICES='' && \
add_service() { case \" \$SERVICES \" in *\" \$1 \"*) ;; *) SERVICES=\"\$SERVICES \$1\" ;; esac; } && \
for file in \$CHANGED_FILES; do \
  case \"\$file\" in \
    docker-compose.yml|docker-compose.*.yml) SERVICES=' frontend backend api-bot'; break ;; \
    Dockerfile.frontend|frontend/*|nginx/frontend.conf) add_service frontend ;; \
    Dockerfile.python|backend-python/*|tools/*|templates/*|package.json|package-lock.json) add_service backend; add_service api-bot ;; \
  esac; \
done && \
if [ -n \"\$SERVICES\" ]; then \
  echo \"🎯 本次将更新服务:\$SERVICES\" && \
  docker compose build \$SERVICES && \
  docker compose up -d \$SERVICES; \
else \
  echo '🎯 没有检测到需要重建的 Docker 服务，跳过构建'; \
fi"

# 3. 检查容器状态
echo "✅ 检查容器状态..."
ssh $SERVER "docker ps | grep onepass"

echo ""
echo "================================================"
echo "✅ 部署完成!"
echo "================================================"
echo "访问: https://onepass.fun"
echo ""
