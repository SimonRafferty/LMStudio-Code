#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import readline from 'readline';
import clipboardy from 'clipboardy';

// Import components
import TokenCounter from './tokenCounter.js';
import LMStudioClient from './lmstudioClient.js';
import FileOperations from './fileOperations.js';
import TaskManager from './taskManager.js';
import ContextManager from './contextManager.js';
import CodebaseIndexer from './codebaseIndexer.js';
import ResponseParser from './responseParser.js';
import PromptBuilder from './promptBuilder.js';
import WebScraper from './webScraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get default configuration
 */
function getDefaultConfig() {
  return {
    lmstudio: {
      baseURL: 'http://localhost:1234/v1',
      model: 'local-model',
      temperature: 0.7,
    },
    contextManagement: {
      maxContextTokens: 3500,
      compressionThreshold: 0.7,
      recentMessagesCount: 5,
      maxFilesInContext: 5,
    },
    codebase: {
      rootPath: './',
      excludePatterns: ['node_modules', '.git', 'dist', 'build', 'data', '.lmcode'],
      excludeExtensions: ['.exe', '.dll', '.so', '.dylib', '.bin', '.zip', '.tar', '.gz', '.rar', '.7z', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.obj', '.o', '.a', '.lib', '.pyc', '.class', '.jar'],
    },
    prompts: {
      mode: 'normal',
      systemPromptPath: path.join(__dirname, '../templates/system_prompt.txt'),
      tersePromptPath: path.join(__dirname, '../templates/system_prompt_terse.txt'),
    },
  };
}

/**
 * Main Application Class
 */
class LMStudioContextManager {
  constructor(projectRoot = null) {
    this.projectRoot = projectRoot || process.cwd();
    this.lmcodeDir = path.join(this.projectRoot, '.lmcode');
    this.config = null;
    this.components = {};
    this.initialized = false;
    this.customInstructions = null; // Custom instructions from LMCODE.md
  }

  /**
   * Initialize all components
   */
  async initialize() {
    console.log(chalk.blue('🚀 LMCode\n'));
    console.log(chalk.gray(`Project: ${this.projectRoot}\n`));

    // Auto-create .lmcode directory if it doesn't exist
    if (!existsSync(this.lmcodeDir)) {
      console.log(chalk.gray('Initializing project...'));
      await this.autoInitProject();
    }

    // Load configuration
    await this.loadConfig();

    // Load custom instructions if available
    await this.loadInstructions();

    // Initialize components
    this.components.tokenCounter = new TokenCounter();
    this.components.lmstudioClient = new LMStudioClient(this.config.lmstudio);
    this.components.fileOps = new FileOperations(this.projectRoot);
    this.components.webScraper = new WebScraper();

    const taskPath = path.join(this.lmcodeDir, 'task_list.json');
    this.components.taskManager = new TaskManager(taskPath, this.components.fileOps);

    const historyPath = path.join(this.lmcodeDir, 'conversation_history.json');
    this.components.contextManager = new ContextManager(
      historyPath,
      this.components.lmstudioClient,
      this.components.tokenCounter,
      this.components.fileOps
    );

    this.components.codebaseIndexer = new CodebaseIndexer(
      this.projectRoot,
      this.config.codebase,
      this.components.fileOps
    );

    this.components.responseParser = new ResponseParser();

    this.components.promptBuilder = new PromptBuilder(
      this.config,
      this.components.contextManager,
      this.components.taskManager,
      this.components.codebaseIndexer,
      this.components.tokenCounter,
      this.components.fileOps
    );

    // Pass custom instructions to prompt builder
    if (this.customInstructions) {
      this.components.promptBuilder.setCustomInstructions(this.customInstructions);
    }

    // Load saved data
    await this.components.taskManager.initialize();
    await this.components.contextManager.initialize();

    const indexPath = path.join(this.lmcodeDir, 'codebase_index.json');
    await this.components.codebaseIndexer.loadIndex(indexPath);

    this.initialized = true;
    console.log(chalk.green('✓ Ready\n'));
  }

  /**
   * Check and compress context if needed
   */
  async checkAndCompressContext() {
    try {
      // Ensure we have model capabilities
      if (!this.components.lmstudioClient.contextWindow) {
        return; // Can't check without knowing context window
      }

      const shouldCompress = this.components.contextManager.shouldCompress(
        null, // Will use current history token count
        null, // Will use model's context window
        this.config.contextManagement.compressionThreshold
      );

      if (shouldCompress) {
        const contextWindow = this.components.contextManager.getAvailableContext();
        const currentTokens = this.components.tokenCounter.countMessagesTokens(
          this.components.contextManager.history.full
        );
        const spinner = ora(`Compressing history (${currentTokens}/${contextWindow} tokens)...`).start();

        await this.components.contextManager.compressHistory(
          this.config.contextManagement.recentMessagesCount,
          (tokens, text) => {
            spinner.text = `Compressing history... (${tokens} tokens generated)`;
          }
        );
        await this.saveState();

        // Calculate new size after compression
        const newTokens = this.components.tokenCounter.countMessagesTokens(
          this.components.contextManager.history.full
        );
        spinner.succeed(`History compressed: ${currentTokens} → ${newTokens} tokens\n`);
      }
    } catch (error) {
      console.warn(chalk.yellow(`Could not check compression: ${error.message}`));
    }
  }

  /**
   * Load configuration from project or use defaults
   */
  async loadConfig() {
    const configPath = path.join(this.lmcodeDir, 'config.json');

    if (existsSync(configPath)) {
      try {
        const configData = await fs.readFile(configPath, 'utf-8');
        this.config = JSON.parse(configData);

        // Update paths to be absolute if needed
        if (this.config.prompts?.systemPromptPath && !path.isAbsolute(this.config.prompts.systemPromptPath)) {
          this.config.prompts.systemPromptPath = path.join(__dirname, '../templates/system_prompt.txt');
        }
        if (this.config.prompts?.tersePromptPath && !path.isAbsolute(this.config.prompts.tersePromptPath)) {
          this.config.prompts.tersePromptPath = path.join(__dirname, '../templates/system_prompt_terse.txt');
        }
      } catch (error) {
        console.warn(chalk.yellow('Failed to load config, using defaults:'), error.message);
        this.config = getDefaultConfig();
      }
    } else {
      this.config = getDefaultConfig();
    }

    // Ensure rootPath is set to current project
    this.config.codebase.rootPath = this.projectRoot;
  }

  /**
   * Auto-initialize project (silent, no prompts)
   */
  async autoInitProject() {
    // Create .lmcode directory
    await fs.mkdir(this.lmcodeDir, { recursive: true });

    // Save default config
    const configPath = path.join(this.lmcodeDir, 'config.json');
    const config = getDefaultConfig();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // Create empty data files
    await fs.writeFile(
      path.join(this.lmcodeDir, 'task_list.json'),
      JSON.stringify({ tasks: [], lastUpdated: new Date().toISOString() }, null, 2)
    );

    await fs.writeFile(
      path.join(this.lmcodeDir, 'conversation_history.json'),
      JSON.stringify({ history: { full: [], compressed: '', activeWindow: [] } }, null, 2)
    );

    await fs.writeFile(
      path.join(this.lmcodeDir, 'codebase_index.json'),
      JSON.stringify({ projectRoot: this.projectRoot, lastIndexed: null, files: [] }, null, 2)
    );

    // Create .gitignore for .lmcode directory
    const gitignorePath = path.join(this.lmcodeDir, '.gitignore');
    await fs.writeFile(gitignorePath, '# LMCode data files\n*\n!config.json\n!LMCODE.md\n!.gitignore\n');

    // Create sample LMCODE.md file
    const instructionsPath = path.join(this.lmcodeDir, 'LMCODE.md');
    const sampleInstructions = `# Project Instructions

Add your custom instructions for the LLM here. This file works like Claude's CLAUDE.md.

## Example Instructions

- Follow the project's code style
- Write tests for new features
- Add comments for complex logic
`;
    await fs.writeFile(instructionsPath, sampleInstructions);

    console.log(chalk.gray('✓ Project initialized\n'));
  }

  /**
   * Load custom instructions from LMCODE.md
   */
  async loadInstructions() {
    const instructionsPath = path.join(this.lmcodeDir, 'LMCODE.md');

    if (existsSync(instructionsPath)) {
      try {
        this.customInstructions = await fs.readFile(instructionsPath, 'utf-8');
        console.log(chalk.gray('✓ Loaded custom instructions from LMCODE.md\n'));
      } catch (error) {
        console.warn(chalk.yellow('Warning: Failed to load LMCODE.md:'), error.message);
      }
    }
  }

  /**
   * Initialize a new project
   */
  async initProject() {
    console.log(chalk.cyan('🎯 Initializing new LMCode project...\n'));
    console.log(chalk.gray(`Directory: ${this.projectRoot}\n`));

    // Check if already initialized
    if (existsSync(this.lmcodeDir)) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: '.lmcode directory already exists. Reinitialize?',
          default: false,
        },
      ]);

      if (!overwrite) {
        console.log(chalk.yellow('Initialization cancelled.'));
        return;
      }
    }

    // Create .lmcode directory
    await fs.mkdir(this.lmcodeDir, { recursive: true });

    // Save default config
    const configPath = path.join(this.lmcodeDir, 'config.json');
    const config = getDefaultConfig();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // Create empty data files
    await fs.writeFile(
      path.join(this.lmcodeDir, 'task_list.json'),
      JSON.stringify({ tasks: [], lastUpdated: new Date().toISOString() }, null, 2)
    );

    await fs.writeFile(
      path.join(this.lmcodeDir, 'conversation_history.json'),
      JSON.stringify({ history: { full: [], compressed: '', activeWindow: [] } }, null, 2)
    );

    await fs.writeFile(
      path.join(this.lmcodeDir, 'codebase_index.json'),
      JSON.stringify({ projectRoot: this.projectRoot, lastIndexed: null, files: [] }, null, 2)
    );

    // Create .gitignore for .lmcode directory
    const gitignorePath = path.join(this.lmcodeDir, '.gitignore');
    await fs.writeFile(gitignorePath, '# LMCode data files\n*\n!config.json\n!.gitignore\n');

    console.log(chalk.green('✓ Project initialized successfully!\n'));
    console.log(chalk.white('Next steps:'));
    console.log(chalk.gray('  1. Edit .lmcode/config.json if needed'));
    console.log(chalk.gray('  2. Run: lmcode index (to index your codebase)'));
    console.log(chalk.gray('  3. Run: lmcode start (to begin interactive session)\n'));
  }

  /**
   * Test connection to LMStudio and fetch model capabilities
   */
  async testConnection() {
    const spinner = ora('Testing connection to LMStudio...').start();

    try {
      await this.components.lmstudioClient.testConnection();
      spinner.text = 'Fetching model capabilities...';

      // Fetch model context window and other capabilities
      await this.components.lmstudioClient.fetchModelCapabilities();

      const contextWindow = this.components.lmstudioClient.getContextWindow();
      const modelName = this.components.lmstudioClient.model;
      const toolsEnabled = this.components.lmstudioClient.supportsTools;

      // Build connection message
      let connectionMsg = `Connected to LMStudio (model: ${modelName}`;
      if (contextWindow) {
        connectionMsg += `, context: ${contextWindow} tokens`;
      }
      connectionMsg += `, mode: ${toolsEnabled ? chalk.green('Function Calling') : chalk.yellow('XML')}`;
      connectionMsg += ')';

      if (contextWindow) {
        spinner.succeed(connectionMsg);
        return true;
      } else {
        spinner.warn(connectionMsg);
        console.log(chalk.yellow('\n⚠ Context window could not be determined from API'));
        console.log(chalk.white('Please set the context length manually using:'));
        console.log(chalk.cyan('  /context <number>'));
        console.log(chalk.gray('\nExample: /context 4096'));
        console.log(chalk.gray('You can find your model\'s context length in LM Studio\'s model info.\n'));
        return 'no-context';
      }
    } catch (error) {
      spinner.fail('Failed to connect to LMStudio');
      console.error(chalk.red(error.message));
      return false;
    }
  }

  /**
   * Custom input prompt with Ctrl+V paste support and full cursor navigation
   * @param {string} prompt - The prompt message
   * @returns {Promise<string>} - The user input
   */
  async customInput(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      let input = '';
      let cursorPos = 0; // Position in the input string
      const promptLength = prompt.replace(/\x1b\[[0-9;]*m/g, '').length; // Strip ANSI codes for length
      const terminalWidth = process.stdout.columns || 80;
      let currentNumLines = 1; // Track current number of lines being used

      // Display separator line above prompt if requested
      if (options.showSeparator !== false) {
        const separator = chalk.gray('─'.repeat(Math.min(terminalWidth, 80)));
        process.stdout.write(separator + '\n');
      }

      // Display the prompt
      process.stdout.write(prompt);

      // Enable raw mode for character-by-character input
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const cleanup = () => {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      };

      // Redraw the input line(s) and position cursor correctly
      const redrawInput = () => {
        // Calculate how many lines the current input takes
        const totalLength = promptLength + input.length;
        const newNumLines = Math.max(1, Math.ceil(totalLength / terminalWidth));

        // Save cursor position if we need to move up multiple lines
        const linesToMoveUp = currentNumLines - 1;

        // Move cursor to start of first line (where prompt begins)
        if (linesToMoveUp > 0) {
          process.stdout.write(`\x1b[${linesToMoveUp}A`); // Move up to first line
        }

        // Move to start of line and clear from cursor down
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);

        // Redraw prompt and input
        process.stdout.write(prompt + input);

        // Update tracked line count
        currentNumLines = newNumLines;

        // Calculate cursor position
        const absolutePos = promptLength + cursorPos;
        const targetLine = Math.floor(absolutePos / terminalWidth);
        const targetCol = absolutePos % terminalWidth;

        // Move cursor to correct line (we're currently at end of input)
        // We need to move from the last line of input to the target line
        const currentLine = newNumLines - 1;
        const lineDiff = currentLine - targetLine;

        if (lineDiff > 0) {
          // Move up
          process.stdout.write(`\x1b[${lineDiff}A`);
        } else if (lineDiff < 0) {
          // Move down
          process.stdout.write(`\x1b[${-lineDiff}B`);
        }

        // Set column position
        readline.cursorTo(process.stdout, targetCol);
      };

      const onData = async (key) => {
        const code = key.charCodeAt(0);

        // ESC key - cancel input
        if (key === '\x1b' || key === '\x1b\x1b') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('INPUT_CANCELLED'));
          return;
        }
        // Ctrl+C - exit application
        else if (code === 3) {
          cleanup();
          console.log('^C');
          process.exit(0);
        }
        // Ctrl+V - paste from clipboard
        else if (code === 22) {
          try {
            const clipboardContent = await clipboardy.read();
            // Replace newlines with spaces, collapse multiple spaces, and trim
            const cleaned = clipboardContent
              .replace(/[\r\n]+/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            // Insert at cursor position
            input = input.slice(0, cursorPos) + cleaned + input.slice(cursorPos);
            cursorPos += cleaned.length;
            redrawInput();
          } catch (error) {
            // Clipboard read failed, ignore
          }
        }
        // Enter - submit
        else if (code === 13) {
          cleanup();
          process.stdout.write('\n');
          // Display separator line below input if requested
          if (options.showSeparator !== false) {
            const separator = chalk.gray('─'.repeat(Math.min(terminalWidth, 80)));
            process.stdout.write(separator + '\n');
          }
          resolve(input.trim());
        }
        // Backspace
        else if (code === 127 || code === 8) {
          if (cursorPos > 0) {
            input = input.slice(0, cursorPos - 1) + input.slice(cursorPos);
            cursorPos--;
            redrawInput();
          }
        }
        // Left arrow
        else if (key === '\x1b[D') {
          if (cursorPos > 0) {
            cursorPos--;
            redrawInput();
          }
        }
        // Right arrow
        else if (key === '\x1b[C') {
          if (cursorPos < input.length) {
            cursorPos++;
            redrawInput();
          }
        }
        // Home - jump to start
        else if (key === '\x1b[H' || key === '\x1b[1~') {
          cursorPos = 0;
          redrawInput();
        }
        // End - jump to end
        else if (key === '\x1b[F' || key === '\x1b[4~') {
          cursorPos = input.length;
          redrawInput();
        }
        // Delete - remove character at cursor
        else if (key === '\x1b[3~') {
          if (cursorPos < input.length) {
            input = input.slice(0, cursorPos) + input.slice(cursorPos + 1);
            redrawInput();
          }
        }
        // Regular character (printable ASCII and beyond)
        else if (code >= 32 || code === 9) {
          // Insert at cursor position
          input = input.slice(0, cursorPos) + key + input.slice(cursorPos);
          cursorPos++;
          redrawInput();
        }
      };

      process.stdin.on('data', onData);
    });
  }

  /**
   * Start interactive session
   */
  async startInteractive() {
    console.log(chalk.cyan('\n=== Interactive Mode ==='));
    console.log(chalk.gray('Type your questions or commands. Use /help for available commands.'));
    console.log(chalk.gray('Press ESC to cancel during LLM generation.\n'));

    // Check connection
    const connectionStatus = await this.testConnection();
    if (connectionStatus === false) {
      console.log(chalk.yellow('\nContinuing anyway (you can still use local commands)...\n'));
    } else if (connectionStatus === 'no-context') {
      // Context window not available - block prompts until set
      console.log(chalk.yellow('LLM queries are blocked until context length is set.\n'));
    } else {
      // Check if context needs compression on startup
      await this.checkAndCompressContext();
    }

    // Main interaction loop
    while (true) {
      let input;
      try {
        input = await this.customInput(chalk.green('You: '));
      } catch (error) {
        if (error.message === 'INPUT_CANCELLED') {
          // User pressed ESC - cancel any ongoing request
          if (this.currentAbortController) {
            this.currentAbortController.abort();
            console.log(chalk.yellow('\n✗ Request cancelled\n'));
          }
          continue;
        }
        throw error; // Re-throw other errors
      }

      const trimmedInput = input.trim();

      if (!trimmedInput) continue;

      // Handle commands
      if (trimmedInput.startsWith('/')) {
        const shouldContinue = await this.handleCommand(trimmedInput);
        if (!shouldContinue) break;
        continue;
      }

      // Block prompts if context not set
      const contextWindow = this.components.lmstudioClient.getContextWindow();
      if (!contextWindow) {
        console.log(chalk.red('\n✗ Context window not set. Please use /context command first.\n'));
        console.log(chalk.gray('Example: /context 4096\n'));
        continue;
      }

      // Process with LLM
      await this.processQuery(trimmedInput);
    }

    // Save state before exit
    await this.saveState();
  }

  /**
   * Handle slash commands
   */
  async handleCommand(command) {
    const [cmd, ...args] = command.slice(1).split(' ');

    switch (cmd.toLowerCase()) {
      case 'help':
        this.showHelp();
        break;

      case 'tasks':
        this.showTasks();
        break;

      case 'history':
        this.showHistory();
        break;

      case 'init':
      case 'index':
        await this.rebuildIndex();
        break;

      case 'compress':
        await this.compressHistory();
        break;

      case 'config':
        this.showConfig();
        break;

      case 'context':
        await this.setContextLength(args);
        break;

      case 'tools':
        await this.toggleTools(args);
        break;

      case 'stats':
        this.showStats();
        break;

      case 'clear':
        await this.clearHistory();
        break;

      case 'exit':
      case 'quit':
        console.log(chalk.yellow('\nGoodbye!\n'));
        return false;

      default:
        console.log(chalk.red(`Unknown command: ${cmd}`));
        console.log(chalk.gray('Type /help for available commands'));
    }

    return true;
  }

  /**
   * Perform codebase search and format results with smart file loading
   */
  async performSearch(keywords) {
    const searchSpinner = ora(`Searching for: ${keywords.join(', ')}...`).start();

    // Search with extended context for better editing
    const results = await this.components.codebaseIndexer.searchFileContents(keywords, 3, 'extended');

    if (results.length === 0) {
      searchSpinner.fail('No matches found');
      return null;
    }

    searchSpinner.text = 'Loading files...';

    // Smart file loading: complete for small files, snippets for large
    const maxResults = this.config.search?.maxSearchResults || 5;
    const loadedFiles = await this.components.codebaseIndexer.loadFilesFromSearchResults(
      results.slice(0, maxResults)
    );

    searchSpinner.succeed(`Found ${results.length} file(s) with matches`);

    // Format search results for LLM
    let formatted = '\n\nSEARCH RESULTS:\n\n';

    for (const file of loadedFiles) {
      formatted += `File: ${file.relativePath}\n`;

      if (file.loadedCompletely) {
        // Small file: include complete content
        formatted += `${file.message}\n\n`;
        formatted += `--- ${file.relativePath} ---\n`;
        formatted += file.content;
        formatted += '\n\n';
      } else {
        // Large file: show snippets with guidance
        formatted += `${file.message}\n`;
        formatted += `Matches: ${file.matches.length}\n\n`;

        const maxSnippets = this.config.search?.maxSnippetsPerFile || 3;
        for (const match of file.matches.slice(0, maxSnippets)) {
          formatted += `  [SNIPPET] Lines ${match.startLine}-${match.endLine} (keyword: "${match.keyword}"):\n`;
          formatted += `  ⚠️ This is a PREVIEW only - NOT complete code:\n\n`;
          formatted += match.snippet.split('\n').map(line => `    ${line}`).join('\n');
          formatted += '\n\n  [END SNIPPET]\n\n';
        }

        formatted += `⚠️ IMPORTANT: The snippets above are PREVIEWS to help you locate relevant code.\n`;
        formatted += `To get complete context for editing, use: <read_lines><path>${file.relativePath}</path><start>LINE</start><end>LINE</end></read_lines>\n`;
      }

      formatted += '---\n\n';
    }

    return formatted;
  }

  /**
   * Handle read_lines requests from LLM
   */
  async handleReadLines(readRequests) {
    let formatted = '\n\nREQUESTED FILE SECTIONS:\n\n';

    for (const request of readRequests) {
      try {
        const result = await this.components.codebaseIndexer.readLineRange(
          request.path,
          request.startLine,
          request.endLine
        );

        formatted += `File: ${result.relativePath}\n`;
        formatted += `Lines ${result.startLine}-${result.endLine} (of ${result.totalLines} total)\n\n`;
        formatted += result.content;
        formatted += '\n\n---\n\n';
      } catch (error) {
        formatted += `ERROR reading ${request.path} lines ${request.startLine}-${request.endLine}: ${error.message}\n\n`;
      }
    }

    return formatted;
  }

  /**
   * Setup ESC key listener for cancellation during processing
   */
  setupCancellationListener(abortController) {
    if (!process.stdin.isTTY) return null;

    const onKeyPress = (data) => {
      // ESC key - just abort, let error handling deal with cleanup
      if (data === '\x1b' || data === '\x1b\x1b') {
        abortController.abort();
      }
    };

    // Set up raw mode to capture ESC key
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onKeyPress);

    // Return cleanup function
    return () => {
      process.stdin.removeListener('data', onKeyPress);
      // Don't pause stdin - let customInput handle stdin setup
      // Just disable raw mode so normal input can work
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    };
  }

  /**
   * Process user query with LLM
   */
  async processQuery(query) {
    const spinner = ora('Thinking... (press ESC to cancel)').start();
    const abortController = new AbortController();
    const cleanup = this.setupCancellationListener(abortController);

    try {
      // Build prompt
      const prompt = await this.components.promptBuilder.buildPrompt(query);

      // Show token info
      spinner.text = `Thinking... (${prompt.metadata.totalTokens} tokens, press ESC to cancel)`;

      // Get LLM response with dynamic max_tokens to prevent truncation
      const response = await this.components.lmstudioClient.complete(prompt.messages, {
        promptTokens: prompt.metadata.totalTokens,
        forceTools: true, // Force Qwen3 models to use tools instead of just outputting text
        signal: abortController.signal,
        onProgress: (tokens, text) => {
          spinner.text = `Generating response... (${tokens} tokens, press ESC to cancel)`;
        },
      });

      spinner.stop();

      // Handle structured response format (tool calls or content)
      let parsed;
      let currentResponse;

      if (response.type === 'tool_calls') {

        try {
          // Import tool parsing functions
          const { parseToolCalls } = await import('./tools.js');

          // Parse tool calls
          const toolCalls = parseToolCalls(response);
          console.log(chalk.cyan(`\n🔧 Model requesting ${toolCalls.length} tool call(s)...`));

          // Execute tools and collect results as "tool" role messages
          const toolMessages = [];

          for (const toolCall of toolCalls) {
            console.log(chalk.gray(`  → ${toolCall.name}(${JSON.stringify(toolCall.arguments).substring(0, 60)}...)`));

            let toolResult = '';

            try {
              // Execute the tool based on its name
              switch (toolCall.name) {
                case 'search_code':
                  const keywords = toolCall.arguments.keywords || [];
                  const searchResults = await this.performSearch(keywords);
                  toolResult = searchResults || 'No results found';
                  break;

                case 'read_file_lines':
                  const lineResults = await this.handleReadLines([{
                    path: toolCall.arguments.path,
                    startLine: toolCall.arguments.start_line,
                    endLine: toolCall.arguments.end_line
                  }]);
                  toolResult = lineResults || 'Failed to read lines';
                  break;

                default:
                  toolResult = `Tool ${toolCall.name} not implemented for execution`;
              }
            } catch (error) {
              toolResult = `Error executing ${toolCall.name}: ${error.message}`;
            }

            // Add tool result as "tool" role message (per LM Studio docs)
            toolMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.name,
              content: toolResult
            });
          }

          // Now call model again WITHOUT tools parameter to get final response
          console.log(chalk.cyan('\n💭 Processing tool results...'));

          // Build messages array: original prompt + assistant tool calls + tool results
          const followUpMessages = [
            ...prompt.messages,
            response.message, // Assistant's message with tool_calls
            ...toolMessages   // Tool execution results
          ];

          const finalSpinner = ora('Generating final response...').start();

          const finalResponse = await this.components.lmstudioClient.complete(followUpMessages, {
            disableTools: true, // CRITICAL: Don't send tools in follow-up
            onProgress: (tokens, text) => {
              finalSpinner.text = `Generating final response... (${tokens} tokens generated)`;
            },
          });

          finalSpinner.stop();

          // Parse the final response (should be content or XML, not more tool calls)
          if (finalResponse.type === 'content') {
            currentResponse = finalResponse.content;
            parsed = this.components.responseParser.parseResponse(currentResponse);
          } else {
            // Shouldn't happen, but handle it
            console.warn(chalk.yellow('Warning: Got tool_calls in follow-up response'));
            currentResponse = finalResponse.message?.content || '';
            parsed = this.components.responseParser.parseResponse(currentResponse);
          }

          // Display the assistant's response
          console.log(chalk.cyan('\nAssistant:'));
          if (parsed.plainText) {
            console.log(parsed.plainText);
          }

        } catch (error) {
          console.error(chalk.red(`\n[ERROR] Failed to handle tool calls: ${error.message}`));
          console.log(chalk.yellow('Falling back to XML parsing...'));
          // Fall back to XML parsing
          currentResponse = response.message?.content || '';
          parsed = this.components.responseParser.parseResponse(currentResponse);
        }
      } else {
        // Regular text response - parse XML as before
        currentResponse = response.content;
        parsed = this.components.responseParser.parseResponse(currentResponse);
      }

      // Handle searches, read_lines, web searches, and web fetches for XML mode only
      // (Tool call mode already handled this above)
      let hasRequests = response.type !== 'tool_calls' && (
        (parsed.searches && parsed.searches.length > 0) ||
        (parsed.readLines && parsed.readLines.length > 0) ||
        (parsed.webSearches && parsed.webSearches.length > 0) ||
        (parsed.webFetches && parsed.webFetches.length > 0)
      );

      if (hasRequests) {
        console.log(chalk.cyan('\nAssistant:'));
        if (parsed.plainText) {
          console.log(parsed.plainText);
        }

        let additionalContext = '';

        // Handle codebase search requests
        if (parsed.searches && parsed.searches.length > 0) {
          const searchResults = await this.performSearch(parsed.searches);
          if (searchResults) {
            additionalContext += searchResults;
          }
        }

        // Handle read_lines requests
        if (parsed.readLines && parsed.readLines.length > 0) {
          console.log(chalk.cyan(`\n📖 Loading ${parsed.readLines.length} line range(s)...`));
          const lineResults = await this.handleReadLines(parsed.readLines);
          additionalContext += lineResults;
        }

        // Handle web search requests
        if (parsed.webSearches && parsed.webSearches.length > 0) {
          for (const query of parsed.webSearches) {
            console.log(chalk.cyan(`\n🌐 Searching web for: ${query}`));
            try {
              const results = await this.components.webScraper.searchWeb(query);
              const formatted = this.components.webScraper.formatSearchResults(results);
              additionalContext += `\n\nWEB SEARCH RESULTS FOR "${query}":\n${formatted}\n`;
            } catch (error) {
              console.log(chalk.red(`  ✗ Web search failed: ${error.message}`));
              additionalContext += `\n\nWEB SEARCH FAILED: ${error.message}\n`;
            }
          }
        }

        // Handle web fetch requests
        if (parsed.webFetches && parsed.webFetches.length > 0) {
          for (const url of parsed.webFetches) {
            console.log(chalk.cyan(`\n🌐 Fetching web page: ${url}`));
            try {
              const pageData = await this.components.webScraper.fetchWebPage(url);
              const formatted = this.components.webScraper.formatWebPage(pageData);
              additionalContext += `\n\n${formatted}\n`;
            } catch (error) {
              console.log(chalk.red(`  ✗ Web fetch failed: ${error.message}`));
              additionalContext += `\n\nWEB FETCH FAILED for ${url}: ${error.message}\n`;
            }
          }
        }

        // If we got additional context, do a follow-up query
        if (additionalContext) {
          const secondSpinner = ora('Processing additional context...').start();

          const followUpPrompt = await this.components.promptBuilder.buildPrompt(
            `Original query: "${query}"\n\n${additionalContext}\n\nNow please provide your response based on the above information.`
          );

          const followUpResponse = await this.components.lmstudioClient.complete(followUpPrompt.messages, {
            promptTokens: followUpPrompt.metadata.totalTokens,
            onProgress: (tokens, text) => {
              secondSpinner.text = `Generating response... (${tokens} tokens generated)`;
            },
          });
          secondSpinner.stop();

          // Parse the follow-up response (handle both tool calls and content)
          let finalParsed;
          try {
            if (followUpResponse.type === 'tool_calls') {
              const { parseToolCalls, convertToolCallsToActions } = await import('./tools.js');
              const toolCalls = parseToolCalls(followUpResponse);
              const actions = convertToolCallsToActions(toolCalls);
              finalParsed = {
                plainText: followUpResponse.message.content || '',
                searches: actions.searches,
                readLines: actions.readLines,
                fileEdits: actions.fileEdits,
                fileCreates: actions.fileCreates,
                fileDeletes: actions.fileDeletes,
                taskUpdates: actions.taskUpdates
              };
            } else {
              finalParsed = this.components.responseParser.parseResponse(followUpResponse.content);
            }
          } catch (error) {
            console.error(chalk.red(`\n[ERROR] Failed to parse follow-up response: ${error.message}`));
            // Fall back to XML parsing
            const responseText = followUpResponse.content || followUpResponse.message?.content || '';
            finalParsed = this.components.responseParser.parseResponse(responseText);
          }

          // Display the final response
          console.log(chalk.cyan('\n'));
          if (finalParsed.plainText) {
            console.log(finalParsed.plainText);
          }

          // Use finalParsed for actions
          parsed = finalParsed;
          // Extract text content from follow-up response
          currentResponse = followUpResponse.type === 'content'
            ? followUpResponse.content
            : (followUpResponse.message?.content || '');
        }
      } else {
        // No requests, display response normally
        console.log(chalk.cyan('\nAssistant:'));
        if (parsed.plainText) {
          console.log(parsed.plainText);
        }
      }

      // Show actions
      if (parsed.fileEdits.length > 0) {
        console.log(chalk.yellow(`\n📝 ${parsed.fileEdits.length} file edit(s) suggested`));
      }
      if (parsed.fileCreates.length > 0) {
        console.log(chalk.yellow(`📄 ${parsed.fileCreates.length} file create(s) suggested`));
      }
      if (parsed.taskUpdates.length > 0) {
        console.log(chalk.yellow(`✅ ${parsed.taskUpdates.length} task update(s)`));
      }

      // Refine edits using Edit Track if enabled (gives more file context)
      if (parsed.fileEdits.length > 0 && this.config.editTrack?.enabled) {
        parsed.fileEdits = await this.refineEditsWithEditTrack(parsed.fileEdits);
      }

      // Ask to execute actions
      // Check if there are any actions in the parsed response (tool calls or XML)
      const hasActions = (
        parsed.fileEdits.length > 0 ||
        parsed.fileCreates.length > 0 ||
        parsed.fileDeletes.length > 0 ||
        parsed.taskUpdates.length > 0
      );

      if (hasActions) {
        const { execute } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'execute',
            message: 'Execute these actions?',
            default: true,
          },
        ]);

        if (execute) {
          await this.executeActions(parsed);
        }
      }

      // Show token usage if available
      const usage = this.components.lmstudioClient.getLastUsage();
      if (usage) {
        console.log(chalk.gray(`\nTokens: ${usage.promptTokens} prompt + ${usage.completionTokens} completion = ${usage.totalTokens} total`));
      }

      // Save to history (use currentResponse which may be the follow-up response)
      this.components.contextManager.addMessage('user', query);
      this.components.contextManager.addMessage('assistant', currentResponse);

      // Check if compression needed using actual token usage and model's context window
      const shouldCompress = this.components.contextManager.shouldCompress(
        null, // Will use last usage
        null, // Will use model's context window
        this.config.contextManagement.compressionThreshold
      );

      if (shouldCompress) {
        const contextWindow = this.components.contextManager.getAvailableContext();
        const currentTokens = this.components.tokenCounter.countMessagesTokens(
          this.components.contextManager.history.full
        );
        const compressSpinner = ora(`Compressing history (${currentTokens}/${contextWindow} tokens)...`).start();

        await this.components.contextManager.compressHistory(
          this.config.contextManagement.recentMessagesCount,
          (tokens, text) => {
            compressSpinner.text = `Compressing history... (${tokens} tokens generated)`;
          }
        );

        // Calculate new size after compression
        const newTokens = this.components.tokenCounter.countMessagesTokens(
          this.components.contextManager.history.full
        );
        compressSpinner.succeed(`History compressed: ${currentTokens} → ${newTokens} tokens`);
      }

      // Save state
      await this.saveState();

    } catch (error) {
      // Handle cancellation
      if (error.name === 'CanceledError' || error.name === 'AbortError') {
        spinner.stop();
        // Clear the line to prevent display corruption
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(chalk.yellow('✗ Request cancelled'));
      } else {
        spinner.fail('Error processing query');
        console.error(chalk.red(error.message));
      }
    } finally {
      // Always cleanup cancellation listener
      if (cleanup) cleanup();
    }

    console.log(); // Empty line for spacing
  }

  /**
   * Execute parsed actions
   */
  /**
   * Find correct file path from codebase index by filename
   * @param {string} attemptedPath - The path that failed
   * @returns {string|null} - Correct path or null if not found/ambiguous
   */
  findFileInIndex(attemptedPath) {
    const filename = path.basename(attemptedPath);
    const matches = this.components.codebaseIndexer.index.files.filter(file => {
      return path.basename(file.relativePath) === filename;
    });

    if (matches.length === 1) {
      return matches[0].relativePath;
    } else if (matches.length > 1) {
      console.log(chalk.yellow(`\n  Multiple files named "${filename}" found:`));
      matches.forEach((match, idx) => {
        console.log(chalk.gray(`    ${idx + 1}. ${match.relativePath}`));
      });
      return null; // Ambiguous
    }
    return null; // Not found
  }

  /**
   * Refine file edits using Edit Track (focused context)
   * @param {Array<Object>} fileEdits - Original file edits from Main Track
   * @returns {Promise<Array<Object>>} - Refined file edits
   */
  async refineEditsWithEditTrack(fileEdits) {
    if (!this.config.editTrack?.enabled) {
      return fileEdits; // Edit Track disabled
    }

    const refinedEdits = [];
    const sizeThreshold = this.config.editTrack.useForFilesLargerThan || 300;
    const alwaysUse = this.config.editTrack.alwaysUseForEdits || false;

    for (const edit of fileEdits) {
      try {
        // Resolve file path
        let actualPath = edit.path;
        if (!this.components.fileOps.fileExists(actualPath)) {
          const foundPath = this.findFileInIndex(edit.path);
          if (foundPath) {
            actualPath = foundPath;
          }
        }

        // Check if file exists
        if (!this.components.fileOps.fileExists(actualPath)) {
          // Keep original edit if file doesn't exist (will fail later with proper error)
          refinedEdits.push(edit);
          continue;
        }

        // Read file to check size
        const fileContent = await this.components.fileOps.readFile(actualPath);
        const lineCount = fileContent.split('\n').length;

        // Decide whether to use Edit Track
        const useEditTrack = alwaysUse || lineCount > sizeThreshold;

        if (useEditTrack) {
          console.log(chalk.cyan(`\n🔍 Using Edit Track for ${actualPath} (${lineCount} lines)...`));

          // Build edit instruction from original edit
          const instruction = `Change the following code:\n\n${edit.oldText}\n\nTo:\n\n${edit.newText}`;

          // Build focused edit prompt
          const editPrompt = await this.components.promptBuilder.buildEditPrompt(
            actualPath,
            fileContent,
            instruction
          );

          // Get refined edit from LLM using Edit Track
          const spinner = ora('Generating focused edit...').start();
          const editResponse = await this.components.lmstudioClient.complete(editPrompt.messages, {
            promptTokens: editPrompt.metadata.totalTokens,
            onProgress: (tokens, text) => {
              spinner.text = `Generating focused edit... (${tokens} tokens generated)`;
            },
          });
          spinner.stop();

          // Parse the refined edit (handle both tool calls and content)
          let refinedParsed;
          if (editResponse.type === 'tool_calls') {
            const { parseToolCalls, convertToolCallsToActions } = await import('./tools.js');
            const toolCalls = parseToolCalls(editResponse);
            const actions = convertToolCallsToActions(toolCalls);
            refinedParsed = {
              plainText: editResponse.message.content || '',
              searches: actions.searches,
              readLines: actions.readLines,
              fileEdits: actions.fileEdits,
              fileCreates: actions.fileCreates,
              fileDeletes: actions.fileDeletes,
              taskUpdates: actions.taskUpdates
            };
          } else {
            refinedParsed = this.components.responseParser.parseResponse(editResponse.content);
          }

          if (refinedParsed.fileEdits.length > 0) {
            console.log(chalk.green(`✓ Generated refined edit with full file context`));
            // Use the refined edit
            refinedEdits.push(refinedParsed.fileEdits[0]);
          } else {
            console.log(chalk.yellow(`⚠ Edit Track didn't produce edit, using original`));
            refinedEdits.push(edit);
          }
        } else {
          // File is small enough, use original edit
          refinedEdits.push(edit);
        }
      } catch (error) {
        console.error(chalk.red(`Error refining edit for ${edit.path}: ${error.message}`));
        // Keep original edit on error
        refinedEdits.push(edit);
      }
    }

    return refinedEdits;
  }

  async executeActions(parsed) {
    const spinner = ora('Executing actions...').start();

    try {
      // Execute file edits
      for (const edit of parsed.fileEdits) {
        spinner.text = `Editing ${edit.path}...`;
        try {
          let actualPath = edit.path;
          let fileExists = this.components.fileOps.fileExists(actualPath);

          // If file not found, try to find it in the index
          if (!fileExists) {
            spinner.text = `File not found at ${edit.path}, searching index...`;
            const foundPath = this.findFileInIndex(edit.path);

            if (foundPath) {
              console.log(chalk.yellow(`  → Found at: ${foundPath}`));
              actualPath = foundPath;
              fileExists = this.components.fileOps.fileExists(actualPath);
            }
          }

          if (!fileExists) {
            const resolvedPath = this.components.fileOps.resolvePath(actualPath);
            throw new Error(`File not found at: ${resolvedPath}`);
          }

          await this.components.fileOps.editFile(actualPath, edit.oldText, edit.newText);
          console.log(chalk.green(`✓ Edited ${actualPath}`));
        } catch (error) {
          spinner.fail(`Failed to edit ${edit.path}`);
          console.error(chalk.red(`  Error: ${error.message}`));
          console.error(chalk.gray(`  Attempted path: ${edit.path}`));
          console.error(chalk.gray(`  Working directory: ${this.projectRoot}`));

          // Show a preview of what we tried to match
          if (edit.oldText && edit.oldText.length > 0) {
            const preview = edit.oldText.length > 100
              ? edit.oldText.substring(0, 100) + '...[truncated]'
              : edit.oldText;
            console.error(chalk.gray(`  Old text preview: ${JSON.stringify(preview)}`));
          }

          throw error; // Re-throw to stop execution
        }
      }

      // Execute file creates
      for (const create of parsed.fileCreates) {
        spinner.text = `Creating ${create.path}...`;
        try {
          await this.components.fileOps.createFile(create.path, create.content);
          console.log(chalk.green(`✓ Created ${create.path}`));
        } catch (error) {
          spinner.fail(`Failed to create ${create.path}`);
          console.error(chalk.red(`  Error: ${error.message}`));
          throw error;
        }
      }

      // Execute file deletes
      for (const del of parsed.fileDeletes) {
        spinner.text = `Deleting ${del.path}...`;
        try {
          let actualPath = del.path;
          let fileExists = this.components.fileOps.fileExists(actualPath);

          // If file not found, try to find it in the index
          if (!fileExists) {
            spinner.text = `File not found at ${del.path}, searching index...`;
            const foundPath = this.findFileInIndex(del.path);

            if (foundPath) {
              console.log(chalk.yellow(`  → Found at: ${foundPath}`));
              actualPath = foundPath;
              fileExists = this.components.fileOps.fileExists(actualPath);
            }
          }

          await this.components.fileOps.deleteFile(actualPath);
          console.log(chalk.green(`✓ Deleted ${actualPath}`));
        } catch (error) {
          spinner.fail(`Failed to delete ${del.path}`);
          console.error(chalk.red(`  Error: ${error.message}`));
          throw error;
        }
      }

      // Execute task updates
      for (const task of parsed.taskUpdates) {
        if (task.status === 'completed') {
          this.components.taskManager.completeTaskByDescription(task.description);
        } else {
          this.components.taskManager.addTask(task.description);
        }
      }

      spinner.succeed('Actions executed successfully');
    } catch (error) {
      // Error already logged above with specific context
      // Don't show success message if we caught an error
      if (spinner.isSpinning) {
        spinner.fail('Some actions failed');
      }
    }
  }

  /**
   * Show help
   */
  showHelp() {
    console.log(chalk.cyan('\n=== Available Commands ===\n'));
    console.log(chalk.white('/help') + chalk.gray('         - Show this help message'));
    console.log(chalk.white('/init') + chalk.gray('         - Index your codebase for context'));
    console.log(chalk.white('/context') + chalk.gray(' <n>  - Set context window size (e.g., /context 4096)'));
    console.log(chalk.white('/tools') + chalk.gray(' <on|off> - Enable/disable function calling (e.g., /tools on)'));
    console.log(chalk.white('/tasks') + chalk.gray('        - Show task list'));
    console.log(chalk.white('/history') + chalk.gray('      - Show conversation history'));
    console.log(chalk.white('/compress') + chalk.gray('     - Manually compress history'));
    console.log(chalk.white('/config') + chalk.gray('       - Show current configuration'));
    console.log(chalk.white('/stats') + chalk.gray('        - Show statistics'));
    console.log(chalk.white('/clear') + chalk.gray('        - Clear conversation history'));
    console.log(chalk.white('/exit') + chalk.gray('         - Exit application'));
    console.log();
  }

  /**
   * Show tasks
   */
  showTasks() {
    console.log('\n' + this.components.taskManager.getTaskSummary());
  }

  /**
   * Show history
   */
  showHistory() {
    const stats = this.components.contextManager.getStats();

    console.log(chalk.cyan('\n=== Conversation History ===\n'));
    console.log(chalk.white('Messages:'), stats.messageCount);
    console.log(chalk.white('Full tokens:'), stats.fullTokens);
    console.log(chalk.white('Compressed tokens:'), stats.compressedTokens);
    console.log(chalk.white('Has compression:'), stats.hasCompression ? 'Yes' : 'No');

    if (stats.compressionRatio > 0) {
      console.log(chalk.white('Compression ratio:'), stats.compressionRatio.toFixed(2) + 'x');
    }

    console.log();
  }

  /**
   * Rebuild codebase index
   */
  async rebuildIndex() {
    console.log(chalk.cyan('\n=== Rebuilding Codebase Index ===\n'));

    const spinner = ora('Scanning files...').start();

    await this.components.codebaseIndexer.buildIndex((current, total, file) => {
      spinner.text = `Indexing (${current}/${total}): ${path.basename(file)}`;
    });

    const indexPath = path.join(this.lmcodeDir, 'codebase_index.json');
    await this.components.codebaseIndexer.saveIndex(indexPath);

    spinner.succeed(`Indexed ${this.components.codebaseIndexer.index.files.length} files`);

    const structure = this.components.codebaseIndexer.getProjectStructure();
    console.log(chalk.white('\nProject Structure:'));
    console.log(chalk.gray(`  Files: ${structure.fileCount}`));
    console.log(chalk.gray(`  Functions: ${structure.totalFunctions}`));
    console.log(chalk.gray(`  Classes: ${structure.totalClasses}`));
    console.log();

    // Check if context needs compression after indexing
    await this.checkAndCompressContext();
  }

  /**
   * Compress history manually
   */
  async compressHistory() {
    const currentTokens = this.components.tokenCounter.countMessagesTokens(
      this.components.contextManager.history.full
    );
    const spinner = ora('Compressing conversation history...').start();

    try {
      await this.components.contextManager.compressHistory(
        this.config.contextManagement.recentMessagesCount,
        (tokens, text) => {
          spinner.text = `Compressing conversation history... (${tokens} tokens generated)`;
        }
      );
      await this.components.contextManager.saveHistory();

      const newTokens = this.components.tokenCounter.countMessagesTokens(
        this.components.contextManager.history.full
      );
      spinner.succeed(`History compressed: ${currentTokens} → ${newTokens} tokens`);
    } catch (error) {
      spinner.fail('Failed to compress history');
      console.error(chalk.red(error.message));
    }
  }

  /**
   * Show configuration
   */
  showConfig() {
    console.log(chalk.cyan('\n=== Configuration ===\n'));
    console.log(chalk.white('Project Root:'), this.projectRoot);
    console.log(chalk.white('LMCode Directory:'), this.lmcodeDir);
    console.log(chalk.white('\nLMStudio:'));
    console.log(chalk.gray(`  Base URL: ${this.config.lmstudio.baseURL}`));
    console.log(chalk.gray(`  Model: ${this.config.lmstudio.model}`));
    console.log(chalk.gray(`  Temperature: ${this.config.lmstudio.temperature}`));

    const contextWindow = this.components.lmstudioClient.getContextWindow();
    console.log(chalk.white('\nContext Management:'));
    if (contextWindow) {
      console.log(chalk.gray(`  Model Context Window: ${contextWindow} tokens`));
    } else {
      console.log(chalk.gray(`  Model Context Window: Not set (use /context command)`));
    }
    console.log(chalk.gray(`  Compression Threshold: ${this.config.contextManagement.compressionThreshold * 100}%`));
    console.log(chalk.gray(`  Recent Messages Count: ${this.config.contextManagement.recentMessagesCount}`));

    const usage = this.components.lmstudioClient.getLastUsage();
    if (usage) {
      console.log(chalk.white('\nLast Request:'));
      console.log(chalk.gray(`  Prompt Tokens: ${usage.promptTokens}`));
      console.log(chalk.gray(`  Completion Tokens: ${usage.completionTokens}`));
      console.log(chalk.gray(`  Total Tokens: ${usage.totalTokens}`));
      console.log(chalk.gray(`  Time: ${new Date(usage.timestamp).toLocaleTimeString()}`));
    }

    console.log();
  }

  /**
   * Set context length manually
   */
  async setContextLength(args) {
    if (args.length === 0) {
      const currentContext = this.components.lmstudioClient.getContextWindow();
      if (currentContext) {
        console.log(chalk.white(`\nCurrent context window: ${currentContext} tokens`));
      } else {
        console.log(chalk.yellow('\nContext window not set'));
      }
      console.log(chalk.gray('Usage: /context <number>'));
      console.log(chalk.gray('Example: /context 4096\n'));
      return;
    }

    const contextValue = parseInt(args[0], 10);

    if (isNaN(contextValue) || contextValue <= 0) {
      console.log(chalk.red('Error: Context length must be a positive number'));
      return;
    }

    if (contextValue < 512) {
      console.log(chalk.yellow('Warning: Context length seems very small (< 512 tokens)'));
      console.log(chalk.gray('Are you sure this is correct?\n'));
    }

    // Update LMStudio client (session only, not saved)
    this.components.lmstudioClient.contextWindow = contextValue;

    console.log(chalk.green(`✓ Context window set to ${contextValue} tokens for this session\n`));
  }

  /**
   * Toggle tool support on/off
   */
  async toggleTools(args) {
    if (args.length === 0) {
      const status = this.components.lmstudioClient.supportsTools;
      console.log(chalk.white(`\nTool support: ${status ? chalk.green('ENABLED (Function Calling)') : chalk.yellow('DISABLED (XML mode)')}`));
      console.log(chalk.gray('\nUsage: /tools on  or  /tools off'));
      console.log(chalk.gray('When enabled, model uses function calling instead of XML tags'));
      console.log(chalk.gray('\nNote: Tool support is auto-detected at startup with a test call.\n'));
      return;
    }

    const action = args[0].toLowerCase();

    if (action === 'on' || action === 'enable' || action === '1' || action === 'true') {
      this.components.lmstudioClient.supportsTools = true;
      console.log(chalk.green('\n✓ Tool support ENABLED for this session'));
      console.log(chalk.gray('The model will use function calling instead of XML tags'));
      console.log(chalk.yellow('\nWarning: If tool calling was auto-disabled, it may not work properly.\n'));
    } else if (action === 'off' || action === 'disable' || action === '0' || action === 'false') {
      this.components.lmstudioClient.supportsTools = false;
      console.log(chalk.yellow('\n✓ Tool support DISABLED for this session'));
      console.log(chalk.gray('The model will use XML tags for actions\n'));
    } else {
      console.log(chalk.red('\nError: Invalid argument'));
      console.log(chalk.gray('Usage: /tools on  or  /tools off\n'));
    }
  }

  /**
   * Show statistics
   */
  showStats() {
    console.log(chalk.cyan('\n=== Statistics ===\n'));

    const historyStats = this.components.contextManager.getStats();
    const projectStructure = this.components.codebaseIndexer.getProjectStructure();
    const tasks = this.components.taskManager.getAllTasks();
    const contextWindow = this.components.contextManager.getAvailableContext();
    const usage = this.components.lmstudioClient.getLastUsage();

    console.log(chalk.white('Model:'));
    console.log(chalk.gray(`  Context Window: ${contextWindow} tokens`));
    if (usage) {
      console.log(chalk.gray(`  Last Usage: ${usage.totalTokens} tokens (${((usage.totalTokens / contextWindow) * 100).toFixed(1)}% of context)`));
    }

    console.log(chalk.white('\nConversation:'));
    console.log(chalk.gray(`  Messages: ${historyStats.messageCount}`));
    console.log(chalk.gray(`  Full Tokens: ${historyStats.fullTokens}`));
    if (historyStats.hasCompression) {
      console.log(chalk.gray(`  Compressed Tokens: ${historyStats.compressedTokens}`));
      console.log(chalk.gray(`  Compression Ratio: ${historyStats.compressionRatio.toFixed(1)}x`));
    }

    console.log(chalk.white('\nCodebase:'));
    console.log(chalk.gray(`  Files indexed: ${projectStructure.fileCount}`));
    console.log(chalk.gray(`  Functions: ${projectStructure.totalFunctions}`));
    console.log(chalk.gray(`  Classes: ${projectStructure.totalClasses}`));

    console.log(chalk.white('\nTasks:'));
    console.log(chalk.gray(`  Total: ${tasks.length}`));
    console.log(chalk.gray(`  Pending: ${this.components.taskManager.getPendingTasks().length}`));
    console.log(chalk.gray(`  Completed: ${this.components.taskManager.getCompletedTasks().length}`));
    console.log();
  }

  /**
   * Clear conversation history
   */
  async clearHistory() {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to clear conversation history?',
        default: false,
      },
    ]);

    if (confirm) {
      this.components.contextManager.clearHistory();
      await this.components.contextManager.saveHistory();
      console.log(chalk.green('✓ History cleared'));
    }
  }

  /**
   * Save all state
   */
  async saveState() {
    await this.components.taskManager.saveTasks();
    await this.components.contextManager.saveHistory();
  }
}

