/**
 * Demonstration Recorder - Captures human actions in the browser for building procedural memory
 * Implements the "recording" part of the BUILD phase in MEMP framework
 */

import { createLogger } from '../log';
import type BrowserContext from '../browser/context';
import { proceduralMemoryStore } from '@extension/storage';
import type {
  RecordedStep,
  RecorderConfig,
  RecorderStatus,
  RecordingEventCallback,
  RecordingEvent,
  DemonstrationRecorder,
} from './types';
import type { DOMElementNode } from '../browser/dom/views';

const logger = createLogger('DemonstrationRecorder');

const DEFAULT_CONFIG: Required<RecorderConfig> = {
  highlightElements: true,
  captureScreenshots: false,
  minStepInterval: 500, // 500ms minimum between steps
};

/**
 * Implements recording of human demonstrations in the browser
 */
export class DemonstrationRecorderImpl implements DemonstrationRecorder {
  private status: RecorderStatus = 'idle';
  private browserContext: BrowserContext;
  private config: Required<RecorderConfig>;
  private recordedSteps: RecordedStep[] = [];
  private currentTitle: string = '';
  private currentDescription?: string;
  private startTimestamp: number = 0;
  private lastStepTimestamp: number = 0;
  private listeners: RecordingEventCallback[] = [];

