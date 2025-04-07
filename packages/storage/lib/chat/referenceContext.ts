import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';

// Key for storing reference context
const REFERENCE_CONTEXT_KEY = 'reference_context';

// Create storage for reference context
const referenceContextStorage = createStorage<string>(REFERENCE_CONTEXT_KEY, '', {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

/**
 * Store for managing the user's reference context
 */
export const referenceContextStore = {
  /**
   * Get the user's reference context
   */
  getContext: async (): Promise<string> => {
    const context = await referenceContextStorage.get();
    return context || '';
  },

  /**
   * Set the user's reference context
   * @param context - The reference context to set
   */
  setContext: async (context: string): Promise<void> => {
    await referenceContextStorage.set(context);
  },

  /**
   * Clear the user's reference context
   */
  clearContext: async (): Promise<void> => {
    await referenceContextStorage.set('');
  },
};
