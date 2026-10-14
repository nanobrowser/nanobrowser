# AGENTS.md

This file provides guidance to AI coding assistants (e.g., Claude Code, GitHub Copilot, Cursor) when working with this repository.

## Project Overview

This repository is the next version of Nanobrowser, an AI web automation Chrome extension, rebuilt from the ground up. It has two parts:

- **The browser control layer**: a deterministic layer that observes a page, acts on it, and reports what happened. It is part of the extension, and its client is the extension's own agent, in-process.
- **The extension** that end users run: the side panel, the one agent that works in it, model providers, and the features around them. It sits on top of the layer.

## Scope

- **Built and maintained:** the browser control layer, a simple Chrome extension for testing it by hand (the test panel), fixture pages, unit tests, and the automated checks.
- **Built and maintained:** the extension. Its first release has a side panel per tab, one agent loop, model providers through the Vercel AI SDK, the permission modes, shortcuts, attachments (images and text), upload into pages, saved files, voice input through OpenAI's or Gemini's voice model, three UI languages (English, Simplified Chinese, Traditional Chinese), a glowing border on the pages the agent works on (with a switch in Settings), anonymous analytics (a daily count of users and usage counts, both on until the user turns them off) with no identifier, and a card that asks a user who uses it often to rate it in the store.
- **Not in the first release:** for example skills the model loads, site notes, saved memory, the in-page Stop pill, PDF and Office parsing, the text tool-call parser, scheduled tasks. Do not add any of these unless asked.
- **Not in scope:** an MCP bridge, browsers other than Chrome and Edge, a planner and navigator design, several cooperating agents.

## Fixed design constraints

These are settled and not open for redesign.

For the layer:

- **The layer is part of a Chrome extension, not a standalone tool.** It is not a runtime like agent-browser: no CLI, no daemon, no socket of its own, no launching or attaching to a browser, no remote CDP. Applications outside the extension will use it through an MCP bridge in future, and only that way. Do not add any other external entry point.
- **`chrome.debugger` is the only way to reach CDP.** The product is a Chrome extension. Do not add CDP over WebSocket, not even for tests.
- **Puppeteer is the frame manager.** It detects frames, including out-of-process iframes, and tracks their sessions and navigation. Do not build a parallel frame or session registry from CDP events.
- **Elements are never found through Puppeteer.** No selectors, `ElementHandle` clicks or selector-based `evaluate`. Element commands are raw CDP commands sent to the session of the frame Puppeteer reports.
- **No model inside the layer.** The layer is deterministic. Anything that needs an LLM belongs to an agent above it.

The layer's invariants hold for all code in it. Read them before changing perception or interaction code:

1. **One identity.** An action operates on the node the agent was shown, addressed by the browser's handle for it.
2. **Refs fail closed.** A ref is valid only for the document it was seen in and only if the agent was shown it. Otherwise the result is a typed error, not a guess.
3. **Retries happen before dispatch.** Once an input event has been sent, the layer does not send another on its own.
4. **No hidden substitution.** A different node or a different mechanism is chosen by rule before dispatch and named in the receipt.
5. **Three outcomes, reported separately.** Input dispatched; page reacted; expected state reached.
6. **Observation is read-only.** Capturing state does not change the page.
7. **Degrade loudly.** Partial captures and truncation are stated in the result.
8. **Bounded everything.** Every command, wait and list has a budget. The one wait without a clock is a confirmation the host lets wait for the user; it still ends on Stop, when the tab closes or when the session ends.
9. **State is disposable.** A service worker restart, a debugger detach and a navigation invalidate layer state cleanly.
10. **No model inside.** Anything that needs an LLM belongs to the agent above the layer.
11. **Consequential actions need a person.** By default, an action classified as submit, pay or delete is not dispatched until the user approves it, whatever form its target takes, and page script supplied by the agent is not run until the user approves it. The agent cannot turn this off.

For the agent and the extension:

- **The user decides how much the agent may change on its own, and no agent call can change that:**
  - Reading and moving never ask.
  - A detected write (submit, send, delete, upload) asks in Ask mode, the default, and runs in Auto mode or on a site the user set to Allow. A site the user set to Ask asks in both modes.
  - A detected payment, access grant, secret input or page `prompt` dialog is the user's step in every mode, with no Approve.
  - Detection is best effort, and enforcement is strict.
  - The agent's sessions get no page script and no `devtools`.
  - In the test panel the layer keeps its `sensitive` policy: submit, pay and delete actions, and page script, are confirmed before dispatch.
