import { instanceIdStore } from '@extension/storage';
import { createLogger } from '../log';

const logger = createLogger('InstanceIdService');

export interface InstanceIdService {
  getInstanceId(): Promise<string>;
  generateNewInstanceId(): Promise<string>;
  getChannelName(): string;
  getCreatedAt(): Promise<number>;
}

/**
 * Service for managing unique instance IDs for Chrome extension instances.
 * Each extension installation gets a unique ID used for AppSync channel identification.
 */
class InstanceIdServiceImpl implements InstanceIdService {
  private cachedInstanceId: string | null = null;
  private cachedChannelName: string | null = null;

  /**
   * Get the current instance ID, generating one if it doesn't exist
   */
  async getInstanceId(): Promise<string> {
    if (this.cachedInstanceId) {
      return this.cachedInstanceId;
    }

    try {
      this.cachedInstanceId = await instanceIdStore.getOrCreateInstanceId();
      logger.info('Retrieved instance ID:', this.cachedInstanceId);
      return this.cachedInstanceId;
    } catch (error) {
      logger.error('Failed to get instance ID:', error);
      throw new Error('Failed to retrieve instance ID');
    }
  }

  /**
   * Generate a new instance ID (useful for debugging or resetting)
   */
  async generateNewInstanceId(): Promise<string> {
    try {
      this.cachedInstanceId = await instanceIdStore.generateNewInstanceId();
      this.cachedChannelName = null; // Reset cached channel name
      logger.info('Generated new instance ID:', this.cachedInstanceId);
      return this.cachedInstanceId;
    } catch (error) {
      logger.error('Failed to generate new instance ID:', error);
      throw new Error('Failed to generate new instance ID');
    }
  }

  /**
   * Get the AppSync channel name for this instance
   * Format: /default/${instanceId}
   */
  getChannelName(): string {
    if (this.cachedChannelName) {
      return this.cachedChannelName;
    }

    if (!this.cachedInstanceId) {
      throw new Error('Instance ID not initialized. Call getInstanceId() first.');
    }

    this.cachedChannelName = `/default/${this.cachedInstanceId}`;
    return this.cachedChannelName;
  }

  /**
   * Get the timestamp when this instance ID was created
   */
  async getCreatedAt(): Promise<number> {
    try {
      const createdAt = await instanceIdStore.getCreatedAt();
      if (createdAt === null) {
        throw new Error('Instance ID not created yet, cannot get creation time.');
      }
      return createdAt;
    } catch (error) {
      logger.error('Failed to get instance creation time:', error);
      throw new Error('Failed to retrieve instance creation time');
    }
  }

  /**
   * Initialize the service by ensuring an instance ID exists
   */
  async initialize(): Promise<void> {
    await this.getInstanceId();
    logger.info('InstanceIdService initialized');
  }
}

// Export singleton instance
export const instanceIdService = new InstanceIdServiceImpl();
