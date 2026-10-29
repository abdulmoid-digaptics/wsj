# Public functional browser report

Observed: 2026-10-29T00:13:32.654Z
Frontend: http://localhost:3100; API: http://localhost:4000/api

Real headless Chromium; fresh isolated contexts; no user tabs touched. Script: `node scripts/qa/public-functional.cjs`. Override `QA_BASE_URL`, `QA_API_URL`, `QA_TMP`, `QA_ENV_FILE` as needed. Only localhost targets accepted. SMTP_HOST safety guard refuses sends when configured. Admin credentials read silently; fake@example.invalid only.

- **PASS** SMTP safety guard: SMTP_HOST absent in selected backend env file and test process. Each created inquiry must also return NOT_CONFIGURED.
- **PASS** Mobile menu opens, navigates, closes: 390px mobile navigation reached Meeting Rooms and closed.
- **PASS** Mobile menu includes Contact navigation: Contact link present
- **FAIL** Browser origin API access: CORS allow-origin null does not match http://localhost:3100
- **FAIL** Desktop dropdown keyboard focus and activation: locator.focus: Timeout 7000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: 'Spaces & services' })[22m

- **FAIL** Journal pagination, search, empty results and category: locator.click: Error: strict mode violation: getByRole('button', { name: 'Search', exact: true }) resolved to 2 elements:
    1) <button type="button" class="lv-icon-btn" aria-label="Search" aria-expanded="false" aria-controls="lv-search-form">…</button> aka getByRole('banner').getByRole('button', { name: 'Search' })
    2) <button type="submit" class="icon-btn" aria-label="Search">…</button> aka locator('#main').getByRole('button', { name: 'Search' })

Call log:
[2m  - waiting for getByRole('button', { name: 'Search', exact: true })[22m

- **FAIL** Published pricing service and billing filters match API: The expression evaluated to a falsy value:

  assert.ok(plans.length>0)

- **FAIL** Booking Escape dismissal: locator.click: Timeout 7000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: /Find your space/ }).first()[22m

- **FAIL** Booking choose, validation, review, edit, persisted inquiry and Escape: locator.inputValue: Timeout 7000ms exceeded.
Call log:
[2m  - waiting for getByRole('dialog').getByLabel('I’m interested in *', { exact: true })[22m

- **FAIL** Contact invalid input errors and persisted inquiry: locator.waitFor: Timeout 7000ms exceeded.
Call log:
[2m  - waiting for locator('form.wj-form').first().getByText('Choose a service.', { exact: true }) to be visible[22m

- **BLOCKED** Temporary popup page trigger, targeting, cap, newsletter and persisted events: [blocked] Origin/API readiness check failed; popup mutation refused.
- **BLOCKED** Popup manual trigger, local CTA click and frequency: [blocked] Origin/API readiness failed; popup creation refused.
- **BLOCKED** Created inquiry records independently confirmed: [blocked] Persistence not attempted after origin/API readiness failure.

## Observed partial progress
- Own isolated headless Chromium contexts. Nonlocal browser requests blocked. Fake test identity only. No payment, reservation, email delivery or live source actions tested.
- Uncertain-send cleanup lookup failed: API /admin/inquiries?search=qa-public-1793232812654&limit=100 HTTP 500

API request failures: 12
- http://localhost:4000/api/public/popups: net::ERR_FAILED
- http://localhost:4000/api/public/popups: net::ERR_FAILED
- http://localhost:4000/api/public/popups: net::ERR_FAILED
- http://localhost:4000/api/public/popups: net::ERR_FAILED
- http://localhost:4000/api/popup-events: net::ERR_FAILED
- http://localhost:4000/api/public/popups: net::ERR_FAILED
- http://localhost:4000/api/public/popups: net::ERR_FAILED
- http://localhost:4000/api/popup-events: net::ERR_FAILED

## Cleanup

## Proof
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\public-mobile-contact.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-4.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-5.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-6.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-7.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-8.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-9.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-10.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-11.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-12.png`
- `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\failure-13.png`

Raw measured results: `C:\Users\Abdul Moid\.aside\runtime\tmp\wsj-public-functional\public-functional-results.json`

## Limits
Stable integrated production server tested. Results describe this run only. No Lighthouse, full responsive matrix, live email, payment, confirmed booking, or exhaustive campaign trigger tests. Existing audit records intentionally retained; test inquiries/popups/events removed where indicated. API 429 is reported, never aggressively retried.