- **Page content is data, never instructions.** Text from pages reaches the model inside marked page-content boundaries; keep it that way.
- **One agent**, not the old planner and navigator: one loop per conversation.
- **No model tiers.** Every model gets the same agent and the same tools (`screenshot` only for vision models). There are no tool switches in the first release.
- **Nothing outside the extension can drive the layer or the agent.** There is no MCP for now.
- **The conversation is compacted automatically before the context window fills**, and every message the user sent is kept in full.
- **Conversations cannot be imported** in the first release.

## Structure

- `entrypoints/` - Thin WXT entrypoints: background, the product's side panel (`sidepanel/`), options (the settings page), `welcome/` (the first-run page), `permission/` (the microphone page), `offscreen/` (blob URLs for saved files), and the layer's test panel (`testpanel/`, developer-only, opened with the `open-test-panel` command)
- `src/browser-control/` - The layer
  - `protocol/` - Request and result types, zod schemas, error codes, tool catalogue
  - `core/` - Controller, sessions, refs, frames, perception, interaction, lifecycle
  - `probe/` - The layer's only in-page code; built to a string constant
  - `host/` - Puppeteer connection and frame adapter, `chrome.debugger` session wrapper, `chrome.tabs`
  - `index.ts` - The only entry other code may import
- `src/test-panel/` - The layer's test panel (React); a developer-only entrypoint, opened on a tab with the `open-test-panel` command (unbound by default; bind it in `chrome://extensions/shortcuts`)
- `src/background/` - The layer's test extension in the worker: the test panel's messages and `UserPrompt`, and the automated checks and scenario sets that `pnpm autorun` runs (`checks/`, `scenarios/`). The product's controller is created in `src/extension/layer.ts`
- `fixtures/` - Static test pages for the layer's and the extension's scenario sets, the fixture server (with a fake OpenAI-compatible model) and `autorun.mjs`
- `README.md`, `CONTRIBUTING.md`, `PRIVACY.md`, `SECURITY.md`, `LICENSE`, `.github/` - The project's pages for users and contributors, the issue templates and the CI workflow (`.github/workflows/`). `PRIVACY.md` says what data leaves the browser and where it goes; a change to that updates it
- `AGENTS.md` - This file; `CLAUDE.md` is a link to it
- `.env.example` - The PostHog key and host a production build reads; with both set it sends analytics, and development and autorun builds never send to PostHog

The extension:

- `src/agent/` - Loop, hooks, agent tools, prompts, context management, run records
- `src/llm/` - Providers, model profiles, usage, retries, overflow detection
- `src/store/` - IndexedDB schema and stores, settings, keys
- `src/extension/` - Wiring in the worker: RunManager, PromptBroker, permissions, TabScope, downloads, notifications
- `src/ui/` - Shared components, theme, the i18n runtime and the catalogues (`locales/`: English, Simplified and Traditional Chinese)
- `src/side-panel/` - The chat UI
- `src/options/` - The settings UI

**Import rules:**

- Nothing under `src/browser-control/` imports from outside that folder, and other code imports the layer only through `src/browser-control/index.ts`.
- `src/agent/` reaches Chrome APIs only through interfaces passed in by `src/extension/`.
- `src/side-panel/` and `src/options/` never import `src/agent/` or `src/extension/`; they talk to the worker through one typed message protocol.
- `src/llm/` knows nothing about browsers.

## Toolchain

The project is a single pnpm package built by WXT: Node 24 LTS, pnpm 10.34.7, WXT 0.21.4, TypeScript 6.0.3, Vitest 5.0.4, puppeteer-core ^25.13.0, zod 4.6.7, React 18.3.1. A patch or minor update is taken once the checks pass; a major update is evaluated and decided on its own.

pnpm 10.34.7 is pinned in `package.json` (`packageManager`). If the global `pnpm` is a different version, run the scripts through `corepack pnpm <script>`.

