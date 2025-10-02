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
import { createDemonstrationRecorder, createMemoryBuilder } from './memory';
import type { DemonstrationRecorder, MemoryBuilder } from './memory';
import { proceduralMemoryStore } from '@extension/storage';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
let demonstrationRecorder: DemonstrationRecorder | null = null;
let memoryBuilder: MemoryBuilder | null = null;

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

          // ===== Procedural Memory & Demonstration Recording =====

          case 'start_recording': {
            if (!message.title) {
              return port.postMessage({ type: 'error', error: 'Recording title is required' });
            }

            try {
              // Initialize recorder if not exists
              if (!demonstrationRecorder) {
                demonstrationRecorder = createDemonstrationRecorder(browserContext);
              }

              await demonstrationRecorder.startRecording(message.title, message.description);
              logger.info('Started demonstration recording:', message.title);

              return port.postMessage({
                type: 'recording_started',
                title: message.title,
              });
            } catch (error) {
              logger.error('Failed to start recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to start recording',
              });
            }
          }

          case 'stop_recording': {
            if (!demonstrationRecorder) {
              return port.postMessage({ type: 'error', error: 'No active recording' });
            }

            try {
              const recordingId = await demonstrationRecorder.stopRecording();
              logger.info('Stopped demonstration recording:', recordingId);

              return port.postMessage({
                type: 'recording_stopped',
                recordingId,
              });
            } catch (error) {
              logger.error('Failed to stop recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to stop recording',
              });
            }
          }

          case 'pause_recording': {
            if (!demonstrationRecorder) {
              return port.postMessage({ type: 'error', error: 'No active recording' });
            }

            try {
              demonstrationRecorder.pauseRecording();
              return port.postMessage({ type: 'recording_paused' });
            } catch (error) {
              logger.error('Failed to pause recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to pause recording',
              });
            }
          }

          case 'resume_recording': {
            if (!demonstrationRecorder) {
              return port.postMessage({ type: 'error', error: 'No active recording' });
            }

            try {
              demonstrationRecorder.resumeRecording();
              return port.postMessage({ type: 'recording_resumed' });
            } catch (error) {
              logger.error('Failed to resume recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to resume recording',
              });
            }
          }

          case 'build_memory': {
            if (!message.recordingId) {
              return port.postMessage({ type: 'error', error: 'Recording ID is required' });
            }

            try {
              // Initialize memory builder if not exists
              if (!memoryBuilder) {
                // Get LLM for abstract generation (reuse navigator LLM)
                const providers = await llmProviderStore.getAllProviders();
                const agentModels = await agentModelStore.getAllAgentModels();
                const navigatorModel = agentModels[AgentNameEnum.Navigator];

                if (navigatorModel && providers[navigatorModel.provider]) {
                  const llm = createChatModel(providers[navigatorModel.provider], navigatorModel);
                  memoryBuilder = createMemoryBuilder(llm);
                } else {
                  memoryBuilder = createMemoryBuilder(); // Without LLM
                }
              }

              const result = await memoryBuilder.buildFromRecording({
                recordingId: message.recordingId,
                title: message.title,
                tags: message.tags,
                useLLM: message.useLLM ?? true,
              });

              logger.info('Built procedural memory:', result.memory.id);

              return port.postMessage({
                type: 'memory_built',
                memoryId: result.memory.id,
                warnings: result.warnings,
              });
            } catch (error) {
              logger.error('Failed to build memory:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to build memory',
              });
            }
          }

          case 'get_recordings': {
            try {
              const recordings = await proceduralMemoryStore.getAllRecordings();
              return port.postMessage({
                type: 'recordings_list',
                recordings,
              });
            } catch (error) {
              logger.error('Failed to get recordings:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to get recordings',
              });
            }
          }

          case 'get_memories': {
            try {
              const memories = await proceduralMemoryStore.getMemoriesMetadata();
              return port.postMessage({
                type: 'memories_list',
                memories,
              });
            } catch (error) {
              logger.error('Failed to get memories:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to get memories',
              });
            }
          }

          case 'delete_recording': {
            if (!message.recordingId) {
              return port.postMessage({ type: 'error', error: 'Recording ID is required' });
            }

            try {
              await proceduralMemoryStore.deleteRecording(message.recordingId);
              return port.postMessage({ type: 'recording_deleted', recordingId: message.recordingId });
            } catch (error) {
              logger.error('Failed to delete recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to delete recording',
              });
            }
          }

          case 'delete_memory': {
            if (!message.memoryId) {
              return port.postMessage({ type: 'error', error: 'Memory ID is required' });
            }

            try {
              await proceduralMemoryStore.deleteMemory(message.memoryId);
              return port.postMessage({ type: 'memory_deleted', memoryId: message.memoryId });
            } catch (error) {
              logger.error('Failed to delete memory:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to delete memory',
              });
            }
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

// Update subscribeToExecutorEvents to use port
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

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      await currentExecutor?.cleanup();
    }
  });
}
