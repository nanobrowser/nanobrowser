# AWS AppSync Events Integration for Chrome Extension - Using Amplify Events Client

## Project Overview
This is a Chrome extension project (`/Users/balaji/Work/CloudCerebro/OAP/nanobrowser/`) that uses LLM to perform automated tasks on websites. The project uses:

- **Tech Stack**: TypeScript, Chrome Extension Manifest V3, LangChain, Vite, pnpm workspaces
- **Architecture**: Background service worker with agent system (Planner, Navigator, Validator)
- **Current Communication**: Chrome runtime messaging with long-lived connections
- **Storage**: Custom storage system using chrome.storage API
- **Event System**: Existing EventManager for internal task execution events

## Current Architecture Analysis

### Key Components:
1. **Background Script** (`chrome-extension/src/background/index.ts`): Main service worker handling task execution
2. **Agent System** (`chrome-extension/src/background/agent/`): Contains Planner, Navigator, Validator agents
3. **Event Manager** (`chrome-extension/src/background/agent/event/manager.ts`): Handles internal execution events
4. **Executor** (`chrome-extension/src/background/agent/executor.ts`): Manages task execution lifecycle
5. **Storage System** (`packages/storage/`): Configuration and data persistence
6. **Browser Context** (`chrome-extension/src/background/browser/context.ts`): Manages browser interactions

### Current Event Types:
- Task lifecycle: start, ok, fail, cancel, pause, resume
- Step execution events  
- Action execution events
- Internal communication via chrome.runtime.onConnect

## Implementation Requirements

### 1. AWS Amplify Events Client Setup

**Add Dependencies:**
```json
// chrome-extension/package.json
{
  "dependencies": {
    "aws-amplify": "^6.0.0"
  }
}
```

**Chrome Extension Manifest Permissions:**
```json
// chrome-extension/manifest.js - Add to permissions
"permissions": [
  "storage",
  "tabs",
  "debugger",
  "sidePanel",
  "activeTab"
],
"host_permissions": [
  "https://*.aws-appsync.*.amazonaws.com/*"
]
```

### 2. Instance ID Management

**Create Instance ID Service:**
- Generate unique instance ID per extension installation
- Store in chrome.storage.local with persistence
- Format: `ext_${chrome.runtime.id}_${timestamp}_${randomHash}`
- Use as channel identifier for AppSync subscription

**Files to Create:**
- `chrome-extension/src/background/services/instanceId.ts`
- `packages/storage/lib/settings/instanceId.ts`

```typescript
// Instance ID Service Interface
interface InstanceIdService {
  getInstanceId(): Promise<string>;
  generateNewInstanceId(): Promise<string>;
  getChannelName(): string; // Returns `/default/${instanceId}`
}
```

### 3. Amplify Configuration Management

**Extend Storage System:**
Add Amplify Events configuration to settings following AWS documentation pattern:

```typescript
// packages/storage/lib/settings/amplifyConfig.ts
interface AmplifyEventsConfig {
  enabled: boolean;
  endpoint: string; // AppSync Event API endpoint
  region: string;
  defaultAuthMode: 'apiKey'; // Must be 'apiKey' not 'API_KEY'
  apiKey: string;
  channelNamespace: string; // Default: 'default'
}

// Configuration file structure (amplify_outputs.json equivalent)
interface AmplifyOutputs {
  API: {
    Events: {
      endpoint: string;
      region: string;
      defaultAuthMode: 'apiKey';
      apiKey: string;
    }
  }
}
```

### 4. AppSync Event Types and Channel Structure

**Channel Naming Convention:**
- Instance-specific channel: `/default/${instanceId}`
- Command structure: Send events to instance channel
- Response channel: `/default/${instanceId}/response` (optional)

**Event Payload Schema:**
```typescript
// chrome-extension/src/background/services/appSyncEvents/types.ts
interface AppSyncEventPayload {
  eventId: string; // Unique event identifier
  timestamp: number;
  instanceId: string; // Target instance ID
  actionType: 'NEW_SESSION' | 'SEND_CHAT' | 'STOP_CHAT' | 'FOLLOW_UP_CHAT' | 'SET_MODEL';
  
  // Action-specific data
  sessionId?: string;
  taskId?: string;
  message?: string;
  modelConfig?: {
    agent: 'Planner' | 'Navigator' | 'Validator';
    provider: string;
    model: string;
  };
  metadata?: Record<string, any>;
}

interface AppSyncEventResponse {
  eventId: string;
  instanceId: string;
  status: 'success' | 'error' | 'processing';
  result?: any;
  error?: string;
  timestamp: number;
}
```

### 5. Amplify Events Service Implementation

**Create Amplify Events Service:**
`chrome-extension/src/background/services/amplifyEventsService.ts`

