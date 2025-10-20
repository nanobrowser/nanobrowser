# Codebase Summary

## Overall Purpose & Domain
The primary goal of this application is to provide an AI-powered web automation tool as a Chrome extension. It enables users to automate web tasks such as data extraction, form filling, and general web navigation using large language models (LLMs). The intended users are individuals who require automated interaction with web pages, potentially for productivity, research, or data collection. The core real-world problem the application addresses is the manual and repetitive nature of many web-based tasks, offering an intelligent agent to perform these actions.

## Key Concepts & Domain Terminology
*   **Agent:** An autonomous entity within the system responsible for executing a specific part of a task. The system employs a multi-agent architecture.
*   **Planner Agent:** An agent responsible for developing and refining high-level strategies to complete user-defined tasks. It determines the sequence of steps required.
*   **Navigator Agent:** An agent responsible for interacting with web pages, performing actions like clicking, typing, scrolling, and navigating URLs based on the plan provided by the Planner.
*   **Action:** A specific operation that an agent can perform on a web page or the browser, such as `clickElement`, `inputText`, `goToUrl`, `searchGoogle`, `switchTab`, `scrollToText`, `cacheContent`, `selectDropdownOption`, `getDropdownOptions`, `closeTab`, `wait`, `previousPage`, `nextPage`, `scrollToTop`, `scrollToBottom`, `sendKeys`.
*   **Browser Context:** An abstraction layer that manages browser tabs, pages, and interactions, providing a consistent interface for agents to control the web browser.
*   **DOM State:** A representation of the current structure and interactive elements of a web page, including visibility, interactivity, and unique identifiers (highlight indices, XPath).
*   **DOM Element Node:** A representation of an HTML element in the DOM tree, containing its tag name, attributes, visibility, interactivity status, and a unique highlight index.
*   **Chat Session:** A complete conversation history between the user and the AI agent, including all messages and metadata like creation/update timestamps and message count.
*   **LLM Provider:** A configuration for an external Large Language Model service (e.g., OpenAI, Anthropic, Gemini, Azure OpenAI, Ollama, OpenRouter, Groq, Cerebras, Llama, Custom OpenAI), including API keys, base URLs, and specific model names.
*   **Firewall:** A security mechanism that controls which URLs the AI agent is permitted to access, based on configurable allow and deny lists.
*   **Guardrails:** A security service that sanitizes untrusted content (e.g., web page content) to prevent prompt injection and other malicious inputs to the LLMs.
*   **Replay Historical Tasks:** An experimental feature that stores and allows re-execution of an agent's step-by-step history for debugging or re-running tasks.
*   **WebSocket Service:** A bidirectional real-time communication system that enables external applications to control and monitor the Nanobrowser extension via WebSocket protocol, supporting remote task execution and event streaming.
*   **Connection State:** The lifecycle status of a WebSocket connection (DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING), managed with automatic reconnection and exponential backoff strategy.
*   **Message Protocol:** A type-safe message format for WebSocket communication, with discriminated unions for incoming messages (execute_task, ping) and outgoing messages (task_accepted, task_rejected, execution_event, pong).
*   **Execution Event (via WebSocket):** Real-time streaming of AgentEvent updates to external WebSocket clients during task execution, providing progress visibility for remote monitoring.
*   **Task Execution (via WebSocket):** The capability for external applications to request task execution by sending ExecuteTaskMessage with taskId and prompt, receiving TaskAccepted/TaskRejected responses and continuous ExecutionEvent updates.

## Data Persistence & State Management
The application primarily uses Chrome's extension storage APIs for data persistence and state management.
*   **Chrome Storage API:**
    *   `chrome.storage.local`: Used for persisting data locally across browser restarts.
    *   `chrome.storage.session`: Used for persisting data only until the browser is closed, recommended for service workers. Access can be granted to content scripts.
