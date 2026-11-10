# Jev acceptance record

> Phases 1–3 are historical v0.2.x evidence for the old Planner/Navigator extension. The v0.3 migration has its own local validation record below; historical publication does not imply a new release.

The source fork is [yuxiaoli/nanobrowser](https://github.com/yuxiaoli/nanobrowser). `master` tracks upstream; implementation is on `develop`.

## Phase 1 — MVP

- Extension version: `0.2.1`; tag: `jev-v0.2.1-alpha.1`.
- Source commit: `2e5bf41e384d8f966e722ba97c44b12868de9cf0`.
- [Installable prerelease and assets](https://github.com/yuxiaoli/nanobrowser/releases/tag/jev-v0.2.1-alpha.1).
- [CI run](https://github.com/yuxiaoli/nanobrowser/actions/runs/37800530954): unit tests, type check, lint, 40/40 offline fixture controls, build, ZIP integrity, artifact upload, and publication all passed.
- Downloaded published ZIP: manifest version `0.2.1`, MV3 worker present; SHA-256 `8f16e2f13e869d30df2630dcffa119c1754cab537ac4c22191ccbee34901418a` matches GitHub's published asset digest.
- Published offline report identifies the same source commit, 20 bilingual tasks / 40 control checks, and zero external API calls.

### Browser exercise

Eight checks passed in an isolated Chrome `154.0.8037.98` profile using actual extension pages, service worker, and DOM action execution with mocked Jev and LLM transports: settings persistence, disabled-path compatibility, approval/completion, reconsideration bounds, explicit confirmation, rejection, cancellation, and one-refresh completion verification.

This initial browser run used a built phase-1 working-tree snapshot before the final completion-cache and history-replay fixes. It is not an exact-release browser acceptance for commit `2e5bf41e384d8f966e722ba97c44b12868de9cf0`. The released commit passed the full automated CI checks above; a browser rerun on the final build is tracked separately. No live provider calls were made.

## Phase 2 — Model routing

- Extension version: `0.2.2`; tag: `jev-v0.2.2-alpha.1`.
- Source commit: `a5befcf4a1df655b46617ca1e97fbcd37b08ea32`.
- [Installable prerelease and assets](https://github.com/yuxiaoli/nanobrowser/releases/tag/jev-v0.2.2-alpha.1).
- [CI run](https://github.com/yuxiaoli/nanobrowser/actions/runs/37801290049): validation, packaging, ZIP integrity, and publication all passed.
- Downloaded published ZIP: manifest `0.2.2`, MV3 worker present; SHA-256 `47471d0a17142cfdd0419af0b9d0f69f2bbe0a9c52c59729dda17940169a1e79` matches GitHub's published asset digest.
- Published report identifies extension `0.2.2` and the same source commit: 40/40 mocked control checks and zero external API calls.

## Phase 3 — Experimental System-1

- Extension version: `0.2.3`; annotated tag: `jev-v0.2.3-alpha.1`.
- Source commit: `d52a4a7ea61f1585d29c8770aac2b3b1cde0018a`.
- [Installable prerelease and seven assets](https://github.com/yuxiaoli/nanobrowser/releases/tag/jev-v0.2.3-alpha.1).
- [CI run](https://github.com/yuxiaoli/nanobrowser/actions/runs/37803306830): unit tests, type check, lint, 40/40 adapter controls, packaging, ZIP integrity, **16/16 actual packaged-browser checks**, checksum creation, and publication all passed.
- Downloaded published ZIP: manifest `0.2.3`, MV3 worker present; SHA-256 `09cdde04fd874184dd7afb6f17b4c6a1c0f4edf8c0b5698360131acc8b33e3c4` matches GitHub's asset digest and `SHA256SUMS`.
- Published offline report identifies the same source commit and extension version: 40/40 mocked control checks and zero external Jev/LLM calls.
- Published CI browser report records Chrome `154.0.8037.97`, 16/16 checks passed, and the exact published ZIP digest above. [The saved report](../docs/jev-browser-verification.json) is copied from that release asset. Mocked providers and blocked external DNS keep live TypeSafe verification explicitly false.
- All seven downloaded assets matched GitHub's individual SHA-256 digests; every file listed in `SHA256SUMS` was verified.

### Additional local browser evidence

Before publication, the local phase-3 ZIP (`0.2.3`) also passed 16/16 actual-extension checks in Chrome `154.0.8037.98` with mocked Jev/LLM transports and external DNS blocked. Its SHA-256 was `cdfddf19c14594ebeec76ecf67b774dff9df8f8897a6fab92ac5143765bea096`. The published CI report above is the primary acceptance evidence and tests the independently built release ZIP.

## Historical remaining acceptance

All authorized offline implementation, packaging, browser checks, and prerelease publication are complete. Live TypeSafe connectivity and paired browser task performance are outside the authorized offline implementation scope and remain unmeasured. Offline fixture checks validate supplied mocked responses; they are not task-success measurements.

## v0.3 migration — local validation, October 22, 2026

The migrated source snapshot is `5c4b18cf1c66171399d9db0f073b2edd71888852`, based on master `f1e912d7c9e859eec6638702be920c78a8eff0ea`. The original develop tip remains at `codex/backup-develop-before-rebase-20261022` (`f31af691f71eaa227a6c01ccd05716e353ad8215`). The architecture rewrite consolidates the old Jev changes into the new single-agent implementation.

- Formatting, ESLint, type checking, production build and ZIP packaging passed. Unit tests: 924 passed, 4 skipped, zero failures.
- The preserved 20 bilingual fixtures passed 40 supplied-response controls plus one corpus-integrity check, with zero external API calls.
- Chrome for Testing `154.0.8037.57` passed all six browser checks: `jev-settings`, `jev-loop`, `panel-run`, `panel-cards`, `upgrade`, and `providers-key`. Jev cases cover real settings and approval UI, independently gated batch actions, denied actions without dispatch, bounded completion refresh and caching, selected actions passing through browser permissions, missing-key refusal before model calls, tab-close withdrawal and ignored late approval.
- Browser checks ran a separate autorun build from the same source through the extension's `chrome.debugger` connection, with local fixtures and mocked providers. They did not load the production ZIP.
- The production `nanobrowser-0.3.0.zip` has 33 entries; every entry passed CRC verification and matched the production build. SHA-256: `43c05c225d06fcbf22d608cabb4c6d3123ebf63b84680f35cd4eb0897678eacd`.
- [The machine-readable record](../docs/jev-v03-verification.json) includes source/build-input identity, browser report and screenshot digests, and the checked Jev assertions. All 518 source files matched the Windows validation mirror before source commit; the subsequent acceptance-only changes do not affect build inputs.

This validation does not publish a release or change a remote branch. Live provider connectivity, decision accuracy, real task success, latency and cost remain unmeasured.
