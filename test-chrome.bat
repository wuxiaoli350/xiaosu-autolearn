@echo off
echo TEST > "%USERPROFILE%\Desktop\xiaosu_test.txt"
echo ========================================
echo   测试脚本 - 如果看到这个窗口说明 BAT 可以运行
echo ========================================
echo.
echo 桌面已生成 xiaosu_test.txt 文件
echo.

:: 检查 Chrome
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo Chrome 找到: C:\Program Files\Google\Chrome\Application\chrome.exe
    set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
    goto :launch
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    echo Chrome 找到: C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
    set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    goto :launch
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    echo Chrome 找到: %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
    set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    goto :launch
)

echo [错误] 没有找到 Chrome，请手动安装
pause
exit /b 1

:launch
echo.
echo 正在启动 Chrome...
start "" "%CHROME%" --remote-debugging-port=9223 --user-data-dir="%TEMP%\chrome-test-profile" https://www.baidu.com

timeout /t 3 /nobreak >nul

netstat -ano | findstr ":9223" >nul
if %errorlevel% equ 0 (
    echo [成功] Chrome 调试端口 9223 已开启！
) else (
    echo [失败] 端口 9223 未开启
    echo 可能是 Chrome 已在运行导致冲突
    echo 请关闭所有 Chrome 窗口后重试
)

pause
