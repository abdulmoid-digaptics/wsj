import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sanitizeArticleHtml, readingMinutes, slugify, articleText} from '../src/article-sanitize';
import {blogState, parseMeta, previewToken, previewTokenValid, validSlug, BlogStudioController} from '../src/blog-studio';
import {chartSvg, parseChart} from '../../lib/article/chart';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value-that-is-long-enough-123456';

test('the website and the backend use the identical article policy', () => {
  const a = fs.readFileSync(path.resolve(__dirname, '../src/article-sanitize.ts'), 'utf8');
  const b = fs.readFileSync(path.resolve(__dirname, '../../lib/article/sanitize.ts'), 'utf8');
  assert.equal(a.replace(/\r\n/g, '\n'), b.replace(/\r\n/g, '\n'));
});

test('malicious pasted HTML is neutralised, authored formatting survives', () => {
  const dirty = [
    '<script>alert(1)</script><p onclick="steal()" style="color:#B5562E;position:fixed;background-image:url(javascript:x)">Hi</p>',
    '<a href="javascript:alert(1)">bad</a><a href="https://example.com" target="_blank">good</a>',
    '<img src="x" onerror="alert(1)"><img src="data:image/png;base64,AAAA"><img src="https://cdn.example/a.png" alt="ok">',
    '<iframe src="https://evil.example/embed"></iframe><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><iframe src="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></iframe><iframe src="https://player.vimeo.com/video/76979871"></iframe>',
    '<svg onload="alert(1)"></svg><form action="/x"><input type="text" name="q"></form><input type="checkbox" checked onchange="x()">',
    '<table><tr><td colspan="2" rowspan="3" style="background-color:#FBF0DC;text-align:center" onmouseover="x()">cell</td></tr></table>',
    '<style>body{display:none}</style><object data="x"></object><embed src="x">',
  ].join('');
  const clean = sanitizeArticleHtml(dirty);
  for (const bad of ['<script', 'onclick', 'onerror', 'onload', 'onmouseover', 'onchange', 'javascript:', 'data:image', 'position:fixed', 'background-image', 'evil.example', '<svg', '<form', '<style', '<object', '<embed', 'watch?v=']) assert.ok(!clean.includes(bad), bad + ' survived: ' + clean);
  assert.match(clean, /<p style="color:#B5562E">Hi<\/p>/);
  assert.match(clean, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/);
  assert.match(clean, /<img src="https:\/\/cdn.example\/a.png" alt="ok" \/>/);
  assert.match(clean, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(clean, /player\.vimeo\.com\/video\/76979871/);
  assert.match(clean, /<td colspan="2" rowspan="3" style="background-color:#FBF0DC;text-align:center">cell<\/td>/);
  assert.match(clean, /<input type="checkbox" disabled="disabled" checked="checked" \/>/);
});

test('slugs, reading time and text extraction', () => {
  assert.equal(slugify('How Modern Businesses Grow'), 'how-modern-businesses-grow');
  assert.equal(slugify('  Café & Coworking: 2026!  '), 'cafe-and-coworking-2026');
  assert.equal(validSlug('page'), '"page" is reserved by the site. Choose another slug');
  assert.ok(validSlug('Bad Slug'));
  assert.equal(validSlug('fine-slug-2'), null);
  assert.equal(readingMinutes('<p>' + 'word '.repeat(660) + '</p>'), 3);
  assert.equal(articleText('<h2>A</h2><p>B &amp; C</p>'), 'A B & C');
});

test('editor metadata is validated field by field', () => {
  const m = parseMeta({featured: true, featuredOrder: '2', categories: [1, '65', '65'], seo: {title: 'T', noindex: true}, og: {image: '/media/x.png'}, internalNotes: 'secret', unknown: 'dropped'});
  assert.equal(m.featured, true);
  assert.equal(m.featuredOrder, 2);
  assert.deepEqual(m.categories, ['1', '65']);
  assert.equal(m.seo.noindex, true);
  assert.equal((m as Record<string, unknown>).unknown, undefined);
  assert.throws(() => parseMeta({featuredOrder: -1}), /Featured order/);
  assert.throws(() => parseMeta({featuredImage: 'javascript:alert(1)'}), /Featured image/);
  assert.throws(() => parseMeta({seo: {canonical: 'ftp://x'}}), /Canonical/);
});

test('publication state is derived consistently', () => {
  const now = new Date('2027-01-01T00:00:00Z');
  assert.equal(blogState({status: 'DRAFT', publishAt: null}, now), 'draft');
  assert.equal(blogState({status: 'ARCHIVED', publishAt: null}, now), 'archived');
  assert.equal(blogState({status: 'PUBLISHED', publishAt: new Date('2027-02-01T00:00:00Z')}, now), 'scheduled');
  assert.equal(blogState({status: 'PUBLISHED', publishAt: new Date('2026-12-01T00:00:00Z')}, now), 'published');
});

test('preview links are bound to one post, expire, and cannot be forged', () => {
  const now = Date.now();
  const token = previewToken('post-a', 60000, now);
  assert.equal(previewTokenValid('post-a', token, now), true);
  assert.equal(previewTokenValid('post-b', token, now), false, 'bound to the post id');
  assert.equal(previewTokenValid('post-a', token, now + 61000), false, 'expires');
  const [exp, sig] = token.split('.');
  assert.equal(previewTokenValid('post-a', (Number(exp) + 999999) + '.' + sig, now), false, 'expiry cannot be extended');
  assert.equal(previewTokenValid('post-a', 'garbage', now), false);
});

test('chart labels cannot inject markup into the SVG', () => {
  const spec = parseChart({type: 'bar', title: '<script>x</script>', labels: ['<img src=x onerror=1>', 'B'], datasets: [{label: 'S"onload="x', data: [1, 'NaN'], color: 'red;fill:url(x)'}]});
  assert.ok(spec);
  const svg = chartSvg(spec!);
  /* Text appears only escaped; no raw tags, attributes or CSS can be introduced. */
  assert.ok(!/<script|<img|\son\w+="|url\(x\)/.test(svg), svg);
  assert.match(svg, /&lt;img src=x onerror=1&gt;/);
  assert.equal(spec!.datasets[0].data[1], 0);
  assert.equal(parseChart('not json'), null);
});

test('Word .docx import converts structure and uploads embedded images', async () => {
  const docx = path.resolve(__dirname, 'fixtures/sample.docx');
  if (!fs.existsSync(docx)) return;
  const uploads: string[] = [];
  const storage = {isConfigured: () => true, uploadFile: async (i: {originalName: string}) => { uploads.push(i.originalName); return {key: 'blogs/x.png', url: 'https://cdn.example/blogs/x.png'}; }};
  const db = {media: {create: async ({data}: {data: Record<string, unknown>}) => ({id: 'm1', ...data})}, audit: {create: async () => ({})}};
  const controller = new BlogStudioController(db as never, storage as never);
  const res = await controller.importDocx({buffer: fs.readFileSync(docx), originalname: 'sample.docx'} as never, {user: {id: 'u', email: 'a@b.c', role: 'ADMIN'}});
  assert.match(res.html, /<h1>Why coworking works<\/h1>/);
  assert.match(res.html, /<strong>Bold claim<\/strong>/);
  assert.match(res.html, /<em>italic note<\/em>/);
  assert.match(res.html, /href="https:\/\/workspacejunction.com\/coworking\/"/);
  assert.match(res.html, /<table>[\s\S]*Gold[\s\S]*\$150/);
  assert.match(res.html, /<img (alt="Brand gradient" src="https:\/\/cdn.example\/blogs\/x.png"|src="https:\/\/cdn.example\/blogs\/x.png" alt="Brand gradient")/);
  assert.equal(uploads.length, 1);
  assert.ok(!res.notes.some(n => /SmartArt/.test(n)), 'an ordinary picture is not reported as a drawing');
  assert.ok(res.warnings.some(w => /Word styles were not recognized/.test(w)));
});
