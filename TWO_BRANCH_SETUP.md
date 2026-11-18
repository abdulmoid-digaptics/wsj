# ✅ Two-Branch Setup Complete - Workspace Junction

## Current Status

Your Workspace Junction project now has **two identical copies** (branches) with different environment configurations:

### 📦 Copy 1: `main` Branch (Production)
- ✅ All latest code and optimizations (commit `e7c660b`)
- ✅ Bug fixes, alignment system, Virtual Office image focus
- ✅ Live Stripe keys configured
- ✅ Cloudflare R2 storage configured
- **Ready for VPS deployment**

### 🧪 Copy 2: `testing` Branch (Development)
- ✅ Same codebase as main (commit `e7c660b`)
- ✅ Stripe test publishable key configured
- ⚠️ **Needs**: Stripe test secret key (1 manual step remaining)
- ✅ R2 storage configured (shared with production)
- **Ready for local development after secret key paste**

---

## ⚠️ NEXT STEP: Complete Testing Branch Setup

The testing branch needs the Stripe test secret key. Here's how to add it:

### Step 1: Get the Key from Stripe Dashboard

1. Open: https://dashboard.stripe.com/acct_1UOPyw3jIvGhZYkP/test/apikeys
2. Find the "**wsj test key**" row in the Secret keys table
3. Click the **copy icon** next to `sk_test_...Qhzv`
4. The full key will be copied to your clipboard

### Step 2: Paste into Testing Environment File

```powershell
# Open the testing environment file
notepad backend\.env.testing

# Find this line:
STRIPE_SECRET_KEY=PASTE_WSJ_TEST_SECRET_KEY_HERE

# Replace with the key you copied (should start with sk_test_51...):
STRIPE_SECRET_KEY=sk_test_51UOPyw3j...

# Save and close
```

### Step 3: Activate Testing Environment

```powershell
# Switch to testing branch
git checkout testing

# Load test environment
.\switch-env.ps1 testing

# ✅ You're now ready for development!
```

---

## 🚀 Daily Workflow

### For Development (Testing Branch)
```powershell
git checkout testing
.\switch-env.ps1 testing

# Start services
docker-compose up postgres     # Terminal 1
cd backend; npm start          # Terminal 2  
npm run dev                    # Terminal 3

# Test payments with: 4242 4242 4242 4242
```

### For Production Deploy (Main Branch)
```powershell
git checkout main
.\switch-env.ps1 main

# Build and verify
npm run build
npm run lint
node scripts/qa/release-regressions.cjs

# Deploy to VPS...
```

---

## 🔄 Syncing Code Between Branches

The branches share the same codebase. When you make changes on one:

```powershell
# From main -> testing (keeping test .env):
git checkout testing
git reset --hard main

# From testing -> main (keeping live .env):
git checkout main
git merge testing
```

**Note**: `.env` files are NOT in git, so they stay branch-specific.

---

## 📁 Files Created

| File | Purpose | In Git? |
|------|---------|---------|
| `DEVELOPMENT_WORKFLOW.md` | Complete two-branch guide | ✅ Yes |
| `switch-env.ps1` | Environment switcher script | ✅ Yes |
| `backend/.env.main` | Production environment (live keys) | ❌ No (local only) |
| `backend/.env.testing` | Development environment (test keys) | ❌ No (local only) |
| `backend/.env` | Active environment (auto-managed) | ❌ No |
| `TWO_BRANCH_SETUP.md` | This file | ✅ Yes |

---

## 🔒 Safety Reminders

- **Main branch** = LIVE Stripe keys → Real charges!
- **Testing branch** = TEST Stripe keys → Safe, no real charges
- Always run `.\switch-env.ps1 <branch>` after `git checkout <branch>`
- Verify keys with: `Get-Content backend\.env | Select-String STRIPE`

---

## ✅ What's Done

1. ✅ Virtual Office banner image fixed (face no longer cut off)
2. ✅ All bug fixes and alignment system committed to main
3. ✅ Testing branch synced with same codebase
4. ✅ Environment management system created
5. ✅ Stripe test publishable key extracted and configured
6. ⚠️ **TODO**: Paste Stripe test secret key (see "NEXT STEP" above)

---

**Created**: 2026-11-18  
**Main Branch**: e7c660b (Production ready)  
**Testing Branch**: e7c660b (Needs Stripe secret key)

**Full Documentation**: See `DEVELOPMENT_WORKFLOW.md` for complete workflow guide.
