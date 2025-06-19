# Nanobrowser Chat Flow Overview

This document explains the sequence of calls that take place when a user sends a message through the extension's side panel. Line numbers below come from the current repository so you can easily jump to the corresponding code.

## 1. User Flow
**a. Typing in ChatInput**
- `ChatInput` (lines 1‑100) defines a textarea and a `handleSubmit` callback that invokes `onSendMessage` when Enter is pressed【F:pages/side-panel/src/components/ChatInput.tsx†L1-L82】.

**b. SidePanel handles the send**
- `handleSendMessage` in `SidePanel.tsx` performs the main work. The function starts around line 419 and continues to 507【F:pages/side-panel/src/SidePanel.tsx†L419-L508】:
  1. Trim the text and check for slash commands.
  2. Query the active tab to obtain `tabId`.
  3. Disable the input and create a new chat session with `chatHistoryStore.createSession` if needed.
  4. Append the user message to state and history.
  5. Open a connection to the service worker via `setupConnection` if one doesn't exist.
  6. Send either a `new_task` or `follow_up_task` message through the `port`.

**c. Connection management**
- `setupConnection` (lines 274‑333) creates the long‑lived port and listens for messages from the background script【F:pages/side-panel/src/SidePanel.tsx†L274-L333】. Incoming events trigger `handleTaskState` and various error handlers.

**d. Event handling**
- `handleTaskState` (lines 129‑214) interprets agent events such as `TASK_OK` or `STEP_START` and appends appropriate messages to the chat log【F:pages/side-panel/src/SidePanel.tsx†L129-L214】.

## 2. LLM Agent Behavior
**a. Background entry point**
- The service worker listens for connections at `chrome.runtime.onConnect` (lines 95‑238)【F:chrome-extension/src/background/index.ts†L95-L238】. When it receives a `new_task`, it calls `setupExecutor` and then `Executor.execute()`.

**b. Setting up the Executor**
- `setupExecutor` (lines 249‑320) loads model settings, firewall rules and general options before instantiating `Executor`【F:chrome-extension/src/background/index.ts†L249-L320】. It also picks the appropriate LLM models for the Navigator, Planner and Validator agents.

**c. Execution loop**
- Inside `Executor.execute` (lines 113‑201) the agent performs iterative steps【F:chrome-extension/src/background/agent/executor.ts†L113-L201】:
  1. Emit `TASK_START`.
  2. Every step runs the planner when necessary (lines 138‑180).
  3. `navigate()` runs the NavigatorAgent which performs clicks or typing (line 182 onwards).
  4. When `done` is true the validator may run to check the output (lines 187‑199).
  5. Final task state events (`TASK_OK`, `TASK_FAIL`, `TASK_CANCEL`) are emitted at lines 203‑211.

- Navigation itself happens in `navigate()` (lines 223‑261) which calls `this.navigator.execute()` and handles failures or pauses【F:chrome-extension/src/background/agent/executor.ts†L223-L261】.

## 3. DOM Interaction
**a. Script injection**
- The service worker injects `buildDomTree.js` into pages on tab updates (lines 28‑65 in `index.ts`) so DOM traversal functions become available【F:chrome-extension/src/background/index.ts†L28-L65】.

**b. Collecting DOM state**
- `DOMService.getClickableElements` ultimately calls `_buildDomTree` to execute `window.buildDomTree` and returns the `elementTree` and `selectorMap`【F:chrome-extension/src/background/browser/dom/service.ts†L64-L113】.

**c. Performing actions**
- Page actions use the selector map:
  - Typing is handled by `Page.inputTextElementNode` (lines 823‑919) which prepares the element, types or sets its value, and dispatches input events【F:chrome-extension/src/background/browser/page.ts†L823-L919】.
  - Clicking is implemented in `Page.clickElementNode` (lines 1006‑1045) with a fallback in case Puppeteer’s click fails【F:chrome-extension/src/background/browser/page.ts†L1006-L1045】.

## 4. Response Lifecycle
- Messages from the service worker travel back through the port established in `setupConnection`. `SidePanel` listens with `port.onMessage` (lines 274‑333) and forwards execution events to `handleTaskState` which appends them to the UI and toggles buttons.
- When the agent finishes or errors, `Executor` emits `ExecutionState` events which `subscribeToExecutorEvents` relays to the side panel (lines 323‑345 in `index.ts`)【F:chrome-extension/src/background/index.ts†L323-L345】.
- `handleTaskState` determines how each event affects the UI: progress updates show a spinner, final states re‑enable text entry, etc.【F:pages/side-panel/src/SidePanel.tsx†L129-L214】.

## 5. Overall Architecture
- **Side Panel (React)** – user interface for chat and history; stores sessions in `packages/storage` and communicates via a `chrome.runtime.Port`.
- **Background Service Worker** – receives tasks, spins up the `Executor`, and streams back agent events. It also injects DOM scripts and performs speech‑to‑text when requested.
- **Browser Context/Page** – manages Puppeteer connections to tabs (`BrowserContext` and `Page` classes) and exposes actions like navigation, clicking and typing.
- **Agents** – NavigatorAgent, PlannerAgent and ValidatorAgent collaborate inside `Executor` to plan, execute and validate actions against the browser state.

Together these components allow a text prompt from the side panel to drive a multi‑step browsing workflow, sending DOM state to the LLM, executing planned actions, and streaming progress back into the chat interface.
