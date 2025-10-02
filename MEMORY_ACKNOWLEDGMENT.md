# Procedural Memory Acknowledgment - How to Verify Retrieval

## Overview

This document explains how you can verify that procedural memories are being retrieved and used by the agent. There are now **three levels of visibility**:

## 1. 🖥️ UI/Chat Visibility

When a procedural memory is retrieved, a system message appears in the chat:

```
🧠 Retrieved: "Create Linear Issue" (85% match)
```

This appears **immediately before the agent starts executing** and shows:
- The title of the retrieved procedure
- The relevance score (percentage match)

**Where to see it:** In the extension's side panel chat interface, as a system message before the first agent action.

## 2. 🤖 Agent Acknowledgment

The agent is now **explicitly instructed** to acknowledge procedural memory in its first response.

### System Prompt Addition

Added Rule #13 to the Navigator system prompt:

```
13. Procedural Memory:

- If you receive a <procedural_memory> tag with retrieved procedures, 
  you have access to prior knowledge about similar tasks
- In your FIRST response after receiving procedural memory, acknowledge it 
  in the "memory" field
- Example: "Retrieved procedure: 'Create Linear Issue' (85% relevance). 
  Following its flow: Navigate → Open form → Fill details → Submit."
- Use the high-level flow for planning your approach
- Use the detailed steps as guidance for specific actions
- Adapt the procedure to the current task's specific parameters
- If the procedure doesn't match exactly, deviate as needed and note it in memory
```

### What the Agent Sees

The procedural memory is injected as:

```xml
<procedural_memory>
🧠 PROCEDURAL MEMORY RETRIEVED
The following procedures from your memory are relevant to this task.
IMPORTANT: Acknowledge this in your FIRST response by mentioning the procedure in the "memory" field.

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

📋 INSTRUCTIONS:
1. Acknowledge this procedural memory in your FIRST response
2. Mention which procedure you're using in the "memory" field
3. Follow the high-level flow for your approach
4. Use detailed steps as guidance for actions
5. Adapt as needed if your task differs slightly
</procedural_memory>
```

### Expected Agent Response

In the agent's first step, the `current_state.memory` field should contain:

```json
{
  "current_state": {
    "evaluation_previous_goal": "Unknown - Starting new task",
    "memory": "Retrieved procedure: 'Create Linear Issue' (85% relevance). Following its flow: Navigate → Open form → Fill details → Set metadata → Submit. Currently at linear.app, will click New Issue button.",
    "next_goal": "Click the 'New Issue' button to open the issue creation form"
  },
  "action": [
    {"click_element": {"index": 5, "intent": "Open new issue form"}}
  ]
}
```

**Key indicators:**
- ✅ Mentions "Retrieved procedure"
- ✅ States the procedure name
- ✅ References the high-level flow
- ✅ Shows awareness of current step in procedure

## 3. 📊 Console Logs

For developers, detailed logging is available in the background service worker console:

```
[Executor] 🔍 Checking procedural memory for relevant procedures...
[Executor] Current context: https://linear.app - "Linear - My Workspace"
[ProceduralMemoryRetriever] Found 3 candidate memories
[ProceduralMemoryRetriever] Calculating relevance scores...
[ProceduralMemoryRetriever] Retrieved 1 relevant memories
  1. "Create Linear Issue" (score: 0.85, confidence: 0.70)
[Executor] ✅ Found 1 relevant procedural memory
[MessageManager] Added 1 procedural memories to context
```

**How to access:**
1. Open Chrome
2. Go to `chrome://extensions/`
3. Find Nanobrowser extension
4. Click "service worker" link
5. View Console tab

## Complete Example Flow

### Scenario: User starts task "Create a Linear issue for bug XYZ"

### Step 1: Memory Retrieval (Automatic)
```
[Background Console]
🔍 Checking procedural memory for relevant procedures...
Found 1 relevant memories
  1. "Create Linear Issue" (score: 0.85, confidence: 0.70)
✅ Found 1 relevant procedural memory
```

### Step 2: UI Notification
```
[Chat Interface]
System: 🧠 Retrieved: "Create Linear Issue" (85% match)
```

### Step 3: Agent First Response
```json
{
  "current_state": {
    "evaluation_previous_goal": "Unknown - Starting new task",
    "memory": "Retrieved procedure: 'Create Linear Issue' (85% relevance). Following established workflow: Navigate to Linear → Open new issue form → Fill basic details (title: 'bug XYZ') → Set metadata → Submit. Currently on linear.app workspace page.",
    "next_goal": "Locate and click the 'New Issue' button to begin issue creation workflow"
  },
  "action": [
    {
      "click_element": {
        "index": 12,
        "intent": "Open new issue creation form"
      }
    }
  ]
}
```

