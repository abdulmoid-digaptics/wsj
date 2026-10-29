# Browser QA report

Observed: 2026-10-29T00:09:27.030Z; completed/resumed: 2026-10-29T00:09:27.030Z
Base URL: http://localhost:3000
Data generated: 2026-10-28T01:51:24.409Z

## Scope
- 173 unique routes from data/site.json pages/posts/categories, HTTP concurrency 3.
- 126 unique internal rendered anchor targets checked.
- 6 major routes at widths 320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560; 3 sample blogs at 390px.
- Axe serious/critical checks: home, contact, blogs, admin login.
- Actual headless Chromium via @playwright/test.
- Server mode: development; Lighthouse measured in a separate report.

## Results
- Non-200 data routes: 0
- Non-200 local links: 0
- SEO/H1 missing or multiple: 0
- Horizontal overflow checks failed: 0
- Views with broken images: 0
- Serious/critical axe violations: 0
- Browser page errors: 0

## Exact findings
```json
{
  "badRoutes": [],
  "badLinks": [],
  "badSeo": [],
  "overflow": [],
  "images": [],
  "axe": [],
  "browserErrors": []
}
```

## Proof
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-home-390.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-home-1440.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-coworking-390.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-coworking-1440.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-meeting-rooms-390.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-meeting-rooms-1440.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-contact-us-390.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-contact-us-1440.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-blogs-390.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-blogs-1440.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-admin-390.png`
- `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-admin-1440.png`

Raw results: `C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_RcK3pGfMgdjq8Pm7\tmp\qa-browser-results.json`

## Limits
Screenshots are compact viewport proof, not full-page design approval. No live source actions performed. Admin authenticated flows were separately verified earlier; this run checks login accessibility only.