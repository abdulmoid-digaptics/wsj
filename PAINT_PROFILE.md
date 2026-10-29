# Paint versus first-presentation investigation

## Paint/presentation continuation 2026-10-28T12:09:26.804Z
Continuation o80BOMQUyNE9X1Km retained QA code/docs only: scripts/qa/paint-timeline.mjs, its eight-test suite, npm test:paint-timeline and README guidance. No app/components/lib/CSS/Next config/dependency or DB changes. TypeScript, app lint, frontend safety9/9, baseline guards8/8 and paint tests8/8 PASS1194; CLI first write succeeds and overwrite is refused with original evidence intact. No new build/full functional-regression claim.

Fresh unchanged full-content baseline1192: three valid samples per route. Home performance82–91/median91, LCP2.948–3.010s/median2.988s, TBT218–402ms/median223. Coworking performance92–96/median93, LCP2.119–2.272s/median2.265s, TBT202–303ms/median259. All6 A11y/BP/SEO100, zero console errors, CLS<0.001. Exit1 because home LCP misses target in all3. Prior frozen functional evidence is unchanged.

Raw-trace correlation: prior fast4-home paints hero217.605ms and records LCP243.459ms (gap25.854ms); slow2/3/5 gaps969–999ms, with672–693ms outside recorded main-thread RunTask intervals. Fresh samples2/3 have1007–1009ms gaps;988/737ms respectively outside recorded tasks. This does NOT identify a compositor/GPU/OS/paint-holding cause, prove a browser defect, or replace simulated Lighthouse LCP. Decode Image events lack node/URL attribution; do not label them proven hero decodes.

Separate fresh-Chrome A/B diagnostic1193: A=unchanged launcher defaults; B=only remove RenderDocument from launcher disabled-feature list, every other default retained. Order AB/BA/AB. A performance82/87/90, LCP3.027/3.007/3.007s; B86/76/78, LCP2.995/2.990/3.034s. All6 valid, other scores100; no meaningful LCP benefit. No browser flags/thresholds changed in canonical runners. Related upstream issue17148 is a hypothesis, not local root-cause proof.

Evidence:C:/Users/Abdul Moid/.aside/u/0/sessions/2026-10-28_o80BOMQUyNE9X1Km/tmp/baseline (6 report/trace pairs), renderdocument-diagnostic (6 pairs+summary), paint-correlation-summary.json, validation-summary.json. Durable PAINT_PROFILE.md summarizes exact scope and next steps. Local frontend1190TTY3100/.next-qa and API1191TTY4000 restarted with explicit QA CORS; final browser snapshot verifies pricing and original disclosure. Direct Aside screenshots timed out twice; baseline/3-home final Lighthouse screenshot saved as measured-home-final.jpg, with content subsequently reverified, not a new screenshot.

Next:targeted cc/viz + frame-sink correlation and/or identical headful-vs-headless control before another product refactor. Preserve canonical failing baseline; do not repeatedly try RenderDocument/AVIF/server-shell candidates or claim acceptance from altered browser settings. Still IN PROGRESS for LOCAL performance, NOT WAITING_EXTERNAL. External legal/pricing review, approved SMTP/delivery, providers, deployment/infra and field-performance inputs remain unchanged. No live writes/accounts/payments/billing/secrets.

Related source (read-only research):https://github.com/GoogleChrome/lighthouse/issues/17148 . Reports from other sites do not establish this project’s cause.
