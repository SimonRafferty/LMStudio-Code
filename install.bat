@echo off
setlocal enabledelayedexpansion

echo ========================================
echo LMCode Installation Script
echo ========================================
echo.

:: Check if Node.js is installed
echo [1/4] Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VERSION=%%i
echo Node.js %NODE_VERSION% found!
echo.

:: Check if npm is available
echo [2/4] Checking npm...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not installed or not in PATH
    echo npm should come with Node.js
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version 2^>nul') do set NPM_VERSION=%%i
echo npm %NPM_VERSION% found!
echo.

:: Navigate to script directory
echo Navigating to installation directory...
cd /d "%~dp0"
if %errorlevel% neq 0 (
    echo ERROR: Could not navigate to installation directory
    pause
    exit /b 1
)
echo Current directory: %CD%
echo.

:: Install dependencies
echo [3/4] Installing dependencies...
echo This may take a few minutes...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to install dependencies
    echo Please check your internet connection and try again
    echo.
    echo If the problem persists, try manually running:
    echo   npm install
    pause
    exit /b 1
)
echo.
echo Dependencies installed successfully!
echo.

:: Link package globally
echo [4/4] Installing LMCode globally...
call npm link
if %errorlevel% neq 0 (
    echo.
    echo WARNING: npm link failed (possibly due to permissions)
    echo Trying alternative installation method...
    echo.
    call npm install -g .
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: Global installation failed
        echo.
        echo Please try one of these solutions:
        echo   1. Run this script as Administrator:
        echo      Right-click install.bat and select "Run as administrator"
        echo   2. Or manually run: npm link
        echo   3. Or manually run: npm install -g .
        pause
        exit /b 1
    )
)
echo.
echo Global installation completed!
echo.

:: Verify installation
echo ========================================
echo Verifying installation...
echo ========================================
echo.

:: Give Windows a moment to update PATH
timeout /t 2 /nobreak >nul 2>&1

where lmcode >nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: 'lmcode' command not found in PATH yet
    echo This is normal. Please restart your terminal/command prompt.
    echo.
    echo After restarting, verify with: lmcode --version
) else (
    for /f "tokens=*" %%i in ('lmcode --version 2^>nul') do set LMCODE_VERSION=%%i
    echo LMCode !LMCODE_VERSION! installed successfully!
)

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Next Steps:
echo   1. Close and reopen your terminal/command prompt
echo   2. Navigate to any project: cd C:\your\project
echo   3. Initialize LMCode: lmcode init
echo   4. Index your codebase: lmcode index
echo   5. Start coding: lmcode
echo.
echo For more information, see README.md or QUICKSTART.md
echo.

pause
