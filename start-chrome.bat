@echo off
title 小苏e学 - Chrome 调试模式启动器

echo ========================================
echo   小苏e学刷课 - 启动 Chrome 调试模式
echo ========================================
echo.

:: 查找 Chrome
set CHROME_PATH=

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if "%CHROME_PATH%"=="" if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if "%CHROME_PATH%"=="" if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "CHROME_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if "%CHROME_PATH%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "CHROME_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if "%CHROME_PATH%"=="" (
    echo [错误] 未找到 Chrome 或 Edge 浏览器
    echo 请安装 Google Chrome: https://www.google.com/chrome/
    pause
    exit /b 1
)

echo [信息] 浏览器: %CHROME_PATH%
echo.

:: 关闭已有 Chrome
echo [信息] 正在关闭已有的 Chrome...
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM msedge.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: 用户数据目录
set "USER_DATA=%TEMP%\chrome-debug-profile-xiaosu"
if exist "%USER_DATA%" (
    echo [信息] 清理旧的用户数据...
    rd /s /q "%USER_DATA%" >nul 2>&1
)

echo [信息] 正在启动 Chrome（端口 9223）...
echo.

:: 启动
start "" "%CHROME_PATH%" --remote-debugging-port=9223 --user-data-dir="%USER_DATA%" --no-first-run --no-default-browser-check https://yunxuetang.cn

timeout /t 4 /nobreak >nul

:: 验证
netstat -ano | findstr ":9223" >nul
if %errorlevel% equ 0 (
    echo ========================================
    echo   [成功] Chrome 已启动！
    echo   请在浏览器中登录云学堂，然后双击 run.bat
    echo ========================================
) else (
    echo ========================================
    echo   [失败] 端口 9223 未开启
    echo ========================================
    echo.
    echo 可能原因：
    echo   1. Chrome 安装路径不正确
    echo   2. 杀毒软件拦截了 Chrome 启动
    echo.
    echo 请手动尝试：
    echo   按 Win+R，粘贴以下命令并回车：
    echo.
    echo   "%CHROME_PATH%" --remote-debugging-port=9223 --user-data-dir="%TEMP%\chrome-debug-profile-xiaosu"
    echo.
)

echo.
pause
