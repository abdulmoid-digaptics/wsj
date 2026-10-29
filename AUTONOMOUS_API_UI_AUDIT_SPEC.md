# Autonomous Master Execution Directive: Full API Audit, Multi-Scenario 20x Stress Testing, and Complete UI/UX Responsive Remediation

You are an autonomous senior full-stack engineer and QA architect. Your working directory is:
`C:\Users\Abdul Moid\Desktop\wsjNext\wsj`

This project consists of:
- Frontend: Next.js 16.4 (App Router, React 19, Tailwind CSS 4, Radix UI, Lenis, Motion, GSAP)
- Backend: NestJS 11 (`backend/`), Prisma 6, PostgreSQL, Docker Compose, Nodemailer, Throttler

## Core Operational Rules
1. Autonomous loop mode: You must work continuously without stopping to ask questions. You are operating while the user is away. Do not ask for user confirmation.
2. Self-healing loop: You must audit, diagnose, fix, and re-audit. Repeat this loop until 100% of all checks, tests, and verifications pass with zero errors.
3. Rate limit / quota handling: If any API rate limit, CLI timeout, or token quota threshold is encountered, sleep / back off with a retry loop (e.g. 60 seconds interval), check status, and automatically resume execution. Never abort or surrender execution due to temporary limits.
4. Single-phase completion: Do not declare completion until every API scenario passes 20 out of 20 times, and every page and modal is visually and functionally verified across all screen widths.

---

## Phase 1: Environment and Service Health Initialization
1. Verify both the backend and frontend environments:
   - Ensure the database is up (`npm run db:up` or local Postgres on port 5432).
   - Run Prisma migrations and generate client: `npm --prefix backend run prisma:generate` and `npm --prefix backend run db:migrate`.
   - Start the backend server (`npm --prefix backend run start:dev` on port 3001/4000) and frontend server (`npm run dev` on port 3000).
   - Confirm `GET /health` returns `{ "status": "ok" }`.

---

## Phase 2: Complete Backend & Frontend API Audit and Self-Healing Loop
1. Map all API endpoints across `backend/src`:
   - Public resources: `GET /public/:resource` and `GET /public/:resource/:slug` for all valid kinds (`coworking`, `virtual-office`, `dedicated-desk`, `business-address`, `mailbox`, `podcast-packages`, `meeting-rooms`, `events-space`, `photo-studio`, `llc-services`, `workshops`, `webinars`, `memberships`, `pages`, `services`, `pricing`, `blog`, `categories`, `tags`, `popups`, `settings`).
   - Booking and inquiry submissions: `POST /inquiries`, `POST /popup-events`, and booking endpoints.
   - Admin authentication, CRUD, and media upload controllers.
2. Fix all route discrepancies:
   - Verify CORS, origins, response headers, status codes, and input validation schemas (DTOs).
   - Eliminate unhandled promise rejections, missing database relationships, schema mismatches, and invalid JSON serialization.
   - If an endpoint fails or returns 500, trace the backend error log, patch the controller/service/Prisma query, recompile, and re-test.
3. The Audit-Fix-Loop:
   - Audit all endpoints -> Identify failures -> Apply targeted code fixes -> Re-audit all endpoints.
   - Continue looping until all endpoints return correct status codes (200, 201, or valid 400/404 for invalid inputs) with valid payloads.

---

## Phase 3: Exhaustive 20x Scenario Stress Testing
1. Create and execute an automated test runner script that hits every endpoint across all scenarios:
   - Happy paths (valid payloads, standard queries, pagination filters).
   - Boundary tests (empty strings, maximum length payloads, unicode characters, extreme pagination values).
   - Malformed / attack vectors (SQL injection patterns, script tags, invalid types, oversized bodies, honeypot fields).
   - Throttling and rate limit recovery (verify behavior when rate limits trigger and reset).
2. Requirement: Run every scenario 20 consecutive times for each endpoint.
   - Track results: Total Runs, Passes, Failures, Flaky Failures, Average Latency.
   - Every single scenario must achieve a 20/20 pass rate (100% success).
   - If any endpoint fails on run 14 or 19, diagnose the root cause, patch the code, and restart the 20-run cycle for that endpoint until 20 consecutive passes are achieved.

---

## Phase 4: Page-by-Page Visual, Layout, and Scroll Remediation
Audit every page route individually:
- Home: `/` (`app/page.tsx`)
- Static pages: `/terms-and-privacy`
- Admin portal: `/admin` and sub-dashboards
- Dynamic service pages: `/[...slug]` for all seeded slugs and services

For each page, inspect and fix the following issues:
1. Card Sizing and Grid Layouts:
   - Ensure all cards within pricing grids, service listings, feature matrices, and blogs have unified heights, proper flex/grid alignment, and equal padding.
   - Fix card overflow: prevent badges, prices, tags, or buttons from overflowing their parent boundaries.
2. Text Overlapping and Truncation:
   - Check headers, hero sections, badges, and pricing numbers across all viewports to ensure no overlapping text or clipping occurs.
   - Ensure long titles wrap gracefully without breaking surrounding element alignment.
3. Scroll Mechanics:
   - Diagnose Lenis smooth scrolling conflicts with native document scroll, body locks, and sticky headers.
   - Eliminate double scrollbars and unwanted horizontal scrolling (`overflow-x: hidden` / container constraint fixes).
   - Ensure page anchors and scroll-to-section behaviors land cleanly at target positions without header occlusion.
4. Modal and Popup Scroll Fixes (`components/popup.tsx`, `components/booking-dialog.tsx`):
   - Fix inner scroll inside dialogs: background body scroll must lock cleanly when the modal opens.
   - The modal body must scroll independently with visible, styled scrollbars if content exceeds viewport height.
   - The modal header, title, and close button must stay pinned and visible at all times.
   - Prevent modal content or date/time dropdowns from getting clipped by modal container overflow.
5. Multi-Device Responsiveness Audit:
   - Inspect and verify each page at:
     - Mobile: 375px and 414px
     - Tablet: 768px and 1024px
     - Desktop: 1280px, 1440px, and 1920px
   - Ensure mobile navigation menus open, scroll, and close properly.
   - Ensure touch targets (buttons, inputs, links) are at least 44x44px and never collide.

---

## Phase 5: Build Verification and Final Quality Gate
1. Run static checks and builds:
   - `npm run typecheck` (zero TypeScript errors in frontend and backend).
   - `npm run lint` (zero linting errors).
   - `npm run build` (Next.js production build must succeed with zero errors).
   - `npm --prefix backend run build` (NestJS backend build must succeed with zero errors).
2. Run existing QA suites:
   - `npm run test:api`
   - `npm run test:public`
   - `npm run test:browser`
   - `npm run test:settings`
3. Generate a final audit report summarizing:
   - All audited and fixed endpoints with confirmed 20/20 test passes.
   - All audited and fixed pages with layout, card, scroll, and responsive fixes.
   - Confirmed clean production build status.