*   **Storage Utilities:** A `createStorage` utility (`packages/storage/lib/base/base.ts`) abstracts the Chrome Storage API, providing a `BaseStorage` interface for `get`, `set`, `getSnapshot`, and `subscribe` operations. This utility supports serialization and live updates across extension instances.
*   **Specific Storage Instances:**
    *   `chatHistoryStore`: Manages chat sessions, messages, and agent step history (`packages/storage/lib/chat/history.ts`).
    *   `agentModelStore`: Stores configurations for LLM models used by different agents (Planner, Navigator) (`packages/storage/lib/settings/agentModels.ts`).
    *   `generalSettingsStore`: Persists general application settings like max steps, vision enablement, and highlight display (`packages/storage/lib/settings/generalSettings.ts`).
    *   `llmProviderStore`: Stores configurations for various LLM providers (API keys, base URLs, model names) (`packages/storage/lib/settings/llmProviders.ts`).
    *   `analyticsSettingsStore`: Manages settings related to analytics tracking (`packages/storage/lib/settings/analyticsSettings.ts`).
    *   `speechToTextModelStore`: Stores the configuration for the speech-to-text LLM model (`packages/storage/lib/settings/speechToText.ts`).
    *   `firewallStore`: Manages the allow and deny lists for URL access (`packages/storage/lib/settings/firewall.ts`).
    *   `favoritesStorage`: Stores user-defined favorite prompts (`packages/storage/lib/prompt/favorites.ts`).
    *   `userProfileStore`: Stores user-specific data like a unique user ID (`packages/storage/lib/profile/user.ts`).
    *   `websocketStore`: Stores WebSocket configuration including enabled status, server URL, and connection timeout settings (`packages/storage/lib/settings/websocket.ts`).
*   **In-memory Caching:** `WeakMap` objects are used in `chrome-extension/public/buildDomTree.js` for caching DOM element properties like bounding rectangles, client rectangles, and computed styles to optimize performance during DOM tree construction.

## External Dependencies & APIs
*   **LangChain (client: @langchain/core 0.3.78, @langchain/openai 0.6.14, @langchain/anthropic 0.3.30, @langchain/google-genai 0.2.18, @langchain/xai 0.1.0, @langchain/groq 0.2.4, @langchain/cerebras 0.0.4, @langchain/ollama 0.2.4, @langchain/deepseek 0.1.0):** Provides the framework for integrating with various Large Language Models (LLMs) and managing conversational chains. It is central to the agent's reasoning and action selection.
*   **Puppeteer (client: puppeteer-core 24.10.1):** Used for browser automation, enabling the agent to interact with web pages (e.g., clicking, typing, taking screenshots) in a programmatic way.
*   **Native WebSocket API:** The extension uses the browser's native WebSocket API for bidirectional real-time communication with external applications. Supports automatic reconnection with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s max), connection state management (DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING), and type-safe message protocol for task execution and event streaming.
*   **PostHog (client: posthog-js 1.271.0):** An analytics platform used for tracking task starts, completions, failures, cancellations, and domain visits to gather usage metrics.
*   **Zod (client: zod 3.25.76):** A TypeScript-first schema declaration and validation library used for defining and validating LLM output schemas and other data structures.
*   **Zod-to-JSON-Schema (client: zod-to-json-schema 3.24.6):** Converts Zod schemas into JSON Schema format, which is used by LLMs for structured output.
*   **JSONRepair (client: jsonrepair 3.13.1):** Repairs malformed JSON strings, which is crucial for robust parsing of LLM outputs that may not always be perfectly formatted.
*   **WebExtension Polyfill (client: webextension-polyfill 0.12.0):** Provides a cross-browser compatible API for WebExtensions, ensuring the extension functions across different browser environments.
*   **React (client: react 18.3.1, react-dom 18.3.1):** The JavaScript library for building user interfaces, used for the Side Panel and Options pages.
*   **React Icons (client: react-icons 5.0.0):** A library providing a collection of popular icon sets for use in React applications.
*   **clsx (client: clsx 2.1.1) & tailwind-merge (client: tailwind-merge 2.4.0):** Utilities for conditionally joining CSS class names and merging Tailwind CSS classes without conflicts, respectively.
*   **deepmerge (client: deepmerge 4.3.1):** A utility for deep merging JavaScript objects, used in configuration and manifest generation.
*   **fflate (client: fflate 0.8.2):** A high-performance (de)compression library used for zipping the extension bundle.
*   **fast-glob (client: fast-glob 3.3.2):** A utility for fast and efficient globbing (file matching) in the build process.
*   **ws (client: ws 8.18.0):** A WebSocket library used for Hot Module Replacement (HMR) in development.

## Configuration, Deployment & Environment
*   **Configuration Mechanisms:**
    *   **Environment Variables:** The application uses `.env.example` and `vite-env.d.ts` to define environment variables, primarily for analytics (e.g., `VITE_POSTHOG_API_KEY`, `VITE_POSTHOG_HOST`). These are loaded via `vite` during the build process.
    *   **Chrome Storage:** LLM provider API keys, model configurations, general settings, firewall rules, and analytics preferences are stored in Chrome's `local` or `session` storage, allowing user-specific and persistent configuration through the extension's options page.
    *   **In-code Defaults:** Many settings have default values defined directly in the code (e.g., `DEFAULT_BROWSER_CONTEXT_CONFIG`, `DEFAULT_AGENT_OPTIONS`, `DEFAULT_GENERAL_SETTINGS`).
