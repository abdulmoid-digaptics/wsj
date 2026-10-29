# Independent QA reality check

Observed 2026-10-29. Verdict: NEEDS WORK. This is independent review, not implementation acceptance.

## Scope and executed evidence

Owned files only: this review and `scripts/qa/independent-guards.test.cjs`. No app/backend/package/other script changes. No API mutation suite, service restart, browser crawl, build, performance or load test was run. No HTTP requests or browser tabs were opened by this reviewer. Read the agency roster's Reality Checker / Evidence Collector guidance.

Executed `node --preserve-symlinks --preserve-symlinks-main scripts/qa/independent-guards.test.cjs`, exec1056, exit 0: seven tests, seven pass, zero fail (includes the requested legacy-cleanup follow-up). These tests deliberately reproduce existing defects and coverage gaps. PASS means the stated defect/gap is present, NOT that the application passes. They use extracted actual runner/map functions, mocked transport and in-memory TypeScript transpilation/DTO validation only. First attempt exec1054 had two harness errors (link-selector regex and cross-realm metadata constructors); both corrected before exec1055 (six pass); exec1056 then passed all seven. No syntax-only result is described as runtime verification.

At a read-only JSON checkpoint, v3 was INCOMPLETE, updated `2026-10-29T12:46:25.024Z`, current `admin.settings.crud` attempt 5, 2824 total/pass, zero failures, ten 429 retries, zero network retries. Cleanup INCOMPLETE at that instant is normal during an active iteration, not proof of leaked records. No finishedAt. This is a dated observation, not current completion. Preserve exec1051 and its lock.

## Reproducible findings

### P1: uncertain accepted writes replay automatically

- `scripts/qa/api-scenarios.cjs:270-275`: request transport and response-body transient failures retry without restricting method. The pending marker records intent but does not reconcile acceptance before replay.
- Reproduction: independent guard line 16 extracts the real `req` function. Mock first POST returns HTTP 201, then body read throws ECONNRESET. The function issues a second POST and returns its receipt. Calls = 2, network retries = 1.
- Impact: bookings/inquiries/media may duplicate; unique content/user writes may fail on replay even though the first request succeeded. Marker cleanup reduces residue but cannot make this truthful request-level evidence. The active run has zero recorded network retries at the checkpoint, so this is not evidence it has already duplicated writes.

### P1: DTO validation changes between transpilation modes

- `backend/src/validation.ts:11`, `backend/src/main.ts:21`: implicit conversion enabled. `backend/src/dto.ts:56` customerName uses string validation, which validates the converted value when design:type metadata exists.
- Reproduction: independent guard line 55 compiles actual dto.ts in memory with emitDecoratorMetadata false and true, then uses actual class-transformer/class-validator with the configured options. A complete normal booking except `customerName:123` is rejected without metadata, accepted as a string with metadata.
- Impact: explicit expectedType fixes missing DTO-class selection, not strict input-type parity. Existing `backend/test/booking-validation.test.ts` covers array elements, dates and bounds but not scalar-name coercion parity. This is actual pure DTO execution, not live endpoint evidence; no server was restarted.

### P1: main resume can mix source versions and interrupted streaks

- `scripts/qa/api-scenarios.cjs:225,227`: fingerprint hashes only the runner itself; resume verifies base/selection/version/marker, not backend source, schema, runtime config or limits. Backend patches can retain completed scenario streaks as if they tested the new version.
- `:290`: prior consecutive >= 20 is skipped. Main never checks prior `report.current` to record an interrupted, unconfirmed iteration or reset its streak. `api-input-vectors.cjs:136` does explicitly handle interrupted current state.
- Reproduction: guards lines 30 and 37 verify the actual resume predicate, hash inputs and loop behavior. For practical reproduction after serial work is released, use a copy of prior evidence with unchanged runner and changed backend source; main's predicate still accepts it. Do not perform that against this active run.
- Limit: source checks prove missing guards, not that current JSON is falsified. A fresh directory after source changes remains necessary.

### P2: contextual booking starts with the wrong service

