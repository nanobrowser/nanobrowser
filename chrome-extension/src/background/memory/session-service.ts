import { createLogger } from '../log';

const logger = createLogger('SessionMemoryService');

/**
 * Session Memory Service that persists across task executions until the browser is closed
 */
export class SessionMemoryService {
  private static instance: SessionMemoryService;
  private data: Record<string, any> = {};
  private currentTaskId: string | null = null;

  private constructor() {
    this.clear();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SessionMemoryService {
    if (!SessionMemoryService.instance) {
      SessionMemoryService.instance = new SessionMemoryService();
    }
    return SessionMemoryService.instance;
  }

  /**
   * Set current task context
   */
  setTaskContext(taskId: string): void {
    this.currentTaskId = taskId;
    if (!this.data[taskId]) {
      this.data[taskId] = {};
    }
    logger.info(`Session memory context set to task ${taskId}`);
  }

  /**
   * Store a value in memory
   */
  set(key: string, value: any): void {
    if (!this.currentTaskId) {
      logger.warning('Attempted to set memory without a task context');
      return;
    }

    this.data[this.currentTaskId][key] = value;
    logger.info(`Session memory: Set ${key} = ${JSON.stringify(value)}`);
  }

  /**
   * Retrieve a value from memory
   */
  get<T>(key: string, defaultValue?: T): T {
    if (!this.currentTaskId || !this.data[this.currentTaskId]) {
      logger.warning('Attempted to get memory without a valid task context');
      return defaultValue as T;
    }

    const value = this.data[this.currentTaskId][key];
    return value !== undefined ? value : (defaultValue as T);
  }

  /**
   * Increment a counter in memory
   */
  increment(key: string, increment = 1): number {
    const currentValue = this.get<number>(key, 0);
    const newValue = currentValue + increment;
    this.set(key, newValue);
    return newValue;
  }

  /**
   * Check if a key exists in memory
   */
  has(key: string): boolean {
    if (!this.currentTaskId || !this.data[this.currentTaskId]) {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(this.data[this.currentTaskId], key);
  }

  /**
   * Get all memory data for current task
   */
  getTaskData(): Record<string, any> {
    if (!this.currentTaskId || !this.data[this.currentTaskId]) {
      return {};
    }
    return { ...this.data[this.currentTaskId] };
  }

  /**
   * Format memory data as a string for inclusion in prompts
   */
  toString(taskId?: string): string {
    const id = taskId || this.currentTaskId;

    if (!id || !this.data[id] || Object.keys(this.data[id]).length === 0) {
      return 'No data in memory.';
    }

    const entries = Object.entries(this.data[id])
      .map(([key, value]) => {
        // Format the value based on its type
        const formattedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

        return `${key}: ${formattedValue}`;
      })
      .join('\n');

    return `Memory Contents:\n${entries}`;
  }

  /**
   * Get all session data
   */
  getAllSessionData(): Record<string, Record<string, any>> {
    return { ...this.data };
  }

  /**
   * Clear all memory data
   */
  clear(): void {
    this.data = {};
    this.currentTaskId = null;
    logger.info('Session memory cleared');
  }

  /**
   * Clear memory for a specific task
   */
  clearTaskData(taskId: string): void {
    if (this.data[taskId]) {
      delete this.data[taskId];
      logger.info(`Session memory cleared for task ${taskId}`);
    }
  }
}

// Export singleton instance
export const sessionMemoryService = SessionMemoryService.getInstance();
