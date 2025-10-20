# Introduction
The architecture of this system is primarily a client-side, event-driven design, centered around a Chrome extension. It leverages a modular approach with distinct packages for core functionalities like agents, browser interaction, storage, and UI. The core technology stack includes TypeScript, React, Zod for schema validation, LangChain for LLM integration, and Puppeteer for browser automation.

## Component Breakdown

**Note:** This document presents the 30 most architecturally significant components. Additional components are summarized in the following section.

### 1. chrome-extension/src/background/index.ts

**Primary Responsibility:**
This file serves as the main entry point and orchestrator for the Chrome extension's background service, initializing core functionalities and handling inter-component communication from both the side panel UI and external WebSocket clients.

**Key Functions/Methods/Exports:**
**`setupExecutor`**: Initializes the Executor with agents and browser context.
**`subscribeToExecutorEvents`**: Sets up event listeners for task execution events and broadcasts them to both side panel and WebSocket clients.
**`handleMessage`**: Processes incoming messages from other parts of the extension (e.g., side panel).
**`handleConnect`**: Manages long-lived connections from the side panel.
**`handleWebSocketTaskExecution`**: Handles incoming task execution requests from WebSocket server, validating inputs and orchestrating task execution.

**Internal Structure:**
Initializes `BrowserContext`, `Executor`, `SpeechToTextService`, `webSocketService`, and sets up listeners for Chrome API events and WebSocket events.

**State Management:**
Manages the lifecycle of the `Executor` and `BrowserContext` instances, including task execution state, active connections, and WebSocket connection status.

**Key Imports & Interactions:**
Imports `Executor`, `BrowserContext`, `SpeechToTextService`, `analytics`, `webSocketService`, `WebSocketMessageInterpreter`, and various storage modules. Interacts heavily with Chrome's `runtime` and `tabs` APIs, and coordinates with WebSocket service for external task requests.

**Data Handling:**
Processes incoming messages from the side panel and WebSocket server, manages task IDs, validates WebSocket message payloads, orchestrates data flow between agents and browser, and broadcasts execution events to multiple clients (side panel + WebSocket).

### 2. chrome-extension/src/background/agent/executor.ts

**Primary Responsibility:**
This component orchestrates the execution of AI-driven tasks by managing the interaction between the Planner and Navigator agents, handling task lifecycle, and managing history.

**Key Functions/Methods/Exports:**
**`constructor`**: Initializes the Executor with task, browser context, and LLMs.
**`execute`**: Starts and manages the main task execution loop.
**`cancel`**: Stops the current task execution.
**`resume`**: Resumes a paused task.
**`pause`**: Pauses the current task execution.
**`replayHistory`**: Replays a saved history of actions.
**`addFollowUpTask`**: Adds a new task to be executed after the current one.

**Internal Structure:**
Contains instances of `PlannerAgent`, `NavigatorAgent`, `MessageManager`, `EventManager`, and `BrowserContext`.

**State Management:**
Manages the overall task execution state (running, paused, cancelled), step count, and failure count. Persists agent step history.

**Key Imports & Interactions:**
Interacts with `NavigatorAgent`, `PlannerAgent`, `MessageManager`, `BrowserContext`, `EventManager`, and `chatHistoryStore`.

**Data Handling:**
Processes task descriptions, agent outputs, browser states, and stores execution history.

### 3. chrome-extension/src/background/browser/context.ts

**Primary Responsibility:**
This service manages the browser environment, including tabs, navigation, and interaction with web pages, acting as a central point for browser automation.

**Key Functions/Methods/Exports:**
**`constructor`**: Initializes the browser context with configuration.
**`getCurrentPage`**: Retrieves the currently active `Page` object.
**`navigateTo`**: Navigates the current tab to a specified URL.
**`openTab`**: Opens a new tab with a given URL.
**`closeTab`**: Closes a specified tab.
**`switchTab`**: Switches to a specified tab.
**`getState`**: Retrieves the current browser state, including DOM and screenshot.
**`removeHighlight`**: Removes all highlights from the current page.

**Internal Structure:**
Maintains a map of attached `Page` instances and manages the current active tab ID.

**State Management:**
Manages the state of active browser tabs and their associated `Page` objects.

**Key Imports & Interactions:**
Interacts with `Page` objects, `dom/service` for DOM operations, and Chrome's `tabs` API. Uses `analytics` for tracking.

**Data Handling:**
Retrieves and caches browser state, including DOM information and screenshots, and handles URL validation.

### 4. chrome-extension/src/background/agent/messages/service.ts

**Primary Responsibility:**
This component manages the conversation history and message formatting for interactions with Large Language Models (LLMs), including token management and sensitive data filtering.

**Key Functions/Methods/Exports:**
**`constructor`**: Initializes the message manager with settings.
**`initTaskMessages`**: Sets up initial system and user messages for a new task.
**`addStateMessage`**: Adds a browser state message to the history.
**`addModelOutput`**: Adds an LLM's output message to the history.
**`getMessages`**: Retrieves the current list of messages.
**`cutMessages`**: Trims messages to fit within the maximum token limit.
**`addToolMessage`**: Adds a tool's response message to the history.

**Internal Structure:**
Maintains a `MessageHistory` object and `MessageManagerSettings` for configuration.

**State Management:**
Manages the list of `BaseMessage` objects, their metadata (e.g., token count), and ensures the total token count stays within limits.

**Key Imports & Interactions:**
Interacts with `MessageHistory`, `guardrails` for content filtering, and `BaseMessage` types from `@langchain/core/messages`.

**Data Handling:**
Stores and retrieves `BaseMessage` objects, filters sensitive data, and estimates token counts for LLM input.

### 5. chrome-extension/src/background/agent/agents/navigator.ts

**Primary Responsibility:**
This agent is responsible for interpreting the current browser state and executing specific actions to navigate and interact with web pages based on the overall task plan.

**Key Functions/Methods/Exports:**
**`constructor`**: Initializes the Navigator agent with an action registry and options.
**`execute`**: Executes a single step of navigation, calling the LLM and performing actions.
**`addStateMessageToMemory`**: Adds the current browser state to the agent's memory.
**`removeLastStateMessageFromMemory`**: Removes the last state message from memory.
**`doMultiAction`**: Executes multiple actions in sequence.
**`executeHistoryStep`**: Executes a single step from a historical replay.
**`updateActionIndices`**: Updates element indices in historical actions for replay.

**Internal Structure:**
Extends `BaseAgent` and uses a `NavigatorActionRegistry` to manage available actions.

**State Management:**
Manages its internal state during execution, including handling retries and updating action indices for historical replays.

**Key Imports & Interactions:**
Interacts with `ActionRegistry`, `BrowserContext`, `MessageManager`, and `HistoryTreeProcessor`. Uses `zod` for output validation.

**Data Handling:**
Processes `BrowserState` to generate actions, validates model output against a Zod schema, and updates action arguments for replay.

### 6. chrome-extension/src/background/agent/agents/planner.ts

**Primary Responsibility:**
This agent is responsible for developing and refining high-level strategies and plans to achieve the overall task goal, based on the current conversation history.

**Key Functions/Methods/Exports:**
**`constructor`**: Initializes the Planner agent with options.
**`execute`**: Executes a single planning step, generating the next plan or final answer.

**Internal Structure:**
Extends `BaseAgent` and uses a `PlannerPrompt` to construct its input messages.

**State Management:**
Manages its internal state during execution, primarily by processing the full message history to generate the next plan.

**Key Imports & Interactions:**
Interacts with `MessageManager` to retrieve conversation history and `guardrails` to filter external content.

**Data Handling:**
Processes `BaseMessage` objects, filters external content, and generates `PlannerOutput` based on its Zod schema.

