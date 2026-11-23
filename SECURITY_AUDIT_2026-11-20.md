# Workspace Junction security, reliability and payment audit (2026-11-20)

Branch `testing`. Stack: Next.js 16 (App Router) frontend, NestJS 11 API with Prisma/PostgreSQL, Stripe (Checkout, Embedded Checkout, Payment Element via SetupIntents), nodemailer SMTP with a database outbox, Cloudflare R2 media.
Payment and email providers were not changed. Nothing was deployed.

Status key: IMPLEMENTED, PARTIAL, NOT IMPLEMENTED. "Existing" means it was already in the code and was verified, not added today.

## 1. Global application security
| Requirement | Status | Evidence |
|---|---|---|
| Authentication / RBAC | IMPLEMENTED (existing) | Staff JWT (HS256 pinned, tokenVersion revocation) via `AuthGuard` + `@Roles`; customers via opaque HttpOnly session (`CustomerGuard`). All admin routes return 401 without a session (live probe). |
| Input validation | IMPLEMENTED (existing) | Global `ValidationPipe` whitelist + forbidNonWhitelisted, no implicit conversion; strict parsers for rules/policies. |
| SQL injection | IMPLEMENTED (existing) | Prisma queries and tagged `$queryRaw` templates only (parameterised). |
| XSS | IMPLEMENTED (existing) | React escaping, CSP/HSTS/COOP headers on the site, email HTML escapes all dynamic text (tests). |
| CSRF | IMPLEMENTED (existing) | Customer: SameSite=Strict cookie + Origin allowlist + `x-wsj-csrf` header (live probe 403). Staff cookie writes require an allowed Origin. |
| Cookies / sessions | IMPLEMENTED (existing) | HttpOnly, Secure in production, SameSite=Strict, path `/api`; staff token 2h; session revocation. |
| Password hashing | IMPLEMENTED (existing) | bcrypt; constant-time dummy compare for unknown users. |
| CORS / headers | IMPLEMENTED (existing) | Origin allowlist with credentials; Helmet on the API; CSP on uploads. |
| Request size limit | IMPLEMENTED (verified) | 100 KB JSON default; oversized body returns 413 `PAYLOAD_TOO_LARGE` (live probe). |
| Brute force | IMPLEMENTED (new + existing) | Per-IP throttles on every auth route (existing). **New:** per-account admin lockout after 10 failures for 15 min (`auth.ts`). |
| File uploads / path traversal | IMPLEMENTED (existing) | Typed upload allowlist, sandboxed CSP on `/uploads`. Not re-audited today. |
| Secrets | PARTIAL | All secrets come from env. **The Gmail app password and the R2 key exposed earlier must still be rotated.** |

## 2. Centralised error handling
| Requirement | Status | Evidence |
|---|---|---|
| Consistent error shape | IMPLEMENTED (new) | `src/errors.ts`: `{success:false, statusCode, message, error:{code, details}, requestId}`. Additive, so the site's `message` reading is unchanged. |
| Request / correlation id | IMPLEMENTED (new) | `X-Request-Id` on every response; safe caller ids are reused, unsafe ones replaced. |
| No stack traces or provider details to users | IMPLEMENTED (new) | 500s return a generic message; Stripe errors map to 502/503 `PAYMENT_PROVIDER_ERROR`; DB pool/timeouts map to 503 `DATABASE_UNAVAILABLE`. |
| Frontend error boundaries | IMPLEMENTED (new) | `app/error.tsx`, `app/global-error.tsx` show a friendly page with a reference code only. |

## 3. Email
| Requirement | Status | Evidence |
|---|---|---|
| Central service + queue | IMPLEMENTED (existing) | `MailService` + DB `EmailOutbox`, compare-and-set claiming, tokens minted at send time. |
| Retries with backoff | IMPLEMENTED (jitter new) | Exponential backoff, max 8 attempts, **new ±20% jitter**. |
| Dead letter | IMPLEMENTED (improved) | `DEAD` status; **new:** permanent failures (invalid address, SMTP 550-554) dead-letter immediately and log `email.dead_letter`. |
| Header injection / recipient validation | IMPLEMENTED (new) | `safeMail()`: single plain address only, CR/LF stripped from subject, unsafe reply-to dropped. One recipient per message (no CC/BCC). |
| Timeouts / circuit breaker | IMPLEMENTED (new) | Connection, greeting and socket timeouts; breaker opens for 60 s after 5 consecutive SMTP failures. |
| Rate limiting / anti-bombing | IMPLEMENTED (new + existing) | Per-IP throttles and per-customer 60 s cooldown on account emails (existing). **New:** contact-form confirmation at most once per address per 24 h. |
| No secrets in email | IMPLEMENTED (existing) | Only single-use, expiring links; no passwords or card data. |
| SPF / DKIM / DMARC | NOT VERIFIED | DNS for the sending domain is outside the codebase. Check before go-live. |

