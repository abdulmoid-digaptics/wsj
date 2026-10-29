# Stripe payments setup

Real payment collection is implemented end-to-end: a booking creates a server-priced
Stripe Checkout Session, a webhook confirms payment and marks the booking `CONFIRMED`,
and admin can issue real refunds. This replaces the earlier "request only, no payment
collected" design.

## Required environment variables (`backend/.env`)

| Variable | Where it comes from | Required for |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys. `sk_test_...` for testing, `sk_live_...` for real charges. | Creating Checkout Sessions, verifying promotion codes, issuing refunds. |
| `STRIPE_PUBLISHABLE_KEY` | Same page, `pk_test_...`/`pk_live_...`. | Not read by the backend today (the hosted Checkout redirect flow doesn't need it). Kept for any future Stripe.js/Elements work. |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks → your endpoint → "Signing secret" (`whsec_...`), **or** printed by `stripe listen` for local development (see below). | Verifying that webhook requests genuinely came from Stripe. Without this, `/api/webhooks/stripe` returns 400 for every request and bookings never get confirmed. |

The user said they will replace `STRIPE_PUBLISHABLE_KEY`/`STRIPE_SECRET_KEY` themselves.
**`STRIPE_WEBHOOK_SECRET` must still be added** — it does not exist yet and payment
confirmation will not work until it does.

## Webhook endpoint

Point Stripe at: `POST {API origin}/api/webhooks/stripe` (e.g. `https://api.yourdomain.com/api/webhooks/stripe`
in production). Subscribe to at least:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded` (delayed payment methods)
- `checkout.session.expired` (marks an abandoned `PENDING` booking `CANCELLED`)

Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.

### Local development

Install the [Stripe CLI](https://stripe.com/docs/stripe-cli), then:

```powershell
stripe login
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

This prints a `whsec_...` value — put it in `backend/.env` as `STRIPE_WEBHOOK_SECRET` and
restart the backend. Trigger a test event any time with `stripe trigger checkout.session.completed`.

## What was built

- **`backend/src/pricing-catalog.ts`** — the single source of truth for every plan and
  add-on price, in whole US cents. The client can never set a price; it only references
  a `planId`/`addOns` ids, and the server resolves the real amount itself.
- **`POST /api/bookings`** — validates the plan/add-ons against the catalog, optionally
  validates a coupon code against Stripe Promotion Codes, creates a `PENDING` booking,
  creates a Stripe Checkout Session (`mode: 'payment'`) with server-built line items, and
  returns `{ id, checkoutUrl }`. The frontend redirects the browser to `checkoutUrl`.
- **`POST /api/webhooks/stripe`** — verifies the Stripe signature against the raw request
  body, then on `checkout.session.completed`/`async_payment_succeeded` marks the matching
  booking `CONFIRMED`, stores the payment intent id, and sends a confirmation email if SMTP
  is configured. Idempotent: redelivery of the same event does not re-send the email or
  re-process an already-confirmed booking. On `checkout.session.expired`, an abandoned
  `PENDING` booking is marked `CANCELLED`.
- **`PATCH /api/admin/bookings/:id`** — setting `status: 'REFUNDED'` now calls Stripe's
  real Refunds API against the booking's stored payment intent before saving; if the Stripe
  call fails, the booking status is **not** changed, so admin never shows a refund that didn't
  actually happen.
- **`GET /api/public/booking-catalog`** — the frontend fetches live prices from here instead
  of hardcoding them, so the UI and the actual charge can never drift apart.
- **`GET /api/public/bookings/:id/confirmation`** — a safe, minimal, PII-free status lookup
  (no email/phone/notes) used by `/booking-confirmation` to show the real payment outcome
  after the Stripe redirect, polling for a few seconds while the webhook catches up.
- **`components/booking-dialog.tsx`** — removed the "request only / no payment collected"
  disclaimer and copy; added a coupon-code field and a notes field; the final step now
  explicitly authorizes the exact amount charged and redirects to Stripe's hosted Checkout
  on submit.
- **`app/booking-confirmation/page.tsx`** + **`components/booking-status.tsx`** — the page
  customers land on after paying (or cancelling) at Stripe.

## Scope notes

- Payment is a **one-time charge** per booking (Stripe Checkout `mode: 'payment'`), not a
  recurring subscription, even though plans are labeled "/month". Real subscription billing
  (recurring charges, a billing portal, proration, cancellation flows) is a materially larger
  feature and was not built; say so explicitly if that's actually wanted next.
- Coupons use Stripe's real Promotion Codes API. Create codes in the Stripe Dashboard →
  Products → Coupons/Promotion codes; an unknown or inactive code is rejected with a 400
  before checkout starts.
- Card data is never handled or stored by this application; Stripe's hosted Checkout page
  collects it directly.

## Verified (2026-10-29, local, live-mode keys)

A full booking flow was exercised in a real browser against the running dev server:
workspace → plan (Silver, $100) → add-on (Printing Bundle, +$15) → date/time → review, which
correctly showed "Total due now $115" and an explicit payment-authorization checkbox. Submitting
created a `PENDING` booking with server-computed `subtotalPrice: 100`/`totalPrice: 115` (verified
via the admin API) and redirected to a real `cs_live_...` Stripe Checkout Session whose displayed
order summary matched exactly ("Silver Plan" + "Printing Bundle" = $115.00). No card was entered
and no charge was made; the test booking was deleted afterward via the admin API.

**Not yet verified**: an actual completed payment end-to-end (would require a real charge or a
configured `STRIPE_WEBHOOK_SECRET` with `stripe trigger`), and the refund path against a real
payment intent. Do this once `STRIPE_WEBHOOK_SECRET` is set.
