import { encoding_for_model } from 'tiktoken';

/**
 * TokenCounter - Counts tokens for context management
 * Uses tiktoken for accurate counting with cl100k_base encoding
 */
class TokenCounter {
  constructor() {
    try {
      // Use cl100k_base encoding (used by GPT-3.5/GPT-4)
      this.encoding = encoding_for_model('gpt-3.5-turbo');
    } catch (error) {
      console.warn('Failed to load tiktoken encoder, falling back to estimation:', error.message);
      this.encoding = null;
    }
  }

  /**
   * Count tokens in a text string
   * @param {string} text - Text to count tokens for
   * @returns {number} Token count
   */
  countTokens(text) {
    if (!text) return 0;

    if (this.encoding) {
      try {
        const tokens = this.encoding.encode(text);
        return tokens.length;
      } catch (error) {
        console.warn('Token counting error, using estimation:', error.message);
        return this.estimateTokens(text);
      }
    }

    return this.estimateTokens(text);
  }

  /**
   * Count tokens in an array of messages
   * @param {Array} messages - Array of message objects with role and content
   * @returns {number} Total token count
   */
  countMessagesTokens(messages) {
    if (!messages || messages.length === 0) return 0;

    let totalTokens = 0;

    for (const message of messages) {
      // Each message has overhead: role tokens + message separators
      totalTokens += 4; // <|start|>role<|message|>content<|end|>
      totalTokens += this.countTokens(message.role || '');
      totalTokens += this.countTokens(message.content || '');
    }

    totalTokens += 2; // Additional tokens for message formatting

    return totalTokens;
  }

  /**
   * Fast token estimation (approximate)
   * Rule of thumb: ~4 characters per token for English text
   * @param {string} text - Text to estimate tokens for
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text) return 0;

    // More refined estimation:
    // - Average English text: ~4 chars/token
    // - Code tends to be closer to 3 chars/token (more symbols)
    // - Use 3.5 as a middle ground
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Calculate available tokens for content
   * @param {number} maxTokens - Maximum context window size
   * @param {number} reservedForResponse - Tokens to reserve for LLM response
   * @returns {number} Available tokens
   */
  calculateAvailableTokens(maxTokens, reservedForResponse = 800) {
    return Math.max(0, maxTokens - reservedForResponse);
  }

  /**
   * Calculate token budget for different prompt components
   * @param {number} availableTokens - Total available tokens
   * @returns {Object} Token allocation for each component
   */
  allocateTokenBudget(availableTokens) {
    return {
      systemPrompt: Math.floor(availableTokens * 0.05), // 5% - ~200 tokens
      taskList: Math.floor(availableTokens * 0.05),      // 5% - ~200 tokens
      compressedHistory: Math.floor(availableTokens * 0.20), // 20%
      recentHistory: Math.floor(availableTokens * 0.30),     // 30%
      fileContents: Math.floor(availableTokens * 0.35),      // 35%
      userQuery: Math.floor(availableTokens * 0.05)          // 5%
    };
  }

  /**
   * Truncate text to fit within token limit
   * @param {string} text - Text to truncate
   * @param {number} maxTokens - Maximum tokens allowed
   * @returns {string} Truncated text
   */
  truncateToTokenLimit(text, maxTokens) {
    if (!text) return '';

    const currentTokens = this.countTokens(text);

    if (currentTokens <= maxTokens) {
      return text;
    }

    // Estimate character position to truncate at
    const ratio = maxTokens / currentTokens;
    const estimatedChars = Math.floor(text.length * ratio * 0.95); // 95% safety margin

    let truncated = text.substring(0, estimatedChars);

    // Verify and adjust if needed
    while (this.countTokens(truncated) > maxTokens && truncated.length > 0) {
      truncated = truncated.substring(0, truncated.length - 100);
    }

    return truncated + '\n... [truncated]';
  }

  /**
   * Get token statistics for debugging
   * @param {Object} content - Object with different content types
   * @returns {Object} Token statistics
   */
  getTokenStats(content) {
    const stats = {};

    for (const [key, value] of Object.entries(content)) {
      if (typeof value === 'string') {
        stats[key] = this.countTokens(value);
      } else if (Array.isArray(value)) {
        stats[key] = this.countMessagesTokens(value);
      }
    }

    stats.total = Object.values(stats).reduce((sum, val) => sum + val, 0);

    return stats;
  }

  /**
   * Cleanup encoder resources
   */
  cleanup() {
    if (this.encoding) {
      try {
        this.encoding.free();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
}

export default TokenCounter;
