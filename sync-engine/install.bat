@echo off
REM ================================================================
REM  Access-to-PostgreSQL Sync Engine - Windows Installation Script
REM ================================================================
echo.
echo  Access to PostgreSQL Sync Engine - Installer
echo  =============================================
echo.

REM Check Python is available
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python is not installed or not in PATH.
    echo Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/4] Creating virtual environment...
python -m venv venv
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create virtual environment.
    pause
    exit /b 1
)

echo [2/4] Activating virtual environment...
call venv\Scripts\activate.bat

echo [3/4] Installing dependencies...
pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

echo [4/4] Creating logs directory...
if not exist logs mkdir logs

echo.
echo ================================================================
echo  Installation complete!
echo.
echo  Next steps:
echo    1. Edit config.json with your database settings
echo    2. Test: python sync_engine.py --list-tables
echo    3. Run:  python sync_engine.py
echo.
echo  For Windows service:
echo    python sync_engine.py install
echo    python sync_engine.py start
echo ================================================================
echo.
pause
