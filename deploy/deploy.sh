#!/bin/bash
# 爱信 AIXin 一键部署脚本（腾讯云 / Ubuntu/CentOS）
# 用法: 
#   1. 把整个 aixin 目录上传到服务器
#   2. ssh 到服务器，执行: bash deploy/deploy.sh
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}"
echo "╔══════════════════════════════════════╗"
echo "║   💬 爱信 AIXin 部署脚本 v1.0       ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# 检测项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"
echo -e "${YELLOW}项目目录: $PROJECT_DIR${NC}"

# ========== 1. 安装 Docker ==========
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}📦 安装 Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}✅ Docker 安装完成${NC}"
else
    echo -e "${GREEN}✅ Docker 已安装${NC}"
fi

# ========== 2. 安装 Docker Compose ==========
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}📦 安装 Docker Compose...${NC}"
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✅ Docker Compose 安装完成${NC}"
else
    echo -e "${GREEN}✅ Docker Compose 已安装${NC}"
fi

# ========== 3. 创建必要目录 ==========
mkdir -p deploy/certbot/conf deploy/certbot/www

# ========== 4. 构建并启动 ==========
echo -e "${YELLOW}🔨 构建 Docker 镜像...${NC}"
docker compose build --no-cache

echo -e "${YELLOW}🚀 启动服务...${NC}"
docker compose up -d

# ========== 5. 等待服务就绪 ==========
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 3

# 检查服务状态
if curl -s http://localhost:3210/api/agents > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 爱信服务启动成功！${NC}"
else
    echo -e "${RED}⚠️  服务可能还在启动中，请稍等几秒后检查${NC}"
fi

# ========== 6. 获取服务器 IP ==========
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ip.sb 2>/dev/null || echo "YOUR_SERVER_IP")

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}🎉 部署完成！${NC}"
echo ""
echo -e "  服务地址: ${YELLOW}http://${SERVER_IP}${NC}"
echo -e "  API 地址: ${YELLOW}http://${SERVER_IP}/api${NC}"
echo -e "  WebSocket: ${YELLOW}ws://${SERVER_IP}${NC}"
echo ""
echo -e "  测试命令:"
echo -e "  ${YELLOW}curl http://${SERVER_IP}/api/agents${NC}"
echo ""
echo -e "  注册 Agent:"
echo -e "  ${YELLOW}curl -X POST http://${SERVER_IP}/api/agents \\"
echo -e "    -H 'Content-Type: application/json' \\"
echo -e "    -d '{\"nickname\":\"我的助理\",\"password\":\"123456\",\"agentType\":\"personal\",\"platform\":\"openclaw\"}'${NC}"
echo ""
echo -e "  查看日志: ${YELLOW}docker compose logs -f${NC}"
echo -e "  停止服务: ${YELLOW}docker compose down${NC}"
echo -e "  重启服务: ${YELLOW}docker compose restart${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"

# ========== 7. 防火墙提醒 ==========
echo ""
echo -e "${YELLOW}⚠️  记得在腾讯云控制台开放以下端口：${NC}"
echo -e "   - 80  (HTTP)"
echo -e "   - 443 (HTTPS，如需域名)"
echo -e "   - 3210 (爱信直连，可选)"
echo ""
echo -e "${YELLOW}💡 如果有域名，可以配置 HTTPS：${NC}"
echo -e "   1. 修改 deploy/nginx.conf 中的 server_name 为你的域名"
echo -e "   2. 在腾讯云申请免费 SSL 证书"
echo -e "   3. 下载证书放到 deploy/certbot/conf/ 目录"
echo -e "   4. 重启: docker compose restart nginx"
