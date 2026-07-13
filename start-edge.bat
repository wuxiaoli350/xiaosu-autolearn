@echo off
title Xiaosu Auto Learn - Edge Launcher

echo ========================================
echo   Xiaosu Auto Learn - Launch Edge Debug
echo ========================================
echo.

:: Find Edge
set EDGE=
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if "%EDGE%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

:: Fallback: Chrome
if "%EDGE%"=="" if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "EDGE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if "%EDGE%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "EDGE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if "%EDGE%"=="" (
    echo [ERROR] Browser not found!
    echo Install Edge: https://www.microsoft.com/edge
    pause
    exit /b 1
)

echo [INFO] Browser: %EDGE%
echo.

:: Kill existing browser
echo [INFO] Closing existing browser...
taskkill /F /IM msedge.exe >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: Launch
set "USER_DATA=%TEMP%\edge-debug-profile-xiaosu"
echo [INFO] Launching browser on port 9223...
echo.

start "" "%EDGE%" --remote-debugging-port=9223 --user-data-dir="%USER_DATA%" --no-first-run --no-default-browser-check https://yunxuetang.cn

timeout /t 4 /nobreak >nul

:: Verify
netstat -ano | findstr ":9223" >nul
if %errorlevel% equ 0 (
    echo [SUCCESS] Debug port 9223 is open!
    echo Login to yunxuetang.cn then run: run.bat
) else (
    echo [FAILED] Port 9223 not open
    echo Try running this command manually:
    echo "%EDGE%" --remote-debugging-port=9223 --user-data-dir="%TEMP%\edge-debug-profile-xiaosu"
)

echo.
pause