### 7. chrome-extension/src/background/browser/page.ts

**Primary Responsibility:**
This component encapsulates all Puppeteer-based interactions with a single browser tab, providing methods for navigation, DOM manipulation, and screenshot capture.

**Key Functions/Methods/Exports:**
**`attachPuppeteer`**: Connects Puppeteer to the Chrome tab.
**`detachPuppeteer`**: Disconnects Puppeteer from the Chrome tab.
**`getClickableElements`**: Retrieves a structured DOM tree with clickable elements.
**`navigateTo`**: Navigates the Puppeteer page to a given URL.
**`scrollToPercent`**: Scrolls the page or an element to a specific percentage.
**`sendKeys`**: Sends keyboard input to the page.
**`clickElementNode`**: Clicks a specified DOM element.
**`inputTextElementNode`**: Inputs text into a specified DOM element.
**`getDropdownOptions`**: Retrieves options from a dropdown element.
**`selectDropdownOption`**: Selects an option in a dropdown element.

**Internal Structure:**
Manages a `PuppeteerPage` instance and its associated `Browser` connection. Caches `PageState` and clickable element hashes.

**State Management:**
Maintains the `PageState` (URL, title, scroll info, screenshot) and tracks the validity and attachment status of the page.

**Key Imports & Interactions:**
Interacts with `puppeteer-core`, `dom/service` for DOM tree building, and `dom/clickable/service` for element hashing.

**Data Handling:**
Captures screenshots, retrieves DOM element data, and processes user input for browser interactions.

### 8. chrome-extension/src/background/agent/actions/builder.ts

**Primary Responsibility:**
This component is responsible for defining and building the set of executable actions that the Navigator agent can perform, including their schemas and execution logic.

**Key Functions/Methods/Exports:**
**`Action`**: A class representing a single executable action with its schema and handler.
**`buildDynamicActionSchema`**: Constructs a Zod schema dynamically from a list of actions.
**`ActionBuilder`**: A class that builds a collection of default actions.
**`InvalidInputError`**: Custom error for invalid action inputs.

**Internal Structure:**
The `ActionBuilder` class constructs a list of `Action` instances, each wrapping an asynchronous handler and a Zod schema.

**State Management:**
Actions themselves are stateless, but their `call` method operates on the `AgentContext` which holds the task state.

**Key Imports & Interactions:**
Imports various action schemas from `schemas.ts`, `AgentContext`, `t` for i18n, and `wrapUntrustedContent` for security.

**Data Handling:**
Defines Zod schemas for action inputs and validates inputs before execution.

### 9. chrome-extension/src/background/agent/actions/schemas.ts

**Primary Responsibility:**
This file defines the Zod schemas for all available actions that the Navigator agent can execute, providing strict type validation for agent inputs.

**Key Functions/Methods/Exports:**
**`ActionSchema`**: Interface defining the structure of an action schema.
**`clickElementActionSchema`**: Schema for clicking an element.
**`inputTextActionSchema`**: Schema for inputting text into an element.
**`goToUrlActionSchema`**: Schema for navigating to a URL.
**`searchGoogleActionSchema`**: Schema for performing a Google search.
**`doneActionSchema`**: Schema for indicating task completion.
**`openTabActionSchema`**: Schema for opening a new tab.
**`switchTabActionSchema`**: Schema for switching to an existing tab.
**`sendKeysActionSchema`**: Schema for sending keyboard keys.
**`scrollToTextActionSchema`**: Schema for scrolling to specific text.
**`cacheContentActionSchema`**: Schema for caching content.
**`selectDropdownOptionActionSchema`**: Schema for selecting a dropdown option.
**`getDropdownOptionsActionSchema`**: Schema for getting dropdown options.
**`closeTabActionSchema`**: Schema for closing a tab.
**`waitActionSchema`**: Schema for waiting a specified duration.
**`previousPageActionSchema`**: Schema for scrolling to the previous page.
**`nextPageActionSchema`**: Schema for scrolling to the next page.
**`scrollToTopActionSchema`**: Schema for scrolling to the top of the page.
**`scrollToBottomActionSchema`**: Schema for scrolling to the bottom of the page.

**Internal Structure:**
A collection of `ActionSchema` objects, each containing a `name`, `description`, and a `z.ZodType` schema.

**State Management:**
Not applicable; this component defines data structures, not state.

**Key Imports & Interactions:**
Imports `z` from `zod`. These schemas are consumed by `ActionBuilder` and `NavigatorAgent`.

**Data Handling:**
Provides the formal data contracts for all agent actions, ensuring consistent input and output types.

### 10. chrome-extension/src/background/browser/dom/service.ts

**Primary Responsibility:**
This service is responsible for injecting scripts into web pages to build a structured DOM tree representation and extract content like markdown or readability-parsed text.

**Key Functions/Methods/Exports:**
**`getMarkdownContent`**: Retrieves the markdown representation of the current page's content.
**`getReadabilityContent`**: Extracts readable content from the current page using a readability algorithm.
**`getClickableElements`**: Builds a structured DOM tree and identifies clickable elements.
**`removeHighlights`**: Removes all visual highlights from the current page.
**`getScrollInfo`**: Retrieves scroll position information for the current page.
**`injectBuildDomTreeScripts`**: Injects necessary DOM building scripts into all frames of a tab.

**Internal Structure:**
Uses `chrome.scripting.executeScript` to inject and execute JavaScript functions (`buildDomTree`, `turn2Markdown`, `parserReadability`) within the target page's context.

**State Management:**
Not applicable; this component primarily performs operations and returns data.

**Key Imports & Interactions:**
Interacts with Chrome's `scripting` API, `raw_types` for raw DOM data, and `views` for structured DOM nodes.

**Data Handling:**
Parses raw DOM tree data into `DOMElementNode` and `DOMTextNode` objects, and extracts content.

### 11. chrome-extension/public/buildDomTree.js

**Primary Responsibility:**
This script, injected into web pages, builds a simplified, structured representation of the DOM tree, identifies interactive and visible elements, and applies visual highlights.

**Key Functions/Methods/Exports:**
**`window.buildDomTree`**: The main function to build the DOM tree and highlights.
**`highlightElement`**: Applies visual highlights to an element.
**`isInteractiveElement`**: Determines if an element is interactive based on heuristics.
**`isElementVisible`**: Checks if an element is visible in the viewport.
**`isTopElement`**: Checks if an element is the topmost element at its position.
**`getXPathTree`**: Generates an XPath for a given element.

**Internal Structure:**
Contains functions for DOM traversal, element visibility checks, interactivity heuristics, XPath generation, and visual highlighting logic. Uses WeakMaps for caching DOM properties.

**State Management:**
Manages `DOM_CACHE` for performance and `_highlightCleanupFunctions` for removing highlights.

**Key Imports & Interactions:**
Directly interacts with the browser's `document`, `window`, and `HTMLElement` APIs.

**Data Handling:**
Extracts element tag names, attributes, XPath, visibility, interactivity, and coordinates, returning a map of `RawDomTreeNode` objects.

### 12. packages/storage/lib/base/base.ts

**Primary Responsibility:**
This module provides a generic factory function `createStorage` for creating persistent storage instances that abstract away the underlying Chrome storage API.

**Key Functions/Methods/Exports:**
**`createStorage`**: Factory function to create a storage instance.
**`updateCache`**: Updates the internal cache with a new value or function result.
**`checkStoragePermission`**: Verifies if the storage permission is granted in the manifest.

**Internal Structure:**
Uses `chrome.storage.local`, `sync`, or `session` based on `StorageEnum`. Includes logic for live updates and session access levels.

