'use strict';
// Run with the repository's offline TypeScript require hook; no HTTP is sent.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadBusiness, loadSite, businessDefaults} = require('../../lib/site.ts');

test('business settings share cold reads, keep canonical priority, and refresh after expiry', async (t) => {
  const realNow = Date.now;
  let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const slugs = [];
  let phase = 'both';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async url => {
    const pathname = new URL(url).pathname;
    if (!pathname.includes('/public/settings/')) return {ok: false};
    const slug = pathname.split('/').at(-1);
    slugs.push(slug);
    if (slug === 'business' && phase === 'both') await gate;
    if (slug === 'business' && phase === 'legacy') throw Error('mock upstream unavailable');
    if (phase === 'neither') return {ok: false};
    return {ok: true, json: async () => ({slug, metadata: {tagline: slug}})};
  });
  const shared = Promise.all([loadBusiness(), loadSite(), loadBusiness()]);
  try { assert.deepEqual(slugs, ['business', 'business-settings']); }
  finally { release(); await shared; }
  const [first, site, concurrent] = await shared;
  assert.equal(first.tagline, 'business');
  assert.equal(site.business.tagline, 'business');
  assert.deepEqual(concurrent, first);
  assert.deepEqual(await loadBusiness(), first);
  assert.equal(slugs.length, 2);
  offset += 31_000;
  phase = 'legacy';
  assert.equal((await loadBusiness()).tagline, 'business-settings');
  assert.equal(slugs.length, 4);
  offset += 31_000;
  phase = 'neither';
  assert.deepEqual(await loadBusiness(), businessDefaults);
  assert.equal(slugs.length, 6);
});
