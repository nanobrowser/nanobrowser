import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';
import type {
  ProceduralMemory,
  ProceduralMemoryMetadata,
  ProceduralMemoryStorage,
  DemonstrationRecording,
} from './types';

// Keys for storing procedural memory metadata
const PROCEDURAL_MEMORIES_META_KEY = 'procedural_memories_meta';
const DEMONSTRATION_RECORDINGS_KEY = 'demonstration_recordings';

// Create storage for procedural memory metadata
const proceduralMemoriesMetaStorage = createStorage<ProceduralMemoryMetadata[]>(PROCEDURAL_MEMORIES_META_KEY, [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

// Create storage for demonstration recordings
const demonstrationRecordingsStorage = createStorage<DemonstrationRecording[]>(DEMONSTRATION_RECORDINGS_KEY, [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

// Helper function to get storage key for a specific memory
const getMemoryKey = (id: string) => `procedural_memory_${id}`;

// Helper function to create storage for a specific memory
const getMemoryStorage = (id: string) => {
  return createStorage<ProceduralMemory>(
    getMemoryKey(id),
    {} as ProceduralMemory, // This should never be returned since we check existence first
    {
      storageEnum: StorageEnum.Local,
      liveUpdate: true,
    },
  );
};

// Helper function to get current timestamp
const getCurrentTimestamp = (): number => Date.now();

/**
 * Calculate confidence score based on success rate and recency
 * Implements exponential decay for older memories
 */
function calculateConfidence(successCount: number, failureCount: number, updatedAt: number): number {
  const totalAttempts = successCount + failureCount;
  if (totalAttempts === 0) return 0.5; // Neutral confidence for untested procedures

  // Base confidence from success rate (0-1)
  const baseConfidence = successCount / totalAttempts;

  // Recency factor: exponential decay with 30-day half-life
  const daysSinceUpdate = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.exp(-0.023 * daysSinceUpdate); // 0.023 ≈ ln(2)/30

  // Weight: 80% success rate, 20% recency
  return baseConfidence * 0.8 + recencyFactor * 0.2;
}

/**
 * Creates a procedural memory storage instance
 * Implements storage operations for the BUILD-RETRIEVE-UPDATE cycle
 */
export function createProceduralMemoryStorage(): ProceduralMemoryStorage {
  return {
    // ===== Procedural Memory CRUD =====

    getAllMemories: async (): Promise<ProceduralMemory[]> => {
      const metadata = await proceduralMemoriesMetaStorage.get();
      const memories: ProceduralMemory[] = [];

      for (const meta of metadata) {
        const memoryStorage = getMemoryStorage(meta.id);
        const memory = await memoryStorage.get();
        if (memory && memory.id) {
          memories.push(memory);
        }
      }

      return memories;
    },

    getMemoriesMetadata: async (): Promise<ProceduralMemoryMetadata[]> => {
      return await proceduralMemoriesMetaStorage.get();
    },

    getMemory: async (id: string): Promise<ProceduralMemory | null> => {
      const metadata = await proceduralMemoriesMetaStorage.get();
      const meta = metadata.find(m => m.id === id);

      if (!meta) return null;

      const memoryStorage = getMemoryStorage(id);
      const memory = await memoryStorage.get();

      // Check if memory has an id property (indicates it exists)
      if (!memory || !memory.id) return null;

      return memory;
    },

    createMemory: async (
      memoryData: Omit<ProceduralMemory, 'id' | 'createdAt' | 'updatedAt'>,
    ): Promise<ProceduralMemory> => {
      const id = crypto.randomUUID();
      const currentTime = getCurrentTimestamp();

      const newMemory: ProceduralMemory = {
        ...memoryData,
        id,
        createdAt: currentTime,
        updatedAt: currentTime,
      };

      // Create the full memory storage
      const memoryStorage = getMemoryStorage(id);
      await memoryStorage.set(newMemory);

      // Add metadata to index
      const newMeta: ProceduralMemoryMetadata = {
        id,
        title: newMemory.title,
        goal: newMemory.abstract.goal,
        domains: newMemory.abstract.domains,
        tags: newMemory.abstract.tags,
        createdAt: currentTime,
        updatedAt: currentTime,
        confidence: newMemory.confidence,
        deprecated: newMemory.deprecated,
        source: newMemory.source,
      };

      await proceduralMemoriesMetaStorage.set(prev => [...prev, newMeta]);

      return newMemory;
    },

    updateMemory: async (id: string, updates: Partial<ProceduralMemory>): Promise<ProceduralMemory> => {
      const memoryStorage = getMemoryStorage(id);
      const existingMemory = await memoryStorage.get();

      if (!existingMemory || !existingMemory.id) {
        throw new Error(`Memory with ID ${id} not found`);
      }

      const updatedMemory: ProceduralMemory = {
        ...existingMemory,
        ...updates,
        id, // Ensure ID doesn't change
        createdAt: existingMemory.createdAt, // Preserve creation time
        updatedAt: getCurrentTimestamp(),
      };

      await memoryStorage.set(updatedMemory);

      // Update metadata
      await proceduralMemoriesMetaStorage.set(prev =>
        prev.map(meta => {
          if (meta.id === id) {
            return {
              ...meta,
              title: updatedMemory.title,
              goal: updatedMemory.abstract.goal,
              domains: updatedMemory.abstract.domains,
              tags: updatedMemory.abstract.tags,
              updatedAt: updatedMemory.updatedAt,
              confidence: updatedMemory.confidence,
              deprecated: updatedMemory.deprecated,
            };
          }
          return meta;
        }),
      );

      return updatedMemory;
    },

    deleteMemory: async (id: string): Promise<void> => {
      // Remove from metadata
      await proceduralMemoriesMetaStorage.set(prev => prev.filter(meta => meta.id !== id));

      // Remove the memory itself (set to empty object)
      const memoryStorage = getMemoryStorage(id);
      await memoryStorage.set({} as ProceduralMemory);
    },

    clearAllMemories: async (): Promise<void> => {
      const metadata = await proceduralMemoriesMetaStorage.get();

      // Delete all individual memories
      for (const meta of metadata) {
        const memoryStorage = getMemoryStorage(meta.id);
        await memoryStorage.set({} as ProceduralMemory);
      }

      // Clear metadata
      await proceduralMemoriesMetaStorage.set([]);
    },

    // ===== Search and Retrieval =====

    searchMemories: async (query: {
      goal?: string;
      domains?: string[];
      tags?: string[];
      minConfidence?: number;
      excludeDeprecated?: boolean;
    }): Promise<ProceduralMemory[]> => {
      const metadata = await proceduralMemoriesMetaStorage.get();

      // Filter metadata first for efficiency
      let filtered = metadata;

      if (query.excludeDeprecated !== false) {
        filtered = filtered.filter(meta => !meta.deprecated);
      }

      if (query.minConfidence !== undefined) {
        filtered = filtered.filter(meta => meta.confidence >= query.minConfidence!);
      }

      if (query.domains && query.domains.length > 0) {
        filtered = filtered.filter(meta => query.domains!.some(domain => meta.domains.includes(domain)));
      }

      if (query.tags && query.tags.length > 0) {
        filtered = filtered.filter(meta => query.tags!.some(tag => meta.tags.includes(tag)));
      }

      if (query.goal) {
        const goalLower = query.goal.toLowerCase();
        filtered = filtered.filter(meta => meta.goal.toLowerCase().includes(goalLower));
      }

      // Load full memories for filtered results
      const memories: ProceduralMemory[] = [];
      for (const meta of filtered) {
        const memoryStorage = getMemoryStorage(meta.id);
        const memory = await memoryStorage.get();
        if (memory && memory.id) {
          memories.push(memory);
        }
      }

      // Sort by confidence (descending)
      memories.sort((a, b) => b.confidence - a.confidence);

      return memories;
    },

    // ===== Demonstration Recordings =====

    getAllRecordings: async (): Promise<DemonstrationRecording[]> => {
      return await demonstrationRecordingsStorage.get();
    },

    getRecording: async (id: string): Promise<DemonstrationRecording | null> => {
      const recordings = await demonstrationRecordingsStorage.get();
      return recordings.find(r => r.id === id) || null;
    },

    createRecording: async (
      recordingData: Omit<DemonstrationRecording, 'id' | 'startedAt' | 'processed'>,
    ): Promise<DemonstrationRecording> => {
      const id = crypto.randomUUID();
      const newRecording: DemonstrationRecording = {
        ...recordingData,
        id,
        startedAt: getCurrentTimestamp(),
        processed: false,
      };

      await demonstrationRecordingsStorage.set(prev => [...prev, newRecording]);

      return newRecording;
    },

    updateRecording: async (id: string, updates: Partial<DemonstrationRecording>): Promise<DemonstrationRecording> => {
      let updatedRecording: DemonstrationRecording | null = null;

      await demonstrationRecordingsStorage.set(prev =>
        prev.map(recording => {
          if (recording.id === id) {
            updatedRecording = { ...recording, ...updates };
            return updatedRecording;
          }
          return recording;
        }),
      );

      if (!updatedRecording) {
        throw new Error(`Recording with ID ${id} not found`);
      }

      return updatedRecording;
    },

    deleteRecording: async (id: string): Promise<void> => {
      await demonstrationRecordingsStorage.set(prev => prev.filter(recording => recording.id !== id));
    },

    clearAllRecordings: async (): Promise<void> => {
      await demonstrationRecordingsStorage.set([]);
    },

    // ===== Statistics =====

    updateMemoryStats: async (id: string, success: boolean): Promise<void> => {
      const memoryStorage = getMemoryStorage(id);
      const memory = await memoryStorage.get();

      if (!memory || !memory.id) {
        throw new Error(`Memory with ID ${id} not found`);
      }

      const successCount = success ? memory.successCount + 1 : memory.successCount;
      const failureCount = success ? memory.failureCount : memory.failureCount + 1;
      const updatedAt = getCurrentTimestamp();
      const confidence = calculateConfidence(successCount, failureCount, updatedAt);

      const updatedMemory: ProceduralMemory = {
        ...memory,
        successCount,
        failureCount,
        confidence,
        updatedAt,
      };

      await memoryStorage.set(updatedMemory);

      // Update metadata confidence
      await proceduralMemoriesMetaStorage.set(prev =>
        prev.map(meta => {
          if (meta.id === id) {
            return { ...meta, confidence, updatedAt };
          }
          return meta;
        }),
      );
    },
  };
}

// Export singleton instance
export const proceduralMemoryStore = createProceduralMemoryStorage();