  // Chrome event listeners that we'll attach
  private chromeListeners: {
    onClicked?: (info: chrome.action.UserSettings) => void;
    onUpdated?: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
    onActivated?: (activeInfo: chrome.tabs.TabActiveInfo) => void;
    onMessage?: (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => void;
  } = {};

  constructor(browserContext: BrowserContext, config?: Partial<RecorderConfig>) {
    this.browserContext = browserContext;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async startRecording(title: string, description?: string): Promise<void> {
    if (this.status === 'recording') {
      logger.warning('Already recording, stopping previous recording first');
      await this.stopRecording();
    }

    logger.info(`Starting demonstration recording: ${title}`);
    this.status = 'recording';
    this.currentTitle = title;
    this.currentDescription = description;
    this.recordedSteps = [];
    this.startTimestamp = Date.now();
    this.lastStepTimestamp = this.startTimestamp;

    // Attach browser event listeners
    this.attachEventListeners();

    // Inject recording listener into all tabs
    await this.injectRecordingListener();

    this.emitEvent({ type: 'recording_started', data: { title, description } });
  }

  async stopRecording(): Promise<string> {
    if (this.status === 'idle') {
      throw new Error('Not currently recording');
    }

    logger.info(`Stopping demonstration recording: ${this.currentTitle}`);
    this.status = 'processing';

    // Stop recording in all tabs
    await this.stopRecordingInTabs();

    // Detach event listeners
    this.detachEventListeners();

    // Save recording to storage
    const recording = await proceduralMemoryStore.createRecording({
      title: this.currentTitle,
      description: this.currentDescription,
      steps: this.recordedSteps,
      completedAt: Date.now(),
    });

    logger.info(`Recording saved with ID: ${recording.id}, ${this.recordedSteps.length} steps`);

    this.emitEvent({ type: 'recording_stopped', data: { recordingId: recording.id } });

    // Reset state
    this.status = 'idle';
    this.recordedSteps = [];
    this.currentTitle = '';
    this.currentDescription = undefined;

    return recording.id;
  }

  pauseRecording(): void {
    if (this.status !== 'recording') {
      throw new Error('Not currently recording');
    }

    logger.info('Pausing recording');
    this.status = 'paused';
    this.emitEvent({ type: 'recording_paused' });
  }

  resumeRecording(): void {
    if (this.status !== 'paused') {
      throw new Error('Recording is not paused');
    }

    logger.info('Resuming recording');
    this.status = 'recording';
    this.emitEvent({ type: 'recording_resumed' });
  }

  getStatus(): RecorderStatus {
    return this.status;
  }

  getRecordedSteps(): RecordedStep[] {
    return [...this.recordedSteps];
  }

  subscribe(callback: RecordingEventCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  cleanup(): void {
    this.detachEventListeners();
    this.listeners = [];
  }

  /**
   * Record a step in the demonstration
   */
  private async recordStep(
    action: string,
    parameters: Record<string, unknown>,
    description: string,
    element?: DOMElementNode,
  ): Promise<void> {
    // Check if enough time has passed since last step
    const now = Date.now();
    if (now - this.lastStepTimestamp < this.config.minStepInterval) {
      logger.debug('Skipping step due to minStepInterval');
      return;
    }

    if (this.status !== 'recording') {
      return;
    }

    try {
      // Get current page state
      const state = await this.browserContext.getCachedState();

      const step: RecordedStep = {
        action,
        parameters,
        description,
        url: state.url,
        pageTitle: state.title,
        timestamp: now,
      };

      // Add element information if provided
      if (element) {
        step.element = {
          tagName: element.tagName || '',
          xpath: element.xpath || '',
          attributes: element.attributes,
          textContent: this.getElementTextContent(element),
          highlightIndex: element.highlightIndex ?? undefined,
        };
        step.elementNode = element;
      }

      // Capture screenshot if enabled
      if (this.config.captureScreenshots) {
        const page = await this.browserContext.getCurrentPage();
        if (page) {
          const screenshot = await page.takeScreenshot();
          if (screenshot) {
            step.screenshot = screenshot;
          }
        }
      }

      this.recordedSteps.push(step);
      this.lastStepTimestamp = now;

      logger.debug(`Recorded step ${this.recordedSteps.length}: ${action}`, parameters);
      this.emitEvent({ type: 'step_recorded', data: step });
    } catch (error) {
      logger.error('Failed to record step:', error);
    }
  }

  /**
   * Attach Chrome API event listeners to capture browser interactions
   */
  private attachEventListeners(): void {
    // Listen for tab navigation
    this.chromeListeners.onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        void this.recordStep('go_to_url', { url: tab.url }, `Navigated to ${tab.title || tab.url}`);
        // Re-inject recording listener when page loads
        if (this.status === 'recording') {
          void this.injectRecordingListenerInTab(tabId);
        }
      }
    };
    chrome.tabs.onUpdated.addListener(this.chromeListeners.onUpdated);

    // Listen for tab switches
    this.chromeListeners.onActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      void chrome.tabs.get(activeInfo.tabId, tab => {
        if (tab.url) {
          void this.recordStep('switch_tab', { tab_id: activeInfo.tabId }, `Switched to tab: ${tab.title || tab.url}`);
        }
      });
    };
    chrome.tabs.onActivated.addListener(this.chromeListeners.onActivated);

    // Listen for messages from content scripts
    this.chromeListeners.onMessage = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const msg = message as { type: string; data?: unknown };

      if (msg.type === 'recording_interaction') {
        // Handle interaction from content script
        void this.handleContentScriptInteraction(msg.data);
        sendResponse({ success: true });
      } else if (msg.type === 'recording_listener_ready') {
        // Content script loaded, start recording
        if (this.status === 'recording' && sender.tab?.id) {
          void chrome.tabs.sendMessage(sender.tab.id, { type: 'start_recording_listener' });
        }
        sendResponse({ success: true });
      }
    };
    chrome.runtime.onMessage.addListener(this.chromeListeners.onMessage);

