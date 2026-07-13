#!/bin/bash

echo "========================================"
echo "  小苏e学刷课 v6.1 - 自动化学习脚本"
echo "========================================"
echo ""

# 切换到脚本所在目录
cd "$(dirname "$0")"

# 解析参数
PORT=9223
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port|-p) PORT="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js！请先安装 Node.js"
    echo "下载地址: https://nodejs.org/ （建议安装 LTS 版本）"
    echo ""
    echo "macOS 用户也可通过 Homebrew 安装: brew install node"
    exit 1
fi

# 校验最低版本
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "[错误] Node.js 版本过低！当前 v$NODE_VERSION.x，需要 v18+"
    echo "请更新 Node.js: https://nodejs.org/"
    exit 1
fi

echo "[信息] Node.js 版本: $(node -v)"

# 自动生成 config.json（如果不存在）
if [ ! -f "config.json" ]; then
    echo "[信息] 首次运行，正在创建默认配置文件 config.json..."
    cat > config.json << EOF
{
  "_comment": "小苏e学刷课 配置文件",
  "cdpUrl": "http://localhost:$PORT",
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
    echo "[完成] config.json 已创建"
fi

# 检查 Chrome 调试端口
echo "[信息] 检查 Chrome 调试端口 ($PORT)..."
if ! lsof -i ":$PORT" &> /dev/null; then
    echo ""
    echo "[警告] Chrome 调试端口 $PORT 未开启！"
    echo ""
    echo "请先运行 ./start-chrome.sh 启动 Chrome 调试模式，"
    echo "然后在新打开的浏览器中登录云学堂，再回到这里运行此脚本。"
    echo ""
    read -p "是否现在启动 Chrome 调试模式? (y/N): " choice
    if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
        bash "$(dirname "$0")/start-chrome.sh"
        echo ""
        read -p "请在 Chrome 中登录云学堂后，按 Enter 继续..."
    else
        exit 0
    fi
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "[信息] 首次运行，正在安装依赖..."
    echo "      （node-notifier 是可选依赖，安装失败不影响使用）"
    npm install --no-optional 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "[警告] 依赖安装失败，尝试使用镜像源..."
        npm install --no-optional --registry=https://registry.npmmirror.com
        if [ $? -ne 0 ]; then
            echo "[错误] 依赖安装失败，请检查网络连接后重试"
            exit 1
        fi
    fi
    echo "[信息] 正在安装桌面通知支持（可选）..."
    npm install node-notifier 2>/dev/null || true
    echo "[完成] 依赖安装成功"
fi

echo ""
echo "========================================"
echo "  ⚠ 重要提示"
echo "========================================"
echo ""
echo "  1. 确保 Chrome 已打开云学堂课程播放页面"
echo "  2. 视频将自动快进到末尾并跳过已完成课程"
echo "  3. 考试将自动答题，桌面会弹出通知"
echo "  4. 日志实时显示并保存到 auto_learn_v6.log"
echo "  5. 按 Ctrl+C 可停止脚本"
echo "  6. 编辑 config.json 可自定义行为"
echo ""
echo "========================================"
echo ""

# 运行脚本
node auto_learn_v6.js
