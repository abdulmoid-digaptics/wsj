# Latest performance checkpoint

## Paint/presentation continuation 2026-10-28T12:09:26.804Z
Continuation o80BOMQUyNE9X1Km retained QA code/docs only: scripts/qa/paint-timeline.mjs, its eight-test suite, npm test:paint-timeline and README guidance. No app/components/lib/CSS/Next config/dependency or DB changes. TypeScript, app lint, frontend safety9/9, baseline guards8/8 and paint tests8/8 PASS1194; CLI first write succeeds and overwrite is refused with original evidence intact. No new build/full functional-regression claim.

Fresh unchanged full-content baseline1192: three valid samples per route. Home performance82–91/median91, LCP2.948–3.010s/median2.988s, TBT218–402ms/median223. Coworking performance92–96/median93, LCP2.119–2.272s/median2.265s, TBT202–303ms/median259. All6 A11y/BP/SEO100, zero console errors, CLS<0.001. Exit1 because home LCP misses target in all3. Prior frozen functional evidence is unchanged.

Raw-trace correlation: prior fast4-home paints hero217.605ms and records LCP243.459ms (gap25.854ms); slow2/3/5 gaps969–999ms, with672–693ms outside recorded main-thread RunTask intervals. Fresh samples2/3 have1007–1009ms gaps;988/737ms respectively outside recorded tasks. This does NOT identify a compositor/GPU/OS/paint-holding cause, prove a browser defect, or replace simulated Lighthouse LCP. Decode Image events lack node/URL attribution; do not label them proven hero decodes.

Separate fresh-Chrome A/B diagnostic1193: A=unchanged launcher defaults; B=only remove RenderDocument from launcher disabled-feature list, every other default retained. Order AB/BA/AB. A performance82/87/90, LCP3.027/3.007/3.007s; B86/76/78, LCP2.995/2.990/3.034s. All6 valid, other scores100; no meaningful LCP benefit. No browser flags/thresholds changed in canonical runners. Related upstream issue17148 is a hypothesis, not local root-cause proof.

Evidence:C:/Users/Abdul Moid/.aside/u/0/sessions/2026-10-28_o80BOMQUyNE9X1Km/tmp/baseline (6 report/trace pairs), renderdocument-diagnostic (6 pairs+summary), paint-correlation-summary.json, validation-summary.json. Durable PAINT_PROFILE.md summarizes exact scope and next steps. Local frontend1190TTY3100/.next-qa and API1191TTY4000 restarted with explicit QA CORS; final browser snapshot verifies pricing and original disclosure. Direct Aside screenshots timed out twice; baseline/3-home final Lighthouse screenshot saved as measured-home-final.jpg, with content subsequently reverified, not a new screenshot.

Next:targeted cc/viz + frame-sink correlation and/or identical headful-vs-headless control before another product refactor. Preserve canonical failing baseline; do not repeatedly try RenderDocument/AVIF/server-shell candidates or claim acceptance from altered browser settings. Still IN PROGRESS for LOCAL performance, NOT WAITING_EXTERNAL. External legal/pricing review, approved SMTP/delivery, providers, deployment/infra and field-performance inputs remain unchanged. No live writes/accounts/payments/billing/secrets.

---

# Repeated full-content local performance profile

Observed 2026-10-28T10:05:25.426Z. IN PROGRESS: targets not reliably met. This is unchanged-baseline profiling, not a product optimization or replacement for the frozen functional regression. No app/components/lib/Next configuration changes in this continuation.

## Conditions
- Parent and previous continuations idle; repository ownership lock acquired before work. API restarted with explicit localhost3100 CORS permission; full .next-qa frontend on3100.
- Default Lighthouse simulated mobile, five alternating samples per route in one Chrome process. Browser storage reset by Lighthouse; server/image caches warmed by readiness and not reset. No builds/mutation suites/other test browsers run concurrently. Existing browser tabs were not closed or modified until measurement finished.
- Each sample passed API health, published pricing, full-home disclosure/pricing HTML, origin permission, final URL and zero console-error guards. All10 valid samples have100 Accessibility/Best Practices/SEO. Initial CORS-invalid trial excluded, retained separately in tmp/invalid-cors.

