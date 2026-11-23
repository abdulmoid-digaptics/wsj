# Live: https://workspacejunction.com/thanks-giving/

Hosting: GoDaddy cPanel (account `bffolbzssrkm`, server p3plzcpnl508660). WordPress serves the site root, and this folder sits beside it:
`/home/bffolbzssrkm/public_html/workspacejunction.com/thanks-giving/`

## Pages (clean URLs)
| URL | Page |
|---|---|
| /thanks-giving/ | All offers |
| /thanks-giving/podcast-studio | Podcast Studio |
| /thanks-giving/conference-room | Conference Room |
| /thanks-giving/boardroom | Boardroom |
| /thanks-giving/dedicated-desk | Dedicated Desk |
| /thanks-giving/mailbox | Business Mailbox |
| /thanks-giving/checkout-complete | Stripe return page (noindex) |

Old `*.html` links 301-redirect to the clean URLs.

## How it works here
- The host has no Node.js, so the checkout API is a PHP port of `landing-pages/server` with the same endpoints and rules: `api/index.php` plus `private/lib.php`.
- `private/` (config with LIVE keys, code, `data/orders.jsonl`, `data/app.log`) is blocked by `.htaccess` (403).
- **Stripe:** LIVE keys for the Workspace Junction account. The webhook `we_1UePkTL9Lo8sCX6twUdyzsOI` goes to `/thanks-giving/api/webhooks/stripe` with 4 checkout.session events. The main app's webhook is separate and untouched.
- **Email:** the host blocks outbound SMTP, and its own mail server isn't authenticated for workspacejunction.com (no SPF), so Gmail rejects that mail. Emails are therefore sent through the Google Apps Script **"WJ Thanksgiving Mail Relay"** under moid.officework@gmail.com (HTTPS, shared secret). The sender is moid.officework@gmail.com, the same as the main app. Gmail's limit is about 100 recipients per day. Team notifications go to **nabeel@digaptics.com** and moid.officework@gmail.com. **Customers receive no emails from the site** (`customer_emails => false`): the team sends confirmations and receipts manually. Keep Stripe's customer receipt emails off (Dashboard > Settings > Customer emails) to match.

## Update the live site
```powershell
cd landing-pages
node cpanel\build.mjs          # -> dist\thanks-giving\ + dist\thanks-giving-config.php (secrets, never commit)
```
Upload the changed files with cPanel File Manager into `public_html/workspacejunction.com/thanks-giving/`, or zip `dist\thanks-giving\*`, upload it, then Extract. Upload `dist\thanks-giving-config.php` as `private/config.php` only when keys change. Keep files at 0644.

## Checks
- https://workspacejunction.com/thanks-giving/api/health should show `"mode":"live","webhook":true`
- Orders and logs: File Manager > `thanks-giving/private/data/` (`orders.jsonl`, `app.log`)
- Stripe Dashboard > Developers > Webhooks > the `/thanks-giving/` endpoint should show 200 deliveries.

## Take it offline
Rename the `thanks-giving` folder in File Manager. WordPress isn't affected.
