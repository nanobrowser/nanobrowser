# Data Model
Data persistence is primarily handled via the Chrome Storage API (Local, Sync, and Session storage) for structured configuration and historical data. In-memory `WeakMap`s are used for transient caching of DOM-related information.

## Entity Breakdown

### AgentContext

**Purpose:**
Encapsulates the operational context for an AI agent, providing access to browser interactions, message management, event handling, and agent configuration options. It serves as the central hub for an agent's execution environment.

**Key Attributes:**
*   `taskId` (string): Unique identifier for the current task.
*   `browserContext` (BrowserContext): Manages browser interactions.
*   `messageManager` (MessageManager): Handles message history and token management.
*   `eventManager` (EventManager): Dispatches and subscribes to agent events.
*   `options` (Partial<AgentOptions>): Configuration settings for the agent.
*   `history` (AgentStepHistory): Stores the history of agent steps.
*   `isPaused` (boolean): Indicates if the agent's execution is paused.
*   `isStopped` (boolean): Indicates if the agent's execution is stopped.

**Relationships:**
*   One-to-one with `BrowserContext`
*   One-to-one with `MessageManager`
*   One-to-one with `EventManager`
*   One-to-one with `AgentStepHistory`

### ActionResult

**Purpose:**
Represents the outcome of a single action performed by an agent, including any generated output, errors, or flags for memory inclusion.

**Key Attributes:**
*   `output` (string): The primary output message of the action.
*   `error` (string): Any error message resulting from the action.
*   `includeInMemory` (boolean): Indicates if the output should be added to the agent's memory.
*   `interactedElement` (DOMHistoryElement): The DOM element interacted with during the action.
*   `newTabId` (number): The ID of a newly opened tab, if applicable.
*   `newTabUrl` (string): The URL of a newly opened tab, if applicable.
*   `newTabTitle` (string): The title of a newly opened tab, if applicable.
*   `dropdownOptions` (Array<Record<string, string>>): Options from a dropdown element.

### AgentStepRecord

**Purpose:**
Stores a snapshot of an agent's state at a specific step, including the model's output, the results of actions, and the browser state. This is used for historical replay.

**Key Attributes:**
*   `modelOutput` (string): The raw output from the LLM for this step.
*   `result` (ActionResult[]): An array of results from actions taken in this step.
*   `state` (BrowserStateHistory): The browser state at the end of this step.
*   `metadata` (StepMetadata): Metadata about the step's execution.

**Relationships:**
*   One-to-many with `ActionResult`
*   One-to-one with `BrowserStateHistory`
*   One-to-one with `StepMetadata`

### BrowserContextConfig

**Purpose:**
Defines the configuration settings for the browser context, controlling aspects like page load wait times, window size, viewport expansion, and URL filtering.

**Key Attributes:**
*   `minimumWaitPageLoadTime` (number): Minimum time to wait after page loads.
*   `waitForNetworkIdlePageLoadTime` (number): Time to wait for network requests to finish.
*   `maximumWaitPageLoadTime` (number): Maximum total wait time for page load.
*   `waitBetweenActions` (number): Time to wait between multiple actions in one step.
*   `browserWindowSize` (BrowserContextWindowSize): Default browser window dimensions.
*   `viewportExpansion` (number): Pixels to expand the viewport for element visibility.
*   `allowedUrls` (string[]): List of explicitly allowed URLs.
*   `deniedUrls` (string[]): List of explicitly denied URLs.
*   `includeDynamicAttributes` (boolean): Whether to include dynamic attributes in CSS selectors.
*   `homePageUrl` (string): The default home page URL.
*   `displayHighlights` (boolean): Whether to show visual highlights on interactive elements.

### PageState

**Purpose:**
Represents the detailed state of a single browser tab, including its DOM structure, URL, title, and a screenshot.

**Key Attributes:**
*   `tabId` (number): The ID of the browser tab.
*   `url` (string): The current URL of the page.
*   `title` (string): The title of the page.
*   `screenshot` (string): Base64 encoded screenshot of the page.
*   `scrollY` (number): Current vertical scroll position.
*   `scrollHeight` (number): Total scrollable height of the page.
*   `visualViewportHeight` (number): Height of the visual viewport.
*   `elementTree` (DOMElementNode): The root DOM element node of the page.
*   `selectorMap` (Map<number, DOMElementNode>): Map of highlight indices to DOM elements.

