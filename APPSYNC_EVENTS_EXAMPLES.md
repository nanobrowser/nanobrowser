# AWS AppSync Events API - Event Examples

This document provides comprehensive examples of all events that can be sent to the Chrome extension via AWS AppSync Events API.

## Table of Contents
- [Event Structure](#event-structure)
- [Action Types](#action-types)
- [Event Examples](#event-examples)
  - [NEW_SESSION](#new_session)
  - [SEND_CHAT](#send_chat)
  - [STOP_CHAT](#stop_chat)
  - [FOLLOW_UP_CHAT](#follow_up_chat)
  - [SET_MODEL](#set_model)
- [Response Format](#response-format)
- [Testing with AppSync Console](#testing-with-appsync-console)

## Event Structure

All events sent to the extension must follow this base structure:

```typescript
interface AppSyncEventPayload {
  eventId: string;        // Unique identifier for this event
  timestamp: number;      // Unix timestamp in milliseconds
  instanceId: string;     // Target extension instance ID
  actionType: string;     // One of the supported action types
  
  // Optional action-specific fields
  sessionId?: string;
  taskId?: string;
  message?: string;
  modelConfig?: ModelConfig;
  metadata?: Record<string, any>;
}
```

## Action Types

The extension supports these action types:

1. **NEW_SESSION** - Create a new automation session
2. **SEND_CHAT** - Send a chat message to create a new task
3. **STOP_CHAT** - Stop the currently running task
4. **FOLLOW_UP_CHAT** - Send a follow-up message to the current session
5. **SET_MODEL** - Update the AI model configuration for an agent

## Event Examples

### NEW_SESSION

Creates a new automation session and starts executing the provided task.

#### Basic Example
```json
{
  "eventId": "new-session-001",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "NEW_SESSION",
  "message": "Navigate to google.com and search for 'AI automation tools'"
}
```

#### With Custom Task ID
```json
{
  "eventId": "new-session-002",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "NEW_SESSION",
  "taskId": "custom-task-12345",
  "message": "Go to amazon.com and find the best-selling laptops under $1000"
}
```

#### Complex Web Automation
```json
{
  "eventId": "new-session-003",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "NEW_SESSION",
  "message": "Navigate to linkedin.com, login with my credentials, and send a connection request to John Smith with the message 'Hi John, I'd like to connect with you'",
  "metadata": {
    "priority": "high",
    "category": "social_media"
  }
}
```

#### E-commerce Task
```json
{
  "eventId": "new-session-004",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "NEW_SESSION",
  "message": "Go to ebay.com, search for 'vintage watches', filter by price range $100-$500, and save the first 5 results to a list"
}
```

### SEND_CHAT

Sends a new chat message to create a fresh task (replaces any existing session).

#### Basic Task
```json
{
  "eventId": "send-chat-001",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SEND_CHAT",
  "sessionId": "session-12345",
  "message": "Fill out the contact form on the current page with name 'John Doe', email 'john@example.com', and message 'I'm interested in your services'"
}
```

#### Data Extraction
```json
{
  "eventId": "send-chat-002",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SEND_CHAT",
  "sessionId": "data-extraction-001",
  "message": "Extract all product names, prices, and ratings from this e-commerce page and format them as a table"
}
```

#### Form Automation
```json
{
  "eventId": "send-chat-003",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SEND_CHAT",
  "sessionId": "form-automation-001",
  "message": "Complete the job application form: Name: Sarah Johnson, Email: sarah@email.com, Position: Software Engineer, Experience: 5 years"
}
```

#### Social Media Automation
```json
{
  "eventId": "send-chat-004",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SEND_CHAT",
  "sessionId": "social-001",
  "message": "Post a tweet saying 'Just discovered an amazing new AI tool for web automation! #AI #automation #productivity'"
}
```

### STOP_CHAT

Stops the currently running task/session.

#### Basic Stop
```json
{
  "eventId": "stop-chat-001",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "STOP_CHAT",
  "sessionId": "session-12345"
}
```

#### Emergency Stop
```json
{
  "eventId": "emergency-stop-001",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "STOP_CHAT",
  "sessionId": "current-session",
  "metadata": {
    "reason": "emergency_stop",
    "priority": "critical"
  }
}
```

### FOLLOW_UP_CHAT

Sends a follow-up message to the current active session.

#### Clarification Request
```json
{
  "eventId": "followup-001",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "FOLLOW_UP_CHAT",
  "sessionId": "session-12345",
  "message": "Actually, instead of searching for laptops, please search for desktop computers"
}
```

#### Additional Instructions
```json
{
  "eventId": "followup-002",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "FOLLOW_UP_CHAT",
  "sessionId": "session-12345",
  "message": "Also click on the first result and take a screenshot of the product page"
}
```

#### Correction
```json
{
  "eventId": "followup-003",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "FOLLOW_UP_CHAT",
  "sessionId": "form-session-001",
  "message": "Wait, use 'sarah.johnson@company.com' as the email address instead"
}
```

#### Continue Previous Task
```json
{
  "eventId": "followup-004",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "FOLLOW_UP_CHAT",
  "sessionId": "shopping-session",
  "message": "Now proceed to checkout and use the saved payment method"
}
```

### SET_MODEL

Updates the AI model configuration for a specific agent.

#### Set Navigator Model to GPT-4
```json
{
  "eventId": "set-model-001",
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

#### Set Planner Model to Claude
```json
{
  "eventId": "set-model-002",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SET_MODEL",
  "modelConfig": {
    "agent": "Planner",
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20240620"
  }
}
```

#### Set Validator Model to Gemini
```json
{
  "eventId": "set-model-003",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SET_MODEL",
  "modelConfig": {
    "agent": "Validator",
    "provider": "google",
    "model": "gemini-1.5-pro"
  }
}
```

#### Set Custom OpenAI Model
```json
{
  "eventId": "set-model-004",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SET_MODEL",
  "modelConfig": {
    "agent": "Navigator",
    "provider": "custom_openai_provider_id",
    "model": "gpt-4-custom"
  }
}
```

#### Set Ollama Local Model
```json
{
  "eventId": "set-model-005",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SET_MODEL",
  "modelConfig": {
    "agent": "Planner",
    "provider": "ollama",
    "model": "llama3.1:70b"
  }
}
```

#### Set Bedrock Model
```json
{
  "eventId": "set-model-006",
  "timestamp": 1703123456789,
  "instanceId": "ext_abc123_1703123456_xyz789",
  "actionType": "SET_MODEL",
  "modelConfig": {
    "agent": "Navigator",
    "provider": "bedrock",
    "model": "anthropic.claude-3-5-sonnet-20240620-v1:0"
  }
}
```

## Response Format

The extension sends responses back via the `/default/{instanceId}/response` channel:

### Processing Response
```json
{
  "eventId": "new-session-001",
  "instanceId": "ext_abc123_1703123456_xyz789",
  "status": "processing",
  "timestamp": 1703123456890
}
```

### Success Response
```json
{
  "eventId": "new-session-001",
  "instanceId": "ext_abc123_1703123456_xyz789",
  "status": "success",
  "result": {
    "sessionId": "task_1703123456890_abc123def",
    "taskId": "task_1703123456890_abc123def",
    "status": "started",
    "message": "New session created and task started"
  },
  "timestamp": 1703123457000
}
```

### Error Response
```json
{
  "eventId": "new-session-001",
  "instanceId": "ext_abc123_1703123456_xyz789",
  "status": "error",
  "error": "Invalid event payload: Missing message",
  "timestamp": 1703123456900
}
```

## Testing with AppSync Console

### 1. Using AWS AppSync Console Pub/Sub Editor

1. Navigate to your AppSync Event API in AWS Console
2. Go to "Queries" tab
3. Use the Pub/Sub Editor to send events

### 2. Channel Format
- **Send events to**: `/default/{instanceId}`
- **Listen for responses on**: `/default/{instanceId}/response`

### 3. Example Test Sequence

```javascript
// 1. Send a NEW_SESSION event
{
  "eventId": "test-001",
  "timestamp": Date.now(),
  "instanceId": "YOUR_EXTENSION_INSTANCE_ID",
  "actionType": "NEW_SESSION",
  "message": "Navigate to google.com and search for 'hello world'"
}

// 2. Wait for processing/success response

// 3. Send a FOLLOW_UP_CHAT
{
  "eventId": "test-002", 
  "timestamp": Date.now(),
  "instanceId": "YOUR_EXTENSION_INSTANCE_ID",
  "actionType": "FOLLOW_UP_CHAT",
  "sessionId": "SESSION_ID_FROM_RESPONSE",
  "message": "Click on the first search result"
}

// 4. Send STOP_CHAT if needed
{
  "eventId": "test-003",
  "timestamp": Date.now(),
  "instanceId": "YOUR_EXTENSION_INSTANCE_ID", 
  "actionType": "STOP_CHAT",
  "sessionId": "SESSION_ID_FROM_RESPONSE"
}
```

## Best Practices

### 1. Event IDs
- Use unique, descriptive event IDs
- Include timestamps or sequence numbers
- Format: `{action-type}-{sequence}` or `{category}-{timestamp}`

### 2. Instance ID
- Get the instance ID from the extension options page
- Each browser extension installation has a unique instance ID
- Format: `ext_{chrome_runtime_id}_{timestamp}_{random_hash}`

### 3. Session Management
- NEW_SESSION creates a new session and task
- SEND_CHAT replaces the current session with a new task
- FOLLOW_UP_CHAT adds to the current session
- Use consistent sessionId for follow-ups

### 4. Error Handling
- Always include proper error handling for invalid payloads
- Check response status before sending follow-up events
- Use meaningful error messages in metadata

### 5. Message Guidelines
- Be specific and actionable in messages
- Include all necessary context and parameters
- Use natural language that clearly describes the desired action
- For forms, specify exact field names and values

## Troubleshooting

### Common Issues

1. **"Invalid event payload" error**
   - Check required fields: eventId, timestamp, instanceId, actionType
   - Verify actionType is one of the supported values
   - Ensure message is provided for chat actions

2. **"No active task to stop" error**
   - Occurs when STOP_CHAT is sent but no task is running
   - Check if previous task completed before sending stop

3. **"SessionId, message and active executor are required" error**
   - For FOLLOW_UP_CHAT, ensure there's an active session
   - Send NEW_SESSION or SEND_CHAT first to create a session

4. **Model configuration errors**
   - Verify provider exists in extension settings
   - Check model name matches available models for that provider
   - Ensure agent name is one of: Navigator, Planner, Validator

### Getting Instance ID

To find your extension's instance ID:
1. Open Chrome and load the extension
2. Go to Extension Options page
3. Navigate to "AWS AppSync Events" section
4. Copy the Instance ID (read-only field)