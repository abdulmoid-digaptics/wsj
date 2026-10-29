'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const commands = {
  typecheck: ['node_modules/typescript/bin/tsc', ['--noEmit']],
  lint: ['node_modules/eslint/bin/eslint.js', ['app', 'components', 'lib']],
  pure: ['scripts/qa/pure-regressions.cjs', []],
  build: ['node_modules/next/dist/bin/next', ['build']],
  api: ['backend/dist/main.js', []],
  backendBuild: ['backend/node_modules/typescript/bin/tsc', ['-p', 'backend/tsconfig.json']],
  generate: ['backend/node_modules/prisma/build/index.js', ['generate', '--schema', 'backend/prisma/schema.prisma']],
  migrate: ['backend/node_modules/prisma/build/index.js', ['migrate', 'deploy', '--schema', 'backend/prisma/schema.prisma']],
};
function timeoutFor(mode, supplied) {
  if (!Object.hasOwn(commands, mode)) throw new Error('Unknown audit mode: ' + mode);
  if (supplied === undefined) return ['pure', 'typecheck', 'lint'].includes(mode) ? 120000 : 0;
  const value = Number(supplied);
  if (!/^\d+$/.test(String(supplied)) || !Number.isSafeInteger(value) || value < 1000 || value > 3600000) {
    throw new Error('QA_TIMEOUT_MS must be an integer between 1000 and 3600000');
  }
  return value;
}
function launch(mode, { env = process.env, spawnChild = spawn, log = console.error } = {}) {
  const timeoutMs = timeoutFor(mode, env.QA_TIMEOUT_MS);
  const [file, args] = commands[mode];
  const childEnv = { ...env };
  if (mode === 'build') childEnv.NEXT_DIST_DIR ||= '.next-audit';
  if (['generate', 'migrate', 'api'].includes(mode)) {
    require(path.join(root, 'backend/node_modules/dotenv')).config({ path: path.join(root, 'backend/.env'), processEnv: childEnv, quiet: true });
  }
  if (mode === 'api') {
    childEnv.DOTENV_CONFIG_PATH = path.join(root, 'backend/.env');
    childEnv.UPLOAD_DIR = path.join(root, 'backend/uploads');
    childEnv.FRONTEND_URLS = [...new Set([...(childEnv.FRONTEND_URLS || '').split(',').filter(Boolean), 'http://localhost:3000', 'http://localhost:3100'])].join(',');
  }
  childEnv.NODE_OPTIONS = [childEnv.NODE_OPTIONS, '--preserve-symlinks', '--preserve-symlinks-main'].filter(Boolean).join(' ');
  const started = Date.now();
  log('[audit] START ' + mode + ' cwd=' + root + ' timeoutMs=' + timeoutMs);
  return new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(root, file), ...args], { cwd: root, stdio: 'inherit', env: childEnv, shell: false });
    let timedOut = false;
    const deadline = timeoutMs ? setTimeout(() => {
      timedOut = true;
      log('[audit] TIMEOUT ' + mode + ' after ' + timeoutMs + 'ms; terminating owned child pid=' + child.pid);
      child.kill('SIGKILL');
    }, timeoutMs) : undefined;
    const heartbeat = setInterval(() => log('[audit] RUNNING ' + mode + ' elapsedMs=' + (Date.now() - started) + ' pid=' + child.pid), 10000);
    const onInt = () => child.kill('SIGINT');
    const onTerm = () => child.kill('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    const cleanup = () => {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
    };
    child.once('error', (error) => {
      cleanup();
      log('[audit] START FAILED ' + mode + ' code=' + (error.code || 'UNKNOWN') + ' ' + error.message);
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      const status = timedOut ? 124 : (code ?? 1);
      log('[audit] END ' + mode + ' exit=' + status + ' signal=' + (signal || 'none') + ' elapsedMs=' + (Date.now() - started));
      resolve(status);
    });
  });
}
if (require.main === module) {
  Promise.resolve().then(() => launch(process.argv[2])).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error('[audit] FAILED: ' + error.message);
    process.exitCode = 1;
  });
}
module.exports = { timeoutFor, launch };