**State Management:**
Manages the internal cache (`_cache`) for each storage instance and handles updates from `chrome.storage.onChanged` events.

**Key Imports & Interactions:**
Interacts with Chrome's `storage` API and `SessionAccessLevelEnum`, `StorageEnum` from `enums.ts`.

**Data Handling:**
Serializes and deserializes data to and from Chrome storage, supporting custom serialization functions.

### 13. packages/storage/lib/settings/llmProviders.ts

**Primary Responsibility:**
This component manages the configuration for various Large Language Model (LLM) providers, including API keys, base URLs, and supported models.

**Key Functions/Methods/Exports:**
**`createLLMProviderStorage`**: Creates a storage instance for LLM providers.
**`setProvider`**: Saves or updates a provider's configuration.
**`getProvider`**: Retrieves a specific provider's configuration.
**`removeProvider`**: Deletes a provider's configuration.
**`getAllProviders`**: Retrieves all configured providers.
**`getProviderTypeByProviderId`**: Determines the provider type from its ID.
**`getDefaultDisplayNameFromProviderId`**: Gets the default display name for a provider.
**`getDefaultProviderConfig`**: Returns the default configuration for a given provider.
**`getDefaultAgentModelParams`**: Returns default model parameters for an agent and provider.

**Internal Structure:**
Uses `createStorage` to persist `LLMKeyRecord` (a map of provider IDs to `ProviderConfig`). Includes backward compatibility logic.

**State Management:**
Manages the collection of `ProviderConfig` objects, ensuring their consistency and providing default values.

**Key Imports & Interactions:**
Depends on `createStorage` from `base.ts` and `ProviderTypeEnum`, `AgentNameEnum` from `types.ts`.

**Data Handling:**
Stores `ProviderConfig` objects, which include sensitive API keys, model names, and Azure-specific deployment details.

### 14. packages/storage/lib/settings/agentModels.ts

**Primary Responsibility:**
This module manages the specific LLM model configurations chosen for different agents (e.g., Planner, Navigator), including model names and parameters.

**Key Functions/Methods/Exports:**
**`createAgentModelStorage`**: Creates a storage instance for agent model configurations.
**`setAgentModel`**: Sets the model configuration for a specific agent.
**`getAgentModel`**: Retrieves the model configuration for a specific agent.
**`resetAgentModel`**: Resets the model configuration for an agent to its default.
**`hasAgentModel`**: Checks if a model is configured for a specific agent.
**`getConfiguredAgents`**: Returns a list of agents that have configured models.
**`getAllAgentModels`**: Retrieves all agent model configurations.
**`cleanupLegacyValidatorSettings`**: Removes any old validator agent settings for backward compatibility.

**Internal Structure:**
Uses `createStorage` to persist `AgentModelRecord` (a map of `AgentNameEnum` to `ModelConfig`).

**State Management:**
Manages the `ModelConfig` for each agent, including parameters like temperature, topP, and reasoning effort.

**Key Imports & Interactions:**
Depends on `createStorage` from `base.ts` and `AgentNameEnum`, `llmProviderParameters` from `types.ts`.

**Data Handling:**
Stores `ModelConfig` objects, which specify the LLM provider, model name, and specific parameters for each agent.

### 15. chrome-extension/src/background/agent/helper.ts

**Primary Responsibility:**
This utility provides helper functions for creating and configuring `BaseChatModel` instances from various LLM providers based on stored settings.

**Key Functions/Methods/Exports:**
**`createChatModel`**: Factory function to create a `BaseChatModel` instance.
**`isOpenAIReasoningModel`**: Checks if a model is an OpenAI reasoning model.
**`isAnthropicOpusModel`**: Checks if a model is an Anthropic Opus model.
**`createOpenAIChatModel`**: Creates a ChatOpenAI model instance.
**`createAzureChatModel`**: Creates an AzureChatOpenAI model instance.
**`ChatLlama`**: Custom class for Llama API compatibility.

**Internal Structure:**
Contains logic to instantiate different LangChain chat models (`ChatOpenAI`, `ChatAnthropic`, `ChatGoogleGenerativeAI`, etc.) and handle provider-specific configurations.

**State Management:**
Not applicable; this component is a utility for model instantiation.

**Key Imports & Interactions:**
Imports various `Chat*` classes from `@langchain/*` packages and `ProviderConfig`, `ModelConfig`, `ProviderTypeEnum` from `@extension/storage`.

**Data Handling:**
Processes `ProviderConfig` and `ModelConfig` to correctly initialize LLM instances with appropriate API keys, base URLs, and model parameters.

### 16. chrome-extension/src/background/agent/types.ts

**Primary Responsibility:**
This file defines the core types and interfaces for the agent system, including `AgentContext`, `AgentOptions`, `ActionResult`, and `AgentOutput`.

**Key Functions/Methods/Exports:**
**`AgentOptions`**: Interface for agent configuration options.
**`AgentContext`**: Class encapsulating the current state and resources for an agent.
**`AgentStepInfo`**: Class holding information about a single agent step.
**`ActionResult`**: Class representing the outcome of an action.
**`WrappedActionResult`**: Type for an action result with a tool call ID.
**`StepMetadata`**: Class for metadata about an agent step.
**`AgentBrain`**: Type for the agent's brain (model output schema).
**`AgentOutput`**: Interface for the overall output of an agent.

**Internal Structure:**
Defines data structures and interfaces that are fundamental to how agents operate and communicate.

**State Management:**
`AgentContext` encapsulates the current state of an agent's execution, including `browserContext`, `messageManager`, `eventManager`, and `history`.

**Key Imports & Interactions:**
Imports `BrowserContext`, `MessageManager`, `EventManager`, `AgentEvent`, `AgentStepHistory`, and `z` for schema definition.

**Data Handling:**
Defines the data models for agent inputs, outputs, and contextual information during task execution.

### 17. chrome-extension/src/background/agent/agents/base.ts

**Primary Responsibility:**
This abstract class provides the foundational structure and common functionalities for all AI agents, including LLM invocation, structured output handling, and error management.

**Key Functions/Methods/Exports:**
**`BaseAgent`**: Abstract class providing common agent functionality.
**`invoke`**: Abstract method for invoking the LLM.
**`execute`**: Abstract method for executing the agent's main logic.
**`validateModelOutput`**: Validates the LLM's raw output against the agent's schema.

**Internal Structure:**
Manages the `chatLLM`, `context`, `prompt`, and `modelOutputSchema` for derived agents. Includes logic for structured output and Llama-specific handling.

**State Management:**
Not applicable directly, but provides the framework for agents to manage their state through `AgentContext`.

**Key Imports & Interactions:**
Interacts with `BaseChatModel` from `@langchain/core`, `AgentContext`, `BasePrompt`, and utility functions for message conversion and JSON extraction.

**Data Handling:**
Handles `BaseMessage` inputs, processes LLM responses, and validates model output against a Zod schema.

### 18. chrome-extension/src/background/agent/prompts/base.ts

**Primary Responsibility:**
This abstract class defines the interface for all agent prompts, ensuring a consistent way to generate system and user messages for LLM interactions.

**Key Functions/Methods/Exports:**
**`BasePrompt`**: Abstract class for agent prompts.
**`getSystemMessage`**: Abstract method to return the system message.
**`getUserMessage`**: Abstract method to return the user message.
**`buildBrowserStateUserMessage`**: Builds a user message incorporating the current browser state.

**Internal Structure:**
Provides a common method `buildBrowserStateUserMessage` for incorporating browser state into the user message.

**State Management:**
Not applicable directly, but provides the structure for prompts to consume `AgentContext` to build messages.

