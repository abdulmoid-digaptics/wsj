/**
 * Restores link text lost in the WordPress import: blog content contains empty
 * `<strong></strong>` where `<strong><a href="...">text</a></strong>` used to be.
 * Text and targets are taken from the live WordPress page of the same slug and pointed at local paths.
 *
 * Usage (from backend/):  node scripts/restore-empty-blog-links.cjs [--dry]
 * Writes a JSON backup of every record it touches next to this script before changing anything.
 */
require('dotenv/config');
const fs = require('fs');
const path = require('path');
const {PrismaClient} = require('@prisma/client');

const DRY = process.argv.includes('--dry');
const LIVE = process.env.LEGACY_SITE_URL || 'https://workspacejunction.com';
const db = new PrismaClient();
const decode = s => s.replace(/&nbsp;|&#160;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;|’/g, "'").replace(/&#8211;|&ndash;/g, '-');
const strip = s => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const localHref = h => {
  try {
    const u = new URL(h, LIVE);
    if (!/workspacejunction\.com$/.test(u.hostname)) return h;
    let p = u.pathname.replace(/\.md$/, '');
    if (!p.endsWith('/')) p += '/';
    return p + (u.hash || '');
  } catch { return h; }
};
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

(async () => {
  const ids = (await db.$queryRaw`SELECT id FROM "Content" WHERE content::text LIKE '%<strong></strong>%'`).map(r => r.id);
  const rows = await db.content.findMany({where: {id: {in: ids}}});
  if (!rows.length) return console.log('Nothing to restore.');
  const backup = path.join(__dirname, 'backup-empty-blog-links-' + Date.now() + '.json');
  fs.writeFileSync(backup, JSON.stringify(rows.map(r => ({id: r.id, slug: r.slug, content: r.content})), null, 1));
  let fixed = 0;
  const misses = [];
  for (const r of rows) {
    const res = await fetch(LIVE + '/' + r.slug + '/');
    if (!res.ok) { misses.push(r.slug + ': live page ' + res.status); continue; }
    const live = await res.text();
    const links = [...live.matchAll(/([\s\S]{0,200})<strong><a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/strong>([\s\S]{0,160})/g)]
      .map(m => ({before: strip(m[1]).slice(-30), href: m[2], text: strip(m[3]), after: strip(m[4]).slice(0, 40)}));
    const replaceOne = (pre, post) => {
      const b = strip(pre).slice(-30), a = strip(post).slice(0, 40);
      return links.find(l => a && l.after && (l.after.startsWith(a.slice(0, 25)) || a.startsWith(l.after.slice(0, 25))))
        || links.find(l => b && l.before && (l.before.endsWith(b.slice(-18)) || b.endsWith(l.before.slice(-18))));
    };
    const fix = s => {
      let out = '', last = 0, m;
      const re = /<strong><\/strong>/g;
      while ((m = re.exec(s))) {
        const hit = replaceOne(s.slice(Math.max(0, m.index - 200), m.index), s.slice(m.index + m[0].length, m.index + m[0].length + 160));
        out += s.slice(last, m.index) + (hit ? '<strong><a href="' + localHref(hit.href) + '">' + esc(hit.text) + '</a></strong>' : m[0]);
        if (hit) fixed++; else misses.push(r.slug + ': ...' + strip(s.slice(Math.max(0, m.index - 60), m.index)));
        last = m.index + m[0].length;
      }
      return out + s.slice(last);
    };
    const walk = v => typeof v === 'string' ? fix(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
    if (!DRY) await db.content.update({where: {id: r.id}, data: {content: walk(r.content)}});
    else walk(r.content);
  }
  console.log(JSON.stringify({posts: rows.length, restored: fixed, unresolved: misses, backup, dryRun: DRY}, null, 1));
})().finally(() => db.$disconnect());
