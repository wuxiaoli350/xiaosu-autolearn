@echo off
chcp 65001 >nul
title 小苏e学 - 自动化学习

echo ========================================
echo   小苏e学刷课 v6.1 - 自动化学习脚本
echo ========================================
echo.

:: 切换到脚本所在目录
cd /d "%~dp0"

:: 解析参数：run.bat --port 9223
set PORT=9223
:parse_args
if "%~1"=="" goto :check_node
if /i "%~1"=="--port" (
    set PORT=%~2
    shift
    shift
    goto :parse_args
)
if /i "%~1"=="-p" (
    set PORT=%~2
    shift
    shift
    goto :parse_args
)
shift
goto :parse_args

:check_node
:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js！请先安装 Node.js
    echo 下载地址: https://nodejs.org/ （建议安装 LTS 版本）
    pause
    exit /b 1
)

:: 显示 Node.js 版本并校验最低版本
for /f "tokens=1,2 delims=v." %%a in ('node -v') do (
    set NODE_MAJOR=%%b
)
if %NODE_MAJOR% LSS 18 (
    echo [错误] Node.js 版本过低！当前 v%NODE_MAJOR%.x，需要 v18+
    echo 请更新 Node.js: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo [信息] Node.js 版本: %%i

:: 自动生成 config.json（如果不存在）
if not exist "config.json" (
    echo [信息] 首次运行，正在创建默认配置文件 config.json...
    (
    echo {
    echo   "_comment": "小苏e学刷课 配置文件",
    echo   "cdpUrl": "http://localhost:%PORT%",
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

:: 检查 Chrome 调试端口
echo [信息] 检查 Chrome 调试端口 (%PORT%)...
netstat -ano | findstr ":%PORT%" >nul
if %errorlevel% neq 0 (
    echo.
    echo [警告] Chrome 调试端口 %PORT% 未开启！
    echo.
    echo 请先运行 start-chrome.bat 启动 Chrome 调试模式，
    echo 然后在新打开的浏览器中登录云学堂，再回到这里运行此脚本。
    echo.
    choice /C YN /M "是否现在启动 Chrome 调试模式"
    if errorlevel 2 exit /b 0
    if errorlevel 1 (
        call "%~dp0start-chrome.bat"
        echo.
        echo 请在 Chrome 中登录云学堂后，按任意键继续...
        pause >nul
    )
)

:: 检查依赖
if not exist "node_modules" (
    echo [信息] 首次运行，正在安装依赖...
    echo      （node-notifier 是可选依赖，安装失败不影响使用）
    call npm install --no-optional 2>nul
    if %errorlevel% neq 0 (
        echo [警告] 依赖安装失败，尝试使用镜像源...
        call npm install --no-optional --registry=https://registry.npmmirror.com
        if %errorlevel% neq 0 (
            echo [错误] 依赖安装失败，请检查网络连接后重试
            pause
            exit /b 1
        )
    )
    echo [信息] 正在安装桌面通知支持（可选）...
    call npm install node-notifier 2>nul
    echo [完成] 依赖安装成功
)

echo.
echo ========================================
echo   ⚠ 重要提示
echo ========================================
echo.
echo   1. 确保 Chrome 已打开云学堂课程播放页面
echo   2. 视频将自动快进到末尾并跳过已完成课程
echo   3. 考试将自动答题，桌面会弹出通知
echo   4. 日志实时显示并保存到 auto_learn_v6.log
echo   5. 按 Ctrl+C 可停止脚本
echo   6. 编辑 config.json 可自定义行为
echo.
echo ========================================
echo.

:: 运行脚本
node auto_learn_v6.js

pause
