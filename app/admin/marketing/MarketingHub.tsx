'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft, BarChart3, Copy, Download, Eye, Mail, Megaphone, Pause, Play, Plus, RefreshCw, Search, Send, Tag, Ticket, Trash2, Upload, Users, X} from 'lucide-react';
import {API, ApiError, authToken, request} from '../api';
import {chartSvg} from '@/lib/article/chart';
import {BlockEditor} from '../blog/editor/BlockEditor';
import '@/components/article/article.css';
import '../blog/blog-studio.css';
import './marketing.css';

export type MarketingView = 'overview' | 'campaigns' | 'subscribers' | 'coupons';
type Campaign = {id: string; name: string; kind: 'MARKETING' | 'ANNOUNCEMENT'; subject: string; preheader: string; contentHtml: string; contentDoc?: unknown; audience: Audience; couponCode: string | null; status: string; scheduledAt: string | null; startedAt: string | null; completedAt: string | null; pauseReason: string | null; recipients: number; sent: number; failed: number; opened?: number; clicked?: number; unsubscribed?: number; openRate?: number; clickRate?: number; updatedAt: string};
type Audience = {type?: 'subscribers' | 'customers'; tags?: string[]; sources?: string[]; customers?: string; serviceTypes?: string[]; subscribedSince?: string; excludeRecentDays?: number; emails?: string[]};
type Subscriber = {id: string; email: string; name: string; status: string; source: string; tags: string[]; consentAt: string | null; consentSource: string | null; unsubscribedAt: string | null; lastEmailAt: string | null; createdAt: string};
type Coupon = {id: string; code: string; active: boolean; timesRedeemed: number; maxRedemptions: number | null; expiresAt: string | null; firstTimeOnly: boolean; percentOff: number | null; amountOff: number | null; duration: string; durationInMonths: number | null; created: string; revenue: {orders: number; revenue: number; discount: number} | null};

const pct = (n?: number) => (n === undefined ? '—' : (n * 100).toFixed(1) + '%');
const money = (cents: number) => '$' + (cents / 100).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2});
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}) : '—');
const STATUS_TONE: Record<string, string> = {DRAFT: 'draft', SCHEDULED: 'scheduled', SENDING: 'published', PAUSED: 'scheduled', SENT: 'published', CANCELLED: 'archived', SUBSCRIBED: 'published', ACTIVE: 'published', INACTIVE: 'archived', PENDING: 'scheduled', UNSUBSCRIBED: 'archived', BOUNCED: 'archived', COMPLAINED: 'archived'};
const Badge = ({s}: {s: string}) => <span className={'bs-state is-' + (STATUS_TONE[s] || 'draft')}>{s[0] + s.slice(1).toLowerCase()}</span>;
const SERVICES = ['coworking', 'dedicated', 'virtual-office', 'business-address', 'virtual-mailbox', 'llc-setup', 'meeting-rooms', 'events', 'photo-studio', 'podcast-studio', 'workshops', 'webinars', 'memberships'];

export default function MarketingHub({view, canWrite, isAdmin, onUnauthorized}: {view: MarketingView; canWrite: boolean; isAdmin: boolean; onUnauthorized: () => void}) {
  const [error, setError] = useState('');
  const fail = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) onUnauthorized(); setError(e instanceof Error ? e.message : 'Something went wrong'); }, [onUnauthorized]);
  return (
    <section className="mk">
      {error && <p className="bs-banner is-error" role="alert"><span>{error}</span><button type="button" className="bs-icon" aria-label="Dismiss" onClick={() => setError('')}><X size={14} /></button></p>}
      {view === 'overview' && <Overview fail={fail} />}
      {view === 'campaigns' && <Campaigns fail={fail} canWrite={canWrite} isAdmin={isAdmin} />}
      {view === 'subscribers' && <Subscribers fail={fail} canWrite={canWrite} isAdmin={isAdmin} />}
      {view === 'coupons' && <Coupons fail={fail} isAdmin={isAdmin} />}
    </section>
  );
}

