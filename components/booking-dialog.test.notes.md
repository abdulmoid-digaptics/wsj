# Booking dialog catalog-fetch regression (manually verified)

`scripts/qa/layout-audit.cjs` and `public-functional.cjs` are the appropriate
places for a browser-level regression of this fix (component-level React
effect behavior isn't reachable from the pure Node test loader used
elsewhere in this project). Documented here instead of skipped silently:

**Bug**: the catalog-fetch `useEffect` set `catalogError = true` in its
`.catch()` for *any* rejected fetch, including an intentionally aborted one.
React's development-mode double-invoke of effects (mount → cleanup → mount)
made the *first* effect's `AbortController` abort its own in-flight fetch,
which the `.catch()` treated as a real failure — even though the *second*
invocation's fetch then succeeded and set valid catalog data. The error
banner stayed visible forever despite a fully loaded catalog.

**Fix**: ignore `AbortError` in the catch handler, and explicitly clear
`catalogError` on a successful response, so the error state always reflects
the most recent completed request, not a stale aborted one.

**Verified live** (2026-10-29): opened the booking dialog in a real browser
against the running dev server before and after the fix. Before: "Pricing is
temporarily unavailable" banner shown despite a 200 response landing in
`window.__fetchLog` moments later. After: banner absent, live catalog prices
rendered correctly through to a real Stripe Checkout Session (`cs_live_...`)
showing the exact expected line items and total ($115.00 for Silver + Printing
Bundle). The test booking and its `PENDING` database record were created,
inspected via the admin API, and deleted; no payment was completed.


## Calendar oversized + vertical scroll swallowed (manually verified, 2026-10-29)

**Bug 1 — oversized cells**: `.bk-cal-grid{grid-template-columns:repeat(7,1fr)}` had no
`max-width`, so on a wide modal (desktop) the grid stretched to the container's full width.
Combined with `.bk-cal-day{aspect-ratio:1}`, each day cell grew to match: measured **84.7×84.7px**
per cell (should be ~44-48px), making the calendar consume most of the dialog's vertical space.

**Bug 2 — vertical scroll didn't work over the calendar**: `.bk-cal-scroll` (the horizontal-only
date-scroll wrapper) used the `overscroll-behavior: contain` **shorthand**, which contains both
axes. Since this element never scrolls vertically itself, a vertical wheel gesture over it had
nowhere to go and the shorthand prevented it from chaining up to `.bk-body` (the actual vertical
scroll container) — and because the oversized calendar covered nearly the whole visible dialog,
there was barely any non-calendar area left to scroll from instead.

**Fix**: capped `.bk-cal-grid` to `max-width:364px` (kept `min-width:308px` for the narrow-phone
horizontal-scroll fallback) and capped `.bk-cal-day` to `max-width:48px`/`max-height:48px` (kept
the 44px floor); changed `.bk-cal-scroll` to `overscroll-behavior-x: contain` (axis-specific, not
the shorthand) so unhandled vertical input bubbles to the parent scroller.

**Verified live**: day cells now measure exactly 48×48px on desktop and 44×44px on a 390px phone
(global 44px floor, horizontal date-scroll still present as designed). At a constrained 650px
viewport height, the dialog body genuinely overflows (506px content vs 365px visible) and a real
mouse-wheel scroll performed with the cursor directly over the calendar grid moved `scrollTop`
from 0 to 141px — confirming scroll works in the exact spot it was previously swallowed.
