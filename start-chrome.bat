@echo off
title Xiaosu Auto Learn - Chrome Launcher

echo ========================================
echo   Xiaosu Auto Learn - Launch Chrome Debug
echo ========================================
echo.

:: Find Chrome
set CHROME=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if "%CHROME%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if "%CHROME%"=="" if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

:: Fallback: Edge
if "%CHROME%"=="" if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "CHROME=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if "%CHROME%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "CHROME=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if "%CHROME%"=="" (
    echo [ERROR] Browser not found!
    echo Install Chrome: https://www.google.com/chrome/
    pause
    exit /b 1
)

echo [INFO] Browser: %CHROME%
echo.

:: Kill existing
echo [INFO] Closing existing browser...
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM msedge.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: Launch
set "USER_DATA=%TEMP%\chrome-debug-profile-xiaosu"
echo [INFO] Launching Chrome on port 9223...
echo.

start "" "%CHROME%" --remote-debugging-port=9223 --user-data-dir="%USER_DATA%" --no-first-run --no-default-browser-check https://yunxuetang.cn

timeout /t 4 /nobreak >nul

:: Verify
netstat -ano | findstr ":9223" >nul
if %errorlevel% equ 0 (
    echo [SUCCESS] Debug port 9223 is open!
    echo Login to yunxuetang.cn then run: run.bat
) else (
    echo [FAILED] Port 9223 not open
    echo Try manually:
    echo "%CHROME%" --remote-debugging-port=9223 --user-data-dir="%TEMP%\chrome-debug-profile-xiaosu"
)

echo.
pause