/* ───────────── Analytics ───────────── */
type OverviewData = {fetchedAt?: number; days: number; subscribers: Record<string, number>; contacts: number; sources: Array<{source: string; count: number}>; growth: Array<{day: string; count: number}>; unsubscribes: Array<{day: string; count: number}>; totals: {sent: number; opened: number; clicked: number; unsubscribed: number}; couponRevenue: Array<{code: string; orders: number; revenue: number; discount: number}>; campaigns: Campaign[]; sending: {mode: string; ratePerMinute: number}};
function Overview({fail}: {fail: (e: unknown) => void}) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<OverviewData | null>(null);
  useEffect(() => { let live = true; request<OverviewData>('/admin/marketing/overview?days=' + days).then(d => live && setData({...d, fetchedAt: Date.now()})).catch(e => live && fail(e)); return () => { live = false; }; }, [days, fail]);
  const series = useMemo(() => {
    if (!data) return '';
    const map = new Map(data.growth.map(g => [g.day, g.count])), un = new Map(data.unsubscribes.map(g => [g.day, g.count]));
    const labels: string[] = [];
    const anchor = data.fetchedAt ?? 0;
    for (let i = data.days - 1; i >= 0; i--) labels.push(new Date(anchor - i * 86400000).toISOString().slice(0, 10));
    const step = Math.ceil(labels.length / 10);
    const bucket = (m: Map<string, number>) => { const out: number[] = []; for (let i = 0; i < labels.length; i += step) out.push(labels.slice(i, i + step).reduce((s, d) => s + (m.get(d) || 0), 0)); return out; };
    const shown = labels.filter((_, i) => i % step === 0).map(d => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric'}));
    return chartSvg({type: 'bar', title: 'Subscriber growth', labels: shown, datasets: [{label: 'New subscribers', data: bucket(map), color: '#0E3421'}, {label: 'Unsubscribes', data: bucket(un), color: '#D7902A'}], showValues: false});
  }, [data]);
  if (!data) return <p className="bs-muted">Loading analytics…</p>;
  const s = data.subscribers, t = data.totals;
  const revenue = data.couponRevenue.reduce((a, r) => a + r.revenue, 0);
  return (
    <div className="mk-stack">
      <div className="mk-toolbar"><div className="bs-seg" role="group" aria-label="Period">{[7, 30, 90, 365].map(d => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d === 365 ? '12 months' : d + ' days'}</button>)}</div>
        <span className={'mk-send-mode' + (data.sending.mode === 'none' ? ' is-off' : '')}>{data.sending.mode === 'smtp' ? 'Sending via SMTP' : data.sending.mode === 'capture' ? 'Test capture mode' : 'Email sending not configured'} · up to {data.sending.ratePerMinute}/minute</span></div>
      <div className="mk-kpis">
        <Kpi label="Subscribed" value={(s.SUBSCRIBED || 0).toLocaleString()} note={(s.PENDING || 0) + ' awaiting confirmation'} />
        <Kpi label="All contacts" value={data.contacts.toLocaleString()} note="Customer emails on file" />
        <Kpi label="Emails sent" value={t.sent.toLocaleString()} note={'Last ' + data.days + ' days'} />
        <Kpi label="Open rate" value={pct(t.sent ? t.opened / t.sent : 0)} note={t.opened + ' opened'} />
        <Kpi label="Click rate" value={pct(t.sent ? t.clicked / t.sent : 0)} note={t.clicked + ' clicked'} />
        <Kpi label="Unsubscribed" value={(s.UNSUBSCRIBED || 0).toLocaleString()} note={t.unsubscribed + ' from campaigns'} />
        <Kpi label="Coupon revenue" value={money(revenue)} note={data.couponRevenue.reduce((a, r) => a + r.orders, 0) + ' paid orders'} />
      </div>
      <div className="mk-grid2">
        <div className="mk-card"><h3>Growth</h3><div className="wj-article" dangerouslySetInnerHTML={{__html: series}} /></div>
        <div className="mk-card"><h3>Where subscribers come from</h3>
          {data.sources.length ? <ul className="mk-bars">{data.sources.map(x => { const max = data.sources[0].count || 1; return <li key={x.source}><span>{x.source}</span><i style={{width: (x.count / max) * 100 + '%'}} /><b>{x.count}</b></li>; })}</ul> : <p className="bs-muted">No subscribers yet.</p>}
        </div>
      </div>
      <div className="mk-card"><h3>Recent campaigns</h3>
        {data.campaigns.length ? <table className="mk-table"><thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Opened</th><th>Clicked</th><th>Unsubscribed</th></tr></thead><tbody>{data.campaigns.map(c => <tr key={c.id}><td>{c.name}<small>{when(c.startedAt)}</small></td><td><Badge s={c.status} /></td><td>{c.sent ?? 0}</td><td>{pct(c.openRate)}</td><td>{pct(c.clickRate)}</td><td>{c.unsubscribed ?? 0}</td></tr>)}</tbody></table> : <p className="bs-muted">No campaigns sent yet.</p>}
      </div>
      {data.couponRevenue.length > 0 && <div className="mk-card"><h3>Coupon performance</h3><table className="mk-table"><thead><tr><th>Code</th><th>Paid orders</th><th>Revenue</th><th>Discount given</th></tr></thead><tbody>{data.couponRevenue.map(r => <tr key={r.code}><td><code>{r.code}</code></td><td>{r.orders}</td><td>{money(r.revenue)}</td><td>{money(r.discount)}</td></tr>)}</tbody></table></div>}
      <p className="bs-muted">Opens are estimated from images loading; some mail apps block or pre-load images, so treat open rate as a trend, and clicks as the more reliable signal.</p>
    </div>
  );
}
const Kpi = ({label, value, note}: {label: string; value: string; note?: string}) => <div className="mk-kpi"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;

