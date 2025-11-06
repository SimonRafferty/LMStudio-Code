#!/bin/bash

# LMCode Uninstallation Script for Mac/Linux
# Usage: bash uninstall.sh
# Or: chmod +x uninstall.sh && ./uninstall.sh

set -e  # Exit on error

echo "========================================"
echo "LMCode Uninstallation Script"
echo "========================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if lmcode is installed
if ! command -v lmcode &> /dev/null; then
    echo "LMCode does not appear to be installed globally"
    echo "Nothing to uninstall"
    exit 0
fi

echo "Current LMCode version:"
lmcode --version
echo ""

# Confirm uninstallation
echo "This will remove LMCode from your system."
echo "Your project .lmcode directories will NOT be deleted."
echo ""
read -p "Are you sure you want to uninstall? (y/N): " confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Uninstallation cancelled"
    exit 0
fi

echo ""
echo "Uninstalling LMCode..."

# Navigate to script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# Determine if sudo is needed
NEED_SUDO=false
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    NEED_SUDO=true
fi

# Try npm unlink first
UNLINKED=false
if [ "$NEED_SUDO" = true ]; then
    if sudo npm unlink &>/dev/null; then
        UNLINKED=true
        echo -e "${GREEN}LMCode uninstalled successfully using npm unlink${NC}"
    fi
else
    if npm unlink &>/dev/null; then
        UNLINKED=true
        echo -e "${GREEN}LMCode uninstalled successfully using npm unlink${NC}"
    fi
fi

# If unlink didn't work, try global uninstall
if [ "$UNLINKED" = false ]; then
    if [ "$NEED_SUDO" = true ]; then
        if sudo npm uninstall -g lmcode &>/dev/null || sudo npm uninstall -g lmstudio-context-manager &>/dev/null; then
            echo -e "${GREEN}LMCode uninstalled successfully${NC}"
        else
            echo -e "${RED}WARNING: Could not uninstall automatically${NC}"
            echo "You may need to run: sudo npm unlink -g lmcode"
            exit 1
        fi
    else
        if npm uninstall -g lmcode &>/dev/null || npm uninstall -g lmstudio-context-manager &>/dev/null; then
            echo -e "${GREEN}LMCode uninstalled successfully${NC}"
        else
            echo -e "${RED}WARNING: Could not uninstall automatically${NC}"
            echo "You may need to run: npm unlink -g lmcode"
            exit 1
        fi
    fi
fi

# Verify uninstallation
echo ""
echo "Verifying uninstallation..."

# Give the system a moment
sleep 1

if ! command -v lmcode &> /dev/null; then
    echo ""
    echo "========================================"
    echo "Uninstallation successful!"
    echo "========================================"
    echo ""
    echo "LMCode has been removed from your system."
    echo ""
    echo "Note: Your project .lmcode directories were not deleted."
    echo "You can manually delete them from each project if needed."
    echo ""
else
    echo ""
    echo -e "${YELLOW}WARNING: 'lmcode' command still found${NC}"
    echo "You may need to restart your terminal"
    echo "Or run: hash -r (to refresh command cache)"
    echo ""
fi
