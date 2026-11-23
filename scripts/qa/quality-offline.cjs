'use strict';
// In-process test registration avoids worker/ESM launcher differences on Windows.
// The allowlist deliberately excludes DB-backed, browser-mutating and payment-network suites.
process.env.NODE_ENV = 'test';
process.env.WEB_PUSH_DELIVERY = 'off';
require('./ts-register.cjs');
for (const suite of [
  'notifications', 'customer-accounts', 'stripe-webhook', 'catalog-checkout-regressions',
  'catalog-summary-performance', 'advance-booking', 'billing-core', 'booking-admin-refund',
  'booking-rules', 'public-cache-performance',
]) require(`../../backend/test/${suite}.test.ts`);
require('./push-worker.test.cjs');
require('./payment-audit-safety.test.cjs');
