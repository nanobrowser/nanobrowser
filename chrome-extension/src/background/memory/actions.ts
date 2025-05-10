import { z } from 'zod';
import { createLogger } from '../log';
import { ActionResult } from '../agent/types';
import { memoryService } from './service';
import { Action } from '../agent/actions/builder';

const logger = createLogger('MemoryActions');

/**
 * Action to store a value in memory
 */
export class SetMemoryAction implements Action {
  name() {
    return 'set_memory';
  }

  description() {
    return 'Store a value in memory that persists across agent steps';
  }

  parameters() {
    return z.object({
      key: z.string().describe('The key under which to store the value'),
      value: z.any().describe('The value to store in memory'),
      intent: z.string().optional().describe('Optional description of why this memory is being set'),
    });
  }

  schema = {
    name: 'set_memory',
    description: 'Store a value in memory that persists across agent steps',
    schema: z.object({
      key: z.string().describe('The key under which to store the value'),
      value: z.any().describe('The value to store in memory'),
      intent: z.string().optional().describe('Optional description of why this memory is being set'),
    }),
  };

  getIndexArg() {
    return null; // No index needed
  }

  async call(params: any): Promise<ActionResult> {
    try {
      const { key, value } = params;

      if (!key) {
        throw new Error('Key is required to set memory');
      }

      memoryService.set(key, value);

      return new ActionResult({
        extractedContent: `Successfully stored "${key}" in memory with value: ${JSON.stringify(value)}`,
        includeInMemory: true,
      });
    } catch (error) {
      logger.error('Failed to set memory:', error);
      return new ActionResult({
        error: error instanceof Error ? error.message : String(error),
        includeInMemory: true,
      });
    }
  }
}

/**
 * Action to retrieve a value from memory
 */
export class GetMemoryAction implements Action {
  name() {
    return 'get_memory';
  }

  description() {
    return 'Retrieve a value from memory';
  }

  parameters() {
    return z.object({
      key: z.string().describe('The key to retrieve from memory'),
      intent: z.string().optional().describe('Optional description of why this memory is being accessed'),
    });
  }

  schema = {
    name: 'get_memory',
    description: 'Retrieve a value from memory',
    schema: z.object({
      key: z.string().describe('The key to retrieve from memory'),
      intent: z.string().optional().describe('Optional description of why this memory is being accessed'),
    }),
  };

  getIndexArg() {
    return null;
  }

  async call(params: any): Promise<ActionResult> {
    try {
      const { key } = params;

      if (!key) {
        throw new Error('Key is required to get memory');
      }

      const value = memoryService.get(key);
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);

      return new ActionResult({
        extractedContent: `Value for "${key}" in memory: ${valueStr}`,
        includeInMemory: true,
      });
    } catch (error) {
      logger.error('Failed to get memory:', error);
      return new ActionResult({
        error: error instanceof Error ? error.message : String(error),
        includeInMemory: true,
      });
    }
  }
}

/**
 * Action to increment a counter in memory
 * Perfect for tracking counts like "posts scrolled"
 */
export class IncrementCounterAction implements Action {
  name() {
    return 'increment_counter';
  }

  description() {
    return 'Increment a numeric counter in memory, perfect for tracking counts of items processed';
  }

  parameters() {
    return z.object({
      key: z.string().describe('The counter key to increment'),
      increment: z.number().optional().describe('Amount to increment by (default: 1)'),
      intent: z.string().optional().describe('Optional description of why this counter is being incremented'),
    });
  }

  schema = {
    name: 'increment_counter',
    description: 'Increment a numeric counter in memory, perfect for tracking counts of items processed',
    schema: z.object({
      key: z.string().describe('The counter key to increment'),
      increment: z.number().optional().describe('Amount to increment by (default: 1)'),
      intent: z.string().optional().describe('Optional description of why this counter is being incremented'),
    }),
  };

  getIndexArg() {
    return null;
  }

  async call(params: any): Promise<ActionResult> {
    try {
      const { key, increment = 1 } = params;

      if (!key) {
        throw new Error('Key is required to increment counter');
      }

      const newValue = memoryService.increment(key, increment);

      return new ActionResult({
        extractedContent: `Counter "${key}" incremented by ${increment}. New value: ${newValue}`,
        includeInMemory: true,
      });
    } catch (error) {
      logger.error('Failed to increment counter:', error);
      return new ActionResult({
        error: error instanceof Error ? error.message : String(error),
        includeInMemory: true,
      });
    }
  }
}

/**
 * Action to get all memory data
 */
export class GetAllMemoryAction implements Action {
  name() {
    return 'get_all_memory';
  }

  description() {
    return 'Get all data stored in memory';
  }

  parameters() {
    return z.object({
      intent: z.string().optional().describe('Optional description of why all memory is being retrieved'),
    });
  }

  schema = {
    name: 'get_all_memory',
    description: 'Get all data stored in memory',
    schema: z.object({
      intent: z.string().optional().describe('Optional description of why all memory is being retrieved'),
    }),
  };

  getIndexArg() {
    return null; // No index needed
  }

  async call(params: any): Promise<ActionResult> {
    try {
      const memoryString = memoryService.toString();

      return new ActionResult({
        extractedContent: memoryString,
        includeInMemory: true,
      });
    } catch (error) {
      logger.error('Failed to get all memory:', error);
      return new ActionResult({
        error: error instanceof Error ? error.message : String(error),
        includeInMemory: true,
      });
    }
  }
}
