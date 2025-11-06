#!/bin/bash

# LMCode Installation Script for Mac/Linux
# Usage: bash install.sh
# Or: chmod +x install.sh && ./install.sh

set -e  # Exit on error

echo "========================================"
echo "LMCode Installation Script"
echo "========================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Node.js is installed
echo "[1/4] Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    echo ""
    echo "Installation methods:"
    echo "  macOS:   brew install node"
    echo "  Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "  Fedora:  curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash - && sudo dnf install nodejs"
    exit 1
fi

NODE_VERSION=$(node --version 2>/dev/null)
echo -e "${GREEN}Node.js $NODE_VERSION found!${NC}"
echo ""

# Check if npm is available
echo "[2/4] Checking npm..."
if ! command -v npm &> /dev/null; then
    echo -e "${RED}ERROR: npm is not installed${NC}"
    echo "npm should come with Node.js"
    exit 1
fi

NPM_VERSION=$(npm --version 2>/dev/null)
echo -e "${GREEN}npm $NPM_VERSION found!${NC}"
echo ""

# Navigate to script directory
echo "Navigating to installation directory..."
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"
echo "Current directory: $PWD"
echo ""

# Install dependencies
echo "[3/4] Installing dependencies..."
echo "This may take a few minutes..."
echo ""

if npm install; then
    echo ""
    echo -e "${GREEN}Dependencies installed successfully!${NC}"
    echo ""
else
    echo ""
    echo -e "${RED}ERROR: Failed to install dependencies${NC}"
    echo "Please check your internet connection and try again"
    echo ""
    echo "If the problem persists, try manually running:"
    echo "  npm install"
    exit 1
fi

# Link package globally
echo "[4/4] Installing LMCode globally..."
echo ""

# Determine if sudo is needed
NEED_SUDO=false
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - check if we need sudo
    if ! npm link 2>/dev/null; then
        NEED_SUDO=true
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - typically needs sudo
    NEED_SUDO=true
fi

if [ "$NEED_SUDO" = true ]; then
    echo "Global installation requires sudo permissions..."
    if sudo npm link; then
        echo ""
        echo -e "${GREEN}Global installation completed!${NC}"
    else
        echo ""
        echo -e "${RED}ERROR: Global installation failed${NC}"
        echo ""
        echo "Please try one of these solutions:"
        echo "  1. Run this script with sudo: sudo bash install.sh"
        echo "  2. Or manually run: sudo npm link"
        echo "  3. Or manually run: sudo npm install -g ."
        exit 1
    fi
else
    if npm link; then
        echo ""
        echo -e "${GREEN}Global installation completed!${NC}"
    else
        echo ""
        echo -e "${YELLOW}WARNING: npm link failed, trying alternative...${NC}"
        if npm install -g .; then
            echo ""
            echo -e "${GREEN}Global installation completed!${NC}"
        else
            echo ""
            echo -e "${RED}ERROR: Global installation failed${NC}"
            echo "Please try: sudo npm link"
            exit 1
        fi
    fi
fi
echo ""

# Verify installation
echo "========================================"
echo "Verifying installation..."
echo "========================================"
echo ""

# Give the system a moment to update PATH
sleep 2

if command -v lmcode &> /dev/null; then
    LMCODE_VERSION=$(lmcode --version 2>/dev/null)
    echo -e "${GREEN}LMCode $LMCODE_VERSION installed successfully!${NC}"
else
    echo -e "${YELLOW}WARNING: 'lmcode' command not found in PATH yet${NC}"
    echo "This is normal. Please restart your terminal."
    echo ""
    echo "After restarting, verify with: lmcode --version"
fi

echo ""
echo "========================================"
echo "Installation Complete!"
echo "========================================"
echo ""
echo "Next Steps:"
echo "  1. Close and reopen your terminal"
echo "  2. Navigate to any project: cd ~/your/project"
echo "  3. Start LMCode: lmcode"
echo "  4. Initialize: /init (once inside LMCode)"
echo ""
echo "For more information, see README.md"
echo ""
