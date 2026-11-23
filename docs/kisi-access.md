# Kisi door access

## What is integrated

Admin > Customers & bookings > **Door access** is ADMIN-only. It uses the native Workspace Junction billing records instead of requiring the attached n8n/GHL workflows at runtime.

- Map current catalog or legacy packages to Kisi groups. Mappings start disabled. Enabling/changing/disabling a mapping affects existing eligible purchases at the next sync, not only new purchases.
- The worker reconciles persisted paid state at startup (15 seconds) and every 60 seconds. Retry sync runs the same reconciliation immediately. Stripe payments never depend on a Kisi response.
- Recurring access requires a paid invoice line for the subscription item covering Stripe's exact current service period. Invoice-level accrual dates are not used as authorization. Older mirrored invoices without these line fields must be refreshed by replaying the relevant verified Stripe invoice events before they can authorize access. Yearly subscriptions use the actual yearly period. Trials, pending payments, unpaid renewal periods, suspended and ended subscriptions do not provision access. Cancel-at-period-end retains the paid window until its existing end. Past-due state never creates an unpaid extension; any already-paid period is honored only within the configured billing grace policy.
- Confirmed inventory reservations create one window each, from 15 minutes before the reservation to its exact end. The plan's service and scheduled start must both match the inventory claim. Active CoworkingDay rows create midnight-to-midnight windows in America/Chicago, with DST-aware boundaries. Moved days and released/cancelled bookings lose their owned windows on reconciliation.
- Unscheduled one-time packages deliberately fail closed rather than inventing a period or granting indefinite access. The member screen explains this condition.
- Expired windows are no longer desired. Kisi's valid_until enforces expiry even when this application is offline. Cancellation/suspension and schedule changes are reconciled within roughly a minute while the worker and Kisi are available. A provider outage can delay an early revocation: inspect failures and remove access directly in Kisi when urgent.
- Durable per-window records, exact remote matching after uncertain POST results, a cross-process renewable lease, complete pagination, timeouts and rate-limit backoff support safe retries. Provider error bodies and API credentials are not exposed.

## Offboarding

Confirm Offboard to remove all basic member group assignments for the resolved Kisi user, including assignments created by the old n8n workflows. Automatic grants are blocked before revocation starts. A failure remains REVOKE_FAILED, not OFFBOARDED, and the worker/Retry sync retries it. Resume clears the block and reconciles only that member against paid eligibility.

Automatic cancellation/suspension removes only this application's owned windows, so another valid membership or externally managed access is not erased. Explicit offboarding is broader. Kisi users with privileged non-basic roles require manual review in Kisi rather than allowing this integration to remove an administrator's roles.

**Door offboarding does not cancel a Stripe subscription, void invoices, or send GHL/Slack updates.** Use the existing Subscriptions controls for billing cancellation. This separation prevents an access failure from falsely reporting billing/offboarding success. Legacy GHL contacts do not automatically become WSJ customers: migrate/verify their identities and paid periods separately. Exact-email lookup can reuse an existing Kisi user; duplicate customer/user identities fail closed.

## Server setup

1. Apply `backend/prisma/migrations/20261130000000_kisi_access/migration.sql` using the normal migration deployment after reviewing any other pending migrations. From backend: `node node_modules/prisma/build/index.js migrate deploy`.
2. Generate the Prisma client: `node node_modules/prisma/build/index.js generate`.
3. Set `KISI_API_KEY` in the backend's secret environment, never a NEXT_PUBLIC variable. The supplied key is saved only in the ignored local backend/.env. No key is committed or returned to the browser.
4. Restart the API, open Door access, verify the key can list the expected groups, then configure mappings carefully. With KISI_ENABLED=false the screen can read groups and save mappings, but grant/revoke operations remain disabled.
5. Set `KISI_ENABLED=true` and restart the API to activate. This can provision existing paid purchases for enabled mappings. Review the mappings and pending member windows before enabling on production.
6. Use Retry sync and inspect every member error. A successful sync request means the scan completed; individual failures remain visible and retryable.
7. Disable the old n8n grant/offboard workflows before managing the same members here, otherwise two systems can make conflicting access changes. The supplied workflow JSONs are references, not deployed by this change.

Keep the API key's organization scope limited to the intended venue. Kisi group schedules/restrictions still apply. Only basic group roles are created; no remote door unlock endpoint is exposed. Rotate any key shared in chat according to your security policy.

## Endpoints

All require the existing staff AuthGuard and ADMIN role, including CSRF/origin protections for cookie-authenticated mutations.

