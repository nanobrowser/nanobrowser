# Nanobrowser WebSocket API Documentation

This directory contains the AsyncAPI specification for the Nanobrowser WebSocket integration.

## Overview

The Nanobrowser WebSocket API enables bidirectional communication between external servers and the Nanobrowser Chrome extension for remote task execution and real-time event streaming.

## Quick Start

### Connection

**Default WebSocket URL**: `ws://localhost:8080`

The extension can be configured to connect to any WebSocket server through the extension options page:

1. Open Nanobrowser extension options
2. Navigate to "WebSocket" tab
3. Enable WebSocket connection
4. Enter your server URL
5. Configure timeout (1-30 seconds)

### Message Format

All messages are JSON-encoded strings with a `type` field for message discrimination.

### Basic Flow

```
Server                          Extension
  |                                |
  |--- ExecuteTaskMessage -------->|
  |                                |
  |<-- TaskAcceptedMessage --------|
  |                                |
  |<-- ExecutionEventMessage ------|
  |<-- ExecutionEventMessage ------|
  |<-- ExecutionEventMessage ------|
  |                                |
```

## API Specification

The complete API specification is defined in `asyncapi.yaml` using AsyncAPI 3.0 format.

### Viewing the Specification

**Option 1: AsyncAPI Studio (Recommended)**
```bash
# Visit: https://studio.asyncapi.com/
# Then import the asyncapi.yaml file
```

**Option 2: AsyncAPI CLI**
```bash
npm install -g @asyncapi/cli
asyncapi preview asyncapi.yaml
```

**Option 3: AsyncAPI Generator**
```bash
# Generate HTML documentation
asyncapi generate fromTemplate asyncapi.yaml @asyncapi/html-template -o ./docs-html

# Generate Markdown documentation
asyncapi generate fromTemplate asyncapi.yaml @asyncapi/markdown-template -o ./docs-markdown
```

## Message Types

### Server → Extension (Incoming)

| Message Type | Description |
|-------------|-------------|
| `ExecuteTaskMessage` | Request task execution with natural language prompt |
| `PingMessage` | Health check request |

### Extension → Server (Outgoing)

| Message Type | Description |
|-------------|-------------|
| `TaskAcceptedMessage` | Task accepted for execution |
| `TaskRejectedMessage` | Task rejected with reason |
| `ExecutionEventMessage` | Real-time execution progress update |
| `PongMessage` | Health check response |

## Message Examples

### Request Task Execution

```json
{
  "type": "execute_task",
  "taskId": "task-12345",
  "prompt": "Navigate to example.com and click the login button",
  "metadata": {
    "priority": 1,
    "timeout": 30000
  }
}
```

### Task Accepted

```json
{
  "type": "task_accepted",
  "taskId": "task-12345",
  "timestamp": 1697097600000
}
```

### Task Rejected

```json
{
  "type": "task_rejected",
  "taskId": "task-12345",
  "reason": "Already executing a task",
  "timestamp": 1697097600000
}
```

### Execution Event

```json
{
  "type": "execution_event",
  "taskId": "task-12345",
  "timestamp": 1697097601000,
  "event": {
    "actor": "navigator",
    "state": "act.start",
    "type": "execution",
    "timestamp": 1697097601000,
    "data": {
      "taskId": "task-12345",
      "step": 1,
      "maxSteps": 5,
      "details": "Navigating to: https://example.com"
    }
  }
}
```

### Heartbeat

**Ping Request:**
```json
{
  "type": "ping",
  "timestamp": 1697097600000
}
```

**Pong Response:**
```json
{
  "type": "pong",
  "timestamp": 1697097600000
}
```

## Execution States

### Task States
- `task.start` - Task execution started
- `task.ok` - Task completed successfully
- `task.fail` - Task failed
- `task.pause` - Task paused
- `task.resume` - Task resumed
- `task.cancel` - Task cancelled

### Step States
- `step.start` - Step started
- `step.ok` - Step completed successfully
- `step.fail` - Step failed
- `step.cancel` - Step cancelled

### Action States
- `act.start` - Action started
- `act.ok` - Action completed successfully
- `act.fail` - Action failed

## Actors

- `system` - System-level operations
- `user` - User-initiated actions
- `planner` - High-level task planning agent
- `navigator` - Browser automation agent

## Error Handling

### Task Rejection Reasons

- `Already executing a task` - Extension can only execute one task at a time
- `Invalid taskId - must be a non-empty string` - TaskId validation failed
- `Invalid prompt - must be a non-empty string` - Prompt validation failed
- `No active tab found` - No browser tab available for automation
- `Task execution failed` - General execution failure

### Connection Errors

The extension implements exponential backoff reconnection:
- Initial delay: 1 second
- Maximum delay: 30 seconds
- Sequence: 1s → 2s → 4s → 8s → 16s → 30s

## Validation Rules

### ExecuteTaskMessage
- `taskId`: Required, non-empty string, max 1000 characters
- `prompt`: Required, non-empty string, max 100KB
- `metadata`: Optional object

### Message Size Limits
- Maximum message size: 1MB
- Maximum taskId length: 1000 characters
- Maximum prompt length: 100KB (102,400 bytes)

## Integration Examples

### Python (Django)

For AI agents: Use the AsyncAPI specification to generate a Python/Django WebSocket client implementation.

**Recommended Tools:**
- [asyncapi-python-paho-template](https://github.com/asyncapi/python-paho-template)
- [websockets](https://pypi.org/project/websockets/) library
- [django-channels](https://channels.readthedocs.io/) for Django integration

### Code Generation

Use AsyncAPI Generator to create client implementations:

```bash
# Generate Python client
asyncapi generate fromTemplate asyncapi.yaml @asyncapi/python-paho-template -o ./python-client

# Generate Node.js client
asyncapi generate fromTemplate asyncapi.yaml @asyncapi/nodejs-template -o ./nodejs-client
```

## Testing

### Manual Testing

1. Start a WebSocket server on `ws://localhost:8080`
2. Configure Nanobrowser to connect to your server
3. Send `ExecuteTaskMessage` from your server
4. Monitor `ExecutionEventMessage` responses

### Test Connection

Use the built-in "Test Connection" feature in the extension options:

1. Open extension options
2. Go to WebSocket tab
3. Click "Test Connection"
4. Verify connection status

## Security Considerations

- **URL Validation**: Only `ws://` or `wss://` protocols accepted
- **Message Validation**: All incoming messages are validated against schema
- **Size Limits**: Messages exceeding limits are rejected
- **Sanitization**: Sensitive data is sanitized in logs
- **Single Task**: Only one task can execute at a time

## Support

For issues, questions, or contributions:
- GitHub: https://github.com/qusiypydev/nanobrowser-websocket-host
- Issues: https://github.com/qusiypydev/nanobrowser-websocket-host/issues

## License

MIT License - See LICENSE file for details
