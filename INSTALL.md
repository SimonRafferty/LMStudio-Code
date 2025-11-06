# LMCode Installation Guide

Quick reference for installing LMCode on Windows, macOS, and Linux.

## 🚀 Quick Install (Automated Scripts)

### Windows

**Double-click** `install.bat` or run in Command Prompt:
```cmd
install.bat
```

**To uninstall:**
```cmd
uninstall.bat
```

### macOS / Linux

**Option 1 - Direct execution:**
```bash
./install.sh
```

**Option 2 - Using bash:**
```bash
bash install.sh
```

**To uninstall:**
```bash
./uninstall.sh
# or
bash uninstall.sh
```

---

## 📦 What the Scripts Do

### Installation Script (`install.bat` / `install.sh`)

1. ✅ Checks if Node.js is installed
2. ✅ Checks if npm is available
3. ✅ Installs project dependencies (`npm install`)
4. ✅ Installs LMCode globally (`npm link`)
5. ✅ Verifies installation

**After installation:**
- Close and reopen your terminal
- Run `lmcode` from any directory
- Type `/init` to initialize a project

### Uninstallation Script (`uninstall.bat` / `uninstall.sh`)

1. ✅ Checks if LMCode is installed
2. ✅ Asks for confirmation
3. ✅ Removes global installation
4. ✅ Verifies removal

**Note:** Your project `.lmcode` directories are **not deleted** - you can manually remove them if needed.

---

## 🛠️ Manual Installation

If the automated scripts don't work, you can install manually:

### All Platforms

```bash
# 1. Navigate to LMCode directory
cd /path/to/lmcode

# 2. Install dependencies
npm install

# 3. Link globally
npm link
# If that fails (permissions), try:
sudo npm link        # Mac/Linux
# or run as Administrator on Windows

# 4. Verify
lmcode --version
```

### Manual Uninstall

```bash
# Navigate to LMCode directory
cd /path/to/lmcode

# Unlink
npm unlink
# or
sudo npm unlink      # Mac/Linux if needed
```

---

## 🔧 Troubleshooting

### "Node.js not found" Error

**Windows:**
- Download and install from [nodejs.org](https://nodejs.org/)
- Restart terminal after installation

**macOS:**
```bash
brew install node
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Linux (Fedora/RHEL/CentOS):**
```bash
curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
sudo dnf install nodejs
```

### "Permission denied" Error

**Windows:**
- Right-click `install.bat`
- Select "Run as administrator"

**Mac/Linux:**
```bash
sudo bash install.sh
```

### "Command not found: lmcode" After Installation

This is normal! The terminal needs to refresh:
1. **Close** your terminal completely
2. **Open** a new terminal
3. Try `lmcode --version` again

**Alternative (without restarting):**
```bash
# Mac/Linux
hash -r

# Windows
refreshenv  # (if you have Chocolatey)
# or just close/reopen the terminal
```

### npm link fails repeatedly

Try installing globally instead:
```bash
npm install -g .

# Mac/Linux with permissions issue:
sudo npm install -g .
```

---

## 📍 Installation Paths

After installation, LMCode is typically installed to:

**Windows:**
```
C:\Users\YourName\AppData\Roaming\npm\node_modules\lmcode
```

**macOS (Homebrew):**
```
/opt/homebrew/lib/node_modules/lmcode
```

**macOS (nvm):**
```
~/.nvm/versions/node/vX.X.X/lib/node_modules/lmcode
```

**Linux:**
```
/usr/local/lib/node_modules/lmcode
# or
~/.nvm/versions/node/vX.X.X/lib/node_modules/lmcode
```

---

## ✅ Verify Installation

After installation, verify everything works:

```bash
# Check version
lmcode --version

# Navigate to a project
cd ~/my-project

# Start LMCode
lmcode

# Inside LMCode, initialize
You: /init
```

---

## 📚 Next Steps

Once installed:
1. Read the [README.md](README.md) for full documentation
2. Navigate to your project directory
3. Run `lmcode`
4. Type `/init` to index your codebase
5. Start coding with AI assistance!

---

## 🆘 Still Having Issues?

If you continue to have problems:
1. Check that Node.js version is 16 or higher: `node --version`
2. Check that npm is working: `npm --version`
3. Try the manual installation steps above
4. Check the project issues on GitHub

**Common fixes:**
- Update Node.js to the latest LTS version
- Clear npm cache: `npm cache clean --force`
- Remove `node_modules` and reinstall: `rm -rf node_modules && npm install`
