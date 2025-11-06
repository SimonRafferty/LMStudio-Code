/**
 * ResponseParser - Parses LLM responses and extracts structured actions
 * Extracts file operations, task updates, and questions from LLM responses
 */
class ResponseParser {
  constructor() {
    // Regex patterns for parsing
    this.patterns = {
      fileEdit: /<file_edit>\s*<path>(.*?)<\/path>\s*<operation>(.*?)<\/operation>\s*<old>([\s\S]*?)<\/old>\s*<new>([\s\S]*?)<\/new>\s*<\/file_edit>/gi,
      fileCreate: /<file_create>\s*<path>(.*?)<\/path>\s*<content>([\s\S]*?)<\/content>\s*<\/file_create>/gi,
      fileDelete: /<file_delete>\s*<path>(.*?)<\/path>\s*<\/file_delete>/gi,
      taskUpdate: /<task_update>([\s\S]*?)<\/task_update>/gi,
      question: /<question>([\s\S]*?)<\/question>/gi,
      search: /<search>([\s\S]*?)<\/search>/gi,
      readLines: /<read_lines>\s*<path>(.*?)<\/path>\s*<start>(.*?)<\/start>\s*<end>(.*?)<\/end>\s*<\/read_lines>/gi,
    };
  }

  /**
   * Parse LLM response and extract all structured information
   * @param {string} responseText - Raw LLM response
   * @returns {Object} - Parsed response with extracted actions
   */
  parseResponse(responseText) {
    return {
      originalText: responseText,
      fileEdits: this.extractFileEdits(responseText),
      fileCreates: this.extractFileCreates(responseText),
      fileDeletes: this.extractFileDeletes(responseText),
      taskUpdates: this.extractTaskUpdates(responseText),
      questions: this.extractQuestions(responseText),
      searches: this.extractSearches(responseText),
      readLines: this.extractReadLines(responseText),
      plainText: this._extractPlainText(responseText),
    };
  }

  /**
   * Clean a file path by removing markers and extra whitespace
   * @param {string} path - Path to clean
   * @returns {string} - Cleaned path
   */
  cleanPath(path) {
    return path
      .trim()
      .replace(/^---\s*/, '')  // Remove leading "---"
      .replace(/\s*---$/, '')  // Remove trailing "---"
      .replace(/^["']/, '')     // Remove leading quotes
      .replace(/["']$/, '')     // Remove trailing quotes
      .trim();
  }

  /**
   * Extract file edit operations
   * @param {string} responseText - Raw response text
   * @returns {Array<Object>} - Array of file edit operations
   */
  extractFileEdits(responseText) {
    const edits = [];
    const pattern = this.patterns.fileEdit;
    pattern.lastIndex = 0; // Reset regex

    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      edits.push({
        type: 'edit',
        path: this.cleanPath(match[1]),
        operation: match[2].trim(),
        oldText: match[3].trim(),
        newText: match[4].trim(),
      });
    }

    return edits;
  }

  /**
   * Extract file create operations
   * @param {string} responseText - Raw response text
   * @returns {Array<Object>} - Array of file create operations
   */
  extractFileCreates(responseText) {
    const creates = [];
    const pattern = this.patterns.fileCreate;
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      creates.push({
        type: 'create',
        path: this.cleanPath(match[1]),
        content: match[2].trim(),
      });
    }

    return creates;
  }

  /**
   * Extract file delete operations
   * @param {string} responseText - Raw response text
   * @returns {Array<Object>} - Array of file delete operations
   */
  extractFileDeletes(responseText) {
    const deletes = [];
    const pattern = this.patterns.fileDelete;
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      deletes.push({
        type: 'delete',
        path: this.cleanPath(match[1]),
      });
    }

    return deletes;
  }

  /**
   * Extract task updates
   * @param {string} responseText - Raw response text
   * @returns {Array<Object>} - Array of task updates
   */
  extractTaskUpdates(responseText) {
    const updates = [];
    const pattern = this.patterns.taskUpdate;
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      const content = match[1].trim();
      updates.push(...this._parseTaskUpdateContent(content));
    }

    return updates;
  }

