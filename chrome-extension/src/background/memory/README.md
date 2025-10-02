# Procedural Memory System - BUILD & RETRIEVE Phases

This module implements the BUILD and RETRIEVE phases of the MEMP (Memory-Enhanced Multi-Agent Planning) framework for Nanobrowser. It enables the agent to learn from human demonstrations and retrieve relevant procedures when executing similar tasks.

## Overview

Based on the MEMP paper (arxiv.org/abs/2508.06433), this system allows:

1. **BUILD Phase**: Recording and distilling human demonstrations into procedural memories
   - Record human actions in the web browser
   - Distill into both fine-grained steps and abstract representations
   - Store in persistent memory with metadata

2. **RETRIEVE Phase**: Finding and using relevant procedures during task execution
   - Semantic matching of task descriptions with stored procedures
   - Context verification (domain matching, prerequisites)
   - Relevance scoring and ranking
   - Injection as context for the planner and navigator

## Architecture

```
chrome-extension/src/background/memory/
├── types.ts           # Type definitions
├── recorder.ts        # Demonstration recording (BUILD)
├── builder.ts         # Memory building and distillation (BUILD)
├── retriever.ts       # Memory retrieval and matching (RETRIEVE)
├── index.ts           # Module exports
└── README.md          # This file

packages/storage/lib/memory/
├── types.ts           # Storage type definitions
└── procedural.ts      # Storage implementation
```

## Components

### 1. Demonstration Recorder (`recorder.ts`)

Captures human actions in real-time:

- Listens to browser events (navigation, tab switches, etc.)
- Records DOM interactions with semantic context
- Stores action sequences with timestamps
- Supports pause/resume during recording

**Key Features:**
- Automatic element information capture
- Screenshot support (optional)
- Minimum step interval to avoid duplicates
- Event-driven architecture for UI updates

### 2. Memory Builder (`builder.ts`)

Converts raw recordings into structured procedural memories:

**Heuristic Mode** (rule-based):
- Extracts high-level flow from action sequences
- Identifies parameters from common patterns
- Infers goals from first/last steps
- Auto-generates tags and prerequisites

**LLM Mode** (optional):
- Uses language model for abstract generation
- Better understanding of user intent
- More accurate parameterization
- Falls back to heuristics if LLM fails

### 3. Procedural Memory Retriever (`retriever.ts`)

Finds relevant procedural memories for the current task:

**Semantic Matching:**
- Compares task descriptions with stored procedure goals
- Uses keyword-based similarity (Jaccard index)
- Can be enhanced with embeddings for better matching

**Context Verification:**
- Checks if current webpage matches procedure domains
- Verifies parameters are available
- Assesses if prerequisites are met

**Relevance Scoring:**
- Goal similarity (40%): How well the task matches the procedure goal
- Domain match (30%): Whether on the correct website
- Confidence (20%): Success rate from past executions
- Parameter match (10%): Availability of required parameters

**Integration:**
- Automatically retrieves procedures at task start
- Injects top matches as context for planner/navigator
- Non-blocking: continues execution even if retrieval fails

### 4. Storage Layer (`packages/storage/lib/memory/`)

Persistent storage for procedural memories:

- Chrome storage API integration
- Separate storage for recordings and memories
- Metadata indexing for fast lookups
- Search and filtering capabilities
- Confidence scoring based on success rate

## Data Structures

### Procedural Memory

Combines **fine-grained** (step-by-step) and **abstract** (high-level) representations:

```typescript
{
  id: "uuid",
  title: "Create Linear Issue",
  
  // Abstract representation
  abstract: {
    goal: "Create issue in Linear",
    parameters: ["title", "description", "assignee"],
    prerequisites: ["User must be logged into linear.app"],
    flow: [
      "Navigate to Linear",
      "Initialize form",
      "Fill details",
      "Set metadata",
      "Submit"
    ],
    domains: ["linear.app"],
    tags: ["project_management", "issue_tracking", "creation"]
  },
  
  // Fine-grained steps
  steps: [
    {
      action: "go_to_url",
      parameters: { url: "https://linear.app" },
      description: "Navigate to Linear workspace",
      url: "https://linear.app",
      timestamp: 1234567890,
      element: { ... }
    },
    // ... more steps
  ],
  
  // Metrics
  successCount: 0,
  failureCount: 0,
  confidence: 0.5,
  deprecated: false,
  
  source: "human_demo",
  createdAt: 1234567890,
  updatedAt: 1234567890
}
```

## Usage

### Recording a Demonstration

From the extension UI (to be implemented), send messages to the background script:

```typescript
// Start recording
port.postMessage({
  type: 'start_recording',
  title: 'Create Linear Issue',
  description: 'Demonstrates creating a new issue with all metadata'
});

// Perform actions in the browser...

// Stop recording
port.postMessage({
  type: 'stop_recording'
});

// Response includes recordingId
// { type: 'recording_stopped', recordingId: 'uuid' }
```

### Building Procedural Memory

After recording, convert it to procedural memory:

