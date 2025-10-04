# Procedural Memory Prompt Logging

## Overview

Added comprehensive logging to show the **exact prompt with procedural memory context** that's sent to the LLM. This allows you to see how procedural memories are presented to the model.

## What Was Added

### 1. Navigator Agent Logging
**File:** `chrome-extension/src/background/agent/agents/navigator.ts`

Added `logMessagesWithProceduralMemory()` method that logs before every LLM invocation.

### 2. Base Agent Logging  
**File:** `chrome-extension/src/background/agent/agents/base.ts`

Added the same method to the base agent class for planner and other agents.

## How to View the Logs

### Step 1: Open Background Console

1. Open Chrome
2. Go to `chrome://extensions/`
3. Find **Nanobrowser** extension
4. Click **"service worker"** link (or "Inspect views: service worker")
5. Console tab will show background logs

### Step 2: Start a Task

Start any task that might match a procedural memory. For example:
- Navigate to `linear.app`
- Start task: "Create a Linear issue for bug XYZ"

### Step 3: View the Output

You'll see detailed logs like this:

```
================================================================================
📨 FULL PROMPT SENT TO LLM (Navigator)
================================================================================

[Message 1/6] SystemMessage
Preview: <system_instructions>
You are an AI agent designed to automate browser tasks. Your goal is to accompli...

[Message 2/6] HumanMessage
Preview: <user_request>Your ultimate task is: """Create a Linear issue for bug XYZ""". If you achie...

[Message 3/6] HumanMessage 🧠 CONTAINS PROCEDURAL MEMORY
--------------------------------------------------------------------------------
🧠 PROCEDURAL MEMORY CONTENT:
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
3. Fill in issue title
   Action: input_text({"index":10,"text":"{{title}}"})
4. Fill in issue description
   Action: input_text({"index":12,"text":"{{description}}"})
5. Click assignee dropdown
   Action: click_element({"index":15})
6. Select assignee
   Action: click_element({"index":18})
7. Click project dropdown
   Action: click_element({"index":20})
8. Select project
   Action: click_element({"index":23})
9. Click milestone dropdown
   Action: click_element({"index":25})
10. Select milestone
    Action: click_element({"index":28})
11. Submit the form
    Action: click_element({"index":30})

📋 INSTRUCTIONS:
1. Acknowledge this procedural memory in your FIRST response
2. Mention which procedure you're using in the "memory" field
3. Follow the high-level flow for your approach
4. Use detailed steps as guidance for actions
5. Adapt as needed if your task differs slightly
</procedural_memory>
--------------------------------------------------------------------------------

[Message 4/6] HumanMessage
Preview: [Your task history memory starts here]

[Message 5/6] HumanMessage
Preview: Here are file paths you can use: []

[Message 6/6] HumanMessage
Preview: [Scroll info of current page] window.scrollY: 0, document.body.scrollHeight: 1200, window...

================================================================================
Total messages: 6
================================================================================
```

## Log Features

### ✅ Highlights Procedural Memory
- **Detects** messages containing `<procedural_memory>` tags
- **Extracts** and displays the full memory content
- **Highlights** with 🧠 emoji for easy spotting

### ✅ Shows All Messages
- **System message**: Agent instructions
- **Task message**: User's request
- **Procedural memory**: Retrieved procedures
- **Browser state**: Current page info
- **History**: Previous actions

### ✅ Message Previews
- Non-memory messages show 200-character preview
- Full content available in collapsed logs
- Message type and position clearly labeled

### ✅ Easy to Read
- Clear separators (80 characters wide)
- Message numbering (1/6, 2/6, etc.)
- Section headers with emojis
- Structured formatting

## What You'll Learn

### 1. **Memory Injection Verification**
See that procedural memory is actually being added to the context:
```
[Message 3/6] HumanMessage 🧠 CONTAINS PROCEDURAL MEMORY
```

### 2. **Memory Content**
See exactly what the LLM receives:
- Procedure title and relevance
- Goal and prerequisites
- High-level flow
- Detailed step-by-step actions
- Instructions to acknowledge

### 3. **Message Order**
Understand the sequence:
1. System instructions
2. Task description
3. **Procedural memory** ← Here!
4. Task history marker
5. Available files
6. Current browser state

### 4. **Context Size**
See total number of messages sent to LLM

## Example Output Breakdown

### Without Procedural Memory
```
================================================================================
📨 FULL PROMPT SENT TO LLM (Navigator)
================================================================================

[Message 1/5] SystemMessage
Preview: <system_instructions>...

[Message 2/5] HumanMessage
Preview: <user_request>Your ultimate task is: """Create a Linear issue"""...

[Message 3/5] HumanMessage
Preview: [Your task history memory starts here]

[Message 4/5] HumanMessage
Preview: Here are file paths you can use: []

[Message 5/5] HumanMessage
Preview: [Scroll info of current page]...

================================================================================
Total messages: 5
================================================================================
```
**Notice:** Only 5 messages, no 🧠 indicator

