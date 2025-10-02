# Procedural Memory System - BUILD Phase

This module implements the BUILD phase of the MEMP (Memory-Enhanced Multi-Agent Planning) framework for Nanobrowser. It enables the agent to learn from human demonstrations and store them as reusable procedural memories.

## Overview

Based on the MEMP paper (arxiv.org/abs/2508.06433), this system allows:

1. **Recording human demonstrations** in the web browser
2. **Distilling demonstrations** into both fine-grained and abstract representations
3. **Storing procedural memories** for future retrieval and execution

## Architecture

```
chrome-extension/src/background/memory/
├── types.ts           # Type definitions
├── recorder.ts        # Demonstration recording
├── builder.ts         # Memory building and distillation
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

### 3. Storage Layer (`packages/storage/lib/memory/`)

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

The BUILD phase is now complete. The next phases will integrate this system with the agent:

### Phase 2: RETRIEVE (To Be Implemented)

When the agent receives a task:

1. **Semantic search** for relevant procedural memories
2. **Match task description** with memory goals
3. **Verify prerequisites** (correct domain, logged in, etc.)
4. **Inject memory** as context for planner and navigator

Example integration point in `executor.ts`:

```typescript
async execute(): Promise<void> {
  // NEW: Retrieve relevant procedures before planning
  const relevantProcedures = await this.retrieveProcedures(this.tasks);
  
  if (relevantProcedures.length > 0) {
    // Inject as context for planner
    this.context.messageManager.addProcedureContext(relevantProcedures);
  }
  
  // Existing execution loop...
}
```

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

### Recording Limitations

The current recorder captures:
- ✅ Navigation events (URL changes)
- ✅ Tab switches
- ⚠️ Manual step recording via `recordDOMInteraction()` method

**Not yet captured automatically:**
- ❌ Click events
- ❌ Text input events
- ❌ Form submissions
- ❌ Dropdown selections

**Reason:** Chrome extensions have limited access to page-level events. To capture these, we need:

1. **Content scripts** that inject into web pages and listen to DOM events
2. **Chrome Debugger API** for deeper inspection
3. **Integration with agent actions** so actions record themselves

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

### 3. Agent Retrieval (Future)

```
User asks agent: "Create a Linear issue for the new feature request"

Agent retrieves procedural memory:
→ Matches goal "Create issue in Linear"
→ Verifies domain: ✓ on linear.app
→ Checks prerequisites: ✓ user logged in
→ Uses abstract flow for planning
→ Uses fine-grained steps for navigation
→ Adapts parameters to new task
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

## Next Steps

To complete the full MEMP implementation:

1. **Enhance recording** by integrating with action execution
2. **Build UI** for managing recordings and memories
3. **Implement RETRIEVE** phase for semantic search
4. **Implement UPDATE** phase for memory refinement
5. **Add vector embeddings** for better semantic matching
6. **Test with real workflows** (Linear, GitHub, Notion, etc.)

## References

- MEMP Paper: https://arxiv.org/abs/2508.06433
- Chrome Storage API: https://developer.chrome.com/docs/extensions/reference/storage/
- Nanobrowser Architecture: See `/CLAUDE.md`

