# Backend continuation report

Verified locally on 28 October 2026. Write scope: backend/** and this report only. Existing backend/data preserved; no continuation lock changes, live website writes, accounts, payment collection or emails.

## Changes
- Fixed optional-field null bypasses that could reach Prisma instead of returning validation 400. Added PostgreSQL integer/pagination bounds. Inquiry text trims before required/minimum-length validation.
- New user passwords reject values over 72 UTF-8 bytes, avoiding bcrypt silent truncation collisions. Existing authentication/session revocation and RBAC preserved.
- All public content now honors metadata.enabled=false and metadata.publishAt. Use PUBLISHED status plus an ISO date/time including timezone to schedule. List/detail consistency enforced. Popup events additionally enforce schedule and enabled state.
- Unapproved pricing (metadata.requiresReview=true) is excluded by the public API, not just the UI. Known pricing field types and popup/publication date windows are validated on admin writes.
- Added authenticated GET /api/admin/popup-stats with {items:[{popupId,views,clicks,dismissals,submissions,conversionRate}]}. Rate is submissions/views, not unique visitors or confirmed sales.
- Updated Nodemailer to 10.2.1 and patched transitive dependencies through explicit overrides (deepmerge-ts 8.0.2, effect ^3.20.0, multer 2.5.0, js-yaml 5.5.0). Prisma 6.19 retained; generate/migrate and live API verified after overrides.
- Expanded API and unit tests; tests refuse to run inquiry tests when SMTP_HOST is present.

## Actual checks
- npm run db:migrate: PASS, one existing migration, no pending migrations.
- npm run db:seed: PASS, existing credentials/content preserved.
- npm run prisma:generate after patched install: PASS. API was stopped during generation because Windows locks its loaded Prisma engine.
- npm run build: PASS.
- npm test final run: 4 passed, 0 failed, 0 skipped, 3210 ms. Test names: live PostgreSQL API security and CRUD; rich text strips scripts, handlers, unsafe URLs and secret public keys; popup publication schedules enforced; scheduled publication, disabled offers and metadata schema.
- Live integration assertions cover health, anonymous denial, login/me/logout, content draft/publish/delete, unknown-field and null rejection, role restrictions, disable-user token revocation, self-demotion/deletion denial, inquiry persistence/deletion/honeypot/whitespace rejection, cookie-origin protection, popup tracking and aggregated views, scheduled content absence in list/detail, disabled pricing absence, pricing/date validation, sanitization/secret suppression, signature-checked upload and static retrieval/deletion, password byte bounds and pagination bounds.
- npm audit --omit=dev --audit-level=high: PASS, found 0 vulnerabilities (initial audit found 9; remediated).
- Final GET /api/health: HTTP 200. Subsequent public pricing/popup list probes returned HTTP 429 (configured rate limiting during concurrent local QA), so no final eligible-list totals are claimed.
- Database content inventory: 65 published pages, 37 services, 71 blog posts, 10 categories, 277 pricing records, 1 settings record; 1 archived popup. These counts describe current DB contents, not approved distinct plans.

An intermediate expanded test caught popup publishAt being ignored; fixed and rerun successfully. A final test command issued before startup completed returned ECONNREFUSED; rerunning after confirmed Nest startup passed. One attempted package override referenced an unavailable version; corrected to the available patched release. No unresolved executable backend test failures remain.

## Frontend API contract handoff
Popup renderer uses content.heading/body/ctaLabel/ctaUrl/form/imageUrl and metadata.trigger=page|delay|scroll|exit|manual|first-visit, delaySeconds, scrollPercent, pages:string[], frequency, maxViews, startsAt, endsAt. Existing inspected admin editor used CTA fields in metadata plus delay/targetPages and exit-intent; those are not automatically normalized by backend. Parent notified to align editor/renderer. New scheduling key is metadata.publishAt, not date (source date is historical publication information). Public API metadata.enabled=false and requiresReview=true pricing exclusion require no frontend filtering. Analytics endpoint is now available for UI integration.

## Limitations / external blockers
- [blocked] SMTP delivery verification needs approved SMTP configuration; local configuration has none and no emails were sent. Inquiry persistence and NOT_CONFIGURED response tested.
- [blocked] Live booking/payment-provider success needs valid configuration and explicit live authorization. Backend does not claim actual reservations/payments.
- Popup events are client-submitted, rate-limited counters, not fraud-proof or unique-visitor conversion analytics. Event/audit history remains after test content deletion.
- Resource JSON remains a flexible CMS model; category/tag associations are not foreign-key enforced. Advanced multi-step popup builder, booking availability engine, automated recovery/email flows are not provided by these generic endpoints.
- Public visibility filters all published rows of a resource before pagination. Correct totals for this migration catalog; use indexed scheduling/enabled columns and DB filtering for large catalogs.
- Rich HTML is sanitized; uploads are signature screened, not malware scanned. Production still needs HTTPS, backups, durable storage/scanning, shared throttling for multiple instances and secret rotation. No performance/penetration-test claim.

## Startup
From project root:
```powershell
docker compose --env-file backend/.env up -d postgres
Set-Location backend
npm ci
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run build
npm start
```
After health returns OK, run npm test from backend in a second shell. Use existing ignored local .env without printing credentials. API http://localhost:4000/api; Swagger http://localhost:4000/api/docs.

Current running local backend: process 29560, tool exec session 1053. Database container wsj-postgres-1 was already healthy. Parent may leave API running for frontend/browser checks.

## QA integration follow-up: 28 October 2026, 10:10 local
- Read BACKEND_HANDOFF.md. Preserved all source/DB content and the parent's approved pricing additions. No seed or import run during this follow-up.
- Raised only public health/list/detail GET throttles to 2000/minute. Login 5/minute, inquiry 5/minute, popup event 60/minute and global/admin 120/minute retained.
- Implemented validated FRONTEND_URL plus optional comma-separated FRONTEND_URLS, used by both CORS and cookie-write CSRF checks. Invalid origins (wildcards, URL credentials, paths, queries, fragments, non-HTTP(S)) fail configuration validation. No permissive production wildcard.
- New process environment FRONTEND_URLS=http://localhost:3100; existing primary FRONTEND_URL=http://localhost:3000 retained. No .env or secrets changed/printed.
- npm run build PASS. Final npm test: 6 passed, 0 failed, 0 skipped, 31378.9 ms. Existing four tests retained and expanded; new tests validate origin configuration and decorator throttle policies. Actual integration confirms CORS GET + OPTIONS and cookie-authenticated create/delete for both allowed origins; unlisted localhost:9999 has no ACAO and cookie write returns403. A 130-concurrent-read list burst all returned200 with rate limit header2000; health and detail headers2000 also verified.
- Initial replacement attempt encountered EADDRINUSE because Windows Get-NetTCPConnection is unavailable in this shell. netstat identified original PID29560 still running; only that authorized original was stopped. Final listener is PID18576, exec session1062, running stable with the requested env. An earlier test against the old listener failed on header120; final run against the new listener passed.
- Previous report's process29560/session1053 and throttled final probes are historical, superseded by this section. No further restart planned; parent notified API stable for admin/browser QA.