**Key Implementation Using Amplify Events Client:**
```typescript
import { Amplify } from 'aws-amplify';
import { events } from 'aws-amplify/data';

class AmplifyEventsService {
  private channel: any = null;
  private instanceId: string;
  private config: AmplifyEventsConfig;
  
  async initialize() {
    // Configure Amplify with Event API settings
    const amplifyConfig = {
      API: {
        Events: {
          endpoint: this.config.endpoint,
          region: this.config.region,
          defaultAuthMode: this.config.defaultAuthMode,
          apiKey: this.config.apiKey
        }
      }
    };
    
    Amplify.configure(amplifyConfig);
    
    // Connect to instance-specific channel
    const channelPath = `/default/${this.instanceId}`;
    this.channel = await events.connect(channelPath);
    
    // Subscribe to events
    this.channel.subscribe({
      next: (data) => this.handleIncomingEvent(data),
      error: (error) => this.handleConnectionError(error)
    });
  }
  
  async sendResponse(response: AppSyncEventResponse) {
    const responsePath = `/default/${this.instanceId}/response`;
    await events.post(responsePath, response);
  }
  
  async handleIncomingEvent(data: AppSyncEventPayload) {
    // Route to appropriate action handler
    // Send processing status immediately
    // Execute action and send final response
  }
  
  async cleanup() {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
  }
}
```

### 6. Event Handler Integration

**Modify Background Script:**
Update `chrome-extension/src/background/index.ts` to:

```typescript
import { AmplifyEventsService } from './services/amplifyEventsService';

let amplifyEventsService: AmplifyEventsService | null = null;

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  await initializeAmplifyEvents();
});

chrome.runtime.onInstalled.addListener(async () => {
  await initializeAmplifyEvents();
});

async function initializeAmplifyEvents() {
  try {
    const config = await getAmplifyConfig();
    if (config.enabled) {
      amplifyEventsService = new AmplifyEventsService();
      await amplifyEventsService.initialize();
    }
  } catch (error) {
    console.error('Failed to initialize Amplify Events:', error);
  }
}

// Add event handlers for AppSync events
async function handleAppSyncEvent(event: AppSyncEventPayload) {
  const eventId = event.eventId;
  
  try {
    // Send immediate processing response
    await amplifyEventsService?.sendResponse({
      eventId,
      instanceId: event.instanceId,
      status: 'processing',
      timestamp: Date.now()
    });
    
    let result;
    
    switch (event.actionType) {
      case 'NEW_SESSION':
        result = await handleNewSession(event);
        break;
      case 'SEND_CHAT':
        result = await handleSendChat(event);
        break;
      case 'STOP_CHAT':
        result = await handleStopChat(event);
        break;
      case 'FOLLOW_UP_CHAT':
        result = await handleFollowUpChat(event);
        break;
      case 'SET_MODEL':
        result = await handleSetModel(event);
        break;
      default:
        throw new Error(`Unknown action type: ${event.actionType}`);
    }
    
    // Send success response
    await amplifyEventsService?.sendResponse({
      eventId,
      instanceId: event.instanceId,
      status: 'success',
      result,
      timestamp: Date.now()
    });
    
  } catch (error) {
    // Send error response
    await amplifyEventsService?.sendResponse({
      eventId,
      instanceId: event.instanceId,
      status: 'error',
      error: error.message,
      timestamp: Date.now()
    });
  }
}
```

### 7. Action Implementation Details

**Action 1: Create New Session**
```typescript
async function handleNewSession(event: AppSyncEventPayload) {
  const taskId = event.taskId || generateTaskId();
  const message = event.message;
  
  if (!message) {
    throw new Error('Message is required for new session');
  }
  
  // Use existing setupExecutor logic
  currentExecutor = await setupExecutor(taskId, message, browserContext);
  subscribeToExecutorEvents(currentExecutor);
  
  // Start execution in background
  currentExecutor.execute().catch(error => {
    console.error('Task execution failed:', error);
  });
  
  return {
    sessionId: taskId,
    status: 'started',
    message: 'New session created and task started'
  };
}
```

**Action 2: Send New Chat to Session**
```typescript
async function handleSendChat(event: AppSyncEventPayload) {
  const { sessionId, message } = event;
  
  if (!sessionId || !message) {
    throw new Error('SessionId and message are required');
  }
  
  // Create new executor for the session
  const taskId = sessionId;
  currentExecutor = await setupExecutor(taskId, message, browserContext);
  subscribeToExecutorEvents(currentExecutor);
  
  const result = await currentExecutor.execute();
  
  return {
    sessionId,
    taskId,
    status: 'completed',
    result
  };
}
```

**Action 3: Stop Current Processing Chat**
```typescript
async function handleStopChat(event: AppSyncEventPayload) {
  const { sessionId } = event;
  
  if (!currentExecutor) {
    throw new Error('No active task to stop');
  }
  
  await currentExecutor.cancel();
  
  return {
    sessionId,
    status: 'stopped',
    message: 'Task execution stopped'
  };
}
```

