import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import ts from 'typescript';
import devSupervisor from '../scripts/dev.cjs';
import auditLauncher from '../../scripts/qa/local-audit-launcher.cjs';

const { compileProgram, createSupervisor } = devSupervisor;

class FakeChild extends EventEmitter {
  signals: string[] = [];
  kill(signal: string) { this.signals.push(signal); return true; }
  finish() { this.emit('close', 0, null); }
}
function fixture() {
  const children: FakeChild[] = [];
  const supervisor = createSupervisor({
    spawnChild: () => { const child = new FakeChild(); children.push(child); return child; },
    log: () => {},
  });
  return { children, supervisor };
}

test('dev compiler does not call emit when full diagnostics contain errors', () => {
  let emitted = false;
  const compiler = { DiagnosticCategory: { Error: 1 }, getPreEmitDiagnostics: () => [{ category: 1 }] };
  const result = compileProgram(compiler, { emit() { emitted = true; } });
  assert.equal(result.success, false);
  assert.deepEqual(result.outputs, []);
  assert.equal(emitted, false);
});

test('dev compiler buffers output and rejects errors discovered during emit', () => {
  const compiler = { DiagnosticCategory: { Error: 1 }, getPreEmitDiagnostics: () => [] };
  const result = compileProgram(compiler, {
    emit(_target: unknown, write: (name: string, text: string) => void) {
      write('dist/main.js', 'compiled');
      return { emitSkipped: false, diagnostics: [{ category: 1 }] };
    },
  });
  assert.equal(result.success, false);
});

test('installed TypeScript full emit retains decorated method parameter metadata', () => {
  const fileName = path.resolve('dev-startup-virtual.ts');
  const source = `
    function Route(): MethodDecorator { return () => {}; }
    class Query { limit?: number; }
    class Controller { @Route() find(query: Query) { return query; } }
  `;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true, emitDecoratorMetadata: true,
    noEmitOnError: true, skipLibCheck: true, types: [],
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    // TypeScript normalizes Windows path separators before this callback.
    path.resolve(name) === fileName ? ts.createSourceFile(name, source, languageVersion, true)
      : original(name, languageVersion, onError, shouldCreateNewSourceFile);
  const result = compileProgram(ts, ts.createProgram([fileName], options, host));
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.outputs.length, 1);
  assert.match(result.outputs[0].text, /__metadata\("design:paramtypes", \[Query\]\)/);
});

test('dev restarts are serialized and rapid successful edits coalesce', async () => {
  const { children, supervisor } = fixture();
  await supervisor.restart();
  const firstRestart = supervisor.restart();
  const latestRestart = supervisor.restart();
  assert.equal(children.length, 1);
  assert.deepEqual(children[0].signals, ['SIGTERM']);
  children[0].finish();
  await Promise.all([firstRestart, latestRestart]);
  assert.equal(children.length, 2);
  const stopped = supervisor.shutdown();
  children[1].finish();
  await stopped;
});

test('a failed/new compilation cancels a pending restart instead of starting stale code', async () => {
  const { children, supervisor } = fixture();
  await supervisor.restart();
  const replacement = supervisor.restart();
  supervisor.invalidate();
  children[0].finish();
  await replacement;
  assert.equal(children.length, 1);
  await supervisor.shutdown();
});

test('shutdown forwards its signal, is idempotent, and prevents later starts', async () => {
  const { children, supervisor } = fixture();
  await supervisor.restart();
  const stopped = supervisor.shutdown('SIGINT');
  const stoppedAgain = supervisor.shutdown('SIGTERM');
  assert.equal(stopped, stoppedAgain);
  assert.deepEqual(children[0].signals, ['SIGINT']);
  await supervisor.restart();
  assert.equal(children.length, 1);
  children[0].finish();
  await stopped;
});

test('audit launcher rejects unknown modes and invalid or unbounded deadlines', () => {
  assert.equal(auditLauncher.timeoutFor('pure'), 120000);
  assert.equal(auditLauncher.timeoutFor('api'), 0);
  assert.equal(auditLauncher.timeoutFor('pure', '1000'), 1000);
  for (const value of ['', '0', '-1', 'Infinity', '1000.5', '3600001', '1e4']) {
    assert.throws(() => auditLauncher.timeoutFor('pure', value));
  }
  assert.throws(() => auditLauncher.timeoutFor('unknown'));
});

test('audit launcher preserves nonzero child exit, explicit cwd and inherited environment', async () => {
  let invocation: { command: string; args: string[]; options: Record<string, unknown> } | undefined;
  const logs: string[] = [];
  const result = await auditLauncher.launch('pure', {
    env: { QA_TIMEOUT_MS: '1000', NODE_OPTIONS: '--trace-warnings', QA_SENTINEL: 'retained' },
    log: (line: string) => logs.push(line),
    spawnChild(command: string, args: string[], options: Record<string, unknown>) {
      invocation = { command, args, options };
      const child = new FakeChild();
      queueMicrotask(() => child.emit('close', 7, null));
      return child;
    },
  });
  assert.equal(result, 7);
  assert.equal(invocation?.command, process.execPath);
  const cwd = String(invocation?.options.cwd);
  assert.equal(path.isAbsolute(cwd), true);
  assert.equal(invocation?.args.at(-1), path.join(cwd, 'scripts/qa/pure-regressions.cjs'));
  assert.equal(invocation?.options.shell, false);
  const env = invocation?.options.env as Record<string, string>;
  assert.equal(env.QA_SENTINEL, 'retained');
  assert.match(env.NODE_OPTIONS, /--trace-warnings/);
  assert.match(env.NODE_OPTIONS, /--preserve-symlinks-main/);
  assert.ok(logs.some((line) => line.includes('END pure exit=7')));
});

test('audit launcher converts a deadline to exit124 and kills only its own child', async () => {
  const child = new FakeChild();
  child.kill = (signal: string) => {
    child.signals.push(signal);
    queueMicrotask(() => child.emit('close', null, signal));
    return true;
  };
  const logs: string[] = [];
  const result = await auditLauncher.launch('pure', {
    env: { QA_TIMEOUT_MS: '1000' },
    log: (line: string) => logs.push(line),
    spawnChild: () => child,
  });
  assert.equal(result, 124);
  assert.deepEqual(child.signals, ['SIGKILL']);
  assert.ok(logs.some((line) => line.includes('TIMEOUT pure')));
});

test('audit launcher reports a denied child spawn instead of reporting success', async () => {
  const logs: string[] = [];
  await assert.rejects(auditLauncher.launch('pure', {
    env: { QA_TIMEOUT_MS: '1000' },
    log: (line: string) => logs.push(line),
    spawnChild() {
      const child = new FakeChild();
      queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn denied'), { code: 'EPERM' })));
      return child;
    },
  }), /spawn denied/);
  assert.ok(logs.some((line) => line.includes('START FAILED pure code=EPERM')));
});
