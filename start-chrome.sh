#!/bin/bash

echo "========================================"
echo "  小苏e学刷课 - 启动 Chrome 调试模式"
echo "========================================"
echo ""

# 解析参数
PORT=9223
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port|-p) PORT="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# 查找 Chrome 安装路径
CHROME_PATH=""

# 方法1: macOS 标准路径
if [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

# 方法2: Chromium
if [ -z "$CHROME_PATH" ] && [ -f "/Applications/Chromium.app/Contents/MacOS/Chromium" ]; then
    CHROME_PATH="/Applications/Chromium.app/Contents/MacOS/Chromium"
fi

# 方法3: Edge
if [ -z "$CHROME_PATH" ] && [ -f "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
    CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
fi

# 方法4: Linux (google-chrome)
if [ -z "$CHROME_PATH" ]; then
    if command -v google-chrome &> /dev/null; then
        CHROME_PATH="google-chrome"
    elif command -v google-chrome-stable &> /dev/null; then
        CHROME_PATH="google-chrome-stable"
    elif command -v chromium-browser &> /dev/null; then
        CHROME_PATH="chromium-browser"
    elif command -v chromium &> /dev/null; then
        CHROME_PATH="chromium"
    elif command -v microsoft-edge &> /dev/null; then
        CHROME_PATH="microsoft-edge"
    fi
fi

if [ -z "$CHROME_PATH" ]; then
    echo "[错误] 未找到 Chrome/Chromium/Edge 浏览器！"
    echo "请手动安装 Google Chrome 浏览器后重试。"
    echo "下载地址: https://www.google.com/chrome/"
    exit 1
fi

echo "[信息] 找到浏览器: $CHROME_PATH"
echo "[信息] 调试端口: $PORT"
echo ""

# 检查端口是否被占用
if lsof -i ":$PORT" &> /dev/null; then
    echo "[警告] 端口 $PORT 已被占用，可能已有 Chrome 调试实例在运行"
    read -p "是否关闭已有实例并重新启动? (y/N): " choice
    if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
        kill $(lsof -t -i ":$PORT") 2>/dev/null
        sleep 2
    else
        exit 0
    fi
fi

# 创建独立的用户数据目录
USER_DATA="${TMPDIR:-/tmp}/chrome-debug-profile-xiaosu"
echo "[信息] 用户数据目录: $USER_DATA"

# 启动 Chrome 调试模式
echo "[信息] 正在启动 Chrome 调试模式..."
echo ""
echo "  ⚠ 重要提示:"
echo "  - 请在新打开的 Chrome 窗口中登录云学堂"
echo "  - 登录后进入课程播放页面"
echo "  - 然后运行 ./run.sh 启动自动化脚本"
echo "  - 请勿关闭此终端窗口"
echo "  - 自定义端口: ./start-chrome.sh --port 9223"
echo ""

nohup "$CHROME_PATH" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$USER_DATA" \
    --no-first-run \
    --no-default-browser-check \
    --disable-background-mode \
    --disable-extensions \
    --disable-sync \
    "https://yunxuetang.cn" \
    > /dev/null 2>&1 &

echo "[完成] Chrome 已启动！请登录云学堂后运行 ./run.sh"
echo ""
