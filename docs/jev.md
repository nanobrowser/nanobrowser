# Jev in Nanobrowser v0.3

Jev is an optional TypeSafe decision service above Nanobrowser's existing single-agent loop. It can evaluate proposed actions, verify completion, choose a conversation model at task start and experimentally select a bounded click proposal. This automatic integration is disabled by default. Turning it off preserves the ordinary agent path without automatic Jev API requests.

The separate **Decision models** card configures the agent's advisory `decide` tool for Jev or OpenAI Decisions. It has independent keys and controls. This document covers the automatic **Jev** card; see [Decision models](../README.md#decision-models) for advisory calls.

This document describes the v0.3 migration. The old `0.2.1`–`0.2.3` Planner/Navigator prereleases and their browser report are [historical evidence](../context/RELEASES.md), not installation or acceptance instructions for this version. No v0.3 publication or live-provider result is implied.

## Build and install

Use Node 24 and the package-pinned pnpm 10.34.7:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm zip
```

Load the generated `dist/` directory with **Load unpacked** in `chrome://extensions/` or `edge://extensions/`. The installable archive is written under `dist-zip/`. Configure the ordinary conversation model in Nanobrowser's settings; Jev does not replace that provider configuration. No new release is published by the migration validation workflow.

## Configure Jev

Open **Settings → Providers** and find the **Jev** card. Save the TypeSafe key with **Save Jev key**; save other changes with **Save Jev settings**. Saving or clearing this key does not change conversation-model credentials or the separate Decision models key, even when both cards use TypeSafe.

To disable automatic Jev for subsequent runs, turn off **Enable Jev** and save its settings. Use **Stop** to end an active run. Setting Decision models to **Off** controls only advisory `decide` calls; neither card enables or disables the other.

| Setting | Default | Meaning |
| --- | --- | --- |
| Enable Jev | Off | Opt in to the decision integration. |
| Jev API key | Empty | Your TypeSafe key, saved separately from configuration and ordinary provider keys. |
| Jev model | `jev-latest` | TypeSafe model or alias sent to its typed System One API. |
| Jev timeout | 10,000 ms | Total per-decision budget, including decoding, retry delays and at most two retries. |
| Proceed confidence | 0.8 | Minimum confidence and selected-answer probability for proceeding. |
| Completion confidence | 0.9 | Minimum confidence and selected-answer probability for accepting completion. |
| Selection confidence | 0.8 | Minimum confidence and selected-answer probability for a proposed candidate. |
| Route tasks with Jev | Off | Optional task-start choice of conversation model. |
| Fast / capable conversation model | Current model | Existing configured models; unavailable choices retain the current model. |
| Fast / capable reasoning effort | Current run | An optional saved effort for each route, subject to the chosen model's capabilities. |
| Quick action proposals | Off | Experimental selection among eligible clicks on observed refs. |

Thresholds are initial engineering values, not calibrated reliability guarantees. Enabled Jev requires a saved, valid API configuration. A routing transport failure can retain the current model while action and completion gates remain active; it does not approve a browser action.

## Action checks and approvals

Jev evaluates a proposed browser action before dispatch. It can allow the proposal, request bounded reconsideration, or display a dedicated **Jev asks for approval** card. Approval applies only to that task, action and observed page state. **Resume** is not approval. Rejection, Stop, stale state and changed user instructions prevent the pending proposal from executing.

After Jev allows a proposal, Nanobrowser still runs the ordinary deterministic browser policy. Ask/Auto mode, per-site policy and user-only payment, access-grant and secret-input steps keep their existing meaning. Jev cannot change permissions or authorize a different action. Dispatched input, page reaction and verified result remain separate browser outcomes.

An action-evaluation failure does not implicitly approve execution. Reconsideration and repeated failures are bounded; the loop can stop with a partial outcome instead of dispatching an unsupported action.

## Completion and routing

Jev checks successful completion claims against available page evidence and action outcomes. Insufficient evidence can trigger a bounded read-only refresh. Unresolved evidence remains unverified, incomplete work returns to the agent, and a login or clarification handoff is distinct from success. Cached completion is invalidated by relevant new evidence, actions or user steering.

The existing verification-debt check remains authoritative: Jev cannot erase debt or turn an unverified browser action into successful completion. Its answer is a model judgment, not a browser receipt.

Optional routing runs once at task start. `fast` uses the configured fast conversation model. `capable` and the compatibility outcome `planner` use the configured capable model in the same agent loop. `confirm` requires explicit approval before proceeding. Unset or unavailable model targets retain the current model. Each routed model can use its saved reasoning effort, or inherit the current effort. Every route uses the same tools and browser policy; no separate Planner agent or model tier is introduced.

## Experimental click proposals

Quick action proposals use at most 36 eligible enabled, visible click refs from a complete current snapshot. Jev chooses an existing candidate ID; it cannot invent selectors, text, URLs or action parameters. The loop rechecks the page before the normal action evaluation and dispatch path. That path records the call, enforces browser permissions and creates ordinary verification debt.

Partial snapshots, missing or stale candidates, repeated targets, low confidence and selection errors return to the conversation model. A bounded selection streak also yields to the ordinary model. Free-text generation, scrolling and other action construction remain with the existing agent.

## Privacy and API contract

The adapter calls [TypeSafe's typed System One API](https://docs.typesafe.ai/api/system-one) directly at `https://api.typesafe.ai/v1/systemone`; Jev is not an OpenAI-compatible text-generation provider. When enabled, requests can contain the task, relevant bounded page evidence, proposed action descriptors, recent outcomes and a completion claim. The key is sent only as TypeSafe authorization.

Credential patterns, cookies, URL credentials/query values, sensitive inputs and serialized ordinary form-field values are redacted. Redaction is best effort for arbitrary prose. The Jev key follows the extension's existing local credential-storage model, not an encrypted vault. Local decision diagnostics retain selected outcome/confidence/timing/request-count/usage fields rather than credentials, raw replies or page/action payloads. See [PRIVACY.md](../PRIVACY.md).

## Validation boundaries

The [October 22 migration record](jev-v03-verification.json) records the develop migration snapshot: 924 unit tests and six groups of browser checks, with source and artifact fingerprints. Those results predate its integration with the advisory Jev/OpenAI Decisions PR. They do not certify the combined PR snapshot; current PR checks must validate that source separately. The saved record and historical release evidence remain unchanged.

The migrated [offline fixture controls](jev-evaluation.md) use supplied responses and no real provider calls. The manual Jev workflow validates the repository, packages a ZIP and runs headless `decision-settings,jev-settings,jev-loop` checks with local fixtures and mocked providers. Autorun checks a separate extension build; it is not exact-ZIP browser acceptance. Read the recorded source/artifact evidence before attributing a result to a package.

Live TypeSafe connectivity, representative browser-task quality and paired cost/latency comparisons remain outside the authorized offline scope. Historical v0.2.3 results do not establish those outcomes for v0.3.
