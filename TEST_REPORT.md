# Workspace Junction local verification

Updated 2026-10-28T08:21:12.954Z. **IN PROGRESS, not COMPLETE or WAITING_EXTERNAL.** All final critical functional/integration checks passed. The mobile Lighthouse90+/LCP<2.5s targets remain an open LOCAL acceptance gap. No live website, billing, payment, external-account or external-form changes were made.

## Inventory and migration
-306 discovered source URL observations/probes:189 HTML observations and117 Markdown variants/probes.173 implemented unique content/archive routes represent102 page/custom/archive records plus71 original posts.10 category archives are included in the102, not additive. Remaining HTML observations are10 exact redirects,5 excluded WordPress menu/navigation templates and one canonical-slash alias.
-1182 original image assets physically migrated and nonempty;1182/1182 passed local HTTP checks. Eight additional AVIF/WebP derivatives of the authentic homepage photo passed exact intrinsic-size/aspect tests and8/8 HTTP checks. Original files remain intact.
-59 evidence-reviewed published plans are centralized in the API; browser tests matched all service and billing-period filters to actual API data. Raw conflicting/unreviewed prices remain quarantined. See PRICING_REVIEW.md and MIGRATION_REPORT.md.

## Implemented local application
- Next.js16.4.3/React19 App Router public pages, service directories, source content, gallery/media, responsive navigation, business contact settings, centralized pricing, contact/newsletter/tour/service inquiries, booking selection/review and campaign rendering. Static homepage links use native anchors to avoid unnecessary client-link hydration. Mobile homepage introduces the real photo before editorial copy; desktop remains unchanged.
- Journal:71 migrated posts with original content/images/dates/URLs, categories/tags, featured/related posts, search, pagination, reading time, author/share metadata. Canonicals, sitemap/robots, structured data, alt text and exact redirects are present.
- NestJS/PostgreSQL/Prisma: migrations/seed, secure authentication/session revocation, roles, content and scheduling/visibility APIs, pricing, media/signature checks, inquiries, settings, popup analytics, users/audit and Swagger documentation. Source fallback is not evidence of API availability; integrated QA now checks API health explicitly.
- Admin: actual API-connected TipTap blog CRUD/drafts/publish/schedule/SEO, page/service/pricing/taxonomy management, media upload/alt, campaign settings/statistics, business/SEO settings, inquiry/user/audit views and role enforcement. Earlier authenticated browser blog CRUD/statistics and API CRUD across eight resources/media are detailed in ADMIN_REPORT.md. Not every admin field/role was exhaustively browser-tested.
- Campaigns:three structured layouts; CTA/newsletter/inquiry/booking/review forms; dates, page targeting, delay/scroll/exit/manual/first-visit triggers; session/daily/first-visit caps and recorded view/click/dismiss/submit counters. This is not an arbitrary drag-and-drop canvas or fraud-proof unique-visitor analytics.

## Final full-content acceptance
The full-content build1150 passed with180 generated pages and TypeScript. Compiled HTML was independently checked to include original source-home content AND pricing. The temporary HERO_ONLY diagnostic condition was removed from source before this build. No diagnostic/partial build is being delivered.

Final sequential run 2026-10-28T08:00:47.907Z through 2026-10-28T08:05:01.846Z:
- Backend production build PASS; PostgreSQL/security/origin/rate-limit suite6/6 PASS.
- Frontend content/media/structured-data safety9/9 PASS; lint PASS.
- Public browser suite19/19 PASS; zero request failures or cleanup failures. Covers menus/keyboard navigation, journal search/pagination/category,59-plan filters, booking/contact/newsletter validation and actual DB receipts, campaign triggers/caps/events and multi-step inquiry persistence. A targeted390px rerun additionally verified booking selection, required errors, review/edit, actual NOT_CONFIGURED database receipt and Escape; it was merged transparently with the full baseline in PUBLIC_FUNCTIONAL_REPORT.md.
- Business-settings E2E PASS: CMS tagline/global SEO title/description reached production HTML after ISR; temporary setting deleted; defaults restored and observed after ISR.
- 173 data routes and183 internal links returned200. H1/title/description/canonical checks passed. Six major routes at320,360,375,390,430,768,1024,1280,1440,1920,2560px plus three mobile blog samples:zero horizontal overflow or broken-image findings. Four axe serious/critical scopes:zero violations. Browser exceptions:zero. Exact scope/results in QA_BROWSER_REPORT.md.
- Original assets1182/1182 and derived assets8/8 HTTP PASS. All10 exact mappings returned301 to recorded destinations, all destination responses200; /dedicated canonical alias308; sitemap and robots200.
- Final production dependency audits:frontend0 and backend0 known vulnerabilities reported by npm audit --omit=dev --audit-level=high.
- All owned test inquiries, campaigns/events, settings, media/content fixtures were removed by their suites; legitimate audit history remains. Existing user data/edits were preserved.

