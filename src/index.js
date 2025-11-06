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
      maxTokens: 4096,
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
          this.config.contextManagement.recentMessagesCount
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
      spinner.succeed(`Connected to LMStudio (context: ${contextWindow} tokens, model: ${modelName})`);

      return true;
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
  async customInput(prompt) {
    return new Promise((resolve) => {
      let input = '';
      let cursorPos = 0; // Position in the input string
      const promptLength = prompt.replace(/\x1b\[[0-9;]*m/g, '').length; // Strip ANSI codes for length
      const terminalWidth = process.stdout.columns || 80;

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
        const numLines = Math.ceil(totalLength / terminalWidth);

        // Move cursor to start of first line and clear everything
        if (numLines > 1) {
          // Move cursor up to the first line
          process.stdout.write(`\x1b[${numLines - 1}A`);
        }
        // Move to start of line
        readline.cursorTo(process.stdout, 0);
        // Clear from cursor to end of screen
        readline.clearScreenDown(process.stdout);

        // Redraw prompt and input
        process.stdout.write(prompt + input);

        // Position cursor at the correct location
        const absolutePos = promptLength + cursorPos;
        const line = Math.floor(absolutePos / terminalWidth);
        const col = absolutePos % terminalWidth;

        // Move cursor to correct position
        if (line > 0) {
          process.stdout.write(`\x1b[${line}A`); // Move up if needed
        }
        readline.cursorTo(process.stdout, col);
      };

      const onData = async (key) => {
        const code = key.charCodeAt(0);

        // Ctrl+C - exit
        if (code === 3) {
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
    console.log(chalk.gray('Type your questions or commands. Use /help for available commands.\n'));

    // Check connection
    const connected = await this.testConnection();
    if (!connected) {
      console.log(chalk.yellow('\nContinuing anyway (you can still use local commands)...\n'));
    } else {
      // Check if context needs compression on startup
      await this.checkAndCompressContext();
    }

    // Main interaction loop
    while (true) {
      const input = await this.customInput(chalk.green('You: '));

      const trimmedInput = input.trim();

      if (!trimmedInput) continue;

      // Handle commands
      if (trimmedInput.startsWith('/')) {
        const shouldContinue = await this.handleCommand(trimmedInput);
        if (!shouldContinue) break;
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
   * Process user query with LLM
   */
  async processQuery(query) {
    const spinner = ora('Thinking...').start();

    try {
      // Build prompt
      const prompt = await this.components.promptBuilder.buildPrompt(query);

      // Show token info
      spinner.text = `Thinking... (${prompt.metadata.totalTokens} tokens)`;

      // Get LLM response with dynamic max_tokens to prevent truncation
      const response = await this.components.lmstudioClient.complete(prompt.messages, {
        promptTokens: prompt.metadata.totalTokens,
      });

      spinner.stop();

      // Parse response
      let parsed = this.components.responseParser.parseResponse(response);
      let currentResponse = response;

      // Handle searches and read_lines requests (may need multiple rounds)
      let hasRequests = (parsed.searches && parsed.searches.length > 0) ||
                        (parsed.readLines && parsed.readLines.length > 0);

      if (hasRequests) {
        console.log(chalk.cyan('\nAssistant:'));
        if (parsed.plainText) {
          console.log(parsed.plainText);
        }

        let additionalContext = '';

        // Handle search requests
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

        // If we got additional context, do a follow-up query
        if (additionalContext) {
          const secondSpinner = ora('Processing additional context...').start();

          const followUpPrompt = await this.components.promptBuilder.buildPrompt(
            `Original query: "${query}"\n\n${additionalContext}\n\nNow please provide your response based on the above information.`
          );

          const followUpResponse = await this.components.lmstudioClient.complete(followUpPrompt.messages, {
            promptTokens: followUpPrompt.metadata.totalTokens,
          });
          secondSpinner.stop();

          // Parse the follow-up response
          const finalParsed = this.components.responseParser.parseResponse(followUpResponse);

          // Display the final response
          console.log(chalk.cyan('\n'));
          if (finalParsed.plainText) {
            console.log(finalParsed.plainText);
          }

          // Use finalParsed for actions
          parsed = finalParsed;
          currentResponse = followUpResponse;
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
      if (this.components.responseParser.hasActions(currentResponse)) {
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
          this.config.contextManagement.recentMessagesCount
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
      spinner.fail('Error processing query');
      console.error(chalk.red(error.message));
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
          });
          spinner.stop();

          // Parse the refined edit
          const refinedParsed = this.components.responseParser.parseResponse(editResponse);

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
      // Error already handled above with specific context
    }
  }

  /**
   * Show help
   */
  showHelp() {
    console.log(chalk.cyan('\n=== Available Commands ===\n'));
    console.log(chalk.white('/help') + chalk.gray('     - Show this help message'));
    console.log(chalk.white('/init') + chalk.gray('     - Index your codebase for context'));
    console.log(chalk.white('/tasks') + chalk.gray('    - Show task list'));
    console.log(chalk.white('/history') + chalk.gray('  - Show conversation history'));
    console.log(chalk.white('/compress') + chalk.gray(' - Manually compress history'));
    console.log(chalk.white('/config') + chalk.gray('   - Show current configuration'));
    console.log(chalk.white('/stats') + chalk.gray('    - Show statistics'));
    console.log(chalk.white('/clear') + chalk.gray('    - Clear conversation history'));
    console.log(chalk.white('/exit') + chalk.gray('     - Exit application'));
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
        this.config.contextManagement.recentMessagesCount
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
    console.log(chalk.gray(`  Max Response Tokens: ${this.config.lmstudio.maxTokens}`));

    const contextWindow = this.components.lmstudioClient.getContextWindow();
    console.log(chalk.white('\nContext Management:'));
    console.log(chalk.gray(`  Model Context Window: ${contextWindow} tokens (from API)`));
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