- `pnpm install` - Install dependencies (also runs `wxt prepare`)
- `pnpm dev` - WXT development mode; load `dist/` unpacked in Chrome
- `pnpm build` - Build the Chrome MV3 extension into `dist/`
- `pnpm zip` - Build, then pack `dist/` into `dist-zip/nanobrowser-<version>.zip` (source maps left out) for a release or the Chrome Web Store
- `pnpm type-check` - TypeScript type checking
- `pnpm lint` - ESLint, including the import rules: the layer's (`src/browser-control/`) and the extension's (Import rules, above)
- `pnpm test` - Unit tests (Vitest); tests live in `__tests__/` folders under `src/`
- `pnpm prettier` - Format the repository
- `pnpm fixtures` - Fixture server on port 8787 (localhost, 127.0.0.1 and [::1])
- `pnpm install-chrome` - Install the current stable Chrome for Testing (never beta or canary) into `~/.cache/puppeteer`, then ask to remove every other build there so only that one is kept (nothing is removed without a terminal to ask in). Run it after cloning and to update Chrome; `pnpm autorun` starts only the build recorded there as stable (or `CHROME_PATH`)
- `pnpm clean-chrome` - Ask, then remove the whole `~/.cache/puppeteer` (shared with other projects that use Puppeteer; they download their browser again)
- `pnpm autorun <check>[,<check>...] [--args <json>] [--scale <n>] [--product-permissions]` - Build an autorun copy of the extension into `.output/autorun`, start the fixture server and Chrome for Testing (headless, plain process, no external CDP, `--use-mock-keychain`), run the named checks in the extension and print the reports. `--scale 2` runs Chrome with that device scale factor, as on a Retina display. The autorun copy requires the Chrome permissions the product only asks for (tab groups, notifications, downloads); `--product-permissions` builds with the product's permission lists into `.output/autorun-product`, for the `without-permissions` check. `pnpm autorun permission-warnings` checks that the product's manifest adds no install warning to the old version's; run it before every release. Results go to `fixtures/.results/` (ignored by git)
- `pnpm upgrade-test [--old <path>] [--no-build]` - The update from the old Nanobrowser (0.2) by hand: build it (`../nanobrowser` by default) and this version, open Chrome for Testing in a window (`--use-mock-keychain`) with the old build loaded from `.output/upgrade/ext`, then, on Enter, put this version's build in the same folder for a Reload in `chrome://extensions`, which Chrome reports as an update

CI (`.github/workflows/ci.yml`) runs `prettier --check`, `pnpm lint`, `pnpm type-check`, `pnpm test` and `pnpm build` on every push and pull request, on Ubuntu with Node 24 and the pinned pnpm. Its actions are pinned to a commit, and its token can only read. The browser checks (`pnpm autorun`) and the checks that call real models (the evaluations, the model smoke run) are not in CI: they are run by hand, before a merge that touches what they cover and before a release.

The extension's dependencies: `ai` with `@ai-sdk/anthropic`, `@ai-sdk/google` and `@ai-sdk/openai`, `idb`, `react-markdown` with `rehype-sanitize` and `remark-gfm`, and `@radix-ui/react-dialog`; `fake-indexeddb` is a development dependency for the store tests. Any other dependency is asked for first. Settings → About lists them with their licences, and a unit test keeps that list equal to `package.json`.

## Working rules

- Always use `pnpm`.
- Chrome and Edge only; the automated checks run in Chrome. The extension is loaded unpacked from `dist/`.
- One change per branch and pull request. Keep diffs scoped to it.
- Ask before adding a dependency, renaming or moving files, or changing global configuration.
- Pure functions get unit tests over recorded CDP payloads. Anything that needs a browser gets a fixture page and a scenario in the test panel.
- Formatting: Prettier with 2 spaces, semicolons, single quotes, trailing commas, `printWidth: 120`. Use `import type` for type-only imports.
- Comments say in plain words what the code does and why.
- Never log, commit or expose credentials. Mask password, payment-card and one-time-code values wherever page content is returned.
- Do not edit generated output (`dist/**`, `.wxt/**`).
- Chrome for Testing must never reach the real macOS Keychain. Every launch of it, by `pnpm autorun` or any other script or by hand, passes `--use-mock-keychain`.