```typescript
port.postMessage({
  type: 'build_memory',
  recordingId: 'uuid',
  title: 'Create Linear Issue', // Optional override
  tags: ['linear', 'issues'],    // Optional additional tags
  useLLM: true                   // Use LLM for better abstraction
});

// Response includes memory ID
// { type: 'memory_built', memoryId: 'uuid', warnings: [] }
```

### Listing Recordings and Memories

```typescript
// Get all recordings
port.postMessage({ type: 'get_recordings' });
// Response: { type: 'recordings_list', recordings: [...] }

// Get all procedural memories
port.postMessage({ type: 'get_memories' });
// Response: { type: 'memories_list', memories: [...] }
```

### Deleting Records

```typescript
// Delete a recording
port.postMessage({
  type: 'delete_recording',
  recordingId: 'uuid'
});

// Delete a procedural memory
port.postMessage({
  type: 'delete_memory',
  memoryId: 'uuid'
});
```

## Integration with Agent System

Both BUILD and RETRIEVE phases are now implemented and integrated with the agent system.

### RETRIEVE Phase Integration

The retrieval happens automatically in the `Executor` when a task starts:

**Implementation in `executor.ts`:**

```typescript
async execute(): Promise<void> {
  // NEW: Retrieve relevant procedures before execution
  await this.retrieveAndInjectProceduralMemories();
  
  // Existing execution loop...
}

private async retrieveAndInjectProceduralMemories(): Promise<void> {
  // 1. Build retrieval context
  const retrievalContext: RetrievalContext = {
    task: this.tasks[this.tasks.length - 1],
    currentUrl: await getCurrentPageUrl(),
    currentPageTitle: await getCurrentPageTitle(),
  };
  
  // 2. Retrieve relevant procedures
  const relevantProcedures = await proceduralMemoryRetriever.retrieve(retrievalContext);
  
  // 3. Inject as context if found
  if (relevantProcedures.length > 0) {
    this.context.messageManager.addProceduralMemoryContext(relevantProcedures);
  }
}
```

**What the Agent Sees:**

When procedures are found, they're injected into the message history wrapped in `<procedural_memory>` tags:

```xml
<procedural_memory>
The following procedures from your memory are relevant to this task:

## Procedure 1: Create Linear Issue
Relevance: 85% (similar goal: "Create issue in Linear"; matches current domain (linear.app))

**Goal**: Create issue in Linear with title, description, and metadata

**Prerequisites**: User must be logged into linear.app

**Required Parameters**: title, description, assignee

**High-level Flow**:
1. Navigate to Linear workspace
2. Open new issue form
3. Fill in basic details
4. Set metadata (assignee, project, milestone)
5. Submit the form

**Detailed Steps** (11 steps):
1. Navigate to Linear workspace
   Action: go_to_url({"url":"https://linear.app"})
2. Click "New Issue" button
   Action: click_element({"index":5})
...

You can adapt these procedures to the current task.
</procedural_memory>
```

The planner and navigator can now use this as guidance.

### Phase 3: UPDATE (To Be Implemented)

After execution:

1. **Track success/failure** of memory-guided executions
2. **Update confidence scores** based on outcomes
3. **Identify failing steps** and mark for correction
4. **Deprecate outdated procedures** when UI changes
5. **Merge variations** from multiple demonstrations

Example integration:

```typescript
// After task completion in executor
if (usedProceduralMemory) {
  await proceduralMemoryStore.updateMemoryStats(
    memoryId,
    taskSucceeded
  );
}
```

## Current Limitations

### Recording Capabilities

The current recorder captures:
- ✅ Navigation events (URL changes)
- ✅ Tab switches
- ✅ Click events (via injected content script)
- ✅ Text input events (via injected content script with debouncing)
- ✅ Form submissions (via injected content script)
- ⚠️ Manual step recording via `recordDOMInteraction()` method

**Not yet captured automatically:**
- ❌ Dropdown selections (complex selects)
- ❌ Drag-and-drop interactions
- ❌ Hover events
- ❌ Scroll actions

**Implementation:** 
- DOM events are captured via `recordingListener.js` content script
- The script is injected into all tabs when recording starts
- Events are debounced to avoid duplicate captures
- XPath and element attributes are captured for each interaction

### Recommended Enhancement

Modify action implementations in `chrome-extension/src/background/agent/actions/builder.ts` to record themselves:

```typescript
const clickElement = new Action(async (input) => {
  // Existing click logic...
  const result = await context.browserContext.clickElement(input.index);
  
  // NEW: Record this action if recording is active
  if (demonstrationRecorder?.getStatus() === 'recording') {
    await demonstrationRecorder.recordDOMInteraction(
      'click_element',
      { index: input.index },
      input.intent || `Clicked element ${input.index}`,
      domElement
    );
  }
  
  return result;
}, clickElementActionSchema);
```

## Example Demo Flow

Here's how the Linear issue creation demo would work:

### 1. Human Demonstration

