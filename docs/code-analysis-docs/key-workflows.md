# Key Workflows / Interactions
The following key workflows were identified based on code analysis using specified heuristics.

1. [Extension Initialization](#1-extension-initialization)
2. [User Initiates New Task](#2-user-initiates-new-task)
3. [Agent Task Execution Loop](#3-agent-task-execution-loop)
4. [Planner Agent Generates Plan](#4-planner-agent-generates-plan)
5. [Navigator Agent Executes Actions](#5-navigator-agent-executes-actions)
6. [Browser Page Interaction (Click)](#6-browser-page-interaction-click)
7. [Browser Page Interaction (Input Text)](#7-browser-page-interaction-input-text)
8. [Browser Page Interaction (Scroll)](#8-browser-page-interaction-scroll)
9. [Browser Page Interaction (Send Keys)](#9-browser-page-interaction-send-keys)
10. [Browser Page Interaction (Dropdown Select)](#10-browser-page-interaction-dropdown-select)
11. [Browser State Capture](#11-browser-state-capture)
12. [Tab Management (Open New Tab)](#12-tab-management-open-new-tab)
13. [Tab Management (Switch Tab)](#13-tab-management-switch-tab)
14. [Tab Management (Close Tab)](#14-tab-management-close-tab)
15. [Navigation (Go To URL)](#15-navigation-go-to-url)
16. [Navigation (Go Back)](#16-navigation-go-back)
17. [Google Search Action](#17-google-search-action)
18. [Microphone Permission Request](#18-microphone-permission-request)
19. [Speech-to-Text Transcription](#19-speech-to-text-transcription)
20. [Chat History Management (Load/Display)](#20-chat-history-management-loaddisplay)
21. [Chat History Management (Save Message)](#21-chat-history-management-save-message)
22. [Chat History Management (Delete Session)](#22-chat-history-management-delete-session)
23. [Bookmark Task Session](#23-bookmark-task-session)
24. [Replay Historical Task](#24-replay-historical-task)
25. [LLM Provider Configuration](#25-llm-provider-configuration)
26. [Agent Model Configuration](#26-agent-model-configuration)
27. [General Settings Update](#27-general-settings-update)
28. [Firewall Settings Management](#28-firewall-settings-management)
29. [Analytics Settings Management](#29-analytics-settings-management)
30. [Content Sanitization (Guardrails)](#30-content-sanitization-guardrails)
31. [DOM Tree Building and Highlighting](#31-dom-tree-building-and-highlighting)
32. [Message Token Management](#32-message-token-management)
33. [Error Handling and Reporting](#33-error-handling-and-reporting)
34. [Extension Event Emission and Subscription](#34-extension-event-emission-and-subscription)
35. [LLM Model Creation](#35-llm-model-creation)
36. [Manifest Generation](#36-manifest-generation)
37. [Hot Module Reload (HMR)](#37-hot-module-reload-hmr)
38. [Internationalization (i18n)](#38-internationalization-i18n)
39. [JSON Schema Conversion](#39-json-schema-conversion)
40. [Zip Bundle Creation](#40-zip-bundle-creation)
41. [WebSocket Initialization](#41-websocket-initialization)
42. [External Task Execution via WebSocket](#42-external-task-execution-via-websocket)
43. [WebSocket Ping/Pong Health Check](#43-websocket-pingpong-health-check)
44. [Execution Event Broadcasting](#44-execution-event-broadcasting)
45. [WebSocket Error Recovery](#45-websocket-error-recovery)
46. [WebSocket Disconnection and Cleanup](#46-websocket-disconnection-and-cleanup)

## Workflow Details

### 1. Extension Initialization
This workflow initializes the background service worker, sets up event listeners for browser and extension messages, initializes core services like analytics and WebSocket, and establishes WebSocket connection if enabled.

**Main Components:**
- `chrome-extension/src/background/index.ts`
- `chrome-extension/src/background/services/analytics.ts`
- `chrome-extension/src/background/services/websocket/service.ts`
- `chrome-extension/src/background/services/websocket/connection.ts`
- `chrome-extension/src/background/browser/context.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Multi-Component Orchestration
- Critical External Integrations

**Sequence Flow:**
- `chrome-extension/src/background/index.ts` (top-level execution)
  - -> `analytics.init()`: Initializes PostHog analytics.
  - -> `webSocketService.initialize()`: Initializes WebSocket service.
    - `chrome-extension/src/background/services/websocket/service.ts` (`initialize` method)
      - -> `websocketStore.getSettings()`: Loads WebSocket settings from storage.
      - -> `websocketStore.subscribe(handleSettingsChange)`: Subscribes to settings changes.
      - -> `connect()` (if enabled): Establishes WebSocket connection.
        - `service.ts` (`connect` method)
          - -> `new ConnectionManager({ serverUrl, connectionTimeout })`: Creates connection manager.
          - -> `connectionManager.addEventListener()`: Sets up connection event listeners (STATE_CHANGE, MESSAGE, ERROR).
          - -> `connectionManager.connect()`: Initiates WebSocket connection.
      - -> `emit(ServiceEvent.READY)`: Emits service ready event.
  - -> `webSocketService.addEventListener(ServiceEvent.MESSAGE_RECEIVED, ...)`: Sets up WebSocket message handler.
  - -> `webSocketService.addEventListener(ServiceEvent.CONNECTION_CHANGE, ...)`: Sets up connection state change handler.
  - -> `webSocketService.addEventListener(ServiceEvent.ERROR, ...)`: Sets up WebSocket error handler.
  - -> `chrome.debugger.onDetached.addListener()`: Sets up debugger detached listener.
  - -> `chrome.tabs.onRemoved.addListener()`: Sets up tab removal listener.
  - -> `chrome.runtime.onMessage.addListener()`: Listens for simple messages from UI.
  - -> `chrome.runtime.onConnect.addListener()`: Listens for long-lived connections (e.g., side panel).
  - -> `analyticsSettingsStore.subscribe()`: Subscribes to analytics settings changes.

### 2. User Initiates New Task
This workflow handles a user's request to start a new AI-driven task from the side panel, creating a new chat session and initiating the `Executor`. Tasks can also be initiated via WebSocket from external applications (see Workflow 42: External Task Execution via WebSocket).

**Main Components:**
- `pages/side-panel/src/SidePanel.tsx`
- `pages/side-panel/src/components/ChatInput.tsx`
- `chrome-extension/src/background/index.ts`
- `chrome-extension/src/background/agent/executor.ts`
- `packages/storage/lib/chat/history.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Core Domain Focus
- Multi-Component Orchestration
- Major Data Operations

**Sequence Flow:**
- Client/External System (`pages/side-panel/src/SidePanel.tsx`)
  - -> `handleSendMessage(text, displayText)`: User submits text in chat input.
    - `pages/side-panel/src/SidePanel.tsx`
      - -> `generateNewTaskId()`: Creates a unique task ID.
      - -> `chatHistoryStore.createSession(title)`: Creates a new chat session.
      - -> `chatHistoryStore.addMessage(sessionId, message)`: Adds the user's message to the session.
      - -> `connectToBackgroundScript()`: Establishes connection to background script if not already connected.
      - -> `port.postMessage({ type: 'newTask', taskId, task: text })`: Sends 'newTask' message to background.
  - -> `chrome-extension/src/background/index.ts` (`chrome.runtime.onConnect.addListener` handler)
    - `chrome-extension/src/background/index.ts`
      - -> `setupExecutor(taskId, task, browserContext)`: Initializes the `Executor` for the new task.
      - -> `executor.execute()`: Starts the agent's execution loop.

### 3. Agent Task Execution Loop
This workflow describes the main loop where the AI agent (orchestrated by the `Executor`) continuously plans and navigates to complete a user's task. Execution events are broadcasted to both the side panel and WebSocket clients in real-time (see Workflow 44: Execution Event Broadcasting).

**Main Components:**
- `chrome-extension/src/background/agent/executor.ts`
- `chrome-extension/src/background/agent/agents/planner.ts`
- `chrome-extension/src/background/agent/agents/navigator.ts`
- `chrome-extension/src/background/agent/messages/service.ts`
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Core Domain Focus
- Multi-Component Orchestration
- Major Data Operations

**Sequence Flow:**
- `chrome-extension/src/background/agent/executor.ts` (`execute` method)
  - -> `eventManager.emit(TASK_START)`: Emits task start event (broadcasted to side panel + WebSocket).
  - -> Loop (until task complete, max steps, or failure):
    - -> `runPlanner()`: Calls the `PlannerAgent` to get the next plan.
      - `executor.ts`
        - -> `messageManager.addStateMessage(browserState)`: Adds current browser state to memory.
        - -> `plannerAgent.execute()`: Invokes the planner LLM.
        - <- Returns `PlannerOutput` (next steps or final answer).
    - -> `checkTaskCompletion(planOutput)`: Determines if the task is done.
    - -> `navigate()`: Calls the `NavigatorAgent` to perform actions.
      - `executor.ts`
        - -> `navigatorAgent.execute()`: Invokes the navigator LLM.
        - <- Returns `NavigatorResult` (actions taken, done status).
    - -> `eventManager.emit(STEP_OK/FAIL)`: Emits step completion/failure events (broadcasted to side panel + WebSocket).
  - -> `eventManager.emit(TASK_OK/FAIL/CANCEL)`: Emits final task status (broadcasted to side panel + WebSocket).

### 4. Planner Agent Generates Plan
This workflow details how the `PlannerAgent` uses an LLM to generate a high-level plan or determine the next steps based on the current task and browser state.

**Main Components:**
- `chrome-extension/src/background/agent/agents/planner.ts`
- `chrome-extension/src/background/agent/prompts/planner.ts`
- `chrome-extension/src/background/agent/messages/service.ts`
- `chrome-extension/src/background/agent/event/manager.ts`
- `packages/schema-utils/lib/helper.ts`

**Relevance:**
- Core Domain Focus
- Multi-Component Orchestration
- Critical External Integrations

**Sequence Flow:**
- `chrome-extension/src/background/agent/agents/planner.ts` (`execute` method)
  - -> `messageManager.getMessages()`: Retrieves current message history.
  - -> `plannerPrompt.getSystemMessage()`: Gets the system prompt for the planner.
  - -> `plannerPrompt.getUserMessage(context)`: Gets the user message including browser state.
  - -> `filterExternalContent()`: Sanitizes external content in messages.
  - -> `this.invoke(inputMessages)`: Calls the underlying LLM.
    - `base.ts`
      - -> `this.chatLLM.invoke(messages, { tool_choice: 'auto', tools: [tool] })`: Invokes the chat model with tool calling.
      - -> `extractJsonFromModelOutput(output.content)`: Parses the LLM's JSON output.
      - -> `validateModelOutput(data)`: Validates the parsed output against the schema.
    - <- Returns `PlannerOutput` (next steps, final answer, etc.).
  - -> `eventManager.emit(ACT_OK)`: Emits action success event.
  - <- Returns `AgentOutput<PlannerOutput>`.

### 5. Navigator Agent Executes Actions
This workflow describes how the `NavigatorAgent` interprets the planner's output and executes specific browser actions (e.g., click, type, navigate) using the browser context.

**Main Components:**
- `chrome-extension/src/background/agent/agents/navigator.ts`
- `chrome-extension/src/background/agent/actions/builder.ts`
- `chrome-extension/src/background/agent/prompts/navigator.ts`
- `chrome-extension/src/background/browser/context.ts`
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Core Domain Focus
- Multi-Component Orchestration
- Major Data Operations

**Sequence Flow:**
- `chrome-extension/src/background/agent/agents/navigator.ts` (`execute` method)
  - -> `addStateMessageToMemory()`: Adds current browser state to message history.
  - -> `this.invoke(inputMessages)`: Calls the underlying LLM to get actions.
    - `base.ts`
      - -> `this.chatLLM.invoke(messages, { tool_choice: 'auto', tools: [tool] })`: Invokes the chat model with tool calling.
      - -> `extractJsonFromModelOutput(output.content)`: Parses the LLM's JSON output.
      - -> `validateModelOutput(data)`: Validates the parsed output against the schema.
    - <- Returns `ModelOutput` containing a list of actions.
  - -> `fixActions(modelOutput)`: Ensures actions are in correct array format.
  - -> `doMultiAction(actions)`: Iterates and executes each action.
    - `navigator.ts`
      - -> `actionRegistry.getAction(actionName)`: Retrieves the `Action` instance.
      - -> `action.call(actionArgs)`: Executes the specific action handler.
      - -> `eventManager.emit(ACT_START/OK/FAIL)`: Emits action events.
    - <- Returns `ActionResult[]`.
  - -> `removeLastStateMessageFromMemory()`: Cleans up state message.
  - <- Returns `AgentOutput<NavigatorResult>`.

### 6. Browser Page Interaction (Click)
This workflow describes how the agent performs a click action on a specific element identified by its highlight index.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`clickElementActionSchema`)
- `chrome-extension/src/background/browser/page.ts` (`clickElementNode`)
- `chrome-extension/src/background/browser/context.ts`
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (click action handler)
  - -> `this.context.browserContext.getCurrentPage()`: Gets the current active page.
  - -> `page.getDomElementByIndex(input.index)`: Retrieves the DOM element node by index.
  - -> `page.clickElementNode(this.context.options.useVision, elementNode)`: Performs the click.
    - `chrome-extension/src/background/browser/page.ts` (`clickElementNode` method)
      - -> `elementNode.highlightIndex !== null`: Optionally highlights the element.
      - -> `elementHandle.scrollIntoViewIfNeeded()`: Scrolls the element into view.
      - -> `elementHandle.click({ timeout: 5000 })`: Attempts Puppeteer click.
      - -> `page.evaluate(el => el.click(), elementHandle)`: Fallback to direct DOM click.
      - -> `this._checkAndHandleNavigation()`: Checks for URL changes and allowed status.
    - <- Returns success/failure.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 7. Browser Page Interaction (Input Text)
This workflow describes how the agent inputs text into a specific element identified by its highlight index.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`inputTextActionSchema`)
- `chrome-extension/src/background/browser/page.ts` (`inputTextElementNode`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (input text action handler)
  - -> `this.context.browserContext.getCurrentPage()`: Gets the current active page.
  - -> `page.getDomElementByIndex(input.index)`: Retrieves the DOM element node by index.
  - -> `page.inputTextElementNode(this.context.options.useVision, elementNode, input.text)`: Performs text input.
    - `chrome-extension/src/background/browser/page.ts` (`inputTextElementNode` method)
      - -> `this._waitForElementStability(elementHandle)`: Waits for element to stabilize.
      - -> `this._scrollIntoViewIfNeeded(elementHandle)`: Scrolls element into view.
      - -> `elementHandle.evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }, elementHandle)`: Clears existing content.
      - -> `elementHandle.type(text, { delay: 10 })`: Types text with delay.
      - -> `this.puppeteerPage.waitForIdle()`: Waits for page stability.
    - <- Returns success/failure.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 8. Browser Page Interaction (Scroll)
This workflow describes how the agent scrolls the current page or a specific element to a certain position or by a certain amount.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`scrollToPercentActionSchema`, `scrollToTopActionSchema`, `scrollToBottomActionSchema`, `previousPageActionSchema`, `nextPageActionSchema`, `scrollToTextActionSchema`)
- `chrome-extension/src/background/browser/page.ts` (`scrollToPercent`, `scrollToPreviousPage`, `scrollToNextPage`, `scrollToText`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (scroll action handler, e.g., `scrollToPercent`)
  - -> `this.context.browserContext.getCurrentPage()`: Gets the current active page.
  - -> `page.getDomElementByIndex(input.index)` (if element-specific scroll): Retrieves the DOM element node.
  - -> `page.scrollToPercent(input.percent, elementNode)`: Performs the scroll.
    - `chrome-extension/src/background/browser/page.ts` (`scrollToPercent` method)
      - -> `this._findNearestScrollableElement(elementHandle)`: Finds the scrollable ancestor.
      - -> `scrollableElement.evaluate((el, percent) => { el.scrollTop = el.scrollHeight * (percent / 100); }, scrollableElement, yPercent)`: Sets scroll position.
      - -> `this.puppeteerPage.waitForIdle()`: Waits for page stability.
    - <- Returns success/failure.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 9. Browser Page Interaction (Send Keys)
This workflow describes how the agent sends keyboard input (e.g., 'Enter', 'Escape', 'Control+A') to the active page.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`sendKeysActionSchema`)
- `chrome-extension/src/background/browser/page.ts` (`sendKeys`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (send keys action handler)
  - -> `this.context.browserContext.getCurrentPage()`: Gets the current active page.
  - -> `page.sendKeys(input.keys)`: Sends the specified keys.
    - `chrome-extension/src/background/browser/page.ts` (`sendKeys` method)
      - -> `this.puppeteerPage.keyboard.down(modifier)`: Presses modifier keys.
      - -> `this.puppeteerPage.keyboard.press(mainKey, { delay: 100 })`: Presses the main key.
      - -> `this.puppeteerPage.waitForIdle()`: Waits for page stability.
      - -> `this.puppeteerPage.keyboard.up(modifier)`: Releases modifier keys.
    - <- Returns success/failure.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 10. Browser Page Interaction (Dropdown Select)
This workflow describes how the agent selects an option from a native HTML dropdown element.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`selectDropdownOptionActionSchema`, `getDropdownOptionsActionSchema`)
- `chrome-extension/src/background/browser/page.ts` (`getDropdownOptions`, `selectDropdownOption`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (select dropdown option action handler)
  - -> `this.context.browserContext.getCurrentPage()`: Gets the current active page.
  - -> `page.getDomElementByIndex(input.index)`: Retrieves the DOM element node by index.
  - -> `page.selectDropdownOption(input.index, input.text)`: Selects the option.
    - `chrome-extension/src/background/browser/page.ts` (`selectDropdownOption` method)
      - -> `page.getDomElementByIndex(index)`: Validates element is a `<select>`.
      - -> `page.evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event('change')); }, elementHandle, text)`: Sets value and dispatches change event.
      - -> `this.puppeteerPage.waitForIdle()`: Waits for page stability.
    - <- Returns success/failure.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 11. Browser State Capture
This workflow captures the current state of the browser page, including the DOM tree, screenshot, and scroll information, for the AI agent.

**Main Components:**
- `chrome-extension/src/background/browser/context.ts` (`getState`)
- `chrome-extension/src/background/browser/page.ts` (`getState`, `_updateState`)
- `chrome-extension/src/background/browser/dom/service.ts` (`getClickableElements`, `injectBuildDomTreeScripts`)
- `chrome-extension/public/buildDomTree.js`

**Relevance:**
- Core Domain Focus
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/browser/context.ts` (`getState` method)
  - -> `this.getCurrentPage()`: Gets the current active `Page` object.
  - -> `page.getState(useVision, cacheClickableElementsHashes)`: Delegates to the `Page` object.
    - `chrome-extension/src/background/browser/page.ts` (`getState` method)
      - -> `this._updateState(useVision, focusElement)`: Performs the actual state update.
        - `page.ts` (`_updateState` method)
          - -> `injectBuildDomTreeScripts(this.tabId)`: Injects DOM tree building script.
          - -> `_getClickableElements(this.tabId, this.url(), ...)`: Executes script to build DOM tree.
            - `chrome-extension/public/buildDomTree.js` (`buildDomTree` function)
              - -> Traverses DOM, identifies visible/interactive elements, generates XPath, highlights.
              - <- Returns `BuildDomTreeResult` (raw nodes, map).
          - -> `_constructDomTree(evalPage)`: Converts raw DOM data to `DOMElementNode` tree.
          - -> `this.takeScreenshot(true)`: Takes a full-page screenshot if vision is enabled.
          - -> `_getScrollInfo(this.tabId)`: Gets scroll position.
          - <- Returns `PageState`.
      - -> `ClickableElementProcessor.getClickableElementsHashes(domState.elementTree)`: Hashes clickable elements for change detection.
      - <- Returns `PageState`.
  - <- Returns `BrowserState` (combines `PageState` with tab info).

### 12. Tab Management (Open New Tab)
This workflow opens a new browser tab and navigates to a specified URL.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`openTabActionSchema`)
- `chrome-extension/src/background/browser/context.ts` (`openTab`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (open tab action handler)
  - -> `this.context.browserContext.openTab(input.url)`: Opens a new tab.
    - `chrome-extension/src/background/browser/context.ts` (`openTab` method)
      - -> `chrome.tabs.create({ url, active: true })`: Creates the new tab.
      - -> `this.waitForTabEvents(newTab.id, { waitForUpdate: true, waitForActivation: true })`: Waits for tab to load and activate.
      - -> `this._getOrCreatePage(updatedTab, true)`: Creates and attaches a new `Page` object for the tab.
    - <- Returns the new `Page` object.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 13. Tab Management (Switch Tab)
This workflow switches the active browser tab to a specified tab ID.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`switchTabActionSchema`)
- `chrome-extension/src/background/browser/context.ts` (`switchTab`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (switch tab action handler)
  - -> `this.context.browserContext.switchTab(input.tabId)`: Switches to the specified tab.
    - `chrome-extension/src/background/browser/context.ts` (`switchTab` method)
      - -> `chrome.tabs.update(tabId, { active: true })`: Activates the tab.
      - -> `this.waitForTabEvents(tabId, { waitForActivation: true })`: Waits for tab activation.
      - -> `this._getOrCreatePage(tab, true)`: Ensures the `Page` object for the tab is attached and current.
    - <- Returns the `Page` object of the switched tab.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 14. Tab Management (Close Tab)
This workflow closes a specified browser tab.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`closeTabActionSchema`)
- `chrome-extension/src/background/browser/context.ts` (`closeTab`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (close tab action handler)
  - -> `this.context.browserContext.closeTab(input.tabId)`: Closes the specified tab.
    - `chrome-extension/src/background/browser/context.ts` (`closeTab` method)
      - -> `chrome.tabs.remove(tabId)`: Removes the tab.
      - -> `this.detachPage(tabId)`: Detaches the `Page` object from the context.
      - -> `this.updateCurrentTabId(null)` (if current tab is closed): Updates current tab ID.
    - <- Returns `void`.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 15. Navigation (Go To URL)
This workflow navigates the current active tab to a specified URL.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`goToUrlActionSchema`)
- `chrome-extension/src/background/browser/context.ts` (`navigateTo`)
- `chrome-extension/src/background/browser/page.ts` (`navigateTo`)
- `chrome-extension/src/background/browser/util.ts` (`isUrlAllowed`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration
- Authentication/Authorization flows

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (go to URL action handler)
  - -> `this.context.browserContext.navigateTo(input.url)`: Navigates to the URL.
    - `chrome-extension/src/background/browser/context.ts` (`navigateTo` method)
      - -> `isUrlAllowed(url, allowList, denyList)`: Checks if the URL is allowed by firewall.
      - -> `analytics.trackDomainVisit(url)`: Tracks domain visit.
      - -> `page.navigateTo(url)` (if page attached): Uses Puppeteer to navigate.
        - `chrome-extension/src/background/browser/page.ts` (`navigateTo` method)
          - -> `this.puppeteerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })`: Navigates.
          - -> `this.waitForPageAndFramesLoad()`: Waits for page and frames to load.
          - -> `this._checkAndHandleNavigation()`: Checks URL allowance again.
        - <- Returns `void`.
      - -> `chrome.tabs.update(this._currentTabId, { url })` (if page not attached): Uses Chrome API.
      - -> `this.waitForTabEvents(this._currentTabId, { waitForUpdate: true })`: Waits for tab update.
      - -> `this._getOrCreatePage(updatedTab, true)`: Reattaches page.
    - <- Returns `void`.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 16. Navigation (Go Back)
This workflow navigates the current active tab to the previous page in its history.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`goBackActionSchema`)
- `chrome-extension/src/background/browser/page.ts` (`goBack`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (go back action handler)
  - -> `this.context.browserContext.getCurrentPage()`: Gets the current active page.
  - -> `page.goBack()`: Navigates back.
    - `chrome-extension/src/background/browser/page.ts` (`goBack` method)
      - -> `this.puppeteerPage.goBack()`: Uses Puppeteer to go back.
      - -> `this.waitForPageAndFramesLoad()`: Waits for page and frames to load.
      - -> `this._checkAndHandleNavigation()`: Checks URL allowance.
    - <- Returns `void`.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 17. Google Search Action
This workflow performs a Google search by navigating to the Google search URL with the specified query.

**Main Components:**
- `chrome-extension/src/background/agent/actions/builder.ts` (`searchGoogleActionSchema`)
- `chrome-extension/src/background/browser/context.ts` (`navigateTo`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/src/background/agent/actions/builder.ts` (search Google action handler)
  - -> `this.context.browserContext.navigateTo(searchUrl)`: Navigates to the Google search URL.
    - `chrome-extension/src/background/browser/context.ts` (`navigateTo` method)
      - -> `isUrlAllowed()`: Checks firewall rules.
      - -> `page.navigateTo()`: Performs navigation.
    - <- Returns `void`.
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, message)`: Emits success event.
  - <- Returns `ActionResult`.

### 18. Microphone Permission Request
This workflow handles the process of requesting microphone access from the user, typically triggered by an attempt to use speech-to-text.

**Main Components:**
- `chrome-extension/public/permission/index.html`
- `chrome-extension/public/permission/permission.js`
- `pages/side-panel/src/SidePanel.tsx` (`handleMicClick`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Authentication/Authorization flows

**Sequence Flow:**
- Client/External System (`pages/side-panel/src/SidePanel.tsx` `handleMicClick` method)
  - -> `navigator.permissions.query({ name: 'microphone' })`: Checks current permission status.
  - -> If permission not granted:
    - -> `chrome.windows.create({ url: chrome.runtime.getURL('public/permission/index.html'), type: 'popup', ... })`: Opens permission page in a new popup.
    - -> `chrome.windows.onRemoved.addListener()`: Listens for popup close.
  - -> `chrome-extension/public/permission/permission.js` (script in popup)
    - -> `document.getElementById('requestPermission').addEventListener('click', ...)`: User clicks "Grant Permission".
    - -> `navigator.mediaDevices.getUserMedia({ audio: true })`: Requests microphone access.
    - -> `window.close()`: Closes the popup after permission is granted.
  - -> `pages/side-panel/src/SidePanel.tsx` (after popup closes)
    - -> `navigator.permissions.query({ name: 'microphone' })`: Re-checks permission status.
  - <- Returns `void`.

### 19. Speech-to-Text Transcription
This workflow captures audio from the microphone, converts it to base64, and sends it to a configured LLM (Gemini) for transcription.

**Main Components:**
- `pages/side-panel/src/SidePanel.tsx` (`handleMicClick`)
- `chrome-extension/src/background/index.ts` (message handler for `transcribeAudio`)
- `chrome-extension/src/background/services/speechToText.ts` (`transcribeAudio`)
- `packages/storage/lib/settings/speechToText.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Critical External Integrations
- Multi-Component Orchestration

**Sequence Flow:**
- Client/External System (`pages/side-panel/src/SidePanel.tsx` `handleMicClick` method)
  - -> `navigator.mediaDevices.getUserMedia({ audio: true })`: Starts microphone recording.
  - -> `mediaRecorder.ondataavailable = (event) => { audioChunks.push(event.data); }`: Collects audio chunks.
  - -> `mediaRecorder.onstop = async () => { ... }`: When recording stops:
    - -> `new Blob(audioChunks, { type: 'audio/webm' })`: Creates audio blob.
    - -> `reader.readAsDataURL(audioBlob)`: Converts blob to base64.
    - -> `port.postMessage({ type: 'transcribeAudio', audioData: base64Audio })`: Sends audio to background.
  - -> `chrome-extension/src/background/index.ts` (message handler for `transcribeAudio`)
    - `background/index.ts`
      - -> `SpeechToTextService.create(llmProviderStore.getAllProviders())`: Creates STT service.
      - -> `speechToTextService.transcribeAudio(base64Audio)`: Calls transcription service.
        - `chrome-extension/src/background/services/speechToText.ts` (`transcribeAudio` method)
          - -> `new HumanMessage({ content: [{ type: 'text', text: 'Transcribe this audio:' }, { type: 'audio', mimeType: 'audio/webm', data: base64Audio }] })`: Creates message for Gemini.
          - -> `this.llm.invoke(message)`: Invokes the Gemini LLM.
          - <- Returns transcription text.
        - <- Returns transcription text.
      - -> `port.postMessage({ type: 'speechToTextResult', result: transcription })`: Sends result back to side panel.
  - -> `pages/side-panel/src/SidePanel.tsx` (message handler for `speechToTextResult`)
    - -> `setChatInputContent(result)`: Updates chat input with transcribed text.
  - <- Returns `void`.

### 20. Chat History Management (Load/Display)
This workflow loads and displays the list of past chat sessions in the side panel.

**Main Components:**
- `pages/side-panel/src/SidePanel.tsx` (`handleLoadHistory`)
- `pages/side-panel/src/components/ChatHistoryList.tsx`
- `packages/storage/lib/chat/history.ts` (`getAllSessions`, `getSessionsMetadata`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Core Domain Focus

**Sequence Flow:**
- Client/External System (`pages/side-panel/src/SidePanel.tsx` `handleLoadHistory` method)
  - -> `chatHistoryStore.getSessionsMetadata()`: Retrieves metadata for all chat sessions.
  - -> `setChatSessions(sessions)`: Updates UI state with session metadata.
  - -> `setView('history')`: Switches the side panel view to display history.
- Client/External System (`pages/side-panel/src/components/ChatHistoryList.tsx`)
  - -> Renders `sessions` data, including `title` and `createdAt`.
  - -> `onSessionSelect(sessionId)`: User selects a session.
    - `pages/side-panel/src/SidePanel.tsx` (`handleSessionSelect` method)
      - -> `chatHistoryStore.getSession(sessionId)`: Loads full session data.
      - -> `setMessages(session.messages)`: Updates UI with messages.
      - -> `setCurrentSessionId(sessionId)`: Sets current session.
      - -> `setView('chat')`: Switches back to chat view.
  - <- Displays chat history list.

### 21. Chat History Management (Save Message)
This workflow saves a new message (from user or agent) to the currently active chat session.

**Main Components:**
- `pages/side-panel/src/SidePanel.tsx` (`appendMessage`)
- `packages/storage/lib/chat/history.ts` (`addMessage`)
- `packages/storage/lib/chat/types.ts`

**Relevance:**
- Major Data Operations
- Core Domain Focus

**Sequence Flow:**
- `pages/side-panel/src/SidePanel.tsx` (`appendMessage` method)
  - -> `currentSessionIdRef.current`: Checks for an active session.
  - -> `chatHistoryStore.addMessage(sessionId, message)`: Adds the message to storage.
    - `packages/storage/lib/chat/history.ts` (`addMessage` method)
      - -> `getSessionMessagesStorage(sessionId).set(prevMessages => [...prevMessages, chatMessage])`: Appends message to session's message array.
      - -> `sessionMetadataStore.set(prevMetadata => { ... })`: Updates session metadata (e.g., `updatedAt`, `messageCount`).
    - <- Returns `ChatMessage`.
  - -> `setMessages(prevMessages => [...prevMessages, chatMessage])`: Updates local UI state.
  - <- Message is saved and displayed.

### 22. Chat History Management (Delete Session)
This workflow deletes a specific chat session and all its associated messages and agent step history.

**Main Components:**
- `pages/side-panel/src/SidePanel.tsx` (`handleSessionDelete`)
- `packages/storage/lib/chat/history.ts` (`deleteSession`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Core Domain Focus

**Sequence Flow:**
- Client/External System (`pages/side-panel/src/SidePanel.tsx` `handleSessionDelete` method)
  - -> `chatHistoryStore.deleteSession(sessionId)`: Deletes the session from storage.
    - `packages/storage/lib/chat/history.ts` (`deleteSession` method)
      - -> `sessionMetadataStore.set(prevMetadata => prevMetadata.filter(s => s.id !== sessionId))`: Removes session from metadata.
      - -> `getSessionMessagesStorage(sessionId).set([])`: Clears messages for the session.
      - -> `getSessionAgentStepHistoryStorage(sessionId).set(null)`: Clears agent step history.
    - <- Returns `void`.
  - -> `setChatSessions(prevSessions => prevSessions.filter(s => s.id !== sessionId))`: Updates UI state.
  - <- Session is deleted from storage and UI.

### 23. Bookmark Task Session
This workflow allows a user to bookmark a chat session, saving its initial task as a reusable prompt.

**Main Components:**
- `pages/side-panel/src/SidePanel.tsx` (`handleSessionBookmark`)
- `packages/storage/lib/prompt/favorites.ts` (`addPrompt`)
- `packages/storage/lib/chat/history.ts` (`getSession`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Core Domain Focus

**Sequence Flow:**
- Client/External System (`pages/side-panel/src/SidePanel.tsx` `handleSessionBookmark` method)
  - -> `chatHistoryStore.getSession(sessionId)`: Retrieves the full chat session.
  - -> `session.messages[0].content`: Extracts the initial task (first message).
  - -> `favoritesStorage.addPrompt(title, content)`: Adds the task as a favorite prompt.
    - `packages/storage/lib/prompt/favorites.ts` (`addPrompt` method)
      - -> `favoritesStorage.set(prev => { ... })`: Updates the favorites storage.
      - -> Assigns a new `id` and `title`.
    - <- Returns `FavoritePrompt`.
  - -> `loadFavorites()`: Reloads the list of favorite prompts to update the UI.
  - -> `handleBackToChat()`: Returns to the chat view.
  - <- Task is bookmarked and available in the quick start list.

### 24. Replay Historical Task
This workflow allows a user to re-execute a previously saved task by replaying its historical agent steps.

**Main Components:**
- `pages/side-panel/src/SidePanel.tsx` (`handleReplay`)
- `chrome-extension/src/background/index.ts` (message handler for `replayHistory`)
- `chrome-extension/src/background/agent/executor.ts` (`replayHistory`)
- `packages/storage/lib/chat/history.ts` (`loadAgentStepHistory`)
- `packages/storage/lib/settings/generalSettings.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Core Domain Focus
- Multi-Component Orchestration
- Major Data Operations

**Sequence Flow:**
- Client/External System (`pages/side-panel/src/SidePanel.tsx` `handleReplay` method)
  - -> `generalSettingsStore.getSettings()`: Checks if replay is enabled.
  - -> `chatHistoryStore.loadAgentStepHistory(historySessionId)`: Loads the saved agent step history.
  - -> `generateNewTaskId()`: Creates a new task ID for the replay.
  - -> `chatHistoryStore.createSession(replayTitle)`: Creates a new chat session for the replay.
  - -> `port.postMessage({ type: 'replayHistory', taskId, historySessionId, task: historyData.task })`: Sends replay command to background.
- `chrome-extension/src/background/index.ts` (message handler for `replayHistory`)
  - `background/index.ts`
    - -> `setupExecutor(taskId, task, browserContext)`: Initializes executor for replay.
    - -> `executor.replayHistory(historySessionId, ...)`: Starts replaying actions.
      - `chrome-extension/src/background/agent/executor.ts` (`replayHistory` method)
        - -> `chatHistoryStore.loadAgentStepHistory(sessionId)`: Loads history.
        - -> Loop through `history.history` (list of `AgentStepRecord`):
          - -> `navigatorAgent.executeHistoryStep(historyItem, ...)`: Executes each historical step.
            - `chrome-extension/src/background/agent/agents/navigator.ts` (`executeHistoryStep` method)
              - -> `parseHistoryModelOutput(historyItem)`: Parses model output from history.
              - -> `executeHistoryActions(parsedOutput, historyItem, delay)`: Executes actions.
                - `navigator.ts`
                  - -> `updateActionIndices(historicalElement, action, currentState)`: Updates element indices if DOM changed.
                  - -> `action.call(actionArgs)`: Calls the actual action handler.
                  - -> `eventManager.emit(ACT_OK/FAIL)`: Emits events.
            - <- Returns `ActionResult[]`.
        - <- Returns `ActionResult[]`.
  - <- Replay completes or fails, status sent back to side panel.

### 25. LLM Provider Configuration
This workflow allows users to add, update, or delete configurations for various LLM providers (OpenAI, Anthropic, Gemini, etc.).

**Main Components:**
- `pages/options/src/components/ModelSettings.tsx`
- `packages/storage/lib/settings/llmProviders.ts` (`llmProviderStore`)
- `chrome-extension/src/background/agent/helper.ts` (`createChatModel`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Critical External Integrations

**Sequence Flow:**
- Client/External System (`pages/options/src/components/ModelSettings.tsx`)
  - -> `llmProviderStore.getAllProviders()`: Loads existing providers on mount.
  - -> User interacts with UI (e.g., clicks "Add New Provider", fills form, clicks "Save").
  - -> `handleSave(providerId)`: Saves provider configuration.
    - `ModelSettings.tsx`
      - -> `llmProviderStore.setProvider(providerId, configToSave)`: Stores the new/updated config.
        - `packages/storage/lib/settings/llmProviders.ts` (`setProvider` method)
          - -> `ensureBackwardCompatibility(providerId, config)`: Applies compatibility fixes.
          - -> `chrome.storage[storageArea].set({ [key]: JSON.stringify(updatedConfig) })`: Persists data.
        - <- Returns `void`.
  - -> `handleDelete(providerId)`: Deletes provider configuration.
    - `ModelSettings.tsx`
      - -> `llmProviderStore.removeProvider(providerId)`: Removes config from storage.
        - `packages/storage/lib/settings/llmProviders.ts` (`removeProvider` method)
          - -> `chrome.storage[storageArea].remove(key)`: Removes data.
        - <- Returns `void`.
  - <- LLM provider configurations are managed.

### 26. Agent Model Configuration
This workflow allows users to select specific LLM models and their parameters (temperature, topP, reasoning effort) for the Planner and Navigator agents.

**Main Components:**
- `pages/options/src/components/ModelSettings.tsx`
- `packages/storage/lib/settings/agentModels.ts` (`agentModelStore`)
- `packages/storage/lib/settings/llmProviders.ts` (`llmProviderStore`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Core Domain Focus

**Sequence Flow:**
- Client/External System (`pages/options/src/components/ModelSettings.tsx`)
  - -> `agentModelStore.getAllAgentModels()`: Loads existing agent model configs on mount.
  - -> `llmProviderStore.getAllProviders()`: Loads available LLM providers to populate dropdowns.
  - -> User selects a model from a dropdown or adjusts parameters.
  - -> `handleModelChange(agentName, modelValue)`: Updates the selected model for an agent.
    - `ModelSettings.tsx`
      - -> `agentModelStore.setAgentModel(agentName, { provider, modelName, parameters, reasoningEffort })`: Stores the agent's model config.
        - `packages/storage/lib/settings/agentModels.ts` (`setAgentModel` method)
          - -> `validateModelConfig(config)`: Validates the model config.
          - -> `chrome.storage[storageArea].set({ [key]: JSON.stringify(updatedRecord) })`: Persists data.
        - <- Returns `void`.
  - -> `handleParameterChange(agentName, paramName, value)`: Updates model parameters.
  - -> `handleReasoningEffortChange(agentName, value)`: Updates reasoning effort.
  - <- Agent model configurations are managed.

### 27. General Settings Update
This workflow allows users to configure general operational settings for the AI agent, such as max steps, failure tolerance, and vision capabilities.

**Main Components:**
- `pages/options/src/components/GeneralSettings.tsx`
- `packages/storage/lib/settings/generalSettings.ts` (`generalSettingsStore`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Core Domain Focus

**Sequence Flow:**
- Client/External System (`pages/options/src/components/GeneralSettings.tsx`)
  - -> `generalSettingsStore.getSettings()`: Loads current settings on mount.
  - -> User changes a setting (e.g., toggles "Enable Vision", adjusts "Max Steps").
  - -> `updateSetting(key, value)`: Updates a specific setting.
    - `GeneralSettings.tsx`
      - -> `generalSettingsStore.updateSettings({ [key]: value })`: Updates the settings in storage.
        - `packages/storage/lib/settings/generalSettings.ts` (`updateSettings` method)
          - -> `chrome.storage[storageArea].set({ [key]: JSON.stringify(updatedConfig) })`: Persists data.
        - <- Returns `void`.
  - -> `generalSettingsStore.getSettings()`: Fetches updated settings to ensure UI consistency (e.g., `useVision` affecting `displayHighlights`).
  - <- General settings are updated.

### 28. Firewall Settings Management
This workflow enables users to configure a firewall by defining allowed and denied URLs to control the agent's browsing behavior.

**Main Components:**
- `pages/options/src/components/FirewallSettings.tsx`
- `packages/storage/lib/settings/firewall.ts` (`firewallStore`)
- `chrome-extension/src/background/browser/util.ts` (`isUrlAllowed`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Authentication/Authorization flows

**Sequence Flow:**
- Client/External System (`pages/options/src/components/FirewallSettings.tsx`)
  - -> `firewallStore.getFirewall()`: Loads current firewall settings on mount.
  - -> User interacts with UI (e.g., toggles "Enable Firewall", adds/removes URLs from lists).
  - -> `handleToggleFirewall()`: Toggles firewall enabled status.
    - `FirewallSettings.tsx`
      - -> `firewallStore.updateFirewall({ enabled: !currentSettings.enabled })`: Updates setting.
  - -> `handleAddUrl(url, listType)`: Adds a URL to the allow or deny list.
    - `FirewallSettings.tsx`
      - -> `firewallStore.addToAllowList(normalizedUrl)` or `firewallStore.addToDenyList(normalizedUrl)`: Adds URL.
        - `packages/storage/lib/settings/firewall.ts` (`addToAllowList`/`addToDenyList` methods)
          - -> `normalizeUrl(url)`: Normalizes the URL.
          - -> `chrome.storage[storageArea].set({ [key]: JSON.stringify(updatedConfig) })`: Persists data.
        - <- Returns `void`.
  - -> `handleRemoveUrl(url, listType)`: Removes a URL from a list.
    - `FirewallSettings.tsx`
      - -> `firewallStore.removeFromAllowList(url)` or `firewallStore.removeFromDenyList(url)`: Removes URL.
        - `packages/storage/lib/settings/firewall.ts` (`removeFromAllowList`/`removeFromDenyList` methods)
          - -> `chrome.storage[storageArea].set({ [key]: JSON.stringify(updatedConfig) })`: Persists data.
        - <- Returns `void`.
  - <- Firewall settings are managed.

### 29. Analytics Settings Management
This workflow allows users to enable or disable analytics tracking for the extension.

**Main Components:**
- `pages/options/src/components/AnalyticsSettings.tsx`
- `packages/storage/lib/settings/analyticsSettings.ts` (`analyticsSettingsStore`)
- `chrome-extension/src/background/services/analytics.ts` (`analytics.updateSettings`)

**Relevance:**
- Primary Entry Points (key UI handlers)
- Major Data Operations
- Critical External Integrations

**Sequence Flow:**
- Client/External System (`pages/options/src/components/AnalyticsSettings.tsx`)
  - -> `analyticsSettingsStore.getSettings()`: Loads current settings on mount.
  - -> `analyticsSettingsStore.subscribe()`: Subscribes to changes.
  - -> User toggles "Enable Analytics".
  - -> `handleToggleAnalytics(enabled)`: Updates the analytics enabled status.
    - `AnalyticsSettings.tsx`
      - -> `analyticsSettingsStore.updateSettings({ enabled })`: Updates settings in storage.
        - `packages/storage/lib/settings/analyticsSettings.ts` (`updateSettings` method)
          - -> `chrome.storage[storageArea].set({ [key]: JSON.stringify(updatedConfig) })`: Persists data.
        - <- Returns `void`.
  - -> `chrome-extension/src/background/index.ts` (listener for `analyticsSettingsStore` changes)
    - `background/index.ts`
      - -> `analytics.updateSettings()`: Notifies the analytics service to update its state (opt-in/out).
        - `chrome-extension/src/background/services/analytics.ts` (`updateSettings` method)
          - -> `this.posthog.opt_in_capturing()` or `this.posthog.opt_out_capturing()`: Enables/disables PostHog.
        - <- Returns `void`.
  - <- Analytics settings are updated.

### 30. Content Sanitization (Guardrails)
This workflow sanitizes untrusted content (e.g., web page content) to prevent prompt injection and other security threats before it's passed to LLMs.

**Main Components:**
- `chrome-extension/src/background/services/guardrails/index.ts` (`SecurityGuardrails`)
- `chrome-extension/src/background/services/guardrails/sanitizer.ts` (`sanitizeContent`, `detectThreats`)
- `chrome-extension/src/background/services/guardrails/patterns.ts`
- `chrome-extension/src/background/agent/messages/utils.ts` (`filterExternalContent`, `wrapUntrustedContent`)

**Relevance:**
- Core Domain Focus
- Authentication/Authorization flows

**Sequence Flow:**
- `chrome-extension/src/background/agent/messages/utils.ts` (`filterExternalContent` or `wrapUntrustedContent` methods)
  - -> `guardrails.sanitize(rawContent, strict)`: Calls the guardrails service.
    - `chrome-extension/src/background/services/guardrails/index.ts` (`sanitize` method)
      - -> `sanitizeContent(content, options.strict)`: Delegates to the sanitizer.
        - `chrome-extension/src/background/services/guardrails/sanitizer.ts` (`sanitizeContent` function)
          - -> `getPatterns(strict)`: Retrieves security patterns.
          - -> Loop through patterns:
            - -> `content.replace(pattern.pattern, pattern.replacement || '')`: Applies replacements.
            - -> `detectedThreats.add(pattern.type)`: Records detected threats.
          - -> `cleanEmptyTags(cleanedContent)`: Removes empty HTML tags.
          - <- Returns `SanitizationResult`.
        - <- Returns `SanitizationResult`.
  - -> `wrapUntrustedContent(sanitizedContent)`: Adds security tags and warnings around the sanitized content.
  - <- Returns sanitized and wrapped content.

### 31. DOM Tree Building and Highlighting
This workflow constructs a simplified, interactive representation of the current web page's DOM, identifying visible and interactive elements, and optionally highlighting them.

**Main Components:**
- `chrome-extension/src/background/browser/dom/service.ts` (`getClickableElements`, `_buildDomTree`, `_constructDomTree`)
- `chrome-extension/public/buildDomTree.js`
- `chrome-extension/src/background/browser/dom/views.ts` (`DOMElementNode`, `DOMTextNode`)

**Relevance:**
- Core Domain Focus
- Major Data Operations

**Sequence Flow:**
- `chrome-extension/src/background/browser/dom/service.ts` (`getClickableElements` method)
  - -> `injectBuildDomTreeScripts(tabId)`: Ensures `buildDomTree.js` is injected into all frames.
  - -> `_buildDomTree(tabId, url, ...)`: Executes the `buildDomTree` function in the page context.
    - `chrome.scripting.executeScript({ target: { tabId }, func: window.buildDomTree, args: [args] })`: Injects and executes.
    - `chrome-extension/public/buildDomTree.js` (`buildDomTree` function)
      - -> `DOM_CACHE.clearCache()`: Clears internal caches.
      - -> Recursively traverses `document.body` and iframes:
        - -> `isElementAccepted(node)`: Filters out non-relevant tags.
        - -> `isElementVisible(node)`: Checks CSS visibility.
        - -> `isInteractiveElement(node)`: Heuristically determines interactivity (cursor, tags, roles, attributes).
        - -> `isTopElement(node)`: Checks if element is topmost at its center.
        - -> `isInExpandedViewport(node, viewportExpansion)`: Checks if element is in viewport.
        - -> `highlightElement(node, index, parentIframe)`: Creates visual overlays and labels.
        - -> `getXPathTree(node, true)`: Generates XPath.
        - <- Returns `BuildDomTreeResult` (root ID, map of raw nodes).
    - -> `constructFrameTree(...)`: Recursively processes subframes.
    - -> `_constructDomTree(evalPage)`: Converts `RawDomTreeNode` map into `DOMElementNode` tree.
      - -> Creates `DOMElementNode` and `DOMTextNode` objects.
      - -> Builds parent-child relationships.
      - -> Populates `selectorMap` (index to `DOMElementNode`).
    - <- Returns `[DOMElementNode, Map<number, DOMElementNode>]`.
  - <- Returns `DOMState` (element tree and selector map).

### 32. Message Token Management
This workflow manages the message history for LLM interactions, ensuring that the total token count stays within the model's maximum input limit by trimming older messages if necessary.

**Main Components:**
- `chrome-extension/src/background/agent/messages/service.ts` (`MessageManager`, `cutMessages`)
- `chrome-extension/src/background/agent/messages/views.ts` (`MessageHistory`)

**Relevance:**
- Core Domain Focus
- Major Data Operations

**Sequence Flow:**
- `chrome-extension/src/background/agent/messages/service.ts` (`cutMessages` method)
  - -> `messageHistory.getTotalTokens()`: Gets current total token count.
  - -> `this.settings.maxInputTokens`: Compares against max allowed tokens.
  - -> If `totalTokens > maxInputTokens`:
    - -> `messageHistory.removeOldestMessage()`: Removes the oldest non-system message.
    - -> If still over limit and last message is a state message:
      - -> `messageHistory.removeLastStateMessage()`: Removes the last state message.
      - -> `this._countTextTokens(stateMessage.content)`: Recalculates tokens for state message.
      - -> `capTextLength(stateMessage.content, newLength)`: Trims the state message content.
      - -> `messageHistory.addStateMessage(newMessage)`: Adds the trimmed state message back.
  - <- Message history is adjusted to fit token limits.

### 33. Error Handling and Reporting
This workflow centralizes error handling, categorizes errors, and reports them to analytics for monitoring and debugging.

**Main Components:**
- `chrome-extension/src/background/agent/agents/errors.ts` (custom error classes, `isAuthenticationError`, etc.)
- `chrome-extension/src/background/agent/executor.ts` (error handling in `execute` method)
- `chrome-extension/src/background/services/analytics.ts` (`analytics.trackTaskFailed`, `categorizeError`)
- `chrome-extension/src/background/agent/event/manager.ts`

**Relevance:**
- Core Domain Focus
- Critical External Integrations

**Sequence Flow:**
- `chrome-extension/src/background/agent/executor.ts` (`execute` method, `catch` block)
  - -> `analytics.categorizeError(error)`: Determines error category.
    - `chrome-extension/src/background/services/analytics.ts` (`categorizeError` method)
      - -> Checks `error.constructor.name` for custom error types (e.g., `ChatModelAuthError`).
      - -> Checks `error.message` for specific patterns (e.g., "API key", "forbidden").
      - <- Returns a string category (e.g., "AuthenticationError", "NetworkError").
  - -> `analytics.trackTaskFailed(this.taskId, errorCategory)`: Reports failure to analytics.
  - -> `this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, errorMessage)`: Emits task failure event.
  - <- Error is categorized, reported, and propagated.

### 34. Extension Event Emission and Subscription
This workflow provides a mechanism for different parts of the extension (background, side panel) to communicate state changes and events, such as task progress or failures.

**Main Components:**
- `chrome-extension/src/background/agent/event/manager.ts` (`EventManager`)
- `chrome-extension/src/background/agent/event/types.ts` (`AgentEvent`, `EventType`, `ExecutionState`, `Actors`)
- `chrome-extension/src/background/agent/executor.ts` (`subscribeExecutionEvents`)
- `pages/side-panel/src/SidePanel.tsx` (event listener in `useEffect`)

**Relevance:**
- Multi-Component Orchestration
- Core Domain Focus

**Sequence Flow:**
- `chrome-extension/src/background/agent/executor.ts` (`subscribeExecutionEvents` method)
  - -> `this.eventManager.subscribe(EventType.EXECUTION, callback)`: Registers a callback for execution events.
- Client/External System (`pages/side-panel/src/SidePanel.tsx` `useEffect` hook)
  - -> `chrome.runtime.onConnect.addListener(port => { ... })`: Establishes a long-lived connection.
  - -> `port.onMessage.addListener(message => { ... })`: Listens for messages from the background script.
  - -> If `message.type === 'agentEvent'`:
    - -> `handleAgentEvent(message.event)`: Processes the event.
      - `SidePanel.tsx` (`handleAgentEvent` method)
        - -> `appendMessage(message.event.data.details, ...)`: Displays event details in chat.
        - -> Updates UI state based on `event.state` (e.g., `isTaskRunning`, `isTaskPaused`).
- `chrome-extension/src/background/agent/executor.ts` (during task execution)
  - -> `this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent)`: Emits an event.
    - `chrome-extension/src/background/agent/types.ts` (`AgentContext` `emitEvent` method)
      - -> `this.eventManager.emit(new AgentEvent(...))`: Creates and emits the event.
        - `chrome-extension/src/background/agent/event/manager.ts` (`emit` method)
          - -> Iterates through `this.subscribers[event.type]` and calls each `callback(event)`.
          - -> `port.postMessage({ type: 'agentEvent', event })`: Sends event via `chrome.runtime.Port`.
        - <- Returns `void`.
  - <- Events are emitted by the background script and received by the side panel.

### 35. LLM Model Creation
This workflow dynamically creates instances of LangChain chat models based on user-configured LLM providers and models.

**Main Components:**
- `chrome-extension/src/background/agent/helper.ts` (`createChatModel`, `createOpenAIChatModel`, `createAzureChatModel`)
- `packages/storage/lib/settings/llmProviders.ts` (`llmProviderStore`, `ProviderConfig`, `ProviderTypeEnum`)
- `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai`, etc.

**Relevance:**
- Core Domain Focus
- Critical External Integrations

**Sequence Flow:**
- `chrome-extension/src/background/index.ts` (`setupExecutor` function)
  - -> `llmProviderStore.getProvider(providerId)`: Retrieves provider configuration.
  - -> `createChatModel(providerConfig, modelConfig)`: Calls the helper function to create the model.
    - `chrome-extension/src/background/agent/helper.ts` (`createChatModel` function)
      - -> Checks `providerConfig.type` (e.g., `ProviderTypeEnum.OpenAI`, `ProviderTypeEnum.AzureOpenAI`).
      - -> If Azure: `createAzureChatModel(providerConfig, modelConfig)`:
        - -> Validates Azure-specific fields (endpoint, deployment names, API version).
        - -> Instantiates `AzureChatOpenAI` with `azureOpenAIApiKey`, `azureOpenAIApiInstanceName`, `azureOpenAIApiDeploymentName`, `azureOpenAIApiVersion`.
      - -> If OpenAI/Custom: `createOpenAIChatModel(providerConfig, modelConfig, extraFetchOptions)`:
        - -> Instantiates `ChatOpenAI` with `apiKey`, `baseURL`, `model`, `temperature`, `topP`.
      - -> If Anthropic: Instantiates `ChatAnthropic`.
      - -> If Gemini: Instantiates `ChatGoogleGenerativeAI`.
      - -> If Ollama: Instantiates `ChatOllama`.
      - -> If Llama: Instantiates `ChatLlama` (custom wrapper for `ChatOpenAI`).
      - -> Applies model-specific parameters (e.g., `reasoning_effort` for O-series models).
    - <- Returns `BaseChatModel` instance.
  - <- LLM chat models are instantiated and ready for use by agents.

### 36. Manifest Generation
This workflow generates the `manifest.json` file for the Chrome extension, incorporating dynamic elements like HMR scripts and conditional features like the side panel or Opera sidebar.

**Main Components:**
- `chrome-extension/manifest.js`
- `chrome-extension/utils/plugins/make-manifest-plugin.ts`
- `packages/dev-utils/lib/manifest-parser/impl.ts`
- `packages/hmr/lib/injections/refresh.ts`

**Relevance:**
- Core Domain Focus
- Multi-Component Orchestration

**Sequence Flow:**
- `chrome-extension/vite.config.mts` (during Vite build process)
  - -> `makeManifestPlugin(...)`: Invokes the custom Vite plugin.
    - `chrome-extension/utils/plugins/make-manifest-plugin.ts` (`writeBundle` hook)
      - -> `getManifestWithCacheBurst()`: Loads the base manifest and adds cache busting.
      - -> `withSidePanel(manifest)`: Conditionally adds side panel configuration.
      - -> `withOperaSidebar(manifest)`: Conditionally adds Opera sidebar configuration.
      - -> `addRefreshContentScript(manifest)`: Injects HMR content script if in dev mode.
        - `manifest.js`
          - -> `deepmerge(manifest, { content_scripts: [{ js: ['refresh.js'] }] })`: Adds `refresh.js`.
      - -> `makeManifest(manifest, to)`: Writes the final manifest to the build directory.
        - `make-manifest-plugin.ts` (`makeManifest` function)
          - -> `fs.writeFileSync(path.resolve(to, 'manifest.json'), JSON.stringify(manifest, null, 2))`: Writes file.
        - <- Returns `void`.
  - <- `manifest.json` is generated.

### 37. Hot Module Reload (HMR)
This workflow provides hot module reloading or refresh capabilities for the extension during development, allowing changes to be applied without manual reloading.

**Main Components:**
- `packages/hmr/lib/initializers/initReloadServer.ts`
- `packages/hmr/lib/initializers/initClient.ts`
- `packages/hmr/lib/injections/refresh.ts`
- `packages/hmr/lib/plugins/watch-rebuild-plugin.ts`
- `chrome-extension/utils/refresh.js`

**Relevance:**
- Core Domain Focus
- Multi-Component Orchestration

**Sequence Flow:**
- Development Environment (`pnpm dev` command)
  - -> `packages/hmr/lib/initializers/initReloadServer.ts` (`initReloadServer` function)
    - -> `new WebSocketServer({ port: LOCAL_RELOAD_SOCKET_PORT })`: Starts a WebSocket server.
    - -> `wss.on('connection', ws => { ... })`: Listens for client connections.
    - -> `wss.on('message', message => { ... })`: Handles messages from clients.
  - -> `chrome-extension/vite.config.mts` (`watchRebuildPlugin`)
    - `packages/hmr/lib/plugins/watch-rebuild-plugin.ts` (`writeBundle` hook)
      - -> `new WebSocket(LOCAL_RELOAD_SOCKET_URL)`: Connects to the reload server.
      - -> `ws.send(MessageInterpreter.send({ type: BUILD_COMPLETE, id: config.id }))`: Notifies server of build completion.
  - -> `chrome-extension/manifest.js` (`addRefreshContentScript`)
    - -> Injects `refresh.js` into content scripts.
  - -> `chrome-extension/utils/refresh.js` (executed in content script)
    - -> `initClient({ id: HMR_CLIENT_ID, onUpdate: () => reload() })`: Initializes client.
      - `packages/hmr/lib/initializers/initClient.ts` (`initClient` function)
        - -> `new WebSocket(LOCAL_RELOAD_SOCKET_URL)`: Connects to the reload server.
        - -> `ws.addEventListener('message', event => { ... })`: Listens for messages from server.
        - -> If `message.type === DO_UPDATE`:
          - -> `onUpdate()`: Triggers the `reload()` function.
          - -> `ws.send(MessageInterpreter.send({ type: DONE_UPDATE }))`: Notifies server of update completion.
    - -> `reload()`: Calls `window.location.reload()` to refresh the page.
  - <- Extension content scripts and background pages are automatically reloaded/refreshed on code changes.

### 38. Internationalization (i18n)
This workflow provides internationalization capabilities, allowing the extension to display messages in different languages based on the user's locale.

**Main Components:**
- `packages/i18n/genenrate-i18n.mjs`
- `packages/i18n/lib/getMessageFromLocale.ts`
- `packages/i18n/lib/i18n-dev.ts` (`t`)
- `packages/i18n/lib/i18n-prod.ts` (`t`)
- `packages/i18n/locales/en/messages.json` (and other locale files)

**Relevance:**
- Core Domain Focus

**Sequence Flow:**
- Build Process (`pnpm genenrate-i8n`)
  - -> `packages/i18n/genenrate-i18n.mjs`
    - -> Reads `locales` directory to find available languages.
    - -> `makeTypeFile(locales)`: Generates `lib/type.ts` with `MessageKey` and `DevLocale` types.
    - -> `makeGetMessageFromLocaleFile(locales)`: Generates `lib/getMessageFromLocale.ts` which imports all `messages.json` and exports `getMessageFromLocale`.
- Runtime (e.g., `pages/side-panel/src/SidePanel.tsx`)
  - -> `import { t } from '@extension/i18n';`
  - -> `t('welcome_title')`: Calls the translation function.
    - `packages/i18n/lib/i18n-prod.ts` (production)
      - -> `chrome.i18n.getMessage(key, substitutions)`: Uses native Chrome i18n API.
    - `packages/i18n/lib/i18n-dev.ts` (development)
      - -> `getMessageFromLocale(defaultLocale)`: Retrieves messages for the default locale.
      - -> Performs placeholder substitution.
    - <- Returns translated message string.
  - <- UI displays messages in the appropriate language.

### 39. JSON Schema Conversion
This workflow provides utilities for manipulating JSON schemas, specifically for dereferencing references and converting schemas between OpenAI and Google Gemini formats.

**Main Components:**
- `packages/schema-utils/lib/helper.ts` (`dereferenceJsonSchema`, `convertOpenAISchemaToGemini`, `stringifyCustom`)
- `packages/schema-utils/lib/json_schema.ts` (example schemas)

**Relevance:**
- Core Domain Focus

**Sequence Flow:**
- `packages/schema-utils/examples/convert.ts` (example usage)
  - -> `jsonNavigatorOutputSchema`: Starts with an OpenAI-style schema.
  - -> `convertOpenAISchemaToGemini(openaiSchema, true)`: Converts the schema.
    - `packages/schema-utils/lib/helper.ts` (`convertOpenAISchemaToGemini` function)
      - -> `dereferenceJsonSchema(openaiSchema)`: First flattens the schema by resolving `$ref` and `$defs`.
        - `helper.ts` (`dereferenceJsonSchema` function)
          - -> Creates a deep copy.
          - -> `processSchemaNode(node, definitions)`: Recursively resolves references and merges properties.
        - <- Returns a dereferenced schema.
      - -> `processPropertiesForGemini(flattenedSchema.properties, true)`: Recursively processes properties for Gemini compatibility.
        - `helper.ts` (`processPropertyForGemini` function)
          - -> Handles `type`, `description`, `format`, `enum`, `nullable`.
          - -> Recursively processes nested `properties` and `items`.
          - -> Adds `propertyOrdering` if `ensureOrder` is true.
        - <- Returns Gemini-compatible schema.
  - -> `stringifyCustom(geminiSchema, '  ')`: Pretty prints the resulting schema.
  - <- Converted and flattened JSON schema is produced.

### 40. Zip Bundle Creation
This workflow packages the compiled extension files into a `.zip` archive, optionally excluding source maps.

**Main Components:**
- `packages/zipper/index.ts`
- `packages/zipper/lib/zip-bundle/index.ts` (`zipBundle`)
- `fflate` (library for zipping)
- `fast-glob` (for file pattern matching)

**Relevance:**
- Core Domain Focus

**Sequence Flow:**
- Build Process (`pnpm zip`)
  - -> `packages/zipper/index.ts` (main script)
  - -> `zipBundle({ distDirectory, buildDirectory, archiveName }, false)`: Calls the zipping function.
    - `packages/zipper/lib/zip-bundle/index.ts` (`zipBundle` function)
      - -> `ensureBuildDirectoryExists(buildDirectory)`: Creates output directory.
      - -> `glob.stream(pattern, { cwd: distDirectory })`: Finds all files in `distDirectory`.
      - -> `new Zip((err, dat) => { ... })`: Initializes `fflate` Zip stream.
      - -> `streamFileToZip(absPath, relPath, zip, ...)`: Streams each file into the zip.
        - `zip.add(relPath, [new AsyncZipDeflate(relPath, { level: 9 })])`: Adds file to zip.
        - `readStream.on('data', chunk => { zip.push(chunk); })`: Pushes file data.
      - -> `createWriteStream(archivePath)`: Writes the final zip file.
    - <- Returns `Promise<void>`.
  - <- A `.zip` archive of the extension is created.

### 41. WebSocket Initialization
This workflow initializes the WebSocket service when the extension starts, loading settings from storage and establishing connection if enabled.

**Main Components:**
- `chrome-extension/src/background/index.ts`
- `chrome-extension/src/background/services/websocket/service.ts`
- `chrome-extension/src/background/services/websocket/connection.ts`
- `packages/storage/lib/settings/websocket.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Multi-Component Orchestration
- Critical External Integrations

**Sequence Flow:**
- `chrome-extension/src/background/index.ts` (extension initialization)
  - -> `webSocketService.initialize()`: Starts WebSocket service initialization.
    - `chrome-extension/src/background/services/websocket/service.ts` (`initialize` method)
      - -> `websocketStore.getSettings()`: Loads WebSocket configuration from Chrome storage.
        - `packages/storage/lib/settings/websocket.ts`
          - -> `chrome.storage.local.get('websocket_settings')`: Retrieves stored settings.
          - <- Returns `{ enabled: boolean, serverUrl: string, connectionTimeout: number }`.
      - -> `websocketStore.subscribe(handleSettingsChange)`: Subscribes to settings changes for hot-reloading.
      - -> If `settings.enabled === true`:
        - -> `connect()`: Initiates connection.
          - `service.ts` (`connect` method)
            - -> `new ConnectionManager({ serverUrl, connectionTimeout })`: Creates connection manager.
            - -> `connectionManager.addEventListener(ConnectionEvent.STATE_CHANGE, ...)`: Sets up state change listener.
            - -> `connectionManager.addEventListener(ConnectionEvent.MESSAGE, ...)`: Sets up message listener.
            - -> `connectionManager.addEventListener(ConnectionEvent.ERROR, ...)`: Sets up error listener.
            - -> `connectionManager.connect()`: Initiates WebSocket connection.
              - `chrome-extension/src/background/services/websocket/connection.ts` (`connect` method)
                - -> URL validation (must start with `ws://` or `wss://`).
                - -> `new WebSocket(serverUrl)`: Creates native WebSocket instance.
                - -> `setupWebSocketHandlers()`: Attaches onopen, onclose, onerror, onmessage handlers.
                - -> `setTimeout(connectionTimeout)`: Sets connection timeout timer.
                - -> State transition: DISCONNECTED → CONNECTING.
      - -> `emit(ServiceEvent.READY)`: Emits service ready event.
      - -> `isInitialized = true`: Marks service as initialized.
  - -> `webSocketService.addEventListener(ServiceEvent.MESSAGE_RECEIVED, ...)`: Background script sets up message handler.
  - -> `webSocketService.addEventListener(ServiceEvent.CONNECTION_CHANGE, ...)`: Background script sets up connection state handler.
  - -> `webSocketService.addEventListener(ServiceEvent.ERROR, ...)`: Background script sets up error handler.

### 42. External Task Execution via WebSocket
This workflow handles the complete lifecycle of a task execution request initiated by an external WebSocket client, from message reception to task completion.

**Main Components:**
- `chrome-extension/src/background/services/websocket/connection.ts`
- `chrome-extension/src/background/services/websocket/protocol.ts`
- `chrome-extension/src/background/services/websocket/service.ts`
- `chrome-extension/src/background/index.ts` (`handleWebSocketTaskExecution`)
- `chrome-extension/src/background/agent/executor.ts`
- `chrome-extension/src/background/browser/context.ts`

**Relevance:**
- Primary Entry Points (key UI handlers)
- Core Domain Focus
- Multi-Component Orchestration
- Major Data Operations
- Critical External Integrations

**Sequence Flow:**
- External Server
  - -> Sends WebSocket message: `{ type: "execute_task", taskId: "task-123", prompt: "Navigate to example.com", metadata: {...} }`.
- `chrome-extension/src/background/services/websocket/connection.ts` (`onmessage` handler)
  - -> `emit(ConnectionEvent.MESSAGE, { message: rawMessage })`: Emits message event.
- `chrome-extension/src/background/services/websocket/service.ts` (`handleConnectionMessage`)
  - -> `WebSocketMessageInterpreter.receive(rawMessage)`: Deserializes and validates message.
    - `chrome-extension/src/background/services/websocket/protocol.ts` (`receive` method)
      - -> `JSON.parse(rawMessage)`: Parses JSON string.
      - -> `validateExecuteTaskMessage(parsed)`: Validates message structure.
        - Checks `taskId` is non-empty string (max 1000 chars).
        - Checks `prompt` is non-empty string (max 100KB).
        - Validates optional `metadata` is object.
      - <- Returns typed `ExecuteTaskMessage`.
  - -> `emit(ServiceEvent.MESSAGE_RECEIVED, { message: ExecuteTaskMessage })`: Emits message to application.
- `chrome-extension/src/background/index.ts` (`ServiceEvent.MESSAGE_RECEIVED` handler)
  - -> `isExecuteTaskMessage(message)`: Checks message type.
  - -> `handleWebSocketTaskExecution(message)`: Processes task execution request.
    - `index.ts` (`handleWebSocketTaskExecution` function)
      - -> Validates `taskId` and `prompt` are non-empty strings.
      - -> If `currentExecutor` exists:
        - -> `createTaskRejected(taskId, "Already executing a task")`: Creates rejection message.
        - -> `webSocketService.sendMessage(rejectionMessage)`: Sends rejection to server.
        - <- Returns early.
      - -> `createTaskAccepted(taskId)`: Creates acceptance message.
      - -> `webSocketService.sendMessage(acceptedMessage)`: Sends acceptance to server.
        - `service.ts` (`sendMessage` method)
          - -> `WebSocketMessageInterpreter.send(acceptedMessage)`: Serializes message to JSON.
          - -> `connectionManager.send(serializedMessage)`: Sends via WebSocket.
      - -> `chrome.tabs.query({ active: true, currentWindow: true })`: Gets active tab.
      - -> `browserContext.switchTab(activeTab.id)`: Switches to active tab.
      - -> `setupExecutor(taskId, prompt, browserContext)`: Initializes executor.
      - -> `subscribeToExecutorEvents(executor)`: Sets up event broadcasting (side panel + WebSocket).
      - -> `executor.execute()`: Starts task execution.
        - Execution events are broadcasted in real-time (see Workflow 44).
      - <- Task completes successfully or fails.
      - -> On success: Final `ExecutionEventMessage` with TASK_OK state is sent to WebSocket.
      - -> On failure: `createTaskRejected(taskId, errorMessage)` is sent to WebSocket.

### 43. WebSocket Ping/Pong Health Check
This workflow implements the heartbeat mechanism to ensure WebSocket connection health, with ping requests from the server and pong responses from the extension.

**Main Components:**
- `chrome-extension/src/background/services/websocket/protocol.ts`
- `chrome-extension/src/background/services/websocket/service.ts`
- `chrome-extension/src/background/index.ts`

**Relevance:**
- Multi-Component Orchestration
- Critical External Integrations

**Sequence Flow:**
- External Server
  - -> Sends WebSocket message: `{ type: "ping", timestamp: 1730000000000 }`.
- `chrome-extension/src/background/services/websocket/connection.ts` (`onmessage` handler)
  - -> `emit(ConnectionEvent.MESSAGE, { message: rawMessage })`: Emits message event.
- `chrome-extension/src/background/services/websocket/service.ts` (`handleConnectionMessage`)
  - -> `WebSocketMessageInterpreter.receive(rawMessage)`: Deserializes message.
    - `chrome-extension/src/background/services/websocket/protocol.ts` (`receive` method)
      - -> `validatePingMessage(parsed)`: Validates message structure.
        - Checks `timestamp` is a valid positive number.
      - <- Returns typed `PingMessage`.
  - -> `emit(ServiceEvent.MESSAGE_RECEIVED, { message: PingMessage })`: Emits message to application.
- `chrome-extension/src/background/index.ts` (`ServiceEvent.MESSAGE_RECEIVED` handler)
  - -> `isPingMessage(message)`: Checks message type.
  - -> `WebSocketMessageInterpreter.createPong()`: Creates pong response.
    - `protocol.ts` (`createPong` method)
      - <- Returns `{ type: "pong", timestamp: Date.now() }`.
  - -> `webSocketService.sendMessage(pongMessage)`: Sends pong response.
    - `service.ts` (`sendMessage` method)
      - -> `WebSocketMessageInterpreter.send(pongMessage)`: Serializes message.
      - -> `connectionManager.send(serializedMessage)`: Sends via WebSocket.
- External Server
  - <- Receives pong response, confirms connection is alive.

### 44. Execution Event Broadcasting
This workflow broadcasts real-time AgentEvent updates to both the side panel UI and WebSocket clients during task execution.

**Main Components:**
- `chrome-extension/src/background/index.ts` (`subscribeToExecutorEvents`)
- `chrome-extension/src/background/agent/event/manager.ts`
- `chrome-extension/src/background/services/websocket/protocol.ts`
- `chrome-extension/src/background/services/websocket/service.ts`

**Relevance:**
- Core Domain Focus
- Multi-Component Orchestration
- Major Data Operations
- Critical External Integrations

**Sequence Flow:**
- `chrome-extension/src/background/agent/executor.ts` (during task execution)
  - -> `eventManager.emit(event)`: Emits AgentEvent (e.g., TASK_START, STEP_OK, ACT_OK, TASK_FAIL).
- `chrome-extension/src/background/index.ts` (`subscribeToExecutorEvents`)
  - -> Event listener receives `AgentEvent` object.
  - -> **Side Panel Broadcast:**
    - -> If `port` is connected:
      - -> `port.postMessage({ type: 'event', event: serializedEvent })`: Sends to side panel.
  - -> **WebSocket Broadcast:**
    - -> If `webSocketService.isConnected()`:
      - -> `executor.getCurrentTaskId()`: Gets current task ID.
      - -> `WebSocketMessageInterpreter.createExecutionEvent(taskId, event)`: Creates ExecutionEventMessage.
        - `chrome-extension/src/background/services/websocket/protocol.ts` (`createExecutionEvent` method)
          - -> Serializes `AgentEvent` including `actor`, `state`, `data`, `timestamp`, `type` fields.
          - <- Returns `{ type: "execution_event", taskId, event: {...}, timestamp }`.
      - -> `webSocketService.sendMessage(eventMessage)`: Sends to WebSocket server.
        - `chrome-extension/src/background/services/websocket/service.ts` (`sendMessage` method)
          - -> `WebSocketMessageInterpreter.send(eventMessage)`: Serializes message to JSON.
          - -> `connectionManager.send(serializedMessage)`: Sends via WebSocket.
    - -> Error boundary: If WebSocket send fails, logs error but does not interrupt side panel updates.
- External Server & Side Panel
  - <- Both receive real-time execution updates in parallel.

### 45. WebSocket Error Recovery
This workflow handles WebSocket connection errors and implements automatic reconnection with exponential backoff strategy.

**Main Components:**
- `chrome-extension/src/background/services/websocket/connection.ts`
- `chrome-extension/src/background/services/websocket/errors.ts`
- `chrome-extension/src/background/services/websocket/service.ts`

**Relevance:**
- Multi-Component Orchestration
- Critical External Integrations

**Sequence Flow:**
- WebSocket Connection Error Occurs (e.g., network failure, server unavailable, connection timeout)
  - -> `chrome-extension/src/background/services/websocket/connection.ts` (`onerror` or `onclose` handler)
    - -> `new WebSocketError('WebSocket error occurred', WebSocketErrorCategory.NETWORK, {...})`: Creates categorized error.
    - -> `emit(ConnectionEvent.ERROR, { error })`: Emits error event.
    - -> `handleConnectionError(error)`: Processes the error.
      - `connection.ts` (`handleConnectionError` method)
        - -> `isRecoverableError(error)`: Checks if error is recoverable.
          - `chrome-extension/src/background/services/websocket/errors.ts` (`isRecoverableError` function)
            - -> Categorizes error (NETWORK and TIMEOUT errors are recoverable).
            - <- Returns `true` for NETWORK/TIMEOUT, `false` for VALIDATION/PROTOCOL/AUTH.
        - -> If recoverable:
          - -> `scheduleReconnection()`: Schedules reconnection attempt.
            - `connection.ts` (`scheduleReconnection` method)
              - -> State transition: CONNECTED/CONNECTING → RECONNECTING.
              - -> Calculates exponential backoff delay: `Math.min(1000 * 2^attempts, 30000)`.
                - Attempt 1: 1 second
                - Attempt 2: 2 seconds
                - Attempt 3: 4 seconds
                - Attempt 4: 8 seconds
                - Attempt 5: 16 seconds
                - Attempt 6+: 30 seconds (capped)
              - -> `setTimeout(() => { reconnectAttempts++; connect(); }, delay)`: Schedules reconnection.
        - -> If not recoverable:
          - -> State transition: → DISCONNECTED.
          - -> No automatic reconnection.
    - -> `emit(ConnectionEvent.STATE_CHANGE, { state: RECONNECTING })`: Emits state change.
  - -> `chrome-extension/src/background/services/websocket/service.ts` (`handleConnectionError`)
    - -> `emit(ServiceEvent.ERROR, { error })`: Propagates error to application layer.
  - -> `chrome-extension/src/background/index.ts` (`ServiceEvent.ERROR` handler)
    - -> `logger.error('WebSocket error:', error)`: Logs error for debugging.
- After Delay
  - -> `connectionManager.connect()`: Attempts reconnection.
    - -> If successful: State transition RECONNECTING → CONNECTED, reconnectAttempts reset to 0.
    - -> If fails: Repeats error recovery workflow with incremented attempt count.

### 46. WebSocket Disconnection and Cleanup
This workflow handles graceful shutdown of WebSocket connection when the extension is disabled, settings are changed, or the service is destroyed.

**Main Components:**
- `chrome-extension/src/background/services/websocket/service.ts`
- `chrome-extension/src/background/services/websocket/connection.ts`

**Relevance:**
- Multi-Component Orchestration
- Critical External Integrations

**Sequence Flow:**
- Trigger Event (extension shutdown, settings change, or explicit disconnect)
  - -> `chrome-extension/src/background/services/websocket/service.ts`
    - -> `disconnect()` or `destroy()` or `handleSettingsChange()` (when disabled): Initiates cleanup.
      - `service.ts` (`disconnect` method)
        - -> If `connectionManager` exists:
          - -> `connectionManager.disconnect()`: Closes WebSocket connection.
            - `chrome-extension/src/background/services/websocket/connection.ts` (`disconnect` method)
              - -> `clearTimers()`: Clears connection timeout and reconnection timers.
              - -> `reconnectAttempts = 0`: Resets reconnection counter.
              - -> Removes WebSocket event handlers (`onopen`, `onclose`, `onerror`, `onmessage`).
              - -> If `ws.readyState` is OPEN or CONNECTING:
                - -> `ws.close(1000, 'Client disconnect')`: Closes WebSocket with normal closure code.
              - -> `ws = null`: Clears WebSocket instance.
              - -> State transition: → DISCONNECTED.
              - -> `emit(ConnectionEvent.STATE_CHANGE, { state: DISCONNECTED })`: Emits state change.
          - -> `connectionManager.removeAllEventListeners()`: Removes all connection event listeners.
          - -> `connectionManager = null`: Clears connection manager reference.
    - -> `removeAllEventListeners()` (if `destroy()` called): Removes all service event listeners.
    - -> `isInitialized = false` (if `destroy()` called): Marks service as uninitialized.
    - -> `settings = null` (if `destroy()` called): Clears cached settings.
  - <- WebSocket connection is cleanly closed, all resources are released, no automatic reconnection is attempted.