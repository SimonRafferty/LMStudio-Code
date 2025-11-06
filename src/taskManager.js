import FileOperations from './fileOperations.js';
import { randomUUID } from 'crypto';

/**
 * TaskManager - Tracks tasks and project state
 * Manages todo list with pending, in-progress, and completed tasks
 */
class TaskManager {
  constructor(taskListPath, fileOps) {
    this.taskListPath = taskListPath;
    this.fileOps = fileOps;
    this.tasks = [];
    this.loaded = false;
  }

  /**
   * Initialize and load tasks
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.loadTasks();
  }

  /**
   * Add a new task
   * @param {string} description - Task description
   * @param {string} priority - Priority level (low, normal, high)
   * @returns {Object} - Created task
   */
  addTask(description, priority = 'normal') {
    const task = {
      id: randomUUID(),
      description,
      status: 'pending',
      priority,
      createdAt: new Date().toISOString(),
      completedAt: null,
      notes: '',
    };

    this.tasks.push(task);
    return task;
  }

  /**
   * Complete a task by ID
   * @param {string} taskId - Task ID
   * @returns {Object|null} - Updated task or null if not found
   */
  completeTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);

    if (task) {
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      return task;
    }

    return null;
  }

  /**
   * Complete a task by description (partial match)
   * @param {string} description - Task description or partial match
   * @returns {Object|null} - Updated task or null if not found
   */
  completeTaskByDescription(description) {
    const task = this.tasks.find(
      t => t.status !== 'completed' &&
      t.description.toLowerCase().includes(description.toLowerCase())
    );

    if (task) {
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      return task;
    }

    return null;
  }

  /**
   * Update a task
   * @param {string} taskId - Task ID
   * @param {Object} updates - Fields to update
   * @returns {Object|null} - Updated task or null if not found
   */
  updateTask(taskId, updates) {
    const task = this.tasks.find(t => t.id === taskId);

    if (task) {
      Object.assign(task, updates);
      return task;
    }

    return null;
  }

  /**
   * Get pending tasks
   * @returns {Array<Object>} - Pending tasks
   */
  getPendingTasks() {
    return this.tasks.filter(t => t.status === 'pending');
  }

  /**
   * Get in-progress tasks
   * @returns {Array<Object>} - In-progress tasks
   */
  getInProgressTasks() {
    return this.tasks.filter(t => t.status === 'in-progress');
  }

  /**
   * Get completed tasks
   * @returns {Array<Object>} - Completed tasks
   */
  getCompletedTasks() {
    return this.tasks.filter(t => t.status === 'completed');
  }

  /**
   * Get all tasks
   * @returns {Array<Object>} - All tasks
   */
  getAllTasks() {
    return this.tasks;
  }

  /**
   * Get task summary for display
   * @returns {string} - Formatted task summary
   */
  getTaskSummary() {
    const pending = this.getPendingTasks();
    const inProgress = this.getInProgressTasks();
    const completed = this.getCompletedTasks();

    let summary = '=== TASK LIST ===\n\n';

    if (inProgress.length > 0) {
      summary += '🔄 IN PROGRESS:\n';
      inProgress.forEach(task => {
        summary += `  - [${task.priority.toUpperCase()}] ${task.description}\n`;
        if (task.notes) summary += `    Notes: ${task.notes}\n`;
      });
      summary += '\n';
    }

    if (pending.length > 0) {
      summary += '📋 TODO:\n';
      pending.forEach(task => {
        summary += `  - [${task.priority.toUpperCase()}] ${task.description}\n`;
        if (task.notes) summary += `    Notes: ${task.notes}\n`;
      });
      summary += '\n';
    }

    if (completed.length > 0) {
      summary += '✅ COMPLETED:\n';
      completed.slice(-5).forEach(task => { // Show last 5 completed
        summary += `  - ${task.description}\n`;
      });
      if (completed.length > 5) {
        summary += `  ... and ${completed.length - 5} more\n`;
      }
      summary += '\n';
    }

    summary += `Total: ${this.tasks.length} tasks (${pending.length} pending, ${inProgress.length} in progress, ${completed.length} completed)\n`;

    return summary;
  }

  /**
   * Get task list for prompt inclusion (concise format)
   * @returns {string} - Formatted task list for LLM
   */
  getTaskListForPrompt() {
    const pending = this.getPendingTasks();
    const inProgress = this.getInProgressTasks();

    if (pending.length === 0 && inProgress.length === 0) {
      return 'No pending tasks.';
    }

    let taskList = 'CURRENT TASKS:\n';

    if (inProgress.length > 0) {
      taskList += 'In Progress:\n';
      inProgress.forEach(task => {
        taskList += `- ${task.description}\n`;
      });
    }

    if (pending.length > 0) {
      taskList += 'Pending:\n';
      pending.forEach(task => {
        taskList += `- ${task.description}\n`;
      });
    }

    return taskList.trim();
  }

  /**
   * Remove a task by ID
   * @param {string} taskId - Task ID
   * @returns {boolean} - True if removed
   */
  removeTask(taskId) {
    const index = this.tasks.findIndex(t => t.id === taskId);

    if (index !== -1) {
      this.tasks.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Clear all completed tasks
   * @returns {number} - Number of tasks cleared
   */
  clearCompletedTasks() {
    const completedCount = this.getCompletedTasks().length;
    this.tasks = this.tasks.filter(t => t.status !== 'completed');
    return completedCount;
  }

  /**
   * Clear all tasks
   */
  clearAllTasks() {
    this.tasks = [];
  }

  /**
   * Get task by ID
   * @param {string} taskId - Task ID
   * @returns {Object|null} - Task or null
   */
  getTask(taskId) {
    return this.tasks.find(t => t.id === taskId) || null;
  }

  /**
   * Search tasks by keyword
   * @param {string} keyword - Search keyword
   * @returns {Array<Object>} - Matching tasks
   */
  searchTasks(keyword) {
    const lowerKeyword = keyword.toLowerCase();
    return this.tasks.filter(
      t => t.description.toLowerCase().includes(lowerKeyword) ||
           t.notes.toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * Save tasks to file
   * @returns {Promise<void>}
   */
  async saveTasks() {
    try {
      await this.fileOps.writeJSON(this.taskListPath, {
        tasks: this.tasks,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      throw new Error(`Failed to save tasks: ${error.message}`);
    }
  }

  /**
   * Load tasks from file
   * @returns {Promise<void>}
   */
  async loadTasks() {
    try {
      if (!this.fileOps.fileExists(this.taskListPath)) {
        this.tasks = [];
        this.loaded = true;
        return;
      }

      const data = await this.fileOps.readJSON(this.taskListPath);
      this.tasks = data.tasks || [];
      this.loaded = true;
    } catch (error) {
      console.warn(`Failed to load tasks, starting with empty list: ${error.message}`);
      this.tasks = [];
      this.loaded = true;
    }
  }

  /**
   * Export tasks to a readable format
   * @returns {string} - Formatted task export
   */
  exportTasks() {
    const output = {
      exportDate: new Date().toISOString(),
      summary: {
        total: this.tasks.length,
        pending: this.getPendingTasks().length,
        inProgress: this.getInProgressTasks().length,
        completed: this.getCompletedTasks().length,
      },
      tasks: this.tasks,
    };

    return JSON.stringify(output, null, 2);
  }
}

export default TaskManager;
