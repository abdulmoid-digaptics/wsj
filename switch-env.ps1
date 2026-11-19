# ============================================
# Workspace Junction Environment Switcher
# ============================================
# Safely switch between production and development environments

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("main", "testing")]
    [string]$Environment
)

$ErrorActionPreference = "Stop"

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "WSJ Environment Switcher" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Get current git branch
try {
    $currentBranch = git branch --show-current
} catch {
    Write-Error "Not in a git repository or git is not installed"
    exit 1
}

Write-Host "Current git branch: $currentBranch" -ForegroundColor Yellow

# Warn if switching to environment that doesn't match current branch
if ($Environment -eq "main" -and $currentBranch -ne "main") {
    Write-Host "⚠️  WARNING: You're on branch '$currentBranch' but switching to PRODUCTION environment" -ForegroundColor Red
    $confirm = Read-Host "Are you sure? This will use LIVE Stripe keys. (yes/no)"
    if ($confirm -ne "yes") {
        Write-Host "Cancelled." -ForegroundColor Yellow
        exit 0
    }
}

# Check if template file exists
$templateFile = "backend\.env.$Environment"
if (-not (Test-Path $templateFile)) {
    Write-Error "Template file not found: $templateFile"
    exit 1
}

# Backup current .env if it exists
if (Test-Path "backend\.env") {
    $backupFile = "backend\.env.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Host "Backing up current .env to: $backupFile" -ForegroundColor Gray
    Copy-Item "backend\.env" $backupFile
}

# Copy template to .env
Write-Host "Copying $templateFile to backend\.env" -ForegroundColor Green
Copy-Item $templateFile "backend\.env" -Force

# Verify the keys in the new .env
Write-Host ""
Write-Host "New environment configuration:" -ForegroundColor Cyan
$stripeKeys = Get-Content "backend\.env" | Select-String "^STRIPE"
foreach ($line in $stripeKeys) {
    if ($line -like "*pk_live_*" -or $line -like "*sk_live_*") {
        Write-Host "  Stripe key: LIVE (value hidden)" -ForegroundColor Red
        Write-Host "  ⚠️  LIVE KEY - Real charges will occur!" -ForegroundColor Red
    } elseif ($line -like "*pk_test_*" -or $line -like "*sk_test_*") {
        Write-Host "  Stripe key: TEST (value hidden)" -ForegroundColor Green
        Write-Host "  ✅ Test key - Safe for development" -ForegroundColor Green
    } else {
        Write-Host "  Stripe key: unconfigured or placeholder (value hidden)" -ForegroundColor Yellow
    }
}

# Check if secret key needs to be filled in
$needsKey = Get-Content "backend\.env" | Select-String "PASTE_.*_HERE"
if ($needsKey) {
    Write-Host ""
    Write-Host "⚠️  ACTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "Some keys need to be filled in manually:" -ForegroundColor Yellow
    foreach ($line in $needsKey) {
        Write-Host "  $line" -ForegroundColor Yellow
    }
    Write-Host "Edit backend\.env and replace placeholder values" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ Environment switched to: $Environment" -ForegroundColor Green
Write-Host ""

# Show Stripe test card reminder for testing environment
if ($Environment -eq "testing") {
    Write-Host "Stripe Test Cards:" -ForegroundColor Cyan
    Write-Host "  Success:     4242 4242 4242 4242" -ForegroundColor Green
    Write-Host "  Decline:     4000 0000 0000 0002" -ForegroundColor Red
    Write-Host "  3D Secure:   4000 0027 6000 3184" -ForegroundColor Yellow
    Write-Host "  (Use any future date and any 3-digit CVC)" -ForegroundColor Gray
}

Write-Host ""
