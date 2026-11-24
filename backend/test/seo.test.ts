import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkRedirects, cleanOverride, cleanRedirect, normaliseConfig, normaliseDestination, normalisePath, parseCsv, redirectsToCsv, runtimeView, SeoInputError} from '../src/seo-core';
import {analysePage, scoreChecks} from '../src/seo-audit';
import {aiSourceFor} from '../src/seo';

test('paths are normalised and unsafe input is rejected', () => {
  assert.equal(normalisePath('coworking'), '/coworking/');
  assert.equal(normalisePath('/coworking/?utm=x#top'), '/coworking/');
  assert.equal(normalisePath('https://workspacejunction.com/about-us'), '/about-us/');
  assert.equal(normalisePath('/llms.txt'), '/llms.txt');
  assert.throws(() => normalisePath('https://evil.example/x'), SeoInputError);
  assert.throws(() => normalisePath('/a/../admin/'), SeoInputError);
  assert.throws(() => normalisePath('/a b/'), SeoInputError);
});

test('redirect destinations cannot be open or unsafe', () => {
  assert.equal(normaliseDestination('/podcast-studio'), '/podcast-studio/');
  assert.equal(normaliseDestination('https://workspacejunction.com/coworking'), '/coworking/');
  assert.equal(normaliseDestination('https://partner.example/page'), 'https://partner.example/page');
  assert.throws(() => normaliseDestination('javascript:alert(1)'), SeoInputError);
  assert.throws(() => normaliseDestination('http://insecure.example/'), SeoInputError);
  assert.throws(() => normaliseDestination('https://user:pw@x.example/'), SeoInputError);
});

test('redirect rules: system paths, self-redirects and loops are rejected; chains are reported', () => {
  assert.throws(() => cleanRedirect({from: '/admin/', to: '/'}, 't'), SeoInputError);
  assert.throws(() => cleanRedirect({from: '/', to: '/x/'}, 't'), SeoInputError);
  assert.throws(() => cleanRedirect({from: '/a/', to: '/a/'}, 't'), SeoInputError);
  assert.throws(() => cleanRedirect({from: '/a/', to: '/b/', status: 303}, 't'), SeoInputError);
  const gone = cleanRedirect({from: '/old/', status: 410}, 't');
  assert.equal(gone.to, '');
  const a = cleanRedirect({from: '/a/', to: '/b/'}, 't'), b = cleanRedirect({from: '/b/', to: '/c/'}, 't'), c = cleanRedirect({from: '/c/', to: '/a/'}, 't');
  assert.equal(checkRedirects([a, b]).chains.length, 1);
  assert.equal(checkRedirects([a, b, c]).loops.length > 0, true);
});

test('CSV round trip and formula-injection guard', () => {
  const rules = [cleanRedirect({from: '/x/', to: '/y/', note: '=cmd, "quoted"'}, 't')];
  const csv = redirectsToCsv(rules);
  assert.match(csv, /'=cmd/);
  const rows = parseCsv(csv);
  assert.deepEqual(rows[1].slice(0, 3), ['/x/', '/y/', '301']);
});

test('overrides are clipped and the public runtime view hides editor metadata', () => {
  const o = cleanOverride({title: '  New   title ', robots: {index: false}, secondaryTopics: ['a', '', 'b'], primaryTopic: 'internal'}, 'Editor');
  assert.equal(o.title, 'New title');
  assert.deepEqual(o.secondaryTopics, ['a', 'b']);
  assert.throws(() => cleanOverride({ogImage: 'javascript:x'}, 'e'), SeoInputError);
  const cfg = normaliseConfig({pages: {'/x/': o}});
  const view = runtimeView(cfg) as any;
  assert.equal(view.pages['/x/'].updatedBy, undefined);
  assert.equal(view.pages['/x/'].primaryTopic, undefined);
  assert.equal(view.pages['/x/'].robots.index, false);
  assert.equal(cfg.crawlers.aiTraining, false);
  assert.equal(cfg.crawlers.aiSearch, true);
});

test('page analysis finds real problems and scores exclude not-applicable checks', () => {
  const good = '<html lang="en"><head><title>Coworking Space in Oakbrook Terrace, IL | Workspace</title><meta name="description" content="' + 'x'.repeat(120) + '"><link rel="canonical" href="https://workspacejunction.com/coworking/"><meta property="og:title" content="t"><meta property="og:image" content="i"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","url":"u","@id":"https://workspacejunction.com/#business"}]}</script></head><body><h1>Coworking</h1><h2>What is included?</h2><p>' + 'word '.repeat(400) + '</p><img src="a.jpg" alt="Desk"></body></html>';
  const r = analysePage('/coworking/', 200, 120, good, {inSitemap: true});
  const state = (id: string) => r.checks.find(c => c.id === id)?.state;
  assert.equal(state('canonical'), 'pass');
  assert.equal(state('h1'), 'pass');
  assert.equal(state('answers'), 'pass');
  assert.equal(state('alt'), 'pass');
  const badPage = analysePage('/x/', 200, 3000, '<html><head><meta name="robots" content="noindex"></head><body><h1>A</h1><h1>B</h1><h4>C</h4><img src="a.jpg"><script type="application/ld+json">{bad</script></body></html>', {inSitemap: true});
  const st = (id: string) => badPage.checks.find(c => c.id === id)?.state;
  assert.equal(st('indexable'), 'fail');
  assert.equal(st('title'), 'fail');
  assert.equal(st('h1'), 'warn');
  assert.equal(st('alt'), 'fail');
  assert.equal(st('schema-valid'), 'fail');
  assert.equal(st('lang'), 'fail');
  const s = scoreChecks([{id: 'a', category: 'technical', label: '', state: 'pass', priority: 'low'}, {id: 'b', category: 'technical', label: '', state: 'na', priority: 'low'}], {technical: 25, onpage: 20, content: 15, schema: 10, ai: 10, performance: 10, links: 5, a11y: 5});
  assert.equal(s.overall, 100);
  assert.equal(s.categories.onpage.score, null);
});

test('AI referral sources are recognised from referrer host or utm_source', () => {
  assert.equal(aiSourceFor('chatgpt.com'), 'chatgpt');
  assert.equal(aiSourceFor('www.perplexity.ai'), 'perplexity');
  assert.equal(aiSourceFor('gemini.google.com'), 'gemini');
  assert.equal(aiSourceFor('', 'chatgpt.com'), 'chatgpt');
  assert.equal(aiSourceFor('www.google.com'), null);
});
