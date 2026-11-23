#!/usr/bin/env node
/**
 * Point every absolute URL in the landing pages (canonical, Open Graph, Twitter, JSON-LD,
 * sitemap.xml, robots.txt) at the address the pages are actually served from.
 *
 *   node scripts/set-base-url.mjs https://wp.workspacejunction.com/offers/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let next = process.argv[2];
if (!next || !/^https:\/\/[^\s]+$/.test(next)) {
  console.error('Usage: node scripts/set-base-url.mjs https://your-domain/path/');
  process.exit(1);
}
if (!next.endsWith('/')) next += '/';

const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const m = sitemap.match(/<loc>(https:\/\/[^<]+?\/)<\/loc>/);
if (!m) { console.error('Could not detect the current base URL from sitemap.xml'); process.exit(1); }
const current = m[1];
if (current === next) { console.log('Already using', next); process.exit(0); }

const files = fs.readdirSync(root).filter(f => /\.(html|xml|txt)$/.test(f));
let changed = 0;
for (const f of files) {
  const p = path.join(root, f);
  const before = fs.readFileSync(p, 'utf8');
  const after = before.split(current).join(next);
  if (after !== before) { fs.writeFileSync(p, after); changed++; console.log('updated', f); }
}
console.log(`Base URL: ${current} -> ${next} (${changed} files)`);