/* ───────────── Campaigns ───────────── */
function Campaigns({fail, canWrite, isAdmin}: {fail: (e: unknown) => void; canWrite: boolean; isAdmin: boolean}) {
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [open, setOpen] = useState<{id: string; mode: 'edit' | 'report'} | null>(null);
  const [reload, setReload] = useState(0);
  const [choose, setChoose] = useState(false);
  useEffect(() => { let live = true; request<Campaign[]>('/admin/marketing/campaigns').then(d => live && setRows(d)).catch(e => live && fail(e)); return () => { live = false; }; }, [reload, fail]);
  async function create(kind: 'MARKETING' | 'ANNOUNCEMENT') {
    setChoose(false);
    try { const c = await request<Campaign>('/admin/marketing/campaigns', {method: 'POST', body: JSON.stringify({kind, name: kind === 'ANNOUNCEMENT' ? 'Service announcement' : 'New campaign'})}); setOpen({id: c.id, mode: 'edit'}); } catch (e) { fail(e); }
  }
  async function act(c: Campaign, action: string) {
    if (action === 'cancel' && !window.confirm('Cancel "' + c.name + '"? Emails not yet sent will not go out.')) return;
    if (action === 'delete' && !window.confirm('Delete this draft?')) return;
    try {
      if (action === 'delete') await request('/admin/marketing/campaigns/' + c.id, {method: 'DELETE'});
      else { const r = await request<Campaign>('/admin/marketing/campaigns/' + c.id + '/' + action, {method: 'POST'}); if (action === 'duplicate') { setOpen({id: r.id, mode: 'edit'}); return; } }
      setReload(x => x + 1);
    } catch (e) { fail(e); }
  }
  if (open) return createPortal(<div className="bs-portal" data-art="studio">{open.mode === 'edit' ? <CampaignEditor id={open.id} fail={fail} canWrite={canWrite} onClose={() => { setOpen(null); setReload(x => x + 1); }} /> : <CampaignReport id={open.id} fail={fail} onClose={() => setOpen(null)} />}</div>, document.body);
  return (
    <div className="mk-stack">
      <div className="mk-toolbar"><p className="bs-muted">Campaigns go only to people who agreed to marketing email. Service announcements reach every customer and cannot contain offers.</p>
        <div className="mk-actions"><button type="button" className="bs-btn" onClick={() => setReload(x => x + 1)}><RefreshCw size={15} /> Refresh</button>{canWrite && <button type="button" className="bs-btn bs-primary" onClick={() => (isAdmin ? setChoose(true) : void create('MARKETING'))}><Plus size={15} /> New campaign</button>}</div></div>
      {choose && <div className="mk-choose">
        <button type="button" onClick={() => void create('MARKETING')}><Megaphone size={22} /><strong>Marketing campaign</strong><span>Newsletter, offer or event invite to your subscribers. Can include a coupon.</span></button>
        <button type="button" onClick={() => void create('ANNOUNCEMENT')}><Mail size={22} /><strong>Service announcement</strong><span>Important account or service information for all customers (closures, policy changes). No promotions.</span></button>
        <button type="button" className="bs-icon" aria-label="Close" onClick={() => setChoose(false)}><X size={16} /></button>
      </div>}
      {!rows ? <p className="bs-muted">Loading…</p> : !rows.length ? <div className="mk-empty"><Megaphone size={28} /><p>No campaigns yet. Create one to email your subscribers.</p></div> :
        <div className="bm-table-wrap"><table className="mk-table is-wide"><thead><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Audience</th><th>Sent</th><th>Open rate</th><th>Click rate</th><th>Unsub.</th><th>Coupon</th><th>When</th><th /></tr></thead>
          <tbody>{rows.map(c => (
            <tr key={c.id}>
              <td><button type="button" className="bm-link" onClick={() => setOpen({id: c.id, mode: c.startedAt ? 'report' : 'edit'})}>{c.name}</button><small>{c.subject || 'No subject yet'}</small>{c.pauseReason && <small className="bs-warn">{c.pauseReason}</small>}</td>
              <td>{c.kind === 'ANNOUNCEMENT' ? 'Announcement' : 'Marketing'}</td><td><Badge s={c.status} /></td><td>{c.recipients || '—'}</td><td>{c.sent}{c.failed ? <small className="bs-warn">{c.failed} failed</small> : null}</td><td>{c.startedAt ? pct(c.openRate) : '—'}</td><td>{c.startedAt ? pct(c.clickRate) : '—'}</td><td>{c.unsubscribed ?? 0}</td><td>{c.couponCode ? <code>{c.couponCode}</code> : '—'}</td>
              <td>{c.status === 'SCHEDULED' ? 'Sends ' + when(c.scheduledAt) : c.completedAt ? 'Sent ' + when(c.completedAt) : c.startedAt ? 'Started ' + when(c.startedAt) : 'Edited ' + when(c.updatedAt)}</td>
              <td className="bm-row-actions">
                {c.startedAt && <button type="button" className="bs-icon" title="Report" aria-label={'Report for ' + c.name} onClick={() => setOpen({id: c.id, mode: 'report'})}><BarChart3 size={15} /></button>}
                {canWrite && !c.startedAt && <button type="button" className="bs-icon" title="Edit" aria-label={'Edit ' + c.name} onClick={() => setOpen({id: c.id, mode: 'edit'})}><Eye size={15} /></button>}
                {canWrite && c.status === 'SENDING' && <button type="button" className="bs-icon" title="Pause" aria-label="Pause" onClick={() => void act(c, 'pause')}><Pause size={15} /></button>}
                {canWrite && c.status === 'PAUSED' && <button type="button" className="bs-icon" title="Resume" aria-label="Resume" onClick={() => void act(c, 'resume')}><Play size={15} /></button>}
                {canWrite && ['SCHEDULED', 'SENDING', 'PAUSED'].includes(c.status) && <button type="button" className="bs-icon is-danger" title="Cancel" aria-label="Cancel" onClick={() => void act(c, 'cancel')}><X size={15} /></button>}
                {canWrite && <button type="button" className="bs-icon" title="Duplicate" aria-label="Duplicate" onClick={() => void act(c, 'duplicate')}><Copy size={15} /></button>}
                {canWrite && !c.startedAt && <button type="button" className="bs-icon is-danger" title="Delete" aria-label="Delete" onClick={() => void act(c, 'delete')}><Trash2 size={15} /></button>}
              </td>
            </tr>))}</tbody></table></div>}
    </div>
  );
}

