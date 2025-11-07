# LMCode

**AI-Powered Coding Assistant with Intelligent Context Management**

LMCode is a command-line coding assistant that connects to LM Studio (or any OpenAI-compatible API) to help you write, debug, and improve code. It features intelligent context management, dual-track processing, web search capabilities, and a modern CLI interface - all optimized to work efficiently within token limits.

## 🆕 What's New

- **🌐 Web Search**: Search the internet and fetch web pages (no API key required)
- **💻 Improved UI**: Clean separator lines, better text wrapping, multi-line support
- **⚡ ESC to Cancel**: Press ESC to cancel LLM requests mid-generation
- **📊 Real-time Progress**: See token counts and streaming responses as they generate
- **⌨️ Better Input**: Full cursor navigation, clipboard paste, Home/End keys

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

### 🌐 **Web Search & Internet Access**
- **Web Search**: Search the internet using DuckDuckGo (no API key required)
- **Web Page Fetching**: Retrieve and read content from any URL
- **Automatic Integration**: LLM can search for documentation, tutorials, and solutions
- **Smart Content Extraction**: Filters out navigation, scripts, and formatting to get clean text
- **Use Cases**:
  - Look up API documentation
  - Find solutions to error messages
  - Research best practices and tutorials
  - Fetch README files from GitHub repos

### 📝 **Powerful File Operations**
- **XML-Based Actions**: Structured file edits, creates, and deletes
- **Auto Path Resolution**: Finds files in subdirectories automatically
- **Safe Editing**: Edit Track ensures complete file context before modifications
- **Task Management**: Track progress with integrated TODO lists
- **Streaming Progress**: See LLM responses as they're generated in real-time

### 💻 **Modern CLI Interface**
- **Clean Input Prompt**: Visual separator lines above and below input (like Claude Code)
- **Advanced Editing**: Full cursor navigation (Home/End/Arrow keys)
- **Clipboard Support**: Ctrl+V to paste from clipboard
- **Cancellation**: Press ESC to cancel LLM requests mid-generation
- **Multi-line Support**: Input automatically wraps without display corruption
- **Real-time Feedback**: Token counts and progress indicators

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
- \`/context [size]\` - Set context window size
- \`/compress\` - Manually compress conversation history
- \`/tools [on|off]\` - Toggle tool/function calling mode
- \`exit\` - Exit LMCode

### Keyboard Shortcuts

- **ESC** - Cancel LLM generation mid-response
- **Ctrl+C** - Exit the application
- **Ctrl+V** - Paste from clipboard
- **Arrow Keys** - Navigate within input
- **Home/End** - Jump to start/end of input

### Making Requests

Simply type your request in the clean, bordered input prompt:

\`\`\`
────────────────────────────────────────
You: Add error handling to the WiFi connection
────────────────────────────────────────
\`\`\`

LMCode will:
1. Search your codebase for relevant files
2. Analyze the code
3. Suggest changes
4. Apply edits with your approval
5. Show progress with token counts and streaming output

## 🎯 Examples

### Example 1: Add Feature
\`\`\`
You: Add a retry mechanism to the API calls with exponential backoff
\`\`\`

**LMCode will:**
- Search your codebase for API-related files
- Suggest implementation with proper error handling
- Apply changes with your approval

### Example 2: Fix Bug
\`\`\`
You: Fix the memory leak in the connection pool
\`\`\`

**LMCode will:**
- Find connection pool implementation
- Identify the leak
- Suggest and apply the fix

### Example 3: Refactor
\`\`\`
You: Extract the validation logic into a separate utility file
\`\`\`

**LMCode will:**
- Locate validation code
- Create new utility file
- Update imports and references

### Example 4: Research & Implement
\`\`\`
You: How do I implement WebSocket reconnection with exponential backoff in Node.js?
\`\`\`

**LMCode will:**
- Search the web for WebSocket best practices
- Fetch relevant documentation
- Suggest implementation based on current standards
- Apply to your codebase

### Example 5: Debug with Web Search
\`\`\`
You: I'm getting "ECONNREFUSED" error when connecting to the database
\`\`\`

**LMCode will:**
- Analyze your database connection code
- Search for solutions to ECONNREFUSED errors
- Suggest fixes based on your specific setup

### Example 6: Cancel Long Responses
While the LLM is generating a response, press **ESC** to cancel and try a different approach. The app stays running and returns to the prompt immediately.

## 🔧 Advanced Configuration

Edit \`config.json\` to customize LMCode's behavior:

- Adjust context window size
- Configure search parameters
- Enable/disable Edit Track
- Modify compression thresholds

### Tool Calling vs XML Mode

LMCode supports two modes for LLM interaction:

- **XML Mode** (Default): Uses structured XML tags like \`<file_edit>\`, \`<web_search>\`, etc.
  - More reliable across different models
  - Works with any LLM
  - Recommended for most users

- **Tool Calling Mode**: Uses OpenAI-style function calling
  - Enable with \`/tools on\`
  - Requires compatible models (some Qwen models have issues)
  - Automatically disabled if model doesn't support it

### Web Search Configuration

Web search uses DuckDuckGo HTML scraping (no API key needed):
- Searches return up to 8 results by default
- Web pages are fetched up to 10,000 characters
- Content is automatically cleaned (removes scripts, navigation, etc.)
- LLM automatically uses web search when it needs external information

## 💡 Tips & Best Practices

### Getting the Most from LMCode

1. **Use Descriptive Requests**: Instead of "fix the bug", try "fix the connection timeout in the WebSocket handler"
2. **Let It Search**: Don't manually specify files - let LMCode search your codebase
3. **Cancel When Needed**: If a response is going in the wrong direction, press ESC and rephrase
4. **Check Suggestions**: Always review changes before approving execution
5. **Use Web Search**: Ask about APIs, best practices, or error messages you're unfamiliar with

### Understanding Token Usage

- **Context Window**: Set with \`/context\` command (e.g., \`/context 32768\`)
- **Auto-Compression**: History compresses at 80% of context window
- **Token Display**: Shows prompt + completion tokens after each response
- **Edit Track**: Uses separate budget for focused file editing

### Keyboard Shortcuts Reference

| Key | Action |
|-----|--------|
| ESC | Cancel current LLM request |
| Ctrl+C | Exit application |
| Ctrl+V | Paste from clipboard |
| Arrow Keys | Navigate within input |
| Home | Jump to start of input |
| End | Jump to end of input |
| Backspace | Delete character before cursor |
| Delete | Delete character at cursor |

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Built for use with [LM Studio](https://lmstudio.ai/)
- Inspired by Claude Code and other AI coding assistants
- Uses OpenAI-compatible API format
- Web scraping powered by [Cheerio](https://cheerio.js.org/) and [Axios](https://axios-http.com/)
- Token counting via [@anthropic-ai/tokenizer](https://www.npmjs.com/package/@anthropic-ai/tokenizer)

## 📊 Project Stats

- **Language**: JavaScript (Node.js)
- **Dependencies**: Minimal - only essential libraries
- **Size**: ~3000 lines of well-documented code
- **License**: MIT - free for any use

---

**Made with ❤️ for developers who want AI assistance without sacrificing control**
