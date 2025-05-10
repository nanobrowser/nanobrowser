import { createLogger } from '../log';

const logger = createLogger('MemoryService');

/**
 * Simple in-memory storage service for maintaining state across agent execution steps
 */
export class MemoryService {
  private data: Record<string, any> = {};
  private taskId: string | null = null;

  constructor() {
    this.clear();
  }

  /**
   * Initialize memory for a specific task
   */
  initialize(taskId: string): void {
    this.taskId = taskId;
    this.data = {};
    logger.info(`Memory initialized for task ${taskId}`);
  }

  /**
   * Store a value in memory
   */
  set(key: string, value: any): void {
    this.data[key] = value;
    logger.info(`Memory: Set ${key} = ${JSON.stringify(value)}`);
  }

  /**
   * Retrieve a value from memory
   */
  get<T>(key: string, defaultValue?: T): T {
    const value = this.data[key];
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
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  /**
   * Get all memory data
   */
  getAll(): Record<string, any> {
    return { ...this.data };
  }

  /**
   * Clear all memory data
   */
  clear(): void {
    this.data = {};
    this.taskId = null;
    logger.info('Memory cleared');
  }

  /**
   * Format memory data as a string for inclusion in prompts
   */
  toString(): string {
    if (Object.keys(this.data).length === 0) {
      return 'No data in memory.';
    }

    const entries = Object.entries(this.data)
      .map(([key, value]) => {
        // Format the value based on its type
        const formattedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

        return `${key}: ${formattedValue}`;
      })
      .join('\n');

    return `Memory Contents:\n${entries}`;
  }
}

// Create a singleton instance of the memory service
export const memoryService = new MemoryService();