## Measured mobile Lighthouse: target NOT achieved
- home: Performance80, Accessibility100, Best Practices100, SEO100; LCP3.161s, CLS0.00025, TBT465ms. Observed 2026-10-28T08:04:35.784Z.
- coworking: Performance87, Accessibility100, Best Practices100, SEO100; LCP3.156s, CLS0.00025, TBT283ms. Observed 2026-10-28T08:04:49.172Z.

These are the FINAL frozen full-site measurements, not the best of earlier attempts. Default simulated-mobile Lighthouse; two local page samples only. Server/image cache and local CPU affect results. No field INP claim: TBT is not INP. The Lighthouse command now exits nonzero on target misses. Functional acceptance passed; overall acceptance remains incomplete because performance/LCP did not pass.

Inline CSS, offscreen-layout, split-hydration, synchronous decoding and Webpack/PostCSS experiments were rejected/reverted when they did not help. A hero-only diagnostic measured88/LCP2.73s but is NOT acceptance evidence; it was removed and the full page rebuilt. Static derivatives reduced observed image-load time, but did not alone resolve paint delay. Raw traces and experiment JSON remain in session tmp. One later run lost its expired API process and was rejected; the final run used a freshly restarted API with health checks before each stage. Do not label the performance gap as an external credential blocker. Further focused profiling/reproduction is a local follow-up, not completed work.

## Test reliability
Run mutation suites sequentially, never alongside crawls/campaign browsers. Temporary globally visible test pages/campaigns otherwise contaminate cached links/view counts. Such an earlier invalid concurrent run was superseded by the final clean sequential run. Analytics tests now await matching successful POST responses. Browser/asset scripts fail their exit code on findings. Settings QA waits for30-second ISR restoration before continuing.

## External requirements and honest limits
- Business-approved privacy/terms are missing from usable source evidence; the noindex review disclosure is not a legal policy. Business review of unresolved price evidence remains required.
- Approved SMTP host/sender/domain authentication and an approved delivery test are missing. Local forms are DB receipts, not delivered email; newsletters record consent requests, not external list enrollment.
- Booking/membership/payment provider details/credentials and explicit live approval are absent. Existing external links are preserved; inquiries do not reserve spaces, establish availability, activate memberships or charge cards. No payment adapter is enabled.
- Production host, secrets, durable storage/backups, TLS, monitoring/shared rate limits and explicit deployment/cutover approval remain required. Upload signature checks are not antivirus; this was not a penetration test.
- Real-device/field Core Web Vitals/INP need approved staging/production observation. See BLOCKERS.md.

## Exact local startup
From repository root, using the existing private backend/.env:

```powershell
docker compose --env-file backend/.env up -d postgres
npm --prefix backend run build
npm --prefix backend start
```
In another root terminal:
```powershell
npm run dev
```
Frontend http://localhost:3000, admin /admin/, API http://localhost:4000/api, Swagger /api/docs. Credentials remain only in the ignored local environment; none are included here. Fresh-install npm/prisma/migration/seed/import commands are in README.md and do not overwrite existing users/content.

For isolated production QA, allow http://localhost:3100 in the backend FRONTEND_URLS process environment, then at root:
```powershell
$env:NEXT_DIST_DIR='.next-qa'
npm run build
npm run start -- --port 3100
```
Current QA frontend is localhost3100; API localhost4000. Tool-started services may expire; use normal terminals for persistent review.

## Production deployment steps: not executed
1. Obtain explicit deployment approval and business/legal/pricing sign-off; keep WordPress intact.
2. Provision private PostgreSQL, durable uploads, backups/restore, frontend/API processes, TLS/proxy and monitoring. Rotate all local secrets and configure exact production origins/URLs.
3. Run migrations, seed/import reviewed content once without overwriting CMS edits; verify counts, original/derived assets and backup restoration. Build with the intended production public environment.
4. Configure SMTP/provider adapters only with approved details and authorized delivery/integration tests. Never enable payment collection by default.
5. Run staging route/SEO/accessibility/auth/media/backup/performance checks, address the open performance gap, then approve cutover with a documented WordPress rollback.