- GET `/api/admin/kisi?search=`: configuration flags, groups, package mappings and member/grant status. No secret values.
- PATCH `/api/admin/kisi/plans/:id`: `{enabled:boolean, groupId?:string}`. Enabling requires a group visible to the configured Kisi account.
- POST `/api/admin/kisi/sync`: reconcile, with an audit entry.
- POST `/api/admin/kisi/members/:customerId/offboard`: block and revoke, audited.
- POST `/api/admin/kisi/members/:customerId/resume`: unblock and reconcile, audited.

## Verification

`node -r ./scripts/qa/ts-register.cjs backend/test/kisi.test.ts`

The tests mock Kisi. They must not grant/revoke real door access. The current development machine's configured PostgreSQL at localhost:5437 was unavailable during implementation, so applying the migration and end-to-end verification against live Kisi remain activation steps, not claimed completed.

Official API contracts: https://api.kisi.io/docs and https://docs.kisi.io/platform/integrate_kisi/integration_methods/user_provisioning/assign_access_rights . The implementation uses current assignee/applies_to fields rather than deprecated user_id/group_id parameters.

### Implementation verification results

- 19 Kisi safety/regression tests passed.
- 64 billing/core/catalog lifecycle/finance regressions passed with the required test JWT secret configured, plus 5 Stripe webhook regressions.
- Backend and frontend TypeScript checks passed; scoped admin ESLint passed.
- Real-browser checks against an isolated localhost QA fixture passed: required group validation, mapping save/reload, member search/empty state, offboard confirmation/state, resume confirmation/state, and 390px mobile layout without horizontal overflow.
- The fixture made no real Kisi requests. The API key's live validity/permissions, PostgreSQL migration, and production deployment were not verified or performed. Automatic mutations remain disabled in local configuration.

## Live monitoring and two-way sync (Workspace operations)

Settings in `backend/.env`:

| Setting | Effect |
|---|---|
| `WORKSPACE_LIVE_MONITOR=true` | Read-only live mirror. Kisi (users, groups, access rights, door and device status, floors, digital credentials, visitors, last 7 days of events) refreshes every `WORKSPACE_LIVE_INTERVAL_SECONDS` (default 60). The Google Sheet refreshes every 2 minutes from its link-shared CSV export. |
| `KISI_LIVE_WRITES=true` | Two-way sync. Edits to live Kisi users and access rights in Workspace operations are applied to the real Kisi organization. Also required for Door access auto-sync writes. |
| `KISI_ENABLED=true` | Door access auto-sync: grants/revokes time-limited access for paid purchases of packages mapped to a Kisi group. Nothing happens until a package is mapped. |

What two-way sync writes: create user, rename, notes, suspend/resume (`access_enabled`), grant/change/remove basic group access (`group_basic`), and member offboarding (removes the person's basic group access). Changing an access window creates the new assignment first and then removes the old one, so there is no gap. Every write is recorded in the audit log (`resource: kisi-live`).

What it never writes: groups and their restrictions, doors, devices, remote unlocks, place lockdown, manager/admin roles, and the Google Sheet (the existing n8n workflow keeps writing the Sheet).

Device tokens, MAC/IP addresses and credential secrets are never copied into the app. Live rows are labelled "Live"; local-only rows "Local". Turn `KISI_LIVE_WRITES` off to make every live row read-only again.

## n8n → Kisi + WSJ app sync

n8n stays the single sender. Workflows "2 - Invoice Paid - Grant Access" and "3 - Member Offboarding - Revoke Access" (v3) write to Kisi exactly as before, and in parallel POST the same outcome to the app:

`POST https://<app-domain>/api/integrations/n8n/events` with header `x-wsj-webhook-secret: <N8N_WEBHOOK_SECRET>`

Events: `access.granted`, `access.not_required`, `access.failed`, `kisi.user_needed`, `access.revoked`, `access.revoke_failed`. Each carries the contact (id, email, name), package, Kisi user/group ids, the exact access windows, counts and the n8n execution id. The app stores each event once (retries return `duplicate`), shows it in Workspace operations → Reports → **n8n sync log**, and refreshes its live Kisi and Sheet data within ~2 seconds.

Setup in n8n:
1. Import the two v3 workflow files (they are inactive on import). Compare with the running v2 workflows, then activate v3 and deactivate v2.
2. Add n8n Variables: `WSJ_APP_WEBHOOK_URL` (the URL above, on a public HTTPS domain; n8n cannot reach localhost) and `WSJ_APP_WEBHOOK_SECRET` (same value as `N8N_WEBHOOK_SECRET` on the app server).
3. The "WSJ App: Notify" step retries 3 times and continues on error, so an app outage never blocks Kisi or GHL.

Keep Door access auto-sync mappings empty for packages n8n already provisions, so access is granted by one system only.
