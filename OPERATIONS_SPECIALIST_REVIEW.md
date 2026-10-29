# Operations specialist readiness review

Date: 29 October 2026. Verdict: NEEDS WORK / NOT A RELEASE APPROVAL.

## Scope and safety

Static DBA, data engineering, DevOps/SRE, cloud/release, migration/recovery, support and FinOps review. API398-case20x was declared active by the requester. No services, Docker commands, image builds, database reads/writes/backups, migrations, seeds, load tests or deployments were executed. No private env values were read or reported. No spending/provisioning/infra approval is implied.

Read the Agency roster skill for specialist review framing. Inspected backend/Dockerfile, docker-compose.yml, backend/.dockerignore, backend/.env.example, package metadata (read-only), backend README and root README, BACKEND_HANDOFF.md, backend/tsconfig.json, src/main.ts/core.ts/public.ts/media.ts/booking.ts/auth.ts/origins.ts, schema.prisma, seed.ts, both committed migration SQL files, migration_lock.toml and the existing dev-startup test style. No Next.js application code was edited, so framework editing guidance was not needed.

## Implemented changes and rationale

1. backend/Dockerfile: replaced root/single-stage shipping of all sources/tooling with build, pruned production-dependency and non-root runtime stages. Runtime contains compiled API, generated client dependencies and package metadata, not source/migration/seed tooling. Installed OpenSSL for Prisma's Alpine engine; actual engine loading remains unverified. Runtime starts node directly, removing automatic migrate deploy and npx execution from every restart. Application startup no longer requires migration privileges or a registry download.
2. backend/Dockerfile: prepared node-owned /app/uploads and fixed default UPLOAD_DIR/PORT; added a bounded Node-based healthcheck against the existing DB-backed /api/health route. Existing volumes may still require approved ownership repair; none was touched.
3. docker-compose.yml: fixed PostgreSQL healthcheck to expand actual container POSTGRES_USER/POSTGRES_DB with escaped dollars instead of hard-coded wsj. Required initialization values fail closed. PostgreSQL no longer receives the entire private backend environment.
4. docker-compose.yml: API environment is explicitly allowlisted and production mode, port, upload path and disabled Swagger are pinned. New required DOCKER_DATABASE_URL separates container networking and encoded credentials from the host-only DATABASE_URL and unsafe raw-password URI construction. Full-profile invocation now needs that privately prepared value. No env files were edited. Existing initialized DB credentials are not rotated by these settings.
5. docker-compose.yml: API host publishing is loopback-only, original named volumes and database loopback binding are preserved. Added init/graceful stop, read-only runtime filesystem, restricted capabilities/no-new-privileges and bounded temporary storage. Both services have bounded local log rotation. No new services or arbitrary resource ceilings were introduced.
6. backend/.dockerignore: preserved source/dependency build requirements while excluding common keys, backup artifacts, logs/generated files and mutable storage. Context is backend; no root .dockerignore was necessary. Patterns are not a comprehensive secret scanner.
7. OPERATIONS_RUNBOOK.md: records explicit release/migration/seed boundaries, backup/isolated restore design, storage ownership caveats, environment changes, TLS/proxy/SMTP/throttling limitations, supply-chain controls, support triage and cost decisions still requiring approval.
8. backend/test/operations-review.test.ts: added eight file-only regression cases with the existing root-local YAML parser. No application imports, subprocesses, network, DB, Docker or environment-secret reads. Do not run the backend wildcard suite during the active run.

No package files, backend src, schema, migrations, QA scripts or existing records were changed by this review.

## Validation evidence

- REPL file reads verified all written operational files and absence of null bytes.
- Fifteen direct static guardrails passed: non-root runtime; direct node startup without migrations; production dependency pruning; image uploads ownership; bounded healthcheck URL; explicit required container DB URI; dynamic PostgreSQL health env; loopback API publishing; preserved original durable mounts; no bulk env injection; restricted read-only runtime; private-context exclusions; bounded logs for both services; explicit unverified recovery wording; absence of null bytes. These are textual/file-level checks, NOT Docker/YAML schema validation, image build or runtime acceptance.
- Exact Node test command was attempted without any backend runtime imports. First shell request timed out after 20 seconds without producing a test result. A second exact-file attempt with existing filesystem compatibility flags remained running without output and was terminated. Therefore the eight-case Node/YAML suite is [blocked], not passed. No exit/result from the timeout was interpreted as success. The command containing git inspection also yielded no diff/status result; no git-clean claim is made.
- No Docker compose config command, package install, vulnerability scan, image registry lookup or app/database probe ran. Shell limitations were not worked around by starting/restarting services.

## Findings and release gates

### High priority

- [blocked] Build/run/Prisma compatibility and non-root volume access are untested. Existing root-owned mounts can fail. Validate only on disposable staging resources after approval; do not chown active storage.
- [blocked] No backup/restore/PITR evidence, RPO/RTO, retention, approved destination or recovery owner exists in inspected config. Database and uploads need consistent recovery. No backup was taken.
- [blocked] TLS proxy/certificate renewal, HTTPS-only production origins and secure-cookie topology are not configured/verified by these files. Local HTTP origin validation remains allowed.
- [blocked] In-memory throttling is not shared and proxy trust is absent. Stay single-instance until reviewed shared throttling and narrow trusted-proxy policy exist. No Redis/cloud service was added or purchased.
- [blocked] SMTP delivery and strict STARTTLS are not verified. Port 587 currently permits opportunistic TLS; port 465 uses implicit TLS. Both inquiries and bookings may send real mail when configured. QA must keep SMTP disabled. No provider test was sent.
- [blocked] Schema history/drift and migration locks were not queried. Separate approved release migrations from app rollout, with least-privileged runtime credentials. Runtime image deliberately lacks migration/seed CLI; old exec-api seed examples no longer apply.

### DBA/data/release observations

Both migration files statically align with current schema structures; no destructive DROP was observed. This is not verification against a running DB. Seed creates missing admin/content but preserves existing rows with empty updates. Root migration data is outside backend build context; container seeding can skip content. No seed/import was run.

JSON publication rules and relation-like IDs lack database enforcement. Media file writes/deletes and database updates are not atomic. Booking monetary values are floating point and public requests supply totals; payment-like columns do not establish a payment provider, accounting correctness, reserved inventory or trusted pricing. These require separate application/schema/business review outside allowed edits.

### Supply chain and FinOps

Existing lockfiles are used by npm ci and runtime dev dependencies are pruned. Base images still float by tag; verified digests, SBOM, signatures/provenance, vulnerability checks and compatibility tests are deferred, not fabricated. Capacity, DB connection budgets, memory/CPU/PID limits, durable storage quotas, off-host backups, centralized log/egress budgets and spend alerts require measured requirements and approval. Log rotation alone is not a cloud cost cap. No autoscaling, retention deletion job, infrastructure purchase or claimed approval was introduced.

## Handoff

Allowed files changed: backend/Dockerfile, docker-compose.yml, backend/.dockerignore, backend/test/operations-review.test.ts, OPERATIONS_RUNBOOK.md and this review. Existing active processes remain untouched by this work. Before any future full-profile application, prepare DOCKER_DATABASE_URL privately and review existing volume ownership. After API398-case20x completes, request explicit isolated staging/build/migration/restore approvals. Until those gates have evidence, production readiness remains unverified.