**Action 4: Send Follow-up Chat**
```typescript
async function handleFollowUpChat(event: AppSyncEventPayload) {
  const { sessionId, message } = event;
  
  if (!sessionId || !message || !currentExecutor) {
    throw new Error('SessionId, message and active executor are required');
  }
  
  currentExecutor.addFollowUpTask(message);
  subscribeToExecutorEvents(currentExecutor);
  const result = await currentExecutor.execute();
  
  return {
    sessionId,
    status: 'completed',
    result
  };
}
```

**Action 5: Choose Model for Agent**
```typescript
async function handleSetModel(event: AppSyncEventPayload) {
  const { modelConfig } = event;
  
  if (!modelConfig || !modelConfig.agent || !modelConfig.provider || !modelConfig.model) {
    throw new Error('Complete model configuration is required');
  }
  
  // Update agent model store
  await agentModelStore.setAgentModel(
    modelConfig.agent,
    {
      provider: modelConfig.provider,
      model: modelConfig.model
    }
  );
  
  // If there's an active executor, update its models
  if (currentExecutor) {
    await currentExecutor.updateAgentModel(modelConfig.agent, {
      provider: modelConfig.provider,
      model: modelConfig.model
    });
  }
  
  return {
    agent: modelConfig.agent,
    provider: modelConfig.provider,
    model: modelConfig.model,
    status: 'updated',
    message: `${modelConfig.agent} model updated to ${modelConfig.provider}/${modelConfig.model}`
  };
}
```

### 8. Error Handling and Reconnection

**Connection Management:**
```typescript
class AmplifyEventsService {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  
  async handleConnectionError(error: any) {
    console.error('Amplify Events connection error:', error);
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      
      setTimeout(() => {
        this.initialize().catch(console.error);
      }, delay);
    }
  }
  
  onConnectionRestored() {
    this.reconnectAttempts = 0;
    console.log('Amplify Events connection restored');
  }
}
```

### 9. Configuration UI Integration

**Extend Options Page:**
Add Amplify Events configuration section with:

```typescript
// Configuration form fields
interface AmplifyConfigForm {
  enabled: boolean;
  endpoint: string; // AppSync Event API endpoint
  region: string;
  apiKey: string;
  channelNamespace: string;
}

// UI Components
- Enable/disable toggle
- Connection status indicator  
- Instance ID display (read-only)
- Configuration form (endpoint, region, API key)
- Test connection button
- Connection logs/status
```

### 10. Development and Testing

**Local Testing Setup:**
1. Create Event API in AWS AppSync console
2. Download `amplify_outputs.json` equivalent configuration
3. Test connection with Pub/Sub Editor in AppSync console
4. Send test events to instance channel: `/default/${instanceId}`

**Test Event Examples:**
```json
// New Session
{
  "eventId": "test-001",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "NEW_SESSION",
  "message": "Navigate to google.com and search for 'AI automation'",
  "metadata": {}
}

// Set Model
{
  "eventId": "test-002", 
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SET_MODEL",
  "modelConfig": {
    "agent": "Navigator",
    "provider": "openai",
    "model": "gpt-4"
  }
}
```

### 11. File Structure

**New Files to Create:**
```
chrome-extension/src/background/services/
├── amplifyEventsService.ts
├── instanceId.ts
└── appSyncEvents/
    ├── types.ts
    ├── handlers.ts
    └── connection.ts

packages/storage/lib/settings/
├── amplifyConfig.ts
└── instanceId.ts
```

### 12. Implementation Priority

**Phase 1: Core Infrastructure**
1. Instance ID service and storage
2. Amplify configuration storage and UI
3. Basic Amplify Events service connection using `events.connect()`

**Phase 2: Event Subscription**
1. Channel subscription setup with `/default/${instanceId}` pattern
2. Event payload validation and routing
3. Response mechanism using `events.post()`

**Phase 3: Action Implementation**
1. Map AppSync events to existing task execution handlers
2. Implement all 5 action types
3. Error handling and status reporting

**Phase 4: Polish & Testing**
1. Reconnection logic and connection management
2. Configuration UI completion
3. Testing with AWS AppSync console Pub/Sub Editor
4. Performance optimization and cleanup

## Key Integration Considerations

1. **Amplify Events Pattern**: Use `events.connect()` and `events.post()` instead of raw GraphQL
2. **Channel Naming**: Follow `/namespace/channel` pattern with instance-specific channels
3. **Configuration**: Use `amplify_outputs.json` structure for configuration
4. **Authentication**: Must use `defaultAuthMode: 'apiKey'` (not `API_KEY`)
5. **Chrome Extension Constraints**: Service worker limitations and manifest permissions
6. **Event Correlation**: Link AppSync events to existing task execution system
7. **Resource Management**: Proper cleanup of channel connections
8. **Backward Compatibility**: Extension works with AppSync disabled

## Expected Outcomes

After implementation:
- Extension instances receive real-time commands via AppSync Event API
- Each browser extension has unique channel subscription (`/default/${instanceId}`)
- All existing functionality preserved and enhanced
- Seamless integration between local task execution and remote commands
- Robust error handling and connection management using Amplify Events client
- Administrative control over extension behavior via AppSync events
- Proper response mechanism for command execution status