## 4. Payments
| Requirement | Status | Evidence |
|---|---|---|
| Hosted card collection | IMPLEMENTED (existing) | Stripe Checkout / Embedded Checkout / Payment Element. Code scan confirms no card-number or CVC inputs in the site. |
| Server-side amounts, currency, ownership | IMPLEMENTED (existing) | All totals recomputed from the catalog; order and invoice ownership checked. |
| Paid only via verified webhook | IMPLEMENTED (existing) | Signature-verified webhooks with event-id idempotency; redirect page never marks paid. |
| Idempotency | IMPLEMENTED (existing + new) | Idempotency keys on checkout and refunds; **new:** Stripe client with 20 s timeout and 2 SDK network retries (the SDK reuses the idempotency key, so retries cannot double-charge). |
| Uncertain outcomes | IMPLEMENTED (existing) | Fail-closed refund and cancellation handling; uncertain cases go to manual reconciliation. |
| Reconciliation reports | PARTIAL | Billing audit trail, webhook log and finance alerts exist; there is no scheduled reconciliation report against Stripe. |
| Recurring auto-refunds / durable webhook fencing | NOT IMPLEMENTED | Still disabled by design (see progress doc). |

## 5. Card data
| Requirement | Status | Evidence |
|---|---|---|
| No PAN / CVC stored | IMPLEMENTED (verified) | `CustomerCard` holds only Stripe id, brand, last4, expiry. Automated test checks the schema and the frontend. |
| No card data in logs | IMPLEMENTED (new) | `redact()` masks 13-19 digit numbers, Stripe keys, client secrets, JWTs, passwords and DB/SMTP URLs on every error log (tests). |
| Saved cards owner-only | IMPLEMENTED (existing) | Payment methods are listed only for the signed-in customer's Stripe customer. |

## 6. Rate limiting
IMPLEMENTED (existing): global 120 requests/min/IP plus per-route limits (login 5-8/min, password reset and link 3/min, checkout 5/min, refunds/cancels 10/min). The 429 response now uses the standard shape (live probe).
PARTIAL: the limiter is in memory, which is correct for one PM2 process. Running several API processes would need a shared store such as Redis.

## 7. Logging and monitoring
PARTIAL: structured JSON error lines (`http.unhandled`, `http.rate_limited`, `email.dead_letter`) with request ids. Finance and support alerts go by email. No external error-monitoring or alerting service is connected.

## Files
Added: `backend/src/redact.ts`, `backend/test/security-hardening.test.ts`, `app/error.tsx`, `app/global-error.tsx`, this report.
Changed: `backend/src/errors.ts`, `backend/src/application.ts`, `backend/src/payments.ts`, `backend/src/mail.ts`, `backend/src/auth.ts`, `backend/src/public.ts`, `backend/test/errors.test.ts`.
Dependencies added: none. New environment variables: none (the optional `REPLY_TO_EMAIL` was added earlier).

## Tests
- Backend suite: 291 passed, 0 failed (9 new security tests).
- Live probes: request id, 401/404/400/413/429 shapes, CSRF 403, admin login limit.
- Not run: Stripe sandbox decline, 3DS, expired-card and refund-failure scenarios; dependency vulnerability scan (no internet in this sandbox).

## Remaining risks and PCI DSS
1. Rotate the exposed Gmail app password and R2 key.
2. PCI scope: card entry is fully Stripe-hosted, which usually means SAQ A. Confirm with Stripe's PCI guidance and complete the annual SAQ; this report is not a compliance attestation. Keep third-party scripts off checkout pages.
3. Run the Stripe test-card matrix (decline, insufficient funds, expired, 3DS fail, refund fail) before go-live.
4. Configure SPF, DKIM and DMARC for the sending domain.
5. Add a shared rate-limit store if more than one API process is ever run.
6. Connect an error-monitoring service and add a daily Stripe reconciliation job.
7. Run `npm audit` for both apps with internet access.
