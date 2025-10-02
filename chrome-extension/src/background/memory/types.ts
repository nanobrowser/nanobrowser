/**
 * Types for procedural memory system in the agent context
 * These types extend the storage types with runtime-specific functionality
 */

import type { ProceduralStep, ProceduralMemory } from '@extension/storage';
import type { DOMElementNode } from '../browser/dom/views';

/**
 * Event emitted during recording
 */
export interface RecordingEvent {
  type: 'step_recorded' | 'recording_started' | 'recording_stopped' | 'recording_paused' | 'recording_resumed';
  data?: unknown;
}

/**
 * Callback for recording events
 */
export type RecordingEventCallback = (event: RecordingEvent) => void;

/**
 * Configuration for demonstration recorder
 */
export interface RecorderConfig {
  /** Whether to automatically highlight interacted elements */
  highlightElements?: boolean;
  /** Whether to capture screenshots for each step */
  captureScreenshots?: boolean;
  /** Minimum time between steps to avoid duplicate captures (ms) */
  minStepInterval?: number;
}

/**
 * Extended procedural step with additional runtime context
 */
export interface RecordedStep extends ProceduralStep {
  /** Screenshot of the page at this step (base64 data URI) */
  screenshot?: string;
  /** Full DOM element node information */
  elementNode?: DOMElementNode;
}

/**
 * Status of the demonstration recorder
 */
export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'processing';

/**
 * Interface for demonstration recorder
 */
export interface DemonstrationRecorder {
  /** Start recording a new demonstration */
  startRecording: (title: string, description?: string) => Promise<void>;

  /** Stop recording and save */
  stopRecording: () => Promise<string>; // Returns recording ID

  /** Pause recording */
  pauseRecording: () => void;

  /** Resume recording */
  resumeRecording: () => void;

  /** Get current recording status */
  getStatus: () => RecorderStatus;

  /** Get recorded steps so far */
  getRecordedSteps: () => RecordedStep[];

  /** Subscribe to recording events */
  subscribe: (callback: RecordingEventCallback) => () => void;

  /** Clean up and remove listeners */
  cleanup: () => void;
}

/**
 * Parameters for building procedural memory from demonstration
 */
export interface BuildMemoryParams {
  /** Recording ID to build from */
  recordingId: string;
  /** Optional title override */
  title?: string;
  /** Additional tags */
  tags?: string[];
  /** Whether to use LLM for abstraction generation */
  useLLM?: boolean;
}

/**
 * Result of building procedural memory
 */
export interface BuildMemoryResult {
  /** Created procedural memory */
  memory: ProceduralMemory;
  /** Any warnings or issues during build */
  warnings?: string[];
}

/**
 * Interface for memory builder
 */
export interface MemoryBuilder {
  /** Build procedural memory from a demonstration recording */
  buildFromRecording: (params: BuildMemoryParams) => Promise<BuildMemoryResult>;

  /** Generate abstract representation from steps */
  generateAbstract: (steps: ProceduralStep[], useLLM?: boolean) => Promise<ProceduralMemory['abstract']>;

  /** Parameterize concrete values in steps (e.g., "John Doe" -> "{assignee}") */
  parameterizeSteps: (steps: ProceduralStep[]) => {
    steps: ProceduralStep[];
    parameters: Record<string, string>;
  };
}