    logger.info('Event listeners attached');
  }

  /**
   * Detach event listeners
   */
  private detachEventListeners(): void {
    if (this.chromeListeners.onUpdated) {
      chrome.tabs.onUpdated.removeListener(this.chromeListeners.onUpdated);
    }
    if (this.chromeListeners.onActivated) {
      chrome.tabs.onActivated.removeListener(this.chromeListeners.onActivated);
    }
    if (this.chromeListeners.onMessage) {
      chrome.runtime.onMessage.removeListener(this.chromeListeners.onMessage);
    }
    this.chromeListeners = {};
    logger.info('Event listeners detached');
  }

  /**
   * Get text content from DOM element
   */
  private getElementTextContent(element: DOMElementNode): string {
    // Get text from attributes
    const textFromAttrs =
      element.attributes['aria-label'] ||
      element.attributes['placeholder'] ||
      element.attributes['title'] ||
      element.attributes['alt'] ||
      '';

    // Get text from children
    let textFromChildren = '';
    if (element.children && element.children.length > 0) {
      for (const child of element.children) {
        if ('text' in child && typeof child.text === 'string') {
          textFromChildren += child.text + ' ';
        }
      }
    }

    const fullText = (textFromAttrs + ' ' + textFromChildren).trim();
    return fullText.slice(0, 200); // Limit length
  }

  /**
   * Emit event to all subscribers
   */
  private emitEvent(event: RecordingEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('Error in event listener:', error);
      }
    }
  }

  /**
   * Public method to manually record a DOM interaction
   * This should be called from agent actions or content scripts
   */
  async recordDOMInteraction(
    action: string,
    parameters: Record<string, unknown>,
    description: string,
    element?: DOMElementNode,
  ): Promise<void> {
    await this.recordStep(action, parameters, description, element);
  }

  /**
   * Inject recording listener script into a specific tab
   */
  private async injectRecordingListenerInTab(tabId: number): Promise<void> {
    try {
      // Check if tab is valid
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        // Can't inject into chrome:// or extension pages
        return;
      }

      // Inject the recording listener script
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['recordingListener.js'],
      });

      logger.debug(`Injected recording listener into tab ${tabId}`);
    } catch (error) {
      logger.error(`Failed to inject recording listener into tab ${tabId}:`, error);
    }
  }

  /**
   * Inject recording listener into all open tabs
   */
  private async injectRecordingListener(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({});

      for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          await this.injectRecordingListenerInTab(tab.id);
        }
      }

      logger.info('Recording listener injected into all tabs');
    } catch (error) {
      logger.error('Failed to inject recording listener:', error);
    }
  }

  /**
   * Stop recording in all tabs
   */
  private async stopRecordingInTabs(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({});

      for (const tab of tabs) {
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, { type: 'stop_recording_listener' });
          } catch (error) {
            // Ignore errors for tabs where the script wasn't injected
          }
        }
      }

      logger.info('Stopped recording in all tabs');
    } catch (error) {
      logger.error('Failed to stop recording in tabs:', error);
    }
  }

  /**
   * Handle interaction event from content script
   */
  private async handleContentScriptInteraction(data: unknown): Promise<void> {
    if (this.status !== 'recording') {
      return;
    }

    const interaction = data as {
      action: string;
      parameters: Record<string, unknown>;
      description: string;
      element?: {
        tagName: string;
        xpath: string;
        attributes: Record<string, string>;
        textContent?: string;
      };
      url: string;
      pageTitle: string;
      timestamp: number;
    };

    // Check if enough time has passed since last step
    const now = interaction.timestamp;
    if (now - this.lastStepTimestamp < this.config.minStepInterval) {
      logger.debug('Skipping content script interaction due to minStepInterval');
      return;
    }

    try {
      const step: RecordedStep = {
        action: interaction.action,
        parameters: interaction.parameters,
        description: interaction.description,
        url: interaction.url,
        pageTitle: interaction.pageTitle,
        timestamp: now,
      };

      if (interaction.element) {
        step.element = interaction.element;
      }

      this.recordedSteps.push(step);
      this.lastStepTimestamp = now;

      logger.debug(
        `Recorded content script step ${this.recordedSteps.length}: ${interaction.action}`,
        interaction.parameters,
      );
      this.emitEvent({ type: 'step_recorded', data: step });
    } catch (error) {
      logger.error('Failed to handle content script interaction:', error);
    }
  }
}

/**
 * Create a demonstration recorder instance
 */
export function createDemonstrationRecorder(
  browserContext: BrowserContext,
  config?: Partial<RecorderConfig>,
): DemonstrationRecorder {
  return new DemonstrationRecorderImpl(browserContext, config);
}
