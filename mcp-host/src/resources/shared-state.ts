import { BrowserState } from './types.js';

// Singleton to store and provide access to the browser state
class BrowserStateManager {
  private static instance: BrowserStateManager;
  private browserState: BrowserState = {
    activeTab: {
      title: 'hello world',
    },
  };

  private constructor() {}

  public static getInstance(): BrowserStateManager {
    if (!BrowserStateManager.instance) {
      BrowserStateManager.instance = new BrowserStateManager();
    }
    return BrowserStateManager.instance;
  }

  public updateState(state: BrowserState): void {
    this.browserState = state;
    console.error('Browser state updated:', JSON.stringify(state, null, 2).substring(0, 200) + '...');
  }

  public getState(): BrowserState {
    return this.browserState;
  }
}

// Export a singleton instance
export const browserState = BrowserStateManager.getInstance();
