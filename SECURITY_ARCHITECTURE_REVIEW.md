# Backend security and architecture review

Date: 29 October 2026. Method: independent source/contract review and new pure regression assertions. Scope: backend/src, Prisma schema and both migration SQL files, dependency manifest/lock, backend README/continuation report, and booking/rich-content caller contracts. Agency security-architecture/AppSec perspectives applied; no certification or penetration-test claim.

## Executive decision

**No confirmed P0/P1 in the inspected current request-only product scope. No justified emergency pause of API398x20 v3 exec1051 from this review.** This is not a clean bill of health. Findings below are reproducible from static source or pure transformations; real HTTP/DB/provider behavior was deliberately not exercised. Parent was notified immediately of the booking-price candidate, then explicitly notified of its downgrade after inspecting the manual-review/no-payment UI contract.

Only this file and backend/test/security-review.test.ts were written. No endpoint-source changes, restart, schema/DB changes, seed/import, mutation suite, live-site scan or secret-file read occurred.

## Verification status

- Static source and migration inspection: completed.
- New test file: 10 pure assertions/characterizations, imports DTOs, sanitization and Nest ValidationPipe only; no controller/main/Db import, database client construction, HTTP, SMTP or filesystem writes.
- **[blocked] Execution:** targeted command `Push-Location backend; node --import tsx --test test/security-review.test.ts; Pop-Location` returned tool exit 1223 after 60 seconds with no test output. No tests are claimed passing. Parent can run this exact single file in an executable shell. Do NOT run `npm test`, which also includes live API mutation tests.
- Some tests intentionally characterize known gaps, rather than asserting that those gaps have been repaired. Invert those assertions when implementing a coordinated fix. Source-string assertions are guardrails, not proof of runtime security.
- No browser tabs were opened.

## Threat model and boundaries

Assets: administrator credentials and sessions, customer contact details/request text, future payment-provider references, publication state, public content, uploaded files, audit evidence and service availability.

Actors: anonymous public submitter, malicious browser origin, compromised VIEWER/EDITOR account, ADMIN operator, deployment/configuration error, dependency attacker.

Boundaries: browser to public API; browser cookie/Bearer to AuthGuard; role-authorized DTO to Prisma; flexible JSON to public responses/HTML sinks; uploaded bytes to public filesystem; customer payload to SMTP; operational mutation to separate audit insertion. This is a single-organization model, not verified multi-tenant isolation. Database/backup/network/provider configurations are not established by source inspection.

## Findings

### SR-01: Client-supplied service/pricing is recorded as a booking total (P2 now; P1 before automatic fulfillment)

Evidence: backend/src/dto.ts:59-70 accepts arbitrary nonblank serviceType/serviceName, optional serviceId/couponCode and independently positive subtotalPrice/totalPrice. backend/src/booking.ts:21-28 directly persists spread DTO fields and emails `Total: $` plus the submitted total. No catalog resolution, eligibility, coupon or price relationship check is performed. Backend schema stores Float prices and has no service FK. BookingUpdateDto permits CONFIRMED without an authoritative-pricing transition check.

Pure reproduction: fixture with serviceType=nonexistent-service, serviceId=not-a-catalog-id, subtotalPrice=1000, totalPrice=0.01 and a nonexistent coupon satisfies DTO validation. New characterization asserts this and the direct persistence source. Privileged status/payment/reference fields are correctly rejected as unknown input.

Severity limit: components/booking-dialog.tsx:214,233-234,257 explicitly says request only, estimates, manual final-price review, no payment and no guaranteed reservation. No payment capture/availability engine was found in inspected backend source. Therefore this is NOT demonstrated underpayment, paid-booking forgery or reservation theft. A caller can also omit the UI-provided manual-review note, so the server cannot rely on that note as a control.

Minimal current fix scope: backend/src/booking.ts only, server-owned request-only/unverified-price wording in staff emails and responses, independent of user-controlled notes. Before enabling automatic confirmations/payments, coordinate changes to backend/src/booking.ts and backend/src/dto.ts: resolve a published eligible authoritative service/plan ID; validate add-ons and coupons; compute bounded exact-decimal/minor-unit amounts server-side; reject unavailable selections; require an explicit reviewed pricing transition. Schema changes, if eventually required for exact-decimal values or review evidence, need separate approved migration and backup planning. Do not silently reprice historical user records.

