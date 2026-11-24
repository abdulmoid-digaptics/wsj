'use client';
/**
 * Admin → SEO. One screen for search and AI visibility, backed by real data only:
 * - the live crawl audit (server-rendered HTML of every sitemap URL), the route inventory, the sitemap itself,
 *   IndexNow logs, AI referral counters and, when connected, Search Console / GA4 / Bing / PageSpeed data.
 * Scores are internal diagnostics, never Google rankings or AI citation probabilities.
 * Editors can change page SEO; site-wide settings, redirects, crawler policy and rollbacks are admin only.
 */
import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import {Activity, AlertTriangle, Bot, CheckCircle2, Download, ExternalLink, FileSearch, Gauge, Globe, History, LayoutDashboard, Link2, ListChecks, Map, RefreshCw, RotateCcw, Search, Send, Settings2, Trash2, Upload, XCircle} from 'lucide-react';
import {ApiError, API, authToken, request, revalidatePublic} from './api';
import {apiUrl} from '@/lib/public-api';
import {useToast, Drawer} from './ui';
import './seo-panel.css';

type Check = {id: string; category: string; label: string; state: 'pass' | 'warn' | 'fail' | 'na'; priority: string; detail?: string};
type PageReport = {path: string; status: number; ms: number; title: string; description: string; canonical: string; robots: string; h1: string[]; headings: string[]; words: number; schemaTypes: string[]; schemaErrors: string[]; inbound: number; links: number; imgs: number; imgNoAlt: number; checks: Check[]};
type Finding = {id: string; category: string; categoryLabel: string; label: string; priority: string; state: string; pages: {path: string; detail?: string}[]};
type Audit = {at: string; durationMs: number; pages: PageReport[]; broken: {from: string; to: string; status: number}[]; redirectedLinks: {from: string; to: string; status: number}[]; orphans: string[]; score: {overall: number; categories: Record<string, {score: number | null; pass: number; warn: number; fail: number; na: number}>}; counts: Record<string, number>; findings: Finding[]};
type Override = {title?: string; description?: string; canonical?: string; robots?: {index?: boolean; follow?: boolean}; ogTitle?: string; ogDescription?: string; ogImage?: string; breadcrumb?: string; primaryTopic?: string; secondaryTopics?: string[]; sitemap?: boolean; updatedAt?: string; updatedBy?: string};
type Rule = {id: string; from: string; to: string; status: number; note?: string; createdAt: string; createdBy?: string};
type Config = {global: {titleSuffix: string; defaultDescription: string; defaultOgImage: string; verification: Record<string, string>; monitorHourUtc: number}; crawlers: {aiSearch: boolean; aiUser: boolean; gemini: boolean; aiTraining: boolean; llmsTxt: boolean; extraBlocked: string[]}; pages: Record<string, Override>; redirects: Rule[]; indexNow: {key: string; enabled: boolean}; weights: Record<string, number>};
type Integration = {connected: boolean; needs: string; [k: string]: unknown};
type Overview = {role: string; config: Config; siteUrl: string; crawlerGroups: Record<string, string[]>; categoryLabels: Record<string, string>; audit: Audit | null; trend: {at: string; overall: number}[]; psi: Record<string, Psi>; auditRunning: boolean; redirectHealth: {loops: string[][]; chains: string[][]}; indexNowLog: {id: string; resourceId: string; details: {reason?: string; count?: number; httpStatus?: number; error?: string; sample?: string[]}; createdAt: string}[]; aiReferrals: {days: number; total: number; bySource: Record<string, number>; topPages: [string, number][]; byDay: Record<string, number>}; history: HistoryRow[]; regressions: {id: string; resourceId: string; createdAt: string}[]; integrations: Record<string, Integration>};
type HistoryRow = {id: string; summary: string; kind: string; by: string; at: string};
type Route = {path: string; title: string; source: string; classification: string; reason?: string; registry: boolean; override: boolean; modified?: string};
type Psi = {at: string; path: string; strategy: string; scores: Record<string, number | null>; lab: Record<string, string>; field: {lcpMs?: number; inpMs?: number; cls?: number; category?: string} | null; opportunities: {title: string; savings?: string}[]; failedA11y: string[]};

const TABS = [
  ['overview', 'Overview', LayoutDashboard], ['pages', 'Pages', FileSearch], ['audit', 'Audit center', ListChecks], ['redirects', 'Redirects', Link2], ['sitemap', 'Sitemap & indexing', Map],
  ['ai', 'AI search & crawlers', Bot], ['schema', 'Structured data', Activity], ['performance', 'Performance', Gauge], ['search', 'Search data', Search], ['settings', 'Global settings', Settings2], ['history', 'Change history', History],
] as const;
type Tab = typeof TABS[number][0];
const msg = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong.';
const when = (v?: string) => v ? new Date(v).toLocaleString(undefined, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}) : '';
const tone = (n: number | null | undefined) => n === null || n === undefined ? 'na' : n >= 90 ? 'good' : n >= 70 ? 'ok' : 'bad';
const StateIcon = ({s}: {s: string}) => s === 'pass' ? <CheckCircle2 size={15} className="seo-pass" /> : s === 'fail' ? <XCircle size={15} className="seo-fail" /> : s === 'warn' ? <AlertTriangle size={15} className="seo-warn" /> : <span className="seo-na">n/a</span>;

