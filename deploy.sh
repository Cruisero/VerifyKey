#!/bin/bash

# ================================================
# OnePASS 部署脚本 (Vmart-style optimized)
# 服务器: 159.195.71.45
# 项目路径: /var/www/onepass
# ================================================

set -e

SERVER="root@159.195.71.45"
REMOTE_PATH="/var/www/onepass"
SSH_OPTS="-o ServerAliveInterval=15 -o StrictHostKeyChecking=no -o ControlMaster=auto -o ControlPath=/tmp/ssh-onepass-%r@%h:%p -o ControlPersist=10m"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

backup_database() {
    local timestamp backup_file
    timestamp=$(date +%Y%m%d_%H%M%S)
    backup_file="backup_${timestamp}.db"

    info "📦 备份生产数据库 (SQLite) -> ${backup_file} ..."
    # Ensure backups folder exists inside remote volume and copy sqlite file
    ssh ${SSH_OPTS} ${SERVER} "cd ${REMOTE_PATH} && \
        docker compose exec -T backend mkdir -p /app/data/backups && \
        docker compose exec -T backend cp /app/data/verifykey.db /app/data/backups/${backup_file}" 2>/dev/null || warning "数据库备份失败或容器未运行，跳过备份继续部署"
    
    # Confirm backup succeeded
    if ssh ${SSH_OPTS} ${SERVER} "cd ${REMOTE_PATH} && docker compose exec -T backend test -f /app/data/backups/${backup_file}" 2>/dev/null; then
        success "数据库已备份至容器内部: /app/data/backups/${backup_file}"
    fi
}

push_to_git() {
    info "📤 提交并推送本地代码到 GitHub..."
    git add .
    git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')" 2>/dev/null || info "没有本地修改需要提交"
    git push origin main
}

deploy_auto() {
    push_to_git
    backup_database

    info "📥 服务器拉取代码并自动分析文件变更..."
    ssh ${SSH_OPTS} ${SERVER} "cd ${REMOTE_PATH} && \
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
            docker-compose.yml|docker-compose.*.yml) SERVICES='frontend backend'; break ;; \
            Dockerfile.frontend|frontend/*|nginx/frontend.conf) add_service frontend ;; \
            Dockerfile.python|backend-python/*|tools/*|templates/*|package.json|package-lock.json) add_service backend ;; \
          esac; \
        done && \
        if [ -n \"\$SERVICES\" ]; then \
          echo \"🎯 本次将更新服务: \$SERVICES\" && \
          BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose build \$SERVICES && \
          docker compose up -d \$SERVICES; \
        else \
          echo '🎯 没有检测到需要重建的 Docker 服务，跳过构建'; \
        fi"
}

deploy_services() {
    local target_services="$1"
    push_to_git
    backup_database

    info "📥 服务器拉取代码并强制构建/重启指定服务: ${target_services} ..."
    ssh ${SSH_OPTS} ${SERVER} "cd ${REMOTE_PATH} && \
        git stash && \
        git pull origin main && \
        BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose build ${target_services} && \
        docker compose up -d ${target_services}"
}

check_status() {
    info "✅ 检查服务器容器运行状态..."
    ssh ${SSH_OPTS} ${SERVER} "docker ps | grep onepass" || warning "未找到运行中的 onepass 容器"
}

show_help() {
    echo "OnePASS 生产环境部署脚本"
    echo ""
    echo "用法: ./deploy.sh [选项]"
    echo ""
    echo "选项:"
    echo "  auto        拉取代码并自动分析 Git diff 需要更新的服务（默认）"
    echo "  all         拉取代码并强制重构所有服务 (frontend, backend)"
    echo "  frontend    仅重新构建并部署前端服务"
    echo "  backend     仅重新构建并部署后端服务"
    echo "  backup      仅备份生产 SQLite 数据库"
    echo "  help        显示帮助"
}

main() {
    echo ""
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}        🚀 OnePASS 生产环境部署 (Vmart 优化版)   ${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""

    case "${1:-auto}" in
        auto)
            deploy_auto
            ;;
        all)
            deploy_services "frontend backend"
            ;;
        frontend|f)
            deploy_services "frontend"
            ;;
        backend|b)
            deploy_services "backend"
            ;;
        backup)
            backup_database
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            error "未知选项: $1\n使用 './deploy.sh help' 查看帮助"
            ;;
    esac

    check_status

    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}✨ 部署指令执行完成!${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo "部署地址: https://onepass.fun"
    echo ""
}

main "$@"