### SR-02: Implicit Boolean conversion can defeat an operator's intended disable (P2, IAM integrity)

Evidence: backend/src/validation.ts:11 and main.ts enable class-transformer implicit conversion. backend/src/dto.ts:24 declares active as Boolean with IsBoolean. With production emitted design:type Boolean metadata, JavaScript Boolean('false') is true, and IsBoolean then accepts it. An authorized admin API client sending active:'false' may activate rather than disable an account. User update still increments tokenVersion, but an active account can authenticate again with its password.

Pure reproduction is captured in the new test: explicitly install the Boolean metadata that tsc emits, transform UserDto with active:'false', assert active===true and zero validation errors, then restore metadata. This models compiled behavior; HTTP confirmation was not run. tsx normally omits this metadata, so plain tsx DTO tests alone could miss it.

Minimal fix scopes: backend/src/validation.ts and backend/src/main.ts, disable implicit conversion and retain intentional numeric @Type decorators; inspect ContentDto.sortOrder and other previously implicit numeric conversions before rollout. Alternative: an explicit strict Boolean transform/validator preserving the original JSON type in backend/src/dto.ts. Add both create/update regressions against compiled and development entrypoints after coordination. Authorization remains ADMIN-only; no anonymous escalation is claimed.

### SR-03: Mutation and audit insertion are not atomic (P2, operational/GRC evidence integrity)

Evidence: backend/src/admin.ts:26,37-39,51-52,111-128; booking.ts:43 and media.ts:26,28 commit operations before awaiting separate audit.create. If audit insertion fails, the operation remains committed while the caller receives an error. Repeated requests can create further media/requests or give misleading operation failures; audit completeness is not guaranteed.

Reproduction condition: inject an audit insert failure after a successful mutation using an isolated test double or approved disposable transaction environment. No fault injection or DB execution was performed here; causal ordering is directly visible in source.

Minimal fix scopes: backend/src/admin.ts and backend/src/booking.ts, use Prisma transactions for each database mutation plus its audit entry. backend/src/media.ts additionally needs filesystem compensation/reconciliation because a Prisma transaction cannot roll back an OS write/delete. Do not delete legacy audit rows or rewrite historical actor evidence.

### SR-04: Media filesystem and database can diverge on ordinary failures (P2, integration consistency)

Evidence: backend/src/media.ts:26 writes the public file before media.create/audit; failure leaves an untracked public file. Line28 deletes the file before deleting the media record; database failure leaves a record/URL pointing at a missing asset. Existing hardening includes authenticated ADMIN/EDITOR writes, one-file/5MB limit, random filenames, exclusive writes, magic-byte screening and sandbox/nosniff static headers.

Minimal fix scope: backend/src/media.ts, compensate newly written files if persistence fails; implement an explicit delete state/reconciliation policy rather than destructive reordering alone. Coordinate schema changes only if a durable deletion/outbox state is chosen. Magic bytes are not structural validation or antivirus; a signature-only fixture is not evidence of RCE. Do not mass-delete orphan candidates without mapping and approval.

### SR-05: Public list pagination does not bound database work or memory (P2 scalability/availability)

Evidence: backend/src/public.ts:25 fetches every matching published row, filters eligibility in memory, and only line26 slices. limit<=100 therefore does not bound the initial DB result, JSON parsing or sanitization. README documents the small-catalog tradeoff. Public per-route/IP throttle is 2000/minute; there is no shared multi-instance limiter in inspected source.

Minimal fix scopes: backend/src/public.ts plus an approved schema/migration if publication/enabled/schedule must become indexed columns. Move visibility and pagination/count to database predicates, retaining identical disabled/scheduled/requiresReview behavior. A short-term cache/finite catalog cap needs explicit freshness/publication semantics. No load test, process exhaustion or distributed attack was attempted.

