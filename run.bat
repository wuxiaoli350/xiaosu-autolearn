@echo off
title Xiaosu Auto Learn

echo ========================================
echo   Xiaosu Auto Learn v6.1
echo ========================================
echo.

cd /d "%~dp0"

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Install: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo [INFO] Node.js: %%i

:: Create config.json if missing
if not exist "config.json" (
    echo [INFO] Creating config.json...
    (
    echo {
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
    echo [INFO] config.json created
)

:: Check debug port
echo [INFO] Checking debug port 9223...
netstat -ano | findstr ":9223" >nul
if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Debug port 9223 is not open!
    echo Please run start-chrome.bat first, then login to yunxuetang.cn
    echo.
    pause
    exit /b 1
)

:: Install deps
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install --registry=https://registry.npmmirror.com 2>nul
    if %errorlevel% neq 0 call npm install 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    echo [INFO] Dependencies installed
)

echo.
echo ========================================
echo   Running... Press Ctrl+C to stop
echo ========================================
echo.

node auto_learn_v6.js

pause
