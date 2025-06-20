import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  amplifyConfigStore,
  chatHistoryStore,
  Actors,
} from '@extension/storage';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { ProviderTypeEnum } from '@extension/storage';
import { AmplifyEventsService } from './services/amplifyEventsService';
import { instanceIdService } from './services/instanceId';
import { executorConnection } from './services/appSyncEvents/connection';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
let amplifyEventsService: AmplifyEventsService | null = null;
// Map to track which chat sessions correspond to which task IDs
const taskToChatSessionMap = new Map<string, string>();

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

// Function to check if script is already injected
async function isScriptInjected(tabId: number): Promise<boolean> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Object.prototype.hasOwnProperty.call(window, 'buildDomTree'),
    });
    return results[0]?.result || false;
  } catch (err) {
    console.error('Failed to check script injection status:', err);
    return false;
  }
}

// // Function to inject the buildDomTree script
async function injectBuildDomTree(tabId: number) {
  try {
    // Check if already injected
    const alreadyInjected = await isScriptInjected(tabId);
    if (alreadyInjected) {
      console.log('Scripts already injected, skipping...');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['buildDomTree.js'],
    });
    console.log('Scripts successfully injected');
  } catch (err) {
    console.error('Failed to inject scripts:', err);
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTree(tabId);
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      currentExecutor?.cancel();
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
});

// Initialize AmplifyEventsService
let isInitializing = false;
async function initializeAmplifyEvents() {
  if (isInitializing || amplifyEventsService) {
    logger.info('AmplifyEventsService already initialized or initializing');
    return;
  }

  isInitializing = true;
  try {
    logger.info('Initializing AmplifyEventsService...');

    // Initialize instance ID service first
    await instanceIdService.initialize();

    // Initialize executor connection
    executorConnection.initialize(browserContext, setupExecutor, subscribeToExecutorEvents, registerTaskChatSession);

    const config = await amplifyConfigStore.getConfig();
    if (config.enabled) {
      amplifyEventsService = new AmplifyEventsService();
      await amplifyEventsService.initialize();
      logger.info('AmplifyEventsService initialized successfully');
    } else {
      logger.info('AmplifyEventsService is disabled');
    }
  } catch (error) {
    logger.error('Failed to initialize AmplifyEventsService:', error);
  } finally {
    isInitializing = false;
  }
}

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  await initializeAmplifyEvents();
});

chrome.runtime.onInstalled.addListener(async () => {
  await initializeAmplifyEvents();
});

// Initialize immediately when script loads
initializeAmplifyEvents().catch(error => {
  logger.error('Failed to initialize AmplifyEventsService on startup:', error);
});

logger.info('background loaded');

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener(() => {
  // Handle other message types if needed in the future
  // Return false if response is not sent asynchronously
  // return false;
});

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'side-panel-connection') {
    currentPort = port;
    executorConnection.setCurrentPort(port);

    port.onMessage.addListener(async message => {
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: 'No task provided' });
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });

            logger.info('new_task', message.tabId, message.task);
            currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
            executorConnection.setCurrentExecutor(currentExecutor);
            subscribeToExecutorEvents(currentExecutor);

            const result = await currentExecutor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }
          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: 'No follow up task provided' });
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });

            logger.info('follow_up_task', message.tabId, message.task);

            // If executor exists, add follow-up task
            if (currentExecutor) {
              currentExecutor.addFollowUpTask(message.task);
              executorConnection.setCurrentExecutor(currentExecutor);
              // Re-subscribe to events in case the previous subscription was cleaned up
              subscribeToExecutorEvents(currentExecutor);
              const result = await currentExecutor.execute();
              logger.info('follow_up_task execution result', message.tabId, result);
            } else {
              // executor was cleaned up, can not add follow-up task
              logger.info('follow_up_task: executor was cleaned up, can not add follow-up task');
              return port.postMessage({ type: 'error', error: 'Executor was cleaned up, can not add follow-up task' });
            }
            break;
          }

          case 'cancel_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to cancel' });
            await currentExecutor.cancel();
            break;
          }

          case 'resume_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to resume' });
            await currentExecutor.resume();
            return port.postMessage({ type: 'success' });
          }

          case 'pause_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to pause' });
            await currentExecutor.pause();
            return port.postMessage({ type: 'success' });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = browserState.elementTree.clickableElementsToString(
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.info('state', browserState);
              logger.info('interactive elements', elementsText);
              return port.postMessage({ type: 'success', msg: 'State printed to console' });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: 'Failed to get state' });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: 'highlight removed' });
          }

          case 'speech_to_text': {
            try {
              if (!message.audio) {
                return port.postMessage({
                  type: 'speech_to_text_error',
                  error: 'No audio data provided',
                });
              }

              logger.info('Processing speech-to-text request...');

              // Get all providers for speech-to-text service
              const providers = await llmProviderStore.getAllProviders();

              // Create speech-to-text service with all providers
              const speechToTextService = await SpeechToTextService.create(providers);

              // Extract base64 audio data (remove data URL prefix if present)
              let base64Audio = message.audio;
              if (base64Audio.startsWith('data:')) {
                base64Audio = base64Audio.split(',')[1];
              }

              // Transcribe audio
              const transcribedText = await speechToTextService.transcribeAudio(base64Audio);

              logger.info('Speech-to-text completed successfully');
              return port.postMessage({
                type: 'speech_to_text_result',
                text: transcribedText,
              });
            } catch (error) {
              logger.error('Speech-to-text failed:', error);
              return port.postMessage({
                type: 'speech_to_text_error',
                error: error instanceof Error ? error.message : 'Speech recognition failed',
              });
            }
          }

          default:
            return port.postMessage({ type: 'error', error: 'Unknown message type' });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      console.log('Side panel disconnected');
      currentPort = null;
      executorConnection.setCurrentPort(null);
      currentExecutor?.cancel();
    });
  }
});

