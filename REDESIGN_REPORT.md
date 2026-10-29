# Workspace Junction full UI/UX redesign

Status: IN PROGRESS. User explicitly rejected the old visual design and requested parallel professional redesign work across the complete platform, especially Spaces & Services.

## Ownership
Parent Bp3hMiS9MO2nYhPB owns the canonical lock. Hourly continuation is temporarily paused to prevent competing edits/builds. Prior audit scope remains valid, but its old visual baseline is superseded by this user-requested redesign. No live WordPress changes, DB seeding, payments, or external submissions.

## Workstreams
- Shared public design system, header, grouped service navigation, mobile navigation, footer.
- Complete photo-led homepage with service discovery and preserved source disclosure.
- All inner templates: services, industry/directory, company/community, contact/workflows, editorial/archive/taxonomy.
- Admin dashboard, navigation, tables, forms, media and responsive UI.
- Parent integration: pricing cards, inquiry dialogs/forms, 404, policy page, full regression and visual review.

## Design direction
Deep forest, warm off-white and restrained amber; clean sans typography, deliberate spacing, relevant source photography, responsive structured layouts. No fabricated stats, reviews, capacities or availability. Existing CMS, auth, forms, metadata, pricing exclusions and server-side sanitization must remain intact.

## Verification
Pending integrated production build, source-content preservation tests, automated functional tests, route/viewport/accessibility checks, manual screenshot review and fixes. Early syntax checks alone are not acceptance. Original source backups: parent session tmp/redesign-before.

## Open integration work
The first service template still exposed an unstructured long source wall, duplicate content and conflicting raw legacy prices. A second structural pass is underway to present meaningful current overview/features/plans first while retaining sanitized source copy as clearly distinguished reference material. This is not a new claim that all source copy is irrelevant or duplicate.

## Verification checkpoint 2026-10-28T13:26:36.755Z
Production build1214 passed180 generated pages/TypeScript; lint1209 passed. Safety/source tests20/20 passed1204. Public functional1211 passed19/19 with0 cleanup failures. First full browser173 routes/130links and expanded140 views/9source-preservation/14admin checks had clean route/layout/data results but correctly failed contrast. Featured-card background cascade and faint service index labels corrected in platform-components.css;1216/1217 are repeating full verification on rebuilt CSS. Independent desktop/mobile reviewer found no remaining concrete visual concerns in supplied390px screenshots, limited to visible regions. Do not claim final acceptance until repeat accessibility results return.


## Classic editorial redesign + 3D/GSAP motion layer, 2026-10-28T15:40:16.749Z (session 1kIscunZ7PiSCEOt, direct user request)
Built on the previous redesign (parent was interrupted 13:26 UTC; lock taken over and parent informed).

### Direction
Brand kept: forest ink #132e29 + amber refined to champagne (#d4b67f) on warm ivory (#f5efe3); no pure-white surfaces. Playfair Display (display) + Inter (text) via next/font/google. Guidance used: UI UX Pro Max (palette/type pairing; its Liquid Glass/blur suggestion rejected for performance), Taste Skill motion rules (staggers, expo-out, no layout animation, finished state = reduced-motion state), Vercel guidelines (focus, reduced motion), awesome-design-md/agency-agents read for reference. Framer: not applicable (Next.js project). 21st.dev CLI: installed but requires user login (not used). matter-js and scroll-smooth installed by user but intentionally unused (physics = foreground objects; scroll-smooth duplicates Lenis).