**Relationships:**
*   One-to-one with `DOMElementNode` (for `elementTree`)

### BrowserState

**Purpose:**
Aggregates the state of the current page with information about all open tabs in the browser, providing a comprehensive view of the browser's condition.

**Key Attributes:**
*   `tabId` (number): The ID of the current active tab.
*   `url` (string): The URL of the current active page.
*   `title` (string): The title of the current active page.
*   `screenshot` (string): Base64 encoded screenshot of the current active page.
*   `scrollY` (number): Current vertical scroll position of the current page.
*   `scrollHeight` (number): Total scrollable height of the current page.
*   `visualViewportHeight` (number): Height of the visual viewport of the current page.
*   `elementTree` (DOMElementNode): The root DOM element node of the current page.

**Relationships:**
*   One-to-one with `DOMElementNode` (for `elementTree`)
*   One-to-many with `TabInfo`

### DOMElementNode

**Purpose:**
Represents a single HTML element in the DOM tree, capturing its tag, attributes, visibility, interactivity, and position for AI analysis and interaction.

**Key Attributes:**
*   `tagName` (string): The HTML tag name (e.g., 'div', 'a', 'input').
*   `xpath` (string): The XPath of the element.
*   `attributes` (Record<string, string>): A map of HTML attributes and their values.
*   `isVisible` (boolean): Indicates if the element is visible on the page.
*   `isInteractive` (boolean): Indicates if the element is interactive.
*   `isTopElement` (boolean): Indicates if the element is the topmost at its position.
*   `isInViewport` (boolean): Indicates if the element is within the expanded viewport.
*   `highlightIndex` (number): A unique index for highlighting and referencing the element.

**Relationships:**
*   One-to-many with `DOMBaseNode` (for `children`)
*   Many-to-one with `DOMElementNode` (for `parent`)

### DOMHistoryElement

**Purpose:**
A simplified, serializable representation of a DOM element, primarily used for storing historical interaction data and for replaying actions.

**Key Attributes:**
*   `tagName` (string): The HTML tag name.
*   `xpath` (string): The XPath of the element.
*   `attributes` (Record<string, string>): A map of HTML attributes.
*   `text` (string): The visible text content of the element.
*   `highlightIndex` (number): The index used for highlighting.
*   `parentBranchPath` (string[]): The XPath segments of parent elements.
*   `hashedDomElement` (HashedDomElement): A hash of the DOM element for unique identification.
*   `viewportCoordinates` (CoordinateSet): Coordinates relative to the viewport.

**Relationships:**
*   One-to-one with `HashedDomElement`

### ProviderConfig

**Purpose:**
Stores the configuration details for a single Large Language Model (LLM) provider, including API keys, base URLs, and supported models.

**Key Attributes:**
*   `name` (string): Display name of the provider.
*   `type` (ProviderTypeEnum): The type of LLM provider (e.g., OpenAI, AzureOpenAI).
*   `apiKey` (string): The API key for authentication.
*   `baseUrl` (string): The base URL for the API endpoint.
*   `modelNames` (string[]): List of model names supported by this provider.
*   `createdAt` (number): Timestamp of when the provider was created.
*   `azureDeploymentNames` (string[]): Azure-specific deployment names.

### ModelConfig

**Purpose:**
Defines the configuration for a specific LLM model used by an agent, linking it to a provider and specifying parameters like temperature and reasoning effort.

**Key Attributes:**
*   `provider` (string): The ID of the LLM provider.
*   `modelName` (string): The specific name of the model.
*   `parameters` (Record<string, unknown>): Additional model-specific parameters.
*   `reasoningEffort` ('minimal' | 'low' | 'medium' | 'high'): Reasoning effort for O-series models.

### AgentModelRecord

**Purpose:**
Stores the `ModelConfig` for each agent (e.g., Planner, Navigator), allowing different agents to use different LLM models and configurations.

**Key Attributes:**
*   `agents` (Record<AgentNameEnum, ModelConfig>): A map where keys are agent names and values are their respective model configurations.

**Relationships:**
*   One-to-many with `ModelConfig`

### ChatSessionMetadata

**Purpose:**
Contains essential metadata for a chat session, such as its ID, title, creation/update timestamps, and message count, without loading the full message content.

