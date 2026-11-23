@echo off
rem Starts the Workspace Junction landing pages with Stripe checkout and email.
rem Needs Node.js 20.6+ and landing-pages\server\.env (copy from .env.example).
cd /d "%~dp0server"
if not exist ".env" (
  echo server\.env is missing. Copy server\.env.example to server\.env and fill it in.
  pause
  exit /b 1
)
start "" http://localhost:4310/
node server.mjs
pause