function CampaignEditor({id, fail, canWrite, onClose}: {id: string; fail: (e: unknown) => void; canWrite: boolean; onClose: () => void}) {
  const [c, setC] = useState<Campaign | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [tagsAll, setTagsAll] = useState<Array<{tag: string; count: number}>>([]);
  const [count, setCount] = useState<{count: number; sample: Array<{email: string; name: string}>} | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{kind: 'ok' | 'error'; text: string} | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [emailsText, setEmailsText] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([request<Campaign>('/admin/marketing/campaigns/' + id), request<Coupon[]>('/admin/marketing/coupons').catch(() => []), request<{tags: Array<{tag: string; count: number}>}>('/admin/marketing/subscribers?limit=10')])
      .then(([camp, cps, subs]) => { if (!live) return; setC(camp); setCoupons(cps.filter(x => x.active)); setTagsAll(subs.tags); setEmailsText((camp.audience.emails || []).join('\n')); })
      .catch(e => live && fail(e));
    return () => { live = false; };
  }, [id, fail]);
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(() => { request<{count: number; sample: Array<{email: string; name: string}>}>('/admin/marketing/campaigns/' + id + '/audience', {method: 'POST', body: JSON.stringify({audience: c.audience, couponCode: c.couponCode})}).then(setCount).catch(e => setNotice({kind: 'error', text: e instanceof Error ? e.message : 'Audience error'})); }, 400);
    return () => clearTimeout(t);
  }, [c, id]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);

  const set = (patch: Partial<Campaign>) => { setC(prev => (prev ? {...prev, ...patch} : prev)); setDirty(true); };
  const setAud = (patch: Partial<Audience>) => setC(prev => { if (!prev) return prev; setDirty(true); return {...prev, audience: {...prev.audience, ...patch}}; });
  async function save(quiet = false) {
    if (!c) return false;
    setSaving(true);
    try { const saved = await request<Campaign>('/admin/marketing/campaigns/' + id, {method: 'PUT', body: JSON.stringify(c)}); setC(prev => (prev ? {...prev, updatedAt: saved.updatedAt} : prev)); setDirty(false); if (!quiet) setNotice({kind: 'ok', text: 'Saved.'}); return true; }
    catch (e) { setNotice({kind: 'error', text: e instanceof Error ? e.message : 'Save failed'}); return false; } finally { setSaving(false); }
  }
  async function showPreview() { if (await save(true)) { try { setPreview((await request<{html: string}>('/admin/marketing/campaigns/' + id + '/preview')).html); } catch (e) { fail(e); } } }
  async function sendTest() {
    if (!(await save(true))) return;
    const emails = testTo.split(/[\s,;]+/).filter(Boolean);
    try { const r = await request<{results: Array<{email: string; ok: boolean; error?: string}>}>('/admin/marketing/campaigns/' + id + '/test', {method: 'POST', body: JSON.stringify(emails.length ? {emails} : {})}); setNotice({kind: r.results.every(x => x.ok) ? 'ok' : 'error', text: r.results.map(x => x.email + (x.ok ? ': sent' : ': ' + x.error)).join(' · ')}); }
    catch (e) { setNotice({kind: 'error', text: e instanceof Error ? e.message : 'Test failed'}); }
  }
  async function launch(at?: string) {
    if (!(await save(true))) return;
    const body = (confirmCount?: number) => JSON.stringify({...(at ? {at: new Date(at).toISOString()} : {}), ...(confirmCount !== undefined ? {confirmCount} : {})});
    try { await request('/admin/marketing/campaigns/' + id + '/schedule', {method: 'POST', body: body()}); }
    catch (e) {
      const m = e instanceof Error ? e.message : '';
      const n = /go to (\d+) people/.exec(m)?.[1];
      if (!n) { setNotice({kind: 'error', text: m || 'Could not start'}); return; }
      if (!window.confirm((at ? 'Schedule for ' + new Date(at).toLocaleString() + '. ' : 'Send now. ') + 'This campaign will go to ' + n + ' people. Continue?')) return;
      try { await request('/admin/marketing/campaigns/' + id + '/schedule', {method: 'POST', body: body(Number(n))}); } catch (e2) { setNotice({kind: 'error', text: e2 instanceof Error ? e2.message : 'Could not start'}); return; }
    }
    setDirty(false); onClose();
  }

  if (!c) return <div className="bs-shell"><div className="bs-loading">Opening the campaign…</div></div>;
  const a = c.audience, marketing = c.kind === 'MARKETING';
  return (
    <div className="bs-shell">
      <header className="bs-top">
        <button type="button" className="bs-btn bs-ghost" onClick={() => { if (dirty && !window.confirm('Leave without saving?')) return; onClose(); }}><ArrowLeft size={16} /> Campaigns</button>
        <div className="bs-top-mid"><span className={'bs-state is-' + (marketing ? 'published' : 'scheduled')}>{marketing ? 'Marketing' : 'Service announcement'}</span><span className="bs-save-state">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span></div>
        <div className="bs-top-actions">
          <button type="button" className="bs-btn" onClick={() => void showPreview()}><Eye size={16} /> Preview</button>
          {canWrite && <button type="button" className="bs-btn" disabled={saving} onClick={() => void save()}>Save</button>}
          {canWrite && <button type="button" className="bs-btn bs-primary" disabled={saving || !count?.count} onClick={() => void launch()}><Send size={15} /> Send now</button>}
        </div>
      </header>
      {notice && <div className={'bs-banner is-' + notice.kind}><span>{notice.text}</span><button type="button" className="bs-icon" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button></div>}
      <div className="bs-body">
        <main className="bs-main">
          {preview ? (
            <div className="bs-preview"><div className="bs-preview-bar"><button type="button" className="bs-btn" onClick={() => setPreview(null)}><ArrowLeft size={15} /> Back to editing</button><span className="bs-muted">Exactly what recipients receive (sample name, test mode).</span></div><iframe className="mk-preview-frame" title="Email preview" sandbox="" srcDoc={preview} /></div>
          ) : (
            <div className="bs-doc">
              <input className="mk-name" value={c.name} onChange={e => set({name: e.target.value})} aria-label="Campaign name (internal)" placeholder="Campaign name (internal)" />
              <label className="mk-line"><span>Subject</span><input value={c.subject} onChange={e => set({subject: e.target.value})} placeholder="e.g. {{first_name}}, your studio hour is on us" maxLength={200} /><small>{c.subject.length}/200</small></label>
              <label className="mk-line"><span>Preview text</span><input value={c.preheader} onChange={e => set({preheader: e.target.value})} placeholder="Shown after the subject in most inboxes" maxLength={200} /></label>
              <p className="mk-tokens">Personalize with <code>{'{{first_name}}'}</code> <code>{'{{name}}'}</code> <code>{'{{email}}'}</code>{marketing && <> <code>{'{{coupon}}'}</code></>}. Charts become tables, videos become links and diagrams are left out, because email apps cannot run them.</p>
              <BlockEditor initialHtml={c.contentHtml} onChange={(html, doc) => setC(prev => { if (!prev) return prev; setDirty(true); return {...prev, contentHtml: html, contentDoc: doc}; })} onImportReport={() => undefined} onUploadError={m => setNotice({kind: 'error', text: m})} />
            </div>
          )}
        </main>
        <aside className="bs-side" aria-label="Campaign settings"><div className="bs-side-body">
          <section className="bs-card">
            <h4><Users size={13} /> Audience</h4>
            <div className="mk-count"><strong>{count ? count.count.toLocaleString() : '…'}</strong><span>{marketing ? 'subscribers will receive this' : 'customers will receive this'}</span></div>
            {count?.sample.length ? <p className="bs-muted">{count.sample.map(s => s.name || s.email).slice(0, 4).join(', ')}{count.count > 4 ? '…' : ''}</p> : null}
            {marketing ? <>
              <label className="bs-field"><span>Customers</span><select value={a.customers || 'any'} onChange={e => setAud({customers: e.target.value})}><option value="any">All subscribers</option><option value="active-subscription">With an active subscription</option><option value="purchased">Who have bought something</option><option value="never-purchased">Who have never bought</option></select></label>
              <fieldset className="bs-terms"><legend>Bought these services (optional)</legend>{SERVICES.map(s => { const on = (a.serviceTypes || []).includes(s); return <button type="button" key={s} className={'bs-pill' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => setAud({serviceTypes: on ? (a.serviceTypes || []).filter(x => x !== s) : [...(a.serviceTypes || []), s]})}>{s.replace(/-/g, ' ')}</button>; })}</fieldset>
              {tagsAll.length > 0 && <fieldset className="bs-terms"><legend>Tags (any of)</legend>{tagsAll.map(t => { const on = (a.tags || []).includes(t.tag); return <button type="button" key={t.tag} className={'bs-pill' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => setAud({tags: on ? (a.tags || []).filter(x => x !== t.tag) : [...(a.tags || []), t.tag]})}><Tag size={11} /> {t.tag} ({t.count})</button>; })}</fieldset>}
              <label className="bs-field"><span>Subscribed since</span><input type="date" value={a.subscribedSince || ''} onChange={e => setAud({subscribedSince: e.target.value || undefined})} /></label>
              <label className="bs-field"><span>Skip people emailed in the last</span><select value={a.excludeRecentDays || ''} onChange={e => setAud({excludeRecentDays: e.target.value ? Number(e.target.value) : undefined})}><option value="">No limit</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
            </> : <p className="bs-muted">All customers with an account or a paid order. Use this only for information they need about their account or our services.</p>}
            <label className="bs-field"><span>Only these addresses (optional, one per line)</span><textarea rows={3} value={emailsText} onChange={e => { setEmailsText(e.target.value); setAud({emails: e.target.value.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)}); }} placeholder={marketing ? 'Must already be subscribed' : 'Customer emails'} /></label>
          </section>
          {marketing && <section className="bs-card">
            <h4><Ticket size={13} /> Coupon</h4>
            <select value={c.couponCode || ''} onChange={e => set({couponCode: e.target.value || null})} aria-label="Coupon"><option value="">No coupon</option>{coupons.map(x => <option key={x.id} value={x.code}>{x.code} · {x.percentOff ? x.percentOff + '% off' : money(x.amountOff || 0) + ' off'}</option>)}</select>
            <small className="bs-muted">Shown as a code box at the top of the email; use {'{{coupon}}'} to mention it in the text. Create codes under Coupons.</small>
          </section>}
          <section className="bs-card">
            <h4><Send size={13} /> Test</h4>
            <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@company.com (blank = your email)" aria-label="Test recipients" />
            <button type="button" className="bs-btn" onClick={() => void sendTest()}>Send test</button>
          </section>
          <section className="bs-card">
            <h4>Schedule</h4>
            <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} aria-label="Send at" />
            <button type="button" className="bs-btn" disabled={!scheduleAt || !canWrite} onClick={() => void launch(scheduleAt)}>Schedule</button>
            <small className="bs-muted">Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Sending is throttled to protect your mail account’s reputation.</small>
          </section>
        </div></aside>
      </div>
    </div>
  );
}

