// Local read-only browser regressions. Admin identity/data below are in-browser fixtures only.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base = process.env.QA_BASE_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local QA only');
const browser = await chromium.launch();
try {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
  await context.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
    ? route.continue() : route.fulfill({status: 409, json: {message: 'Read-only audit'}}));
  await context.route('**/public/popups/**', route => route.fulfill({json: {items: []}}));
  const page = await context.newPage();
  await page.route('**/public/catalog/services/coworking', route => route.fulfill({status: 503, json: {message: 'Temporary catalogue failure'}}));
  await page.goto(base, {waitUntil: 'load'});
  await page.waitForLoadState('networkidle');
  await page.locator('.h-actions').getByRole('button', {name: /book a tour/i}).click();
  await page.locator('.bk-type-grid button').filter({hasText: /Co-?working/i}).click();
  await page.locator('.bk-fallback-banner').waitFor();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/public/catalog/services/dedicated') && response.status() === 200),
    page.locator('.bk-type-grid button').filter({hasText: 'Dedicated Desk'}).click(),
  ]);
  await page.locator('.bk-fallback-banner').waitFor({state: 'detached'});
  await page.getByRole('button', {name: /continue/i}).click();
  await page.locator('.bk-plan-card').first().waitFor();
  console.log('PASS booking recovers from transient catalogue failure and shows plans');
  await page.keyboard.press('Escape');
  for (const response of [{status: 503, json: {message: 'Catalogue offline'}}, {status: 200, json: {items: []}}]) {
    await page.route('**/public/catalog/services', route => route.fulfill(response));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.locator('.h-actions').getByRole('button', {name: /book a tour/i}).click();
    await page.locator('.bk-fallback-banner').waitFor();
    // The footer action is relabelled "Review request" on the step before checkout,
    // so target it structurally rather than by its "Continue" label.
    const next = page.locator('.bk-footer .bk-btn-primary');
    await next.waitFor({state: 'visible'});
    assert.equal(await next.isDisabled(), false, 'Catalogue outage must not trap the visitor on the service step');
    await next.click();
    await next.click();
    await page.getByRole('button', {name: 'Send booking request', exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: /continue to payment/i}).count(), 0, 'Offline request cannot enter payment');
    console.log('PASS unavailable/empty catalogue permits a non-payment reservation request (' + response.status + ')');
    await page.keyboard.press('Escape');
  }
  await page.route('**/api/auth/me', route => route.fulfill({status: 401, json: {message: 'Unauthorized'}}));
  await page.goto(base + '/admin/', {waitUntil: 'load'});
  await page.getByRole('heading', {name: /sign in to your workspace/i}).waitFor();
  assert.equal(await page.getByRole('main').count(), 1, 'Admin login exposes one main landmark');
  console.log('PASS admin login has a main landmark');
  await page.route('**/api/auth/me', route => route.fulfill({json: {id: 'offline-audit-viewer', name: 'Audit viewer', role: 'VIEWER'}}));
  await page.route('**/api/admin/**', route => route.request().method() === 'GET'
    ? route.fulfill({json: {items: [], total: 0, page: 1, limit: 10}})
    : route.fulfill({status: 409, json: {message: 'Read-only audit'}}));
  await page.reload();
  const toggle = page.locator('.adm-menu');
  await toggle.click();
  await page.locator('.adm-sidebar-open').waitFor();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  // Keyboard activation still works when the sidebar backdrop overlays the pointer target.
  await toggle.focus();
  await toggle.press('Enter');
  await page.locator('.adm-sidebar-open').waitFor({state: 'detached'});
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  console.log('PASS admin mobile navigation toggle opens and closes');
  await context.close();
} finally {
  await browser.close();
}