**Key Imports & Interactions:**
Interacts with `AgentContext`, `HumanMessage`, `SystemMessage` from `@langchain/core/messages`, and `wrapUntrustedContent` for security.

**Data Handling:**
Constructs `HumanMessage` and `SystemMessage` objects, incorporating browser state and filtering untrusted content.

### 19. chrome-extension/src/background/browser/dom/views.ts

**Primary Responsibility:**
This module defines the data structures for representing the DOM tree (`DOMBaseNode`, `DOMTextNode`, `DOMElementNode`) and provides methods for their manipulation and conversion to string representations.

**Key Functions/Methods/Exports:**
**`DOMBaseNode`**: Abstract base class for all DOM nodes.
**`DOMTextNode`**: Represents a text node in the DOM tree.
**`DOMElementNode`**: Represents an element node in the DOM tree.
**`DOMState`**: Interface for the overall DOM state.
**`hash`**: Asynchronously calculates a unique hash for a DOM element.
**`clickableElementsToString`**: Converts clickable elements to a string for LLM input.
**`getEnhancedCssSelector`**: Generates an enhanced CSS selector for an element.
**`calcBranchPathHashSet`**: Calculates a set of hashes for branch paths in the DOM tree.

**Internal Structure:**
Classes for DOM nodes with properties like `tagName`, `xpath`, `attributes`, `children`, `isVisible`, `isInteractive`, `highlightIndex`. Includes caching for hash values.

**State Management:**
Each `DOMElementNode` manages its own cached hash value and properties related to its state (e.g., `isNew`).

**Key Imports & Interactions:**
Interacts with `HistoryTreeProcessor` for hashing, `CoordinateSet`, `ViewportInfo` from `history/view`, and `capTextLength` from `../util`.

**Data Handling:**
Represents the structured DOM, calculates unique hashes for elements, and formats elements into a string for LLM consumption.

### 20. chrome-extension/src/background/services/guardrails/index.ts

**Primary Responsibility:**
This service provides security guardrails for content sanitization and basic threat detection, preventing prompt injection and sensitive data exposure.

**Key Functions/Methods/Exports:**
**`SecurityGuardrails`**: Main class for the security guardrails service.
**`sanitize`**: Sanitizes untrusted content and detects threats.
**`detectThreats`**: Detects threats in content without modifying it.
**`validate`**: Validates if content is safe based on detected threats.
**`cleanEmptyTags`**: Removes empty HTML/XML tags from content.
**`setEnabled`**: Enables or disables the guardrails.
**`setStrictMode`**: Sets the strict mode for threat detection.
**`sanitizeStrict`**: Sanitizes content using strict mode.
**`detectThreatsStrict`**: Detects threats using strict mode.
**`validateStrict`**: Validates content using strict mode.

**Internal Structure:**
Encapsulates configuration for strict mode and uses `sanitizer.ts` for core logic.

**State Management:**
Manages its own `enabled` and `strictMode` settings.

**Key Imports & Interactions:**
Imports `sanitizeContent`, `detectThreats`, `cleanEmptyTags` from `sanitizer.ts` and `ThreatType`, `SanitizationResult`, `ValidationResult` from `types.ts`.

**Data Handling:**
Processes string content, identifies `ThreatType` patterns, and returns sanitized content or validation results.

### 21. packages/storage/lib/chat/history.ts

**Primary Responsibility:**
This module provides a specialized storage interface for managing chat sessions, including messages and agent step history, with optimized operations for listing and retrieval.

**Key Functions/Methods/Exports:**
**`createChatHistoryStorage`**: Factory function to create a chat history storage instance.
**`getAllSessions`**: Retrieves all chat sessions (metadata only).
**`getSession`**: Retrieves a specific chat session with its messages.
**`createSession`**: Creates a new chat session.
**`addMessage`**: Adds a message to a specific chat session.
**`storeAgentStepHistory`**: Stores the agent's step history for a session.
**`loadAgentStepHistory`**: Loads the agent's step history for a session.

**Internal Structure:**
Uses `createStorage` for `chat_sessions_metadata` and dynamically creates storage for `chat_messages_` and `chat_agent_step_` for each session.

**State Management:**
Manages `ChatSessionMetadata` for all sessions and `ChatMessage` arrays for individual sessions.

**Key Imports & Interactions:**
Depends on `createStorage` from `base.ts`, `StorageEnum` from `enums.ts`, and `ChatSession`, `ChatMessage`, `ChatAgentStepHistory` from `types.ts`.

**Data Handling:**
Stores and retrieves `ChatSessionMetadata`, `ChatMessage` objects, and `ChatAgentStepHistory` strings, including timestamps and message counts.

### 22. pages/side-panel/src/SidePanel.tsx

**Primary Responsibility:**
This is the main React component for the Chrome extension's side panel, providing the user interface for chat, task management, history, and microphone input.

**Key Functions/Methods/Exports:**
**`SidePanel`**: The main React functional component for the side panel.
**`handleSendMessage`**: Handles sending user messages or commands to the background script.
**`handleStopTask`**: Sends a command to stop the current task.
**`handleNewChat`**: Initiates a new chat session.
**`handleReplay`**: Initiates a replay of a historical task.
**`handleMicClick`**: Toggles microphone recording for speech-to-text.

**Internal Structure:**
Manages various UI states (e.g., `messages`, `isRecording`, `currentView`), handles user input, and communicates with the background service.

**State Management:**
Uses `useState` and `useRef` for local UI state, and interacts with `chatHistoryStore`, `agentModelStore`, `generalSettingsStore` for persistent data.

**Key Imports & Interactions:**
Imports `MessageList`, `ChatInput`, `ChatHistoryList`, `BookmarkList`, and various storage modules. Communicates with the background script via `chrome.runtime.connect` and `chrome.runtime.sendMessage`.

**Data Handling:**
Displays `Message` objects, manages `FavoritePrompt`s, and sends user input and commands to the background service.

### 23. pages/options/src/Options.tsx

**Primary Responsibility:**
This is the main React component for the Chrome extension's options page, allowing users to configure general settings, LLM models, and firewall rules.

**Key Functions/Methods/Exports:**
**`Options`**: The main React functional component for the options page.
**`handleTabClick`**: Handles switching between different settings tabs.

**Internal Structure:**
Uses `useState` to manage the active tab and `isDarkMode` state. Renders `GeneralSettings`, `ModelSettings`, `FirewallSettings`, and `AnalyticsSettings` components.

**State Management:**
Manages the currently active settings tab and the dark mode preference.

**Key Imports & Interactions:**
Imports `GeneralSettings`, `ModelSettings`, `FirewallSettings`, `AnalyticsSettings` components, and `t` for i18n.

**Data Handling:**
Orchestrates the display and interaction with various settings configurations, which are managed by their respective child components.

### 24. pages/options/src/components/ModelSettings.tsx

**Primary Responsibility:**
This React component allows users to configure LLM providers and select specific models for the Navigator and Planner agents, including parameters like temperature and reasoning effort.

**Key Functions/Methods/Exports:**
**`ModelSettings`**: The React functional component for model settings.
**`handleApiKeyChange`**: Updates the API key for a provider.
**`handleModelChange`**: Updates the selected model for an agent.
**`handleSave`**: Saves the configuration for a provider.
**`handleDelete`**: Deletes a provider's configuration.
**`addAzureProvider`**: Adds a new Azure OpenAI provider instance.

**Internal Structure:**
Manages state for providers, selected models, API key visibility, and input fields. Uses `useRef` for auto-focusing.

**State Management:**
Manages `providers`, `selectedModels`, `agentModelParams`, `speechToTextModel`, `apiKeyVisibility`, `modifiedProviders`, and `nameErrors` states.