type Report = {campaign: Campaign; stats: {recipients: number; sent: number; failed: number; opened: number; clicked: number; unsubscribed: number; openRate: number; clickRate: number}; links: Array<{url: string; clicks: number; people: number}>; opensByHour: Array<{hour: string; count: number}>; recipients: Array<{id: string; email: string; name: string; status: string; error: string | null; sentAt: string | null; openedAt: string | null; opens: number; clickedAt: string | null; clicks: number; unsubscribedAt: string | null}>; total: number; page: number; coupon: {orders: number; revenue: number; discount: number} | null};
function CampaignReport({id, fail, onClose}: {id: string; fail: (e: unknown) => void; onClose: () => void}) {
  const [r, setR] = useState<Report | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { let live = true; const load = () => request<Report>('/admin/marketing/campaigns/' + id + '/report?page=' + page + (filter ? '&status=' + filter : '')).then(d => live && setR(d)).catch(e => live && fail(e)); void load(); const t = setInterval(load, 10000); return () => { live = false; clearInterval(t); }; }, [id, filter, page, fail]);
  if (!r) return <div className="bs-shell"><div className="bs-loading">Loading report…</div></div>;
  const s = r.stats;
  const funnel = [['Recipients', s.recipients], ['Sent', s.sent], ['Opened', s.opened], ['Clicked', s.clicked]] as const;
  const timeline = r.opensByHour.length ? chartSvg({type: 'line', title: 'Opens over time', labels: r.opensByHour.map(o => new Date(o.hour).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric'})), datasets: [{label: 'Opens', data: r.opensByHour.map(o => o.count), color: '#0E3421'}], showValues: false}) : '';
  return (
    <div className="bs-shell">
      <header className="bs-top"><button type="button" className="bs-btn bs-ghost" onClick={onClose}><ArrowLeft size={16} /> Campaigns</button><div className="bs-top-mid"><strong>{r.campaign.name}</strong><Badge s={r.campaign.status} /><span className="bs-save-state">{r.campaign.subject}</span></div></header>
      <div className="mk-report">
        <div className="mk-kpis">
          <Kpi label="Delivered" value={s.sent.toLocaleString()} note={s.failed ? s.failed + ' failed' : 'of ' + s.recipients} />
          <Kpi label="Open rate" value={pct(s.openRate)} note={s.opened + ' people'} />
          <Kpi label="Click rate" value={pct(s.clickRate)} note={s.clicked + ' people'} />
          <Kpi label="Click-to-open" value={pct(s.opened ? s.clicked / s.opened : 0)} />
          <Kpi label="Unsubscribed" value={String(s.unsubscribed)} note={pct(s.sent ? s.unsubscribed / s.sent : 0)} />
          {r.coupon && <Kpi label={'Coupon ' + r.campaign.couponCode} value={money(r.coupon.revenue)} note={r.coupon.orders + ' paid orders · ' + money(r.coupon.discount) + ' discount'} />}
        </div>
        <div className="mk-grid2">
          <div className="mk-card"><h3>Funnel</h3><ul className="mk-funnel">{funnel.map(([l, v]) => <li key={l}><span>{l}</span><i style={{width: (s.recipients ? (v / s.recipients) * 100 : 0) + '%'}} /><b>{v}</b></li>)}</ul></div>
          <div className="mk-card"><h3>Opens over time</h3>{timeline ? <div className="wj-article" dangerouslySetInnerHTML={{__html: timeline}} /> : <p className="bs-muted">No opens recorded yet.</p>}</div>
        </div>
        <div className="mk-card"><h3>Top links</h3>{r.links.length ? <table className="mk-table"><thead><tr><th>Link</th><th>Clicks</th><th>People</th></tr></thead><tbody>{r.links.map(l => <tr key={l.url}><td className="mk-url">{l.url}</td><td>{l.clicks}</td><td>{l.people}</td></tr>)}</tbody></table> : <p className="bs-muted">No clicks yet.</p>}</div>
        <div className="mk-card"><h3>Recipients</h3>
          <div className="bs-seg" role="group" aria-label="Filter recipients">{[['', 'All'], ['sent', 'Sent'], ['opened', 'Opened'], ['clicked', 'Clicked'], ['failed', 'Failed'], ['skipped', 'Skipped']].map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(1); }}>{l}</button>)}</div>
          <table className="mk-table"><thead><tr><th>Recipient</th><th>Status</th><th>Sent</th><th>Opened</th><th>Clicks</th></tr></thead><tbody>{r.recipients.map(x => <tr key={x.id}><td>{x.name || '—'}<small>{x.email}</small></td><td><Badge s={x.status} />{x.error && <small className="bs-warn">{x.error}</small>}{x.unsubscribedAt && <small>Unsubscribed</small>}</td><td>{when(x.sentAt)}</td><td>{x.openedAt ? when(x.openedAt) + (x.opens > 1 ? ' (' + x.opens + '×)' : '') : '—'}</td><td>{x.clicks || '—'}</td></tr>)}</tbody></table>
          <div className="bm-pager"><span>{r.total} recipients</span><button type="button" className="bs-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><button type="button" className="bs-btn" disabled={page * 50 >= r.total} onClick={() => setPage(p => p + 1)}>Next</button></div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Subscribers & contacts ───────────── */
type Contact = {id: string; email: string; name: string; phone: string | null; account: string; marketingOptIn: boolean; subscriber: string | null; orders: number; spent: number; lastOrder: string | null; activeSubscriptions: number; createdAt: string};
function Subscribers({fail, canWrite, isAdmin}: {fail: (e: unknown) => void; canWrite: boolean; isAdmin: boolean}) {
  const [tab, setTab] = useState<'subscribers' | 'contacts'>('subscribers');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{items: Subscriber[]; total: number; tags: Array<{tag: string; count: number}>} | null>(null);
  const [contacts, setContacts] = useState<{items: Contact[]; total: number} | null>(null);
  const [panel, setPanel] = useState<null | 'add' | 'import'>(null);
  const [reload, setReload] = useState(0);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      if (tab === 'subscribers') request<{items: Subscriber[]; total: number; tags: Array<{tag: string; count: number}>}>('/admin/marketing/subscribers?page=' + page + (q ? '&q=' + encodeURIComponent(q) : '') + (status ? '&status=' + status : '') + (tag ? '&tag=' + encodeURIComponent(tag) : '')).then(d => live && setData(d)).catch(e => live && fail(e));
      else request<{items: Contact[]; total: number}>('/admin/marketing/contacts?page=' + page + (q ? '&q=' + encodeURIComponent(q) : '')).then(d => live && setContacts(d)).catch(e => live && fail(e));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [tab, q, status, tag, page, reload, fail]);
  async function act(s: Subscriber, action: 'unsubscribe' | 'erase' | 'tags') {
    try {
      if (action === 'unsubscribe') { if (!window.confirm('Unsubscribe ' + s.email + '? They will not receive marketing email again unless they sign up themselves.')) return; await request('/admin/marketing/subscribers/' + s.id, {method: 'PATCH', body: JSON.stringify({status: 'UNSUBSCRIBED'})}); }
      else if (action === 'erase') { if (!window.confirm('Erase ' + s.email + ' completely (right to be forgotten)? This cannot be undone.')) return; await request('/admin/marketing/subscribers/' + s.id, {method: 'DELETE'}); }
      else { const v = window.prompt('Tags for ' + s.email + ' (comma separated)', s.tags.join(', ')); if (v === null) return; await request('/admin/marketing/subscribers/' + s.id, {method: 'PATCH', body: JSON.stringify({tags: v.split(',')})}); }
      setReload(x => x + 1);
    } catch (e) { fail(e); }
  }
  async function exportCsv() {
    try {
      const res = await fetch((API.replace(/\/$/, '')) + '/admin/marketing/subscribers/export', {headers: authToken() ? {Authorization: 'Bearer ' + authToken()} : {}, credentials: 'include'});
      if (!res.ok) throw new Error('Export failed (' + res.status + ')');
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'subscribers-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { fail(e); }
  }
  return (
    <div className="mk-stack">
      <div className="mk-toolbar">
        <div className="bm-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'subscribers'} onClick={() => { setTab('subscribers'); setPage(1); }}>Subscribers<span>{data?.total ?? ''}</span></button><button type="button" role="tab" aria-selected={tab === 'contacts'} onClick={() => { setTab('contacts'); setPage(1); }}>All customer contacts<span>{contacts?.total ?? ''}</span></button></div>
        <div className="mk-actions">{canWrite && tab === 'subscribers' && <><button type="button" className="bs-btn" onClick={() => setPanel(panel === 'import' ? null : 'import')}><Upload size={15} /> Import</button><button type="button" className="bs-btn bs-primary" onClick={() => setPanel(panel === 'add' ? null : 'add')}><Plus size={15} /> Add subscriber</button></>}{isAdmin && tab === 'subscribers' && <button type="button" className="bs-btn" onClick={() => void exportCsv()}><Download size={15} /> Export CSV</button>}</div>
      </div>
      {msg && <p className="bs-banner is-ok"><span>{msg}</span><button type="button" className="bs-icon" aria-label="Dismiss" onClick={() => setMsg('')}><X size={14} /></button></p>}
      {panel === 'add' && <AddSubscriber onDone={m => { setPanel(null); setMsg(m); setReload(x => x + 1); }} fail={fail} />}
      {panel === 'import' && <ImportSubscribers onDone={m => { setPanel(null); setMsg(m); setReload(x => x + 1); }} fail={fail} />}
      <div className="bm-filters">
        <label className="bs-search"><Search size={15} aria-hidden="true" /><input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search email or name" aria-label="Search" /></label>
        {tab === 'subscribers' && <><select aria-label="Status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{['SUBSCRIBED', 'PENDING', 'UNSUBSCRIBED', 'BOUNCED'].map(s => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</select>
          <select aria-label="Tag" value={tag} onChange={e => { setTag(e.target.value); setPage(1); }}><option value="">All tags</option>{data?.tags.map(t => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}</select></>}
      </div>
      {tab === 'subscribers' ? (!data ? <p className="bs-muted">Loading…</p> :
        <div className="bm-table-wrap"><table className="mk-table is-wide"><thead><tr><th>Subscriber</th><th>Status</th><th>Source</th><th>Tags</th><th>Consent</th><th>Last emailed</th><th /></tr></thead><tbody>
          {!data.items.length && <tr><td colSpan={7} className="bm-empty">No subscribers match.</td></tr>}
          {data.items.map(s => <tr key={s.id}><td>{s.name || '—'}<small>{s.email}</small></td><td><Badge s={s.status} /></td><td>{s.source}</td><td>{s.tags.map(t => <span key={t} className="bs-chip">{t}</span>)}</td><td>{s.consentAt ? when(s.consentAt) : '—'}<small title={s.consentSource || ''}>{s.consentSource || ''}</small></td><td>{when(s.lastEmailAt)}</td>
            <td className="bm-row-actions">{canWrite && <button type="button" className="bs-icon" title="Edit tags" aria-label="Edit tags" onClick={() => void act(s, 'tags')}><Tag size={14} /></button>}{canWrite && s.status === 'SUBSCRIBED' && <button type="button" className="bs-icon" title="Unsubscribe" aria-label="Unsubscribe" onClick={() => void act(s, 'unsubscribe')}><X size={14} /></button>}{isAdmin && <button type="button" className="bs-icon is-danger" title="Erase (GDPR)" aria-label="Erase" onClick={() => void act(s, 'erase')}><Trash2 size={14} /></button>}</td></tr>)}
        </tbody></table></div>)
      : (!contacts ? <p className="bs-muted">Loading…</p> :
        <div className="bm-table-wrap"><table className="mk-table is-wide"><thead><tr><th>Customer</th><th>Marketing</th><th>Account</th><th>Orders</th><th>Spent</th><th>Active plans</th><th>Last order</th></tr></thead><tbody>
          {contacts.items.map(c => <tr key={c.id}><td>{c.name || '—'}<small>{c.email}{c.phone ? ' · ' + c.phone : ''}</small></td><td>{c.subscriber ? <Badge s={c.subscriber} /> : <span className="bs-muted">No consent</span>}</td><td>{c.account.toLowerCase()}</td><td>{c.orders}</td><td>{money(c.spent)}</td><td>{c.activeSubscriptions}</td><td>{when(c.lastOrder)}</td></tr>)}
        </tbody></table><p className="bs-muted mk-note">Customer emails are kept for orders and service messages. Only people with marketing consent appear in campaign audiences.</p></div>)}
      <div className="bm-pager"><button type="button" className="bs-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page}</span><button type="button" className="bs-btn" disabled={page * 25 >= ((tab === 'subscribers' ? data?.total : contacts?.total) || 0)} onClick={() => setPage(p => p + 1)}>Next</button></div>
    </div>
  );
}

function AddSubscriber({onDone, fail}: {onDone: (m: string) => void; fail: (e: unknown) => void}) {
  const [f, setF] = useState({email: '', name: '', tags: '', consentNote: '', consentConfirmed: false});
  return (
    <form className="mk-card mk-form" onSubmit={async e => { e.preventDefault(); try { await request('/admin/marketing/subscribers', {method: 'POST', body: JSON.stringify({...f, tags: f.tags.split(',')})}); onDone(f.email + ' added.'); } catch (err) { fail(err); } }}>
      <h3>Add a subscriber</h3>
      <div className="mk-form-grid"><label className="bs-field"><span>Email</span><input type="email" required value={f.email} onChange={e => setF({...f, email: e.target.value})} /></label><label className="bs-field"><span>Name</span><input value={f.name} onChange={e => setF({...f, name: e.target.value})} /></label><label className="bs-field"><span>Tags (comma separated)</span><input value={f.tags} onChange={e => setF({...f, tags: e.target.value})} placeholder="event-2026, vip" /></label><label className="bs-field"><span>How they agreed</span><input value={f.consentNote} onChange={e => setF({...f, consentNote: e.target.value})} placeholder="e.g. signed up at the open house" /></label></div>
      <label className="bs-check"><input type="checkbox" checked={f.consentConfirmed} onChange={e => setF({...f, consentConfirmed: e.target.checked})} /> I confirm this person agreed to receive marketing email from Workspace Junction.</label>
      <button type="submit" className="bs-btn bs-primary" disabled={!f.consentConfirmed}>Add subscriber</button>
    </form>
  );
}

function ImportSubscribers({onDone, fail}: {onDone: (m: string) => void; fail: (e: unknown) => void}) {
  const [csv, setCsv] = useState('');
  const [tags, setTags] = useState('');
  const [ok, setOk] = useState(false);
  return (
    <form className="mk-card mk-form" onSubmit={async e => { e.preventDefault(); try { const r = await request<{added: number; updated: number; skipped: number; invalid: number}>('/admin/marketing/subscribers/import', {method: 'POST', body: JSON.stringify({csv, tags: tags.split(','), consentConfirmed: ok})}); onDone(`Imported: ${r.added} added, ${r.updated} updated, ${r.skipped} skipped (unsubscribed or bounced), ${r.invalid} invalid.`); } catch (err) { fail(err); } }}>
      <h3>Import subscribers</h3>
      <p className="bs-muted">One per line: <code>email,name,tag1|tag2</code>. People who unsubscribed are never re-added.</p>
      <input type="file" accept=".csv,text/csv,text/plain" onChange={e => { const file = e.target.files?.[0]; if (file) void file.text().then(setCsv); }} aria-label="CSV file" />
      <textarea rows={6} value={csv} onChange={e => setCsv(e.target.value)} placeholder={'jane@example.com,Jane Doe,open-house\nsam@example.com,Sam Lee'} aria-label="CSV content" />
      <label className="bs-field"><span>Add these tags to everyone</span><input value={tags} onChange={e => setTags(e.target.value)} placeholder="imported-2026-11" /></label>
      <label className="bs-check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I confirm everyone in this list agreed to receive marketing email.</label>
      <button type="submit" className="bs-btn bs-primary" disabled={!ok || !csv.trim()}>Import {csv.trim() ? csv.trim().split(/\n/).length + ' rows' : ''}</button>
    </form>
  );
}

/* ───────────── Coupons ───────────── */
function Coupons({fail, isAdmin}: {fail: (e: unknown) => void; isAdmin: boolean}) {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState<null | Record<string, string | boolean>>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { let live = true; request<Coupon[]>('/admin/marketing/coupons').then(d => live && setRows(d)).catch(e => live && fail(e)); return () => { live = false; }; }, [reload, fail]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    try { const r = await request<{code: string}>('/admin/marketing/coupons', {method: 'POST', body: JSON.stringify({...form, percentOff: form.kind === 'percent' ? form.value : '', amountOff: form.kind === 'amount' ? form.value : '', expiresAt: form.expiresAt ? new Date(String(form.expiresAt)).toISOString() : ''})}); setMsg('Created ' + r.code + '. It works at checkout now.'); setForm(null); setReload(x => x + 1); }
    catch (err) { fail(err); }
  }
  return (
    <div className="mk-stack">
      <div className="mk-toolbar"><p className="bs-muted">Promotion codes live in Stripe and are checked by the server at checkout. Revenue counts paid orders that used the code.</p><div className="mk-actions"><button type="button" className="bs-btn" onClick={() => setReload(x => x + 1)}><RefreshCw size={15} /> Refresh</button>{isAdmin && <button type="button" className="bs-btn bs-primary" onClick={() => setForm({code: '', name: '', kind: 'percent', value: '10', duration: 'once', durationInMonths: '3', maxRedemptions: '', expiresAt: '', firstTimeOnly: false, minimumAmount: ''})}><Plus size={15} /> New coupon</button>}</div></div>
      {msg && <p className="bs-banner is-ok"><span>{msg}</span></p>}
      {form && <form className="mk-card mk-form" onSubmit={create}>
        <h3>New coupon</h3>
        <div className="mk-form-grid">
          <label className="bs-field"><span>Code customers type</span><input required value={String(form.code)} onChange={e => setForm({...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')})} placeholder="WELCOME10" /></label>
          <label className="bs-field"><span>Internal name</span><input value={String(form.name)} onChange={e => setForm({...form, name: e.target.value})} placeholder="Welcome offer" /></label>
          <label className="bs-field"><span>Discount</span><div className="bs-row"><select value={String(form.kind)} onChange={e => setForm({...form, kind: e.target.value})}><option value="percent">% off</option><option value="amount">$ off</option></select><input type="number" min={form.kind === 'percent' ? 1 : 0.5} max={form.kind === 'percent' ? 100 : 10000} step="0.01" required value={String(form.value)} onChange={e => setForm({...form, value: e.target.value})} /></div></label>
          <label className="bs-field"><span>Applies to subscriptions</span><select value={String(form.duration)} onChange={e => setForm({...form, duration: e.target.value})}><option value="once">First payment only</option><option value="repeating">For several months</option><option value="forever">Every payment</option></select></label>
          {form.duration === 'repeating' && <label className="bs-field"><span>Months</span><input type="number" min={1} max={36} value={String(form.durationInMonths)} onChange={e => setForm({...form, durationInMonths: e.target.value})} /></label>}
          <label className="bs-field"><span>Maximum uses (blank = unlimited)</span><input type="number" min={1} value={String(form.maxRedemptions)} onChange={e => setForm({...form, maxRedemptions: e.target.value})} /></label>
          <label className="bs-field"><span>Expires</span><input type="datetime-local" value={String(form.expiresAt)} onChange={e => setForm({...form, expiresAt: e.target.value})} /></label>
          <label className="bs-field"><span>Minimum order ($)</span><input type="number" min={0} step="0.01" value={String(form.minimumAmount)} onChange={e => setForm({...form, minimumAmount: e.target.value})} /></label>
        </div>
        <label className="bs-check"><input type="checkbox" checked={!!form.firstTimeOnly} onChange={e => setForm({...form, firstTimeOnly: e.target.checked})} /> First-time customers only</label>
        <div className="bs-row"><button type="submit" className="bs-btn bs-primary">Create coupon</button><button type="button" className="bs-btn" onClick={() => setForm(null)}>Cancel</button></div>
      </form>}
      {!rows ? <p className="bs-muted">Loading coupons from Stripe…</p> : !rows.length ? <div className="mk-empty"><Ticket size={28} /><p>No coupons yet.</p></div> :
        <div className="bm-table-wrap"><table className="mk-table is-wide"><thead><tr><th>Code</th><th>Discount</th><th>Applies</th><th>Status</th><th>Used</th><th>Paid orders</th><th>Revenue</th><th>Expires</th><th /></tr></thead><tbody>
          {rows.map(c => <tr key={c.id}><td><code>{c.code}</code>{c.firstTimeOnly && <small>First-time only</small>}</td><td>{c.percentOff ? c.percentOff + '%' : money(c.amountOff || 0)} off</td><td>{c.duration === 'once' ? 'First payment' : c.duration === 'forever' ? 'Every payment' : c.durationInMonths + ' months'}</td><td><Badge s={c.active ? 'ACTIVE' : 'INACTIVE'} /></td><td>{c.timesRedeemed}{c.maxRedemptions ? ' / ' + c.maxRedemptions : ''}</td><td>{c.revenue?.orders ?? 0}</td><td>{money(c.revenue?.revenue ?? 0)}</td><td>{when(c.expiresAt)}</td>
            <td>{isAdmin && c.active && <button type="button" className="bs-btn" onClick={async () => { if (!window.confirm('Deactivate ' + c.code + '? Customers will no longer be able to use it.')) return; try { await request('/admin/marketing/coupons/' + c.id + '/deactivate', {method: 'POST'}); setReload(x => x + 1); } catch (e) { fail(e); } }}>Deactivate</button>}</td></tr>)}
        </tbody></table></div>}
    </div>
  );
}
