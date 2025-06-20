import { Executor } from '../../agent/executor';
import BrowserContext from '../../browser/context';
import { ActionHandlerResult } from './types';

/**
 * Interface for connecting AppSync handlers with the background script's executor system
 */
export interface ExecutorConnection {
  getCurrentExecutor(): Executor | null;
  setCurrentExecutor(executor: Executor | null): void;
  setupExecutor(taskId: string, task: string, browserContext: BrowserContext): Promise<Executor>;
  subscribeToExecutorEvents(executor: Executor): void;
  getBrowserContext(): BrowserContext;
  getCurrentPort(): chrome.runtime.Port | null;
  registerTaskChatSession(taskId: string, chatSessionId: string): void;
}

/**
 * Singleton class to manage the connection between AppSync handlers and the background script
 */
class ExecutorConnectionImpl implements ExecutorConnection {
  private currentExecutor: Executor | null = null;
  private currentPort: chrome.runtime.Port | null = null;
  private browserContext: BrowserContext | null = null;
  private setupExecutorFn:
    | ((taskId: string, task: string, browserContext: BrowserContext) => Promise<Executor>)
    | null = null;
  private subscribeToExecutorEventsFn: ((executor: Executor) => void) | null = null;
  private registerTaskChatSessionFn: ((taskId: string, chatSessionId: string) => void) | null = null;

  /**
   * Initialize the connection with references to background script functions
   */
  initialize(
    browserContext: BrowserContext,
    setupExecutorFn: (taskId: string, task: string, browserContext: BrowserContext) => Promise<Executor>,
    subscribeToExecutorEventsFn: (executor: Executor) => void,
    registerTaskChatSessionFn?: (taskId: string, chatSessionId: string) => void,
  ): void {
    this.browserContext = browserContext;
    this.setupExecutorFn = setupExecutorFn;
    this.subscribeToExecutorEventsFn = subscribeToExecutorEventsFn;
    this.registerTaskChatSessionFn = registerTaskChatSessionFn || null;
  }

  /**
   * Update the current executor reference
   */
  setCurrentExecutor(executor: Executor | null): void {
    this.currentExecutor = executor;
  }

  /**
   * Update the current port reference
   */
  setCurrentPort(port: chrome.runtime.Port | null): void {
    this.currentPort = port;
  }

  /**
   * Get the current executor
   */
  getCurrentExecutor(): Executor | null {
    return this.currentExecutor;
  }

  /**
   * Get the current port
   */
  getCurrentPort(): chrome.runtime.Port | null {
    return this.currentPort;
  }

  /**
   * Setup a new executor
   */
  async setupExecutor(taskId: string, task: string, browserContext: BrowserContext): Promise<Executor> {
    if (!this.setupExecutorFn) {
      throw new Error('ExecutorConnection not initialized');
    }

    const executor = await this.setupExecutorFn(taskId, task, browserContext);
    this.setCurrentExecutor(executor);
    return executor;
  }

  /**
   * Subscribe to executor events
   */
  subscribeToExecutorEvents(executor: Executor): void {
    if (!this.subscribeToExecutorEventsFn) {
      throw new Error('ExecutorConnection not initialized');
    }

    this.subscribeToExecutorEventsFn(executor);
  }

  /**
   * Get the browser context
   */
  getBrowserContext(): BrowserContext {
    if (!this.browserContext) {
      throw new Error('BrowserContext not initialized');
    }

    return this.browserContext;
  }

  /**
   * Register task to chat session mapping
   */
  registerTaskChatSession(taskId: string, chatSessionId: string): void {
    if (this.registerTaskChatSessionFn) {
      this.registerTaskChatSessionFn(taskId, chatSessionId);
    }
  }

  /**
   * Check if the connection is initialized
   */
  isInitialized(): boolean {
    return !!(this.browserContext && this.setupExecutorFn && this.subscribeToExecutorEventsFn);
  }
}

// Export singleton instance
export const executorConnection = new ExecutorConnectionImpl();
