# Nanobrowser × Jev implementation plan

> The original v0.2.x plan below is preserved as history. The v0.3 migration addendum at the end supersedes its Planner/Navigator architecture, model-tier assumptions, build commands and release automation. Historical completion statements apply only to the v0.2.x delivery.

## Agreed scope

Fork `nanobrowser/nanobrowser` into `yuxiaoli/nanobrowser`. Preserve `master` for upstream tracking and implement on `develop`. Keep Planner, Navigator, browser actions, provider configuration, and WXT packaging. Jev is an optional decision engine, never an OpenAI-compatible generative provider. Settings default to disabled.

The approved execution scope is offline validation and installable prereleases. No paid/live TypeSafe or LLM calls are authorized for this implementation. Live connectivity, browser task success, and online performance comparisons remain pending; this delivery must not claim they passed or that Jev improves performance.

Offline delivery is complete: all three phase prereleases are published, and the final published ZIP passed the actual-browser checks with mocked providers in CI. See [the release acceptance record](RELEASES.md) for tags, source commits, artifact hashes, and evidence; the remaining online acceptance below is still pending.

## Architecture and interfaces

Actual source lives under `src/background/agent/`. Add a `decision/` module with an injectable `DecisionEngine`, `JevDecisionEngine`, and `NoopDecisionEngine`. Inputs carry task identity, task text, relevant redacted browser state, execution outcomes, and an `AbortSignal`.

- Action evaluation returns `proceed`, `reconsider`, or `confirm` before action execution, including history replay and batches.
- Completion verification returns `complete`, `incomplete`, or `needs_verification`. It distinguishes successful completion from a handoff for login or clarification and covers both Navigator and Planner completion exits.
- Routing returns `fast`, `capable`, `planner`, or `confirm` and uses existing `ModelConfig` values.
- Experimental selection chooses an existing candidate ID or falls back. Arbitrary text and novel action parameters remain generative Navigator responsibilities.

Use the documented TypeSafe `POST https://api.typesafe.ai/v1/systemone` endpoint, strict response validation, bounded retries, cancellation, and a total default decision timeout of 10 seconds. Default thresholds are 0.8 for proceed/selection and 0.9 for completion. They are configurable initial values, not measured reliability guarantees.

The approved replacement safety choice preserves Nanobrowser's prompts and URL firewall without adding a deterministic sensitive-action gate. Confirmation requested by the decision engine must use explicit approve/reject messages bound to a task, action, and state; ordinary resume cannot approve an action.

## Incremental implementation

1. **MVP:** evaluate actual proposed actions, feed reconsideration back to Navigator, support explicit confirmation, verify completion with cached unchanged evidence, allow at most one read-only refresh when verification is needed, and stop unresolved decisions after bounded reconsideration.
2. **Optimization:** choose fast/capable configured models at task start, escalate uncertain tasks to Planner, collect redacted decisions/outcomes/timing/usage, and add 20 fixed bilingual offline fixtures plus a paired online evaluation protocol.
3. **Experimental:** enumerate valid DOM-derived actions; ask Jev to choose a candidate, revalidate its target, run the normal evaluation path, and fall back to Navigator on low confidence, stale targets, complex tasks, or missing candidates.

Expose settings in the existing options page: enable, API key/model, timeout/thresholds, optional routing models, and experimental selection. Direct requests are the first release approach. Store the user's key in Chrome local storage as existing providers do; never include it in the repository, package, telemetry, decisions, or errors. Strip passwords, tokens, cookies, sensitive form values, and URL query information; cap text before sending it.

## Validation and release acceptance

- Unit tests cover decisions, thresholds, malformed API replies, failure/timeout/cancellation, fallback, confirmation rejection/expiry, completion exits, routing, history replay, batches, and experimental candidates.
- Compare disabled and mocked decision paths using the same 20 synthetic bilingual task fixtures. Label reported timings as mock transport timings; leave live success, incorrect-action rate, latency, and costs unmeasured.
- Run the pinned pnpm 10.34.6 on Node 24 LTS: `pnpm test`, `pnpm type-check`, non-fixing ESLint, `pnpm build`, and `pnpm zip`. Do not commit generated outputs.
- CI validates PRs and `develop`, packages ZIPs, verifies ZIP/manifest structure, and uploads checksums and evaluation data. `jev-v*` tags create prereleases in the fork only.
- Load the unpacked artifact in Chrome where the browser environment permits it; verify options, mocked decisions, approval/rejection, cancellation, and completion. Report an unavailable extension-loading environment explicitly rather than substituting a manifest check for end-to-end verification.
- Document installation/configuration/privacy/limitations. Publish installable GitHub prereleases when validation passes and record release URLs.

