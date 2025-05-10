import { z } from 'zod';
import { createLogger } from '../log';
import { ActionResult } from '../agent/types';
import { memoryService } from './service';
import { sessionMemoryService } from './session-service';

const logger = createLogger('MemoryActions');

export const createMemoryActions = () => {
  const setMemoryAction = {
    name: () => 'set_memory',
    description: () => 'Store a value in memory that persists across agent steps',
    parameters: () =>
      z.object({
        key: z.string().describe('The key under which to store the value'),
        value: z.any().describe('The value to store in memory'),
        intent: z.string().optional().describe('Optional description of why this memory is being set'),
      }),
    schema: {
      name: 'set_memory',
      description: 'Store a value in memory that persists across agent steps',
      schema: z.object({
        key: z.string().describe('The key under which to store the value'),
        value: z.any().describe('The value to store in memory'),
        intent: z.string().optional().describe('Optional description of why this memory is being set'),
      }),
    },
    getIndexArg: () => null,
    call: async (params: any) => {
      try {
        const { key, value } = params;

        if (!key) {
          throw new Error('Key is required to set memory');
        }

        memoryService.set(key, value);
        // Also store in session memory for persistence
        sessionMemoryService.set(key, value);

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
    },
  };

  const getMemoryAction = {
    name: () => 'get_memory',
    description: () => 'Retrieve a value from memory',
    parameters: () =>
      z.object({
        key: z.string().describe('The key to retrieve from memory'),
        intent: z.string().optional().describe('Optional description of why this memory is being accessed'),
      }),
    schema: {
      name: 'get_memory',
      description: 'Retrieve a value from memory',
      schema: z.object({
        key: z.string().describe('The key to retrieve from memory'),
        intent: z.string().optional().describe('Optional description of why this memory is being accessed'),
      }),
    },
    getIndexArg: () => null,
    call: async (params: any) => {
      try {
        const { key } = params;

        if (!key) {
          throw new Error('Key is required to get memory');
        }

        const value = memoryService.get(key);
        // Also try getting from session memory if not found
        const sessionValue = sessionMemoryService.get(key);
        const finalValue = value !== undefined ? value : sessionValue;
        const valueStr = typeof finalValue === 'object' ? JSON.stringify(finalValue) : String(finalValue);

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
    },
  };

  const incrementCounterAction = {
    name: () => 'increment_counter',
    description: () => 'Increment a numeric counter in memory, perfect for tracking counts of items processed',
    parameters: () =>
      z.object({
        key: z.string().describe('The counter key to increment'),
        increment: z.number().optional().describe('Amount to increment by (default: 1)'),
        intent: z.string().optional().describe('Optional description of why this counter is being incremented'),
      }),
    schema: {
      name: 'increment_counter',
      description: 'Increment a numeric counter in memory, perfect for tracking counts of items processed',
      schema: z.object({
        key: z.string().describe('The counter key to increment'),
        increment: z.number().optional().describe('Amount to increment by (default: 1)'),
        intent: z.string().optional().describe('Optional description of why this counter is being incremented'),
      }),
    },
    getIndexArg: () => null,
    call: async (params: any) => {
      try {
        const { key, increment = 1 } = params;

        if (!key) {
          throw new Error('Key is required to increment counter');
        }

        const newValue = memoryService.increment(key, increment);
        // Also increment in session memory
        sessionMemoryService.increment(key, increment);

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
    },
  };

  // GET ALL MEMORY ACTION
  const getAllMemoryAction = {
    name: () => 'get_all_memory',
    description: () => 'Get all data stored in memory',
    parameters: () =>
      z.object({
        intent: z.string().optional().describe('Optional description of why all memory is being retrieved'),
      }),
    schema: {
      name: 'get_all_memory',
      description: 'Get all data stored in memory',
      schema: z.object({
        intent: z.string().optional().describe('Optional description of why all memory is being retrieved'),
      }),
    },
    getIndexArg: () => null,
    call: async (params: any) => {
      try {
        const memoryString = memoryService.toString();
        // Also get session memory data
        const sessionMemoryString = sessionMemoryService.toString();

        // Combine both for a complete view
        let combinedString = memoryString;
        if (sessionMemoryString !== 'No data in memory.' && sessionMemoryString !== memoryString) {
          combinedString += '\n\nPersistent Memory (survives task completion):\n' + sessionMemoryString;
        }

        return new ActionResult({
          extractedContent: combinedString,
          includeInMemory: true,
        });
      } catch (error) {
        logger.error('Failed to get all memory:', error);
        return new ActionResult({
          error: error instanceof Error ? error.message : String(error),
          includeInMemory: true,
        });
      }
    },
  };

  return {
    setMemoryAction,
    getMemoryAction,
    incrementCounterAction,
    getAllMemoryAction,
  };
};
