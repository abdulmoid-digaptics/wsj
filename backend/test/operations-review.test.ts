import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
// Offline only: existing local parser, no application imports or subprocesses.
const require = createRequire(import.meta.url);
const yaml = require('../../node_modules/js-yaml');
const read = (name: string) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const docker = read('backend/Dockerfile');
const compose = yaml.load(read('docker-compose.yml'));
const api = compose.services.api;
const pg = compose.services.postgres;

test('runtime is non-root and starts node without migrations or network installers', () => {
  const runtime = docker.split('AS runtime')[1];
  assert.ok(runtime);
  assert.match(runtime, /USER node/);
  assert.match(runtime, /CMD \["node", "dist\/main.js"\]/);
  assert.doesNotMatch(runtime, /(?:npx|migrate deploy|db:seed)/);
  assert.match(runtime, /chown node:node \/app\/uploads/);
  assert.match(docker, /npm prune --omit=dev/);
  assert.match(docker, /apk add --no-cache openssl/);
});
test('environment is pinned and secrets fail closed without bulk env injection', () => {
  assert.equal(api.environment.NODE_ENV, 'production');
  assert.equal(api.environment.PORT, '4000');
  assert.equal(api.environment.UPLOAD_DIR, '/app/uploads');
  assert.equal(api.environment.SWAGGER_ENABLED, 'false');
  assert.match(api.environment.DATABASE_URL, /DOCKER_DATABASE_URL:\?/);
  assert.match(api.environment.JWT_SECRET, /JWT_SECRET:\?/);
  assert.equal(api.env_file, undefined);
  assert.equal(pg.env_file, undefined);
  assert.deepEqual(Object.keys(pg.environment).sort(), ['POSTGRES_DB','POSTGRES_PASSWORD','POSTGRES_USER']);
  assert.equal(api.environment.ADMIN_PASSWORD, undefined);
});
test('database readiness uses container env and API healthcheck is bounded', () => {
  assert.ok(pg.healthcheck.test[1].includes('$$POSTGRES_USER'));
  assert.ok(pg.healthcheck.test[1].includes('$$POSTGRES_DB'));
  assert.match(docker, /HEALTHCHECK --interval=30s --timeout=5s/);
  assert.match(docker, /AbortSignal.timeout\(4000\)/);
  assert.match(docker, /\/api\/health/);
});
test('loopback publishing and original durable named volumes are preserved', () => {
  assert.deepEqual(api.ports, ['127.0.0.1:4000:4000']);
  assert.deepEqual(pg.ports, ['127.0.0.1:5437:5432']);
  assert.ok(api.volumes.includes('wsj_uploads:/app/uploads'));
  assert.ok(pg.volumes.includes('wsj_postgres:/var/lib/postgresql/data'));
  assert.deepEqual(Object.keys(compose.volumes).sort(), ['wsj_postgres','wsj_uploads']);
  assert.equal(api.build.target, 'runtime');
  assert.equal(api.build.context, './backend');
});
test('runtime restricts privileges and writes while keeping graceful shutdown', () => {
  assert.equal(api.read_only, true);
  assert.equal(api.init, true);
  assert.deepEqual(api.cap_drop, ['ALL']);
  assert.deepEqual(api.security_opt, ['no-new-privileges:true']);
  assert.match(api.tmpfs[0], /size=64m/);
  assert.equal(api.stop_grace_period, '30s');
});
test('logs are bounded and SMTP remains opt-in', () => {
  for (const service of [pg, api]) {
    assert.equal(service.logging.options['max-size'], '10m');
    assert.equal(service.logging.options['max-file'], '3');
  }
  for (const key of ['SMTP_HOST','SMTP_FROM','INQUIRY_TO']) assert.equal(api.environment[key], '$' + '{' + key + ':-}');
});
test('context excludes secrets, mutable storage and common backups', () => {
  const ignore = read('backend/.dockerignore').split(/\r?\n/);
  for (const pattern of ['node_modules','dist','.env','.env.*','uploads','*.key','*.pem','*.dump','backups']) assert.ok(ignore.includes(pattern), pattern);
});
test('runbook marks operational checks and recovery as unverified', () => {
  const book = read('OPERATIONS_RUNBOOK.md');
  for (const text of ['API398-case20x','No backup command ran','[blocked]','DOCKER_DATABASE_URL','Existing named volumes','single-process memory']) assert.ok(book.includes(text), text);
});
