# Jev evaluation methodology for v0.3

## Offline decision fixtures

`docs/evaluation/jev-fixtures.json` preserves the original 20 synthetic task records and their source IDs verbatim. Each has English and Chinese task text. `src/llm/jev/__tests__/fixtures.test.ts` runs 40 bilingual control cases, each through both the disabled factory path and an injected mocked TypeSafe transport, plus one corpus-integrity test. This is 80 engine evaluations and 40 supplied-response fetch calls, with zero external provider requests.

The disabled path must make no transport calls and preserve `NoopDecisionEngine` outcomes. The enabled mock path checks the supplied decision, thresholds, handoff distinction, candidate ID, synthetic usage and one mocked request. The source fixture's `choice` is input to the test, not a Jev prediction. Historical `acceptance` descriptions include old Planner/Navigator vocabulary; these tests do not execute those browser scenarios or verify their acceptance statements.

Run the controls and produce a standard Vitest JSON report:

```sh
corepack pnpm test src/llm/jev/__tests__/fixtures.test.ts --reporter=json --outputFile=fixtures/.results/jev-fixture-tests.json
```

The report's 41 tests comprise 40 control cases and one corpus check. Test durations and adapter elapsed times describe a local mock transport. The token counts are synthetic. They do not measure live latency, billable usage, task success, incorrect executed actions or cost. Unknown live metrics stay unmeasured rather than being inferred from passing control checks.

Adapter and loop tests separately cover malformed responses, thresholds, retries, total deadlines, cancellation, privacy, bounded selection, approval lifecycle and completion gates. A passing mock result proves control behavior under its supplied inputs; it does not establish decision accuracy or performance improvement.

## Current extension checks

Use the current stable Chrome for Testing and the repository's normal autorun path:

```sh
corepack pnpm install-chrome
corepack pnpm autorun decision-settings,jev-settings,jev-loop
```

Autorun starts Chrome headlessly with a fresh profile and `--use-mock-keychain`. The extension reaches CDP through `chrome.debugger`; no remote CDP connection or external browser-driving entry point is added. These checks use local fixtures and supplied Jev/conversation-model responses without live provider credentials. Reports and any screenshots go to ignored `fixtures/.results/`.

`jev-settings` exercises the real options page, disabled defaults, separate masked key storage, persistence, routing choices and switching automatic Jev off. `jev-loop` exercises the current worker and single-agent integration with mocked decisions. The separate `decision-settings` check covers the advisory Jev/OpenAI Decisions card. Run it as well when validating the combined integration. These cards have independent keys and off controls. Consult the produced report for the exact checks and outcomes.

The saved [October 22 migration record](jev-v03-verification.json) reports 924 unit tests and six groups of browser checks on the develop migration snapshot. It predates the combined advisory Jev/OpenAI Decisions PR and does not certify that combined source. Its source fingerprints and results are preserved as evidence of the earlier snapshot; rerun the relevant checks for the updated PR.

The autorun extension is built separately under `.output/autorun`. A production ZIP's manifest, archive integrity and SHA-256 are checked separately. Browser results on autorun must not be labeled exact packaged-ZIP acceptance, even when both artifacts come from the same source commit.

## Repository and CI validation

Use Node 24 and pnpm 10.34.7, pinned in `package.json`:

```sh
corepack pnpm exec prettier --check .
corepack pnpm lint
corepack pnpm type-check
corepack pnpm test
corepack pnpm build
corepack pnpm zip
```

The normal CI workflow covers repository checks. The manually dispatched Jev workflow adds the offline fixture JSON report, production package validation, Chrome for Testing autorun checks, provenance and checksums. Its repository token is read-only. It uploads evidence artifacts and never publishes a prerelease. Report combined PR validation against its actual source identity and artifacts; the saved [migration and release record](../context/RELEASES.md) describes earlier snapshots.

## Historical v0.2.x evidence

[The saved browser JSON](jev-browser-verification.json) is the unchanged historical phase-3 report for extension `0.2.3`. Its 16 passing checks concern the old Planner/Navigator packaged extension with mocked providers. The recorded ZIP SHA-256 is `09cdde04fd874184dd7afb6f17b4c6a1c0f4edf8c0b5698360131acc8b33e3c4`. Historical source commits, release assets, earlier limitations and CI identities remain in [RELEASES.md](../context/RELEASES.md).

That report is preserved for traceability. It is not a v0.3 browser report, migration result or live TypeSafe-connectivity test. The old `scripts/evaluate-jev.ts` and remote-CDP browser script are not runtime or validation entry points for this migration.

## Paired online protocol, pending separate authorization

Later live evaluation requires authorization and the user's provider keys. Use controlled test pages, fixed initial state, identical ordinary model settings and step limits. Run disabled/enabled pairs in randomized order with at least three repetitions per task/language, starting a fresh session each time. Form interactions belong on local or dedicated sandbox pages, never real purchases or messages.

Record task ID, language, mode, model references, attempt, independently checked task outcome, incorrect dispatched actions, wall-clock time, LLM/Jev request counts, token usage, cancellation/errors and confirmations. Check each acceptance statement against the final browser state or result independently of the agent. Include failures and variation; do not compare unlike starting states.

Estimate cost only from recorded usage and explicitly supplied current prices, including applicable request fees. Report unknown cost if either is unavailable. Offline mock timings and synthetic usage cannot establish live savings, task success or reliability. No online evaluation is performed by the migration workflow.
