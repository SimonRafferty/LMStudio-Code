import axios from 'axios';
import { getToolDefinitions } from './tools.js';

/**
 * LMStudioClient - OpenAI-compatible API client for LMStudio
 * Handles communication with local LMStudio server
 */
class LMStudioClient {
  constructor(config) {
    this.baseURL = config.baseURL || 'http://localhost:1234/v1';
    this.model = config.model || 'local-model';
    this.temperature = config.temperature || 0.7;

    // Dynamic context window info (fetched from API or set by user for current session)
    this.contextWindow = null; // Will be fetched from model info or set by user
    this.lastUsage = null; // Last API call usage stats

    // Tool/function calling support
    // Default to false (XML mode) - will only enable if detection test passes
    this.supportsTools = false;
    this.toolDefinitions = getToolDefinitions(); // Available tools for the LLM

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
    if (!this.contextWindow) {
      throw new Error('Context window not set. Please set context length using /context command.');
    }

    // Calculate max_tokens dynamically to prevent truncation
    // If options.maxTokens is provided, use it; otherwise calculate based on context
    let maxCompletionTokens = options.maxTokens;

    if (!maxCompletionTokens && options.promptTokens && this.contextWindow) {
      // Reserve space: contextWindow - promptTokens - safety margin
      const availableTokens = this.contextWindow - options.promptTokens - 100;
      // Use available tokens, but ensure minimum of 512 for reasonable responses
      maxCompletionTokens = Math.max(512, availableTokens);
    } else if (!maxCompletionTokens) {
      // Fallback: use half the context window for completion
      maxCompletionTokens = Math.floor(this.contextWindow / 2);
    }

    // IMPORTANT: Streaming doesn't support tool calls properly - tool_calls come all at once, not in deltas
    // So we disable streaming when tools are enabled
    const useStreaming = options.onProgress && (options.disableTools || !this.supportsTools);

    const requestBody = {
      model: options.model || this.model,
      messages: messages,
      temperature: options.temperature ?? this.temperature,
      max_tokens: maxCompletionTokens,
      stream: useStreaming,
    };

    // Add tools if model supports them and not explicitly disabled
    if (this.supportsTools && !options.disableTools) {
      requestBody.tools = this.toolDefinitions;

      // Use "required" for initial queries to force tool use (Qwen3 models often ignore "auto")
      // Use "auto" for follow-ups when tools are disabled
      requestBody.tool_choice = options.forceTools ? "required" : "auto";
    }

    try {
      // Use streaming if progress callback is provided AND tools are disabled
      if (useStreaming) {
        return await this.completeWithStreaming(
          requestBody,
          options.onProgress,
          options.retries || 3,
          options.signal
        );
      }

      // Non-streaming mode
      const response = await this.retryRequest(
        () => this.client.post('/chat/completions', requestBody, { signal: options.signal }),
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

      const message = response.data.choices[0].message;

      // Check if response contains tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        return {
          type: 'tool_calls',
          tool_calls: message.tool_calls,
          message: message
        };
      }

      // Regular text response
      const completion = message.content || '';
      return {
        type: 'content',
        content: completion,
        message: message
      };
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
   * Complete with streaming support and progress updates
   * @param {Object} requestBody - Request payload
   * @param {Function} onProgress - Progress callback (tokens, text)
   * @param {number} maxRetries - Maximum retry attempts
   * @param {AbortSignal} signal - Optional abort signal for cancellation
   * @returns {Promise<Object>} - Complete response (structured format)
   */
  async completeWithStreaming(requestBody, onProgress, maxRetries = 3, signal = null) {
    let completionText = '';
    let tokenCount = 0;

    // Note: Streaming with tool calls is not typical - tools are usually returned complete
    // If tools are in the request, we'll still stream content but won't get tool_calls in chunks

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', requestBody, {
          responseType: 'stream',
          signal: signal,
        });

        return await new Promise((resolve, reject) => {
          let buffer = '';

          response.data.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
              if (!line.trim() || line.trim() === 'data: [DONE]') continue;

              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));

