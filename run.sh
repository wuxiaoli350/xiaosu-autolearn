#!/bin/bash

echo "========================================"
echo "  小苏e学刷课 v6.1 - 自动化学习脚本"
echo "========================================"
echo ""

cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js！请安装: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "[错误] Node.js 版本过低！需要 v18+"
    exit 1
fi

echo "[信息] Node.js 版本: $(node -v)"

if [ ! -f "config.json" ]; then
    echo "[信息] 创建默认配置 config.json..."
    cat > config.json << 'EOF'
{
  "_comment": "小苏e学刷课 配置文件",
  "cdpUrl": "http://localhost:9223",
  "checkInterval": 3000,
  "waitAfterVideoEnd": 2000,
  "maxRetry": 40,
  "videoFastForward": true,
  "fastForwardThreshold": 0.95,
  "smartSkipCompleted": true,
  "notificationEnabled": true,
  "logFile": "auto_learn_v6.log"
}
EOF
fi

echo "[信息] 检查浏览器调试端口 (9223)..."
if ! lsof -i :9223 &> /dev/null; then
    echo "[警告] 端口 9223 未开启！"
    read -p "是否启动 Edge 调试模式? (y/N): " choice
    if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
        bash "$(dirname "$0")/start-edge.sh"
        read -p "登录后按 Enter 继续..."
    else
        exit 0
    fi
fi

if [ ! -d "node_modules" ]; then
    echo "[信息] 安装依赖..."
    npm install --registry=https://registry.npmmirror.com 2>/dev/null || npm install
fi

echo ""
echo "========================================"
echo "  1. 确保浏览器已打开云学堂课程页面"
echo "  2. 视频自动快进，考试自动答题"
echo "  3. 按 Ctrl+C 停止脚本"
echo "========================================"
echo ""

node auto_learn_v6.js