- `components/booking-dialog.tsx:54-58`: first matching single hyphen token wins, so shared words override exact later workspace matches.
- `components/booking.tsx:8` passes contextual service / main h1 into the dialog.
- Reproduction: guard line 69 executes actual mapService with actual workspace IDs. Dedicated Desk -> hot-desk; Virtual Office -> private-office; Conference Room -> meeting-room. All three outputs confirmed.
- Impact: contextual booking can begin with an already-selected wrong workspace. Home-only generic booking tests do not catch it.

### P2: required opened-modal/44px matrix remains uncovered

- `scripts/qa/layout-audit.cjs:236-262` opens only booking step 1, checks lock/header/focus/Escape, screenshots, but never calls measure on the opened modal and never advances through later steps.
- `:351-361`: admin measure precedes editor open; editor itself only scrolls/screenshots/cancels. Mobile menu `:263-279` also has no geometry measure.
- `:182`: actionable selector includes nav links, not all links, so card/CTA/terms links outside nav are excluded. 44px findings are diagnostics, not a clean gate. This is correctly described as heuristic/executionOnly in the runner, but cannot satisfy every-modal/every-width acceptance.
- Reproduction: guard line 44 inspects exact function ranges and measure placement. Public-functional covers all six booking steps at 390px and focus wrap at desktop, not all step-by-width cells. No long/all-layout campaign fixture matrix exists in layout runner. Current audit explicitly marks it pending.

### P2: uncertain fixture cleanup holes in existing public/settings suites

- `scripts/qa/public-functional.cjs:113-114,125`: popup ID stored only after successful parsed POST response. Final cleanup `:135-140` discovers uncertain inquiries/bookings by marker, but no analogous popup marker discovery. A successful popup POST whose response is lost can remain PUBLISHED, with events, outside popupIds.
- `scripts/qa/business-settings.cjs:13,17`: settings ID is assigned only after parsed POST. If the insert succeeds then body/transport fails, id remains undefined and finally skips deletion. Because slug is business, future runs refuse it as an existing setting. This is a code-path reproduction condition, not an observed leak.
- `public-functional.cjs:135`: inquiry discovery failure adds a note only, not cleanup failure; suite exit can be clean with cleanup unverified. Auth refresh exists only for cleanupDelete (`:34`), not these marker discovery requests. Main's bootstrap refresh is time-based and deliberately avoids fixture-session changes, which is appropriate.
- Settings refuses existing business settings rather than overwriting them. That is a sound safety boundary, but means test:settings is BLOCKED where those settings already exist, not covered.

### P2: historical merging can hide current coverage and wording overclaims production mode

- `scripts/qa/public-functional.cjs:142`: QA_PRIOR_RESULTS accepts arbitrary prior JSON without fingerprint/base/API/version check. Absent tests remain historical PASS; renamed old cases remain; stale fixture IDs and proof can be carried into a newly dated report. This is explicitly disclosed as combined evidence, but is not current full-suite verification.
- `public-functional.cjs:143` always emits 'Stable integrated production server tested' without proving target mode. `business-settings.cjs:16` always says 'actual production HTML' even though BASE is freely configurable. Neither wording follows from those tests alone.
- `scripts/qa/browser-smoke.cjs:18,23-27`: resume has no source/config fingerprint; coverage skips use lengths or route/width presence. Historical failures can be retained or stale successes skipped. Old smoke is neither the full imported-route width matrix nor authenticated admin coverage.

## Booking/focus/scroll source reality check

Native showModal, cancel handling, saved body/root styles, Lenis prevention, Tab wrap and synchronous submission-ref guard are present in booking source. Pure inspection does NOT certify browser behavior. Header/footer flex pinning and independent form scrolling are implemented. Booking uses explicit request-only/estimated copy and no card/CVC/coupon simulation. Calendar intentionally permits horizontal inner scroll for 44px dates; do not mislabel that as document overflow. Background lock restoration and original-trigger focus need runtime checks from a fresh current build, including the lazy dialog import and contextual services. No fresh browser claim is made here.

## Evidence acceptance limits