export default function SeoPanel({onUnauthorized}: {onUnauthorized: () => void}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<Overview | null>(null);
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const fail = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) onUnauthorized(); else toast.push({tone: 'error', text: msg(e), ms: 9000}); }, [onUnauthorized, toast]);
  const load = useCallback(async () => {
    try { setData(await request<Overview>('/admin/seo/overview')); setError(''); } catch (e) { if (e instanceof ApiError && e.status === 401) onUnauthorized(); else setError(msg(e)); }
    try { const t = authToken(); const r = await fetch('/api/seo-inventory/', {credentials: 'include', cache: 'no-store', headers: t ? {Authorization: 'Bearer ' + t} : {}}); if (r.ok) setRoutes((await r.json()).routes); } catch { /* inventory optional */ }
  }, [onUnauthorized]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  /* While an audit runs, poll until it finishes. */
  useEffect(() => { if (!data?.auditRunning) return; const t = setInterval(() => void load(), 8000); return () => clearInterval(t); }, [data?.auditRunning, load]);

  const admin = data?.role === 'ADMIN';
  const act = async (key: string, fn: () => Promise<unknown>, ok?: string, purge = false) => {
    setBusy(key);
    try { await fn(); if (purge) await revalidatePublic(); if (ok) toast.push({tone: 'success', text: ok}); await load(); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const runAudit = () => act('audit', () => request('/admin/seo/audit/run', {method: 'POST'}), 'Audit started. It crawls every sitemap URL and takes about a minute.');

  if (error) return <section className="seo-root"><div className="seo-alert seo-alert-bad"><AlertTriangle size={18} />{error}<button className="adm-button adm-secondary" onClick={() => void load()}>Retry</button></div></section>;
  if (!data) return <section className="seo-root" aria-busy="true"><p className="seo-muted"><RefreshCw size={16} className="adm-spin" /> Loading SEO data…</p></section>;

  return (
    <section className="seo-root" aria-labelledby="seo-title">
      <header className="seo-head">
        <div><h2 id="seo-title"><Globe size={20} /> SEO and AI visibility</h2><p>Search engine and AI answer readiness for {data.siteUrl.replace('https://', '')}. Every number here comes from a live crawl of the published site or a connected account. Scores are internal diagnostics, not Google rankings or AI citation probabilities.</p></div>
        <div className="seo-head-actions">
          <button className="adm-button adm-primary" disabled={busy === 'audit' || data.auditRunning} onClick={() => void runAudit()}><RefreshCw size={16} className={data.auditRunning ? 'adm-spin' : ''} />{data.auditRunning ? 'Audit running…' : 'Run audit now'}</button>
          <span className="seo-muted">{data.audit ? 'Last audit ' + when(data.audit.at) : 'No audit yet'}</span>
        </div>
      </header>
      <nav className="seo-tabs" role="tablist" aria-label="SEO sections">
        {TABS.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}</button>)}
      </nav>
      <div className="seo-body" role="tabpanel">
        {tab === 'overview' && <OverviewTab data={data} onRun={runAudit} />}
        {tab === 'pages' && <PagesTab data={data} routes={routes} admin={admin} act={act} />}
        {tab === 'audit' && <AuditTab data={data} />}
        {tab === 'redirects' && <RedirectsTab data={data} admin={admin} act={act} fail={fail} />}
        {tab === 'sitemap' && <SitemapTab data={data} routes={routes} admin={admin} act={act} />}
        {tab === 'ai' && <AiTab data={data} admin={admin} act={act} />}
        {tab === 'schema' && <SchemaTab data={data} fail={fail} />}
        {tab === 'performance' && <PerformanceTab data={data} act={act} busy={busy} />}
        {tab === 'search' && <SearchDataTab data={data} fail={fail} />}
        {tab === 'settings' && <SettingsTab data={data} admin={admin} act={act} />}
        {tab === 'history' && <HistoryTab data={data} admin={admin} act={act} fail={fail} />}
      </div>
    </section>
  );
}

type Act = (key: string, fn: () => Promise<unknown>, ok?: string, purge?: boolean) => Promise<void>;
const Card = ({title, children, aside}: {title: ReactNode; children: ReactNode; aside?: ReactNode}) => <article className="seo-card"><div className="seo-card-head"><h3>{title}</h3>{aside}</div>{children}</article>;
const Empty = ({children}: {children: ReactNode}) => <p className="seo-empty">{children}</p>;