## Aggregate
- Home performance80–94, median90. LCP2.075–3.065s, median2.968s. TBT238–520ms, median241ms. Only one of five samples had LCP<2.5s.
- Coworking performance89–95, median92. LCP2.188–3.142s, median2.266s. TBT223–374ms, median258ms. One sample failed both performance/LCP targets.
- Runner exited1 for unmet targets. Do not select the fastest sample as acceptance. No field INP claim.

## All samples
- 1 home: performance80, LCP3.065s, TBT520ms, valid=true, CLS=0.0002495715090171364.
- 1 coworking: performance93, LCP2.266s, TBT258ms, valid=true, CLS=0.0002495715090171364.
- 2 home: performance90, LCP3.000s, TBT239ms, valid=true, CLS=0.0002495715090171364.
- 2 coworking: performance89, LCP3.142s, TBT256ms, valid=true, CLS=0.0002495715090171364.
- 3 home: performance90, LCP2.963s, TBT238ms, valid=true, CLS=0.0002495715090171364.
- 3 coworking: performance95, LCP2.270s, TBT223ms, valid=true, CLS=0.0002495715090171364.
- 4 home: performance94, LCP2.075s, TBT246ms, valid=true, CLS=0.0002495715090171364.
- 4 coworking: performance90, LCP2.190s, TBT374ms, valid=true, CLS=0.0002495715090171364.
- 5 home: performance90, LCP2.968s, TBT241ms, valid=true, CLS=0.0002495715090171364.
- 5 coworking: performance92, LCP2.188s, TBT296ms, valid=true, CLS=0.0002495715090171364.

## Profile findings and next step
- Same authentic828px WebP hero and412×290px LCP box in fast/slow samples. Homepage raw-trace image resource duration4–23ms; element-render delay205–1179ms. These insight subparts are observed trace timings, not components to add to simulated Lighthouse LCP. Image discovery/priority/eager checks pass.
- Sample1 homepage main-thread work2.171s: script evaluation835ms and style/layout755ms in Lighthouse breakdown. Largest observed raw Layout event153ms (561 dirty/total layout objects). Runtime chunk216iyidhmrh3u.js accounts for757ms script evaluation. Fast sample4 and slow samples2/5 still have similar437–448ms simulated runtime long tasks. This is evidence of render/runtime cost and paint-scheduling variance, not proof that one component causes it.
- Next:correlate Image decode/paint timing with the initial document Layout and React runtime task in the saved fast4-home and slow2-home/5-home traces. Only then select an isolated change and compare repeated same-origin full-content distributions. Do not repeat rejected AVIF-first, sync-decode, server-shell/header or broad offscreen-layout experiments as new ideas. Preserve unique disclosure copy and all pricing.

## Reproducible tooling retained
- scripts/qa/performance-baseline.mjs with npm run test:performance-baseline, QA_SAMPLES3–10/default5, absolute fresh QA_TMP required. It writes individual reports/traces and distribution summary, never LIGHTHOUSE_REPORT.md.
- scripts/qa/performance-baseline-guards.test.cjs with npm run test:performance-guards. Tests reject external/credential URLs, relative output, invalid counts, evidence overwrite, offline API, missing origin permission and incomplete source-home HTML without launching Chrome.
- README documents exact constraints and commands. No dependency installation or private .env edit.

Raw evidence:C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_5pC0Ibip2iExipyW\tmp\guarded-baseline\performance-baseline-summary.json and sibling10 Lighthouse JSON/trace pairs.

Validation: profiler guards8/8 PASS; syntax PASS; TypeScript/application lint PASS; correct-cwd frontend safety9/9 PASS. QA scripts are ignored by existing ESLint config. No new production build/full regression claimed for QA/docs-only changes.
