'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// Buffer the entire emit so diagnostics never leave a partially compiled build.
// program.emit(), not the watch builder's incremental emit, emits every source file.
function compileProgram(ts, program) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) {
    return { diagnostics, outputs: [], success: false };
  }
  const outputs = [];
  const result = program.emit(undefined, (fileName, text, writeByteOrderMark) => {
    outputs.push({ fileName, text: `${writeByteOrderMark ? '\uFEFF' : ''}${text}` });
  });
  diagnostics.push(...result.diagnostics);
  return {
    diagnostics,
    outputs,
    success: !result.emitSkipped && !diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error),
  };
}

// One serialized replacement queue. A newer edit invalidates any replacement that
// is waiting for the previous child to exit. No new child starts before close.
function createSupervisor({ spawnChild, log = console.log, stopTimeoutMs = 5000 }) {
  let current = null;
  let generation = 0;
  let pending = null;
  let draining = null;
  let closing = false;
  let shutdownPromise = null;

  function invalidate() {
    generation += 1;
    pending = null;
  }

  async function stopCurrent(signal) {
    const record = current;
    if (!record) return;
    if (!record.stopping) {
      record.stopping = (async () => {
        const timer = setTimeout(() => {
          log('[dev] Child did not stop in time; sending SIGKILL.');
          record.child.kill('SIGKILL');
        }, stopTimeoutMs);
        try {
          record.child.kill(signal);
          await record.closed;
        } finally {
          clearTimeout(timer);
          if (current === record) current = null;
        }
      })();
    }
    await record.stopping;
  }

  function restart() {
    if (closing) return Promise.resolve();
    pending = ++generation;
    if (!draining) {
      draining = (async () => {
        while (pending !== null && !closing) {
          const requested = pending;
          pending = null;
          await stopCurrent('SIGTERM');
          if (closing || requested !== generation) continue;
          const child = spawnChild();
          const record = { child, closed: null, stopping: null };
          record.closed = new Promise((resolve) => {
            child.once('error', (error) => log(`[dev] Could not start API: ${error.message}`));
            child.once('close', (code, signal) => {
              if (current === record) current = null;
              if (!record.stopping && !closing) {
                log(`[dev] API exited (${signal || code}). Waiting for a successful source edit.`);
              }
              resolve();
            });
          });
          current = record;
          log('[dev] Starting compiled dist/main.js.');
        }
      })().finally(() => { draining = null; });
    }
    return draining;
  }

  function shutdown(signal = 'SIGTERM') {
    if (!shutdownPromise) {
      closing = true;
      invalidate();
      shutdownPromise = (async () => {
        if (draining) await draining;
        await stopCurrent(signal);
      })();
    }
    return shutdownPromise;
  }

  return { invalidate, restart, shutdown };
}

function start() {
  const ts = require('typescript');
  const backendRoot = path.resolve(__dirname, '..');
  const configPath = path.join(backendRoot, 'tsconfig.json');
  const mainPath = path.join(backendRoot, 'dist', 'main.js');
  const formatHost = {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => backendRoot,
    getNewLine: () => ts.sys.newLine,
  };
  const report = (diagnostics) => {
    if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
  };
  const supervisor = createSupervisor({
    spawnChild: () => spawn(process.execPath, [...process.execArgv, mainPath], {
      cwd: backendRoot,
      stdio: 'inherit',
      env: process.env, // Includes NODE_OPTIONS; do not drop inherited runtime configuration.
      shell: false,
    }),
  });
  let watcher;
  let stopping = false;
  async function shutdown(signal, exitCode) {
    if (stopping) return;
    stopping = true;
    watcher?.close();
    await supervisor.shutdown(signal);
    process.exitCode = exitCode;
  }
  process.on('SIGINT', () => { void shutdown('SIGINT', 130); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM', 143); });

  const host = ts.createWatchCompilerHost(
    configPath,
    { noEmitOnError: true },
    ts.sys,
    ts.createSemanticDiagnosticsBuilderProgram,
    (diagnostic) => {
      if (diagnostic.category === ts.DiagnosticCategory.Error) supervisor.invalidate();
      report([diagnostic]);
    },
    (diagnostic) => {
      // This runs when a new watch compilation starts, including config edits.
      supervisor.invalidate();
      console.log(`[dev] ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ts.sys.newLine)}`);
    },
  );
  host.afterProgramCreate = (builder) => {
    if (stopping) return;
    supervisor.invalidate();
    try {
      const program = builder.getProgram();
      const options = program.getCompilerOptions();
      if (!options.experimentalDecorators || !options.emitDecoratorMetadata) {
        console.error('[dev] experimentalDecorators and emitDecoratorMetadata must remain enabled in tsconfig.json.');
        return;
      }
      const result = compileProgram(ts, program);
      report(result.diagnostics);
      if (!result.success) {
        console.error('[dev] Compilation failed. No files emitted; keeping the last running API, if any.');
        return;
      }
      if (!result.outputs.some((output) => path.resolve(output.fileName) === mainPath)) {
        console.error('[dev] Compilation did not produce dist/main.js. API will not be started.');
        return;
      }
      for (const output of result.outputs) {
        fs.mkdirSync(path.dirname(output.fileName), { recursive: true });
        fs.writeFileSync(output.fileName, output.text);
      }
      console.log('[dev] Full TypeScript compilation succeeded.');
      void supervisor.restart().catch((error) => {
        console.error(`[dev] ${error.stack || error}`);
        void shutdown('SIGTERM', 1);
      });
    } catch (error) {
      console.error(`[dev] ${error.stack || error}`);
      void shutdown('SIGTERM', 1);
    }
  };
  try {
    watcher = ts.createWatchProgram(host);
    if (stopping) watcher.close();
  } catch (error) {
    console.error(`[dev] ${error.stack || error}`);
    void shutdown('SIGTERM', 1);
  }
}

if (require.main === module) start();
module.exports = { compileProgram, createSupervisor };
