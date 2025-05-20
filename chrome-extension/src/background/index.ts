import {
  agentModelStore,
  firewallStore,
  AgentNameEnum,
  generalSettingsStore,
  llmProviderStore,
} from '@extension/storage';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import 'webextension-polyfill';
import { ExecutionState } from './agent/event/types';
import { Executor } from './agent/executor';
import { createChatModel } from './agent/helper';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import BrowserContext from './browser/context';
import { createLogger } from './log';
import { McpHostManager, McpHostOptions } from './mcp/host-manager';
import { NavigateToHandler, RunTaskHandler } from './task';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;

// Initialize MCP Host Manager
const mcpHostManager = new McpHostManager();

// Create handler instances with required dependencies
const runTaskHandler = new RunTaskHandler(browserContext, setupExecutor);
const navigateToHandler = new NavigateToHandler(browserContext);

// Register RPC method handlers
mcpHostManager.registerRpcMethod('run_task', runTaskHandler.handleRunTask.bind(runTaskHandler));
mcpHostManager.registerRpcMethod('navigate_to', navigateToHandler.handleNavigateTo.bind(navigateToHandler));

// No longer open side panel on action click, now using popup instead
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

logger.info('background loaded');

// Listen for simple messages (e.g., from options page or popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle MCP Host related messages
  if (message.type === 'startMcpHost') {
    // Start MCP Host process with provided options
    logger.info('Received request to start MCP Host:', message.options);

    // Use Promise-based connect method
    mcpHostManager
      .connect()
      .then(success => {
        logger.info('MCP Host connection successful:', success);
        sendResponse({ success });
      })
      .catch(error => {
        // Check if this is our structured error or a regular error
        if (error && typeof error === 'object' && 'code' in error) {
          // This is our structured McpError
          logger.error(`Failed to connect to MCP Host: [${error.code}] ${error.message}`);

          // Log additional context based on error code
          if (error.code === 'MCP_HOST_NOT_FOUND') {
            logger.error('This error indicates the MCP Host is not installed or registered correctly.');
            logger.error('Make sure the native messaging host manifest is properly installed.');
          }

          // Send the structured error back to the UI
          sendResponse({
            success: false,
            error: error, // Pass the entire error object
          });
        } else {
          // Handle legacy or unexpected errors
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('Failed to connect to MCP Host:', errorMessage);

          // Send the error back to the UI
          sendResponse({
            success: false,
            error: {
              code: 'MCP_UNKNOWN_ERROR',
              message: errorMessage,
            },
          });
        }

        // Log last error from Chrome runtime for debugging
        if (chrome.runtime.lastError) {
          logger.error('Chrome runtime last error:', chrome.runtime.lastError);
        }
      });

    return true; // Indicate async response
  }

  if (message.type === 'stopMcpHost') {
    // Stop MCP Host process
    logger.info('Received request to stop MCP Host');

    try {
      // First call stopMcpHost which attempts graceful shutdown
      mcpHostManager
        .stopMcpHost()
        .then(success => {
          logger.info('MCP Host stop attempt result:', success);
          // Also disconnect the native connection to ensure the host is killed
          mcpHostManager.disconnect();
          logger.info('Native connection disconnected');
          sendResponse({ success: true });
        })
        .catch(error => {
          logger.error('Failed to stop MCP Host gracefully, forcing disconnect:', error);
          // Even if graceful shutdown fails, force disconnect
          mcpHostManager.disconnect();
          logger.info('Native connection forcefully disconnected');
          sendResponse({ success: true });
        });
    } catch (error) {
      logger.error('Error initiating MCP Host stop:', error);
      // Try to disconnect even if there was an error initiating the stop
      try {
        mcpHostManager.disconnect();
        logger.info('Native connection forcefully disconnected after error');
        sendResponse({ success: true });
      } catch (disconnectError) {
        logger.error('Failed to disconnect:', disconnectError);
        sendResponse({ success: false, error: String(error) });
      }
    }

    return true; // Indicate async response
  }

  if (message.type === 'getMcpHostStatus') {
    // Return current MCP Host status
    const status = mcpHostManager.getStatus();
    logger.info('Returning MCP Host status:', status);
    sendResponse({ status });
    return false; // Synchronous response
  }

  // Handle other message types if needed in the future
  return false; // Synchronous response for unhandled messages
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
            if (!message.task) return port.postMessage({ type: 'error', error: 'No task provided' });
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });

            logger.info('new_task', message.tabId, message.task);
            currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
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
