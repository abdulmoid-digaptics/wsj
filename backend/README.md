# Workspace Junction backend

NestJS 11, TypeScript, Prisma 6, PostgreSQL 17. API http://localhost:4000/api; Swagger http://localhost:4000/api/docs (disabled in production unless SWAGGER_ENABLED=true).

## Start
From backend: `npm ci`, `npm run prisma:generate`.
An ignored backend/.env was generated locally with unique database, JWT and admin credentials. Read ADMIN_EMAIL and ADMIN_PASSWORD locally, never commit or copy them into reports. For a new installation copy .env.example and replace all placeholders, keeping DATABASE_URL and POSTGRES_PASSWORD consistent.
From project root: `docker compose --env-file backend/.env up -d postgres`.
From backend: `npm run db:migrate`, `npm run db:seed`, `npm run build`, `npm start`.
`npm test` runs destructive-to-test-records-only integration checks against the running local API, creates then removes uniquely named test content/user/inquiry. Do not target production.
Optional all-container deployment: from root `docker compose --env-file backend/.env --profile full up -d --build`; seed separately with `docker compose --env-file backend/.env --profile full exec api npm run db:seed`. Never run volume deletion against data you need. Node 22+ recommended.

## API contract
- POST /auth/login {email,password} returns {accessToken,user:{id,email,name,role}} and HttpOnly sameSite=strict cookie. GET /auth/me; POST /auth/logout revokes all sessions for that user. Bearer token or cookie accepted. Cookie writes require an explicit allowed Origin; CORS allows FRONTEND_URL plus comma-separated FRONTEND_URLS origins with credentials. Tokens expire in two hours. Password/role/active updates revoke sessions.
- Content resources: pages, services, pricing, blog, categories, tags, popups, settings. GET /public/:resource lists published only; GET /public/:resource/:slug. Published settings are public: never put secrets there.
- Admin GET/POST /admin/:resource, GET/PATCH/DELETE /admin/:resource/:id. Content body {title,slug,status?,excerpt?,content?:object,metadata?:object,sortOrder?:integer}. Slugs lowercase kebab-case, statuses DRAFT/PUBLISHED/ARCHIVED. Default DRAFT. HTML/content is stored as JSON, not executed by this API; frontend must sanitize HTML before rendering. Categories and tags are content resources; relationships can be represented in content metadata, not foreign-key enforced.
- Lists {items,total,page,limit}, query page>=1, limit<=100, search; content supports status filter. Default 50.
- Users ADMIN-only: list/create/patch/delete. Create {name,email,password (12+ chars),role:ADMIN|EDITOR|VIEWER,active?}. Password hashes never returned. Cannot disable, demote or delete yourself.
- ADMIN manages all; EDITOR content except settings, media, inquiry status; VIEWER read only except settings/users/audit. Audit read-only ADMIN GET /admin/audit. Logs store actor/action/resource/id without passwords or inquiry contents.
- POST /inquiries {name,email,message,phone?,service?,website?}. Honeypot website must be empty. Response {id,status:'received',emailStatus:NOT_CONFIGURED|SENT|FAILED}. Inquiries persist before SMTP attempts. SENT means SMTP accepted, not guaranteed delivery. No SMTP is configured by default. Newsletter is an inquiry with service newsletter, not an external mailing-list subscription. GET /admin/inquiries, PATCH /admin/inquiries/:id {status:NEW|READ|RESOLVED}, DELETE ADMIN-only.
- POST /popup-events {popupId,event:view|click|dismiss|submit,sessionId?}, published popup required. GET /admin/popup-events lists analytics events. Frontend handles schedule/trigger/frequency from metadata.
- GET/POST /admin/media, PATCH /admin/media/:id {alt}, DELETE /admin/media/:id. Multipart file field file, optional alt. Max 5MB, magic-byte checked PNG/JPEG/WebP/PDF only; random filenames, no SVG/HTML/executables. Public /uploads files served nosniff and sandbox CSP. Use malware scanning/object storage before accepting untrusted internet-scale uploads.
- Validation rejects unknown fields. Login 5/minute, inquiry 5/minute, popup events 60/minute, public GET health/list/detail 2000/minute; admin and other default routes 120/minute by client IP. Single-process in-memory throttling; use shared rate-limit storage and trusted proxy configuration for multi-instance deployment. No public registration or password recovery.

