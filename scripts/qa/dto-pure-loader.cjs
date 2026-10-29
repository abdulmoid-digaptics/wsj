'use strict';
// Narrow in-memory runner for trusted local pure tests. No global require hooks,
// tsx/esbuild services, disk emits, source rewrites, or dependency replacements.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { compileFunction } = require('node:vm');
const root = path.resolve(__dirname, '../..');
const backendRoot = path.join(root, 'backend');
const backendRequire = createRequire(path.join(backendRoot, 'package.json'));
const ts = backendRequire('typescript');
const files = [
  'src/dto.ts',
  'src/errors.ts',
  'test/booking-validation.test.ts',
  'test/dev-startup.test.ts',
  'test/errors.test.ts',
];
const allowed = new Set(files.map((file) => path.join(backendRoot, file)));
function compilerOptions() {
  const configPath = path.join(backendRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, (file) => fs.readFileSync(file, 'utf8'));
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  // Fail closed if the backend config grows inheritance rather than silently
  // running with only part of its production compiler configuration.
  if (config.config.extends) throw new Error('Pure loader requires explicit backend compilerOptions, not extends');
  const parsed = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, backendRoot, configPath);
  if (parsed.errors.length) throw new Error(ts.formatDiagnostics(parsed.errors, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => backendRoot,
    getNewLine: () => '\n',
  }));
  const options = parsed.options;
  if (options.module !== ts.ModuleKind.CommonJS || !options.experimentalDecorators || !options.emitDecoratorMetadata) {
    throw new Error('Pure loader requires the backend CommonJS/decorator/metadata compiler settings');
  }
  return options;
}
function createPureLoader() {
  const options = compilerOptions();
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(filename);
    if (!allowed.has(absolute)) throw new Error('Not an allowlisted pure TypeScript module: ' + absolute);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const source = fs.readFileSync(absolute, 'utf8');
    const result = ts.transpileModule(source, {
      fileName: absolute,
      compilerOptions: options,
      reportDiagnostics: true,
    });
    const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => backendRoot,
      getNewLine: () => '\n',
    }));
    const nativeRequire = createRequire(absolute);
    function localRequire(specifier) {
      if (specifier.startsWith('.')) {
        const candidate = path.resolve(path.dirname(absolute), specifier);
        const typescriptFile = path.extname(candidate) ? candidate : candidate + '.ts';
        if (allowed.has(typescriptFile)) return load(typescriptFile);
        if (path.extname(candidate) === '.ts') throw new Error('Pure TypeScript import outside allowlist: ' + specifier);
      }
      // Real installed validators, metadata, Nest/Prisma classes, node:test and
      // the actual dev supervisor. No mocks or injected validator behaviour.
      return nativeRequire(specifier);
    }
    localRequire.resolve = nativeRequire.resolve;
    localRequire.cache = nativeRequire.cache;
    localRequire.main = require.main;
    const record = { exports: {}, filename: absolute, id: absolute, loaded: false };
    cache.set(absolute, record);
    try {
      const execute = compileFunction(result.outputText, ['exports', 'require', 'module', '__filename', '__dirname'], { filename: absolute });
      execute.call(record.exports, record.exports, localRequire, record, absolute, path.dirname(absolute));
      record.loaded = true;
      return record.exports;
    } catch (error) {
      cache.delete(absolute);
      throw error;
    }
  }
  return { load };
}
module.exports = { createPureLoader };
