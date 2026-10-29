'use strict';
// All original node:test assertions, in one process. No API, DB or fixtures.
// Run via local-audit-launcher.cjs pure for an external wall-clock deadline.
// Do not preload --import tsx: an ESM loader stall would hide this progress.
const path = require('node:path');
const started = Date.now();
function progress(message) {
  console.error('[pure] ' + message + ' elapsedMs=' + (Date.now() - started));
}
function load(file) {
  progress('LOAD ' + file);
  require(path.resolve(__dirname, file));
  progress('REGISTERED ' + file);
}
progress('START node=' + process.version);
load('./api-scenarios.test.cjs');
load('./api-input-vectors.test.cjs');
load('./api-scenarios-safety.test.cjs');
load('./payment-audit-safety.test.cjs');
load('./local-payment-fixture.test.cjs');
progress('LOAD synchronous installed-TypeScript registration');
require('./ts-register.cjs');
progress('REGISTERED synchronous TypeScript loader');
load('../../backend/test/booking-validation.test.ts');
load('../../backend/test/dev-startup.test.ts');
load('../../backend/test/errors.test.ts');
load('../../backend/test/security-review.test.ts');
load('../../backend/test/pricing-catalog.test.ts');
load('../../backend/test/stripe-webhook.test.ts');
load('../../backend/test/local-payment.test.ts');
progress('ALL FILES REGISTERED; node:test owns assertion results and exit status');
process.once('beforeExit', (code) => progress('BEFORE EXIT code=' + code));
process.once('exit', (code) => progress('EXIT code=' + code));
