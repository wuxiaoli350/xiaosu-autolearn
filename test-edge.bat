@echo off
title 小苏e学 - Edge 诊断工具

echo ========================================
echo   Edge 浏览器诊断
echo ========================================
echo.

:: 在桌面生成测试文件
echo TEST > "%USERPROFILE%\Desktop\xiaosu_test.txt"
echo [OK] 桌面已生成 xiaosu_test.txt

:: 找 Edge
set EDGE=
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if "%EDGE%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if "%EDGE%"=="" (
    echo [FAIL] 未找到 Edge，尝试 Chrome...
    if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "EDGE=C:\Program Files\Google\Chrome\Application\chrome.exe"
    if "%EDGE%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "EDGE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if "%EDGE%"=="" (
    echo [FAIL] 未找到任何浏览器！请安装 Edge 或 Chrome
    pause
    exit /b 1
)

echo [OK] 浏览器: %EDGE%
echo.

:: 关闭已有
echo [INFO] 关闭已有浏览器...
taskkill /F /IM msedge.exe >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: 启动
echo [INFO] 启动浏览器调试模式...
start "" "%EDGE%" --remote-debugging-port=9223 --user-data-dir="%TEMP%\edge-test-profile" https://www.baidu.com
timeout /t 4 /nobreak >nul

:: 验证
netstat -ano | findstr ":9223" >nul
if %errorlevel% equ 0 (
    echo [OK] 端口 9223 开启成功！
) else (
    echo [FAIL] 端口 9223 未开启
)

pause