```
User clicks "Start Recording" in extension
→ Title: "Create Linear Issue"
→ Description: "Create issue with title, description, assignee, project, milestone"

User performs actions in browser:
1. Navigate to linear.app
2. Click "New Issue" button
3. Type title: "Implement feature X"
4. Type description: "Add support for..."
5. Click "Assignee" dropdown
6. Select "John Doe"
7. Click "Project" dropdown
8. Select "Engineering"
9. Click "Milestone" dropdown
10. Select "Q1 2025"
11. Click "Create Issue"

User clicks "Stop Recording"
```

### 2. Memory Building

```
System processes recording:
→ Identifies 11 fine-grained steps
→ Generates abstract:
   - Goal: "Create issue in Linear"
   - Parameters: [title, description, assignee, project, milestone]
   - Flow: [Navigate, Open form, Fill details, Set metadata, Submit]
   - Tags: [project_management, issue_tracking, creation]
→ Stores as procedural memory
```

### 3. Agent Retrieval (Now Implemented)

```
User asks agent: "Create a Linear issue for the new feature request"

Agent execution starts:
→ Retrieves procedural memories for task
→ Finds "Create Linear Issue" (85% relevance)
   - Goal similarity: High (matches "create issue")
   - Domain match: 100% (on linear.app)
   - Confidence: 70% (7 successes, 3 failures)
→ Injects procedure as context
→ Planner uses high-level flow for strategy
→ Navigator uses fine-grained steps for actions
→ Adapts parameters to "new feature request"
→ Executes efficiently with prior knowledge
```

**Retrieval Logs:**
```
[Executor] 🔍 Checking procedural memory for relevant procedures...
[ProceduralMemoryRetriever] Found 3 candidate memories
[ProceduralMemoryRetriever] Retrieved 1 relevant memories
  1. "Create Linear Issue" (score: 0.85, confidence: 0.70)
[Executor] ✅ Found 1 relevant procedural memory
[MessageManager] Added 1 procedural memories to context
```

## Testing

To test the BUILD phase:

1. **Build the extension:**
   ```bash
   pnpm build
   ```

2. **Load in Chrome:**
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Load unpacked from `dist/` directory

3. **Test via console:**
   ```javascript
   // Get background service worker
   // Right-click extension → "Inspect background page"
   
   // In console:
   const port = chrome.runtime.connect({ name: 'side-panel-connection' });
   
   // Start recording
   port.postMessage({
     type: 'start_recording',
     title: 'Test Recording',
     description: 'Testing the recorder'
   });
   
   // Navigate somewhere, switch tabs...
   
   // Stop recording
   port.postMessage({ type: 'stop_recording' });
   
   // Listen for response
   port.onMessage.addListener(msg => console.log(msg));
   ```

4. **Check storage:**
   ```javascript
   // In console:
   chrome.storage.local.get(null, (items) => {
     console.log('Storage:', items);
     // Look for 'demonstration_recordings' and 'procedural_memories_meta'
   });
   ```

## Testing the RETRIEVE Phase

To test memory retrieval:

1. **Create a procedural memory** (use UI or manually via storage)
2. **Start a similar task:**
   ```
   User: "Create a Linear issue for bug XYZ"
   ```
3. **Check logs in background console:**
   ```
   [Executor] 🔍 Checking procedural memory...
   [ProceduralMemoryRetriever] Retrieved 1 relevant memories
   [Executor] ✅ Found 1 relevant procedural memory
   ```
4. **Observe agent behavior:**
   - Should follow the procedure's flow
   - Completes task more efficiently
   - Fewer exploratory steps

## Current State

✅ **Implemented:**
- BUILD Phase: Recording, building, storing procedural memories
- RETRIEVE Phase: Semantic search, context verification, relevance scoring
- Integration: Automatic retrieval in executor, context injection

🔄 **In Progress:**
- UI for managing recordings and memories (see `pages/side-panel/src/components/MemoryPanel.tsx`)

📋 **Next Steps:**

1. **Enhance semantic matching:**
   - Add vector embeddings (OpenAI embeddings API)
   - Improve similarity calculation with sentence transformers
   - Support multi-language matching

2. **Implement UPDATE phase:**
   - Track success/failure of memory-guided executions
   - Update confidence scores automatically
   - Identify and fix failing steps
   - Deprecate outdated procedures when UI changes
   - Merge variations from multiple demonstrations

3. **Improve retrieval:**
   - Add query expansion (synonyms, related terms)
   - Support negative examples (what NOT to do)
   - Cache frequently used procedures
   - A/B test different retrieval strategies

4. **Enhance recording:**
   - Auto-detect and record all agent actions
   - Support more interaction types (drag-drop, hover)
   - Better parameterization detection
   - Multi-session recording and stitching

5. **Test with real workflows:**
   - Linear issue management
   - GitHub PR creation
   - Notion page creation
   - E-commerce checkout flows
   - Email composition and sending

## References

- MEMP Paper: https://arxiv.org/abs/2508.06433
- Chrome Storage API: https://developer.chrome.com/docs/extensions/reference/storage/
- Nanobrowser Architecture: See `/CLAUDE.md`

