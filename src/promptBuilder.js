/**
 * PromptBuilder - Assembles prompts from various components
 * Manages token budgets and combines system prompt, task list, files, and history
 */
class PromptBuilder {
  constructor(config, contextManager, taskManager, codebaseIndexer, tokenCounter, fileOps) {
    this.config = config;
    this.contextManager = contextManager;
    this.taskManager = taskManager;
    this.codebaseIndexer = codebaseIndexer;
    this.tokenCounter = tokenCounter;
    this.fileOps = fileOps;
    this.customInstructions = null;
  }

  /**
   * Set custom instructions from LMCODE.md
   * @param {string} instructions - Custom instructions text
   */
  setCustomInstructions(instructions) {
    this.customInstructions = instructions;
  }

  /**
   * Build complete prompt for user query
   * @param {string} userQuery - User's question or request
   * @param {Object} options - Build options
   * @returns {Promise<Object>} - Assembled prompt with messages and metadata
   */
  async buildPrompt(userQuery, options = {}) {
    // Use actual model context window, not config value
    const contextWindow = this.contextManager.getAvailableContext();
    const maxTokens = options.maxTokens || contextWindow || this.config.lmstudio.maxTokens;
    const availableTokens = this.tokenCounter.calculateAvailableTokens(maxTokens, 800);

    // Allocate token budget
    const budget = this.tokenCounter.allocateTokenBudget(availableTokens);

    // Build components
    const systemPrompt = await this.buildSystemPrompt(options.mode);
    const taskList = this.taskManager.getTaskListForPrompt();
    const relevantFiles = await this.findRelevantFiles(userQuery, options.maxFiles);

    // Get conversation history
    const historyData = this.contextManager.getMessagesForPrompt(
      budget.recentHistory + budget.compressedHistory,
      this.config.contextManagement.recentMessagesCount
    );

    // Assemble the full prompt
    const messages = [];

    // System message
    let systemContent = systemPrompt;

    // Add custom instructions if available
    if (this.customInstructions) {
      systemContent += '\n\n# PROJECT INSTRUCTIONS\n\n' + this.customInstructions;
    }

    if (taskList && taskList !== 'No pending tasks.') {
      systemContent += '\n\n' + taskList;
    }

    messages.push({
      role: 'system',
      content: systemContent,
    });

    // Add compressed history if exists
    if (historyData.compressedHistory) {
      messages.push({
        role: 'system',
        content: `PREVIOUS CONVERSATION SUMMARY:\n${historyData.compressedHistory}`,
      });
    }

    // Add relevant files
    if (relevantFiles.length > 0) {
      const filesContent = this.formatFileContents(relevantFiles, budget.fileContents);
      if (filesContent) {
        messages.push({
          role: 'system',
          content: filesContent,
        });
      }
    }

    // Add recent conversation history
    for (const msg of historyData.recentMessages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add user query
    messages.push({
      role: 'user',
      content: userQuery,
    });

    // Calculate actual token usage
    let actualTokens = this.tokenCounter.countMessagesTokens(messages);

    // Safety check: if prompt exceeds available tokens, reduce content
    if (actualTokens > availableTokens) {
      console.warn(`Prompt exceeds available tokens (${actualTokens}/${availableTokens}), reducing content...`);

      // Strategy: Remove oldest history messages first
      const systemMessageCount = messages.filter(m => m.role === 'system').length;
      while (actualTokens > availableTokens && messages.length > systemMessageCount + 1) {
        // Find and remove the oldest non-system message (but keep user query)
        let removed = false;
        for (let i = systemMessageCount; i < messages.length - 1; i++) {
          if (messages[i].role !== 'system') {
            messages.splice(i, 1);
            removed = true;
            break;
          }
        }
        if (!removed) break; // Can't reduce further
        actualTokens = this.tokenCounter.countMessagesTokens(messages);
      }

      // If still too large, remove files from system messages
      if (actualTokens > availableTokens) {
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].role === 'system' && messages[i].content.includes('RELEVANT FILES:')) {
            messages.splice(i, 1);
            actualTokens = this.tokenCounter.countMessagesTokens(messages);
            break;
          }
        }
      }
    }

    return {
      messages,
      metadata: {
        totalTokens: actualTokens,
        availableTokens,
        budget,
        fileCount: relevantFiles.length,
        historyMessageCount: historyData.recentMessages.length,
        hasCompressedHistory: !!historyData.compressedHistory,
        wasReduced: actualTokens > availableTokens, // Flag if we had to reduce
      },
    };
  }

  /**
   * Find relevant files for the query
   * @param {string} query - User query
   * @param {number} maxFiles - Maximum files to return
   * @returns {Promise<Array<Object>>} - Relevant files with content
   */
  async findRelevantFiles(query, maxFiles = null) {
    const limit = maxFiles || this.config.contextManagement.maxFilesInContext;

    // Search for relevant files
    const searchResults = this.codebaseIndexer.searchFiles(query, limit);

    // Load file contents
    const files = [];
    for (const fileInfo of searchResults) {
      try {
        const content = await this.fileOps.readFile(fileInfo.path);
        files.push({
          path: fileInfo.relativePath,
          content,
          size: fileInfo.size,
        });
      } catch (error) {
        console.warn(`Failed to read file ${fileInfo.relativePath}: ${error.message}`);
      }
    }

    return files;
  }

  /**
   * Build system prompt
   * @param {string} mode - Prompt mode ('normal' or 'terse')
   * @returns {Promise<string>} - System prompt text
   */
  async buildSystemPrompt(mode = 'normal') {
    const promptMode = mode || this.config.prompts.mode;
    const promptPath =
      promptMode === 'terse'
        ? this.config.prompts.tersePromptPath
        : this.config.prompts.systemPromptPath;

    try {
      if (this.fileOps.fileExists(promptPath)) {
        return await this.fileOps.readFile(promptPath);
      }
    } catch (error) {
      console.warn(`Failed to load system prompt from ${promptPath}: ${error.message}`);
    }

    // Fallback to default system prompt
    return this.getDefaultSystemPrompt(promptMode);
  }

  /**
   * Get default system prompt
   * @param {string} mode - Prompt mode
   * @returns {string} - Default system prompt
   */
  getDefaultSystemPrompt(mode = 'normal') {
    if (mode === 'terse') {
      return `You are a coding assistant. Be concise. Use XML tags for actions:
<file_edit><path>file.js</path><operation>replace</operation><old>old code</old><new>new code</new></file_edit>
CRITICAL: Use EXACT path from file header. If file shows "--- src/utils/helper.js ---", use <path>src/utils/helper.js</path> NOT <path>helper.js</path>
<file_create><path>file.js</path><content>content here</content></file_create>
<file_delete><path>file.js</path></file_delete>
<task_update>
- DONE: completed task
- TODO: new task
- IN_PROGRESS: current task
</task_update>
<question>Ask user if unclear</question>

<search>keyword1, keyword2</search> ← Search files (≤500 lines: full file, >500 lines: snippets with line numbers)
Example: "add error handling" → <search>connect, connection, error, try, catch</search>

<read_lines><path>file.js</path><start>100</start><end>200</end></read_lines> ← Load specific lines from large files
⚠️ CRITICAL: Search snippets marked [SNIPPET]...[END SNIPPET] are PREVIEWS ONLY - not complete code!
NEVER try to "fix" snippet truncation. ALWAYS use <read_lines> to get complete code before editing.

⚠️ File size targets when writing code:
- IDEAL: 150-300 lines | GOOD: 300-500 lines | MAX: 500 lines
- Keep files ≤500 lines so they fit completely in context for easy editing
- Prefer multiple small, focused files over one large file`;
    }

    return `You are an expert coding assistant helping with software development.

Your role:
- Help write, debug, and improve code
- Answer technical questions
- Suggest best practices and optimizations
- Understand and navigate codebases

When making file changes, use these XML tags:

File Edit:
<file_edit>
<path>relative/path/to/file.js</path>
<operation>replace</operation>
<old>exact text to find</old>
<new>replacement text</new>
</file_edit>

CRITICAL: In the <path> tag, you MUST use the EXACT path shown in the file header (--- path ---).
For example, if you see "--- src/utils/helper.js ---", use <path>src/utils/helper.js</path>, NOT <path>helper.js</path>.

File Create:
<file_create>
<path>new/file.js</path>
<content>
file contents here
</content>
</file_create>

File Delete:
<file_delete>
<path>file/to/delete.js</path>
</file_delete>

Task Updates:
<task_update>
- DONE: Task description when completed
- TODO: New task to add
- IN_PROGRESS: Currently working on
</task_update>

Questions:
<question>
Ask user for clarification if requirements are unclear
</question>

Codebase Search and Exploration:

1. SEARCH - Find files containing specific code:
<search>
keyword1, keyword2, keyword3
</search>

The system searches ALL files and returns:
- Small files (≤500 lines): Complete file content for immediate editing
- Large files (>500 lines): Relevant snippets with line numbers

IMPORTANT: Think about CODE-LEVEL keywords, not just prompt words.

Examples:
- User: "remove simulated references" → <search>simulated, simulation, sim</search>
- User: "add error handling to connections" → <search>connect, connection, establish, init, setup</search>
- User: "make LED blink faster" → <search>LED, blink, delay, timer, digitalWrite, millis</search>

ALWAYS search for multiple related terms!

2. READ LINE RANGES - Get specific sections of large files:
<read_lines>
<path>relative/path/to/file.js</path>
<start>100</start>
<end>200</end>
</read_lines>

⚠️ CRITICAL: Search results show SNIPPETS (marked [SNIPPET]...[END SNIPPET]) - these are PREVIEWS only!
- Snippets are NOT complete code - they're truncated to show matches
- NEVER try to "fix" snippet boundaries or truncation
- ALWAYS use <read_lines> to get complete code before editing

WORKFLOW FOR LARGE FILES:
1. Search for keywords → get snippets (previews) with line numbers
2. Use <read_lines> to request complete context around those line numbers
3. Make edits with complete understanding

Remember: Snippets are for LOCATING code, <read_lines> is for LOADING complete code!

Guidelines:
- Always include the full path relative to project root (e.g., "src/file.js", not "--- src/file.js ---")
- For edits, make sure "old" text exactly matches file content
- Keep changes focused and incremental
- Explain your reasoning before making changes
- If unsure, ask questions rather than guessing
- Do NOT include file header markers (like "---") in the path tags

⚠️ IMPORTANT - File Size When Writing Code:
Target: 150-300 lines (ideal), 300-500 lines (good), 500+ lines (too large)
- Keep files ≤500 lines so they fit completely in context for easy editing
- Prefer multiple small, focused files over one large file
- Split files approaching 400+ lines into separate modules
- Extract utilities, helpers, and constants to their own files
Why: Files ≤500 lines can be loaded completely. Larger files require progressive loading and are harder to maintain.`;
  }

  /**
   * Format file contents for prompt inclusion
   * @param {Array<Object>} files - Files with content
   * @param {number} tokenBudget - Token budget for files
   * @returns {string} - Formatted file contents
   */
  formatFileContents(files, tokenBudget) {
    if (files.length === 0) return '';

    let content = 'RELEVANT FILES:\n\n';
    let tokensUsed = this.tokenCounter.countTokens(content);

    for (const file of files) {
      const fileHeader = `--- ${file.path} ---\n`;
      const fileContent = file.content;
      const fileFooter = '\n\n';

      const fileBlock = fileHeader + fileContent + fileFooter;
      const fileTokens = this.tokenCounter.countTokens(fileBlock);

      // Check if adding this file would exceed budget
      if (tokensUsed + fileTokens > tokenBudget) {
        // Try to fit truncated version
        const availableTokens = tokenBudget - tokensUsed - this.tokenCounter.countTokens(fileHeader + fileFooter);
        if (availableTokens > 100) {
          const truncated = this.tokenCounter.truncateToTokenLimit(fileContent, availableTokens);
          content += fileHeader + truncated + fileFooter;
        }
        break; // No more space for files
      }

      content += fileBlock;
      tokensUsed += fileTokens;
    }

    return content.trim();
  }

  /**
   * Format single file content
   * @param {string} filePath - File path
   * @param {string} content - File content
   * @returns {string} - Formatted file
   */
  formatFileContent(filePath, content) {
    return `--- ${filePath} ---\n${content}\n`;
  }

  /**
   * Format task list
   * @param {Array<Object>} tasks - Task objects
   * @returns {string} - Formatted task list
   */
  formatTaskList(tasks) {
    if (tasks.length === 0) return 'No pending tasks.';

    const pending = tasks.filter(t => t.status === 'pending');
    const inProgress = tasks.filter(t => t.status === 'in-progress');

    let output = 'CURRENT TASKS:\n';

    if (inProgress.length > 0) {
      output += '\nIn Progress:\n';
      inProgress.forEach(task => {
        output += `- ${task.description}\n`;
      });
    }

    if (pending.length > 0) {
      output += '\nPending:\n';
      pending.forEach(task => {
        output += `- ${task.description}\n`;
      });
    }

    return output;
  }

  /**
   * Create a minimal prompt for quick queries (skip file search)
   * @param {string} userQuery - User query
   * @returns {Promise<Object>} - Minimal prompt
   */
  async buildMinimalPrompt(userQuery) {
    const systemPrompt = await this.buildSystemPrompt('terse');
    const taskList = this.taskManager.getTaskListForPrompt();

    const messages = [
      {
        role: 'system',
        content: taskList !== 'No pending tasks.' ? systemPrompt + '\n\n' + taskList : systemPrompt,
      },
      {
        role: 'user',
        content: userQuery,
      },
    ];

    const totalTokens = this.tokenCounter.countMessagesTokens(messages);

    return {
      messages,
      metadata: {
        totalTokens,
        minimal: true,
      },
    };
  }

  /**
   * Build focused edit prompt (EDIT TRACK)
   * Minimal context for making file edits without conversation history
   * @param {string} filePath - Path to file being edited
   * @param {string} fileContent - Complete file content
   * @param {string} editInstruction - What to change and why
   * @returns {Promise<Object>} - Focused edit prompt
   */
  async buildEditPrompt(filePath, fileContent, editInstruction) {
    // Load minimal edit-focused system prompt
    const editPromptPath = './templates/edit_prompt.txt';
    let editSystemPrompt = '';

    try {
      if (this.fileOps.fileExists(editPromptPath)) {
        editSystemPrompt = await this.fileOps.readFile(editPromptPath);
      }
    } catch (error) {
      // Fallback to inline minimal prompt
      editSystemPrompt = `You are a precise code editor. Make the requested changes safely.

<file_edit>
<path>path/to/file</path>
<operation>replace</operation>
<old>exact text to find</old>
<new>replacement text</new>
</file_edit>

CRITICAL: The <old> text must EXACTLY match what's in the file. Include enough context (10-20 lines) to make the match unique.`;
    }

    // Get current task list for context
    const taskList = this.taskManager.getTaskListForPrompt();

    // Build minimal message array
    const messages = [
      {
        role: 'system',
        content: editSystemPrompt + (taskList !== 'No pending tasks.' ? '\n\n' + taskList : ''),
      },
      {
        role: 'user',
        content: `FILE TO EDIT:\n\n--- ${filePath} ---\n${fileContent}\n\nINSTRUCTION:\n${editInstruction}`,
      },
    ];

    const totalTokens = this.tokenCounter.countMessagesTokens(messages);

    return {
      messages,
      metadata: {
        totalTokens,
        editTrack: true,
        filePath,
      },
    };
  }

  /**
   * Add specific files to prompt
   * @param {Array<string>} filePaths - Paths to files
   * @param {number} tokenBudget - Token budget
   * @returns {Promise<string>} - Formatted file contents
   */
  async addSpecificFiles(filePaths, tokenBudget) {
    const files = [];

    for (const filePath of filePaths) {
      try {
        const content = await this.fileOps.readFile(filePath);
        const relativePath = this.fileOps.getRelativePath(filePath);
        files.push({
          path: relativePath,
          content,
        });
      } catch (error) {
        console.warn(`Failed to read file ${filePath}: ${error.message}`);
      }
    }

    return this.formatFileContents(files, tokenBudget);
  }

  /**
   * Get prompt statistics
   * @param {Object} prompt - Built prompt
   * @returns {Object} - Statistics
   */
  getPromptStats(prompt) {
    return {
      messageCount: prompt.messages.length,
      totalTokens: prompt.metadata.totalTokens,
      fileCount: prompt.metadata.fileCount || 0,
      historyMessages: prompt.metadata.historyMessageCount || 0,
      hasCompression: prompt.metadata.hasCompressedHistory || false,
    };
  }
}

export default PromptBuilder;