*   **CI/CD & Automation:**
    *   **Husky (client: husky 9.1.4) & Lint-Staged (client: lint-staged 15.2.7):** Configured via `.husky/pre-commit` and `package.json`, these tools enforce code quality standards (prettier, eslint) on staged Git files before commits.
    *   **`update_version.sh`:** A shell script (`update_version.sh`) automates updating the version number across all `package.json` files in the monorepo.
*   **Build & Deployment Strategy:**
    *   **Monorepo Structure:** The project is organized as a monorepo using `pnpm-workspace.yaml` and `turbo.json`, managing multiple packages (`chrome-extension`, `pages/*`, `packages/*`).
    *   **Vite (client: vite 6.3.6):** Used as the build tool for the Chrome extension and its various pages (content script, options, side panel). It supports development mode (`dev`) with HMR and production builds (`build`).
    *   **Rollup (client: rollup 4.24.0):** Used within the HMR package for bundling.
    *   **ESBuild (client: esbuild 0.25.1):** Used for bundling utilities packages (`packages/schema-utils`, `packages/shared`, `packages/storage`, `packages/ui`).
    *   **Hot Module Replacement (HMR):** The `@extension/hmr` package provides HMR and refresh capabilities for development, including a WebSocket server for communication.
    *   **Manifest Generation:** A custom `make-manifest-plugin.ts` generates the `manifest.json` for the Chrome extension, handling cache busting and conditional features like side panel and Opera sidebar support.
    *   **Zipping:** The `@extension/zipper` package is used to create a `.zip` archive of the built extension for distribution.
    *   **TypeScript (client: typescript 5.5.4):** The entire codebase is written in TypeScript, with `tsconfig.json` files defining configurations for different parts of the project (app, utils, base).
    *   **Tailwind CSS (client: tailwindcss 3.4.17) & PostCSS (client: postcss 8.4.47):** Used for styling, with a shared Tailwind configuration (`packages/tailwind-config`) and PostCSS plugins for processing.

## Technology Stack
*   **Languages & Runtimes:**
    *   TypeScript (client: typescript 5.5.4)
    *   JavaScript
    *   Node.js (version >=22.12.0)
*   **Frameworks & Libraries:**
    *   React (version 18.3.1)
    *   LangChain (client: @langchain/core 0.3.78, @langchain/openai 0.6.14, @langchain/anthropic 0.3.30, @langchain/google-genai 0.2.18, @langchain/xai 0.1.0, @langchain/groq 0.2.4, @langchain/cerebras 0.0.4, @langchain/ollama 0.2.4, @langchain/deepseek 0.1.0)
    *   Puppeteer (client: puppeteer-core 24.10.1)
    *   Zod (client: zod 3.25.76)
    *   WebExtension Polyfill (client: webextension-polyfill 0.12.0)
    *   React Icons (client: react-icons 5.0.0)
    *   clsx (client: clsx 2.1.1)
    *   tailwind-merge (client: tailwind-merge 2.4.0)
    *   deepmerge (client: deepmerge 4.3.1)
    *   jsonrepair (client: jsonrepair 3.13.1)
    *   zod-to-json-schema (client: zod-to-json-schema 3.24.6)
    *   fflate (client: fflate 0.8.2)
    *   fast-glob (client: fast-glob 3.3.2)
    *   ws (client: ws 8.18.0)
*   **Build Tools & Monorepo Management:**
    *   Vite (client: vite 6.3.6)
    *   Rollup (client: rollup 4.24.0)
    *   ESBuild (client: esbuild 0.25.1)
    *   Turbo (client: turbo 2.5.3)
    *   pnpm (version 9.15.1)
    *   Husky (client: husky 9.1.4)
    *   Lint-Staged (client: lint-staged 15.2.7)
    *   ESLint (client: eslint 8.57.0)
    *   Prettier (client: prettier 3.3.3)
    *   TypeScript (client: typescript 5.5.4)
    *   Vitest (client: vitest 2.1.9)
    *   PostCSS (client: postcss 8.4.47)
    *   Tailwind CSS (client: tailwindcss 3.4.17)
*   **External Services & APIs:**
    *   OpenAI (version unknown)
    *   Anthropic (version unknown)
    *   Google Gemini (version unknown)
    *   Azure OpenAI (version unknown)
    *   Ollama (version unknown)
    *   OpenRouter (version unknown)
    *   Groq (version unknown)
    *   Cerebras (version unknown)
    *   Llama (version unknown)
    *   PostHog (client: posthog-js 1.271.0)
*   **Data Stores:**
    *   Chrome Storage API (Local, Session) (version unknown)