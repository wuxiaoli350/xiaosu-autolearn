#!/bin/bash

echo "========================================"
echo "  小苏e学刷课 - 启动 Edge 调试模式"
echo "========================================"
echo ""

BROWSER_PATH=""
BROWSER_NAME=""

# macOS Edge
if [ -z "$BROWSER_PATH" ] && [ -f "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
    BROWSER_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    BROWSER_NAME="Microsoft Edge"
fi

# macOS Chrome (备选)
if [ -z "$BROWSER_PATH" ] && [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    BROWSER_NAME="Google Chrome"
fi

# Linux
if [ -z "$BROWSER_PATH" ]; then
    for cmd in microsoft-edge google-chrome google-chrome-stable chromium-browser chromium; do
        if command -v "$cmd" &> /dev/null; then
            BROWSER_PATH="$cmd"
            BROWSER_NAME="$cmd"
            break
        fi
    done
fi

if [ -z "$BROWSER_PATH" ]; then
    echo "[错误] 未找到 Edge 或 Chrome 浏览器！"
    exit 1
fi

echo "[信息] 浏览器: $BROWSER_NAME"
echo ""

# 关闭已有
echo "[信息] 关闭已有浏览器..."
killall "Microsoft Edge" 2>/dev/null
killall "Google Chrome" 2>/dev/null
sleep 2

# 清理并启动
USER_DATA="${TMPDIR:-/tmp}/edge-debug-profile-xiaosu"
rm -rf "$USER_DATA" 2>/dev/null

echo "[信息] 正在启动 $BROWSER_NAME（端口 9223）..."
nohup "$BROWSER_PATH" --remote-debugging-port=9223 --user-data-dir="$USER_DATA" --no-first-run --no-default-browser-check "https://yunxuetang.cn" > /dev/null 2>&1 &

sleep 4

if lsof -i :9223 &> /dev/null; then
    echo "[成功] 浏览器调试端口 9223 已开启！"
    echo "请在浏览器中登录云学堂，然后运行 ./run.sh"
else
    echo "[失败] 端口 9223 未开启"
fi
echo ""