**Key Attributes:**
*   `id` (string): Unique identifier for the chat session.
*   `title` (string): A descriptive title for the session.
*   `createdAt` (number): Unix timestamp (milliseconds) of session creation.
*   `updatedAt` (number): Unix timestamp (milliseconds) of last update.
*   `messageCount` (number): Total number of messages in the session.

### ChatMessage

**Purpose:**
Represents a single message within a chat session, including the actor who sent it, the content, and a timestamp.

**Key Attributes:**
*   `id` (string): Unique ID for the message.
*   `actor` (Actors): The sender of the message (e.g., USER, PLANNER).
*   `content` (string): The text content of the message.
*   `timestamp` (number): Unix timestamp (milliseconds) of message creation.

### ChatSession

**Purpose:**
Represents a complete chat conversation, combining its metadata with the full list of messages exchanged.

**Key Attributes:**
*   `id` (string): Unique identifier for the chat session.
*   `title` (string): A descriptive title for the session.
*   `createdAt` (number): Unix timestamp (milliseconds) of session creation.
*   `updatedAt` (number): Unix timestamp (milliseconds) of last update.
*   `messageCount` (number): Total number of messages in the session.
*   `messages` (ChatMessage[]): An array of all messages in the session.

**Relationships:**
*   One-to-many with `ChatMessage`

### ChatAgentStepHistory

**Purpose:**
Stores the historical sequence of an agent's execution steps for a specific task, enabling replay functionality.

**Key Attributes:**
*   `task` (string): The description of the task associated with this history.
*   `history` (string): A serialized representation of the agent's step records.
*   `timestamp` (number): Unix timestamp (milliseconds) of when the history was stored.

### UserProfile

**Purpose:**
Stores basic user-specific information, primarily a unique identifier for analytics and personalization.

**Key Attributes:**
*   `userId` (string): Unique identifier for the user.

### FavoritePrompt

**Purpose:**
Represents a user-saved prompt, allowing quick access to frequently used instructions or queries.

**Key Attributes:**
*   `id` (number): Unique identifier for the favorite prompt.
*   `title` (string): A user-defined title for the prompt.
*   `content` (string): The actual text content of the prompt.

### FirewallConfig

**Purpose:**
Defines the settings for the browser's firewall, including lists of allowed and denied URLs and an enable/disable toggle.

**Key Attributes:**
*   `allowList` (string[]): URLs that are explicitly permitted.
*   `denyList` (string[]): URLs that are explicitly blocked.
*   `enabled` (boolean): Flag indicating if the firewall is active.

### WebSocketConfig

**Purpose:**
Defines the configuration settings for the WebSocket service, controlling connection parameters and enabling/disabling the WebSocket feature.