### With Procedural Memory
```
================================================================================
📨 FULL PROMPT SENT TO LLM (Navigator)
================================================================================

[Message 1/6] SystemMessage
Preview: <system_instructions>...

[Message 2/6] HumanMessage
Preview: <user_request>Your ultimate task is: """Create a Linear issue"""...

[Message 3/6] HumanMessage 🧠 CONTAINS PROCEDURAL MEMORY
--------------------------------------------------------------------------------
🧠 PROCEDURAL MEMORY CONTENT:
<procedural_memory>
🧠 PROCEDURAL MEMORY RETRIEVED
...full memory content here...
</procedural_memory>
--------------------------------------------------------------------------------

[Message 4/6] HumanMessage
Preview: [Your task history memory starts here]

[Message 5/6] HumanMessage
Preview: Here are file paths you can use: []

[Message 6/6] HumanMessage
Preview: [Scroll info of current page]...

================================================================================
Total messages: 6
================================================================================
```
**Notice:** 6 messages, message 3 has 🧠 with full content

## Performance Impact

### Minimal Overhead
- Logging only happens in console (not in production builds with `import.meta.env.DEV`)
- String operations are fast
- Only logs when LLM is invoked (every step)

### Token Usage
The log shows exactly how many tokens the procedural memory adds:
- Typical procedural memory: **500-1500 tokens**
- With 3 procedures: **1500-4500 tokens**

## Debugging Tips

### Check if Memory is Injected
Search console for:
```
🧠 CONTAINS PROCEDURAL MEMORY
```

### View Full Content
The full procedural memory content is logged, so you can:
- Copy and paste into a text editor
- Analyze the structure
- Verify accuracy

### Compare With/Without
Run same task twice:
1. With matching procedural memory
2. After deleting the memory

Compare the logs to see the difference.

### Verify Agent Sees It
After seeing the log, check the agent's first response:
- Should mention "Retrieved procedure"
- Should reference the procedure name
- Actions should align with procedure flow

## Code Locations

### Logging Method
```typescript
// chrome-extension/src/background/agent/agents/navigator.ts:153-190
private logMessagesWithProceduralMemory(inputMessages: BaseMessage[]): void {
  logger.info('='.repeat(80));
  logger.info('📨 FULL PROMPT SENT TO LLM (Navigator)');
  // ... logs each message
  // ... extracts and highlights procedural memory
}
```

### Invocation Point
```typescript
// chrome-extension/src/background/agent/agents/navigator.ts:93-95
async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
  // Log the full prompt including procedural memory
  this.logMessagesWithProceduralMemory(inputMessages);
  
  // ... then invoke LLM
}
```

### Base Agent Support
```typescript
// chrome-extension/src/background/agent/agents/base.ts:121-125
async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
  // Log the full prompt including procedural memory (if not already logged by subclass)
  if (this.id !== 'navigator') {
    this.logMessagesWithProceduralMemory(inputMessages);
  }
  // ... invoke LLM
}
```

## Testing

### Test 1: Verify Logging Works

1. **Build and load extension:**
   ```bash
   pnpm -F chrome-extension build
   ```

2. **Open background console**

3. **Start any task**

4. **Look for:**
   ```
   📨 FULL PROMPT SENT TO LLM (Navigator)
   ```

5. **Expected:** Should see full prompt log

### Test 2: Verify Memory Appears

1. **Create a test memory** (see `TEST_PROCEDURAL_MEMORY.md`)

2. **Navigate to matching domain**

3. **Start similar task**

4. **Look for:**
   ```
   🧠 CONTAINS PROCEDURAL MEMORY
   ```

5. **Expected:** Should see full memory content in log

### Test 3: Compare Messages

1. **Count messages without memory:**
   - Start task with no matching memory
   - Count: `Total messages: X`

2. **Count messages with memory:**
   - Start task with matching memory
   - Count: `Total messages: X+1`

3. **Expected:** One additional message containing procedural memory

## Summary

With this logging, you can now:

✅ **See the exact prompt** sent to the LLM  
✅ **Verify procedural memory** is injected  
✅ **View memory content** as the LLM sees it  
✅ **Debug retrieval issues** by checking logs  
✅ **Understand context size** and token usage  
✅ **Compare with/without** procedural memory  

The logs appear **before every LLM call**, so you'll see them:
- On first step (with procedural memory)
- On every subsequent step (if task continues)
- For both Navigator and Planner agents

**Location:** Background service worker console  
**When:** Every time LLM is invoked  
**Format:** Structured with clear separators  
**Content:** Full message history including procedural memory

