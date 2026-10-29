# Blockers and integration boundaries

No live workspacejunction.com changes, external accounts, payments, billing renewals or external form submissions were performed. The local app is not the deployed business website.

## Open LOCAL acceptance gap
Final full-content mobile Lighthouse:home80/LCP3.161s and coworking87/LCP3.156s. Accessibility, Best Practices and SEO100 on both; CLS0.00025. The90+/LCP<2.5s targets are not achieved. All final critical functional/regression suites passed. This is not an external credential blocker and the project remains IN PROGRESS. See TEST_REPORT.md and LIGHTHOUSE_REPORT.md. No diagnostic/partial build remains.

## External inputs / approvals
1. **Business-approved legal documents:** the source Terms & Privacy destination does not provide a usable public policy. `/terms-and-privacy/` is an explicitly labeled noindex review disclosure, not invented legal terms. Business must supply/approve privacy/terms before deployment.
2. **SMTP:** no SMTP_HOST is configured. Forms persist locally and report database receipt; no email delivery claim. Need approved SMTP host/port/user/password, SMTP_FROM, INQUIRY_TO, sender-domain authentication and an explicitly approved delivery test. Newsletter saves a subscription request, not an external marketing-list enrollment.
3. **Booking/membership/payment providers:** external source booking links remain available where imported. Local inquiry/review flows are not reservations, membership activation, real availability or paid checkout. No payment adapter is configured or enabled. Third-party credentials and explicit production approval are required for any live provider integration.
4. **Deployment approval/infrastructure:** no production DNS, hosting, TLS, database, uploads, WordPress or billing changes authorized. Supply/review production host, secrets, durable storage, backups/restore and explicit cutover approval. Rotate all local credentials for production.
5. **Field performance:** Lighthouse is lab-only. Real-world INP and actual business-device/network behavior require approved staging/production observation; no field score can be fabricated.

## Review notes, not fabricated completion
- Source price evidence contains conflicting/ambiguous listings;59 curated plans retain their exact evidence and chosen authoritative source in PRICING_REVIEW.md/data/approved-pricing.json. Raw review-required price extracts are suppressed by API and UI. Business should review unresolved source inconsistencies before launch.
- Popup editing is structured configuration with three layouts and predefined CTA/newsletter/inquiry/review forms, not a freeform visual canvas or arbitrary workflow designer.
- Rich migrated article HTML is sanitized and rendered as native lazy content; redesigned hero/card images use Next Image. Original text includes source editorial imperfections, which are preserved rather than silently rewritten.
- Production multi-instance rate limits require shared storage/proxy policy. File type screening is not antivirus; harden uploads/storage/backups for internet-scale production.
- Final local tests/performance status is recorded in TEST_REPORT.md and per-scope reports. Earlier failing report sections are superseded only by explicitly dated reruns, not assumptions.

## Latest local diagnostic 2026-10-28T12:09:26.804Z
Fresh unchanged baseline:home median LCP2.988s (all3 miss2.5s), coworking median2.265s (all3 pass). Browser RenderDocument diagnostic did not improve LCP; no canonical flags changed. Paint-to-presentation gaps merit targeted tracing but do not prove an external browser blocker. Project remains IN PROGRESS, not WAITING_EXTERNAL. See PAINT_PROFILE.md; external inputs above unchanged.