**Key Attributes:**
*   `enabled` (boolean): Flag indicating if WebSocket communication is enabled.
*   `serverUrl` (string): The WebSocket server URL (ws:// or wss://).
*   `connectionTimeout` (number): Connection timeout in milliseconds (default: 10000).

### ConnectionState

**Purpose:**
Enumerates the possible lifecycle states of a WebSocket connection for state machine management.

**Values:**
*   `DISCONNECTED`: WebSocket is not connected and not attempting to connect.
*   `CONNECTING`: WebSocket is attempting to establish initial connection.
*   `CONNECTED`: WebSocket is successfully connected and ready for communication.
*   `RECONNECTING`: WebSocket is attempting to reconnect after a disconnection.

### ExecuteTaskMessage

**Purpose:**
Represents an incoming message from the WebSocket server requesting task execution by the extension.

**Key Attributes:**
*   `type` ('execute_task'): Message type discriminator.
*   `taskId` (string): Unique identifier for the task (max 1000 characters).
*   `prompt` (string): The task description/instruction (max 100KB).
*   `metadata` (Record<string, unknown>): Optional metadata for task context (e.g., priority, timeout).

### PingMessage

**Purpose:**
Represents an incoming heartbeat message from the WebSocket server to check connection health.

**Key Attributes:**
*   `type` ('ping'): Message type discriminator.
*   `timestamp` (number): Unix timestamp (milliseconds) when ping was sent.

### TaskAcceptedMessage

**Purpose:**
Represents an outgoing message sent when the extension accepts a task execution request from the WebSocket server.

**Key Attributes:**
*   `type` ('task_accepted'): Message type discriminator.
*   `taskId` (string): The ID of the accepted task.
*   `timestamp` (number): Unix timestamp (milliseconds) when task was accepted.

### TaskRejectedMessage

**Purpose:**
Represents an outgoing message sent when the extension rejects a task execution request, including the reason for rejection.

**Key Attributes:**
*   `type` ('task_rejected'): Message type discriminator.
*   `taskId` (string): The ID of the rejected task.
*   `reason` (string): Human-readable reason for rejection (e.g., "Already executing a task", "Invalid request").
*   `timestamp` (number): Unix timestamp (milliseconds) when task was rejected.

### ExecutionEventMessage

**Purpose:**
Represents an outgoing message that streams real-time AgentEvent updates to the WebSocket server during task execution.

**Key Attributes:**
*   `type` ('execution_event'): Message type discriminator.
*   `taskId` (string): The ID of the executing task.
*   `event` (AgentEvent): The serialized agent event containing actor, state, data, timestamp, and type.
*   `timestamp` (number): Unix timestamp (milliseconds) when event was sent.

**Relationships:**
*   One-to-one with `AgentEvent`

### PongMessage

**Purpose:**
Represents an outgoing heartbeat response message confirming the extension is alive and responsive.

**Key Attributes:**
*   `type` ('pong'): Message type discriminator.
*   `timestamp` (number): Unix timestamp (milliseconds) when pong was sent.

### IncomingMessage

**Purpose:**
Union type representing all possible messages the extension can receive from the WebSocket server.

**Union Members:**
*   `ExecuteTaskMessage`
*   `PingMessage`

### OutgoingMessage

**Purpose:**
Union type representing all possible messages the extension can send to the WebSocket server.

**Union Members:**
*   `TaskAcceptedMessage`
*   `TaskRejectedMessage`
*   `ExecutionEventMessage`
*   `PongMessage`

### WebSocketError

**Purpose:**
Represents a structured error specific to WebSocket operations, with categorization for proper error handling and recovery.

**Key Attributes:**
*   `message` (string): Human-readable error description.
*   `category` (WebSocketErrorCategory): Error category for classification.
*   `context` (Record<string, unknown>): Additional context about the error.
*   `originalError` (Error): The original error object if available.

**Relationships:**
*   Extends `Error`

### WebSocketErrorCategory

**Purpose:**
Enumerates error categories for WebSocket operations to determine recovery strategies.

**Values:**
*   `NETWORK`: Network-related errors (connection refused, timeout, etc.).
*   `PROTOCOL`: Protocol errors (invalid message format, handshake failure).
*   `TIMEOUT`: Timeout errors (connection timeout, message timeout).
*   `VALIDATION`: Validation errors (invalid configuration, malformed messages).
*   `AUTH`: Authentication/authorization errors.
*   `UNKNOWN`: Unknown or uncategorized errors.

## Additional Entities
*   `MessageMetadata`
*   `ManagedMessage`
*   `MessageHistory`
*   `HashedDomElement`
*   `CoordinateSet`
*   `ViewportInfo`
*   `RawDomTextNode`
*   `RawDomElementNode`
*   `RawDomTreeNode`
*   `BuildDomTreeArgs`
*   `PerfMetrics`
*   `BuildDomTreeResult`
*   `ReadabilityResult`
*   `FrameInfo`
*   `DOMBaseNode`
*   `DOMTextNode`
*   `DOMState`
*   `TabInfo`
*   `BrowserStateHistory`
*   `BrowserContextWindowSize`
*   `BrowserError`
*   `URLNotAllowedError`
*   `SanitizationResult`
*   `ValidationResult`
*   `SecurityPattern`
*   `TaskMetrics`
*   `SpeechToTextModelConfig`
*   `SpeechToTextRecord`
*   `GeneralSettingsConfig`
*   `AnalyticsSettingsConfig`
*   `LLMKeyRecord`
*   `AgentStepInfo`
*   `StepMetadata`
*   `AgentBrain`
*   `AgentOutput`
*   `WrappedActionResult`
*   `ActionSchema`
*   `PlannerOutput`
*   `ParsedModelOutput`
*   `DevLocale`
*   `I18nValue`
*   `JsonSchemaObject`
*   `JSONSchemaType`
*   `AttachedFile`