**Visible in chat as:**
```
Navigator: Retrieved procedure: 'Create Linear Issue' (85% relevance). Following established workflow...
Action: Clicking element to open new issue form
```

### Step 4: Continued Execution
The agent continues following the procedure's flow, adapting parameters as needed.

## How to Test

### Test 1: Basic Retrieval

1. **Create a test memory:**
   ```javascript
   // In background console
   await proceduralMemoryStore.createMemory({
     title: "Test Procedure",
     abstract: {
       goal: "Test task execution",
       parameters: [],
       prerequisites: [],
       flow: ["Step 1", "Step 2", "Step 3"],
       domains: ["example.com"],
       tags: ["test"]
     },
     steps: [{
       action: "test_action",
       parameters: {},
       description: "Test step",
       url: "https://example.com",
       pageTitle: "Test",
       timestamp: Date.now()
     }],
     successCount: 1,
     failureCount: 0,
     confidence: 0.8,
     deprecated: false,
     source: "synthetic"
   });
   ```

2. **Navigate to example.com**

3. **Start task:** "Test task execution"

4. **Check all three indicators:**
   - ✅ Console: See retrieval logs
   - ✅ UI: See "🧠 Retrieved: Test Procedure (80% match)"
   - ✅ Agent: First response mentions "Retrieved procedure: 'Test Procedure'"

### Test 2: No Memory Available

1. **Start a task with no matching memory:**
   - Task: "Do something completely unique"
   - Expected: No memory retrieved

2. **Verify:**
   - ✅ Console: "No relevant procedural memories found"
   - ✅ UI: No 🧠 message
   - ✅ Agent: Proceeds normally without acknowledgment

### Test 3: Real Workflow (Linear Example)

1. **Ensure you have the "Create Linear Issue" memory**

2. **Navigate to linear.app**

3. **Start task:** "Create a Linear issue for implementing dark mode"

4. **Observe:**
   - ✅ UI shows: "🧠 Retrieved: Create Linear Issue (85% match)"
   - ✅ Agent's first message includes: "Retrieved procedure: 'Create Linear Issue'"
   - ✅ Agent follows the procedure's flow
   - ✅ Completes task more efficiently (fewer steps than without memory)

## Troubleshooting

### Agent doesn't acknowledge memory

**Check:**
1. Is the memory actually being retrieved? (check console logs)
2. Is the procedural memory in the message history? (inspect `messageManager.getMessages()`)
3. Did the agent see the `<procedural_memory>` tags?

**Debug:**
```javascript
// In background console after task starts
const messages = executor.context.messageManager.getMessages();
const memoryMsg = messages.find(m => m.content.includes('procedural_memory'));
console.log('Memory message:', memoryMsg);
```

### UI message doesn't appear

**Check:**
1. Is the event being emitted? (check console for "🧠" emoji)
2. Is the side panel listening to events?
3. Check event type: should be `ExecutionState.STEP_START`

**Debug:**
```javascript
// Check if events are being emitted
executor.subscribeExecutionEvents((event) => {
  console.log('Event:', event);
});
```

### Memory retrieved but seems irrelevant

**Check the relevance score:**
- Score < 0.4: Not retrieved (below threshold)
- Score 0.4-0.6: Low relevance (may not match well)
- Score 0.6-0.8: Moderate relevance
- Score > 0.8: High relevance

**Adjust thresholds:**
```typescript
const retriever = new ProceduralMemoryRetriever({
  minRelevanceScore: 0.6,  // Increase for stricter matching
  maxResults: 1,           // Only show top match
});
```

## Summary

You now have **three ways** to verify procedural memory retrieval:

1. **🖥️ UI Message**: Instant visual feedback in chat
2. **🤖 Agent Acknowledgment**: Explicit mention in agent's response
3. **📊 Console Logs**: Detailed technical information

The agent is **explicitly instructed** to acknowledge retrieved memories, making it clear when it's using prior knowledge vs. exploring from scratch.

## Code Changes

### Files Modified:

1. **`navigator.ts` (system prompt)**
   - Added Rule #13 about procedural memory
   - Instructs agent to acknowledge in first response

2. **`messages/service.ts` (context injection)**
   - Enhanced header with 🧠 emoji
   - Added explicit instructions
   - More structured format

3. **`executor.ts` (event emission)**
   - Emits UI event when memory retrieved
   - Shows procedure title and relevance score

All changes are **non-breaking** and **backwards compatible**.

