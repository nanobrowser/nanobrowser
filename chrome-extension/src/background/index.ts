import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  analyticsSettingsStore,
} from '@extension/storage';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { injectBuildDomTreeScripts } from './browser/dom/service';
import { analytics } from './services/analytics';
import {
  webSocketService,
  ServiceEvent,
  WebSocketMessageInterpreter,
  isExecuteTaskMessage,
  isPingMessage,
} from './services/websocket';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTreeScripts(tabId);
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

logger.info('background loaded');

// Initialize analytics
analytics.init().catch(error => {
  logger.error('Failed to initialize analytics:', error);
});

// Listen for analytics settings changes
analyticsSettingsStore.subscribe(() => {
  analytics.updateSettings().catch(error => {
    logger.error('Failed to update analytics settings:', error);
  });
});

// Initialize WebSocket service
webSocketService.initialize().catch(error => {
  logger.error('Failed to initialize WebSocket service:', error);
  // Continue operation even if WebSocket fails - core extension functionality should not be affected
});

// Setup WebSocket event listeners with error boundaries
webSocketService.addEventListener(ServiceEvent.MESSAGE_RECEIVED, async event => {
  try {
    if (!event.message) {
      logger.warning('Received MESSAGE_RECEIVED event with no message');
      return;
    }

    logger.debug('Processing WebSocket message:', event.message.type);

    // Handle different message types
    if (isExecuteTaskMessage(event.message)) {
      await handleWebSocketTaskExecution(event.message);
    } else if (isPingMessage(event.message)) {
      // Respond to ping with pong
      try {
        const pongMessage = WebSocketMessageInterpreter.createPong();
        webSocketService.sendMessage(pongMessage);
        logger.debug('Pong sent in response to ping');
      } catch (pongError) {
        logger.error('Failed to send pong response:', pongError);
        // Don't throw - pong failure should not crash the extension
      }
    }
  } catch (error) {
    logger.error('Error handling WebSocket message:', error);
    // Log but don't throw - continue processing other messages
  }
});

webSocketService.addEventListener(ServiceEvent.CONNECTION_CHANGE, event => {
  try {
    logger.info('WebSocket connection state changed:', event.state);
  } catch (error) {
    logger.error('Error handling connection state change:', error);
  }
});

webSocketService.addEventListener(ServiceEvent.ERROR, event => {
  try {
    if (event.error) {
      logger.error('WebSocket error:', event.error);
    }
  } catch (error) {
    // Double error - log to console directly to avoid infinite loop
    console.error('Error in WebSocket error handler:', error);
  }
});

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

    port.onMessage.addListener(async message => {
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_newTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('new_task', message.tabId, message.task);
            currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
            subscribeToExecutorEvents(currentExecutor);

            const result = await currentExecutor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }

          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('follow_up_task', message.tabId, message.task);

            // If executor exists, add follow-up task
            if (currentExecutor) {
              currentExecutor.addFollowUpTask(message.task);
              // Re-subscribe to events in case the previous subscription was cleaned up
              subscribeToExecutorEvents(currentExecutor);
              const result = await currentExecutor.execute();
              logger.info('follow_up_task execution result', message.tabId, result);
            } else {
              // executor was cleaned up, can not add follow-up task
              logger.info('follow_up_task: executor was cleaned up, can not add follow-up task');
              return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_cleaned') });
            }
            break;
          }

          case 'cancel_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.cancel();
            break;
          }

          case 'resume_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_cmd_resumeTask_noTask') });
            await currentExecutor.resume();
            return port.postMessage({ type: 'success' });
          }

          case 'pause_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.pause();
            return port.postMessage({ type: 'success' });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
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
              return port.postMessage({ type: 'success', msg: t('bg_cmd_state_printed') });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: t('bg_cmd_state_failed') });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
          }

          case 'speech_to_text': {
            try {
              if (!message.audio) {
                return port.postMessage({
                  type: 'speech_to_text_error',
                  error: t('bg_cmd_stt_noAudioData'),
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
                error: error instanceof Error ? error.message : t('bg_cmd_stt_failed'),
              });
            }
          }

          case 'replay': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.taskId) return port.postMessage({ type: 'error', error: t('bg_errors_noTaskId') });
            if (!message.historySessionId)
              return port.postMessage({ type: 'error', error: t('bg_cmd_replay_noHistory') });
            logger.info('replay', message.tabId, message.taskId, message.historySessionId);

            try {
              // Switch to the specified tab
              await browserContext.switchTab(message.tabId);
              // Setup executor with the new taskId and a dummy task description
              currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
              subscribeToExecutorEvents(currentExecutor);

              // Run replayHistory with the history session ID
              const result = await currentExecutor.replayHistory(message.historySessionId);
              logger.debug('replay execution result', message.tabId, result);
            } catch (error) {
              logger.error('Replay failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : t('bg_cmd_replay_failed'),
              });
            }
            break;
          }

          default:
            return port.postMessage({ type: 'error', error: t('errors_cmd_unknown', [message.type]) });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      console.log('Side panel disconnected');
      currentPort = null;
      currentExecutor?.cancel();
    });
  }
});