## Genuine server-shell/client-header experiment, 2026-10-28T08:42:45.196Z
A distinct actual server-shell/footer + isolated client-header refactor was built and measured, not merely Suspense. Invalid initial attempts with expired API/frontend processes were excluded. With healthy API and full source-home/pricing present: unchanged baseline home88/LCP2.836s/TBT322ms, coworking95/LCP2.273s/TBT201.5ms; candidate home84/LCP3.012s/TBT425.646ms, coworking94/LCP2.341s/TBT226.356ms. Both sampled pages had100 accessibility/best-practices/SEO. Candidate did not improve results and was REVERTED exactly; no SiteHeader file remains. Earlier full frozen regression remains the accepted functional evidence, not this rejected candidate. These later baseline measurements illustrate local variance; they do not meet homepage90+/LCP2.5s and do not replace the earlier frozen final measurements by selecting a best score. Source-inspection tab was closed before both measurements; no live writes. Experiment raw evidence is in parent session tmp/islands-before and tmp/islands-after.

### Reversion verification 2026-10-28T08:44:38.789Z
Candidate header file removed; site-shell.tsx byte-for-byte equals the pre-experiment accepted source. Temporary .next-islands build removed; generated type includes and next-env reference restored. Restored TypeScript and lint passed1168. Baseline .next-qa restarted as1167TTY on3100; API1160TTY on4000 healthy200. Restored HTTP HTML contains source-home AND pricing. Fresh proof: parent session tmp/restored-full-homepage.webp. No product-code candidate remains. Parent released ownership; routine remains active, project still IN PROGRESS for homepage performance and the separately documented external requirements.


## AVIF-first hero experiment, 2026-10-28T09:08:49.419Z
Continuation udLY8vOsJzeoVib2 checked parent/recent children idle, acquired released lock, and tested only local performance. Existing authentic AVIF derivatives are smaller (828px:22626 bytes versus WebP29268), but AVIF-first picture/preload did not demonstrate an LCP benefit. Build1170 passed180 generated pages; original disclosure byte-identical42674 bytes; compiled pricing present. Valid same-origin candidate home83/LCP3.256s/TBT401ms and repeat85/2.947s/TBT404ms; coworking93/2.270s and94/2.267s. Before:home93/2.729s/TBT198ms,coworking95/2.202s. Restored unchanged baseline:home85/3.430s/TBT284ms,coworking94/2.277s/TBT233ms. All valid samples accessibility/best-practices/SEO100; CLS<=0.00025. Unchanged-baseline variance means no causal regression claim or cherry-picked acceptance. Port3101 attempt excluded due CORS console errors.
Candidate REVERTED byte-for-byte; .next-avif removed; next-env/tsconfig restored. No retained product-code edits. TypeScript/lint and frontend safety9/9 passed1178. Frozen full regression remains functional evidence, not a claim of rerun here. Raw reports/traces and summary:C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_udLY8vOsJzeoVib2\tmp\avif-experiment-summary.json.
API previous process expired AFTER all measurement readiness checks passed; restarted1179TTY4000. Baseline .next-qa1176TTY3100. Verify health next run. No DB mutation suites, live writes, payments, external forms/accounts or billing. Still IN PROGRESS for LOCAL mobile LCP; external approvals unchanged. Next:repeated serial same-origin full-content baseline profiling under stable CPU/cache conditions before another critical-paint change. Do not repeat rejected AVIF-first or server-header experiments as untested candidates.

Final restored verification:API4000 health200,home3100 HTTP200 with original source-home AND pricing present after ISR recovery; screenshot in udLY tmp/restored-home-hero.webp. Owned lock released 2026-10-28T09:09:43.578Z.


