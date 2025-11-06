@echo off
setlocal

echo ========================================
echo LMCode Uninstallation Script
echo ========================================
echo.

:: Check if lmcode is installed
lmcode --version >nul 2>&1
if %errorlevel% neq 0 (
    echo LMCode does not appear to be installed globally
    echo Nothing to uninstall
    pause
    exit /b 0
)

echo Current LMCode version:
lmcode --version
echo.

:: Confirm uninstallation
echo This will remove LMCode from your system.
echo Your project .lmcode directories will NOT be deleted.
echo.
set /p confirm="Are you sure you want to uninstall? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo Uninstallation cancelled
    pause
    exit /b 0
)

echo.
echo Uninstalling LMCode...

:: Navigate to script directory
cd /d "%~dp0"

:: Try npm unlink first
call npm unlink >nul 2>&1
if %errorlevel% equ 0 (
    echo LMCode uninstalled successfully using npm unlink
) else (
    :: Try global uninstall
    call npm uninstall -g lmstudio-context-manager >nul 2>&1
    if %errorlevel% equ 0 (
        echo LMCode uninstalled successfully
    ) else (
        echo WARNING: Could not uninstall automatically
        echo You may need to run this script as Administrator
        echo.
        echo Or manually run: npm unlink -g lmcode
        pause
        exit /b 1
    )
)

:: Verify uninstallation
echo.
echo Verifying uninstallation...
lmcode --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo Uninstallation successful!
    echo ========================================
    echo.
    echo LMCode has been removed from your system.
    echo.
    echo Note: Your project .lmcode directories were not deleted.
    echo You can manually delete them from each project if needed.
    echo.
) else (
    echo.
    echo WARNING: 'lmcode' command still found
    echo You may need to restart your terminal
    echo.
)

pause