## Data migration
Seed idempotently creates admin without changing existing credentials. Optional root data/migration-content.json accepts array (or {items:[]}) of content objects plus kind. Existing kind+slug records preserved. Import only trusted curated source data. Migration SQL is committed under prisma/migrations. Raw scraped HTML is not automatically published.

## Production
Use HTTPS, production NODE_ENV, restricted database network, backups, private SMTP credentials, durable uploads volume and unique JWT secret. Configure correct frontend/API origins. API does not trust forwarded IPs by default. Swagger disabled in production. Rotate credentials from .env before deployment. Media signatures are type screening, not antivirus. Rich content, pricing and popup metadata are flexible JSON rather than rigid business schemas.

Rich-content strings are sanitized server-side with sanitize-html on admin writes and seed imports (no scripts, handlers or unsafe URL schemes). Public content recursively strips secret-looking keys. Popup lists/detail/events enforce metadata startsAt/endsAt publication windows; browser triggers and frequency remain frontend responsibilities. Inquiry list supports NEW/READ/RESOLVED status and name/email/message search; media search matches originalName/alt.

## Continuation hardening (28 October 2026)
- All public content respects metadata.enabled=false and metadata.publishAt (ISO datetime with timezone). Use status PUBLISHED plus a future publishAt to schedule a blog post; no scheduler worker required. Drafts remain private. Popups additionally respect startsAt/endsAt. Public pricing omits requiresReview=true until explicitly reviewed. Admin endpoints retain access to these records.
- Invalid known pricing metadata and invalid campaign/publication dates return 400. Optional DTO fields accept omission, not null. User passwords are limited to 72 UTF-8 bytes to avoid bcrypt truncation. Inquiry names/messages are trimmed before validation.
- GET /admin/popup-stats returns {items:[{popupId,views,clicks,dismissals,submissions,conversionRate}]}. Conversion rate is submissions/views, a ratio (0..n), not unique-visitor analytics. Client events remain untrusted analytics and are not proof of a booking.
- Popup renderer contract: content.heading/body/ctaLabel/ctaUrl/form/imageUrl; metadata.trigger=page|delay|scroll|exit|manual|first-visit, delaySeconds, scrollPercent, pages:string[], frequency, maxViews, startsAt, endsAt. The API stores resource JSON without converting editor aliases.
- Public visibility currently filters the published resource in memory before pagination so totals exclude disabled/scheduled records. Suitable for this migration's small catalog; move scheduling/enabled to indexed columns for large datasets.
- Dependency security updates pin patched transitive packages through overrides; run build, prisma:generate, db:migrate and integration tests when revising overrides. No SMTP or payment validation was performed against live providers.

## Multiple frontend origins for local QA
FRONTEND_URL remains the primary required origin. Optional FRONTEND_URLS is a comma-separated list of additional explicit HTTP(S) origins; credentials, paths, query strings, fragments and wildcard origins are rejected during startup, including production. Origins are canonicalized/deduplicated. The same allowlist is used for CORS and cookie-authenticated write CSRF checks. Requests without Origin may use the public API; cookie writes still require an allowed Origin. Unlisted browser origins receive no CORS allow-origin header, and their cookie writes receive 403.

For the QA frontend on port 3100, start from backend with the existing .env and only this additional process environment:
```powershell
$env:FRONTEND_URLS='http://localhost:3100'
npm start
```
Run npm test in a second shell with the same FRONTEND_URLS to test both configured origins. Login/inquiry/event limits are unchanged. Public read limits remain finite at 2000/minute per endpoint/IP.