## Repeated baseline profiling, 2026-10-28T10:06:51.240Z
Continuation5pC0Ibip2iExipyW verified parent/other owners idle and acquired its own lock. Retained only QA tooling/docs: scripts/qa/performance-baseline.mjs, performance-baseline-guards.test.cjs, two npm scripts, README guidance and PERFORMANCE_PROFILE.md. No application/components/lib/config/dependency changes or DB mutations. Initial restart lacked QA CORS permission; those diagnostics were excluded. API restarted with explicit localhost3100 process origin permission, no private .env edits.
Five serial valid samples per route:home performance80–94/median90,LCP2.075–3.065s/median2.968s,TBTmedian241ms; coworking89–95/median92,LCP2.188–3.142s/median2.266s,TBTmedian258ms. All10 have100 Accessibility/Best Practices/SEO, zero browser-console errors; runner exited1 because targets were not consistently met. This unchanged-baseline distribution does not supersede frozen functional regression or constitute improvement/acceptance. Full source-home and pricing remained present.
Profiler refusal tests8/8 PASS; TypeScript/application lint and frontend safety9/9 PASS1189. QA scripts are excluded by repository ESLint configuration, so syntax checking and their own8 guards are evidence, not a claim that ESLint linted them. An initial safety invocation from the wrong cwd failed2 filesystem fixtures; correct explicit-cwd rerun9/9 supersedes it. No production rebuild required for QA/docs-only changes; full functional regression was not rerun.
Evidence:C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_5pC0Ibip2iExipyW\tmp\guarded-baseline\performance-baseline-summary.json, sibling10 reports/traces; durable all-sample results/profile in PERFORMANCE_PROFILE.md. Same hero is LCP in fast/slow samples; observed raw resource duration4–23ms versus render delay205–1179ms. Next:correlate saved fast4-home versus slow2/5-home image decode/paint, initial document Layout and React task before an isolated repeated before/after experiment. Do not remove unique source content or replay rejected candidates. Still IN PROGRESS for LOCAL performance, not WAITING_EXTERNAL. External legal/SMTP/provider/deployment/field approvals unchanged.
Current services:full .next-qa frontend1181TTY3100, API1184TTY4000 with localhost3100 CORS. Fresh health/CORS200 and home200/full content verified; screenshot5pC0 tmp/verified-home-hero.webp. Processes can expire; verify next run. Lock released after checkpoint.


## Paint/presentation continuation 2026-10-28T12:09:26.804Z
Continuation o80BOMQUyNE9X1Km retained QA code/docs only: scripts/qa/paint-timeline.mjs, its eight-test suite, npm test:paint-timeline and README guidance. No app/components/lib/CSS/Next config/dependency or DB changes. TypeScript, app lint, frontend safety9/9, baseline guards8/8 and paint tests8/8 PASS1194; CLI first write succeeds and overwrite is refused with original evidence intact. No new build/full functional-regression claim.

Fresh unchanged full-content baseline1192: three valid samples per route. Home performance82–91/median91, LCP2.948–3.010s/median2.988s, TBT218–402ms/median223. Coworking performance92–96/median93, LCP2.119–2.272s/median2.265s, TBT202–303ms/median259. All6 A11y/BP/SEO100, zero console errors, CLS<0.001. Exit1 because home LCP misses target in all3. Prior frozen functional evidence is unchanged.

Raw-trace correlation: prior fast4-home paints hero217.605ms and records LCP243.459ms (gap25.854ms); slow2/3/5 gaps969–999ms, with672–693ms outside recorded main-thread RunTask intervals. Fresh samples2/3 have1007–1009ms gaps;988/737ms respectively outside recorded tasks. This does NOT identify a compositor/GPU/OS/paint-holding cause, prove a browser defect, or replace simulated Lighthouse LCP. Decode Image events lack node/URL attribution; do not label them proven hero decodes.

Separate fresh-Chrome A/B diagnostic1193: A=unchanged launcher defaults; B=only remove RenderDocument from launcher disabled-feature list, every other default retained. Order AB/BA/AB. A performance82/87/90, LCP3.027/3.007/3.007s; B86/76/78, LCP2.995/2.990/3.034s. All6 valid, other scores100; no meaningful LCP benefit. No browser flags/thresholds changed in canonical runners. Related upstream issue17148 is a hypothesis, not local root-cause proof.

Evidence:C:/Users/Abdul Moid/.aside/u/0/sessions/2026-10-28_o80BOMQUyNE9X1Km/tmp/baseline (6 report/trace pairs), renderdocument-diagnostic (6 pairs+summary), paint-correlation-summary.json, validation-summary.json. Durable PAINT_PROFILE.md summarizes exact scope and next steps. Local frontend1190TTY3100/.next-qa and API1191TTY4000 restarted with explicit QA CORS; final browser snapshot verifies pricing and original disclosure. Direct Aside screenshots timed out twice; baseline/3-home final Lighthouse screenshot saved as measured-home-final.jpg, with content subsequently reverified, not a new screenshot.

Next:targeted cc/viz + frame-sink correlation and/or identical headful-vs-headless control before another product refactor. Preserve canonical failing baseline; do not repeatedly try RenderDocument/AVIF/server-shell candidates or claim acceptance from altered browser settings. Still IN PROGRESS for LOCAL performance, NOT WAITING_EXTERNAL. External legal/pricing review, approved SMTP/delivery, providers, deployment/infra and field-performance inputs remain unchanged. No live writes/accounts/payments/billing/secrets.
