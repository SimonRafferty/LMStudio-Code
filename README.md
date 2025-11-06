# LMCode

**AI-Powered Coding Assistant with Intelligent Context Management**

LMCode is a command-line coding assistant that connects to LM Studio (or any OpenAI-compatible API) to help you write, debug, and improve code. It features intelligent context management, dual-track processing, and smart file handling to work efficiently within token limits.

## ✨ Key Features

### 🧠 **Intelligent Context Management**
- **Dual-Track System**: Separate contexts for conversation (Main Track) and file editing (Edit Track)
  - Main Track: Full conversation history for planning and understanding
  - Edit Track: Focused context with complete file content for precise edits
- **Smart File Loading**: Automatically loads small files completely, uses snippets for large files
- **Context Compression**: Automatically compresses conversation history when approaching token limits
- **Token Budgeting**: Intelligent allocation of available context across files, history, and prompts

### 🔍 **Advanced Code Search**
- **Content-Based Search**: Search within actual file contents, not just filenames
- **Three Context Modes**:
  - Simple: 3 lines of context (quick identification)
  - Extended: 25 lines of context (better editing)
  - Function-level: Complete function/block extraction
- **Line-Range Reading**: Load specific sections of large files on demand
- **Smart Keyword Translation**: LLM understands functional requests and translates to code-level keywords

### 📝 **Powerful File Operations**
- **XML-Based Actions**: Structured file edits, creates, and deletes
- **Auto Path Resolution**: Finds files in subdirectories automatically
- **Safe Editing**: Edit Track ensures complete file context before modifications
- **Task Management**: Track progress with integrated TODO lists

### ⚙️ **Architecture Guidance**
- **File Size Targets**: Encourages modular code with 150-500 line files
- **Auto-Refactoring Suggestions**: Recommends splitting files that grow too large
- **Best Practices**: Built-in guidance for maintainable, context-friendly code

## 📋 Prerequisites

- **Node.js** 16 or higher
- **LM Studio** (or any OpenAI-compatible API endpoint)
- A local LLM model loaded in LM Studio

## 🚀 Installation

### Quick Install (Recommended)

**Automated installation scripts are provided for all platforms:**

**Windows:** Double-click `install.bat` or run in Command Prompt:
\`\`\`cmd
install.bat
\`\`\`

**macOS/Linux:** Run the shell script:
\`\`\`bash
./install.sh
# or
bash install.sh
\`\`\`

The scripts will:
- ✅ Check for Node.js
- ✅ Install dependencies
- ✅ Install LMCode globally
- ✅ Verify installation

**See [INSTALL.md](INSTALL.md) for detailed installation guide and troubleshooting.**

---

### Manual Installation

If the automated scripts don't work, you can install manually:

### Windows

1. **Install Node.js** (if not already installed):
   - Download from [nodejs.org](https://nodejs.org/)
   - Run the installer and follow prompts
   - Verify installation:
     \`\`\`cmd
     node --version
     npm --version
     \`\`\`

2. **Clone or Download LMCode**:
   \`\`\`cmd
   cd %USERPROFILE%\Desktop
   git clone https://github.com/yourusername/lmcode.git
   cd lmcode
   \`\`\`

3. **Install Dependencies**:
   \`\`\`cmd
   npm install
   \`\`\`

4. **Link Globally**:
   \`\`\`cmd
   npm link
   \`\`\`

5. **Verify Installation**:
   \`\`\`cmd
   lmcode --version
   \`\`\`

### macOS

1. **Install Node.js**:
   \`\`\`bash
   # Using Homebrew (recommended)
   brew install node
   \`\`\`

2. **Clone or Download LMCode**:
   \`\`\`bash
   cd ~/Desktop
   git clone https://github.com/yourusername/lmcode.git
   cd lmcode
   \`\`\`

3. **Install Dependencies**:
   \`\`\`bash
   npm install
   \`\`\`

4. **Link Globally**:
   \`\`\`bash
   sudo npm link
   \`\`\`

5. **Verify Installation**:
   \`\`\`bash
   lmcode --version
   \`\`\`

### Linux

1. **Install Node.js**:
   \`\`\`bash
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # Fedora/RHEL/CentOS
   curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
   sudo dnf install nodejs
   \`\`\`

2. **Clone and Install**:
   \`\`\`bash
   cd ~/Desktop
   git clone https://github.com/yourusername/lmcode.git
   cd lmcode
   npm install
   sudo npm link
   \`\`\`

## 📖 Usage

### Quick Start

1. **Start LM Studio** and load a model
2. **Navigate to your project**: \`cd /path/to/your/project\`
3. **Run LMCode**: \`lmcode\`

### Commands

- \`/init\` - Index your codebase
- \`/tasks\` - View task list  
- \`/history\` - Show conversation history
- \`/clear\` - Clear history
- \`/stats\` - Show statistics
- \`exit\` - Exit LMCode

### Making Requests

Simply type your request:

\`\`\`
You: Add error handling to the WiFi connection
\`\`\`

LMCode will:
1. Search your codebase for relevant files
2. Analyze the code
3. Suggest changes
4. Apply edits with your approval

## 🎯 Examples

### Example 1: Add Feature
\`\`\`
You: Add a retry mechanism to the API calls with exponential backoff
\`\`\`

### Example 2: Fix Bug
\`\`\`
You: Fix the memory leak in the connection pool
\`\`\`

### Example 3: Refactor
\`\`\`
You: Extract the validation logic into a separate utility file
\`\`\`

## 🔧 Advanced Configuration

Edit \`config.json\` to customize LMCode's behavior:

- Adjust context window size
- Configure search parameters
- Enable/disable Edit Track
- Modify compression thresholds

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Built for use with [LM Studio](https://lmstudio.ai/)
- Inspired by Claude Code and other AI coding assistants
- Uses OpenAI-compatible API format

---

**Made with ❤️ for developers who want AI assistance without sacrificing control**
