# Workspace Junction - Landing Pages

A separate static HTML project. It doesn't depend on the Next.js app in the parent folder and isn't imported by it. ESLint for the main app only checks `app`, `components` and `lib`, so this folder is outside it.

## Pages
| File | Offer |
|---|---|
| `index.html` | Hub that links to every offer |
| `podcast-studio.html` | Podcast Studio Thanksgiving Special (from $120/hr, 3-hour minimum) |
| `conference-room.html` | Conference Room, 50% off ($25/hr, 5 hours for $125) plus the full 10-question FAQ |
| `boardroom.html` | Thanksgiving Boardroom Special ($50/hr, 5 prepaid hours for $250) |
| `dedicated-desk.html` | Black Friday Dedicated Desk ($250/month, first 10 members, 12-month term) |
| `mailbox.html` | Black Friday Business Mailbox ($25.00/month, first 50, 12-month contract) |

## Structure
```
assets/css/landing.css   shared styles (WSJ palette from DESIGN.md: #0E3421 / #092317 / #D7902A / #F7F4ED)
assets/js/landing.js     icons, mobile menu, FAQ accordion, scroll reveal, booking modal
assets/img/              copies of the project's own photos and logos (from /public/media)
```

## How it works
- Run the included server (`server/`) to get online payments. It serves these pages and the Stripe checkout API from one Node process.
- You can still open the `.html` files directly or put them on plain static hosting. Without the server, every "Book / Claim" button falls back to an email request to grow@workspacejunction.com.

## SEO
Each page has a title, meta description, keywords, robots, canonical, Open Graph and Twitter tags, a preloaded hero image, and JSON-LD structured data: LocalBusiness, WebPage, BreadcrumbList, Service with Offer prices, and FAQPage on pages with FAQs. `sitemap.xml` and `robots.txt` are in the folder root.

All absolute URLs use the base `https://wp.workspacejunction.com/offers/`. If the pages go live somewhere else, find and replace that string in every `.html` file, `sitemap.xml` and `robots.txt`.

## Stripe checkout (production)

Uses the same pattern as the main Workspace Junction app: **Stripe Embedded Checkout**, prices set on the server, and payment confirmed by a signed webhook.

### Flow
1. The buyer clicks Book / Claim and fills in name, email, phone, preferred date, hours (podcast) or quantity, and accepts the 12-month term for desk and mailbox.
2. The browser sends only a plan id and quantity to `POST /api/checkout`. The server looks up the real price in `server/catalog.mjs`, creates a Checkout Session (`ui_mode: embedded_page`) and returns its client secret.
3. Stripe's payment form opens inside the modal. Card data goes straight to Stripe.
4. Stripe sends the buyer to `checkout-complete.html`, which shows the real result from `GET /api/checkout/status`.
5. Stripe calls `POST /api/webhooks/stripe`. The server checks the signature and records the order in `server/data/orders.jsonl`.

### What is charged
| Plan | Price | Mode |
|---|---|---|
| Podcast Starter / Standard / Premium | $120 / $150 / $199 per hour, 3 to 12 hours | one-time |
| Conference Room 5-hour package | $125 | one-time |
| Boardroom 5-hour package | $250 | one-time |
| Dedicated Desk | $250/month, 12-month commitment, first 10 | subscription |
| Business Mailbox | $25/month, 12-month commitment, first 50 | subscription |

Prices are locked to USD. Promotion codes created in the Stripe Dashboard work automatically ("Add code" in checkout). One-time payments also create a Stripe invoice. Stripe sends receipts when "Successful payments" emails are on (Dashboard > Settings > Customer emails).

### Promo caps
"First 10 desks" and "first 50 mailboxes" are enforced on the server. Paid orders count automatically. A spot is held for 35 minutes while someone is on the payment form. The mailbox progress bar and the desk "N left" line read live numbers from `/api/config`. Use `DESK_CLAIMED_BASE` / `MAILBOX_CLAIMED_BASE` to add spots sold offline.

### Security
- Prices come only from the server. The client never sends an amount.
- Webhooks are HMAC-SHA256 signature-checked with a 5-minute window. Redelivered events are ignored.
- Checkout only accepts requests from allowed origins, is rate limited (10 per 10 minutes per IP), and limits request size.
- Security headers include a CSP that allows only Stripe and Google Fonts, plus HSTS on https.
- `server/`, dotfiles and `.md` files are never served.
- In production the server refuses to start without the secret key, publishable key and webhook secret, with mixed test/live keys, or with a non-https `PUBLIC_URL`.

### Deploy (Hostinger VPS, same setup as the main app)
```bash
# 1. Upload the landing-pages folder, e.g. to /var/www/wj-landing-pages
cd /var/www/wj-landing-pages/server
cp .env.example .env && nano .env      # live keys, PUBLIC_URL, webhook secret
mkdir -p data logs && chmod 700 data
node --test test/*.test.mjs            # 11 tests, needs Node 20.6+
pm2 start ecosystem.config.cjs && pm2 save
curl -s http://127.0.0.1:4310/api/health
```
2. Add the nginx block from `server/nginx.example.conf` (`/offers/` path or its own subdomain), then `nginx -t && systemctl reload nginx`.
3. In Stripe Dashboard > Developers > Webhooks, add the endpoint `https://wp.workspacejunction.com/offers/api/webhooks/stripe` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`, then run `pm2 restart wj-landing-pages`.
4. Back up `server/data/orders.jsonl`. It is the local order log, and the Stripe Dashboard has the full record.

### Local testing
```powershell
cd landing-pages\server
copy .env.example .env    # test keys, NODE_ENV=development, PUBLIC_URL=http://localhost:4310
node server.mjs           # open http://localhost:4310, pay with card 4242 4242 4242 4242
stripe listen --forward-to localhost:4310/api/webhooks/stripe   # optional: real webhooks locally
```

## Email notifications

Sent by the server through the same SMTP account as the main app (`SMTP_*` in `server/.env`). Nothing is stored in the browser, and an email failure never blocks a payment (each send is retried 3 times).

| Event | Team inbox (`NOTIFY_EMAIL`) | Customer |
|---|---|---|
| Enquiry / "Not sure yet" / "Check availability" | New enquiry (reply goes to the customer) | "We got your message" |
| Book a Tour | New tour request | "We got your tour request" |
| Checkout opened | Checkout started (lead details, not paid yet) | - |
| Payment confirmed | PAID with amount, customer, Stripe link | "Your booking is confirmed" |
| Checkout expired / payment failed | Not paid, worth a follow-up | - |

**Testing mode (current local setup):** `NOTIFY_EMAIL=devteam@digaptics.com` and `MAIL_REDIRECT_TO=devteam@digaptics.com`. Every email, including customer confirmations, goes to devteam@digaptics.com. Redirected customer emails have `[TEST to customer@...]` at the start of the subject. **For launch, empty `MAIL_REDIRECT_TO`** and set `NOTIFY_EMAIL` to the real team inbox.

If the server can't send email, enquiry forms fall back to opening the visitor's email app.

## Running locally
Double-click `start-local.cmd`, or run `cd server && node server.mjs`, then open **http://localhost:4310**.
Checkout also works when the pages are opened another way (file, VS Code Live Server, and so on), as long as the server is running. In development the pages find it on port 4310 automatically. Without the server, the buttons fall back to an email request, and the browser console says how to start it.

