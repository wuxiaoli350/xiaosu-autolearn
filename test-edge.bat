@echo off
title Xiaosu Auto Learn - Diagnostic

echo ========================================
echo   Browser Diagnostic Tool
echo ========================================
echo.

echo [TEST] Writing test file to desktop...
echo TEST > "%USERPROFILE%\Desktop\xiaosu_test.txt"

:: Find browser
set EDGE=
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if "%EDGE%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if "%EDGE%"=="" if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "EDGE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if "%EDGE%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "EDGE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if "%EDGE%"=="" (
    echo [FAIL] No browser found
    echo Please install Edge or Chrome
    pause
    exit /b 1
)

echo [OK] Browser: %EDGE%
echo.

:: Kill existing
taskkill /F /IM msedge.exe >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: Launch
echo [INFO] Launching browser...
start "" "%EDGE%" --remote-debugging-port=9223 --user-data-dir="%TEMP%\edge-test-profile" https://www.baidu.com
timeout /t 4 /nobreak >nul

:: Verify
netstat -ano | findstr ":9223" >nul
if %errorlevel% equ 0 (
    echo [OK] Port 9223 is open! Browser debug mode works.
) else (
    echo [FAIL] Port 9223 not open
)

pause
