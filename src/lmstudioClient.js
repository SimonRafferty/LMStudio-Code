import axios from 'axios';

/**
 * LMStudioClient - OpenAI-compatible API client for LMStudio
 * Handles communication with local LMStudio server
 */
class LMStudioClient {
  constructor(config) {
    this.baseURL = config.baseURL || 'http://localhost:1234/v1';
    this.model = config.model || 'local-model';
    this.temperature = config.temperature || 0.7;
    this.maxTokens = config.maxTokens || 4096;

    // Dynamic context window info (fetched from API)
    this.contextWindow = null; // Will be fetched from model info
    this.lastUsage = null; // Last API call usage stats

    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 0, // No timeout - allow unlimited time for local LLM processing
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor for logging (optional)
    this.client.interceptors.request.use(
      (config) => {
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.code === 'ECONNREFUSED') {
          throw new Error(
            'Cannot connect to LMStudio. Make sure LMStudio is running and the server is started.'
          );
        }
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
          throw new Error('Connection to LMStudio was interrupted. Check if the server is still running.');
        }
        throw error;
      }
    );
  }

  /**
   * Complete a chat interaction
   * @param {Array} messages - Array of message objects {role, content}
   * @param {Object} options - Override options
   * @returns {Promise<string>} - LLM response text
   */
  async complete(messages, options = {}) {
    // Calculate max_tokens dynamically to prevent truncation
    // If options.maxTokens is provided, use it; otherwise calculate based on context
    let maxCompletionTokens = options.maxTokens;

    if (!maxCompletionTokens && options.promptTokens && this.maxTokens) {
      // Reserve space: contextWindow - promptTokens - safety margin
      maxCompletionTokens = Math.max(512, this.maxTokens - options.promptTokens - 100);
    } else if (!maxCompletionTokens) {
      // Fallback: use half the context window for completion
      maxCompletionTokens = Math.floor(this.maxTokens / 2);
    }

    const requestBody = {
      model: options.model || this.model,
      messages: messages,
      temperature: options.temperature ?? this.temperature,
      max_tokens: maxCompletionTokens,
      stream: false, // Non-streaming for simplicity
    };

    try {
      const response = await this.retryRequest(
        () => this.client.post('/chat/completions', requestBody),
        options.retries || 3
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('Invalid response from LMStudio: no choices returned');
      }

      // Extract and store usage statistics if available
      if (response.data.usage) {
        this.lastUsage = {
          promptTokens: response.data.usage.prompt_tokens || 0,
          completionTokens: response.data.usage.completion_tokens || 0,
          totalTokens: response.data.usage.total_tokens || 0,
          timestamp: new Date().toISOString(),
        };
      }

      const completion = response.data.choices[0].message.content;
      return completion;
    } catch (error) {
      if (error.response) {
        // Server responded with error status
        throw new Error(
          `LMStudio API error (${error.response.status}): ${
            error.response.data?.error?.message || error.message
          }`
        );
      }
      throw error;
    }
  }

  /**
   * Test connection to LMStudio server
   * @returns {Promise<boolean>} - True if connection successful
   */
  async testConnection() {
    try {
      const response = await this.client.get('/models', { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(
          'Cannot connect to LMStudio at ' + this.baseURL +
          '. Make sure LMStudio is running and the server is started on this port.'
        );
      }
      throw new Error('Connection test failed: ' + error.message);
    }
  }

  /**
   * Get available models from LMStudio
   * @returns {Promise<Array>} - List of available models
   */
  async getModels() {
    try {
      const response = await this.client.get('/models');
      return response.data.data || [];
    } catch (error) {
      throw new Error('Failed to fetch models: ' + error.message);
    }
  }

  /**
   * Fetch and cache model capabilities including context window
   * @returns {Promise<void>}
   */
  async fetchModelCapabilities() {
    try {
      const models = await this.getModels();

      if (models.length === 0) {
        throw new Error('No models loaded in LMStudio. Please load a model and start the server.');
      }

      // Use the first available model (whatever is actually loaded)
      const modelInfo = models[0];

      // Update our model ID to match what's actually loaded
      this.model = modelInfo.id;

      // Extract context window size from various possible fields
      // Different implementations may use different field names
      this.contextWindow =
        modelInfo?.context_length ||
        modelInfo?.max_tokens ||
        modelInfo?.context_window ||
        modelInfo?.max_position_embeddings ||
        modelInfo?.n_ctx ||
        this.maxTokens; // Fallback to config

    } catch (error) {
      throw new Error(`Failed to fetch model info: ${error.message}`);
    }
  }

  /**
   * Get the context window size
   * @returns {number} - Context window size in tokens
   */
  getContextWindow() {
    return this.contextWindow || this.maxTokens;
  }

  /**
   * Get last usage statistics
   * @returns {Object|null} - Usage stats from last API call
   */
  getLastUsage() {
    return this.lastUsage;
  }

  /**
   * Get current model info including dynamic capabilities
   * @returns {Object} - Model configuration and capabilities
   */
  getModelInfo() {
    return {
      baseURL: this.baseURL,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      contextWindow: this.contextWindow,
      lastUsage: this.lastUsage,
    };
  }

  /**
   * Update client configuration
   * @param {Object} config - New configuration
   */
  updateConfig(config) {
    if (config.baseURL) this.baseURL = config.baseURL;
    if (config.model) this.model = config.model;
    if (config.temperature !== undefined) this.temperature = config.temperature;
    if (config.maxTokens) this.maxTokens = config.maxTokens;
  }

  /**
   * Retry a request with exponential backoff
   * @param {Function} requestFn - Function that returns a promise
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Promise} - Result of the request
   */
  async retryRequest(requestFn, maxRetries = 3) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        // Don't retry on certain errors
        if (
          error.code === 'ECONNREFUSED' ||
          (error.response && error.response.status === 400)
        ) {
          throw error;
        }

        if (attempt < maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt) * 1000;
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Sleep helper for retry logic
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a simple completion (non-chat format)
   * @param {string} prompt - Text prompt
   * @param {Object} options - Options
   * @returns {Promise<string>} - Completion text
   */
  async completeSimple(prompt, options = {}) {
    const messages = [{ role: 'user', content: prompt }];
    return this.complete(messages, options);
  }

  /**
   * Generate a summary/compression of text
   * @param {string} text - Text to compress
   * @param {string} instructions - Compression instructions
   * @returns {Promise<string>} - Compressed text
   */
  async compress(text, instructions) {
    const messages = [
      {
        role: 'system',
        content: instructions,
      },
      {
        role: 'user',
        content: text,
      },
    ];

    return this.complete(messages, {
      temperature: 0.3, // Lower temperature for more focused compression
      maxTokens: 1000,
    });
  }
}

export default LMStudioClient;
