# LMCode

**AI-Powered Coding Assistant with Intelligent Context Management**

Command-line coding assistant for LM Studio (or any OpenAI-compatible API). Features intelligent context management, dual-track processing, web search, and a modern CLI interface optimized for token limits.

## Key Features

- **Dual-Track Context**: Separate contexts for conversation and file editing
- **Smart Search**: Content-based code search with multiple context modes
- **Web Search**: DuckDuckGo integration (no API key needed)
- **Auto Compression**: Manages conversation history within token limits
- **Modern CLI**: Clean UI with separator lines, ESC to cancel, Ctrl+V paste
- **Streaming Output**: Real-time progress with token counts
- **File Operations**: Auto path resolution, safe editing, task tracking

## Prerequisites

- Node.js 16+
- LM Studio (or any OpenAI-compatible API)

## Installation

**Windows:**
\`\`\`cmd
install.bat
\`\`\`

**macOS/Linux:**
\`\`\`bash
./install.sh
\`\`\`

See [INSTALL.md](INSTALL.md) for troubleshooting.

## Usage

1. Start LM Studio and load a model
2. Run `lmcode` in your project directory
3. Type your request and press Enter

### Commands

- `/init` - Index codebase
- `/context [size]` - Set context window
- `/tasks` - View tasks
- `/history` - Show history
- `/clear` - Clear history
- `/compress` - Compress history
- `/tools [on|off]` - Toggle tool mode
- `exit` - Exit

### Keyboard Shortcuts

- **ESC** - Cancel generation
- **Ctrl+C** - Exit
- **Ctrl+V** - Paste

## Configuration

Edit `config.json` to adjust context window, search parameters, and compression thresholds.

**Modes:**
- **XML Mode** (default): Structured tags, works with any model
- **Tool Calling**: OpenAI-style functions, toggle with `/tools on/off`

## Privacy

- Token counting: 100% offline (tiktoken)
- LLM: Local via LM Studio
- Web search: Optional, only when requested
- No telemetry

## License

MIT - see LICENSE file

---

Built for [LM Studio](https://lmstudio.ai/) • Inspired by Claude Code