/* ───────── Overview ───────── */
function OverviewTab({data, onRun}: {data: Overview; onRun: () => void}) {
  const a = data.audit;
  if (!a) return <Card title="No audit yet"><Empty>Run the first audit to crawl every sitemap URL and score the site.</Empty><button className="adm-button adm-primary" onClick={onRun}>Run audit now</button></Card>;
  const max = Math.max(...data.trend.map(t => t.overall), 100);
  const failCount = a.findings.filter(f => f.state === 'fail').reduce((n, f) => n + f.pages.length, 0);
  const warnCount = a.findings.filter(f => f.state === 'warn').reduce((n, f) => n + f.pages.length, 0);
  return <div className="seo-grid">
    <Card title="SEO health (internal diagnostic)">
      <div className="seo-score-row">
        <div className={'seo-score seo-' + tone(a.score.overall)}><strong>{a.score.overall}</strong><span>/ 100</span></div>
        <ul className="seo-cats">{Object.entries(a.score.categories).map(([k, v]) => <li key={k}><span>{data.categoryLabels[k]} <small>({data.config.weights[k]}%)</small></span><span className="seo-bar"><i className={'seo-' + tone(v.score)} style={{width: (v.score ?? 0) + '%'}} /></span><b>{v.score ?? 'n/a'}</b></li>)}</ul>
      </div>
      <p className="seo-muted">{failCount} failed checks and {warnCount} warnings across {a.counts.pages} URLs. Crawled in {Math.round(a.durationMs / 1000)} s.</p>
    </Card>
    <Card title="Site inventory">
      <dl className="seo-stats">
        {([['Pages crawled', a.counts.pages], ['Indexable', a.counts.indexable], ['Non-indexable', a.counts.nonIndexable], ['Missing titles', a.counts.missingTitle], ['Missing descriptions', a.counts.missingDescription], ['Duplicate titles', a.counts.duplicateTitles], ['Duplicate descriptions', a.counts.duplicateDescriptions], ['Canonical issues', a.counts.canonicalIssues], ['Invalid structured data', a.counts.schemaInvalid], ['Broken internal links', a.counts.broken], ['Orphan pages', a.orphans.length], ['Redirect rules', data.config.redirects.length]] as [string, number][]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </Card>
    <Card title="Score trend">{data.trend.length < 2 ? <Empty>The trend appears after the second audit. Audits run daily at {data.config.global.monitorHourUtc}:00 UTC.</Empty> : <svg className="seo-trend" viewBox={'0 0 ' + (data.trend.length * 12) + ' 60'} preserveAspectRatio="none" role="img" aria-label="SEO score trend"><polyline fill="none" stroke="currentColor" strokeWidth="2" points={data.trend.map((t, i) => (i * 12 + 6) + ',' + (58 - t.overall / max * 54)).join(' ')} /></svg>}
      {data.regressions.length > 0 && <ul className="seo-list">{data.regressions.map(r => <li key={r.id} className="seo-fail-text"><AlertTriangle size={14} /> Regression {r.resourceId} on {when(r.createdAt)}</li>)}</ul>}
    </Card>
    <Card title="Integrations">
      <ul className="seo-list">{Object.entries(data.integrations).map(([k, v]) => <li key={k}>{v.connected ? <CheckCircle2 size={15} className="seo-pass" /> : <XCircle size={15} className="seo-fail" />}<b>{({searchConsole: 'Google Search Console', analytics: 'Google Analytics 4', bing: 'Bing Webmaster Tools', pageSpeed: 'PageSpeed Insights', indexNow: 'IndexNow (Bing, Yandex, Seznam, Naver)'} as Record<string, string>)[k] || k}</b><span className="seo-muted">{v.connected ? 'Connected' : 'Connection required: ' + v.needs}</span></li>)}</ul>
    </Card>
    <Card title="AI referrals, last 30 days">{data.aiReferrals.total ? <ul className="seo-list">{Object.entries(data.aiReferrals.bySource).sort((x, y) => y[1] - x[1]).map(([s, n]) => <li key={s}><b>{s}</b><span>{n} visits</span></li>)}</ul> : <Empty>No visits from AI assistants recorded yet. Counting started with this release; it measures actual clicks from ChatGPT, Perplexity, Gemini, Copilot, Claude and others.</Empty>}</Card>
    <Card title="Recent changes">{data.history.length ? <ul className="seo-list">{data.history.slice(0, 6).map(h => <li key={h.id}><span>{h.summary}</span><span className="seo-muted">{h.by}, {when(h.at)}</span></li>)}</ul> : <Empty>No SEO changes yet.</Empty>}</Card>
  </div>;
}

/* ───────── Pages ───────── */
function PagesTab({data, routes, admin, act}: {data: Overview; routes: Route[] | null; admin: boolean; act: Act}) {
  const [q, setQ] = useState(''), [cls, setCls] = useState(''), [edit, setEdit] = useState<string | null>(null);
  const reports = useMemo(() => new globalThis.Map((data.audit?.pages || []).map(p => [p.path, p])), [data.audit]);
  const list = useMemo(() => {
    const base: Route[] = routes || (data.audit?.pages || []).map(p => ({path: p.path, title: p.title, source: 'sitemap', classification: 'Public and indexable', registry: false, override: !!data.config.pages[p.path]}));
    return base.filter(r => (!cls || r.classification === cls) && (!q || (r.path + ' ' + r.title).toLowerCase().includes(q.toLowerCase())));
  }, [routes, data, q, cls]);
  const classes = [...new Set((routes || []).map(r => r.classification))];
  const editable = (r: Route) => !['Administrative', 'Private or authenticated', 'Utility or transactional', 'Draft or unpublished', 'Redirected'].includes(r.classification) || !!data.config.pages[r.path];
  return <>
    <div className="seo-toolbar"><div className="seo-search"><Search size={15} /><input aria-label="Search pages" placeholder="Search by path or title" value={q} onChange={e => setQ(e.target.value)} /></div>
      <select aria-label="Filter by classification" value={cls} onChange={e => setCls(e.target.value)}><option value="">All classifications ({routes?.length ?? '…'})</option>{classes.map(c => <option key={c}>{c}</option>)}</select></div>
    <div className="seo-table-wrap"><table className="seo-table"><thead><tr><th>Page</th><th>Classification</th><th>Audit</th><th><span className="adm-sr-only">Actions</span></th></tr></thead><tbody>
      {list.slice(0, 400).map(r => { const rep = reports.get(r.path); const fails = rep?.checks.filter(c => c.state === 'fail').length || 0, warns = rep?.checks.filter(c => c.state === 'warn').length || 0; return <tr key={r.path}>
        <td><a href={data.siteUrl + r.path} target="_blank" rel="noreferrer" className="seo-path">{r.path}</a><small>{rep?.title || r.title}</small>{data.config.pages[r.path] && <span className="seo-chip">Custom SEO</span>}</td>
        <td><span className={'seo-class seo-class-' + r.classification.split(' ')[0].toLowerCase()}>{r.classification}</span>{r.reason && <small>{r.reason}</small>}</td>
        <td>{rep ? <span className="seo-mini">{fails > 0 && <b className="seo-fail-text">{fails} failed</b>} {warns > 0 && <b className="seo-warn-text">{warns} warnings</b>} {!fails && !warns && <b className="seo-pass-text">All checks pass</b>}</span> : <span className="seo-muted">Not crawled</span>}</td>
        <td>{editable(r) && <button className="adm-text-button" onClick={() => setEdit(r.path)}>Edit SEO</button>}</td>
      </tr>; })}
    </tbody></table></div>
    {edit && <PageEditor path={edit} data={data} report={reports.get(edit)} admin={admin} act={act} onClose={() => setEdit(null)} />}
  </>;
}

function PageEditor({path, data, report, act, onClose}: {path: string; data: Overview; report?: PageReport; admin: boolean; act: Act; onClose: () => void}) {
  const cur = data.config.pages[path] || {};
  const [f, setF] = useState<Override>({...cur, secondaryTopics: cur.secondaryTopics || []});
  const set = (k: keyof Override, v: unknown) => setF(x => ({...x, [k]: v}));
  const title = f.title || report?.title || '', desc = f.description || report?.description || '';
  const index = f.robots?.index ?? !/noindex/.test(report?.robots || '');
  const save = () => act('page', async () => { await request('/admin/seo/pages', {method: 'PUT', body: JSON.stringify({path, override: {...f, secondaryTopics: (f.secondaryTopics || []).filter(Boolean)}})}); onClose(); }, 'Saved. The page shows the new SEO within about a minute; IndexNow was notified.', true);
  const reset = () => act('page', async () => { await request('/admin/seo/pages?path=' + encodeURIComponent(path), {method: 'DELETE'}); onClose(); }, 'Reset to the default SEO for this page.', true);
  const field = (k: keyof Override, label: string, max: number, hint: string, area = false) => { const v = String(f[k] ?? ''); return <label className="seo-field"><span>{label} <small className={v.length > max ? 'seo-fail-text' : ''}>{v.length}/{max}</small></span>{area ? <textarea rows={3} value={v} onChange={e => set(k, e.target.value)} placeholder={hint} /> : <input value={v} onChange={e => set(k, e.target.value)} placeholder={hint} />}</label>; };
  return <Drawer open title={'SEO for ' + path} subtitle="Empty fields keep the page's built-in value." onClose={onClose} width={760}
    footer={<div className="seo-actions">{data.config.pages[path] && <button className="adm-button adm-secondary" onClick={() => void reset()}><RotateCcw size={15} />Reset to defaults</button>}<button className="adm-button adm-primary" onClick={() => void save()}>Save SEO</button></div>}>
    <div className="seo-serp" aria-label="Search result preview"><span className="seo-serp-url">{data.siteUrl.replace('https://', '')} › {path.split('/').filter(Boolean).join(' › ')}</span><strong>{title.slice(0, 65)}{title.length > 65 ? '…' : ''}</strong><p>{desc.slice(0, 160)}{desc.length > 160 ? '…' : ''}</p></div>
    {field('title', 'SEO title', 65, report?.title || 'Built-in title')}
    {field('description', 'Meta description', 160, report?.description || 'Built-in description', true)}
    <div className="seo-two">
      <label className="seo-field"><span>Indexing</span><select value={f.robots?.index === undefined ? '' : String(f.robots.index)} onChange={e => set('robots', {...(f.robots || {}), index: e.target.value === '' ? undefined : e.target.value === 'true'})}><option value="">Default ({index ? 'index' : 'noindex'})</option><option value="true">index</option><option value="false">noindex</option></select></label>
      <label className="seo-field"><span>Links</span><select value={f.robots?.follow === false ? 'false' : ''} onChange={e => set('robots', {...(f.robots || {}), follow: e.target.value === 'false' ? false : undefined})}><option value="">follow</option><option value="false">nofollow</option></select></label>
    </div>
    <label className="seo-field"><span>Canonical URL</span><input value={f.canonical || ''} onChange={e => set('canonical', e.target.value)} placeholder={'Default: ' + path + ' (self)'} /></label>
    <label className="seo-check"><input type="checkbox" checked={f.sitemap !== false} onChange={e => set('sitemap', e.target.checked ? undefined : false)} /> Include in the XML sitemap (only when indexable)</label>
    <h4>Social sharing</h4>
    {field('ogTitle', 'Social title', 90, 'Defaults to the SEO title')}
    {field('ogDescription', 'Social description', 200, 'Defaults to the meta description', true)}
    <label className="seo-field"><span>Social image URL (1200×630 recommended)</span><input value={f.ogImage || ''} onChange={e => set('ogImage', e.target.value)} placeholder={data.config.global.defaultOgImage} /></label>
    <h4>Topics and navigation</h4>
    <label className="seo-field"><span>Breadcrumb title</span><input value={f.breadcrumb || ''} onChange={e => set('breadcrumb', e.target.value)} /></label>
    <label className="seo-field"><span>Primary topic (search intent this page should own)</span><input value={f.primaryTopic || ''} onChange={e => set('primaryTopic', e.target.value)} placeholder="e.g. podcast studio rental near Chicago" /></label>
    <label className="seo-field"><span>Secondary topics (comma separated)</span><input value={(f.secondaryTopics || []).join(', ')} onChange={e => set('secondaryTopics', e.target.value.split(',').map(s => s.trimStart()))} /></label>
    {f.primaryTopic && report && <TopicCheck topic={f.primaryTopic} report={report} />}
    {report && <><h4>Audit checks</h4><ul className="seo-checks">{report.checks.map(c => <li key={c.id}><StateIcon s={c.state} /><span>{c.label}</span>{c.detail && <small>{c.detail}</small>}</li>)}</ul>
      <h4>Headings</h4><ol className="seo-headings">{report.headings.map((h, i) => <li key={i} style={{paddingLeft: (Number(h[1]) - 1) * 14}}>{h}</li>)}</ol></>}
    {f.updatedAt && <p className="seo-muted">Last changed by {f.updatedBy} on {when(f.updatedAt)}</p>}
  </Drawer>;
}

/** Content recommendation from real page data: is the primary topic present where it matters? */
function TopicCheck({topic, report}: {topic: string; report: PageReport}) {
  const words = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const has = (s: string) => words.length > 0 && words.every(w => s.toLowerCase().includes(w));
  const rows: [string, boolean][] = [['In the title', has(report.title)], ['In the meta description', has(report.description)], ['In the H1', has(report.h1.join(' '))], ['In an H2/H3 heading', report.headings.some(h => /^H[23]/.test(h) && has(h))]];
  return <ul className="seo-checks">{rows.map(([l, ok]) => <li key={l}><StateIcon s={ok ? 'pass' : 'warn'} /><span>Primary topic {l.toLowerCase()}</span></li>)}</ul>;
}

/* ───────── Audit center ───────── */
function AuditTab({data}: {data: Overview}) {
  const [open, setOpen] = useState<string | null>(null);
  const [cat, setCat] = useState('');
  const a = data.audit;
  if (!a) return <Empty>Run an audit first.</Empty>;
  const list = a.findings.filter(f => !cat || f.category === cat);
  return <div className="seo-stack">
    <div className="seo-toolbar"><select aria-label="Filter by category" value={cat} onChange={e => setCat(e.target.value)}><option value="">All categories</option>{Object.entries(data.categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><span className="seo-muted">{list.length} findings</span></div>
    {list.length === 0 && <Empty>No open findings in this category.</Empty>}
    {list.map(f => { const key = f.id + f.state; return <article key={key} className={'seo-finding seo-p-' + f.priority}>
      <button className="seo-finding-head" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}><StateIcon s={f.state} /><span className={'seo-prio seo-prio-' + f.priority}>{f.priority}</span><b>{f.label}</b><span className="seo-muted">{f.categoryLabel}</span><span className="seo-count">{f.pages.length} {f.pages.length === 1 ? 'URL' : 'URLs'}</span></button>
      {open === key && <ul className="seo-finding-pages">{f.pages.slice(0, 200).map(p => <li key={p.path}><a href={p.path === '(site)' ? data.siteUrl : data.siteUrl + p.path} target="_blank" rel="noreferrer">{p.path}</a>{p.detail && <small>{p.detail}</small>}</li>)}</ul>}
    </article>; })}
    <Card title={'Broken internal links (' + a.broken.length + ')'}>{a.broken.length ? <ul className="seo-list">{a.broken.slice(0, 100).map((b, i) => <li key={i}><span>{b.from} → <b>{b.to}</b></span><span className="seo-fail-text">{b.status || 'no response'}</span></li>)}</ul> : <Empty>None found.</Empty>}</Card>
    <Card title={'Links that go through a redirect (' + a.redirectedLinks.length + ')'}>{a.redirectedLinks.length ? <ul className="seo-list">{a.redirectedLinks.slice(0, 100).map((b, i) => <li key={i}><span>{b.from} → {b.to}</span><span className="seo-muted">{b.status}</span></li>)}</ul> : <Empty>None found.</Empty>}</Card>
    <Card title={'Orphan pages (' + a.orphans.length + ')'}><p className="seo-muted">No contextual links from other pages (site navigation does not count). Link to them from related pages.</p>{a.orphans.length ? <ul className="seo-list">{a.orphans.map(o => <li key={o}><a href={data.siteUrl + o} target="_blank" rel="noreferrer">{o}</a></li>)}</ul> : <Empty>None.</Empty>}</Card>
    <Card title="Weakly linked pages"><ul className="seo-list">{[...a.pages].filter(p => p.path !== '/').sort((x, y) => x.inbound - y.inbound).slice(0, 15).map(p => <li key={p.path}><span>{p.path}</span><span className="seo-muted">{p.inbound} contextual inbound links</span></li>)}</ul></Card>
    <Card title="Most linked pages"><ul className="seo-list">{[...a.pages].sort((x, y) => y.inbound - x.inbound).slice(0, 10).map(p => <li key={p.path}><span>{p.path}</span><span className="seo-muted">{p.inbound} contextual inbound links</span></li>)}</ul></Card>
  </div>;
}

/* ───────── Redirects ───────── */
function RedirectsTab({data, admin, act, fail}: {data: Overview; admin: boolean; act: Act; fail: (e: unknown) => void}) {
  const blank = {id: '', from: '', to: '', status: 301, note: ''};
  const [f, setF] = useState(blank);
  const [csv, setCsv] = useState('');
  const rules = data.config.redirects;
  const save = () => act('redirect', async () => { await request('/admin/seo/redirects', {method: 'POST', body: JSON.stringify({...f, id: f.id || undefined})}); setF(blank); }, f.id ? 'Redirect updated.' : 'Redirect added. It is live within a minute.');
  const exportCsv = async () => { try { const t = authToken(); const r = await fetch(apiUrl('/admin/seo/redirects/export', API), {credentials: 'include', cache: 'no-store', headers: t ? {Authorization: 'Bearer ' + t} : {}}); if (!r.ok) throw new Error('Export failed (' + r.status + ')'); const url = URL.createObjectURL(new Blob([await r.text()], {type: 'text/csv'})); const link = document.createElement('a'); link.href = url; link.download = 'redirects.csv'; link.click(); URL.revokeObjectURL(url); } catch (e) { fail(e); } };
  return <div className="seo-stack">
    {(data.redirectHealth.loops.length > 0 || data.redirectHealth.chains.length > 0) && <div className="seo-alert seo-alert-warn"><AlertTriangle size={16} />{data.redirectHealth.chains.length} redirect chains: {data.redirectHealth.chains.slice(0, 3).map(c => c.join(' → ')).join('; ')}. Point the first URL straight at the final one.</div>}
    {admin ? <Card title={f.id ? 'Edit redirect' : 'Add a redirect'}>
      <div className="seo-redirect-form">
        <label className="seo-field"><span>Old path</span><input value={f.from} onChange={e => setF({...f, from: e.target.value})} placeholder="/old-page/" /></label>
        <label className="seo-field"><span>Type</span><select value={f.status} onChange={e => setF({...f, status: Number(e.target.value)})}><option value={301}>301 Moved permanently</option><option value={308}>308 Permanent (keeps method)</option><option value={302}>302 Found (temporary)</option><option value={307}>307 Temporary (keeps method)</option><option value={410}>410 Gone (removed for good)</option></select></label>
        {f.status !== 410 && <label className="seo-field"><span>Destination</span><input value={f.to} onChange={e => setF({...f, to: e.target.value})} placeholder="/new-page/ or https://…" /></label>}
        <label className="seo-field"><span>Note</span><input value={f.note} onChange={e => setF({...f, note: e.target.value})} /></label>
      </div>
      <div className="seo-actions">{f.id && <button className="adm-button adm-secondary" onClick={() => setF(blank)}>Cancel</button>}<button className="adm-button adm-primary" disabled={!f.from || (f.status !== 410 && !f.to)} onClick={() => void save()}>{f.id ? 'Save redirect' : 'Add redirect'}</button></div>
    </Card> : <p className="seo-muted">Only admins can change redirects.</p>}
    <Card title={'Redirect rules (' + rules.length + ')'} aside={<div className="seo-actions"><button className="adm-button adm-secondary" onClick={() => void exportCsv()}><Download size={15} />Export CSV</button></div>}>
      {rules.length ? <table className="seo-table"><thead><tr><th>From</th><th>Type</th><th>To</th><th>Note</th><th /></tr></thead><tbody>{rules.map(r => <tr key={r.id}><td className="seo-path">{r.from}</td><td>{r.status}</td><td>{r.to || 'Gone'}</td><td><small>{r.note}</small><small>{r.createdBy}, {when(r.createdAt)}</small></td><td>{admin && <div className="seo-actions"><button className="adm-text-button" onClick={() => setF({id: r.id, from: r.from, to: r.to, status: r.status, note: r.note || ''})}>Edit</button><button className="adm-icon adm-danger" aria-label={'Delete redirect ' + r.from} onClick={() => { if (window.confirm('Delete the redirect for ' + r.from + '?')) void act('redirect', () => request('/admin/seo/redirects/' + r.id, {method: 'DELETE'}), 'Redirect deleted.'); }}><Trash2 size={15} /></button></div>}</td></tr>)}</tbody></table> : <Empty>No dashboard redirects. The site also keeps its built-in migration redirects (WordPress paths) in code.</Empty>}
    </Card>
    {admin && <Card title="Import from CSV"><p className="seo-muted">Columns: from, to, status, note. Existing rules for the same path are replaced. Invalid rows stop the whole import, so nothing half-imports.</p>
      <label className="seo-field"><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} /></label>
      <textarea className="seo-code" rows={5} value={csv} onChange={e => setCsv(e.target.value)} placeholder={'from,to,status,note\n/old/,/new/,301,Renamed'} />
      <div className="seo-actions"><button className="adm-button adm-primary" disabled={!csv.trim()} onClick={() => void act('import', async () => { const r = await request<{added: number; updated: number}>('/admin/seo/redirects/import', {method: 'POST', body: JSON.stringify({csv})}); setCsv(''); return r; }, 'Redirects imported.')}><Upload size={15} />Import</button></div>
    </Card>}
  </div>;
}

/* ───────── Sitemap and indexing ───────── */
function SitemapTab({data, routes, admin, act}: {data: Overview; routes: Route[] | null; admin: boolean; act: Act}) {
  const [urls, setUrls] = useState<{loc: string; lastmod?: string; image: boolean}[] | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => { void fetch('/sitemap.xml', {cache: 'no-store'}).then(r => r.text()).then(x => { if (!/<urlset/.test(x)) setProblem('The sitemap did not return a valid urlset.'); setUrls([...x.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => ({loc: (m[1].match(/<loc>([^<]+)/) || [])[1] || '', lastmod: (m[1].match(/<lastmod>([^<]+)/) || [])[1], image: /<image:image>/.test(m[1])}))); }).catch(() => setProblem('Could not load /sitemap.xml')); }, []);
  const excluded = (routes || []).filter(r => r.classification !== 'Public and indexable');
  const dup = urls ? urls.length - new Set(urls.map(u => u.loc)).size : 0;
  return <div className="seo-stack">
    <div className="seo-grid">
      <Card title="Sitemap health"><ul className="seo-checks">
        <li><StateIcon s={problem ? 'fail' : urls ? 'pass' : 'na'} /><span>{problem || (urls ? 'Valid XML sitemap with ' + urls.length + ' URLs (limit 50,000)' : 'Loading…')}</span></li>
        <li><StateIcon s={dup ? 'fail' : 'pass'} /><span>{dup ? dup + ' duplicate URLs' : 'No duplicate URLs'}</span></li>
        <li><StateIcon s={urls && urls.every(u => u.loc.startsWith(data.siteUrl)) ? 'pass' : 'warn'} /><span>All URLs absolute on the canonical host</span></li>
        <li><StateIcon s="pass" /><span>Redirected, noindex, canonical-duplicate and empty archive URLs are excluded automatically</span></li>
      </ul><p className="seo-muted"><a href="/sitemap.xml" target="_blank" rel="noreferrer">sitemap.xml <ExternalLink size={12} /></a> · <a href="/robots.txt" target="_blank" rel="noreferrer">robots.txt <ExternalLink size={12} /></a> · <a href="/llms.txt" target="_blank" rel="noreferrer">llms.txt <ExternalLink size={12} /></a> · <a href="/llms-full.txt" target="_blank" rel="noreferrer">llms-full.txt <ExternalLink size={12} /></a></p>
        <p className="seo-muted">The sitemap regenerates itself within a minute of any publish, unpublish, slug change, redirect or SEO change.</p></Card>
      <Card title="IndexNow" aside={admin && <button className="adm-button adm-primary" onClick={() => void act('indexnow', () => request('/admin/seo/indexnow', {method: 'POST', body: JSON.stringify({all: true})}), 'Submitted every sitemap URL to IndexNow.')}><Send size={15} />Submit all sitemap URLs</button>}>
        <p className="seo-muted">Bing, Yandex, Seznam and Naver are notified automatically when an article or page is published, updated, moved or withdrawn, and when page SEO changes. Google does not use IndexNow; Google reads the sitemap. Submission is not a guarantee of indexing. Key file: <a href={'/indexnow-key.txt'} target="_blank" rel="noreferrer">/indexnow-key.txt</a> ({data.config.indexNow.enabled ? 'enabled' : 'disabled'}).</p>
        {data.indexNowLog.length ? <ul className="seo-list">{data.indexNowLog.map(l => <li key={l.id}><StateIcon s={l.resourceId === 'ok' ? 'pass' : 'fail'} /><span>{l.details?.count} URLs · {l.details?.reason}{l.details?.error ? ' · ' + l.details.error : ''}</span><span className="seo-muted">{l.details?.httpStatus || ''} · {when(l.createdAt)}</span></li>)}</ul> : <Empty>No submissions yet.</Empty>}
      </Card>
    </div>
    <Card title={'Included URLs (' + (urls?.length ?? '…') + ')'}><div className="seo-scroll"><table className="seo-table"><thead><tr><th>URL</th><th>Last modified</th><th>Image</th></tr></thead><tbody>{(urls || []).map(u => <tr key={u.loc}><td className="seo-path">{u.loc.replace(data.siteUrl, '')}</td><td>{u.lastmod ? new Date(u.lastmod).toLocaleDateString() : <span className="seo-muted">not set</span>}</td><td>{u.image ? 'yes' : ''}</td></tr>)}</tbody></table></div></Card>
    <Card title={'Excluded URLs (' + excluded.length + ')'}><div className="seo-scroll"><table className="seo-table"><thead><tr><th>Path</th><th>Why</th></tr></thead><tbody>{excluded.map(r => <tr key={r.path}><td className="seo-path">{r.path}</td><td><b>{r.classification}</b> <small>{r.reason}</small></td></tr>)}</tbody></table></div></Card>
  </div>;
}

/* ───────── AI search and crawlers ───────── */
function AiTab({data, admin, act}: {data: Overview; admin: boolean; act: Act}) {
  const c = data.config.crawlers;
  const [extra, setExtra] = useState(c.extraBlocked.join(', '));
  const save = (patch: Partial<Config['crawlers']>) => act('crawlers', () => request('/admin/seo/crawlers', {method: 'PUT', body: JSON.stringify(patch)}), 'Crawler policy saved. robots.txt updates within 5 minutes; AI providers re-read it within about a day.', true);
  const G: [keyof Config['crawlers'], string, string][] = [
    ['aiSearch', 'AI search indexes', 'Lets ChatGPT search, Claude search and Perplexity index public pages so they can show and cite the site in answers.'],
    ['aiUser', 'User-requested fetches', 'Lets ChatGPT, Claude and Perplexity open a page when a user asks about it. Some operators say robots.txt may not apply to user-initiated fetches.'],
    ['gemini', 'Gemini (Google-Extended)', 'Google-Extended covers both Gemini model training and grounding answers in the Gemini app. It does not affect Google Search or AI Overviews.'],
    ['aiTraining', 'AI model training', 'GPTBot, ClaudeBot, Applebot-Extended, CCBot and Meta-ExternalAgent collect pages for model training only. Blocking them does not remove the site from AI search. This is a business decision.'],
  ];
  const ai = data.audit?.score.categories.ai;
  return <div className="seo-stack">
    <Card title="Crawler policy">
      <p className="seo-muted">Search engines (Googlebot, Bingbot, Applebot, DuckDuckBot) are always allowed on public pages. Private areas are always closed. Changes are recorded in the change history.</p>
      <ul className="seo-toggles">{G.map(([k, label, help]) => <li key={k}><label><input type="checkbox" disabled={!admin} checked={Boolean(c[k])} onChange={e => void save({[k]: e.target.checked})} /><b>{label}</b></label><p>{help}</p><code>{(data.crawlerGroups[k] || []).join(', ')}</code></li>)}
        <li><label><input type="checkbox" disabled={!admin} checked={c.llmsTxt} onChange={e => void save({llmsTxt: e.target.checked})} /><b>Publish llms.txt and llms-full.txt</b></label><p>Plain-text summaries for AI assistants, generated from the live pages, prices and FAQs. An optional convention, not a ranking factor.</p></li></ul>
      {admin && <div className="seo-redirect-form"><label className="seo-field"><span>Also block these user agents (comma separated)</span><input value={extra} onChange={e => setExtra(e.target.value)} placeholder="e.g. Bytespider, Amazonbot" /></label><div className="seo-actions"><button className="adm-button adm-secondary" onClick={() => void save({extraBlocked: extra.split(',').map(x => x.trim()).filter(Boolean)})}>Save blocked list</button></div></div>}
    </Card>
    <div className="seo-grid">
      <Card title="AI answer readiness (from the audit)">{ai ? <><div className={'seo-score seo-' + tone(ai.score)}><strong>{ai.score ?? 'n/a'}</strong><span>/ 100</span></div><p className="seo-muted">{ai.pass} passed, {ai.warn} warnings, {ai.fail} failed. Checks: content in server HTML, link to the business entity, FAQ or question headings, llms.txt.</p></> : <Empty>Run an audit.</Empty>}</Card>
      <Card title={'AI referral visits, last ' + data.aiReferrals.days + ' days'}>{data.aiReferrals.total ? <><ul className="seo-list">{Object.entries(data.aiReferrals.bySource).sort((x, y) => y[1] - x[1]).map(([s, n]) => <li key={s}><b>{s}</b><span>{n}</span></li>)}</ul><h4>Top landing pages</h4><ul className="seo-list">{data.aiReferrals.topPages.map(([p, n]) => <li key={p}><span>{p}</span><span>{n}</span></li>)}</ul></> : <Empty>No AI referral visits recorded yet. These are actual clicks from AI assistants (referrer or utm_source), counted without cookies or personal data. Citations that do not produce a click cannot be measured here.</Empty>}</Card>
    </div>
  </div>;
}

/* ───────── Structured data ───────── */
function SchemaTab({data, fail}: {data: Overview; fail: (e: unknown) => void}) {
  const [path, setPath] = useState('/');
  const [res, setRes] = useState<{status: number; entities: {type: string; id?: string; missing: string[]}[]; duplicates: string[]; warnings: string[]; blocks: unknown[]; richResultsTest: string; schemaValidator: string} | null>(null);
  const [loading, setLoading] = useState(false);
  const inspect = async () => { setLoading(true); try { setRes(await request('/admin/seo/schema?path=' + encodeURIComponent(path))); } catch (e) { fail(e); } finally { setLoading(false); } };
  const invalid = (data.audit?.pages || []).filter(p => p.schemaErrors.length);
  const types = new globalThis.Map<string, number>(); for (const p of data.audit?.pages || []) for (const t of p.schemaTypes) types.set(t, (types.get(t) || 0) + 1);
  return <div className="seo-stack">
    <Card title="Inspect a page"><div className="seo-toolbar"><input className="seo-input" value={path} onChange={e => setPath(e.target.value)} aria-label="Page path" /><button className="adm-button adm-primary" disabled={loading} onClick={() => void inspect()}>{loading ? 'Inspecting…' : 'Inspect structured data'}</button></div>
      {res && <>
        <ul className="seo-checks">{res.entities.map((e, i) => <li key={i}><StateIcon s={e.missing.length ? 'fail' : 'pass'} /><b>{e.type}</b>{e.id && <small>{e.id}</small>}{e.missing.length > 0 && <small className="seo-fail-text">Missing: {e.missing.join(', ')}</small>}</li>)}</ul>
        {res.duplicates.length > 0 && <p className="seo-warn-text">Repeated @id on this page: {res.duplicates.join(', ')} (allowed when the same entity is referenced in several blocks).</p>}
        {res.warnings.length > 0 && <ul className="seo-list">{res.warnings.map(w => <li key={w} className="seo-warn-text">{w}</li>)}</ul>}
        <p className="seo-muted">Valid Schema.org markup is not the same as Google rich-result eligibility. Check both: <a href={res.richResultsTest} target="_blank" rel="noreferrer">Google Rich Results Test <ExternalLink size={12} /></a> · <a href={res.schemaValidator} target="_blank" rel="noreferrer">Schema.org validator <ExternalLink size={12} /></a></p>
        <details><summary>Raw JSON-LD ({res.blocks.length} blocks)</summary><pre className="seo-code">{JSON.stringify(res.blocks, null, 2)}</pre></details>
      </>}
    </Card>
    <div className="seo-grid">
      <Card title="Schema types across the site"><ul className="seo-list">{[...types].sort((a, b) => b[1] - a[1]).map(([t, n]) => <li key={t}><b>{t}</b><span>{n} pages</span></li>)}</ul></Card>
      <Card title={'Pages with schema errors (' + invalid.length + ')'}>{invalid.length ? <ul className="seo-list">{invalid.map(p => <li key={p.path}><span>{p.path}</span><small className="seo-fail-text">{p.schemaErrors.slice(0, 3).join('; ')}</small></li>)}</ul> : <Empty>None. Entities share one business @id ({data.siteUrl}/#business) and one website @id.</Empty>}</Card>
    </div>
  </div>;
}

/* ───────── Performance ───────── */
function PerformanceTab({data, act, busy}: {data: Overview; act: Act; busy: string}) {
  const [path, setPath] = useState('/');
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile');
  const results = Object.values(data.psi || {}).sort((a, b) => b.at.localeCompare(a.at));
  const slow = [...(data.audit?.pages || [])].sort((a, b) => b.ms - a.ms).slice(0, 10);
  const ms = (v?: number) => v === undefined ? 'n/a' : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v + ' ms';
  return <div className="seo-stack">
    <Card title="Run PageSpeed Insights (Lighthouse + Chrome field data)"><div className="seo-toolbar"><input className="seo-input" value={path} onChange={e => setPath(e.target.value)} aria-label="Page path" /><select value={strategy} onChange={e => setStrategy(e.target.value as 'mobile')}><option value="mobile">Mobile</option><option value="desktop">Desktop</option></select><button className="adm-button adm-primary" disabled={busy === 'psi'} onClick={() => void act('psi', () => request('/admin/seo/pagespeed', {method: 'POST', body: JSON.stringify({path, strategy})}), 'PageSpeed result saved.')}>{busy === 'psi' ? 'Running (up to a minute)…' : 'Run test'}</button></div>
      <p className="seo-muted">Field data (CrUX, 75th percentile of real Chrome users) is what Google uses for Core Web Vitals. Targets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Low-traffic pages may have no field data.</p></Card>
    {results.length === 0 ? <Empty>No PageSpeed runs saved yet.</Empty> : <div className="seo-grid">{results.map(r => <Card key={r.path + r.strategy} title={r.path + ' · ' + r.strategy} aside={<span className="seo-muted">{when(r.at)}</span>}>
      <div className="seo-psi">{Object.entries(r.scores).map(([k, v]) => <div key={k} className={'seo-score seo-small seo-' + tone(v)}><strong>{v ?? '–'}</strong><span>{k}</span></div>)}</div>
      {r.field ? <p><b>Field (p75):</b> LCP {ms(r.field.lcpMs)} · INP {ms(r.field.inpMs)} · CLS {r.field.cls ?? 'n/a'} {r.field.category && <span className="seo-chip">{r.field.category}</span>}</p> : <p className="seo-muted">No field data for this URL (not enough Chrome traffic).</p>}
      <p><b>Lab:</b> LCP {r.lab.lcp} · CLS {r.lab.cls} · TBT {r.lab.tbt} · FCP {r.lab.fcp}</p>
      {r.opportunities.length > 0 && <ul className="seo-list">{r.opportunities.map(o => <li key={o.title}><span>{o.title}</span><span className="seo-muted">{o.savings}</span></li>)}</ul>}
      {r.failedA11y.length > 0 && <><h4>Accessibility failures</h4><ul className="seo-list">{r.failedA11y.map(t => <li key={t} className="seo-fail-text">{t}</li>)}</ul></>}
    </Card>)}</div>}
    <Card title="Slowest server responses in the last audit"><ul className="seo-list">{slow.map(p => <li key={p.path}><span>{p.path}</span><span className={p.ms > 1800 ? 'seo-fail-text' : p.ms > 800 ? 'seo-warn-text' : 'seo-muted'}>{p.ms} ms</span></li>)}</ul></Card>
  </div>;
}

/* ───────── Search data (connected accounts only) ───────── */
const NotConnected = ({x}: {x: Integration}) => <div className="seo-alert seo-alert-warn"><AlertTriangle size={16} />Connection required. {x.needs} Add the values in Settings → System settings → Search integrations.</div>;

function SearchDataTab({data, fail}: {data: Overview; fail: (e: unknown) => void}) {
  const [gsc, setGsc] = useState<{range: {start: string; end: string}; totals: {clicks: number; impressions: number; ctr: number; position: number} | null; queries: {keys?: string[]; clicks: number; impressions: number; ctr: number; position: number}[]; pages: {keys?: string[]; clicks: number; impressions: number; position: number}[]; devices: {keys?: string[]; clicks: number; impressions: number}[]; countries: {keys?: string[]; clicks: number; impressions: number}[]} | null>(null);
  const [ga, setGa] = useState<{organic: {source: string; sessions: number; conversions: number}[]; ai: {source: string; sessions: number; conversions: number}[]} | null>(null);
  const [bing, setBing] = useState<{queries: {Query: string; Clicks: number; Impressions: number; AvgImpressionPosition: number}[]} | null>(null);
  const i = data.integrations;
  const load = async <T,>(url: string, set: (v: T) => void) => { try { set(await request<T>(url)); } catch (e) { fail(e); } };
  return <div className="seo-stack">
    <Card title="Google Search Console" aside={i.searchConsole.connected && <button className="adm-button adm-secondary" onClick={() => void load('/admin/seo/integrations/search-console', setGsc)}>Load last 28 days</button>}>
      {!i.searchConsole.connected ? <NotConnected x={i.searchConsole} /> : !gsc ? <Empty>Click Load to fetch clicks, impressions, CTR and positions.</Empty> : <>
        {gsc.totals && <dl className="seo-stats"><div><dt>Clicks</dt><dd>{gsc.totals.clicks}</dd></div><div><dt>Impressions</dt><dd>{gsc.totals.impressions}</dd></div><div><dt>CTR</dt><dd>{(gsc.totals.ctr * 100).toFixed(1)}%</dd></div><div><dt>Avg position</dt><dd>{gsc.totals.position.toFixed(1)}</dd></div></dl>}
        <div className="seo-grid"><table className="seo-table"><thead><tr><th>Query</th><th>Clicks</th><th>Impr.</th><th>Pos.</th></tr></thead><tbody>{gsc.queries.map(r => <tr key={r.keys?.[0]}><td>{r.keys?.[0]}</td><td>{r.clicks}</td><td>{r.impressions}</td><td>{r.position.toFixed(1)}</td></tr>)}</tbody></table>
        <table className="seo-table"><thead><tr><th>Page</th><th>Clicks</th><th>Impr.</th></tr></thead><tbody>{gsc.pages.map(r => <tr key={r.keys?.[0]}><td className="seo-path">{r.keys?.[0]?.replace(data.siteUrl, '')}</td><td>{r.clicks}</td><td>{r.impressions}</td></tr>)}</tbody></table></div>
        <p className="seo-muted">Devices: {gsc.devices.map(d => d.keys?.[0] + ' ' + d.clicks).join(' · ')} · Countries: {gsc.countries.slice(0, 5).map(d => d.keys?.[0] + ' ' + d.clicks).join(' · ')}</p></>}
    </Card>
    <Card title="Google Analytics 4" aside={i.analytics.connected && <button className="adm-button adm-secondary" onClick={() => void load('/admin/seo/integrations/analytics', setGa)}>Load last 28 days</button>}>
      {!i.analytics.connected ? <NotConnected x={i.analytics} /> : !ga ? <Empty>Click Load for organic and AI-referral sessions and conversions.</Empty> : <div className="seo-grid"><ul className="seo-list">{ga.organic.map(r => <li key={r.source}><b>{r.source}</b><span>{r.sessions} sessions · {r.conversions} conversions</span></li>)}</ul><ul className="seo-list">{ga.ai.length ? ga.ai.map(r => <li key={r.source}><b>{r.source}</b><span>{r.sessions} sessions</span></li>) : <li>No AI referral sessions.</li>}</ul></div>}
    </Card>
    <Card title="Bing Webmaster Tools" aside={i.bing.connected && <button className="adm-button adm-secondary" onClick={() => void load('/admin/seo/integrations/bing', setBing)}>Load queries</button>}>
      {!i.bing.connected ? <NotConnected x={i.bing} /> : !bing ? <Empty>Click Load for Bing queries.</Empty> : <table className="seo-table"><thead><tr><th>Query</th><th>Clicks</th><th>Impr.</th><th>Pos.</th></tr></thead><tbody>{bing.queries.map(q => <tr key={q.Query}><td>{q.Query}</td><td>{q.Clicks}</td><td>{q.Impressions}</td><td>{q.AvgImpressionPosition}</td></tr>)}</tbody></table>}
    </Card>
  </div>;
}

/* ───────── Global settings ───────── */
function SettingsTab({data, admin, act}: {data: Overview; admin: boolean; act: Act}) {
  const g = data.config.global;
  const [f, setF] = useState({...g, verification: {...g.verification}, weights: {...data.config.weights}, indexNowEnabled: data.config.indexNow.enabled});
  const total = Object.values(f.weights).reduce((a, b) => a + Number(b || 0), 0);
  return <div className="seo-stack">
    <Card title="Defaults">
      <label className="seo-field"><span>Title suffix (added when the title fits in 65 characters)</span><input disabled={!admin} value={f.titleSuffix} onChange={e => setF({...f, titleSuffix: e.target.value})} /></label>
      <label className="seo-field"><span>Default meta description</span><textarea disabled={!admin} rows={2} value={f.defaultDescription} onChange={e => setF({...f, defaultDescription: e.target.value})} /></label>
      <label className="seo-field"><span>Default social image (https)</span><input disabled={!admin} value={f.defaultOgImage} onChange={e => setF({...f, defaultOgImage: e.target.value})} /></label>
      <p className="seo-muted">Business name, address, phone, hours, geo-coordinates and social profiles come from the business record shown in the site footer and structured data. They match the Google Business Profile.</p>
    </Card>
    <Card title="Search engine verification">
      <div className="seo-two">{(['google', 'bing', 'yandex', 'pinterest'] as const).map(k => <label key={k} className="seo-field"><span>{k[0].toUpperCase() + k.slice(1)} verification code</span><input disabled={!admin} value={f.verification[k] || ''} onChange={e => setF({...f, verification: {...f.verification, [k]: e.target.value}})} placeholder="content value of the meta tag" /></label>)}</div>
    </Card>
    <Card title="Monitoring and scoring">
      <div className="seo-two"><label className="seo-field"><span>Daily audit hour (UTC)</span><input disabled={!admin} type="number" min={0} max={23} value={f.monitorHourUtc} onChange={e => setF({...f, monitorHourUtc: Number(e.target.value)})} /></label>
        <label className="seo-check"><input disabled={!admin} type="checkbox" checked={f.indexNowEnabled} onChange={e => setF({...f, indexNowEnabled: e.target.checked})} /> Automatic IndexNow submissions</label></div>
      <p className="seo-muted">Score weights (total {total}%). Categories with no applicable checks are left out of the score.</p>
      <div className="seo-weights">{Object.entries(f.weights).map(([k, v]) => <label key={k} className="seo-field"><span>{data.categoryLabels[k]}</span><input disabled={!admin} type="number" min={0} max={100} value={v} onChange={e => setF({...f, weights: {...f.weights, [k]: Number(e.target.value)}})} /></label>)}</div>
    </Card>
    {admin && <div className="seo-actions"><button className="adm-button adm-primary" onClick={() => void act('global', () => request('/admin/seo/global', {method: 'PUT', body: JSON.stringify(f)}), 'Global SEO settings saved.', true)}>Save settings</button></div>}
  </div>;
}

/* ───────── Change history ───────── */
function HistoryTab({data, admin, act, fail}: {data: Overview; admin: boolean; act: Act; fail: (e: unknown) => void}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [view, setView] = useState<{summary: string; snapshot: unknown} | null>(null);
  useEffect(() => { void request<HistoryRow[]>('/admin/seo/history').then(setRows).catch(fail); }, [fail, data]);
  return <Card title="Change history">
    <p className="seo-muted">Every SEO change stores the full previous configuration. Rolling back is itself recorded, so it can be undone.</p>
    {!rows ? <p className="seo-muted">Loading…</p> : rows.length === 0 ? <Empty>No changes yet.</Empty> : <table className="seo-table"><thead><tr><th>Change</th><th>By</th><th>When</th><th /></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.summary}<small>{r.kind}</small></td><td>{r.by}</td><td>{when(r.at)}</td><td><div className="seo-actions"><button className="adm-text-button" onClick={() => void request<{summary: string; snapshot: unknown}>('/admin/seo/history/' + r.id).then(setView).catch(fail)}>View previous</button>{admin && <button className="adm-text-button" onClick={() => { if (window.confirm('Restore the SEO configuration as it was before “' + r.summary + '”?')) void act('rollback', () => request('/admin/seo/history/' + r.id + '/rollback', {method: 'POST'}), 'Rolled back.', true); }}><RotateCcw size={14} /> Roll back</button>}</div></td></tr>)}</tbody></table>}
    {view && <Drawer open title="Configuration before this change" subtitle={view.summary} onClose={() => setView(null)} width={760}><pre className="seo-code">{JSON.stringify(view.snapshot, null, 2)}</pre></Drawer>}
  </Card>;
}
