'use strict';
/* Synchronous CommonJS .ts loader for pure test execution in this sandbox.
 * The tsx ESM loader hook stalls here (likely repeated C:\ root realpath
 * probes during its resolution chain); this hook avoids ESM loaders entirely
 * by transpiling with the installed TypeScript compiler and handing Node's
 * ordinary synchronous require() a plain CommonJS string, the same approach
 * already proven fast and correct for in-memory DTO parity checks.
 * Use: node --preserve-symlinks --preserve-symlinks-main -r ./scripts/qa/ts-register.cjs <file>.test.ts
 */
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const ROOT = path.resolve(__dirname, '../..');
const backendRequire = createRequire(path.join(ROOT, 'backend/package.json'));
const ts = backendRequire('typescript');
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  skipLibCheck: true,
  strict: false,
};
require.extensions['.ts'] = function tsLoader(mod, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions, fileName: filename});
  mod._compile(outputText, filename);
};