  /**
   * Parse task update content
   * @param {string} content - Task update content
   * @returns {Array<Object>} - Parsed tasks
   */
  _parseTaskUpdateContent(content) {
    const tasks = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('- DONE:') || trimmed.startsWith('- ✓')) {
        tasks.push({
          status: 'completed',
          description: trimmed.replace(/^- (?:DONE:|✓)\s*/, ''),
        });
      } else if (trimmed.startsWith('- TODO:') || trimmed.startsWith('- [ ]')) {
        tasks.push({
          status: 'pending',
          description: trimmed.replace(/^- (?:TODO:|\[ \])\s*/, ''),
        });
      } else if (trimmed.startsWith('- IN_PROGRESS:') || trimmed.startsWith('- [~]')) {
        tasks.push({
          status: 'in-progress',
          description: trimmed.replace(/^- (?:IN_PROGRESS:|\[~\])\s*/, ''),
        });
      } else if (trimmed.startsWith('- ')) {
        // Default to pending
        tasks.push({
          status: 'pending',
          description: trimmed.replace(/^- /, ''),
        });
      }
    }

    return tasks;
  }

  /**
   * Extract questions from response
   * @param {string} responseText - Raw response text
   * @returns {Array<string>} - Array of questions
   */
  extractQuestions(responseText) {
    const questions = [];
    const pattern = this.patterns.question;
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      questions.push(match[1].trim());
    }

    return questions;
  }

  /**
   * Extract search requests from response
   * @param {string} responseText - Raw response text
   * @returns {Array<string>} - Array of search keywords
   */
  extractSearches(responseText) {
    const searches = [];
    const pattern = this.patterns.search;
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      const searchContent = match[1].trim();
      // Parse comma-separated or newline-separated keywords
      const keywords = searchContent
        .split(/[,\n]/)
        .map(k => k.trim())
        .filter(k => k.length > 0);
      searches.push(...keywords);
    }

    return searches;
  }

  /**
   * Extract read_lines requests from response
   * @param {string} responseText - Raw response text
   * @returns {Array<Object>} - Array of line range read requests
   */
  extractReadLines(responseText) {
    const readRequests = [];
    const pattern = this.patterns.readLines;
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      const startLine = parseInt(match[2].trim(), 10);
      const endLine = parseInt(match[3].trim(), 10);

      if (!isNaN(startLine) && !isNaN(endLine)) {
        readRequests.push({
          path: this.cleanPath(match[1]),
          startLine: startLine,
          endLine: endLine,
        });
      }
    }

    return readRequests;
  }

  /**
   * Extract plain text (remove all XML tags)
   * @param {string} responseText - Raw response text
   * @returns {string} - Plain text
   */
  _extractPlainText(responseText) {
    // Remove all XML-like tags
    let plainText = responseText;

    // Remove complete tag blocks
    plainText = plainText.replace(/<file_edit>[\s\S]*?<\/file_edit>/gi, '');
    plainText = plainText.replace(/<file_create>[\s\S]*?<\/file_create>/gi, '');
    plainText = plainText.replace(/<file_delete>[\s\S]*?<\/file_delete>/gi, '');
    plainText = plainText.replace(/<task_update>[\s\S]*?<\/task_update>/gi, '');
    plainText = plainText.replace(/<question>[\s\S]*?<\/question>/gi, '');
    plainText = plainText.replace(/<read_lines>[\s\S]*?<\/read_lines>/gi, '');

    // Remove any remaining tags
    plainText = plainText.replace(/<[^>]+>/g, '');

    return plainText.trim();
  }

  /**
   * Check if response contains any structured actions
   * @param {string} responseText - Raw response text
   * @returns {boolean} - True if actions found
   */
  hasActions(responseText) {
    const parsed = this.parseResponse(responseText);

    return (
      parsed.fileEdits.length > 0 ||
      parsed.fileCreates.length > 0 ||
      parsed.fileDeletes.length > 0 ||
      parsed.taskUpdates.length > 0
    );
  }

  /**
   * Get summary of actions in response
   * @param {string} responseText - Raw response text
   * @returns {string} - Summary text
   */
  getActionSummary(responseText) {
    const parsed = this.parseResponse(responseText);

    const parts = [];

    if (parsed.fileEdits.length > 0) {
      parts.push(`${parsed.fileEdits.length} file edit(s)`);
    }

    if (parsed.fileCreates.length > 0) {
      parts.push(`${parsed.fileCreates.length} file create(s)`);
    }

    if (parsed.fileDeletes.length > 0) {
      parts.push(`${parsed.fileDeletes.length} file delete(s)`);
    }

    if (parsed.taskUpdates.length > 0) {
      parts.push(`${parsed.taskUpdates.length} task update(s)`);
    }

    if (parsed.questions.length > 0) {
      parts.push(`${parsed.questions.length} question(s)`);
    }

    return parts.length > 0 ? parts.join(', ') : 'No actions';
  }

  /**
   * Validate file edit operation
   * @param {Object} edit - File edit object
   * @returns {Object} - Validation result
   */
  validateFileEdit(edit) {
    const errors = [];

    if (!edit.path) {
      errors.push('Missing file path');
    }

    if (!edit.operation) {
      errors.push('Missing operation type');
    }

    if (edit.operation === 'replace' && !edit.oldText) {
      errors.push('Replace operation requires oldText');
    }

    if (!edit.newText && edit.operation !== 'delete') {
      errors.push('Missing newText');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate file create operation
   * @param {Object} create - File create object
   * @returns {Object} - Validation result
   */
  validateFileCreate(create) {
    const errors = [];

    if (!create.path) {
      errors.push('Missing file path');
    }

    if (create.content === undefined) {
      errors.push('Missing content');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Convert parsed actions to executable operations
   * @param {Object} parsed - Parsed response
   * @returns {Array<Object>} - Executable operations
   */
  toExecutableOperations(parsed) {
    const operations = [];

    // File edits
    for (const edit of parsed.fileEdits) {
      operations.push({
        type: 'file_edit',
        data: edit,
      });
    }

    // File creates
    for (const create of parsed.fileCreates) {
      operations.push({
        type: 'file_create',
        data: create,
      });
    }

    // File deletes
    for (const del of parsed.fileDeletes) {
      operations.push({
        type: 'file_delete',
        data: del,
      });
    }

    // Task updates
    for (const task of parsed.taskUpdates) {
      operations.push({
        type: 'task_update',
        data: task,
      });
    }

    return operations;
  }

  /**
   * Format parsed response for display
   * @param {Object} parsed - Parsed response
   * @returns {string} - Formatted output
   */
  formatForDisplay(parsed) {
    let output = '';

    if (parsed.plainText) {
      output += parsed.plainText + '\n\n';
    }

    if (parsed.fileEdits.length > 0) {
      output += '📝 File Edits:\n';
      for (const edit of parsed.fileEdits) {
        output += `  - ${edit.path} (${edit.operation})\n`;
      }
      output += '\n';
    }

    if (parsed.fileCreates.length > 0) {
      output += '📄 File Creates:\n';
      for (const create of parsed.fileCreates) {
        output += `  - ${create.path}\n`;
      }
      output += '\n';
    }

    if (parsed.fileDeletes.length > 0) {
      output += '🗑️  File Deletes:\n';
      for (const del of parsed.fileDeletes) {
        output += `  - ${del.path}\n`;
      }
      output += '\n';
    }

    if (parsed.taskUpdates.length > 0) {
      output += '✅ Task Updates:\n';
      for (const task of parsed.taskUpdates) {
        const icon = task.status === 'completed' ? '✓' : task.status === 'in-progress' ? '~' : ' ';
        output += `  [${icon}] ${task.description}\n`;
      }
      output += '\n';
    }

    if (parsed.questions.length > 0) {
      output += '❓ Questions:\n';
      for (const question of parsed.questions) {
        output += `  - ${question}\n`;
      }
      output += '\n';
    }

    return output.trim();
  }
}

export default ResponseParser;
