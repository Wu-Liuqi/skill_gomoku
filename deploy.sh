#!/bin/bash

# 技能五子棋部署脚本
echo "开始部署技能五子棋项目..."

# 项目路径
PROJECT_PATH="/opt/wuziqi/skill_gomoku"
NGINX_SITES_PATH="/etc/nginx/sites-available"
NGINX_ENABLED_PATH="/etc/nginx/sites-enabled"

# 进入项目目录
cd $PROJECT_PATH

# 创建日志目录
mkdir -p logs

# 停止现有的PM2进程
echo "停止现有进程..."
pm2 stop skills-gomoku 2>/dev/null || true
pm2 delete skills-gomoku 2>/dev/null || true

# 安装依赖
echo "安装项目依赖..."
npm install --production

# 配置nginx
echo "配置nginx..."
sudo cp nginx.conf $NGINX_SITES_PATH/skills-gomoku
sudo ln -sf $NGINX_SITES_PATH/skills-gomoku $NGINX_ENABLED_PATH/skills-gomoku

# 删除默认nginx配置（如果存在）
sudo rm -f $NGINX_ENABLED_PATH/default

# 测试nginx配置
echo "测试nginx配置..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "nginx配置测试通过"
    sudo systemctl reload nginx
else
    echo "nginx配置测试失败，请检查配置"
    exit 1
fi

# 启动应用
echo "启动应用..."
pm2 start ecosystem.config.js

# 保存PM2配置
pm2 save
pm2 startup

echo "部署完成！"
echo "应用状态："
pm2 status

echo ""
echo "访问地址："
echo "HTTP: http://www.skills-gomoku.online"
echo "IP: http://119.29.14.50"
echo ""
echo "监控命令："
echo "pm2 monit          # 实时监控"
echo "pm2 logs           # 查看日志"
echo "pm2 status         # 查看状态"