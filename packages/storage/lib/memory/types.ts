/**
 * Storage types for procedural memory system
 * Implements MEMP (Memory-Enhanced Multi-Agent Planning) framework
 */

/**
 * A single action step in a demonstration with semantic context
 */
export interface ProceduralStep {
  /** Action name (e.g., 'click_element', 'input_text') */
  action: string;
  /** Action parameters (e.g., {index: 5, text: 'hello'}) */
  parameters: Record<string, unknown>;
  /** Semantic description of what this step accomplishes */
  description: string;
  /** URL where this action was performed */
  url: string;
  /** Page title at time of action */
  pageTitle: string;
  /** Timestamp when action was performed */
  timestamp: number;
  /** Element information for actions that interact with DOM elements */
  element?: {
    tagName: string;
    xpath: string;
    attributes: Record<string, string>;
    textContent?: string;
    highlightIndex?: number;
  };
}

/**
 * Abstract, high-level representation of a procedure
 * This is the "script-like" abstraction mentioned in MEMP paper
 */
export interface ProceduralAbstract {
  /** High-level goal (e.g., "Create Linear issue") */
  goal: string;
  /** Required parameters that can be substituted (e.g., ['title', 'description', 'assignee']) */
  parameters: string[];
  /** Prerequisites for this procedure (e.g., "User must be logged into Linear") */
  prerequisites: string[];
  /** High-level flow description */
  flow: string[];
  /** Domains/websites this procedure applies to (e.g., ['linear.app']) */
  domains: string[];
  /** Tags for categorization (e.g., ['project_management', 'issue_tracking']) */
  tags: string[];
}

/**
 * Complete procedural memory stored in the system
 * Combines both fine-grained steps and abstract representation
 */
export interface ProceduralMemory {
  /** Unique identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Abstract representation */
  abstract: ProceduralAbstract;
  /** Fine-grained step-by-step instructions */
  steps: ProceduralStep[];
  /** Creation timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
  /** Number of times this procedure has been successfully executed */
  successCount: number;
  /** Number of times this procedure has failed */
  failureCount: number;
  /** Confidence score (0-1) based on success rate and recency */
  confidence: number;
  /** Whether this procedure is deprecated */
  deprecated: boolean;
  /** Source of this memory: 'human_demo' | 'agent_trajectory' | 'synthetic' */
  source: 'human_demo' | 'agent_trajectory' | 'synthetic';
  /** Original demonstration session ID (if from human demo) */
  sourceSessionId?: string;
}

/**
 * Metadata for quick lookups without loading full memory
 */
export interface ProceduralMemoryMetadata {
  id: string;
  title: string;
  goal: string;
  domains: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  confidence: number;
  deprecated: boolean;
  source: 'human_demo' | 'agent_trajectory' | 'synthetic';
}

/**
 * Raw recording of a human demonstration before processing
 */
export interface DemonstrationRecording {
  /** Unique identifier */
  id: string;
  /** Title given by user */
  title: string;
  /** Description of what was demonstrated */
  description?: string;
  /** Recorded steps */
  steps: ProceduralStep[];
  /** Start timestamp */
  startedAt: number;
  /** End timestamp */
  completedAt: number;
  /** Whether this recording has been processed into procedural memory */
  processed: boolean;
  /** ID of the procedural memory created from this recording */
  proceduralMemoryId?: string;
}

/**
 * Storage interface for procedural memory system
 */
export interface ProceduralMemoryStorage {
  // Procedural Memory CRUD
  getAllMemories: () => Promise<ProceduralMemory[]>;
  getMemoriesMetadata: () => Promise<ProceduralMemoryMetadata[]>;
  getMemory: (id: string) => Promise<ProceduralMemory | null>;
  createMemory: (memory: Omit<ProceduralMemory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ProceduralMemory>;
  updateMemory: (id: string, updates: Partial<ProceduralMemory>) => Promise<ProceduralMemory>;
  deleteMemory: (id: string) => Promise<void>;
  clearAllMemories: () => Promise<void>;

  // Search and retrieval
  searchMemories: (query: {
    goal?: string;
    domains?: string[];
    tags?: string[];
    minConfidence?: number;
    excludeDeprecated?: boolean;
  }) => Promise<ProceduralMemory[]>;

  // Demonstration recordings CRUD
  getAllRecordings: () => Promise<DemonstrationRecording[]>;
  getRecording: (id: string) => Promise<DemonstrationRecording | null>;
  createRecording: (
    recording: Omit<DemonstrationRecording, 'id' | 'startedAt' | 'processed'>,
  ) => Promise<DemonstrationRecording>;
  updateRecording: (id: string, updates: Partial<DemonstrationRecording>) => Promise<DemonstrationRecording>;
  deleteRecording: (id: string) => Promise<void>;
  clearAllRecordings: () => Promise<void>;

  // Statistics
  updateMemoryStats: (id: string, success: boolean) => Promise<void>;
}
