import { AppSyncEventPayload, ActionHandlerResult, AppSyncActionType, EventValidationResult } from './types';
import { agentModelStore, chatHistoryStore } from '@extension/storage';
import { Actors } from '@extension/storage';
import { createLogger } from '../../log';
import { executorConnection } from './connection';

const logger = createLogger('AppSyncHandlers');

/**
 * Validates an incoming AppSync event payload
 */
export function validateEventPayload(event: AppSyncEventPayload): EventValidationResult {
  const errors: string[] = [];

  // Basic required fields
  if (!event.eventId) {
    errors.push('Missing eventId');
  }
  if (!event.instanceId) {
    errors.push('Missing instanceId');
  }
  if (!event.actionType) {
    errors.push('Missing actionType');
  }
  if (!event.timestamp) {
    errors.push('Missing timestamp');
  }

  // Validate action type
  if (!Object.values(AppSyncActionType).includes(event.actionType)) {
    errors.push(`Invalid actionType: ${event.actionType}`);
  }

  // Action-specific validation
  switch (event.actionType) {
    case AppSyncActionType.NEW_SESSION:
      if (!event.message) {
        errors.push('NEW_SESSION requires message');
      }
      break;

    case AppSyncActionType.SEND_CHAT:
      if (!event.sessionId) {
        errors.push('SEND_CHAT requires sessionId');
      }
      if (!event.message) {
        errors.push('SEND_CHAT requires message');
      }
      break;

    case AppSyncActionType.STOP_CHAT:
      if (!event.sessionId) {
        errors.push('STOP_CHAT requires sessionId');
      }
      break;

    case AppSyncActionType.FOLLOW_UP_CHAT:
      if (!event.sessionId) {
        errors.push('FOLLOW_UP_CHAT requires sessionId');
      }
      if (!event.message) {
        errors.push('FOLLOW_UP_CHAT requires message');
      }
      break;

    case AppSyncActionType.SET_MODEL:
      if (!event.modelConfig) {
        errors.push('SET_MODEL requires modelConfig');
      } else {
        if (!event.modelConfig.agent) {
          errors.push('SET_MODEL requires modelConfig.agent');
        }
        if (!event.modelConfig.provider) {
          errors.push('SET_MODEL requires modelConfig.provider');
        }
        if (!event.modelConfig.model) {
          errors.push('SET_MODEL requires modelConfig.model');
        }
      }
      break;
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Handler for NEW_SESSION action
 * Creates a new task session with the provided message
 */
export async function handleNewSession(event: AppSyncEventPayload): Promise<ActionHandlerResult> {
  logger.info('Handling NEW_SESSION action', { eventId: event.eventId, message: event.message });

  const taskId = event.taskId || generateTaskId();
  const message = event.message!;

  try {
    if (!executorConnection.isInitialized()) {
      throw new Error('Executor connection not initialized');
    }

    // Create a new chat session for this task
    const chatSession = await chatHistoryStore.createSession(`Task: ${message.substring(0, 50)}...`);
    if (!chatSession) {
      throw new Error('Failed to create chat session');
    }

    await chatHistoryStore.addMessage(chatSession.id, {
      actor: Actors.USER,
      content: message,
      timestamp: Date.now(),
    });

    logger.info('Created chat session:', chatSession.id);

    // Register the task to chat session mapping
    executorConnection.registerTaskChatSession(taskId, chatSession.id);

    // Notify the sidebar to open this chat session
    const currentPort = executorConnection.getCurrentPort();
    if (currentPort) {
      currentPort.postMessage({
        type: 'appsync_session_created',
        chatSessionId: chatSession.id,
        taskId: taskId,
      });
      logger.info('Sent appsync_session_created message to sidebar:', { chatSessionId: chatSession.id, taskId });
    } else {
      logger.info('No active port connection to sidebar when trying to notify session creation');
    }

    const browserContext = executorConnection.getBrowserContext();
    const executor = await executorConnection.setupExecutor(taskId, message, browserContext);
    executorConnection.subscribeToExecutorEvents(executor);

    // Start execution in background
    executor.execute().catch(error => {
      logger.error('Task execution failed:', error);
    });

    return {
      sessionId: taskId,
      taskId,
      chatSessionId: chatSession.id,
      status: 'started',
      message: 'New session created and task started',
    };
  } catch (error) {
    logger.error('Failed to handle NEW_SESSION:', error);
    throw new Error(`Failed to create new session: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handler for SEND_CHAT action
 * Sends a new chat message to an existing session
 */
export async function handleSendChat(event: AppSyncEventPayload): Promise<ActionHandlerResult> {
  logger.info('Handling SEND_CHAT action', { eventId: event.eventId, sessionId: event.sessionId });

  const { sessionId, message } = event;

  try {
    if (!executorConnection.isInitialized()) {
      throw new Error('Executor connection not initialized');
    }

    const browserContext = executorConnection.getBrowserContext();
    const taskId = sessionId!;
    const executor = await executorConnection.setupExecutor(taskId, message!, browserContext);
    executorConnection.subscribeToExecutorEvents(executor);

    const result = await executor.execute();

    return {
      sessionId,
      taskId,
      status: 'completed',
      result,
      message: 'Chat message sent successfully',
    };
  } catch (error) {
    logger.error('Failed to handle SEND_CHAT:', error);
    throw new Error(`Failed to send chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handler for STOP_CHAT action
 * Stops the current processing chat/task
 */
export async function handleStopChat(event: AppSyncEventPayload): Promise<ActionHandlerResult> {
  logger.info('Handling STOP_CHAT action', { eventId: event.eventId, sessionId: event.sessionId });

  const { sessionId } = event;

  try {
    const currentExecutor = executorConnection.getCurrentExecutor();

    if (!currentExecutor) {
      throw new Error('No active task to stop');
    }

    await currentExecutor.cancel();

    return {
      sessionId,
      status: 'stopped',
      message: 'Task execution stopped',
    };
  } catch (error) {
    logger.error('Failed to handle STOP_CHAT:', error);
    throw new Error(`Failed to stop chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handler for FOLLOW_UP_CHAT action
 * Sends a follow-up message to the current active session
 */
export async function handleFollowUpChat(event: AppSyncEventPayload): Promise<ActionHandlerResult> {
  logger.info('Handling FOLLOW_UP_CHAT action', { eventId: event.eventId, sessionId: event.sessionId });

  const { sessionId, message } = event;

  try {
    const currentExecutor = executorConnection.getCurrentExecutor();

    if (!currentExecutor || !sessionId || !message) {
      throw new Error('SessionId, message and active executor are required');
    }

    currentExecutor.addFollowUpTask(message);
    executorConnection.subscribeToExecutorEvents(currentExecutor);
    const result = await currentExecutor.execute();

    return {
      sessionId,
      status: 'completed',
      result,
      message: 'Follow-up chat sent successfully',
    };
  } catch (error) {
    logger.error('Failed to handle FOLLOW_UP_CHAT:', error);
    throw new Error(`Failed to send follow-up chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handler for SET_MODEL action
 * Updates the model configuration for a specific agent
 */
export async function handleSetModel(event: AppSyncEventPayload): Promise<ActionHandlerResult> {
  logger.info('Handling SET_MODEL action', { eventId: event.eventId, modelConfig: event.modelConfig });

  const { modelConfig } = event;

  if (!modelConfig) {
    throw new Error('Model configuration is required');
  }

  try {
    // Update agent model store
    await agentModelStore.setAgentModel(modelConfig.agent, {
      provider: modelConfig.provider,
      modelName: modelConfig.model,
    });

    logger.info('Model configuration updated:', modelConfig);

    return {
      agent: modelConfig.agent,
      provider: modelConfig.provider,
      model: modelConfig.model,
      status: 'updated',
      message: `${modelConfig.agent} model updated to ${modelConfig.provider}/${modelConfig.model}`,
    };
  } catch (error) {
    logger.error('Failed to handle SET_MODEL:', error);
    throw new Error(`Failed to set model: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Map of action types to their handlers
 */
export const actionHandlers = {
  [AppSyncActionType.NEW_SESSION]: handleNewSession,
  [AppSyncActionType.SEND_CHAT]: handleSendChat,
  [AppSyncActionType.STOP_CHAT]: handleStopChat,
  [AppSyncActionType.FOLLOW_UP_CHAT]: handleFollowUpChat,
  [AppSyncActionType.SET_MODEL]: handleSetModel,
};
