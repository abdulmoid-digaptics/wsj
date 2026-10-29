# Frontend specialist review

Date: 2026-10-29. Scope: targeted fixes, not a redesign.

## Implemented

- `components/home-live.tsx`: sole stable `h1#hp-title` now sits outside the inactive slide wrappers, using the original “Where Leaders Work.” title. Every authentic slide title, subtitle, image and alternative text remains. Visual slide titles retain the existing treatment; the first duplicate visual title is hidden from assistive technology only.
- Carousel: explicit persistent Pause/Resume control; manual slide selection pauses rotation. Separate hover, focus-within and persistent pause states prevent blur/mouseleave from overriding a deliberate pause. Timer checks current reduced-motion preference, document visibility and the existing global ambient pause state before advancing. Removed automatic live-region announcements to avoid repeated unsolicited reading.
- Studio tabs: added Home/End navigation and a focusable panel. Existing labels, capacities, 12 tiers and prices are unchanged.
- `components/site-shell.tsx`: menu isolates sibling page regions using native inert, restores their previous state, freezes body/root scroll with position restoration and scrollbar compensation, and restores trigger focus after isolation is removed. Existing keyboard trapping remains. Booking handoff closes/cleans the menu synchronously before launching the existing booking flow, avoiding overlapping menu/booking locks. Search Escape now restores the search trigger.
- `app/classic.css`: real 44px carousel button boxes with the original thin visual bars; 44px minimums for header controls, studio tabs and footer links; high-contrast carousel focus outlines; normal-flow carousel controls avoid CTA overlap. Header control groups can wrap rather than overflow, phone text can wrap, and mobile logos remain contained. Added menu safe-area/scroll-focus spacing and explicit reduced-motion overrides for hero, drawer and studio panel.
- Footer CMS consumption remains exactly `<span data-business-tagline>{b.tagline}</span>`.
- `app/responsive.css` was inspected but did not need changes because classic.css is imported after it and owns the applicable theme overrides.

## Guidance read

Installed Next.js 16.4.3 Server and Client Components and Accessibility guides, plus project brand/design skills and current Web Interface Guidelines. Browser-only behavior remains in effects/event handlers; no server/client boundary changes.

## Validation evidence

- Direct source invariant checks: PASS for exactly one H1, stable H1 before title slide wrappers, all three original titles/images, all 12 studio tiers, dynamic reduced-motion guard, persistent pause, unchanged CMS tagline expression, reversible menu isolation, synchronous booking handoff and real 44px carousel target rules.
- Targeted ESLint command attempted: `node node_modules/eslint/bin/eslint.js components/home-live.tsx components/site-shell.tsx`. **[blocked]** Node fails before linting with `EPERM: operation not permitted, lstat 'C:\\'`.
- Typecheck attempted: `node node_modules/typescript/bin/tsc --noEmit --incremental false`. **[blocked]** Same pre-execution Node filesystem error; no typecheck pass claimed.
- Pure frontend content regression command attempted: `node --import ./backend/node_modules/tsx/dist/loader.mjs --test scripts/qa/frontend-safety.test.ts`. **[blocked]** Timed out after 30 seconds with no test output; the tool stopped it. No test pass claimed.
- Git status also failed on this sandbox's /dev/null permissions. No user changes were cleared or reset.
- No browser tabs were opened and no runtime/visual acceptance is claimed. Header behavior through 3840px/4K, mobile focus/scroll restoration and assistive-technology output need parent-owned bounded UI spot checks. Such checks are spot checks, not full acceptance.

## Safety and remaining checks

No builds, crawls, performance suites, valid form submissions, fixture writes, deployments, live contacts, or external mutations were performed. Booking-dialog, campaigns and admin files were not edited. Only home-live.tsx, site-shell.tsx, classic.css and this report were written.

Smallest useful follow-up: rerun the three local validation commands in an allowed shell, then spot-check carousel accessibility across all three slides, reduced motion, Pause/Resume, keyboard menu open/trap/Escape/booking handoff, page scroll restoration, and header layout at 320/390/768/1024/1280/1920/3840px without submitting forms. Color contrast beyond the new carousel focus outline and full-site target sizing are outside this bounded pass.
