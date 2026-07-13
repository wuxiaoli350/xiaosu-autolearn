@echo off
chcp 65001 >nul
title 小苏e学 - Chrome 调试模式启动器

echo ========================================
echo   小苏e学刷课 - 启动 Chrome 调试模式
echo ========================================
echo.

:: 解析参数
set PORT=9223
:parse_args
if "%~1"=="" goto :find_chrome
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

:find_chrome
:: 查找 Chrome 安装路径
set CHROME_PATH=

:: 方法1: 标准安装路径
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

:: 方法2: 用户级安装路径
if "%CHROME_PATH%"=="" (
    if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
        set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    )
)

:: 方法3: Chromium
if "%CHROME_PATH%"=="" (
    if exist "C:\Program Files\Chromium\Application\chrome.exe" (
        set "CHROME_PATH=C:\Program Files\Chromium\Application\chrome.exe"
    )
)

:: 方法4: Edge (也支持CDP)
if "%CHROME_PATH%"=="" (
    if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
        set "CHROME_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    )
)
if "%CHROME_PATH%"=="" (
    if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
        set "CHROME_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    )
)

if "%CHROME_PATH%"=="" (
    echo [错误] 未找到 Chrome/Chromium/Edge 浏览器！
    echo 请手动安装 Google Chrome 浏览器后重试。
    echo 下载地址: https://www.google.com/chrome/
    pause
    exit /b 1
)

echo [信息] 找到浏览器: %CHROME_PATH%
echo [信息] 调试端口: %PORT%
echo.

:: 检查是否已有调试端口在运行
netstat -ano | findstr ":%PORT%" >nul
if %errorlevel% equ 0 (
    echo [警告] 端口 %PORT% 已被占用，可能已有 Chrome 调试实例在运行
    echo.
    choice /C YN /M "是否关闭已有实例并重新启动"
    if errorlevel 2 exit /b 0
    if errorlevel 1 (
        for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%"') do (
            taskkill /PID %%a /F >nul 2>&1
        )
        timeout /t 2 /nobreak >nul
    )
)

:: 创建独立的用户数据目录（避免与正常浏览冲突）
set "USER_DATA=%TEMP%\chrome-debug-profile-xiaosu"
echo [信息] 用户数据目录: %USER_DATA%

:: 启动 Chrome 调试模式
echo [信息] 正在启动 Chrome 调试模式...
echo.
echo   ⚠ 重要提示:
echo   - 请在新打开的 Chrome 窗口中登录云学堂
echo   - 登录后进入课程播放页面
echo   - 然后运行 run.bat 启动自动化脚本
echo   - 请勿关闭此命令行窗口
echo   - 自定义端口: start-chrome.bat --port 9223
echo.

start "" "%CHROME_PATH%" ^
    --remote-debugging-port=%PORT% ^
    --user-data-dir="%USER_DATA%" ^
    --no-first-run ^
    --no-default-browser-check ^
    --disable-background-mode ^
    --disable-extensions ^
    --disable-sync ^
    https://yunxuetang.cn

echo [完成] Chrome 已启动！请登录云学堂后运行 run.bat
echo.
pause