                  if (data.choices && data.choices[0]?.delta?.content) {
                    const content = data.choices[0].delta.content;
                    completionText += content;
                    tokenCount++;

                    // Call progress callback every 10 tokens or so
                    if (tokenCount % 10 === 0) {
                      onProgress(tokenCount, completionText);
                    }
                  }

                  // Store usage stats if available
                  if (data.usage) {
                    this.lastUsage = {
                      promptTokens: data.usage.prompt_tokens || 0,
                      completionTokens: data.usage.completion_tokens || 0,
                      totalTokens: data.usage.total_tokens || 0,
                      timestamp: new Date().toISOString(),
                    };
                  }
                } catch (parseError) {
                  // Ignore parse errors for individual chunks
                }
              }
            }
          });

          response.data.on('end', () => {
            // Final progress update
            onProgress(tokenCount, completionText);
            // Return structured format matching non-streaming mode
            resolve({
              type: 'content',
              content: completionText,
              message: { role: 'assistant', content: completionText }
            });
          });

          response.data.on('error', (error) => {
            reject(error);
          });
        });

      } catch (error) {
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
        } else {
          throw error;
        }
      }
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
   * Get available models from LMStudio native API (with full model info)
   * @returns {Promise<Array>} - List of available models with context length
   */
  async getModelsNative() {
    try {
      // Use LM Studio's native API which includes max_context_length
      const response = await this.client.get('/api/v0/models');
      return response.data.data || [];
    } catch (error) {
      console.warn('Failed to fetch from /api/v0/models:', error.message);
      return null;
    }
  }

  /**
   * Get available models from LMStudio (OpenAI-compatible endpoint)
   * @returns {Promise<Array>} - List of available models (minimal info)
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
      // If user has manually set context window, use that and skip API detection
      if (this.contextWindow) {
        // Still fetch model info to get the model name, but don't override context
        try {
          let models = await this.getModelsNative();
          if (!models || models.length === 0) {
            models = await this.getModels();
          }
          if (models && models.length > 0) {
            const loadedModels = models.filter(m => !m.state || m.state === 'loaded');
            const modelInfo = loadedModels.length > 0 ? loadedModels[0] : models[0];
            this.model = modelInfo.id;
          }
        } catch (error) {
          // Silently continue if we can't fetch model info
        }
        return; // Skip context detection
      }

      // Try LM Studio's native API first (has context length info)
      let models = await this.getModelsNative();
      let usingNativeAPI = false;

      if (models && models.length > 0) {
        usingNativeAPI = true;
      } else {
        // Fall back to OpenAI-compatible endpoint
        models = await this.getModels();
      }

      if (!models || models.length === 0) {
        throw new Error('No models loaded in LMStudio. Please load a model and start the server.');
      }

      // Filter to only loaded models if state field is available
      const loadedModels = models.filter(m => !m.state || m.state === 'loaded');
      const modelInfo = loadedModels.length > 0 ? loadedModels[0] : models[0];

      // Update our model ID to match what's actually loaded
      this.model = modelInfo.id;

      // Tool support defaults to OFF (XML mode)
      // User can manually enable with /tools on if desired
      this.supportsTools = false;

      // Extract context window size from various possible fields
      // LM Studio native API uses max_context_length and loaded_context_length
      if (usingNativeAPI) {
        // Prefer loaded_context_length (what's actually configured)
        // Fall back to max_context_length (maximum the model supports)
        this.contextWindow =
          modelInfo?.loaded_context_length ||
          modelInfo?.max_context_length ||
          null;
      } else {
        // OpenAI-compatible endpoint - try various field names
        this.contextWindow =
          modelInfo?.context_length ||
          modelInfo?.max_tokens ||
          modelInfo?.context_window ||
          modelInfo?.max_position_embeddings ||
          modelInfo?.n_ctx ||
          null;
      }

    } catch (error) {
      throw new Error(`Failed to fetch model info: ${error.message}`);
    }
  }

  /**
   * Test if tool calling actually works with this model
   * @returns {Promise<boolean>} - True if tool calls work properly
   */
  async testToolCalling() {
    try {
      // Define a simple test tool
      const testTool = [{
        type: "function",
        function: {
          name: "get_test_value",
          description: "Get a test value. Always use this function when asked for a test.",
          parameters: {
            type: "object",
            properties: {
              value: {
                type: "string",
                description: "The test value to return"
              }
            },
            required: ["value"]
          }
        }
      }];

      // Simple prompt that should trigger the tool
      const testMessages = [
        {
          role: "system",
          content: "You are a test assistant. When asked to perform a test, use the available tool."
        },
        {
          role: "user",
          content: "Please use the get_test_value function with value 'test123'"
        }
      ];

      // Make the test API call
      const response = await this.client.post('/chat/completions', {
        model: this.model,
        messages: testMessages,
        tools: testTool,
        tool_choice: "auto",
        max_tokens: 200,
        temperature: 0.1,
        stream: false
      }, {
        timeout: 10000 // 10 second timeout for test
      });

      // Check if we got proper tool calls
      const message = response.data?.choices?.[0]?.message;
      const hasToolCalls = !!(message?.tool_calls && message.tool_calls.length > 0);
      const finishReason = response.data?.choices?.[0]?.finish_reason;

      // Tool calling works if we got tool_calls and finish_reason is tool_calls
      return hasToolCalls && finishReason === 'tool_calls';

    } catch (error) {
      // Tool test failed - will use XML mode
      return false;
    }
  }

  /**
   * Detect if the model supports tool/function calling
   * @param {Object} modelInfo - Model information from API
   * @returns {boolean} - True if model supports tools
   */
  detectToolSupport(modelInfo) {
    // Check various indicators that a model supports tools:
    // 1. Explicit capabilities field
    if (modelInfo.capabilities?.tools || modelInfo.capabilities?.function_calling) {
      console.log(`Model ${modelInfo.id} supports tools (from capabilities field)`);
      return true;
    }

    // 2. Model metadata or tags indicating tool support
    if (modelInfo.tags?.includes('tools') || modelInfo.tags?.includes('function-calling')) {
      console.log(`Model ${modelInfo.id} supports tools (from tags)`);
      return true;
    }

    // 3. Check model ID for known tool-capable model families
    const toolCapablePatterns = [
      /qwen.*coder/i,        // Qwen Coder models
      /function/i,           // Models with "function" in name
      /tool/i,              // Models with "tool" in name
      /command.*r/i,         // Cohere Command R models
      /gpt-4/i,             // GPT-4 models
      /gpt-3\.5-turbo/i,    // GPT-3.5 Turbo
    ];

    for (const pattern of toolCapablePatterns) {
      if (pattern.test(modelInfo.id)) {
        console.log(`Model ${modelInfo.id} likely supports tools (from model name pattern)`);
        return true;
      }
    }

    // Default: assume no tool support (will fall back to XML)
    console.log(`Model ${modelInfo.id} does not appear to support tools - will use XML format`);
    return false;
  }

  /**
   * Get the context window size
   * @returns {number|null} - Context window size in tokens, or null if not set
   */
  getContextWindow() {
    return this.contextWindow;
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
   * @returns {Promise<Object|string>} - Completion response (structured if tools, string if legacy)
   */
  async completeSimple(prompt, options = {}) {
    const messages = [{ role: 'user', content: prompt }];
    return this.complete(messages, options);
  }

  /**
   * Generate a summary/compression of text
   * @param {string} text - Text to compress
   * @param {string} instructions - Compression instructions
   * @param {Function} onProgress - Optional progress callback
   * @returns {Promise<string>} - Compressed text
   */
  async compress(text, instructions, onProgress = null) {
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

    const options = {
      temperature: 0.3, // Lower temperature for more focused compression
      maxTokens: 1000,
      disableTools: true, // Compression should always return text, not tool calls
    };

    if (onProgress) {
      options.onProgress = onProgress;
    }

    const response = await this.complete(messages, options);

    // Extract text content from structured response
    if (typeof response === 'object' && response.type === 'content') {
      return response.content;
    }

    // Legacy format (shouldn't happen with disableTools, but handle anyway)
    return response;
  }
}

export default LMStudioClient;
