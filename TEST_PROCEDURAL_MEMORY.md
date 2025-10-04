# Testing Procedural Memory System

## Prerequisites

1. Build and load the extension:
   ```bash
   pnpm build
   ```

2. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Load unpacked from `dist/` directory

## Testing via Browser Console

### Step 1: Open Background Service Worker Console

1. Go to `chrome://extensions/`
2. Find Nanobrowser
3. Click "Inspect views: background page" or "service worker"
4. Console will open

### Step 2: Establish Connection

```javascript
// Connect to background service
const port = chrome.runtime.connect({ name: 'side-panel-connection' });

// Listen for responses
port.onMessage.addListener((msg) => {
  console.log('Received:', msg);
});
```

### Step 3: Start Recording a Demonstration

```javascript
port.postMessage({
  type: 'start_recording',
  title: 'Create Linear Issue Demo',
  description: 'Demonstrates creating a new issue with metadata'
});
```

**Expected response:**
```javascript
{ type: 'recording_started', title: 'Create Linear Issue Demo' }
```

### Step 4: Perform Actions in Browser

Now perform your demonstration in the active tab:
- Navigate to linear.app (or any website)
- Switch tabs
- (Manual DOM actions aren't captured yet, but navigation is)

Example: Navigate to a few pages to generate some steps.

### Step 5: Stop Recording

```javascript
port.postMessage({
  type: 'stop_recording'
});
```

**Expected response:**
```javascript
{ 
  type: 'recording_stopped', 
  recordingId: 'uuid-here' 
}
```

**Save this recordingId!** You'll need it for the next step.

### Step 6: Build Procedural Memory from Recording

```javascript
port.postMessage({
  type: 'build_memory',
  recordingId: 'YOUR-RECORDING-ID-HERE',  // Use the ID from step 5
  title: 'Create Linear Issue',  // Optional: override title
  tags: ['linear', 'project-management'],  // Optional: add tags
  useLLM: false  // Set to true if you want LLM-powered abstraction
});
```

**Expected response:**
```javascript
{ 
  type: 'memory_built', 
  memoryId: 'uuid-here',
  warnings: []  // Any warnings during build
}
```

### Step 7: View All Recordings

```javascript
port.postMessage({
  type: 'get_recordings'
});
```

**Expected response:**
```javascript
{
  type: 'recordings_list',
  recordings: [
    {
      id: 'uuid',
      title: 'Create Linear Issue Demo',
      description: '...',
      steps: [...],
      startedAt: 1234567890,
      completedAt: 1234567891,
      processed: true,
      proceduralMemoryId: 'memory-uuid'
    }
  ]
}
```

### Step 8: View All Procedural Memories

```javascript
port.postMessage({
  type: 'get_memories'
});
```

**Expected response:**
```javascript
{
  type: 'memories_list',
  memories: [
    {
      id: 'uuid',
      title: 'Create Linear Issue',
      goal: 'Create issue in Linear',
      domains: ['linear.app'],
      tags: ['linear', 'project-management', 'issue_tracking'],
      confidence: 0.5,
      deprecated: false,
      source: 'human_demo',
      createdAt: 1234567890,
      updatedAt: 1234567890
    }
  ]
}
```

### Step 9: View Full Memory Details (Via Storage API)

```javascript
// Access storage directly to see full memory
chrome.storage.local.get(null, (items) => {
  console.log('=== All Storage ===');
  console.log(items);
  
  // Find procedural memories
  console.log('\n=== Procedural Memories Metadata ===');
  console.log(items['procedural_memories_meta']);
  
  // Find demonstration recordings
  console.log('\n=== Demonstration Recordings ===');
  console.log(items['demonstration_recordings']);
  
  // To see full memory details, look for keys like 'procedural_memory_<uuid>'
  Object.keys(items).forEach(key => {
    if (key.startsWith('procedural_memory_')) {
      console.log(`\n=== Full Memory: ${key} ===`);
      console.log(JSON.stringify(items[key], null, 2));
    }
  });
});
```

### Step 10: Delete Records (Cleanup)

```javascript
// Delete a recording
port.postMessage({
  type: 'delete_recording',
  recordingId: 'YOUR-RECORDING-ID'
});

// Delete a memory
port.postMessage({
  type: 'delete_memory',
  memoryId: 'YOUR-MEMORY-ID'
});
```

---

## Alternative: Direct Storage Access

You can also inspect storage directly:

```javascript
// View all storage
chrome.storage.local.get(null, (result) => {
  console.table(Object.keys(result));
});

// Import the store (if running in extension context)
// This won't work in console, but shows the API
import { proceduralMemoryStore } from '@extension/storage';

// Get all memories
const memories = await proceduralMemoryStore.getAllMemories();
console.log('Memories:', memories);

// Search for specific memories
const linearMemories = await proceduralMemoryStore.searchMemories({
  domains: ['linear.app'],
  minConfidence: 0.3
});
console.log('Linear memories:', linearMemories);
```

---

## Expected Data Structures

### Recording Structure
```json
{
  "id": "uuid",
  "title": "Create Linear Issue Demo",
  "description": "...",
  "steps": [
    {
      "action": "go_to_url",
      "parameters": { "url": "https://linear.app" },
      "description": "Navigated to Linear",
      "url": "https://linear.app",
      "pageTitle": "Linear",
      "timestamp": 1234567890,
      "element": null
    }
  ],
  "startedAt": 1234567890,
  "completedAt": 1234567891,
  "processed": true,
  "proceduralMemoryId": "memory-uuid"
}
```

### Procedural Memory Structure
```json
{
  "id": "memory-uuid",
  "title": "Create Linear Issue",
  "abstract": {
    "goal": "Create issue in Linear",
    "parameters": ["title", "description", "assignee"],
    "prerequisites": ["User must be logged into linear.app"],
    "flow": [
      "Navigate to Linear",
      "Open issue form",
      "Fill details",
      "Submit"
    ],
    "domains": ["linear.app"],
    "tags": ["project_management", "issue_tracking", "creation"]
  },
  "steps": [...],
  "createdAt": 1234567890,
  "updatedAt": 1234567890,
  "successCount": 0,
  "failureCount": 0,
  "confidence": 0.5,
  "deprecated": false,
  "source": "human_demo",
  "sourceSessionId": "recording-uuid"
}
```

---

## Limitations

Currently, the recorder **only automatically captures**:
- ✅ URL navigation
- ✅ Tab switches

**Not captured automatically:**
- ❌ Click events
- ❌ Text input
- ❌ Form submissions
- ❌ Dropdown selections

To test the full BUILD phase, you'd need to:
1. Navigate to several pages
2. Switch tabs a few times
3. This will create a simple but valid procedural memory

For a complete demo, you'd need to integrate recording into action execution (see README in `chrome-extension/src/background/memory/`).

---

## Next Steps

After testing via console, you can:
1. Build a UI for recording control (see Option 2 below)
2. View memories in a dedicated panel
3. Test the RETRIEVE phase (not yet implemented)

