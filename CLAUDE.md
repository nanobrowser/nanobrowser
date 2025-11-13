# CLAUDE.md

This file provides guidance to AI coding assistants (e.g., Claude Code, GitHub Copilot, Cursor) when working with this repository.

## Project Overview

Browseless AI is an open-source AI web automation Chrome extension that runs multi-agent systems locally in the browser. It's a free alternative to OpenAI Operator with support for multiple LLM providers (OpenAI, Anthropic, Gemini, Ollama, etc.).

## Development Commands

**Package Manager**: Always use `pnpm` (required, configured in Cursor rules)

**Core Commands**:

- `pnpm install` - Install dependencies
- `pnpm dev` - Start development mode with hot reload
- `pnpm build` - Build production version
- `pnpm type-check` - Run TypeScript type checking
- `pnpm lint` - Run ESLint with auto-fix
- `pnpm prettier` - Format code with Prettier

**Testing**:

- `pnpm e2e` - Run end-to-end tests (builds and zips first)
- `pnpm zip` - Create extension zip for distribution
- `pnpm -F chrome-extension test` - Run unit tests (Vitest) for core extension
  - Targeted example: `pnpm -F chrome-extension test -- -t "Sanitizer"`

### Workspace Tips

- Scope tasks to a single workspace to speed up runs:
  - `pnpm -F chrome-extension build`
  - `pnpm -F packages/ui lint`
- Prefer workspace-scoped commands over root-wide runs when possible.

Targeted examples (fast path):
- `pnpm -F pages/side-panel build` — build only the side panel
- `pnpm -F chrome-extension dev` — dev-watch background/service worker
- `pnpm -F packages/storage type-check` — TS checks for storage package
- `pnpm -F pages/side-panel lint -- src/components/ChatInput.tsx` — lint a file
- `pnpm -F chrome-extension prettier -- src/background/index.ts` — format a file

**Cleaning**:

- `pnpm clean` - Clean all build artifacts and node_modules
- `pnpm clean:bundle` - Clean just build outputs
- `pnpm clean:turbo` - Clear Turbo state/cache
- `pnpm clean:node_modules` - Remove dependencies in current workspace
- `pnpm clean:install` - Clean node_modules and reinstall dependencies
- `pnpm update-version` - Update version across all packages

## Architecture

This is a **monorepo** using **Turbo** for build orchestration and **pnpm workspaces**.

### Workspace Structure

**Core Extension**:

- `chrome-extension/` - Main Chrome extension manifest and background scripts
  - `src/background/` - Background service worker with multi-agent system
  - `src/background/agent/` - AI agent implementations (Navigator, Planner, Validator)
  - `src/background/browser/` - Browser automation and DOM manipulation

**UI Pages** (`pages/`):

- `side-panel/` - Main chat interface (React + TypeScript + Tailwind)
- `options/` - Extension settings page (React + TypeScript)
- `content/` - Content script for page injection

**Shared Packages** (`packages/`):

- `shared/` - Common utilities and types
- `storage/` - Chrome extension storage abstraction
- `ui/` - Shared React components
- `schema-utils/` - Validation schemas
- `i18n/` - Internationalization
- Others: `dev-utils/`, `zipper/`, `vite-config/`, `tailwind-config/`, `hmr/`,
  `tsconfig/`

### Multi-Agent System

The core AI system consists of three specialized agents:

- **Navigator** - Handles DOM interactions and web navigation
- **Planner** - High-level task planning and strategy
- **Validator** - Validates task completion and results

Agent logic is under `chrome-extension/src/background/agent/`.

### Build System

- **Turbo** manages task dependencies and caching
- **Vite** bundles each workspace independently
- **TypeScript** with strict configuration across all packages
- **ESLint** + **Prettier** for code quality
- Each workspace has its own `vite.config.mts` and `tsconfig.json`

### Key Technologies

- **Chrome Extension Manifest V3**
- **React 18** with TypeScript
- **Tailwind CSS** for styling
- **Vite** for bundling
- **Puppeteer** for browser automation
- **Chrome APIs** for browser automation
- **LangChain.js** for LLM integration

## Development Notes

- Extension loads as unpacked from `dist/` directory after build
- Hot reload works in development mode via Vite HMR
- Background scripts run as service workers (Manifest V3)
- Content scripts inject into web pages for DOM access
- Multi-agent coordination happens through Chrome messaging APIs
- Distribution zips are written to `dist-zip/`
- Build flags: set `__DEV__=true` for watch builds; 
- Do not edit generated outputs: `dist/**`, `build/**`, `packages/i18n/lib/**`

## Unit Tests

- Framework: Vitest
- Location/naming: `chrome-extension/src/**/__tests__` with `*.test.ts`
- Run: `pnpm -F chrome-extension test`
- Targeted example: `pnpm -F chrome-extension test -- -t "Sanitizer"`
- Prefer fast, deterministic tests; mock network/browser APIs

## Testing Extension