## Remaining online acceptance

With later live-call authorization and configured provider keys, verify the actual TypeSafe response contract and run paired browser tasks with Jev disabled/enabled against the same page states and LLM models. Measure success, incorrect actions, calls, latency, token usage, and configured-price costs. The original full Definition of Done additionally requires this live end-to-end acceptance; offline prereleases do not prove it.

## v0.3 migration addendum

Migrate the Jev features from the saved `develop` implementation to the current v0.3 single-agent extension before rebasing. Keep Jev disabled by default and keep the ordinary conversation model, browser-control layer and product permission policy. The authorized scope is offline implementation, tests, build/package validation and local headless browser checks with supplied responses. This migration does not authorize live TypeSafe or LLM calls, publication, or performance claims.

### Current architecture

- `src/llm/jev/` preserves `DecisionEngine`, `JevDecisionEngine`, `NoopDecisionEngine`, the four operations and metadata. It knows nothing about Chrome. Its typed TypeSafe API uses a total default 10-second deadline, at most two retries, strict answers, bounded responses and redacted input.
- `src/agent/jev.ts` integrates action checks, completion verification and optional bounded candidate selection into the one existing loop. `src/agent/jev-candidates.ts` proposes only clicks on eligible refs from a complete current snapshot. It does not invent text, selectors, URLs, browser sessions or new parameters.
- `src/extension/` supplies the engine, routing, credential access and dedicated Jev approve/reject prompts. `src/store/jev.ts` persists credential-free settings; the TypeSafe key uses the existing separate key store. Settings and prompt text support English, Simplified Chinese and Traditional Chinese.
- Optional task-start routing selects a configured fast or capable conversation model for the same agent and tool policy. The compatibility outcome `planner` maps to the capable model in that same loop. Missing or unavailable routing targets retain the current model; there is no Planner agent or model tier with extra tools.

### Control and browser invariants

A proposed action receives `proceed`, `reconsider` or `confirm`. Reconsideration is bounded. A Jev confirmation is a dedicated approval of that task/action/page state; Resume is not approval. Rejection, cancellation, stale evidence and changed user instructions prevent the pending action from being dispatched. Approved actions still pass through the existing deterministic browser policy. Ask/Auto and per-site policy remain authoritative; payments, access grants and other user-only steps remain user-only.

Successful completion still requires the loop's existing verification debt to be resolved before Jev can accept it. Jev can request a bounded read-only evidence refresh, distinguish incomplete work or a handoff, and stop an unresolved claim as partial. Cached completion is invalidated by relevant state, outcomes or steering. A Jev prediction is never a browser receipt or proof that a dispatched action succeeded.

Experimental selection is opt-in. It chooses an existing ID from bounded eligible click refs, rechecks page state, then uses the ordinary action gate, permission policy, dispatch, receipts and debt. Partial snapshots, stale or repeated targets, missing candidates and low confidence return to the ordinary conversation-model path. No external entry point, browser-driving process or model is added to the browser-control layer.

### Offline validation and evidence

Preserve the 20 original bilingual fixtures verbatim. `src/llm/jev/__tests__/fixtures.test.ts` runs 40 English/Chinese control cases, each with disabled and supplied-response paths, plus corpus validation. Its timings describe mock transport and its synthetic usage does not estimate live cost. The historical fixture descriptions retain old scenario vocabulary; their executable assertions check only typed control outcomes.

Use the current package pin, pnpm 10.34.7 on Node 24, for formatting, lint, type checks, unit tests, build and ZIP validation. The manual Jev workflow additionally produces a Vitest JSON fixture report and runs `pnpm autorun jev-settings,jev-loop` with local fixtures and mocked providers. Autorun uses a separate extension build; package integrity and autorun browser evidence are recorded distinctly. It uses the normal `chrome.debugger` path and Chrome for Testing with `--use-mock-keychain`.

The migration workflow has a read-only repository token and uploads artifacts only. It does not create releases or publish packages. The old v0.2.3 browser report and prerelease records remain historical evidence; final v0.3 validation results, source identity and package digest must be recorded after the new checks finish. Live connectivity, real browser task quality and paired cost/latency measurements remain outside the offline scope.
