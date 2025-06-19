  What Nanobrowser Does

  Nanobrowser is an open-source AI web automation tool that runs as a Chrome extension. It's essentially a free alternative to OpenAI Operator that uses a multi-agent system to automate
  web tasks. Key features:

  - Multi-agent System: Uses specialized AI agents (Navigator, Planner, Validator) that collaborate to accomplish complex web workflows
  - AI Web Automation: Automates repetitive web tasks across websites using natural language commands
  - Privacy-Focused: Everything runs locally in your browser - no data sent to external services
  - Flexible LLM Support: Supports OpenAI, Anthropic, Gemini, Ollama, Groq, Cerebras, Bedrock, and custom OpenAI-compatible providers
  - Interactive Side Panel: Chat interface for interacting with the AI agents

  How the Chrome Extension is Built

  The project uses a monorepo architecture with Turbo for build orchestration and pnpm for package management:

  Build System:

  - Turbo (turbo.json) orchestrates builds across the monorepo
  - Vite for bundling individual packages
  - TypeScript throughout the codebase
  - React for UI components
  - Tailwind CSS for styling

  Key Build Commands:

  - pnpm build - Builds the entire extension for Chrome
  - pnpm build:firefox - Builds for Firefox
  - pnpm dev - Development mode with hot reloading
  - pnpm zip - Creates distribution packages

  Extension Structure:

  - Manifest V3 Chrome extension (chrome-extension/manifest.js)
  - Background service worker for core AI agent logic
  - Content scripts for webpage interaction
  - Side panel for user interface
  - Options page for settings

  @pages/ Directory Structure

  The @pages/ directory contains the UI components of the extension:

  /pages/content/

  - Content script that gets injected into web pages
  - Handles DOM interaction and communication with background scripts

  /pages/options/

  - Options/Settings page (accessible via chrome://extensions)
  - React components for:
    - FirewallSettings.tsx - Security configurations
    - GeneralSettings.tsx - General extension settings
    - ModelSettings.tsx - AI model configuration (API keys, model selection)

  /pages/side-panel/

  - Main user interface - the chat sidebar
  - React components for:
    - ChatInput.tsx - User input interface
    - MessageList.tsx - Chat conversation display
    - ChatHistoryList.tsx - Previous conversations
    - BookmarkList.tsx - Saved/bookmarked interactions

  @packages/ Directory Structure

  The @packages/ directory contains shared utilities and libraries:

  Core Packages:

  - dev-utils/ - Development tooling and manifest parsing
  - hmr/ - Hot module reloading for development
  - shared/ - Common utilities, hooks, and HOCs
  - storage/ - Chrome storage abstractions for:
    - Chat history management
    - User settings/profiles
    - LLM provider configurations
    - Prompt favorites
  - ui/ - Shared UI components and styling

  Build & Config Packages:

  - vite-config/ - Shared Vite configuration
  - tailwind-config/ - Shared Tailwind CSS configuration
  - tsconfig/ - Shared TypeScript configurations
  - zipper/ - Extension packaging utilities

  Additional Utilities:

  - i18n/ - Internationalization support
  - schema-utils/ - JSON schema utilities for AI agent actions

  This architecture allows for code reuse across different parts of the extension while maintaining clear separation of concerns between UI components (@pages/) and shared functionality
  (@packages/).