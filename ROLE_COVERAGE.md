# Professional role coverage

Prepared 2026-10-29T12:50:11.853Z. Every requested role is represented below as a perspective grouped into ten specialist streams. This is not 190 actual staff members or independent executions. Only this delegated documentation worker performed this review; other real workers remain owned by the parent. No assertion of being the actual Business Owner, Project Sponsor, lawyer, regulator or authorized approver.

## Method and applicability
- Source roster: AUTONOMOUS_COMPANY_AUDIT_SPEC.md role paragraph. **190 professional roles**, preserving “Governance, Risk and Compliance (GRC) Analyst” as one role despite its embedded comma. Each appears exactly once below.
- Read agency-agents/SKILL.md and selected persona descriptions in references/roster.json: Product Manager, Project Shepherd, Studio Operations, Business Strategist, Change Management Consultant, Financial Analyst, Account Strategist, Support Responder, Compliance Auditor, Legal Compliance Checker and Reality Checker. These inform perspectives only, not approval authority or claims that separate personas ran tests.
- Evidence: inspected package.json/backend/package.json, source inventory and Prisma schema. Implemented Next16.4.3/React19 web + Nest11/Node/Prisma6/PostgreSQL; existing GSAP/Lenis/Three web layer. Native mobile, native desktop, Angular, Vue, Python, Java, .NET, PHP, Go, ML/MLOps and embedded implementations are **not applicable**. No unsupported stack is added.
- Native mobile tester is N/A, but mobile-browser responsiveness, touch and compatibility are applicable. Cloud, microservices, Kubernetes, BI and search specialists have conditional readiness/limited current-system perspectives, not invented deployments or platforms.
- P = applicable perspective, not verified execution or accepted appointment; C = conditional/limited current scope; N/A = unsupported stack. Proposed accountable streams and acceptance gates are in COMPANY_AUDIT_PLAN.md. RTM IDs are in REQUIREMENTS_TRACEABILITY.md.

## Stream scope and inspected evidence
| Stream | Specialist grouping | RTM coverage | Gates | Evidence anchors |
|---|---|---|---|---|
| S1 | Product / BA / client proxy | R01,R23,R25,R28,R31 | G04,G05,G08 | PRICING_REVIEW.md; terms-and-privacy/page.tsx; governing specs |
| S2 | Delivery / PMO / quality governance | R01,R23,R24,R35 | G01,G02,G13,G15 | API_STRESS_AUDIT.md; PROJECT_STATUS.md histories |
| S3 | UX / content / accessibility | R16-R20,R31 | G08,G09 | QA_BROWSER_REPORT.md; booking-dialog.tsx/.css; campaigns.tsx; AUDIT_REPORT.md |
| S4 | Architecture / application / integration | R02-R11,R25 | G01-G04,G11 | package.json; backend/package.json; backend/src; app; components |
| S5 | Data / analytics / migration | R25,R29,R33 | G04,G10,G12,G14 | schema.prisma; data/approved-pricing.json; BACKEND_REPORT.md; business-settings.cjs |
| S6 | Independent QA / performance | R12-R15,R21,R22,R32 | G01-G03,G08,G09 | scripts/qa; API_STRESS_AUDIT.md; PUBLIC_FUNCTIONAL_REPORT.md; TEST_REPORT.md |
| S7 | Platform / release / reliability | R03,R21,R30 | G02,G07 | main.ts; media.ts; BLOCKERS.md; TEST_REPORT.md production steps |
| S8 | Security / privacy / GRC | R07,R09-R11,R26,R29,R30 | G05,G07,G10 | auth.ts; core.ts; schema.prisma; BLOCKERS.md; review policy page |
| S9 | Support / customer success / transition | R27,R28,R36 | G06,G11,G13 | forms.tsx; booking.ts; BLOCKERS.md; README.md; ADMIN_REPORT.md |
| S10 | Commercial / finance / procurement / staffing readiness | R25,R28,R34,R35 | G04,G11,G13 | PRICING_REVIEW.md; BLOCKERS.md; provider/deployment boundaries |