**Key Imports & Interactions:**
Interacts with `llmProviderStore`, `agentModelStore`, `speechToTextModelStore` for persistent storage. Uses `Button` from `@extension/ui` and `t` for i18n.

**Data Handling:**
Processes and validates user input for API keys, base URLs, model names, and agent-specific parameters, then saves them to storage.

### 25. chrome-extension/src/background/services/analytics.ts

**Primary Responsibility:**
This service handles analytics tracking for the extension, sending events to PostHog for task lifecycle, domain visits, and error categorization.

**Key Functions/Methods/Exports:**
**`AnalyticsService`**: Main class for analytics tracking.
**`init`**: Initializes the PostHog client.
**`trackTaskStart`**: Tracks the start of a task.
**`trackTaskComplete`**: Tracks the successful completion of a task.
**`trackTaskFailed`**: Tracks a task failure with an error category.
**`trackTaskCancelled`**: Tracks a task cancellation.
**`trackDomainVisit`**: Tracks visits to unique domains.
**`categorizeError`**: Categorizes an error into predefined types.
**`updateSettings`**: Updates analytics settings (e.g., enable/disable).

**Internal Structure:**
Initializes the PostHog client with Manifest V3 compatible settings and manages task metrics.

**State Management:**
Manages `_taskMetrics` to track start times for tasks and `_posthog` client instance.

**Key Imports & Interactions:**
Interacts with `analyticsSettingsStore` for configuration and `createLogger` for logging. Uses `posthog-js` for event tracking.

**Data Handling:**
Collects task IDs, URLs, error messages, and categorizes errors before sending them to PostHog.

### 26. chrome-extension/src/background/services/speechToText.ts

**Primary Responsibility:**
This service provides speech-to-text transcription capabilities using a configured Gemini LLM, converting base64 audio data into text.

**Key Functions/Methods/Exports:**
**`SpeechToTextService`**: Main class for speech-to-text functionality.
**`create`**: Asynchronously creates and initializes a `SpeechToTextService` instance.
**`transcribeAudio`**: Transcribes base64 encoded audio data into text.

**Internal Structure:**
Holds an instance of `ChatGoogleGenerativeAI` for transcription.

**State Management:**
Not applicable directly, but depends on `speechToTextModelStore` for its configuration.

**Key Imports & Interactions:**
Interacts with `ChatGoogleGenerativeAI` from `@langchain/google-genai`, `HumanMessage` from `@langchain/core/messages`, and `speechToTextModelStore` from `@extension/storage`.

**Data Handling:**
Processes base64 encoded audio data, sends it to the Gemini model, and returns the transcribed text.

### 27. chrome-extension/src/background/agent/event/manager.ts

**Primary Responsibility:**
This component provides a centralized event bus for the agent system, allowing different parts of the application to subscribe to and emit execution-related events.

**Key Functions/Methods/Exports:**
**`EventManager`**: Main class for managing agent events.
**`subscribe`**: Registers a callback function for a specific event type.
**`unsubscribe`**: Removes a registered callback function.
**`clearSubscribers`**: Removes all subscribers for a given event type.
**`emit`**: Dispatches an agent event to all subscribed listeners.

**Internal Structure:**
Maintains a map of `EventType` to a list of `EventCallback` functions.

**State Management:**
Manages the list of active event subscribers.

**Key Imports & Interactions:**
Interacts with `AgentEvent`, `EventType`, `EventCallback` from `types.ts` and `createLogger` for logging.

**Data Handling:**
Distributes `AgentEvent` objects to all registered subscribers.

### 28. chrome-extension/src/background/services/websocket/service.ts

**Primary Responsibility:**
This component provides a high-level interface for WebSocket communication with external applications, managing connection lifecycle, message serialization/deserialization, and event emission for application integration.

**Key Functions/Methods/Exports:**
**`initialize`**: Loads WebSocket settings from storage and establishes connection if enabled.
**`connect`**: Creates and configures the ConnectionManager, sets up event listeners, and initiates connection.
**`disconnect`**: Gracefully closes the WebSocket connection and cleans up resources.
**`reconnect`**: Forces a reconnection attempt.
**`sendMessage`**: Sends type-safe outgoing messages through the WebSocket connection.
**`addEventListener`**: Registers listeners for service-level events (READY, CONNECTION_CHANGE, MESSAGE_RECEIVED, ERROR).
**`isConnected`**: Checks if the service is ready to send messages.
**`handleSettingsChange`**: Responds to WebSocket settings changes by reconnecting or disconnecting as needed.

**Internal Structure:**
Manages a `ConnectionManager` instance, service event listeners, WebSocket settings from storage, and initialization state. Uses `WebSocketMessageInterpreter` for message processing.

**State Management:**
Tracks initialization status, current WebSocket settings, and delegates connection state to ConnectionManager. Subscribes to settings changes from `websocketStore`.

**Key Imports & Interactions:**
Interacts with `websocketStore` for configuration, `ConnectionManager` for low-level connection handling, `WebSocketMessageInterpreter` for message protocol, and emits events for application-level integration (e.g., `chrome-extension/src/background/index.ts`).

**Data Handling:**
Serializes outgoing messages (TaskAccepted, TaskRejected, ExecutionEvent, Pong), deserializes incoming messages (ExecuteTask, Ping), validates message structure, and provides error boundaries to prevent WebSocket failures from crashing core extension functionality.

### 29. chrome-extension/src/background/services/websocket/connection.ts

**Primary Responsibility:**
This component handles the low-level WebSocket connection lifecycle, implementing state machine transitions, exponential backoff reconnection strategy, and WebSocket event handling.

**Key Functions/Methods/Exports:**
**`connect`**: Initiates WebSocket connection with URL validation and connection timeout.
**`disconnect`**: Closes WebSocket connection and resets state.
**`reconnect`**: Forces immediate reconnection attempt.
**`send`**: Sends serialized messages through the WebSocket if connection is ready.
**`getState`**: Returns current connection state (DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING).
**`isReady`**: Checks if connection is ready to send messages.
**`addEventListener`**: Registers listeners for connection-level events (STATE_CHANGE, MESSAGE, ERROR).
**`scheduleReconnection`**: Implements exponential backoff strategy for reconnection attempts (1s, 2s, 4s, 8s, 16s, 30s max).

**Internal Structure:**
Maintains WebSocket instance, connection state enum, reconnection attempt counter, timers for connection timeout and reconnection, and event listeners map.

**State Management:**
Implements state machine: DISCONNECTED → CONNECTING → CONNECTED, with RECONNECTING state for automatic recovery. Tracks reconnection attempts and applies exponential backoff delays.

**Key Imports & Interactions:**
Uses native WebSocket API, creates WebSocketError instances for categorized error handling, emits low-level connection events consumed by WebSocketService, and implements automatic reconnection for recoverable errors.

