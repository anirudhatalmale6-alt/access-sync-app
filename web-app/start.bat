@echo off
title Access Sync Web App
echo ============================================
echo   Access Sync Web Dashboard
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo.

:: Check if node_modules exists
if not exist "node_modules" (
    echo Installing server dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
    echo.
)

:: Check if client is built
if not exist "server\public\index.html" (
    echo Client not built. Building now...
    if not exist "client\node_modules" (
        echo Installing client dependencies...
        cd client
        call npm install
        cd ..
    )
    call npm run build
    if %errorlevel% neq 0 (
        echo ERROR: Client build failed.
        pause
        exit /b 1
    )
    echo.
)

echo Starting server on http://localhost:3500
echo Press Ctrl+C to stop.
echo.

node server/index.js
pause
