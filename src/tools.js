/**
 * Tool definitions for LLM function calling
 * These tools allow the LLM to interact with the codebase using structured function calls
 * instead of XML tags.
 */

/**
 * Get all available tools for the LLM
 * @returns {Array} - Array of tool definitions in OpenAI format
 */
export function getToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "search_code",
        description: "Search for code in the codebase by keywords. Returns matching files and code snippets. ALWAYS use this FIRST when you need to examine code, find implementations, or understand the codebase structure. Don't explain what you'll search for - just search immediately.",
        parameters: {
          type: "object",
          properties: {
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "Array of keywords to search for in the codebase (e.g., ['authentication', 'login'])"
            }
          },
          required: ["keywords"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read_file_lines",
        description: "Read specific line ranges from a file. Use this to see complete code sections when search results show snippets, or to examine specific parts of files. Call this immediately when you need file contents - don't describe your plan first.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file (can be relative or absolute)"
            },
            start_line: {
              type: "integer",
              description: "Starting line number (1-indexed)"
            },
            end_line: {
              type: "integer",
              description: "Ending line number (inclusive)"
            }
          },
          required: ["path", "start_line", "end_line"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description: "Edit a file by replacing old text with new text. The old_text must match exactly (including whitespace). Only use this after you've read the file and know the exact text to replace.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file to edit"
            },
            old_text: {
              type: "string",
              description: "Exact text to replace (must match exactly including indentation)"
            },
            new_text: {
              type: "string",
              description: "New text to insert in place of old_text"
            },
            description: {
              type: "string",
              description: "Brief description of what this edit does"
            }
          },
          required: ["path", "old_text", "new_text", "description"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "create_file",
        description: "Create a new file with the specified content. Only use this when explicitly asked to create a new file, not to edit existing ones.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path where the new file should be created"
            },
            content: {
              type: "string",
              description: "Complete content of the new file"
            },
            description: {
              type: "string",
              description: "Brief description of what this file does"
            }
          },
          required: ["path", "content", "description"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description: "Delete a file from the codebase. Use with caution - only when explicitly requested by the user.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file to delete"
            },
            reason: {
              type: "string",
              description: "Reason for deleting this file"
            }
          },
          required: ["path", "reason"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "update_task",
        description: "Add or complete a task in the task list. Use this to track your progress on multi-step operations.",
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Description of the task"
            },
            status: {
              type: "string",
              enum: ["pending", "completed"],
              description: "Status of the task - 'pending' to add a new task, 'completed' to mark it done"
            }
          },
          required: ["description", "status"]
        }
      }
    }
  ];
}

/**
 * Map tool names to their corresponding XML tags for backward compatibility
 */
export const TOOL_TO_XML_MAP = {
  search_code: 'search',
  read_file_lines: 'read_lines',
  edit_file: 'file_edit',
  create_file: 'file_create',
  delete_file: 'file_delete',
  update_task: 'task_update'
};

/**
 * Check if a response contains tool calls
 * @param {Object} response - API response
 * @returns {boolean}
 */
export function hasToolCalls(response) {
  return !!(response.tool_calls && response.tool_calls.length > 0);
}

/**
 * Parse tool calls from API response
 * @param {Object} response - API response with tool_calls
 * @returns {Array} - Parsed tool calls with name and arguments
 */
export function parseToolCalls(response) {
  if (!hasToolCalls(response)) {
    return [];
  }

  return response.tool_calls.map(toolCall => {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: args
      };
    } catch (error) {
      console.error(`Failed to parse tool call arguments:`, error);
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: {},
        error: 'Failed to parse arguments'
      };
    }
  });
}

/**
 * Convert tool calls to the format expected by existing code
 * This allows tool-based responses to work with the existing action execution system
 * @param {Array} toolCalls - Parsed tool calls
 * @returns {Object} - Actions in the format expected by responseParser
 */
export function convertToolCallsToActions(toolCalls) {
  const actions = {
    searches: [],
    readLines: [],
    fileEdits: [],
    fileCreates: [],
    fileDeletes: [],
    taskUpdates: []
  };

  for (const toolCall of toolCalls) {
    const { name, arguments: args } = toolCall;

    switch (name) {
      case 'search_code':
        // Flatten keywords array to match XML parser format
        const keywords = args.keywords || [];
        actions.searches.push(...keywords);
        break;

      case 'read_file_lines':
        actions.readLines.push({
          path: args.path,
          startLine: args.start_line,
          endLine: args.end_line
        });
        break;

      case 'edit_file':
        actions.fileEdits.push({
          path: args.path,
          oldText: args.old_text,
          newText: args.new_text,
          description: args.description
        });
        break;

      case 'create_file':
        actions.fileCreates.push({
          path: args.path,
          content: args.content,
          description: args.description
        });
        break;

      case 'delete_file':
        actions.fileDeletes.push({
          path: args.path,
          reason: args.reason
        });
        break;

      case 'update_task':
        actions.taskUpdates.push({
          description: args.description,
          status: args.status
        });
        break;

      default:
        console.warn(`Unknown tool call: ${name}`);
    }
  }

  return actions;
}