**Data Handling:**
Validates WebSocket URLs (ws:// or wss://), handles binary/text message transmission, categorizes close events by code, and sanitizes messages for logging to prevent sensitive data exposure.

### 30. chrome-extension/src/background/services/websocket/protocol.ts

**Primary Responsibility:**
This component implements the WebSocket message protocol, providing serialization/deserialization of typed messages with validation and error handling for bidirectional communication.

**Key Functions/Methods/Exports:**
**`WebSocketMessageInterpreter.send`**: Serializes outgoing messages (TaskAccepted, TaskRejected, ExecutionEvent, Pong) to JSON strings with AgentEvent serialization support.
**`WebSocketMessageInterpreter.receive`**: Deserializes incoming JSON strings to typed messages (ExecuteTask, Ping) with comprehensive validation.
**`validateExecuteTaskMessage`**: Validates ExecuteTaskMessage structure including taskId (max 1000 chars), prompt (max 100KB), and optional metadata.
**`validatePingMessage`**: Validates PingMessage structure including numeric timestamp.
**`createTaskAccepted`**: Helper to create TaskAcceptedMessage with current timestamp.
**`createTaskRejected`**: Helper to create TaskRejectedMessage with reason and timestamp.
**`createExecutionEvent`**: Helper to create ExecutionEventMessage from taskId and AgentEvent.
**`createPong`**: Helper to create PongMessage with current timestamp.

**Internal Structure:**
Static class with serialization/deserialization methods, validation helpers, and factory methods for creating typed messages. Includes custom error classes for serialization/deserialization failures.

**State Management:**
Stateless message protocol interpreter. All methods are static.

**Key Imports & Interactions:**
Imports message type definitions from `types.ts`, `AgentEvent` from agent event system, error utilities from `errors.ts`, and logger for protocol operations. Used by WebSocketService for message processing.

**Data Handling:**
Handles JSON serialization with circular reference detection, validates message size limits (1MB max), performs type-safe message validation, serializes AgentEvent objects preserving actor/state/data/timestamp/type fields, and provides descriptive error messages for validation failures.

### 31. chrome-extension/src/background/services/websocket/errors.ts

**Primary Responsibility:**
This module provides structured error handling for WebSocket operations, including error categorization, user-friendly messaging, and logging utilities with sensitive data sanitization.

**Key Functions/Methods/Exports:**
**`WebSocketError`**: Custom error class with category, context, and original error tracking.
**`categorizeCloseEvent`**: Maps WebSocket close codes to error categories (1000=normal, 1006=network, 1007-1008=validation, etc.).
**`categorizeError`**: Automatically categorizes generic errors by analyzing error messages for keywords.
**`createWebSocketError`**: Factory function to create WebSocketError from unknown errors with automatic categorization.
**`isRecoverableError`**: Determines if an error should trigger reconnection (NETWORK and TIMEOUT errors are recoverable).
**`getUserFriendlyErrorMessage`**: Provides user-facing error messages suitable for UI display.
**`sanitizeForLogging`**: Redacts sensitive fields (password, token, secret) and truncates large strings for safe logging.
**`getUserMessage`**: Returns user-friendly error message based on error category.
**`toLoggableObject`**: Creates sanitized error representation for logging.

**Internal Structure:**
Defines WebSocketErrorCategory enum (NETWORK, PROTOCOL, TIMEOUT, VALIDATION, AUTH, UNKNOWN), WebSocketError class extending Error, and utility functions for error classification and sanitization.

**State Management:**
Stateless error handling utilities. All functions are pure.

**Key Imports & Interactions:**
No external dependencies. Used throughout WebSocket service (connection.ts, service.ts, protocol.ts) for consistent error handling. Integrates with logger for structured error logging.

**Data Handling:**
Categorizes errors by network status codes and message patterns, sanitizes context objects by redacting sensitive keys and truncating large values (>1000 chars), provides error recovery guidance through recoverability classification, and maintains error causality chains with originalError tracking.

### 28. chrome-extension/src/background/agent/agents/errors.ts

**Primary Responsibility:**
This module defines custom error classes and utility functions for identifying and categorizing various errors that can occur during agent execution or LLM interactions.

**Key Functions/Methods/Exports:**
**`ChatModelAuthError`**: Error for LLM authentication failures.
**`ChatModelForbiddenError`**: Error for 403 Forbidden responses from LLMs.
**`ChatModelBadRequestError`**: Error for 400 Bad Request responses from LLMs.
**`RequestCancelledError`**: Error for explicitly cancelled requests.
**`ExtensionConflictError`**: Error for conflicts with other extensions.
**`MaxStepsReachedError`**: Error when maximum execution steps are exceeded.
**`MaxFailuresReachedError`**: Error when maximum consecutive failures are reached.
**`ResponseParseError`**: Error when LLM response cannot be parsed.
**`isAuthenticationError`**: Checks if an error is an authentication error.
**`isForbiddenError`**: Checks if an error is a forbidden error.
**`isBadRequestError`**: Checks if an error is a bad request error.
**`isAbortedError`**: Checks if an error indicates an aborted operation.
**`isExtensionConflictError`**: Checks if an error is an extension conflict error.

**Internal Structure:**
A collection of custom `Error` subclasses and functions that inspect error messages and types.

**State Management:**
Not applicable; this component defines error types and detection logic.

**Key Imports & Interactions:**
No external imports beyond standard Error. Used by agents and the executor for robust error handling.

**Data Handling:**
Provides structured error types and methods to classify raw error objects or messages.

### 29. packages/schema-utils/lib/helper.ts

**Primary Responsibility:**
This utility provides functions for manipulating JSON schemas, including dereferencing references and converting schemas between OpenAI and Google Gemini formats.

**Key Functions/Methods/Exports:**
**`dereferenceJsonSchema`**: Resolves all `$ref` references in a JSON schema.
**`convertOpenAISchemaToGemini`**: Converts an OpenAI-style JSON schema to a Gemini-compatible format.
**`stringifyCustom`**: A custom JSON stringifier for schema objects.
**`JsonSchemaObject`**: Interface defining a generic JSON Schema object.

**Internal Structure:**
Contains recursive functions to traverse and transform JSON schema objects.

**State Management:**
Not applicable; this component is a utility for schema transformation.

**Key Imports & Interactions:**
No external imports beyond standard types. Used by agents to adapt tool schemas for different LLM providers.

**Data Handling:**
Processes `JsonSchemaObject` structures, resolving `$ref` references and adapting property definitions for specific LLM API requirements.

### 30. packages/i18n/lib/i18n-prod.ts

**Primary Responsibility:**
This module provides the internationalization (i18n) utility for production builds, allowing the application to retrieve translated messages using Chrome's native i18n API.

**Key Functions/Methods/Exports:**
**`t`**: The translation function, a wrapper around `chrome.i18n.getMessage`.

**Internal Structure:**
A simple wrapper around `chrome.i18n.getMessage`.

**State Management:**
Not applicable; this component is a utility for message retrieval.

**Key Imports & Interactions:**
Depends on `MessageKey` from `type.ts` and directly interacts with `chrome.i18n` API.

**Data Handling:**
Retrieves localized string messages based on a provided key and optional substitutions.

## Additional Components Summary

### API Routes
- `chrome-extension/src/background/agent/prompts/templates/common.ts`: Empty file, likely a placeholder for common prompt rules.
- `chrome-extension/src/background/agent/prompts/templates/navigator.ts`: Imports common security rules for Navigator agent prompts.
- `chrome-extension/src/background/agent/prompts/templates/planner.ts`: Imports common security rules for Planner agent prompts.

### Services
- `chrome-extension/src/background/agent/event/types.ts`: Defines enums and interfaces for agent execution events.
- `chrome-extension/src/background/agent/history.ts`: Defines data structures for recording agent steps and their results.
- `chrome-extension/src/background/agent/messages/views.ts`: Defines classes for managing individual messages and message history.
- `chrome-extension/src/background/agent/prompts/navigator.ts`: Implements the Navigator agent's specific system and user prompt logic.
- `chrome-extension/src/background/agent/prompts/planner.ts`: Implements the Planner agent's specific system and user prompt logic.
- `chrome-extension/src/background/browser/dom/clickable/service.ts`: Provides utilities for identifying and hashing clickable DOM elements.
- `chrome-extension/src/background/browser/dom/history/service.ts`: Manages the conversion and comparison of DOM elements for historical replay.
- `chrome-extension/src/background/browser/dom/history/view.ts`: Defines data structures for historical DOM elements and viewport information.
- `chrome-extension/src/background/browser/dom/raw_types.ts`: Defines raw data types for DOM tree representation used in injected scripts.
- `chrome-extension/src/background/browser/util.ts`: Provides utility functions for URL validation and text manipulation.
- `chrome-extension/src/background/browser/views.ts`: Defines interfaces and default configurations for browser context and page state.
- `chrome-extension/src/background/log.ts`: Provides a simple logger utility for background scripts.
- `chrome-extension/src/background/utils.ts`: Contains general utility functions like timestamp generation, JSON repair, and Zod to JSON schema conversion.
- `chrome-extension/src/background/services/guardrails/patterns.ts`: Defines regular expression patterns for security threat detection.
- `chrome-extension/src/background/services/guardrails/sanitizer.ts`: Implements the core logic for sanitizing content and detecting threats.
- `chrome-extension/src/background/services/guardrails/types.ts`: Defines types for security patterns, threat types, and sanitization results.
- `chrome-extension/src/background/services/websocket/types.ts`: Defines TypeScript types for WebSocket message protocol including IncomingMessage, OutgoingMessage, ExecuteTaskMessage, PingMessage, TaskAcceptedMessage, TaskRejectedMessage, ExecutionEventMessage, PongMessage, and type guards.
- `chrome-extension/src/background/services/websocket/index.ts`: Main export module for WebSocket service, re-exporting types, protocol interpreter, error classes, connection manager, and service class.
- `chrome-extension/src/background/services/websocket/__tests__/protocol.test.ts`: Unit tests for WebSocket message protocol using Vitest, covering serialization, deserialization, validation, error handling, and helper methods.
- `chrome-extension/utils/plugins/make-manifest-plugin.ts`: Vite plugin for generating the Chrome extension manifest.
- `packages/dev-utils/lib/manifest-parser/impl.ts`: Implements manifest parsing and conversion logic.
- `packages/dev-utils/lib/manifest-parser/index.ts`: Exports the manifest parser implementation.
- `packages/dev-utils/lib/manifest-parser/type.ts`: Defines types for the manifest parser.
- `packages/dev-utils/lib/logger.ts`: Provides a color logging utility for development.
- `packages/hmr/lib/initializers/initClient.ts`: Initializes the HMR client in content scripts.
- `packages/hmr/lib/initializers/initReloadServer.ts`: Initializes the HMR WebSocket server.
- `packages/hmr/lib/injections/refresh.ts`: Injects client-side refresh logic for HMR.
- `packages/hmr/lib/injections/reload.ts`: Injects client-side reload logic for HMR.
- `packages/hmr/lib/interpreter/index.ts`: Provides message serialization/deserialization for HMR.
- `packages/hmr/lib/plugins/make-entry-point-plugin.ts`: Vite plugin for content script entry point generation.
- `packages/hmr/lib/plugins/watch-public-plugin.ts`: Vite plugin to watch public directory for changes.
- `packages/hmr/lib/plugins/watch-rebuild-plugin.ts`: Vite plugin to trigger HMR on rebuilds.
- `packages/hmr/lib/constant.ts`: Defines constants for HMR.
- `packages/hmr/lib/types.ts`: Defines types for HMR messages and plugin configuration.
- `packages/i18n/lib/getMessageFromLocale.ts`: Retrieves i18n messages based on locale.
- `packages/i18n/lib/i18n-dev.ts`: Provides i18n utility for development builds.
- `packages/i18n/lib/type.ts`: Defines types for i18n message keys and locales.
- `packages/schema-utils/lib/json_schema.ts`: Contains a JSON schema definition for navigator output.
- `packages/shared/lib/hoc/withErrorBoundary.tsx`: Higher-order component for error boundaries.
- `packages/shared/lib/hoc/withSuspense.tsx`: Higher-order component for React Suspense.
- `packages/shared/lib/hooks/useStorage.tsx`: React hook for interacting with storage.
- `packages/shared/lib/utils/shared-types.ts`: Defines shared utility types.
- `packages/storage/lib/base/enums.ts`: Defines enums for storage types and session access levels.
- `packages/storage/lib/base/types.ts`: Defines types for base storage interface and configuration.
- `packages/storage/lib/chat/types.ts`: Defines types for chat messages, sessions, and history storage.
- `packages/storage/lib/profile/user.ts`: Manages user profile data, including a unique user ID.
- `packages/storage/lib/prompt/favorites.ts`: Manages storage for favorite prompts.
- `packages/storage/lib/settings/analyticsSettings.ts`: Manages analytics settings.
- `packages/storage/lib/settings/firewall.ts`: Manages firewall settings (allow/deny lists).
- `packages/storage/lib/settings/generalSettings.ts`: Manages general application settings.
- `packages/storage/lib/settings/speechToText.ts`: Manages speech-to-text model configuration.
- `packages/storage/lib/settings/types.ts`: Defines enums and types for agent names, provider types, and model parameters.
- `packages/ui/lib/components/Button.tsx`: Reusable Button UI component.
- `packages/ui/lib/utils.ts`: Utility functions for Tailwind CSS class merging.
- `packages/ui/lib/withUI.ts`: Utility for merging Tailwind CSS configurations.
- `packages/vite-config/lib/env.mjs`: Environment variable loading utility for Vite.
- `packages/vite-config/lib/withPageConfig.mjs`: Vite configuration helper for pages.
- `packages/zipper/lib/zip-bundle/index.ts`: Core logic for zipping the extension bundle.
- `pages/content/src/index.ts`: Entry point for the content script.
- `pages/options/src/components/AnalyticsSettings.tsx`: UI component for configuring analytics settings.
- `pages/options/src/components/FirewallSettings.tsx`: UI component for configuring firewall rules.
- `pages/options/src/components/GeneralSettings.tsx`: UI component for configuring general application settings.
- `pages/options/src/index.tsx`: Entry point for the options page.
- `pages/side-panel/src/components/BookmarkList.tsx`: UI component for displaying and managing bookmarked prompts.
- `pages/side-panel/src/components/ChatHistoryList.tsx`: UI component for displaying and managing chat history sessions.
- `pages/side-panel/src/components/ChatInput.tsx`: UI component for chat input, including text and microphone.
- `pages/side-panel/src/components/MessageList.tsx`: UI component for displaying chat messages.
- `pages/side-panel/src/types/event.ts`: Defines event types and execution states for the side panel.
- `pages/side-panel/src/utils.ts`: Utility functions for the side panel, like task ID generation.
- `update_version.sh`: Script for updating package versions.

### UI Components
- `chrome-extension/public/permission/index.html`: HTML page for requesting microphone permission.
- `chrome-extension/public/permission/permission.js`: JavaScript logic for the microphone permission page.
- `pages/options/src/index.css`: Main CSS file for the options page.
- `pages/options/src/Options.css`: Specific CSS for the Options page layout and dark mode.
- `pages/options/index.html`: HTML entry point for the options page.
- `pages/side-panel/src/index.css`: Main CSS file for the side panel.
- `pages/side-panel/src/SidePanel.css`: Specific CSS for the Side Panel layout and dark mode.
- `pages/side-panel/index.html`: HTML entry point for the side panel.

### Utilities & Config
- `.husky/pre-commit`: Git pre-commit hook for linting staged files.
- `chrome-extension/utils/refresh.js`: Client-side script for Hot Module Replacement (HMR).
- `chrome-extension/manifest.js`: Generates the Chrome extension manifest.json.
- `chrome-extension/package.json`: Package dependencies and scripts for the Chrome extension.
- `chrome-extension/tsconfig.json`: TypeScript configuration for the Chrome extension.
- `chrome-extension/vite.config.mts`: Vite configuration for the Chrome extension.
- `packages/dev-utils/.eslintignore`: ESLint ignore patterns for dev-utils.
- `packages/dev-utils/index.ts`: Entry point for dev-utils package.
- `packages/dev-utils/package.json`: Package dependencies and scripts for dev-utils.
- `packages/dev-utils/tsconfig.json`: TypeScript configuration for dev-utils.
- `packages/hmr/index.ts`: Entry point for HMR package.
- `packages/hmr/package.json`: Package dependencies and scripts for HMR.
- `packages/hmr/rollup.config.mjs`: Rollup configuration for HMR.
- `packages/hmr/tsconfig.build.json`: TypeScript build configuration for HMR.
- `packages/hmr/tsconfig.json`: TypeScript configuration for HMR.
- `packages/i18n/.eslintignore`: ESLint ignore patterns for i18n.
- `packages/i18n/.gitignore`: Git ignore patterns for i18n.
- `packages/i18n/build.dev.mjs`: Build script for i18n in development mode.
- `packages/i18n/build.mjs`: General build script for i18n.
- `packages/i18n/build.prod.mjs`: Build script for i18n in production mode.
- `packages/i18n/genenrate-i18n.mjs`: Script to generate i18n type definitions and message retrieval.
- `packages/i18n/index.ts`: Entry point for i18n package.
- `packages/i18n/package.json`: Package dependencies and scripts for i18n.
- `packages/i18n/tsconfig.json`: TypeScript configuration for i18n.
- `packages/schema-utils/examples/convert.ts`: Example for converting OpenAI schema to Gemini.
- `packages/schema-utils/examples/flatten.ts`: Example for flattening JSON schema.
- `packages/schema-utils/.eslintignore`: ESLint ignore patterns for schema-utils.
- `packages/schema-utils/build.mjs`: Build script for schema-utils.
- `packages/schema-utils/index.ts`: Entry point for schema-utils package.
- `packages/schema-utils/package.json`: Package dependencies and scripts for schema-utils.
- `packages/schema-utils/tsconfig.json`: TypeScript configuration for schema-utils.
- `packages/shared/lib/hoc/index.ts`: Exports HOCs from the shared package.
- `packages/shared/lib/hooks/index.ts`: Exports hooks from the shared package.
- `packages/shared/lib/utils/index.ts`: Exports utilities from the shared package.
- `packages/shared/.eslintignore`: ESLint ignore patterns for shared.
- `packages/shared/build.mjs`: Build script for shared.
- `packages/shared/index.ts`: Entry point for shared package.
- `packages/shared/package.json`: Package dependencies and scripts for shared.
- `packages/shared/tsconfig.json`: TypeScript configuration for shared.
- `packages/storage/lib/chat/index.ts`: Exports chat storage.
- `packages/storage/lib/profile/index.ts`: Exports profile storage.
- `packages/storage/lib/settings/index.ts`: Exports settings storage.
- `packages/storage/lib/index.ts`: Exports all storage modules.
- `packages/storage/.eslintignore`: ESLint ignore patterns for storage.
- `packages/storage/build.mjs`: Build script for storage.
- `packages/storage/index.ts`: Entry point for storage package.
- `packages/storage/package.json`: Package dependencies and scripts for storage.
- `packages/storage/tsconfig.json`: TypeScript configuration for storage.
- `packages/tailwind-config/package.json`: Package dependencies for tailwind-config.
- `packages/tailwind-config/tailwind.config.ts`: Tailwind CSS base configuration.
- `packages/tsconfig/app.json`: TypeScript configuration for Chrome extension apps.
- `packages/tsconfig/base.json`: Base TypeScript configuration.
- `packages/tsconfig/package.json`: Package dependencies for tsconfig.
- `packages/tsconfig/utils.json`: TypeScript configuration for utility packages.
- `packages/ui/lib/components/index.ts`: Exports UI components.
- `packages/ui/lib/global.css`: Global CSS for UI components.
- `packages/ui/build.mjs`: Build script for UI.
- `packages/ui/index.ts`: Entry point for UI package.
- `packages/ui/package.json`: Package dependencies and scripts for UI.
- `packages/ui/tsconfig.json`: TypeScript configuration for UI.
- `packages/vite-config/index.mjs`: Entry point for Vite config package.
- `packages/vite-config/package.json`: Package dependencies for Vite config.
- `packages/zipper/.eslintignore`: ESLint ignore patterns for zipper.
- `packages/zipper/index.ts`: Entry point for zipper package.
- `packages/zipper/package.json`: Package dependencies and scripts for zipper.
- `packages/zipper/tsconfig.json`: TypeScript configuration for zipper.
- `.env.example`: Example environment variables.
- `.eslintignore`: Global ESLint ignore patterns.
- `.eslintrc`: Global ESLint configuration.
- `.example.env`: Example environment variables.
- `.gitattributes`: Git attribute settings.
- `.gitignore`: Global Git ignore patterns.
- `.npmrc`: npm configuration.
- `.nvmrc`: Node.js version configuration.
- `.prettierignore`: Prettier ignore patterns.
- `.prettierrc`: Prettier configuration.
- `LICENSE`: Apache-2.0 license file.
- `package.json`: Root package dependencies and scripts.
- `pnpm-workspace.yaml`: pnpm workspace configuration.
- `turbo.json`: Turborepo configuration for monorepo tasks.
- `vite-env.d.ts`: Vite environment type definitions.

## API Design & Communication
- The system primarily uses a message-passing pattern between the Chrome extension's side panel (UI) and its background service worker.
- Communication between the UI and background script is handled via `chrome.runtime.sendMessage` and `chrome.runtime.connect` for long-lived ports.
- **WebSocket Communication**: The extension supports bidirectional real-time communication with external applications via WebSocket protocol. External servers can send task execution requests (`execute_task`) and ping messages, while the extension responds with task acceptance/rejection, real-time execution events, and pong responses.
- **WebSocket Message Protocol**: Type-safe message protocol with discriminated unions for incoming messages (ExecuteTaskMessage, PingMessage) and outgoing messages (TaskAcceptedMessage, TaskRejectedMessage, ExecutionEventMessage, PongMessage).
- **Connection Management**: WebSocket service implements automatic reconnection with exponential backoff strategy (1s, 2s, 4s, 8s, 16s, 30s max) and connection state management (DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING).
- The background service orchestrates interactions with external LLM APIs (OpenAI, Anthropic, Gemini, etc.) using the LangChain.js library.
- Browser automation is achieved through a local Puppeteer-like connection (`puppeteer-core`) to the active Chrome tab, allowing for DOM inspection and interaction.

## Cross-Cutting Concerns
- **Authentication & Authorization:** LLM API keys are stored securely using Chrome's `storage.local` or `storage.sync` APIs. There is no explicit user authentication within the extension itself, relying on Chrome's user session.
- **Error Handling:** Custom error classes (`ChatModelAuthError`, `MaxStepsReachedError`, etc.) are defined to categorize and manage specific failure scenarios. Errors are logged and communicated back to the UI for display.
- **Logging & Monitoring:** A custom `createLogger` utility is used for internal debugging. Analytics are tracked via PostHog, with user opt-out options and anonymized data collection.
- **Configuration:** Settings for agents, LLM providers, firewall, and general behavior are managed using a custom storage abstraction (`packages/storage`) built on Chrome's `storage` API.
- **Security:** A `SecurityGuardrails` service is implemented to sanitize untrusted content (e.g., web page content) before it's sent to LLMs, preventing prompt injection and sensitive data leakage. A firewall (`FirewallSettings`) is also in place to restrict agent access to specified URLs.

Note: The source code context is provided via cached content.