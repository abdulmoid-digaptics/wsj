# Workspace Junction - Two-Branch Development Workflow

This project uses a **two-branch workflow** to safely separate production and development environments.

## Branch Strategy

### 📦 `main` Branch - Production Configuration
- **Purpose**: Production-ready code with live credentials
- **Stripe**: Live API keys (`pk_live_...` / `sk_live_...`)
- **R2 Storage**: Production Cloudflare R2 bucket (`workspacejunction`)
- **Database**: Production PostgreSQL configuration
- **Deployment**: Ready for VPS deployment at `wp.workspacejunction.com`

**Current commit**: `e268585` - Bug fixes, alignment system, Virtual Office image focus

### 🧪 `testing` Branch - Development Configuration  
- **Purpose**: Safe local development with test credentials
- **Stripe**: Test API keys from TapGenieus sandbox (`pk_test_...` / `sk_test_...`)
- **R2 Storage**: Same R2 bucket (or can be configured for a separate test bucket)
- **Database**: Local PostgreSQL container
- **Environment**: Localhost development (`:3000` frontend, `:4000` backend)

**Current commit**: `e268585` - Synced with main codebase

## Environment Configuration

Both branches share the **same codebase** but use different `backend/.env` files:

### Main Branch `.env` (Production)
```env
# Production Stripe Keys (LIVE)
STRIPE_PUBLISHABLE_KEY=pk_live_51T4TkEL9Lo8sCX6t...
STRIPE_SECRET_KEY=sk_live_51T4TkEL9Lo8sCX6t...

# Production R2 Storage
R2_ACCOUNT_ID=e1fa8ad7608693fd4f11d2135db28d08
R2_ACCESS_KEY_ID=0161b87a701f06f041fcef561663ac7e
R2_SECRET_ACCESS_KEY=312535227269d8afd4e0c5a52020ca69ddc75d188ad51c627f966e33ef1b7178
R2_BUCKET_NAME=workspacejunction
R2_ENDPOINT=https://e1fa8ad7608693fd4f11d2135db28d08.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://pub-e4b4ffee7e0747098f49cc9765932cee.r2.dev
```

### Testing Branch `.env` (Development)
```env
# Stripe Test Keys from TapGenieus Sandbox
STRIPE_PUBLISHABLE_KEY=pk_test_51...  # ⚠️ NEEDS UPDATING
STRIPE_SECRET_KEY=sk_test_...         # ⚠️ NEEDS UPDATING (wsj test key)

# R2 Storage (same as production, or configure separate test bucket)
R2_ACCOUNT_ID=e1fa8ad7608693fd4f11d2135db28d08
# ... same R2 config ...
```

## Workflow

### Starting Development (Testing Branch)
```powershell
# Switch to testing branch
git checkout testing

# Verify you have test Stripe keys in backend/.env
Get-Content backend\.env | Select-String "STRIPE"
# Should show: pk_test_... and sk_test_...

# Start local development
# Terminal 1: PostgreSQL container
docker-compose up postgres

# Terminal 2: Backend (safe mode: empty STRIPE_SECRET_KEY for audits)
Set-Location backend
$env:STRIPE_SECRET_KEY=''; $env:SMTP_HOST=''; node dist/main.js

# Terminal 3: Frontend
npm run dev
```

### Preparing for Production (Main Branch)
```powershell
# Switch to main branch  
git checkout main

# Verify you have LIVE Stripe keys
Get-Content backend\.env | Select-String "STRIPE"
# Should show: pk_live_... and sk_live_...

# Run production build and tests
npm run build
npm run lint
node scripts/qa/release-regressions.cjs
```

### Syncing Code Changes
When you make changes on one branch and want to sync them to the other:

```powershell
# From main -> testing (keeping test .env)
git checkout testing
git reset --hard main
# The .env file is NOT tracked in git, so it stays as-is

# From testing -> main (keeping live .env)
git checkout main  
git merge testing
# Or cherry-pick specific commits:
git cherry-pick <commit-hash>
```

## Key Files

| File | Tracked in Git? | Branch-Specific? |
|------|-----------------|------------------|
| `backend/.env` | ❌ No | ✅ Yes - Different per branch |
| `frontend/.env.local` | ❌ No | ✅ Yes - Different per branch |
| All code files | ✅ Yes | ❌ No - Synced across branches |

## Safety Checklist

**Before committing:**
- [ ] Never commit `.env` files
- [ ] Never commit credentials in code
- [ ] Verify current branch with `git branch`

**Before deploying:**
- [ ] Ensure you're on `main` branch
- [ ] Verify live Stripe keys are configured
- [ ] Run full regression tests
- [ ] Check R2 configuration is production

**Before testing payments:**
- [ ] Ensure you're on `testing` branch
- [ ] Verify test Stripe keys are active
- [ ] Use Stripe test card numbers only

## Stripe Test Cards

For testing on the `testing` branch:
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0027 6000 3184`

Use any future expiration date and any 3-digit CVC.

## R2 Storage Notes

Both branches currently share the **same R2 bucket** (`workspacejunction`). This is acceptable for development, but consider:

**Option 1 (Current)**: Share the bucket
- Pros: Simple, no duplicate storage costs
- Cons: Test uploads appear in production bucket

**Option 2 (Future)**: Separate test bucket
- Create `workspacejunction-test` R2 bucket
- Update testing branch `.env` with test bucket credentials
- Pros: Complete isolation
- Cons: Requires additional bucket setup

## Next Steps

1. ✅ Main branch configured with production credentials and all optimizations
2. ✅ Testing branch synced with same codebase
3. ⚠️ **TODO**: Update testing branch `backend/.env` with Stripe test keys
4. ⚠️ **TODO**: Create `frontend/.env.local` for both branches if needed
5. ⚠️ **TODO**: Document deployment process from main to VPS

---

**Last Updated**: 2026-11-18  
**Main Commit**: e268585 (Bug fixes, alignment, image focus)  
**Testing Commit**: e268585 (Synced with main)
