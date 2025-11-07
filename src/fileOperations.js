import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

/**
 * FileOperations - Handles all file I/O operations
 * Provides safe file reading, writing, and editing with path validation
 */
class FileOperations {
  constructor(rootPath) {
    this.rootPath = path.resolve(rootPath);
  }

  /**
   * Resolve and validate a file path
   * @param {string} filePath - Relative or absolute path
   * @returns {string} - Absolute validated path
   */
  resolvePath(filePath) {
    // If absolute path, use it; otherwise resolve relative to rootPath
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(this.rootPath, filePath);

    // Validate that path is within rootPath (prevent directory traversal)
    if (!resolved.startsWith(this.rootPath)) {
      throw new Error(
        `Path ${filePath} is outside the project root. Access denied for security.`
      );
    }

    return resolved;
  }

  /**
   * Check if a file exists
   * @param {string} filePath - Path to check
   * @returns {boolean} - True if file exists
   */
  fileExists(filePath) {
    try {
      const resolved = this.resolvePath(filePath);
      return existsSync(resolved);
    } catch (error) {
      return false;
    }
  }

  /**
   * Read a file
   * @param {string} filePath - Path to file
   * @returns {Promise<string>} - File contents
   */
  async readFile(filePath) {
    try {
      const resolved = this.resolvePath(filePath);

      if (!existsSync(resolved)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = await fs.readFile(resolved, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Write content to a file
   * @param {string} filePath - Path to file
   * @param {string} content - Content to write
   * @returns {Promise<void>}
   */
  async writeFile(filePath, content) {
    try {
      const resolved = this.resolvePath(filePath);

      // Create directory if it doesn't exist
      const dir = path.dirname(resolved);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(resolved, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Edit a file by replacing old text with new text
   * @param {string} filePath - Path to file
   * @param {string} oldText - Text to find
   * @param {string} newText - Text to replace with
   * @returns {Promise<void>}
   */
  async editFile(filePath, oldText, newText) {
    try {
      const content = await this.readFile(filePath);

      if (!content.includes(oldText)) {
        // Debug: Show why the match failed
        const oldTextPreview = oldText.length > 200
          ? oldText.substring(0, 200) + '...[truncated]'
          : oldText;
        const oldTextLength = oldText.length;
        const fileLength = content.length;

        throw new Error(
          `Text to replace not found in ${filePath}.\n` +
          `  Old text length: ${oldTextLength} chars\n` +
          `  File length: ${fileLength} chars\n` +
          `  Old text preview: ${oldTextPreview}\n` +
          `  Make sure the old text exactly matches the file content (including whitespace).`
        );
      }

      const newContent = content.replace(oldText, newText);
      await this.writeFile(filePath, newContent);
    } catch (error) {
      throw new Error(`Failed to edit file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Create a new file (will overwrite if exists)
   * @param {string} filePath - Path to file
   * @param {string} content - Initial content
   * @returns {Promise<void>}
   */
  async createFile(filePath, content = '') {
    await this.writeFile(filePath, content);
  }

  /**
   * Delete a file
   * @param {string} filePath - Path to file
   * @returns {Promise<void>}
   */
  async deleteFile(filePath) {
    try {
      const resolved = this.resolvePath(filePath);

      if (!existsSync(resolved)) {
        throw new Error(`File not found: ${filePath}`);
      }

      await fs.unlink(resolved);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw new Error(`Failed to delete file ${filePath}: ${error.message}`);
    }
  }

  /**
   * List files in a directory
   * @param {string} directory - Directory path
   * @param {boolean} recursive - Whether to list recursively
   * @returns {Promise<Array<string>>} - List of file paths
   */
  async listFiles(directory, recursive = false) {
    try {
      const resolved = this.resolvePath(directory);

      if (!existsSync(resolved)) {
        throw new Error(`Directory not found: ${directory}`);
      }

      const stats = await fs.stat(resolved);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${directory}`);
      }

      if (recursive) {
        return await this._listFilesRecursive(resolved);
      } else {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        return entries
          .filter(entry => entry.isFile())
          .map(entry => path.join(directory, entry.name));
      }
    } catch (error) {
      throw new Error(`Failed to list files in ${directory}: ${error.message}`);
    }
  }

  /**
   * Recursively list all files in a directory
   * @param {string} directory - Directory path
   * @returns {Promise<Array<string>>} - List of file paths
   */
  async _listFilesRecursive(directory) {
    const results = [];
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await this._listFilesRecursive(fullPath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        // Return relative path from rootPath
        const relativePath = path.relative(this.rootPath, fullPath);
        results.push(relativePath);
      }
    }

    return results;
  }

  /**
   * Get file statistics
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} - File stats
   */
  async getFileStats(filePath) {
    try {
      const resolved = this.resolvePath(filePath);

      if (!existsSync(resolved)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const stats = await fs.stat(resolved);

      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch (error) {
      throw new Error(`Failed to get file stats for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Get relative path from root
   * @param {string} filePath - Absolute or relative path
   * @returns {string} - Relative path from root
   */
  getRelativePath(filePath) {
    const resolved = this.resolvePath(filePath);
    return path.relative(this.rootPath, resolved);
  }

  /**
   * Read JSON file
   * @param {string} filePath - Path to JSON file
   * @returns {Promise<Object>} - Parsed JSON object
   */
  async readJSON(filePath) {
    try {
      const content = await this.readFile(filePath);
      return JSON.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in file ${filePath}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Write JSON file
   * @param {string} filePath - Path to JSON file
   * @param {Object} data - Object to serialize
   * @param {boolean} pretty - Whether to format JSON
   * @returns {Promise<void>}
   */
  async writeJSON(filePath, data, pretty = true) {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await this.writeFile(filePath, content);
  }

  /**
   * Append content to a file
   * @param {string} filePath - Path to file
   * @param {string} content - Content to append
   * @returns {Promise<void>}
   */
  async appendFile(filePath, content) {
    try {
      const resolved = this.resolvePath(filePath);
      await fs.appendFile(resolved, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to append to file ${filePath}: ${error.message}`);
    }
  }
}

export default FileOperations;
