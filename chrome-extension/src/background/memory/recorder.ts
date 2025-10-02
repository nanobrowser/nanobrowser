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

    this.emitEvent({ type: 'recording_started', data: { title, description } });
  }

  async stopRecording(): Promise<string> {
    if (this.status === 'idle') {
      throw new Error('Not currently recording');
    }

    logger.info(`Stopping demonstration recording: ${this.currentTitle}`);
    this.status = 'processing';

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
    // Note: We'll need to use Chrome's debugger API or content scripts to capture actual DOM interactions
    // For now, we'll capture high-level browser events

    // Listen for tab navigation
    this.chromeListeners.onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        void this.recordStep('go_to_url', { url: tab.url }, `Navigated to ${tab.title || tab.url}`);
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
