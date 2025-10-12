# Nanobrowser WebSocket API 1.0.0 documentation

* License: [MIT](https://github.com/qusiypydev/nanobrowser-websocket-host/blob/master/LICENSE)
* Support: [Nanobrowser API Support](https://github.com/qusiypydev/nanobrowser-websocket-host)

WebSocket API for bidirectional communication between external servers and the Nanobrowser Chrome extension.

This API enables remote task execution and real-time event streaming for AI-powered browser automation.

## Overview

- **Task Execution**: Send web automation tasks to Nanobrowser
- **Event Streaming**: Receive real-time execution progress updates
- **Health Checks**: Ping/pong heartbeat mechanism

## Connection

Default WebSocket URL: `ws://localhost:8080`

The extension can be configured to connect to any WebSocket server through the extension options page.

## Message Format

All messages are JSON-encoded strings with a `type` field that discriminates the message type.

## Message Flow

1. Server sends `ExecuteTaskMessage` to request task execution
2. Extension responds with `TaskAcceptedMessage` or `TaskRejectedMessage`
3. Extension streams `ExecutionEventMessage` updates during task execution
4. Server can send `PingMessage` for health checks, extension responds with `PongMessage`


## Table of Contents

* [Servers](#servers)
  * [production](#production-server)
* [Operations](#operations)
  * [SEND /](#send--operation)
  * [RECEIVE /](#receive--operation)
  * [RECEIVE /](#receive--operation)
  * [SEND /](#send--operation)
  * [RECEIVE /](#receive--operation)

## Servers

### `production` Server

* URL: `ws://localhost:8080/`
* Protocol: `ws 13`

Default local WebSocket server

##### Server tags

| Name | Description | Documentation |
|---|---|---|
| environment | Local development server | - |


## Operations

### SEND `/` Operation

*Send a task execution request to the extension*

* Operation ID: `sendTaskExecution`

Main channel for task execution and event streaming.

## Server → Extension (Publish)
- `ExecuteTaskMessage`: Request task execution
- `PingMessage`: Health check request

## Extension → Server (Subscribe)
- `TaskAcceptedMessage`: Task accepted for execution
- `TaskRejectedMessage`: Task rejected (with reason)
- `ExecutionEventMessage`: Real-time execution progress
- `PongMessage`: Health check response


Request the Nanobrowser extension to execute a web automation task.

The extension will respond with either a `TaskAcceptedMessage` or `TaskRejectedMessage`.

If accepted, the extension will stream `ExecutionEventMessage` updates during task execution.


#### Message Execute Task Request `ExecuteTaskMessage`

*Request to execute a web automation task*

* Message ID: `executeTask`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | Payload for requesting task execution | - | - | **additional properties are allowed** |
| type | string | Message type discriminator | const (`"execute_task"`) | - | **required** |
| taskId | string | Unique identifier for the task | - | <= 1000 characters | **required** |
| prompt | string | Natural language description of the task to execute | - | <= 100000 characters | **required** |
| metadata | object | Optional metadata for task context | - | - | **additional properties are allowed** |
| metadata.priority | number | Task priority (higher = more important) | - | - | - |
| metadata.timeout | number | Task timeout in milliseconds | - | - | - |

> Examples of payload

_basicTask_

Basic task execution

```json
{
  "type": "execute_task",
  "taskId": "task-12345",
  "prompt": "Navigate to example.com and click the login button"
}
```


_taskWithMetadata_

Task with priority metadata

```json
{
  "type": "execute_task",
  "taskId": "task-67890",
  "prompt": "Fill out the registration form with test data",
  "metadata": {
    "priority": 1,
    "timeout": 30000
  }
}
```



### RECEIVE `/` Operation

*Receive task acceptance or rejection response*

* Operation ID: `receiveTaskResponse`

Main channel for task execution and event streaming.

## Server → Extension (Publish)
- `ExecuteTaskMessage`: Request task execution
- `PingMessage`: Health check request

## Extension → Server (Subscribe)
- `TaskAcceptedMessage`: Task accepted for execution
- `TaskRejectedMessage`: Task rejected (with reason)
- `ExecutionEventMessage`: Real-time execution progress
- `PongMessage`: Health check response


After sending an `ExecuteTaskMessage`, the server will receive either:
- `TaskAcceptedMessage`: Task accepted and will be executed
- `TaskRejectedMessage`: Task rejected with reason (e.g., already executing, invalid request)


Receive **one of** the following messages:

#### Message Task Accepted Response `TaskAcceptedMessage`

*Confirmation that task was accepted for execution*

* Message ID: `taskAccepted`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | Payload confirming task acceptance | - | - | **additional properties are allowed** |
| type | string | Message type discriminator | const (`"task_accepted"`) | - | **required** |
| taskId | string | ID of the accepted task | - | - | **required** |
| timestamp | number | Unix timestamp when task was accepted | - | - | **required** |

> Examples of payload

_accepted_

Task accepted

```json
{
  "type": "task_accepted",
  "taskId": "task-12345",
  "timestamp": 1697097600000
}
```


#### Message Task Rejected Response `TaskRejectedMessage`

*Task was rejected with a reason*

* Message ID: `taskRejected`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | Payload indicating task rejection | - | - | **additional properties are allowed** |
| type | string | Message type discriminator | const (`"task_rejected"`) | - | **required** |
| taskId | string | ID of the rejected task | - | - | **required** |
| reason | string | Human-readable reason for rejection | allowed (`"Already executing a task"`, `"Invalid taskId - must be a non-empty string"`, `"Invalid prompt - must be a non-empty string"`, `"No active tab found"`, `"Task execution failed"`) | - | **required** |
| timestamp | number | Unix timestamp when task was rejected | - | - | **required** |

> Examples of payload

_alreadyExecuting_

Rejected due to concurrent execution

```json
{
  "type": "task_rejected",
  "taskId": "task-12345",
  "reason": "Already executing a task",
  "timestamp": 1697097600000
}
```


_invalidRequest_

Rejected due to validation failure

```json
{
  "type": "task_rejected",
  "taskId": "task-67890",
  "reason": "Invalid prompt - must be a non-empty string",
  "timestamp": 1697097600000
}
```



### RECEIVE `/` Operation

*Receive real-time task execution progress updates*

* Operation ID: `receiveExecutionEvents`

Main channel for task execution and event streaming.

## Server → Extension (Publish)
- `ExecuteTaskMessage`: Request task execution
- `PingMessage`: Health check request

## Extension → Server (Subscribe)
- `TaskAcceptedMessage`: Task accepted for execution
- `TaskRejectedMessage`: Task rejected (with reason)
- `ExecutionEventMessage`: Real-time execution progress
- `PongMessage`: Health check response


During task execution, the extension streams progress updates as `ExecutionEventMessage`.

Events include:
- Task lifecycle (start, ok, fail, cancel)
- Step progress (start, ok, fail)
- Action execution (start, ok, fail)

Each event includes the actor (system, user, planner, navigator) and detailed data.


#### Message Execution Event Update `ExecutionEventMessage`

*Real-time task execution progress update*

* Message ID: `executionEvent`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | Payload containing execution progress update | - | - | **additional properties are allowed** |
| type | string | Message type discriminator | const (`"execution_event"`) | - | **required** |
| taskId | string | ID of the executing task | - | - | **required** |
| event | object | Event representing a state change in task execution | - | - | **required**, **additional properties are allowed** |
| event.actor | string | The component that triggered this event | allowed (`"system"`, `"user"`, `"planner"`, `"navigator"`) | - | **required** |
| event.state | string | The execution state that changed | allowed (`"task.start"`, `"task.ok"`, `"task.fail"`, `"task.pause"`, `"task.resume"`, `"task.cancel"`, `"step.start"`, `"step.ok"`, `"step.fail"`, `"step.cancel"`, `"act.start"`, `"act.ok"`, `"act.fail"`) | - | **required** |
| event.type | string | Event type (currently only execution events are supported) | const (`"execution"`) | - | **required** |
| event.timestamp | number | Unix timestamp when event occurred | - | - | **required** |
| event.data | object | Data associated with an execution event | - | - | **required**, **additional properties are allowed** |
| event.data.taskId | string | ID of the task being executed | - | - | **required** |
| event.data.step | number | Current step number (0-based) | - | >= 0 | **required** |
| event.data.maxSteps | number | Maximum number of steps in the task | - | >= 1 | **required** |
| event.data.details | string | Human-readable description of what happened | - | - | **required** |
| timestamp | number | Unix timestamp when event was sent | - | - | **required** |

> Examples of payload

_taskStart_

Task execution started

```json
{
  "type": "execution_event",
  "taskId": "task-12345",
  "timestamp": 1697097601000,
  "event": {
    "actor": "system",
    "state": "task.start",
    "type": "execution",
    "timestamp": 1697097601000,
    "data": {
      "taskId": "task-12345",
      "step": 0,
      "maxSteps": 5,
      "details": "Starting task execution"
    }
  }
}
```


_navigationAction_

Navigator performing action

```json
{
  "type": "execution_event",
  "taskId": "task-12345",
  "timestamp": 1697097602000,
  "event": {
    "actor": "navigator",
    "state": "act.start",
    "type": "execution",
    "timestamp": 1697097602000,
    "data": {
      "taskId": "task-12345",
      "step": 1,
      "maxSteps": 5,
      "details": "Navigating to: https://example.com"
    }
  }
}
```


_taskComplete_

Task completed successfully

```json
{
  "type": "execution_event",
  "taskId": "task-12345",
  "timestamp": 1697097610000,
  "event": {
    "actor": "system",
    "state": "task.ok",
    "type": "execution",
    "timestamp": 1697097610000,
    "data": {
      "taskId": "task-12345",
      "step": 5,
      "maxSteps": 5,
      "details": "Task completed successfully"
    }
  }
}
```



### SEND `/` Operation

*Send a ping heartbeat message*

* Operation ID: `sendPing`

Main channel for task execution and event streaming.

## Server → Extension (Publish)
- `ExecuteTaskMessage`: Request task execution
- `PingMessage`: Health check request

## Extension → Server (Subscribe)
- `TaskAcceptedMessage`: Task accepted for execution
- `TaskRejectedMessage`: Task rejected (with reason)
- `ExecutionEventMessage`: Real-time execution progress
- `PongMessage`: Health check response


Send a ping message to check if the extension is alive and responsive.

The extension will respond with a `PongMessage`.


#### Message Ping Heartbeat `PingMessage`

*Health check request*

* Message ID: `ping`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | Payload for heartbeat ping | - | - | **additional properties are allowed** |
| type | string | Message type discriminator | const (`"ping"`) | - | **required** |
| timestamp | number | Unix timestamp when ping was sent | - | - | **required** |

> Examples of payload

_ping_

Heartbeat ping

```json
{
  "type": "ping",
  "timestamp": 1697097600000
}
```



### RECEIVE `/` Operation

*Receive pong response to ping*

* Operation ID: `receivePong`

Main channel for task execution and event streaming.

## Server → Extension (Publish)
- `ExecuteTaskMessage`: Request task execution
- `PingMessage`: Health check request

## Extension → Server (Subscribe)
- `TaskAcceptedMessage`: Task accepted for execution
- `TaskRejectedMessage`: Task rejected (with reason)
- `ExecutionEventMessage`: Real-time execution progress
- `PongMessage`: Health check response


Receive a pong response confirming the extension is alive and responsive.


#### Message Pong Response `PongMessage`

*Health check response*

* Message ID: `pong`
* Content type: [application/json](https://www.iana.org/assignments/media-types/application/json)

##### Payload

| Name | Type | Description | Value | Constraints | Notes |
|---|---|---|---|---|---|
| (root) | object | Payload for heartbeat pong response | - | - | **additional properties are allowed** |
| type | string | Message type discriminator | const (`"pong"`) | - | **required** |
| timestamp | number | Unix timestamp when pong was sent | - | - | **required** |

> Examples of payload

_pong_

Heartbeat pong

```json
{
  "type": "pong",
  "timestamp": 1697097600000
}
```



