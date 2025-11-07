import FileOperations from './fileOperations.js';

/**
 * ContextManager - Manages conversation history and compression
 * Handles context window management and history compression
 */
class ContextManager {
  constructor(historyPath, lmstudioClient, tokenCounter, fileOps) {
    this.historyPath = historyPath;
    this.lmstudioClient = lmstudioClient;
    this.tokenCounter = tokenCounter;
    this.fileOps = fileOps;

    // History structure
    this.history = {
      full: [],           // All messages
      compressed: '',     // Compressed older messages
      activeWindow: [],   // Current messages in context
    };

    this.loaded = false;
  }

  /**
   * Initialize and load history
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.loadHistory();
  }

  /**
   * Add a message to history
   * @param {string} role - Message role (system, user, assistant)
   * @param {string} content - Message content
   */
  addMessage(role, content) {
    const message = {
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    this.history.full.push(message);
  }

  /**
   * Get recent messages
   * @param {number} count - Number of recent messages to get
   * @returns {Array} - Recent messages
   */
  getRecentMessages(count) {
    return this.history.full.slice(-count);
  }

  /**
   * Get compressed history text
   * @returns {string} - Compressed history
   */
  getCompressedHistory() {
    return this.history.compressed;
  }

  /**
   * Get available context window size
   * Uses actual model context window from LMStudio API
   * @returns {number} - Context window size in tokens
   */
  getAvailableContext() {
    return this.lmstudioClient.getContextWindow();
  }

  /**
   * Check if compression is needed
   * @param {number} currentTokens - Current token count (optional, will use last usage if not provided)
   * @param {number} maxTokens - Maximum allowed tokens (optional, will use model's context window)
   * @param {number} threshold - Compression threshold (0-1)
   * @returns {boolean} - True if compression needed
   */
  shouldCompress(currentTokens = null, maxTokens = null, threshold = 0.7) {
    // Use actual token usage if available
    if (currentTokens === null) {
      const lastUsage = this.lmstudioClient.getLastUsage();
      currentTokens = lastUsage?.promptTokens || this.tokenCounter.countMessagesTokens(this.history.full);
    }

    // Use dynamic context window from model
    const contextWindow = maxTokens || this.getAvailableContext();

    return currentTokens > contextWindow * threshold;
  }

  /**
   * Compress conversation history
   * @param {number} keepRecentCount - Number of recent messages to keep uncompressed
   * @param {Function} onProgress - Optional progress callback
   * @returns {Promise<void>}
   */
  async compressHistory(keepRecentCount = 5, onProgress = null) {
    if (this.history.full.length <= keepRecentCount) {
      // Not enough messages to compress
      return;
    }

    // Split into messages to compress and messages to keep
    const toCompress = this.history.full.slice(0, -keepRecentCount);
    const toKeep = this.history.full.slice(-keepRecentCount);

    if (toCompress.length === 0) {
      return;
    }

    // Format messages for compression
    const conversationText = this._formatMessagesForCompression(toCompress);

    // Compress using LLM
    const compressionPrompt = `Compress this conversation into concise technical bullet points. Preserve all important information including:
- Technical decisions made
- Code changes and file modifications
- Function/class implementations
- Bugs fixed and solutions
- Pending issues or tasks
- Key discussions and conclusions

Omit: greetings, unnecessary explanations, verbose discussions.

Format as bullet points, grouped by topic.`;

    try {
      const compressed = await this.lmstudioClient.compress(conversationText, compressionPrompt, onProgress);

      // Update history structure
      if (this.history.compressed) {
        // Append to existing compression
        this.history.compressed += '\n\n' + compressed;
      } else {
        this.history.compressed = compressed;
      }

      // Keep only recent messages in full history
      this.history.full = toKeep;

      console.log(`Compressed ${toCompress.length} messages into summary`);
    } catch (error) {
      console.error('Failed to compress history:', error.message);
      // Keep original messages if compression fails
    }
  }

  /**
   * Format messages for compression
   * @param {Array} messages - Messages to format
   * @returns {string} - Formatted text
   */
  _formatMessagesForCompression(messages) {
    return messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
  }

  /**
   * Build context window for LLM
   * @param {number} maxTokens - Maximum tokens allowed
   * @param {number} recentCount - Number of recent messages to include
   * @returns {Object} - Context window with messages and token info
   */
  buildContextWindow(maxTokens, recentCount = 5) {
    const recentMessages = this.getRecentMessages(recentCount);
    const compressed = this.getCompressedHistory();

    // Calculate token usage
    const recentTokens = this.tokenCounter.countMessagesTokens(recentMessages);
    const compressedTokens = this.tokenCounter.countTokens(compressed);
    const totalTokens = recentTokens + compressedTokens;

    return {
      recentMessages,
      compressedHistory: compressed,
      tokenCount: {
        recent: recentTokens,
        compressed: compressedTokens,
        total: totalTokens,
      },
      fitsInWindow: totalTokens <= maxTokens,
    };
  }

  /**
   * Get messages for prompt with token limit
   * @param {number} tokenBudget - Maximum tokens for history
   * @param {number} recentCount - Number of recent messages to prioritize
   * @returns {Object} - Messages and compressed history
   */
  getMessagesForPrompt(tokenBudget, recentCount = 5) {
    const recentMessages = this.getRecentMessages(recentCount);
    let compressed = this.getCompressedHistory();

    // Calculate current token usage
    const recentTokens = this.tokenCounter.countMessagesTokens(recentMessages);
    const compressedTokens = this.tokenCounter.countTokens(compressed);

    // If over budget, truncate compressed history
    if (recentTokens + compressedTokens > tokenBudget) {
      const availableForCompressed = tokenBudget - recentTokens;
      if (availableForCompressed > 0) {
        compressed = this.tokenCounter.truncateToTokenLimit(compressed, availableForCompressed);
      } else {
        compressed = '';
      }
    }

    return {
      recentMessages,
      compressedHistory: compressed,
    };
  }

  /**
   * Clear all history
   */
  clearHistory() {
    this.history = {
      full: [],
      compressed: '',
      activeWindow: [],
    };
  }

  /**
   * Get conversation statistics
   * @returns {Object} - Statistics about the conversation
   */
  getStats() {
    const fullTokens = this.tokenCounter.countMessagesTokens(this.history.full);
    const compressedTokens = this.tokenCounter.countTokens(this.history.compressed);

    return {
      messageCount: this.history.full.length,
      fullTokens,
      compressedTokens,
      hasCompression: this.history.compressed.length > 0,
      compressionRatio: compressedTokens > 0 ? fullTokens / compressedTokens : 0,
    };
  }

  /**
   * Get full conversation history as text
   * @returns {string} - Formatted conversation
   */
  getFullHistoryText() {
    let text = '';

    if (this.history.compressed) {
      text += '=== COMPRESSED HISTORY ===\n';
      text += this.history.compressed;
      text += '\n\n=== RECENT MESSAGES ===\n';
    }

    text += this.history.full
      .map((m, i) => `[${i + 1}] ${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    return text;
  }

  /**
   * Export conversation to JSON
   * @returns {string} - JSON string
   */
  exportHistory() {
    return JSON.stringify({
      exported: new Date().toISOString(),
      stats: this.getStats(),
      history: this.history,
    }, null, 2);
  }

  /**
   * Save history to file
   * @returns {Promise<void>}
   */
  async saveHistory() {
    try {
      await this.fileOps.writeJSON(this.historyPath, {
        history: this.history,
        lastSaved: new Date().toISOString(),
        stats: this.getStats(),
      });
    } catch (error) {
      throw new Error(`Failed to save history: ${error.message}`);
    }
  }

  /**
   * Load history from file
   * @returns {Promise<void>}
   */
  async loadHistory() {
    try {
      if (!this.fileOps.fileExists(this.historyPath)) {
        this.history = {
          full: [],
          compressed: '',
          activeWindow: [],
        };
        this.loaded = true;
        return;
      }

      const data = await this.fileOps.readJSON(this.historyPath);
      this.history = data.history || {
        full: [],
        compressed: '',
        activeWindow: [],
      };
      this.loaded = true;
    } catch (error) {
      console.warn(`Failed to load history, starting fresh: ${error.message}`);
      this.history = {
        full: [],
        compressed: '',
        activeWindow: [],
      };
      this.loaded = true;
    }
  }

  /**
   * Get message count
   * @returns {number} - Total message count
   */
  getMessageCount() {
    return this.history.full.length;
  }

  /**
   * Remove last message (for undo scenarios)
   * @returns {Object|null} - Removed message or null
   */
  removeLastMessage() {
    return this.history.full.pop() || null;
  }
}

export default ContextManager;
