# Lighthouse local production report

[
  {
    "name": "home",
    "url": "http://localhost:3100/",
    "time": "2026-10-28T08:04:35.784Z",
    "scores": {
      "performance": 80,
      "accessibility": 100,
      "best-practices": 100,
      "seo": 100
    },
    "lcpMs": 3160.7720000000004,
    "cls": 0.0002495715090171364,
    "tbtMs": 464.6039999999998,
    "errors": null,
    "failedAudits": [
      {
        "id": "first-contentful-paint",
        "title": "First Contentful Paint",
        "score": 0.89,
        "displayValue": "1.8 s"
      },
      {
        "id": "largest-contentful-paint",
        "title": "Largest Contentful Paint",
        "score": 0.73,
        "displayValue": "3.2 s"
      },
      {
        "id": "speed-index",
        "title": "Speed Index",
        "score": 0.99,
        "displayValue": "2.1 s"
      },
      {
        "id": "total-blocking-time",
        "title": "Total Blocking Time",
        "score": 0.61,
        "displayValue": "460 ms"
      },
      {
        "id": "max-potential-fid",
        "title": "Max Potential First Input Delay",
        "score": 0.13,
        "displayValue": "440 ms"
      },
      {
        "id": "interactive",
        "title": "Time to Interactive",
        "score": 0.94,
        "displayValue": "3.2 s"
      },
      {
        "id": "mainthread-work-breakdown",
        "title": "Minimize main-thread work",
        "score": 0,
        "displayValue": "2.1 s"
      },
      {
        "id": "unused-javascript",
        "title": "Reduce unused JavaScript",
        "score": 0,
        "displayValue": "Est savings of 53 KiB"
      },
      {
        "id": "image-delivery-insight",
        "title": "Improve image delivery",
        "score": 0,
        "displayValue": "Est savings of 20 KiB"
      },
      {
        "id": "legacy-javascript-insight",
        "title": "Legacy JavaScript",
        "score": 0.5,
        "displayValue": "Est savings of 14 KiB"
      },
      {
        "id": "network-dependency-tree-insight",
        "title": "Network dependency tree",
        "score": 0
      },
      {
        "id": "render-blocking-insight",
        "title": "Render-blocking requests",
        "score": 0,
        "displayValue": "Est savings of 310 ms"
      }
    ]
  },
  {
    "name": "coworking",
    "url": "http://localhost:3100/coworking/",
    "time": "2026-10-28T08:04:49.172Z",
    "scores": {
      "performance": 87,
      "accessibility": 100,
      "best-practices": 100,
      "seo": 100
    },
    "lcpMs": 3155.76575,
    "cls": 0.0002495715090171364,
    "tbtMs": 283.0000000000002,
    "errors": null,
    "failedAudits": [
      {
        "id": "first-contentful-paint",
        "title": "First Contentful Paint",
        "score": 0.99,
        "displayValue": "1.2 s"
      },
      {
        "id": "largest-contentful-paint",
        "title": "Largest Contentful Paint",
        "score": 0.74,
        "displayValue": "3.2 s"
      },
      {
        "id": "total-blocking-time",
        "title": "Total Blocking Time",
        "score": 0.8,
        "displayValue": "280 ms"
      },
      {
        "id": "max-potential-fid",
        "title": "Max Potential First Input Delay",
        "score": 0.13,
        "displayValue": "440 ms"
      },
      {
        "id": "interactive",
        "title": "Time to Interactive",
        "score": 0.94,
        "displayValue": "3.2 s"
      },
      {
        "id": "mainthread-work-breakdown",
        "title": "Minimize main-thread work",
        "score": 0,
        "displayValue": "2.2 s"
      },
      {
        "id": "unused-javascript",
        "title": "Reduce unused JavaScript",
        "score": 0,
        "displayValue": "Est savings of 97 KiB"
      },
      {
        "id": "bf-cache",
        "title": "Page prevented back/forward cache restoration",
        "score": 0,
        "displayValue": "1 failure reason"
      },
      {
        "id": "forced-reflow-insight",
        "title": "Forced reflow",
        "score": 0
      },
      {
        "id": "image-delivery-insight",
        "title": "Improve image delivery",
        "score": 0.5,
        "displayValue": "Est savings of 24 KiB"
      },
      {
        "id": "legacy-javascript-insight",
        "title": "Legacy JavaScript",
        "score": 0,
        "displayValue": "Est savings of 14 KiB"
      },
      {
        "id": "render-blocking-insight",
        "title": "Render-blocking requests",
        "score": 0,
        "displayValue": "Est savings of 40 ms"
      }
    ]
  }
]

Default Lighthouse simulated mobile lab settings. Two local page samples only, not field INP or real-device proof. Local CPU/network/storage and cache affect scores. No live-site writes performed.

## Genuine server-shell/client-header experiment, 2026-10-28T08:42:45.196Z
A distinct actual server-shell/footer + isolated client-header refactor was built and measured, not merely Suspense. Invalid initial attempts with expired API/frontend processes were excluded. With healthy API and full source-home/pricing present: unchanged baseline home88/LCP2.836s/TBT322ms, coworking95/LCP2.273s/TBT201.5ms; candidate home84/LCP3.012s/TBT425.646ms, coworking94/LCP2.341s/TBT226.356ms. Both sampled pages had100 accessibility/best-practices/SEO. Candidate did not improve results and was REVERTED exactly; no SiteHeader file remains. Earlier full frozen regression remains the accepted functional evidence, not this rejected candidate. These later baseline measurements illustrate local variance; they do not meet homepage90+/LCP2.5s and do not replace the earlier frozen final measurements by selecting a best score. Source-inspection tab was closed before both measurements; no live writes. Experiment raw evidence is in parent session tmp/islands-before and tmp/islands-after.


## AVIF-first hero experiment, 2026-10-28T09:08:49.419Z
Continuation udLY8vOsJzeoVib2 checked parent/recent children idle, acquired released lock, and tested only local performance. Existing authentic AVIF derivatives are smaller (828px:22626 bytes versus WebP29268), but AVIF-first picture/preload did not demonstrate an LCP benefit. Build1170 passed180 generated pages; original disclosure byte-identical42674 bytes; compiled pricing present. Valid same-origin candidate home83/LCP3.256s/TBT401ms and repeat85/2.947s/TBT404ms; coworking93/2.270s and94/2.267s. Before:home93/2.729s/TBT198ms,coworking95/2.202s. Restored unchanged baseline:home85/3.430s/TBT284ms,coworking94/2.277s/TBT233ms. All valid samples accessibility/best-practices/SEO100; CLS<=0.00025. Unchanged-baseline variance means no causal regression claim or cherry-picked acceptance. Port3101 attempt excluded due CORS console errors.
Candidate REVERTED byte-for-byte; .next-avif removed; next-env/tsconfig restored. No retained product-code edits. TypeScript/lint and frontend safety9/9 passed1178. Frozen full regression remains functional evidence, not a claim of rerun here. Raw reports/traces and summary:C:\Users\Abdul Moid\.aside\u\0\sessions\2026-10-28_udLY8vOsJzeoVib2\tmp\avif-experiment-summary.json.
API previous process expired AFTER all measurement readiness checks passed; restarted1179TTY4000. Baseline .next-qa1176TTY3100. Verify health next run. No DB mutation suites, live writes, payments, external forms/accounts or billing. Still IN PROGRESS for LOCAL mobile LCP; external approvals unchanged. Next:repeated serial same-origin full-content baseline profiling under stable CPU/cache conditions before another critical-paint change. Do not repeat rejected AVIF-first or server-header experiments as untested candidates.
