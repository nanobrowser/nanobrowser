import { z } from 'zod';
import type BrowserContext from '../browser/context';
import { DEFAULT_INCLUDE_ATTRIBUTES } from '../browser/dom/views';
import type { DOMHistoryElement } from '../browser/dom/history/view';
import type MessageManager from './messages/service';
import type { EventManager } from './event/manager';
import { type Actors, type ExecutionState, AgentEvent } from './event/types';
import { AgentStepHistory } from './history';

export interface AgentOptions {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  retryDelay: number;
  maxInputTokens: number;
  maxErrorLength: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  includeAttributes: string[];
  planningInterval: number;
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
  maxSteps: 1000,
  maxActionsPerStep: 100,
  maxFailures: 12,
  retryDelay: 10,
  maxInputTokens: 128000,
  maxErrorLength: 400,
  useVision: true,
  useVisionForPlanner: true,
  includeAttributes: DEFAULT_INCLUDE_ATTRIBUTES,
  planningInterval: 3,
};

export class AgentContext {
  controller: AbortController;
  taskId: string;
  browserContext: BrowserContext;
  messageManager: MessageManager;
  eventManager: EventManager;
  options: AgentOptions;
  paused: boolean;
  stopped: boolean;
  consecutiveFailures: number;
  nSteps: number;
  stepInfo: AgentStepInfo | null;
  actionResults: ActionResult[];
  stateMessageAdded: boolean;
  history: AgentStepHistory;
  finalAnswer: string | null;
  currentPlannerInterval: number;
  lastPlannerAdjustmentStep: number;

  constructor(
    taskId: string,
    browserContext: BrowserContext,
    messageManager: MessageManager,
    eventManager: EventManager,
    options: Partial<AgentOptions>,
  ) {
    this.controller = new AbortController();
    this.taskId = taskId;
    this.browserContext = browserContext;
    this.messageManager = messageManager;
    this.eventManager = eventManager;
    this.options = { ...DEFAULT_AGENT_OPTIONS, ...options };

    this.paused = false;
    this.stopped = false;
    this.nSteps = 0;
    this.consecutiveFailures = 0;
    this.stepInfo = null;
    this.actionResults = [];
    this.stateMessageAdded = false;
    this.history = new AgentStepHistory();
    this.finalAnswer = null;
    this.currentPlannerInterval = this.options.planningInterval;
    this.lastPlannerAdjustmentStep = -1;
  }

  async emitEvent(actor: Actors, state: ExecutionState, eventDetails: string) {
    const event = new AgentEvent(actor, state, {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      details: eventDetails,
    });
    await this.eventManager.emit(event);
  }

  async pause() {
    this.paused = true;
  }

  async resume() {
    this.paused = false;
  }

  async stop() {
    this.stopped = true;
    setTimeout(() => this.controller.abort(), 300);
  }
}

export class AgentStepInfo {
  stepNumber: number;
  maxSteps: number;

  constructor(params: { stepNumber: number; maxSteps: number }) {
    this.stepNumber = params.stepNumber;
    this.maxSteps = params.maxSteps;
  }
}

export class ActionResult {
  isDone: boolean;
  success: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;
  interactedElement: DOMHistoryElement | null;

  constructor(params: Partial<ActionResult> = {}) {
    this.isDone = params.isDone ?? false;
    this.success = params.success ?? false;
    this.interactedElement = params.interactedElement ?? null;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
  }
}

export type WrappedActionResult = ActionResult & {
  toolCallId: string;
};

export class StepMetadata {
  stepStartTime: number;
  stepEndTime: number;
  inputTokens: number;
  stepNumber: number;

  constructor(stepStartTime: number, stepEndTime: number, inputTokens: number, stepNumber: number) {
    this.stepStartTime = stepStartTime;
    this.stepEndTime = stepEndTime;
    this.inputTokens = inputTokens;
    this.stepNumber = stepNumber;
  }

  /**
   * Calculate step duration in seconds
   */
  get durationSeconds(): number {
    return this.stepEndTime - this.stepStartTime;
  }
}

export const agentBrainSchema = z
  .object({
    evaluation_previous_goal: z.string(),
    memory: z.string(),
    next_goal: z.string(),
  })
  .describe('Current state of the agent');

export type AgentBrain = z.infer<typeof agentBrainSchema>;

// Make AgentOutput generic with Zod schema
export interface AgentOutput<T = unknown> {
  /**
   * The unique identifier for the agent
   */
  id: string;

  /**
   * The result of the agent's step
   */
  result?: T;
  /**
   * The error that occurred during the agent's action
   */
  error?: string;
}
