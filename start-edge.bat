@echo off
title 小苏e学 - Edge 调试模式启动器

echo ========================================
echo   小苏e学刷课 - 启动 Edge 调试模式
echo ========================================
echo.

:: 查找 Edge（优先 Edge，备选 Chrome）
set BROWSER_PATH=
set BROWSER_NAME=

:: 方法1: Edge 标准安装路径
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge"
)
if "%BROWSER_PATH%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge"
)

:: 方法2: Chrome（备选）
if "%BROWSER_PATH%"=="" if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome"
)
if "%BROWSER_PATH%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome"
)
if "%BROWSER_PATH%"=="" if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome"
)

if "%BROWSER_PATH%"=="" (
    echo [错误] 未找到 Edge 或 Chrome 浏览器！
    echo Edge 是 Windows 10/11 自带的浏览器，无需额外安装。
    echo 如果确实没有，请从以下地址安装：
    echo   Edge: https://www.microsoft.com/edge
    echo   Chrome: https://www.google.com/chrome/
    pause
    exit /b 1
)

echo [信息] 浏览器: %BROWSER_NAME%
echo [信息] 路径: %BROWSER_PATH%
echo.

:: 关闭已有浏览器进程
echo [信息] 正在关闭已有的浏览器...
taskkill /F /IM msedge.exe >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: 用户数据目录
set "USER_DATA=%TEMP%\edge-debug-profile-xiaosu"
if exist "%USER_DATA%" (
    echo [信息] 清理旧的用户数据...
    rd /s /q "%USER_DATA%" >nul 2>&1
)

echo [信息] 正在启动 %BROWSER_NAME%（调试端口 9223）...
echo.

start "" "%BROWSER_PATH%" --remote-debugging-port=9223 --user-data-dir="%USER_DATA%" --no-first-run --no-default-browser-check https://yunxuetang.cn

timeout /t 4 /nobreak >nul

:: 验证
netstat -ano | findstr ":9223" >nul
if %errorlevel% equ 0 (
    echo ========================================
    echo   [成功] 浏览器调试端口 9223 已开启！
    echo ========================================
    echo.
    echo 请在浏览器中登录云学堂，然后双击 run.bat
) else (
    echo ========================================
    echo   [失败] 端口 9223 未开启
    echo ========================================
    echo.
    echo 请手动在 cmd 中执行：
    echo   "%BROWSER_PATH%" --remote-debugging-port=9223 --user-data-dir="%TEMP%\edge-debug-profile-xiaosu"
)

echo.
pause
