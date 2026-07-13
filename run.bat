@echo off
title 小苏e学 - 自动化学习

echo ========================================
echo   小苏e学刷课 v6.1 - 自动化学习脚本
echo ========================================
echo.

:: 切换到脚本所在目录
cd /d "%~dp0"

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js！请先安装 Node.js
    echo 下载地址: https://nodejs.org/ （建议安装 LTS 版本）
    pause
    exit /b 1
)

for /f "tokens=1,2 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%b
if %NODE_MAJOR% LSS 18 (
    echo [错误] Node.js 版本过低！需要 v18+
    echo 请更新 Node.js: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo [信息] Node.js 版本: %%i

:: 自动生成 config.json
if not exist "config.json" (
    echo [信息] 正在创建默认配置 config.json...
    (
    echo {
    echo   "_comment": "小苏e学刷课 配置文件",
    echo   "cdpUrl": "http://localhost:9223",
    echo   "checkInterval": 3000,
    echo   "waitAfterVideoEnd": 2000,
    echo   "maxRetry": 40,
    echo   "videoFastForward": true,
    echo   "fastForwardThreshold": 0.95,
    echo   "smartSkipCompleted": true,
    echo   "notificationEnabled": true,
    echo   "logFile": "auto_learn_v6.log"
    echo }
    ) > config.json
    echo [完成] config.json 已创建
)

:: 检查调试端口
echo [信息] 检查浏览器调试端口 (9223)...
netstat -ano | findstr ":9223" >nul
if %errorlevel% neq 0 (
    echo.
    echo [警告] 浏览器调试端口 9223 未开启！
    echo.
    echo 请先双击 start-edge.bat 启动 Edge 调试模式
    echo 然后在新打开的浏览器中登录云学堂
    echo.
    choice /C YN /M "是否现在启动 Edge 调试模式"
    if errorlevel 2 exit /b 0
    if errorlevel 1 (
        call "%~dp0start-edge.bat"
        echo.
        pause
    )
)

:: 检查依赖
if not exist "node_modules" (
    echo [信息] 正在安装依赖...
    call npm install --registry=https://registry.npmmirror.com 2>nul
    if %errorlevel% neq 0 call npm install 2>nul
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [完成] 依赖安装成功
)

echo.
echo ========================================
echo   1. 确保浏览器已打开云学堂课程页面
echo   2. 视频自动快进，考试自动答题
echo   3. 按 Ctrl+C 停止脚本
echo ========================================
echo.

node auto_learn_v6.js

pause