/**
 * CLI Setup
 */
const program = new Command();

program
  .name('lmcode')
  .description('LMCode - Context management for LMStudio')
  .version('1.0.0');

program
  .command('start')
  .description('Start interactive session (default)')
  .action(async () => {
    const app = new LMStudioContextManager();
    await app.initialize();
    await app.startInteractive();
  });

program
  .command('index')
  .description('Index the codebase for better context')
  .action(async () => {
    const app = new LMStudioContextManager();
    await app.initialize();
    await app.rebuildIndex();
  });

program
  .command('tasks')
  .description('Show task list')
  .action(async () => {
    const app = new LMStudioContextManager();
    await app.initialize();
    app.showTasks();
  });

program
  .command('history')
  .description('Show conversation history')
  .action(async () => {
    const app = new LMStudioContextManager();
    await app.initialize();
    app.showHistory();
  });

program
  .command('config')
  .description('Show current configuration')
  .action(async () => {
    const app = new LMStudioContextManager();
    await app.initialize();
    app.showConfig();
  });

program
  .command('stats')
  .description('Show statistics')
  .action(async () => {
    const app = new LMStudioContextManager();
    await app.initialize();
    app.showStats();
  });

// If no command provided, default to 'start'
if (!process.argv.slice(2).length) {
  // Auto-start interactive mode when no command is given
  (async () => {
    const app = new LMStudioContextManager();
    await app.initialize();
    await app.startInteractive();
  })();
} else {
  // Parse commands normally
  program.parse(process.argv);
}