After building, load the extension:

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` directory

## Internationalization (i18n)

### Key Naming Convention

Follow the structured naming pattern: `component_category_specificAction_state`

**Semantic Prefixes by Component:**

- `bg_` - Background service worker operations
- `exec_` - Executor/agent execution lifecycle
- `act_` - Agent actions and web automation
- `errors_` - Global error messages
- `options_` - Settings page components
- `chat_` - Chat interface elements
- `nav_` - Navigation elements
- `permissions_` - Permission-related messages

**State-Based Suffixes:**

- `_start` - Action beginning (e.g., `act_goToUrl_start`)
- `_ok` - Successful completion (e.g., `act_goToUrl_ok`)
- `_fail` - Failure state (e.g., `exec_task_fail`)
- `_cancel` - Cancelled operation
- `_pause` - Paused state

**Error Categorization:**

- `_errors_` subcategory for component-specific errors
- Global `errors_` prefix for system-wide errors
- Descriptive error names (e.g., `act_errors_elementNotExist`)

**Command Structure:**

- `_cmd_` for command-related messages (e.g., `bg_cmd_newTask_noTask`)
- `_setup_` for configuration issues (e.g., `bg_setup_noApiKeys`)

### Usage

```typescript
import { t } from '@extension/i18n';

// Simple message
t('bg_errors_noTabId')

// With placeholders
t('act_click_ok', ['5', 'Submit Button'])
```

### Placeholders

Use Chrome i18n placeholder format with proper definitions:

```json
{
  "act_goToUrl_start": {
    "message": "Navigating to $URL$",
    "placeholders": {
      "url": {
        "content": "$1",
        "example": "https://example.com"
      }
    }
  }
}
```

**Guidelines:**

- Use descriptive, self-documenting key names
- Separate user-facing strings from internal/log strings
- Follow hierarchical naming for maintainability
- Add placeholders with examples for dynamic content
- Group related keys by component prefix

### Generation

- Do not edit generated files under `packages/i18n/lib/**`.
- The generator `packages/i18n/genenrate-i18n.mjs` runs via the `@extension/i18n`
  workspace `ready`/`build` scripts to (re)generate types and runtime helpers.
  Edit source locale JSON in `packages/i18n/locales/**` instead.

## Code Quality Standards

### Development Principles

- **Simple but Complete Solutions**: Write straightforward, well-documented code that fully addresses requirements
- **Modular Design**: Structure code into focused, single-responsibility modules and functions
- **Testability**: Design components to be easily testable with clear inputs/outputs and minimal dependencies
- **Type Safety**: Leverage TypeScript's type system for better code reliability and maintainability

### Code Organization

- Extract reusable logic into utility functions or shared packages
- Use dependency injection for better testability
- Keep functions small and focused on a single task
- Prefer composition over inheritance
- Write self-documenting code with clear naming

### Style & Naming

- Formatting via Prettier (2 spaces, semicolons, single quotes,
  trailing commas, `printWidth: 120`)
- ESLint rules include React/Hooks/Import/A11y + TypeScript
- Components: `PascalCase`; variables/functions: `camelCase`;
  workspace/package directories: `kebab-case`
- Enforced rule: `@typescript-eslint/consistent-type-imports`
  (use `import type { ... } from '...'` for type-only imports)

### Quality Assurance

- Run `pnpm type-check` before committing to catch TypeScript errors
- Use `pnpm lint` to maintain code style consistency
- Write unit tests for business logic and utility functions
- Test UI components in isolation when possible

### Security Guidelines

- **Input Validation**: Always validate and sanitize user inputs, especially URLs, file paths, and form data
- **Credential Management**: Never log, commit, or expose API keys, tokens, or sensitive configuration
- **Content Security Policy**: Respect CSP restrictions and avoid `eval()` or dynamic code execution
- **Permission Principle**: Request minimal Chrome extension permissions required for functionality
- **Data Privacy**: Handle user data securely and avoid unnecessary data collection or storage
- **XSS Prevention**: Sanitize content before rendering, especially when injecting into web pages
- **URL Validation**: Validate and restrict navigation to prevent malicious redirects
- **Error Handling**: Avoid exposing sensitive information in error messages or logs
 - **Secrets/Config**: Use `.env.local` (git‑ignored) and prefix variables with `VITE_`.
   Example: `VITE_POSTHOG_API_KEY`. Vite in `chrome-extension/vite.config.mts` loads
   `VITE_*` from the parent directory.

## Important Reminders

- Always use `pnpm` package manager (required for this project)
- Node.js version: follow `.nvmrc` and `package.json` engines
- Use `nvm use` to match `.nvmrc` before installing
- `engine-strict=true` is enabled in `.npmrc`; non-matching engines fail install
- Turbo manages task dependencies and caching across workspaces
- Extension builds to `dist/` directory which is loaded as unpacked extension
- Zipped distributions are written to `dist-zip/`
- Only supports Chrome/Edge 
- Keep diffs minimal and scoped; avoid mass refactors or reformatting unrelated files
- Do not modify generated artifacts (`dist/**`, `build/**`, `packages/i18n/lib/**`)
  or workspace/global configs (`turbo.json`, `pnpm-workspace.yaml`, `tsconfig*`)
  without approval
 - Prefer workspace-scoped checks:
   `pnpm -F <workspace> type-check`, `pnpm -F <workspace> lint`,
   `pnpm -F <workspace> prettier -- <changed-file>`, and build if applicable
- Vite aliases: pages use `@src` for page `src/`; the extension uses
  `@root`, `@src`, `@assets` (see `chrome-extension/vite.config.mts`). Use
  `packages/vite-config`’s `withPageConfig` for page workspaces.
 - Only use scripts defined in `package.json`; do not invent new commands
 - Change policy: ask first for new deps, file renames/moves/deletes, or
   global/workspace config changes; allowed without asking: read/list files,
   workspace‑scoped lint/format/type-check/build, and small focused patches
 - Reuse existing building blocks: `packages/ui` components and
   `packages/tailwind-config` tokens instead of re-implementing
