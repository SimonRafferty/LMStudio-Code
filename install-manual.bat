@echo off
echo ========================================
echo LMCode Manual Installation
echo ========================================
echo.
echo This script will guide you through manual installation
echo if the automatic installer doesn't work.
echo.
pause

cd /d "%~dp0"

echo.
echo Step 1: Installing dependencies...
echo.
npm install
echo.

if %errorlevel% neq 0 (
    echo ERROR: npm install failed
    echo Check that you have internet connection
    pause
    exit /b 1
)

echo Dependencies installed!
echo.
echo Step 2: Installing globally...
echo.
echo Trying npm link...
npm link

if %errorlevel% neq 0 (
    echo.
    echo npm link failed, trying npm install -g...
    npm install -g .

    if %errorlevel% neq 0 (
        echo.
        echo Both methods failed. Please run as Administrator:
        echo   Right-click this file and select "Run as administrator"
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Please restart your command prompt, then test with:
echo   lmcode --version
echo.
pause