`API_STRESS_AUDIT.md` is appropriately IN PROGRESS and distinguishes syntax, partial cycles and blocked gates. Its earlier exec1044/v2 pointer and counts are historical; the later v3 section supersedes them. Do not promote 398 definitions or seven defect reproductions to 398x20 completion.

`PUBLIC_FUNCTIONAL_REPORT.md` remains observed 2026-10-29T00:13:32.654Z with obsolete dropdown/booking failures. `SETTINGS_REPORT.md` remains 2026-10-28T08:02:28.339Z and predates current selector changes. They are not evidence of current fixes or current failures. Fresh public/settings/browser/runtime/build gates remain NOT RUN for these changes. Main and companion hash only their own script or predecessor report, not the backend source under test; frozen runner code is not frozen app evidence.

No final acceptance. Required next evidence is serialized after the active owner releases its mutation run and verifies cleanup, using fresh source-bound output. Business pricing/legal/provider approval remains separately outside automated acceptance.

## Follow-up: legacy API integration is unsafe to schedule unchanged

Parent requested this additional inspection. `backend/test/api.test.ts:7` has a single large live test. Page creation at line 14, viewer at 19, inquiry at 22, popup/event at 29-30, media at 34 and origin-specific page writes at 66 are not protected by a comprehensive finally. The only finally (line 60) covers the later scheduled-resource records only and does not verify DELETE statuses; one cleanup transport throw stops remaining cleanup. Concrete reproduction: an assertion failure at line 15 leaks the created DRAFT page; a stats assertion failure at 31 leaks PUBLISHED popup and its event. No live failure was injected here. Accepted-but-lost responses are also untracked. Use a comprehensive marker-owned registry/finally and independently verified cleanup before scheduling test:api; do not delete pre-existing similarly named records.

Further P1 side effect: final `/auth/logout` uses the bootstrap environment admin token, while `backend/src/auth.ts:16` increments that user's tokenVersion, invalidating all existing sessions, not just the test token. Main398 explicitly avoids this; legacy test:api does not. Its 130-way parallel public-settings request batch is also incompatible with the currently mandated non-overlap/no-load phase. Parent reports v3 public.settings test has now passed 20/20; that supersedes earlier dated checkpoints for that scenario, not the whole run.

Production wording check: confirmed unconditional production-tested strings in public-functional and business-settings above. Browser-smoke instead records configurable QA_MODE default development, which is more accurate, though QA_MODE remains a caller assertion rather than independent mode verification.

## Minimal fixture cleanup guard contract sent to parent

Register durable intended slug/title/marker BEFORE sending fixture POST; never replay an uncertain POST. Discover after a lost response using an ownership predicate, not a generic title or prefix alone. Critical query constraint: `backend/src/admin.ts:83` filters `search` on title only. Current popup titles lack the run marker, so `GET /admin/popups?search=<marker>` would produce a false-clean result even when its marker slug exists. Include a UUID marker in future titles or enumerate bounded pagination / exact local Prisma kind+slug+title lookup. `backend/prisma/schema.prisma` PopupEvent has no relation/cascade, so independently delete and verify own popup events.

For settings, hoist the unique marker before POST and persist intent; adopt an uncertain fixture only when slug is business, title is Local QA settings, and metadata tagline, seoTitle and exact seoDescription ALL match this run. Enumerate the already bounded settings list; never delete merely because slug is business. Refuse ambiguous/mismatched ownership and record cleanup failure. Refresh only bootstrap auth once for 401 discovery, and make discovery failures affect exit status. After uncertain DELETE, reconcile absence instead of blindly replaying.

Suggested pure cases: accepted insert/body-read failure discovers/deletes exact owned record once; near-prefix popup and pre-existing business setting are untouched; 401 discovery refresh succeeds once; discovery/body/delete failure yields cleanup=false; lost DELETE response reconciles confirmed absence; popup deletion does not imply event cleanup. Parent owns implementation. Historical seven reproductions above remain evidence of the reviewed version, not regression acceptance. Positive assertions will replace defect-presence expectations when the new implementation is available for review.
