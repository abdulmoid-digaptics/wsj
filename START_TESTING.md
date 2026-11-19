# Start Testing Environment - Quick Guide

## What You're Seeing

The booking dialog is showing:
> "Continue to send a reservation request... No payment is taken."

This is the **catalogue fallback mode** - it appears when the backend isn't running and services can't be loaded.

---

## ✅ Fix: Start the Backend

### Option 1: Testing Mode (Safe, No Stripe/Email)
```powershell
# Terminal 1 - Start Backend (safe mode for audits/testing)
cd backend
$env:STRIPE_SECRET_KEY=''; $env:SMTP_HOST=''; node dist/main.js
```

**Note**: This starts the backend with empty Stripe/SMTP keys, which is safe for browsing and testing non-payment features. The booking dialog will load services, but payment won't work until you add the Stripe test key.

### Option 2: Full Testing Mode (With Stripe Test Keys)
```powershell
# First, make sure you've pasted the Stripe test secret key
# Edit: notepad backend\.env.testing
# Find: STRIPE_SECRET_KEY=PASTE_WSJ_TEST_SECRET_KEY_HERE
# Replace with the full key from Stripe dashboard

# Then start backend normally
cd backend
node dist/main.js
```

---

## Expected Behavior

### When Backend is Running ✅
- Booking dialog loads 10+ services from `/api/public/plans`
- You can select services, pick dates/times
- "Continue" button works
- Stripe checkout appears (test mode, safe)

### When Backend is Offline ⚠️ (Current State)
- Booking dialog shows fallback message
- No services list appears
- "Continue" is enabled anyway (sends request mode)
- No payment taken (request goes to contact form)

---

## Full Testing Startup

```powershell
# 1. Switch to testing branch
git checkout testing

# 2. Load test environment
.\switch-env.ps1 testing

# 3. Start PostgreSQL (if not already running)
docker-compose up postgres

# 4. Start Backend (new terminal)
cd backend
node dist/main.js
# Wait for: "NestJS application successfully started on port 4000"

# 5. Start Frontend (new terminal)
npm run dev
# Wait for: "Ready in XXXms"

# 6. Open: http://localhost:3000
```

---

## Verify Backend is Working

```powershell
# Health check
Invoke-WebRequest http://localhost:4000/api/health

# Catalog check (should return 10+ services)
Invoke-WebRequest http://localhost:4000/api/public/plans
```

---

## Why Safe Mode?

Starting with empty Stripe/SMTP keys lets you:
- Browse all pages safely
- Test UI/UX without hitting real APIs
- Run QA scripts without side effects
- Verify catalog loads correctly

Once you confirm the catalog works, restart with full `.env` for payment testing.

---

**Current Issue**: Backend not running → Start it with Option 1 above
