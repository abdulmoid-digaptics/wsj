# Go live: https://wp.workspacejunction.com/offers/

Target: Hostinger VPS **72.61.0.11** (the same server as the main app). nginx already sends `/` to Next.js (3600) and `/api/` to the backend (4000). The landing pages run as one more PM2 app on **127.0.0.1:4310**, served at `/offers/`.

Already prepared on this PC:
- `server/.env.production`: **LIVE** Stripe keys (Workspace Junction account `acct_1T4TkEL9Lo8sCX6t`), Gmail SMTP, team notifications to devteam@digaptics.com and moid.officework@gmail.com, customer confirmations enabled. It is gitignored. Upload it separately and never commit it.
- SEO URLs (canonical, Open Graph, JSON-LD, sitemap, robots) point at `https://wp.workspacejunction.com/offers/`.
- Live mode checked: Stripe accepted a live one-time session and a live subscription session with these exact settings. Both were expired immediately and nothing was charged.

## 1. Upload (from this PC, PowerShell)
```powershell
cd "C:\Users\Abdul Moid\Desktop\wsjNext\wsj"
scp .\landing-pages\dist\wj-landing-pages-deploy.zip root@72.61.0.11:/root/
scp .\landing-pages\server\.env.production root@72.61.0.11:/root/wj-landing.env
```

## 2. Install on the VPS
```bash
ssh root@72.61.0.11
node -v                                   # must be 20.6 or newer
mkdir -p /var/www/wj-landing-pages && cd /var/www/wj-landing-pages
# Replace the old version (keeps server/data, the order log)
find . -mindepth 1 -maxdepth 1 ! -name server -exec rm -rf {} +
find server -mindepth 1 -maxdepth 1 ! -name data ! -name .env -exec rm -rf {} + 2>/dev/null || true
unzip -o /root/wj-landing-pages-deploy.zip -d /var/www/wj-landing-pages
mv /root/wj-landing.env server/.env && chmod 600 server/.env
mkdir -p server/data server/logs && chmod 700 server/data
cd server && node --test test/*.test.mjs   # expect: pass 14, fail 0
```

## 3. Live Stripe webhook (creates its own endpoint; the main app's webhook is untouched)
```bash
cd /var/www/wj-landing-pages/server
node scripts/setup-webhook.mjs
# -> [LIVE] Created webhook we_... -> https://wp.workspacejunction.com/offers/api/webhooks/stripe
#    and writes STRIPE_WEBHOOK_SECRET into server/.env
```

## 4. Start with PM2
```bash
cd /var/www/wj-landing-pages/server
pm2 start ecosystem.config.cjs && pm2 save
curl -s http://127.0.0.1:4310/api/health
# {"ok":true,"stripe":true,"mode":"live","webhook":true,"mail":true}
```
The server refuses to start in production if a key or the webhook secret is missing, if test and live keys are mixed, or if `PUBLIC_URL` is not https. Check `pm2 logs wj-landing-pages`.

## 5. nginx
Find the wp.workspacejunction.com config: `grep -l "wp.workspacejunction.com" /etc/nginx/sites-enabled/*`. Add this inside its `server { listen 443 ... }` block, next to the existing `location /` and `location /api/`:
```nginx
location = /offers { return 301 /offers/; }
location /offers/ {
    proxy_pass http://127.0.0.1:4310/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
    client_max_body_size 1m;
}
```
```bash
cp /etc/nginx/sites-enabled/<file> /root/nginx-backup-$(date +%F).conf
nginx -t && systemctl reload nginx
curl -sI https://wp.workspacejunction.com/offers/ | head -1          # HTTP/2 200
curl -s https://wp.workspacejunction.com/offers/api/health
```

## 6. Final checks (real browser)
1. Open https://wp.workspacejunction.com/offers/ and every offer page.
2. Book a Tour on any page. devteam@digaptics.com and moid.officework@gmail.com should get "[Landing] New tour request".
3. Optional real-money test: buy the cheapest item (Mailbox $25) with your own card, check the "PAID" email and Stripe Dashboard > Payments, then refund it in the Dashboard and cancel the subscription.
4. Stripe Dashboard > Developers > Webhooks > the `/offers/` endpoint should show successful (200) deliveries.
5. Turn on receipts: Dashboard > Settings > Customer emails > Successful payments.

## Updating later
Re-upload the zip, repeat step 2 (it keeps `server/.env` and `server/data`), then `pm2 restart wj-landing-pages`.

## Rollback
`pm2 stop wj-landing-pages`, remove the `/offers/` block from nginx, then `nginx -t && systemctl reload nginx`. The main site is not affected at any point.