## Exhaustive role mapping

| # | Requested role | Stream | Applicability | Perspective / boundary |
|---|---|---|---|---|
| 1 | Client / Customer Representative | S1 | P | Proxy perspective only: catalogue/entitlement/recurrence and release questions; actual authorized human decision required (G04-G05). |
| 2 | Project Sponsor | S1 | P | Proxy perspective only: catalogue/entitlement/recurrence and release questions; actual authorized human decision required (G04-G05). |
| 3 | Business Owner | S1 | P | Proxy perspective only: catalogue/entitlement/recurrence and release questions; actual authorized human decision required (G04-G05). |
| 4 | Business Stakeholder | S1 | P | Proxy perspective only: catalogue/entitlement/recurrence and release questions; actual authorized human decision required (G04-G05). |
| 5 | Subject Matter Expert (SME) | S1 | P | Proxy perspective only: catalogue/entitlement/recurrence and release questions; actual authorized human decision required (G04-G05). |
| 6 | Account Manager | S10 | P | Demo only implemented CMS/request capabilities; no reservation/payment/entitlement/conversion claims beyond evidence (G04,G11-G13). |
| 7 | Client Relationship Manager | S10 | P | Demo only implemented CMS/request capabilities; no reservation/payment/entitlement/conversion claims beyond evidence (G04,G11-G13). |
| 8 | Sales Manager | S10 | P | Demo only implemented CMS/request capabilities; no reservation/payment/entitlement/conversion claims beyond evidence (G04,G11-G13). |
| 9 | Pre-Sales Consultant | S10 | P | Demo only implemented CMS/request capabilities; no reservation/payment/entitlement/conversion claims beyond evidence (G04,G11-G13). |
| 10 | Business Analyst (BA) | S1 | P | Reconcile service catalogue, request-only outcome and testable acceptance in RTM; no invented business approval (G04). |
| 11 | Requirements Engineer | S1 | P | Reconcile service catalogue, request-only outcome and testable acceptance in RTM; no invented business approval (G04). |
| 12 | Product Manager | S1 | P | Reconcile service catalogue, request-only outcome and testable acceptance in RTM; no invented business approval (G04). |
| 13 | Product Owner | S1 | P | Reconcile service catalogue, request-only outcome and testable acceptance in RTM; no invented business approval (G04). |
| 14 | Project Manager (PM) | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 15 | Program Manager | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 16 | Portfolio Manager | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 17 | Scrum Master | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 18 | Agile Coach | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 19 | Delivery Manager | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 20 | PMO Analyst | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 21 | Project Coordinator | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 22 | Product Operations Manager | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 23 | Resource Manager | S2 | P | Capability and human support/on-call capacity gaps only; no invented headcount, hiring, availability or recruiting action (G13). |
| 24 | Design Lead | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 25 | UX Researcher | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 26 | UX Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 27 | UI Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 28 | Product Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 29 | Interaction Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 30 | Information Architect | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 31 | Wireframe Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 32 | Prototyper | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 33 | Visual Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 34 | Brand Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 35 | UX Writer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 36 | Content Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 37 | Accessibility Specialist | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 38 | Design System Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 39 | Motion Designer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 40 | Chief Technology Officer (CTO) | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 41 | Technical Director | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 42 | Software Architect | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 43 | Solution Architect | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 44 | Enterprise Architect | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 45 | Technical Lead (Tech Lead) | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 46 | Engineering Manager | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 47 | Security Architect | S8 | P | Track auth, input, data handling and legal-review risks; no legal or certification sign-off. |
| 48 | Data Architect | S5 | P | Protect content lineage and DB integrity; define event/price meanings without fabricating ML or sales analytics. |
| 49 | Integration Architect | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 50 | Software Engineer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 51 | Frontend Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 52 | Backend Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 53 | Full-Stack Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 54 | Web Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 55 | React Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 56 | Angular Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 57 | Vue.js Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 58 | Next.js Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 59 | HTML/CSS Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 60 | UI Engineer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 61 | Accessibility Engineer | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 62 | Node.js Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 63 | Python Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 64 | Java Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 65 | .NET Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 66 | PHP Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 67 | Go Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 68 | API Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 69 | Microservices Engineer | S4 | C | Integration boundaries apply, but current Nest application is not evidence of a microservices estate; no decomposition added (G02). |
| 70 | Integration Developer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 71 | Android Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 72 | iOS Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 73 | Flutter Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 74 | React Native Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 75 | Cross-Platform Mobile Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 76 | Desktop Application Developer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 77 | Database Developer | S5 | P | Protect content lineage and DB integrity; define event/price meanings without fabricating ML or sales analytics. |
| 78 | Database Administrator (DBA) | S5 | P | Protect content lineage and DB integrity; define event/price meanings without fabricating ML or sales analytics. |
| 79 | Data Engineer | S5 | C | Protect content lineage and DB integrity; define event/price meanings without fabricating ML or sales analytics. |
| 80 | Analytics Engineer | S5 | C | Define request/event metrics, not unique customers, revenue or settled sales; dashboard is optional scope decision (G12). |
| 81 | Data Scientist | S5 | N/A | No implemented model, training/inference pipeline, feature store or ML operations; do not introduce ML to satisfy a roster. |
| 82 | Machine Learning Engineer | S5 | N/A | No implemented model, training/inference pipeline, feature store or ML operations; do not introduce ML to satisfy a roster. |
| 83 | AI Engineer | S5 | N/A | No implemented model, training/inference pipeline, feature store or ML operations; do not introduce ML to satisfy a roster. |
| 84 | MLOps Engineer | S5 | N/A | No implemented model, training/inference pipeline, feature store or ML operations; do not introduce ML to satisfy a roster. |
| 85 | Business Intelligence (BI) Developer | S5 | C | Define request/event metrics, not unique customers, revenue or settled sales; dashboard is optional scope decision (G12). |
| 86 | Search Engineer | S5 | C | Current title/search/pagination contract, not a new Elasticsearch/vector-search system (G01,G03). |
| 87 | Embedded Systems Engineer | S4 | N/A | Unsupported implementation stack in inspected manifests/source inventory; no new technology or specialist implementation requested. |
| 88 | Software Development Engineer in Test (SDET) | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 89 | Performance Engineer | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 90 | Security Engineer | S8 | P | Track auth, input, data handling and legal-review risks; no legal or certification sign-off. |
| 91 | Developer Experience (DevEx) Engineer | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 92 | Technical Documentation Writer | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 93 | API Documentation Specialist | S4 | P | Evaluate implemented Next/Nest contracts, auth/UI integration and truthful request semantics. |
| 94 | QA Manager | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 95 | QA Lead | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 96 | QA Engineer | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 97 | Manual Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 98 | Manual QA Engineer | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 99 | Test Analyst | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 100 | Test Engineer | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 101 | Test Automation Engineer | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 102 | API Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 103 | UI Automation Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 104 | Mobile App Tester | S6 | N/A | Native/mobile-app testing N/A: no shipped Android/iOS/Flutter/RN app; responsive mobile-web testing remains S3/S6. |
| 105 | Cross-Browser Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 106 | Performance Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 107 | Load Tester | S6 | P | 20x scenario reliability is not production load/capacity certification; performance/stress evidence must state actual workload (G01,G09). |
| 108 | Stress Tester | S6 | P | 20x scenario reliability is not production load/capacity certification; performance/stress evidence must state actual workload (G01,G09). |
| 109 | Security Tester | S8 | P | AppSec scenario/threat review perspective only; no penetration test or production security clearance performed (G01,G07). |
| 110 | Penetration Tester | S8 | P | AppSec scenario/threat review perspective only; no penetration test or production security clearance performed (G01,G07). |
| 111 | Accessibility Tester | S3 | P | Challenge route/card/modal/navigation/content states and keyboard/viewport/motion behavior. |
| 112 | Compatibility Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 113 | Regression Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 114 | Integration Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 115 | System Tester | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 116 | User Acceptance Testing (UAT) Coordinator | S6 | P | Coordinate evidence-backed scripts and genuine human acceptance later; simulated walkthrough cannot sign business UAT (G03,G08). |
| 117 | UAT Tester | S6 | P | Coordinate evidence-backed scripts and genuine human acceptance later; simulated walkthrough cannot sign business UAT (G03,G08). |
| 118 | Test Environment Manager | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 119 | Test Data Engineer | S6 | C | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 120 | Defect / Bug Coordinator | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 121 | Quality Analyst | S6 | P | Challenge fixes with scoped evidence; do not run competing tests or call historical/in-flight evidence acceptance. |
| 122 | DevOps Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 123 | Cloud Engineer | S7 | C | Production architecture/readiness perspective only; no selected/approved cloud account or infrastructure provisioned (G07). |
| 124 | Cloud Architect | S7 | C | Production architecture/readiness perspective only; no selected/approved cloud account or infrastructure provisioned (G07). |
| 125 | Infrastructure Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 126 | Systems Administrator | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 127 | Network Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 128 | Site Reliability Engineer (SRE) | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 129 | Platform Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 130 | CI/CD Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 131 | Build and Release Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 132 | Release Manager | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 133 | Configuration Manager | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 134 | Kubernetes / Container Engineer | S7 | C | Docker Compose local PostgreSQL is applicable; Kubernetes production cluster is N/A/not evidenced and must not be introduced (G07). |
| 135 | Database Reliability Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 136 | Monitoring and Observability Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 137 | Infrastructure Security Engineer | S8 | P | Track auth, input, data handling and legal-review risks; no legal or certification sign-off. |
| 138 | Backup and Disaster Recovery Specialist | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 139 | IT Operations Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 140 | FinOps Specialist | S10 | P | Assumption-labelled delivery/hosting/mail/storage/provider costs and estimate-vs-revenue boundaries; no approved budget or money movement (G13). |
| 141 | Implementation Manager | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 142 | Implementation Consultant | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 143 | Deployment Engineer | S7 | P | Assess actual deployment/storage/build/restore needs; no server/cutover authorization implied. |
| 144 | Release Coordinator | S2 | P | Sequence isolated work and dependency gates; preserve active runner and independent verification. |
| 145 | Migration Specialist | S5 | P | Protect content lineage and DB integrity; define event/price meanings without fabricating ML or sales analytics. |
| 146 | Data Migration Engineer | S5 | P | Protect content lineage and DB integrity; define event/price meanings without fabricating ML or sales analytics. |
| 147 | Technical Writer | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 148 | User Documentation Specialist | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 149 | Training Specialist | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 150 | Change Manager | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 151 | Service Transition Manager | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 152 | Go-Live Coordinator | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 153 | Business Readiness Lead | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 154 | Information Security Manager | S8 | P | Track auth, input, data handling and legal-review risks; no legal or certification sign-off. |
| 155 | Cybersecurity Analyst | S8 | P | Track auth, input, data handling and legal-review risks; no legal or certification sign-off. |
| 156 | Privacy Officer | S8 | P | Data purpose/retention/consent evidence and qualified policy review pending; no legal advice, regulator clearance or certification (G05,G10). |
| 157 | Data Protection Officer | S8 | P | Data purpose/retention/consent evidence and qualified policy review pending; no legal advice, regulator clearance or certification (G05,G10). |
| 158 | Compliance Officer | S8 | P | Data purpose/retention/consent evidence and qualified policy review pending; no legal advice, regulator clearance or certification (G05,G10). |
| 159 | Risk Manager | S8 | P | Track auth, input, data handling and legal-review risks; no legal or certification sign-off. |
| 160 | IT Auditor | S8 | P | Data purpose/retention/consent evidence and qualified policy review pending; no legal advice, regulator clearance or certification (G05,G10). |
| 161 | Governance, Risk and Compliance (GRC) Analyst | S8 | P | Data purpose/retention/consent evidence and qualified policy review pending; no legal advice, regulator clearance or certification (G05,G10). |
| 162 | Identity and Access Management (IAM) Engineer | S8 | P | Track auth, input, data handling and legal-review risks; no legal or certification sign-off. |
| 163 | Business Continuity Specialist | S8 | P | Track auth, input, data handling and legal-review risks; no legal or certification sign-off. |
| 164 | Customer Success Manager (CSM) | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 165 | Customer Support Manager | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 166 | Technical Support Engineer | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 167 | Help Desk / Support Agent | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 168 | Application Support Engineer | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 169 | Production Support Engineer | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 170 | Incident Manager | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 171 | Problem Manager | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 172 | Service Delivery Manager | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 173 | Customer Experience (CX) Specialist | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 174 | Customer Onboarding Specialist | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 175 | Customer Training Specialist | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 176 | Maintenance Engineer | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 177 | Product Analyst | S5 | P | Define request/event metrics, not unique customers, revenue or settled sales; dashboard is optional scope decision (G12). |
| 178 | Feedback / Community Manager | S9 | P | Define operator journey, training, receipt/delivery distinction and incident escalation. |
| 179 | Solutions Consultant | S10 | P | Demo only implemented CMS/request capabilities; no reservation/payment/entitlement/conversion claims beyond evidence (G04,G11-G13). |
| 180 | Estimation Engineer | S10 | P | Assumption-labelled delivery/hosting/mail/storage/provider costs and estimate-vs-revenue boundaries; no approved budget or money movement (G13). |
| 181 | Bid / Proposal Manager | S10 | P | Demo only implemented CMS/request capabilities; no reservation/payment/entitlement/conversion claims beyond evidence (G04,G11-G13). |
| 182 | Project Cost Analyst | S10 | P | Assumption-labelled delivery/hosting/mail/storage/provider costs and estimate-vs-revenue boundaries; no approved budget or money movement (G13). |
| 183 | Finance Manager | S10 | P | Assumption-labelled delivery/hosting/mail/storage/provider costs and estimate-vs-revenue boundaries; no approved budget or money movement (G13). |
| 184 | Procurement Specialist | S10 | P | Provider responsibility, data/exit/SLA/renewal/legal-review checklist only; no account, purchase, agreement or contact (G13). |
| 185 | Vendor Manager | S10 | P | Provider responsibility, data/exit/SLA/renewal/legal-review checklist only; no account, purchase, agreement or contact (G13). |
| 186 | Contract Manager | S10 | P | Provider responsibility, data/exit/SLA/renewal/legal-review checklist only; no account, purchase, agreement or contact (G13). |
| 187 | Staffing Specialist | S2 | P | Capability and human support/on-call capacity gaps only; no invented headcount, hiring, availability or recruiting action (G13). |
| 188 | Recruitment Specialist | S2 | P | Capability and human support/on-call capacity gaps only; no invented headcount, hiring, availability or recruiting action (G13). |
| 189 | End User | S1 | P | Simulated discover-to-request/error journey; no actual beta participant or consent-based user study claimed (G03,G08). |
| 190 | Beta Tester | S1 | P | Simulated discover-to-request/error journey; no actual beta participant or consent-based user study claimed (G03,G08). |

## Coverage reconciliation

- S1: 11 roles.
- S10: 13 roles.
- S2: 14 roles.
- S3: 18 roles.
- S4: 37 roles.
- S8: 15 roles.
- S5: 14 roles.
- S6: 27 roles.
- S9: 24 roles.
- S7: 17 roles.
- Total: 190; unsupported stack roles: 19; missing: 0; duplicates: 0. These counts describe roster assignment, not testing or staff capacity.
- Readiness assignments cover finance/procurement/vendor/contracts/staffing/recruitment/sales/customer-success without spending, accounts, contacts, hiring or legal/business approval.
- Technical streams own implementation/verification only through parent-approved isolated scopes. This worker has written no application code and started no tests, server, build or browser tab.