async function setupExecutor(taskId: string, task: string, browserContext: BrowserContext) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error(t('bg_setup_noApiKeys'));
  }

  // Clean up any legacy validator settings for backward compatibility
  await agentModelStore.cleanupLegacyValidatorSettings();

  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error(t('bg_setup_noNavigatorModel'));
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
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
    generalSettings: generalSettings,
  });

  return executor;
}

// Update subscribeToExecutorEvents to use port and WebSocket
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      // Send to side panel if connected
      if (currentPort) {
        currentPort.postMessage(event);
      }

      // Send to WebSocket if connected (with error boundary)
      try {
        if (webSocketService.isConnected()) {
          const taskId = await executor.getCurrentTaskId();
          const eventMessage = WebSocketMessageInterpreter.createExecutionEvent(taskId, event);
          webSocketService.sendMessage(eventMessage);
          logger.debug('Execution event sent to WebSocket:', event.state);
        }
      } catch (error) {
        logger.error('Failed to send event to WebSocket:', error);
        // Don't throw - WebSocket failure should not stop side panel updates
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      try {
        await executor.cleanup();
      } catch (error) {
        logger.error('Failed to cleanup executor on final state:', error);
      } finally {
        if (currentExecutor === executor) {
          currentExecutor = null;
        }
      }
    }
  });
}

/**
 * Handle incoming task execution requests from WebSocket server.
 * Wrapped in error boundaries to prevent WebSocket issues from crashing the extension.
 */
async function handleWebSocketTaskExecution(message: { taskId: string; prompt: string; metadata?: unknown }) {
  logger.info('WebSocket task execution requested', {
    taskId: message.taskId,
    promptLength: message.prompt?.length,
    hasMetadata: !!message.metadata,
  });

  try {
    // Validate message
    if (!message.taskId || typeof message.taskId !== 'string') {
      throw new Error('Invalid taskId: must be a non-empty string');
    }

    if (!message.prompt || typeof message.prompt !== 'string') {
      throw new Error('Invalid prompt: must be a non-empty string');
    }

    // Check if a task is already running
    if (currentExecutor) {
      try {
        const currentTaskId = await currentExecutor.getCurrentTaskId();
        logger.warning('Task execution rejected: already executing task', currentTaskId);

        const rejectionMessage = WebSocketMessageInterpreter.createTaskRejected(
          message.taskId,
          'Already executing a task',
        );
        webSocketService.sendMessage(rejectionMessage);
      } catch (rejectionError) {
        logger.error('Failed to send rejection message for concurrent task:', rejectionError);
      }
      return;
    }

    // Send task accepted response
    try {
      const acceptedMessage = WebSocketMessageInterpreter.createTaskAccepted(message.taskId);
      webSocketService.sendMessage(acceptedMessage);
      logger.debug('Task accepted message sent');
    } catch (acceptError) {
      logger.error('Failed to send task accepted message:', acceptError);
      // Continue anyway - task can still be executed
    }

    // Get the current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab?.id) {
      throw new Error('No active tab found');
    }

    logger.debug('Switching to active tab:', activeTab.id);
    // Switch to the active tab
    await browserContext.switchTab(activeTab.id);

    // Setup and execute the task
    logger.debug('Setting up executor for task:', message.taskId);
    currentExecutor = await setupExecutor(message.taskId, message.prompt, browserContext);
    subscribeToExecutorEvents(currentExecutor);

    logger.info('Executing task:', message.taskId);
    await currentExecutor.execute();
    logger.info('WebSocket task execution completed', {
      taskId: message.taskId,
    });
    // Ensure the executor is cleared after completion to accept new tasks
    try {
      await currentExecutor?.cleanup();
    } catch (cleanupError) {
      logger.error('Cleanup after WebSocket task completion failed:', cleanupError);
    } finally {
      currentExecutor = null;
    }
  } catch (error) {
    logger.error('WebSocket task execution failed:', error);

    // Send rejection message
    try {
      const rejectionMessage = WebSocketMessageInterpreter.createTaskRejected(
        message.taskId,
        error instanceof Error ? error.message : 'Task execution failed',
      );
      webSocketService.sendMessage(rejectionMessage);
      logger.debug('Task rejection message sent');
    } catch (sendError) {
      logger.error('Failed to send rejection message:', sendError);
      // Last resort - log to console
      console.error('Critical: Unable to notify WebSocket server of task failure');
    }
  }
}
