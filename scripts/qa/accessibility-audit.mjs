// Local, read-only WCAG scan. All non-read API requests are blocked before transmission.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const base = process.env.QA_BASE_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local QA only');
const routes = (process.env.QA_ROUTES || '/,/about-us/,/contact-us/,/coworking/,/meeting-rooms/,/memberships/,/blogs/,/admin/,/login/,/account/').split(',');
const rows = [];
const browser = await chromium.launch();
try {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce'});
    await context.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
      ? route.continue() : route.fulfill({status: 409, json: {message: 'Read-only audit'}}));
    const page = await context.newPage();
    for (const route of routes) {
      await page.goto(base + route, {waitUntil: 'load'});
      await page.locator('main').first().waitFor();
      const result = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const violations = result.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({target: n.target, summary: n.failureSummary}))}));
      rows.push({route, width, violations});
      console.log(route, width, violations.length ? violations.map(v => v.id).join(', ') : 'PASS');
      if (process.env.QA_OUT) await fs.writeFile(process.env.QA_OUT, JSON.stringify(rows, null, 2));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = rows.filter(row => row.violations.length);
console.log(JSON.stringify({checks: rows.length, failed: failed.length}));
if (failed.length) process.exitCode = 1;