### Files
- app/classic.css (theme tokens, typography, surfaces, ambient CSS, tilt, Lenis, perf/lite rules) imported last in app/layout.tsx (+ fonts, viewport themeColor).
- components/scene-backdrop.tsx: fixed full-viewport three.js world of procedural coworking objects (components/office-models.ts: office chair, desk, podcast mic, laptop, monitor, desk lamp, coffee cup, plant, headphones; merged per material). Camera = GSAP ScrollTrigger scrub over the page, scroll-velocity spin, pointer parallax, objects anchored to viewport edge bands, ivory fog. Adaptive quality governor (DPR -> half-rate -> still) that also switches the page to lite mode.
- components/gsap-motion.tsx: Lenis (@studio-freight/lenis) on gsap.ticker + ScrollTrigger (one loop); progress hairline; SplitText masked heading rises; eyebrow slides; pinned 3D card deal of the service cards (desktop); 3D batch reveals; clip-path photo openings + scrubbed parallax; velocity skew; closing-panel scale-in; footer wordmark chars; magnetic primary buttons. Prose/article content excluded from split/parallax.
- components/ambient.tsx: CSS ambient layer (light pools, dot grid, section contours), MotionController (offscreen pause, tab visibility, card pointer tilt), MotionToggle (accessible pause, persisted, useSyncExternalStore).
- components/site-shell.tsx (mounts the above; amb-local on closing/footer), app/page.tsx (amb-local on creative band + hero aside; content unchanged), package.json (+three, gsap, @types/three dev).

### Verification (actual runs)
- tsc PASS, lint PASS, frontend content-safety tests PASS, production build PASS (180 pages, dist .next-classic; tsconfig/next-env restored after build).
- Playwright regression (dev, API live): 12 routes x 390/768/1440 = 36 views: 0 horizontal overflow, 0 stuck-hidden elements, 0 pure-white large surfaces, 0 broken images, CLS max 0, 1977 controls hit-tested with 0 intercepted by decorative layers, only console errors = expected 404 on /does-not-exist/. Reduced motion: 0 running CSS animations, no Lenis, toggle hidden. Pause toggle: pauses, persists across reload, resumes. Keyboard: first Tab = skip link with visible outline. Booking dialog opens from hero CTA and closes on Escape.
- Scroll FPS (production build, real GPU ANGLE/D3D11, Playwright wheel scroll): desktop 1x 58.4, retina 2x 60, phone 390@2x 60; simulated low-end (4x CPU throttle, 2x DPR) 43.5 fps (was 27.2 before perf fixes), governor stepped 3D to still frame. Headless software-GL default showed ~20fps; not representative of GPU hardware.
- Fixed during QA: pinned deal stuck (from() + refresh) -> explicit fromTo; article overflow/CLS 0.335 from prose figures + split padding -> excluded prose, removed padding; ip-service-nav white bar; tile seam kink in contour SVG; orphan pricing card; featured badge contrast; duplicate CSS breathe vs GSAP parallax on hero image.

### Limitations
- Field performance on real visitor devices not measured; Lighthouse not rerun for this redesign.
- Backend API processes started by tools can expire; start per README in a normal terminal.
- Admin panel not restyled in this pass (only shares fonts).


## Live content + navbar + all pages, 2026-10-28T17:16:42.540Z (session 1kIscunZ7PiSCEOt)
- Palette v2: #D9910B buttons/accents, #D0CFCB canvas; muted-text contrast fixed (axe 0 violations on 14 scans before this step).
- Navbar rebuilt to match live workspacejunction.com: logo | Plans & Pricing pill, phone, search (to /blogs/?q=), Home/About Us/Contact Us, hamburger drawer (all widths); second row service strip with icons (Coworking...Community). Utility bar removed.
- Homepage rebuilt from live homepage content (app/page.tsx, components/home-live.tsx, lib/home-faqs.json): 3-slide hero with live headlines, intro + Think/Build emblem, stats + event space, memberships (API pricing), meeting rooms, Chicagoland Podcast Studio tabs with all 12 live tiers/prices, 13 service cards, 16 live FAQs (+FAQPage JSON-LD). "Trusted by Chicagoans" video testimonials omitted (third-party embeds not migratable).
- All WordPress pages: WP REST (admin session, read-only) confirmed 48 pages/71 posts already migrated with matching modified dates. 35 content pages now render their original Elementor section structure via data/live-pages.json (extracted from data/source-html snapshots + Elementor CSS) and components/live-sections.tsx (+live-tabs.tsx). Booking wizards replaced by the inquiry dialog; utility/checkout pages unchanged.
- Verified: tsc, lint, production build (180 pages); 35 pages x 2 viewports = 70 views: HTTP 200, 0 horizontal overflow, 0 broken images, exactly one h1, 0 console errors.
- No changes were made to WordPress/live site.
