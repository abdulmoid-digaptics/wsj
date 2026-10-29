# DevEx specialist review

Date: 2026-10-29. Scope: repeatable pure checks only; no live API requests, DB access, .env reads, production/backend builds, permission changes, or server shutdowns.

## Changes

- `scripts/qa/local-audit-launcher.cjs`: explicit child cwd without mutating the launcher's cwd; asynchronous child supervision; START/RUNNING/END diagnostics; 10-second heartbeat; default 120-second wall-clock deadline for pure/typecheck/lint; validated `QA_TIMEOUT_MS` override (1000..3600000); timeout exits 124; nonzero child exits and spawn failures remain failures. Only the child this invocation created is signalled. Existing non-check modes retain their prior unbounded lifetime unless explicitly overridden. Inherited environment/runtime flags retained, including the existing preserve-symlinks options.
- `scripts/qa/pure-regressions.cjs`: retains all five original test files and their assertions. Reports each LOAD/REGISTERED stage and switches from an external ESM preload to tsx's installed CommonJS entry point, after initial progress is visible. It must be invoked through the bounded launcher for a hard deadline. No custom transformer, mocked product dependencies, skipped assertions, or forced successful exit.
- `backend/test/dev-startup.test.ts`: normalize callback file paths before matching the virtual TypeScript fixture. Installed TypeScript supplies forward-slash Windows paths, so the old raw string comparison incorrectly attempted to read a nonexistent physical fixture. The decorated parameter metadata assertion is unchanged. Added four launcher assertions covering deadline validation, inherited environment/explicit cwd/nonzero exit, owned-child timeout termination/124, and denied spawn failure.
- `backend/scripts/dev.cjs`: inspected but unchanged. No demonstrated supervisor production defect required a change.
- `package.json`: not edited by this specialist. Requested parent entry: `"test:local:guards": "node --preserve-symlinks --preserve-symlinks-main scripts/qa/local-audit-launcher.cjs pure"`.

## Observed diagnosis

Runtime: Node v26.5.0, installed tsx 4.23.15. Original ESM-preloaded all-in-one run produced no progress and was explicitly terminated (owned exec1052 only). Direct CJS tsx preload also exceeded a 15-second tool deadline. No permissions or filesystem policies were changed.

Instrumented full-gate command:

```powershell
$env:QA_TIMEOUT_MS='20000'
node --preserve-symlinks --preserve-symlinks-main scripts/qa/local-audit-launcher.cjs pure
```

Observed: both CommonJS test files registered by 31ms; tsx CommonJS registration completed by 66ms; execution stalled at `LOAD ../../backend/test/booking-validation.test.ts`. Heartbeat at 10 seconds, timeout at 20 seconds, owned child SIGKILL, END exit124 at 20033ms. This localizes the unresolved stall to the first TypeScript test load/transformation or its imports, not test assertion execution or the basic node:test harness. It does not establish which imported dependency or filesystem operation is responsible.

## Verification

- Syntax: `node --check` on both changed `.cjs` launchers PASS.
- Direct no-worker CJS scenario guards: 7/7 PASS, zero failed/skipped/cancelled.
- Direct no-worker CJS input-vector guards: 8/8 PASS, zero failed/skipped/cancelled.
- Direct installed-Node native type stripping: `node --preserve-symlinks --preserve-symlinks-main backend/test/dev-startup.test.ts`: 10/10 PASS, zero failed/skipped/cancelled, 2099ms. This is an explicitly separate startup/launcher subset, not a substitute claim that the complete tsx-based gate passed. Native execution gives a MODULE_TYPELESS_PACKAGE_JSON warning; it was not suppressed and package module mode was not changed.
- Repeated startup/launcher suite from backend cwd (`test/dev-startup.test.ts`): 10/10 PASS, zero failed/skipped/cancelled, 2127ms. Confirms fixture and launcher cwd assertions work from either project root or backend.
- Real full pure launcher timeout behavior: PASS as a negative-path check (exit124, not success).
- [blocked] Complete pure gate: TypeScript booking validation load stalls; DTO and error-filter assertions were not reached in the instrumented attempt. No full-gate pass is claimed.
- Frontend types/lint: parent's prior exec1049 PASS was supplied in the task; not rerun or independently recertified here.
- No production build/backend build or integrated/mutation/load test run. Active exec1051 and all unknown servers were left untouched. No browser tabs opened.

## Operator guidance

Use the package entry above or the explicit launcher command. A timeout is a failed gate requiring investigation, never a pass. Keep native startup tests and direct CJS subsets clearly labeled. Do not remove decorators, validation, assertions, inherited runtime settings, or sandbox restrictions to turn the unresolved full gate green. The next useful investigation is the first tsx TypeScript load/import path in a permitted environment, with the same wall-clock bound and stage logs.
