import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

/**
 * CodebaseIndexer - Indexes and searches the codebase
 * Extracts file structure, functions, classes, and provides search capabilities
 */
class CodebaseIndexer {
  constructor(rootPath, config, fileOps) {
    this.rootPath = rootPath;
    this.config = config;
    this.fileOps = fileOps;

    this.index = {
      projectRoot: rootPath,
      lastIndexed: null,
      files: [],
    };

    this.loaded = false;
  }

  /**
   * Initialize and load existing index
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.loadIndex();
  }

  /**
   * Build index of the entire codebase
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<void>}
   */
  async buildIndex(progressCallback = null) {
    console.log('Building codebase index...');
    console.log(`Scanning from: ${this.rootPath}`);
    console.log(`Exclude extensions: ${this.config.excludeExtensions?.join(', ') || 'none'}`);
    console.log(`Exclude patterns: ${this.config.excludePatterns?.join(', ') || 'none'}`);

    const files = await this._findAllFiles(this.rootPath);
    console.log(`Found ${files.length} files to index`);

    this.index.files = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (progressCallback) {
        progressCallback(i + 1, files.length, file);
      }

      try {
        const fileInfo = await this.parseFile(file);
        this.index.files.push(fileInfo);
      } catch (error) {
        console.warn(`Failed to index ${file}: ${error.message}`);
      }
    }