### SR-06: Public JSON denylist is not a privacy classification boundary (P2 preventive governance, no demonstrated leak)

Evidence: backend/src/content-safety.ts publicSafe removes secret-looking key names, not private values or business classifications. A fixture under internalNotes/customerEmail is returned unchanged; arbitrary content/metadata is available for published settings and other resources. README explicitly warns published settings are public.

No current private production data was inspected or demonstrated exposed. This is not a confirmed credential/PII leak. Minimal fix scopes: backend/src/content-safety.ts and backend/src/public.ts, define an explicit public projection/allowlist for settings and other sensitive resources; maintain a separate private configuration model and data-owner approval. Do not rewrite existing settings without inventory/owner review.

## Controls independently observed

- ValidatedBody/ValidatedQuery pin expectedType, whitelist fields and reject nonwhitelisted properties even if development transpilation omits parameter type metadata.
- AuthGuard verifies JWT signature, loads the current active user, checks tokenVersion, derives role from DB rather than token claims, applies method/class roles, and requires an allowed Origin for unsafe cookie-authenticated methods. Bearer credentials intentionally bypass cookie CSRF checks.
- User routes are ADMIN-only, omit passwordHash from selects, revoke sessions on update, and prevent self-disable/demotion/deletion. Password creation includes the bcrypt UTF-8 byte bound.
- VIEWER read access to inquiry/booking PII is documented role policy, not proven authorization bypass. Least-privilege owner review remains advisable; booking detail currently returns the full stored model including future provider-response fields.
- Content kinds and status are constrained on admin paths; publication checks exclude drafts, future/disabled content and review-required pricing; strings on content/metadata writes are sanitized. This does not attest every frontend HTML sink or legacy imported record.
- Both migrations were read: UUID identifiers, content kind/slug uniqueness, role/status enums and listed indexes align with current schema. Inquiry status remains String, booking service identifiers are not foreign-key constrained, and there are no retention/purge constraints. No schema drift query was run.

## Dependency evidence, 29 October 2026

Manifest and lock versions inspected: Nest common/core11.2.8, Express5.2.1, multer2.5.0, jsonwebtoken9.0.3, nodemailer10.2.1, sanitize-html2.18.1, class-transformer0.5.1, class-validator0.14.4, Prisma6.19.0. No package installation or networked npm audit ran.

Read-only public advisory research used package names/versions only, no private repository data. GitHub maintainer advisory GHSA-q7qp-rjg7-q26m (22 Oct 2026) states multer >=2.0.0,<2.5.0 is affected and 2.5.0 patched for async fileFilter teardown DoS: https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m . Locked2.5.0 is outside that affected range, and inspected upload configuration has no custom asynchronous fileFilter. NVD CVE-2026-92595 describes Nodemailer9.1.0 and earlier legacy resolveContent sandbox bypass: https://nvd.nist.gov/vuln/detail/CVE-2026-92595 . Locked10.2.1 is outside that stated range. These specific checks do NOT constitute a complete current dependency advisory audit or a claim of zero vulnerabilities. No confirmed new dependency P0/P1 emerged from this limited check.

## Enterprise/privacy/GRC release gates

Obtain data-owner decisions on least-privilege access to inquiries/bookings, retention/deletion including backups and SMTP copies, purpose/consent evidence, vendor processing/regions, backup restoration/RPO/RTO, shared rate limits/proxy trust, durable upload storage and malware screening. No SOC2/ISO/GDPR compliance or certification is asserted. Future payment integration requires server-owned amounts, idempotency, webhook signature validation/replay controls and minimized provider payload retention; absence today is a scope boundary, not evidence a payment flow was secured.

## Handoff

Keep v3 running unchanged. Parent should run the single pure test file when shell execution is available, triage P2 changes into a coordinated pause, and rerun affected checks from fresh source after implementation. Escalate SR-01 to P1 before adding automated reservation/payment fulfillment. Runtime failure-path checks, compiled Boolean HTTP behavior, deployment security controls and full dependency advisory coverage remain unexecuted, not silently passed.