async function setupExecutor(taskId: string, task: string, browserContext: BrowserContext) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error('Please configure API keys in the settings first');
  }
  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(`Provider ${agentModel.provider} not found in the settings`);
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error('Please choose a model for the navigator in the settings first');
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel);
  }

  let validatorLLM: BaseChatModel | null = null;
  const validatorModel = agentModels[AgentNameEnum.Validator];
  if (validatorModel) {
    // Log the provider config being used for the validator
    const validatorProviderConfig = providers[validatorModel.provider];
    validatorLLM = createChatModel(validatorProviderConfig, validatorModel);
  }

  // Apply firewall settings to browser context
  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
  }

  const generalSettings = await generalSettingsStore.getSettings();
  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000.0,
    displayHighlights: generalSettings.displayHighlights,
  });

  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    validatorLLM: validatorLLM ?? navigatorLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
  });

  return executor;
}

// Function to register task to chat session mapping
function registerTaskChatSession(taskId: string, chatSessionId: string): void {
  taskToChatSessionMap.set(taskId, chatSessionId);
  logger.info('Registered task to chat session mapping:', { taskId, chatSessionId });
}

// Update subscribeToExecutorEvents to use port and handle AppSync responses
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      if (currentPort) {
        currentPort.postMessage(event);
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    // Save message to chat history
    const chatSessionId = taskToChatSessionMap.get(event.data.taskId);
    if (chatSessionId) {
      const isSystemEvent = event.actor === Actors.SYSTEM;
      const isProgressUpdate =
        event.actor === Actors.NAVIGATOR &&
        event.state === ExecutionState.STEP_OK &&
        event.data.details === 'Showing progress...';

      // Don't save initial system start message or progress updates
      const shouldSave = !(
        (isSystemEvent && event.state === ExecutionState.TASK_START) ||
        isProgressUpdate ||
        (event.actor === Actors.PLANNER && event.state === ExecutionState.STEP_START)
      );

      if (shouldSave) {
        try {
          let messageContent: string | unknown = event.data.details;

          // For the final success event, extract the answer string
          if (
            event.actor === Actors.SYSTEM &&
            event.state === ExecutionState.TASK_OK &&
            typeof messageContent === 'object' &&
            messageContent &&
            'answer' in messageContent
          ) {
            messageContent = (messageContent as { answer: string }).answer;
          }

          // Ensure content is always a string before saving
          if (typeof messageContent !== 'string') {
            messageContent = JSON.stringify(messageContent);
          }

          await chatHistoryStore.addMessage(chatSessionId, {
            actor: event.actor,
            content: messageContent as string,
            timestamp: event.timestamp,
          });
        } catch (e) {
          logger.error('Failed to store message in chat history:', e);
        }
      }
    }

    // Handle AppSync completion reporting
    if (amplifyEventsService) {
      if (
        event.state === ExecutionState.TASK_OK ||
        event.state === ExecutionState.TASK_FAIL ||
        event.state === ExecutionState.TASK_CANCEL
      ) {
        // Send completion status to AppSync if service is available
        const success = event.state === ExecutionState.TASK_OK;
        const finalAnswer =
          typeof event.data?.details === 'object' && event.data?.details && 'answer' in event.data.details
            ? (event.data.details as { answer: string }).answer
            : event.data.details;

        const error = success
          ? undefined
          : typeof event.data?.details === 'object' && event.data?.details && 'error' in event.data.details
            ? (event.data.details as { error: string }).error
            : typeof event.data?.details === 'string'
              ? event.data.details
              : 'Task failed without a specific error message.';

        logger.info('Sending task completion to AppSync:', {
          taskId: event.data.taskId,
          success,
          details: finalAnswer,
          error,
        });
        await amplifyEventsService.handleTaskCompletion(event.data.taskId, success, finalAnswer, error);
      }

      // Clean up mapping when task completes
      taskToChatSessionMap.delete(event.data.taskId);

      await currentExecutor?.cleanup();
    }
  });
}