    this.index.lastIndexed = new Date().toISOString();
    console.log(`Indexed ${this.index.files.length} files`);
  }

  /**
   * Find all files in the project
   * @param {string} directory - Root directory
   * @returns {Promise<Array<string>>} - List of file paths
   */
  async _findAllFiles(directory) {
    const results = [];

    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        const relativePath = path.relative(this.rootPath, fullPath);

        // Check exclusions
        if (this._shouldExclude(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          try {
            const subFiles = await this._findAllFiles(fullPath);
            results.push(...subFiles);
          } catch (error) {
            console.warn(`Skipping directory ${relativePath}: ${error.message}`);
          }
        } else if (entry.isFile()) {
          // Check file extension
          if (this._shouldInclude(entry.name)) {
            results.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${directory}: ${error.message}`);
    }

    return results;
  }

  /**
   * Check if path should be excluded
   * @param {string} relativePath - Relative path from root
   * @returns {boolean} - True if should be excluded
   */
  _shouldExclude(relativePath) {
    const excludePatterns = this.config.excludePatterns || [];

    for (const pattern of excludePatterns) {
      if (relativePath.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if file should be included based on extension
   * @param {string} filename - File name
   * @returns {boolean} - True if should be included
   */
  _shouldInclude(filename) {
    const excludeExtensions = this.config.excludeExtensions || [];

    // Include all files by default unless they're in the blacklist
    const ext = path.extname(filename).toLowerCase();
    return !excludeExtensions.includes(ext);
  }

  /**
   * Parse a single file and extract information
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} - File information
   */
  async parseFile(filePath) {
    const stats = await fs.stat(filePath);
    const relativePath = path.relative(this.rootPath, filePath);
    const extension = path.extname(filePath);

    const fileInfo = {
      path: filePath,
      relativePath,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      extension,
      functions: [],
      classes: [],
      imports: [],
      exports: [],
    };

    // Only parse code files (skip large files)
    if (stats.size > 500000) { // Skip files > 500KB
      fileInfo.skipped = true;
      fileInfo.reason = 'File too large';
      return fileInfo;
    }

    try {
      const content = await this.fileOps.readFile(filePath);

      // Parse based on file type
      if (['.js', '.jsx', '.mjs'].includes(extension)) {
        await this._parseJavaScript(content, fileInfo);
      } else if (['.ts', '.tsx'].includes(extension)) {
        // TypeScript parsing (basic - treat as JS for now)
        await this._parseJavaScript(content, fileInfo);
      } else if (extension === '.py') {
        this._parsePython(content, fileInfo);
      } else {
        // Generic parsing for other file types
        this._parseGeneric(content, fileInfo);
      }
    } catch (error) {
      fileInfo.parseError = error.message;
    }

    return fileInfo;
  }

  /**
   * Parse JavaScript/TypeScript file using acorn
   * @param {string} content - File content
   * @param {Object} fileInfo - File info object to populate
   */
  async _parseJavaScript(content, fileInfo) {
    try {
      const ast = acorn.parse(content, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: false,
      });

      walk.simple(ast, {
        FunctionDeclaration(node) {
          fileInfo.functions.push(node.id?.name || 'anonymous');
        },
        FunctionExpression(node) {
          if (node.id) {
            fileInfo.functions.push(node.id.name);
          }
        },
        ArrowFunctionExpression(node) {
          // Arrow functions assigned to variables will be caught by VariableDeclarator
        },
        VariableDeclarator(node) {
          if (
            node.init &&
            (node.init.type === 'ArrowFunctionExpression' ||
             node.init.type === 'FunctionExpression')
          ) {
            if (node.id.type === 'Identifier') {
              fileInfo.functions.push(node.id.name);
            }
          }
        },
        ClassDeclaration(node) {
          fileInfo.classes.push(node.id?.name || 'anonymous');
        },
        ImportDeclaration(node) {
          fileInfo.imports.push(node.source.value);
        },
        ExportNamedDeclaration(node) {
          if (node.declaration) {
            if (node.declaration.type === 'FunctionDeclaration') {
              fileInfo.exports.push(node.declaration.id?.name || 'anonymous');
            } else if (node.declaration.type === 'ClassDeclaration') {
              fileInfo.exports.push(node.declaration.id?.name || 'anonymous');
            }
          }
        },
        ExportDefaultDeclaration(node) {
          fileInfo.exports.push('default');
        },
      });
    } catch (error) {
      // If parsing fails, fall back to regex
      this._parseGeneric(content, fileInfo);
    }
  }

  /**
   * Parse Python file using regex
   * @param {string} content - File content
   * @param {Object} fileInfo - File info object to populate
   */
  _parsePython(content, fileInfo) {
    // Extract function definitions
    const functionRegex = /^def\s+(\w+)\s*\(/gm;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      fileInfo.functions.push(match[1]);
    }

    // Extract class definitions
    const classRegex = /^class\s+(\w+)/gm;
    while ((match = classRegex.exec(content)) !== null) {
      fileInfo.classes.push(match[1]);
    }

    // Extract imports
    const importRegex = /^(?:from\s+(\S+)\s+)?import\s+(.+)/gm;
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) {
        fileInfo.imports.push(match[1]);
      }
    }
  }

  /**
   * Generic parsing for unknown file types (regex-based)
   * @param {string} content - File content
   * @param {Object} fileInfo - File info object to populate
   */
  _parseGeneric(content, fileInfo) {
    // Try to extract function-like patterns
    const functionPatterns = [
      /function\s+(\w+)/g,
      /const\s+(\w+)\s*=\s*\(/g,
      /let\s+(\w+)\s*=\s*\(/g,
      /var\s+(\w+)\s*=\s*\(/g,
    ];

    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (!fileInfo.functions.includes(match[1])) {
          fileInfo.functions.push(match[1]);
        }
      }
    }

    // Try to extract class patterns
    const classPattern = /class\s+(\w+)/g;
    let match;
    while ((match = classPattern.exec(content)) !== null) {
      if (!fileInfo.classes.includes(match[1])) {
        fileInfo.classes.push(match[1]);
      }
    }
  }

  /**
   * Search files by keyword
   * @param {string} query - Search query
   * @param {number} maxResults - Maximum results to return
   * @returns {Array<Object>} - Matching files with scores
   */
  searchFiles(query, maxResults = 5) {
    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const file of this.index.files) {
      let score = 0;

      // Check file name
      if (file.relativePath.toLowerCase().includes(lowerQuery)) {
        score += 10;
      }

      // Check functions
      for (const func of file.functions) {
        if (func.toLowerCase().includes(lowerQuery)) {
          score += 5;
        }
      }

      // Check classes
      for (const cls of file.classes) {
        if (cls.toLowerCase().includes(lowerQuery)) {
          score += 5;
        }
      }

      // Check imports
      for (const imp of file.imports) {
        if (imp.toLowerCase().includes(lowerQuery)) {
          score += 2;
        }
      }

      if (score > 0) {
        results.push({ file, score });
      }
    }

    // Sort by score and return top results
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, maxResults).map(r => r.file);

    // Fallback: If no keyword matches found
    if (topResults.length === 0 && this.index.files.length > 0) {
      // For small projects, include all files
      if (this.index.files.length <= maxResults) {
        console.log(`No keyword matches found, including all ${this.index.files.length} indexed file(s)`);
        return this.index.files;
      }

      // For larger projects, return most recently modified files as fallback
      console.log(`No keyword matches found, including ${maxResults} most recently modified file(s)`);
      const sortedByDate = [...this.index.files].sort((a, b) => {
        return new Date(b.modified) - new Date(a.modified);
      });
      return sortedByDate.slice(0, maxResults);
    }

    return topResults;
  }

  /**
   * Extract function/block context around a line
   * @param {Array<string>} lines - File lines
   * @param {number} lineNum - Target line number (0-indexed)
   * @param {number} maxLines - Maximum lines to extract
   * @returns {Object} - Start line, end line, and content
   */
  extractFunctionContext(lines, lineNum, maxLines = 50) {
    let startLine = lineNum;
    let endLine = lineNum;
    let braceCount = 0;
    let foundStart = false;

    // Look backwards for function/block start
    for (let i = lineNum; i >= Math.max(0, lineNum - maxLines); i--) {
      const line = lines[i];

      // Count braces to find matching block
      for (let j = line.length - 1; j >= 0; j--) {
        if (line[j] === '}') braceCount++;
        if (line[j] === '{') braceCount--;
      }

      // Found potential function start
      if (braceCount < 0 ||
          /^\s*(function|class|def|void|int|bool|char|float|double|String|public|private|protected|static|async)\s/.test(line) ||
          /^\s*\w+\s*\([^)]*\)\s*{?\s*$/.test(line)) {
        startLine = i;
        foundStart = true;
        break;
      }
    }

    // If no function start found, use simple context
    if (!foundStart) {
      startLine = Math.max(0, lineNum - Math.floor(maxLines / 2));
    }

    // Reset brace count and look forward for block end
    braceCount = 0;
    for (let i = startLine; i < Math.min(lines.length, startLine + maxLines); i++) {
      const line = lines[i];

      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') braceCount++;
        if (line[j] === '}') braceCount--;
      }

      endLine = i;

      // Found matching closing brace
      if (braceCount === 0 && i > lineNum && lines[i].includes('}')) {
        break;
      }
    }

    return {
      startLine: startLine,
      endLine: Math.min(endLine, startLine + maxLines - 1),
      content: lines.slice(startLine, endLine + 1).join('\n'),
    };
  }

  /**
   * Read specific line range from a file
   * @param {string} filePath - Path to file (relative or absolute)
   * @param {number} startLine - Start line (1-indexed)
   * @param {number} endLine - End line (1-indexed)
   * @returns {Promise<Object>} - Line range content and metadata
   */
  async readLineRange(filePath, startLine, endLine) {
    try {
      // Resolve path
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(this.rootPath, filePath);

      // Read file
      const content = await fs.readFile(absolutePath, 'utf-8');
      const lines = content.split('\n');

      // Validate line numbers (1-indexed from user, convert to 0-indexed)
      const start = Math.max(0, startLine - 1);
      const end = Math.min(lines.length - 1, endLine - 1);

      if (start > end || start >= lines.length) {
        throw new Error(`Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)`);
      }

      const selectedLines = lines.slice(start, end + 1);

      return {
        path: absolutePath,
        relativePath: path.relative(this.rootPath, absolutePath),
        startLine: start + 1,
        endLine: end + 1,
        totalLines: lines.length,
        content: selectedLines.join('\n'),
        lines: selectedLines,
      };
    } catch (error) {
      throw new Error(`Failed to read line range ${startLine}-${endLine} from ${filePath}: ${error.message}`);
    }
  }

  /**
   * Search file contents for keywords and return snippets
   * @param {Array<string>} keywords - Keywords to search for
   * @param {number} contextLines - Lines of context around matches
   * @param {string} contextMode - 'simple', 'function', or 'extended'
   * @returns {Promise<Array<Object>>} - Files with matching snippets
   */
  async searchFileContents(keywords, contextLines = 3, contextMode = 'simple') {
    const results = [];
    const seenFiles = new Set();

    for (const file of this.index.files) {
      if (seenFiles.has(file.path)) continue;

      try {
        // Read file content
        const content = await fs.readFile(file.path, 'utf-8');
        const lines = content.split('\n');
        const matches = [];

        // Search for each keyword
        for (const keyword of keywords) {
          const lowerKeyword = keyword.toLowerCase();

          lines.forEach((line, lineNum) => {
            if (line.toLowerCase().includes(lowerKeyword)) {
              let snippetData;

              // Choose context extraction mode
              if (contextMode === 'function') {
                // Extract complete function/block context
                const functionLines = this.config.search?.functionContextLines || 50;
                snippetData = this.extractFunctionContext(lines, lineNum, functionLines);
                snippetData.lineNumber = lineNum + 1;
                snippetData.keyword = keyword;
                snippetData.startLine = snippetData.startLine + 1;
                snippetData.endLine = snippetData.endLine + 1;
                snippetData.snippet = snippetData.content;
                delete snippetData.content;
              } else if (contextMode === 'extended') {
                // Extended context for editing
                const editLines = this.config.search?.editContextLines || 25;
                const startLine = Math.max(0, lineNum - editLines);
                const endLine = Math.min(lines.length - 1, lineNum + editLines);
                snippetData = {
                  keyword,
                  lineNumber: lineNum + 1,
                  snippet: lines.slice(startLine, endLine + 1).join('\n'),
                  startLine: startLine + 1,
                  endLine: endLine + 1,
                };
              } else {
                // Simple context (default)
                const startLine = Math.max(0, lineNum - contextLines);
                const endLine = Math.min(lines.length - 1, lineNum + contextLines);
                snippetData = {
                  keyword,
                  lineNumber: lineNum + 1,
                  snippet: lines.slice(startLine, endLine + 1).join('\n'),
                  startLine: startLine + 1,
                  endLine: endLine + 1,
                };
              }

              matches.push(snippetData);
            }
          });
        }

        if (matches.length > 0) {
          results.push({
            path: file.path,
            relativePath: file.relativePath,
            matches,
            totalMatches: matches.length,
          });
          seenFiles.add(file.path);
        }
      } catch (error) {
        console.warn(`Failed to search ${file.relativePath}: ${error.message}`);
      }
    }

    // Sort by number of matches
    results.sort((a, b) => b.totalMatches - a.totalMatches);
    return results;
  }

  /**
   * Load complete file contents for files in search results
   * Only loads small files; returns metadata for large files
   * @param {Array<Object>} searchResults - Results from searchFileContents
   * @returns {Promise<Array<Object>>} - Files with complete or partial content
   */
  async loadFilesFromSearchResults(searchResults) {
    const loadedFiles = [];
    const smallFileThreshold = this.config.search?.smallFileThreshold || 500;

    for (const result of searchResults) {
      try {
        const content = await fs.readFile(result.path, 'utf-8');
        const lines = content.split('\n');
        const lineCount = lines.length;

        if (lineCount <= smallFileThreshold) {
          // Small file: load completely
          loadedFiles.push({
            relativePath: result.relativePath,
            path: result.path,
            content: content,
            lineCount: lineCount,
            loadedCompletely: true,
            message: `Complete file (${lineCount} lines)`,
          });
        } else {
          // Large file: provide guidance
          loadedFiles.push({
            relativePath: result.relativePath,
            path: result.path,
            lineCount: lineCount,
            loadedCompletely: false,
            matches: result.matches, // Keep the snippets from search
            message: `Large file (${lineCount} lines) - use <read_lines> to load specific sections`,
          });
        }
      } catch (error) {
        console.warn(`Failed to load ${result.relativePath}: ${error.message}`);
      }
    }

    return loadedFiles;
  }

  /**
   * Get file info from index
   * @param {string} filePath - Path to file
   * @returns {Object|null} - File info or null
   */
  getFileInfo(filePath) {
    const absolutePath = path.resolve(this.rootPath, filePath);
    return this.index.files.find(f => f.path === absolutePath) || null;
  }

  /**
   * Get project structure overview
   * @returns {Object} - Project statistics
   */
  getProjectStructure() {
    const extensions = {};
    let totalFunctions = 0;
    let totalClasses = 0;

    for (const file of this.index.files) {
      extensions[file.extension] = (extensions[file.extension] || 0) + 1;
      totalFunctions += file.functions.length;
      totalClasses += file.classes.length;
    }

    return {
      fileCount: this.index.files.length,
      extensions,
      totalFunctions,
      totalClasses,
      lastIndexed: this.index.lastIndexed,
    };
  }

  /**
   * Update index for a single file
   * @param {string} filePath - Path to file
   * @returns {Promise<void>}
   */
  async updateIndex(filePath) {
    const absolutePath = path.resolve(this.rootPath, filePath);

    // Remove old entry
    this.index.files = this.index.files.filter(f => f.path !== absolutePath);

    // Add updated entry
    try {
      const fileInfo = await this.parseFile(absolutePath);
      this.index.files.push(fileInfo);
    } catch (error) {
      console.warn(`Failed to update index for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Get all files of a specific type
   * @param {string} extension - File extension (e.g., '.js')
   * @returns {Array<Object>} - Matching files
   */
  getFilesByExtension(extension) {
    return this.index.files.filter(f => f.extension === extension);
  }

  /**
   * Find files containing a specific function or class
   * @param {string} name - Function or class name
   * @returns {Array<Object>} - Matching files
   */
  findDefinition(name) {
    return this.index.files.filter(
      f =>
        f.functions.includes(name) ||
        f.classes.includes(name) ||
        f.exports.includes(name)
    );
  }

  /**
   * Save index to file
   * @param {string} indexPath - Path to save index
   * @returns {Promise<void>}
   */
  async saveIndex(indexPath) {
    try {
      await this.fileOps.writeJSON(indexPath, this.index);
    } catch (error) {
      throw new Error(`Failed to save index: ${error.message}`);
    }
  }

  /**
   * Load index from file
   * @param {string} indexPath - Path to load index from
   * @returns {Promise<void>}
   */
  async loadIndex(indexPath) {
    try {
      if (!this.fileOps.fileExists(indexPath)) {
        this.index = {
          projectRoot: this.rootPath,
          lastIndexed: null,
          files: [],
        };
        this.loaded = true;
        return;
      }

      this.index = await this.fileOps.readJSON(indexPath);
      this.loaded = true;
    } catch (error) {
      console.warn(`Failed to load index: ${error.message}`);
      this.index = {
        projectRoot: this.rootPath,
        lastIndexed: null,
        files: [],
      };
      this.loaded = true;
    }
  }

  /**
   * Check if index is stale and needs rebuilding
   * @param {number} maxAgeHours - Maximum age in hours
   * @returns {boolean} - True if index is stale
   */
  isStale(maxAgeHours = 24) {
    if (!this.index.lastIndexed) return true;

    const lastIndexed = new Date(this.index.lastIndexed);
    const now = new Date();
    const ageHours = (now - lastIndexed) / (1000 * 60 * 60);

    return ageHours > maxAgeHours;
  }
}

export default CodebaseIndexer;
