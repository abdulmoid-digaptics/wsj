'use client';
/**
 * Workspace operations: an isolated, local-only clone of reference reports (Sheets) and access control (Kisi) data.
 * Admin only. Reads and writes only /admin/workspace-clone*. Nothing here reaches Google, live Kisi, payments or email.
 */
import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode} from 'react';
import {Ban, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FlaskConical, LogIn, LogOut, Pencil, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2, UserMinus} from 'lucide-react';
import {ApiError, request} from './api';
import {EmptyState, useToast} from './ui';
import {MultiPicker, OverviewView, RecordDrawer} from './WorkspaceCloneViews';
import './workspace-clone.css';

type ColType = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'textarea';
type Col = {key: string; label: string; type: ColType; options?: string[]; required?: boolean; readOnly?: boolean};
type Rec = {id: string; [k: string]: unknown};
type Section = {key: string; label: string; area: 'Reports' | 'Access control'; description: string; readOnly: boolean; columns: Col[]; records: Rec[]};
type Summary = {referenceActive: number; referenceExpiring: number; referenceFailed: number; localActive: number; localExpired: number; localFailed: number};
type Overview = {mode: 'LOCAL_ONLY'; capturedAt: string; revision: number; sourceLinks?: {sheets?: string; kisi?: string}; localLockdown?: boolean; summary: Summary; sections: Section[]; notice?: string; live?: {enabled: boolean; writesEnabled?: boolean; syncSections?: string[]; kisi: {ok: boolean; fetchedAt: string | null; error: string | null} | null; sheets: {ok: boolean; fetchedAt: string | null; error: string | null} | null}};
type ActionKey = 'generate-report' | 'suspend-user' | 'resume-user' | 'offboard-member' | 'check-in-visitor' | 'check-out-visitor' | 'simulate-unlock' | 'simulate-lockdown';
type ActionDef = {action: ActionKey; label: string; title: string; body: string; scope: 'row' | 'section'; needsUser?: boolean};
type Dialog = {kind: 'form'; mode: 'create' | 'edit'; record?: Rec} | {kind: 'delete'; record: Rec} | {kind: 'action'; def: ActionDef; record?: Rec; sec?: string};
type Sort = {key: string; dir: 'asc' | 'desc'};
const OVERVIEW = 'overview';
const PAGE_SIZES = [10, 25, 50];
const EVENT_SECTIONS = ['events', 'audit-events'];
const PICKER_SOURCE: Record<string, string> = {members: 'users', groups: 'groups', doors: 'doors', floors: 'floors'};
const DETAIL_SECTIONS = ['users', 'groups'];
type EvFilter = {action: string; user: string; object: string; from: string; to: string};
const NO_EV: EvFilter = {action: '', user: '', object: '', from: '', to: ''};
type Draft = Record<string, string | boolean>;

const TZ = 'America/Chicago';
const BANNER = 'Isolated local clone. Google Sheets and live Kisi are untouched. Device status is a captured reference, not live monitoring.';
const NO_LIVE = 'This only changes the local clone record. No live changes, emails, payments or door signals are sent.';
const REAL_KISI = 'This changes real door access in your Kisi organization right away. Kisi may email the person, as it does for changes made in Kisi.';
/** Actions that write to Kisi when live sync is on and the target row is live. */
const KISI_ACTIONS = new Set(['suspend-user', 'resume-user', 'offboard-member']);

const ACTIONS: Record<string, ActionDef[]> = {
  'weekly-reports': [{action: 'generate-report', label: 'Local: generate report', title: 'Generate a local weekly report?', body: 'Builds a new weekly report row from the local clone data.', scope: 'section'}],
  users: [
    {action: 'suspend-user', label: 'Local suspend', title: 'Suspend this user locally?', body: 'Marks the user as suspended in the local clone only.', scope: 'row'},
    {action: 'resume-user', label: 'Local resume', title: 'Resume this user locally?', body: 'Marks the user as active again in the local clone only.', scope: 'row'},
  ],
  'active-members': [{action: 'offboard-member', label: 'Local offboard', title: 'Offboard this member locally?', body: 'Marks the member as offboarded in the local clone only. Billing and real door access are not touched.', scope: 'row'}],
  visitors: [
    {action: 'check-in-visitor', label: 'Local check in', title: 'Check in this visitor locally?', body: 'Records a visitor check-in in the local clone only. Nobody is notified.', scope: 'row'},
    {action: 'check-out-visitor', label: 'Local check out', title: 'Check out this visitor locally?', body: 'Records a visitor check-out in the local clone only.', scope: 'row'},
  ],
  doors: [
    {action: 'simulate-unlock', label: 'Simulate unlock', title: 'Simulate an unlock?', body: 'Adds a simulated unlock event for the user you choose. No door opens and no signal is sent to any lock.', scope: 'row', needsUser: true},
    {action: 'simulate-lockdown', label: 'Simulate lockdown', title: 'Simulate a lockdown?', body: 'Toggles the local place-wide lockdown flag. No real door is locked or unlocked.', scope: 'row'},
  ],
};
const DOORS_ALL: ActionDef = {action: 'simulate-lockdown', label: 'Simulate lockdown (all doors)', title: 'Simulate a lockdown on all doors?', body: 'Toggles the local lockdown flag for every door record. No real door is locked or unlocked.', scope: 'section'};

const msg = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong.';
/** Only machine-style codes (snake_case or ALL_CAPS) are prettified; real names, emails and acronyms display exactly as stored. */
const label = (s: string) => /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(s) || /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(s) && s.length > 3 && !/^(SMS|USD|NDA|QR)$/.test(s) ? s.replace(/_+/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : s;
const str = (v: unknown) => v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const safeUrl = (u?: string) => { try { const p = new URL(u || ''); return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : ''; } catch { return ''; } };
const tone = (s: string) => { const k = s.toLowerCase(); return /fail|error|dead|suspend|declin/.test(k) ? 'bad' : /expir|block|revok|offboard|inactive|lockdown|pending|warn/.test(k) ? 'warn' : /active|granted|ok|ready|paid|in\b|checked.?in|open|synced/.test(k) ? 'good' : 'neutral'; };
const recTitle = (s: Section, r: Rec) => { const c = s.columns.find(x => x.type === 'text' && str(r[x.key])); return (c && str(r[c.key])) || r.id; };
const provOf = (r: Rec) => { const v = str(r.provenance ?? r.source ?? r._provenance).toUpperCase(); return v === 'LOCAL' ? 'LOCAL' : v === 'REFERENCE' ? 'REFERENCE' : v === 'LIVE' ? 'LIVE' : ''; };
/** "25 s ago", "3 min ago": freshness of a live source. */
const ago = (iso: string | null | undefined) => { if (!iso) return 'not yet'; const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };
/** Simulations may target live doors; edits and other actions may not. */
const LIVE_SAFE_ACTIONS = new Set(['simulate-unlock', 'simulate-lockdown']);

const chicago = (ms: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute};
};
const pad = (n: number) => String(n).padStart(2, '0');
/** GHL date-only fields arrive as UTC midnight; show them as the calendar date, not a shifted local time. */
const utcMidnight = (s: string) => /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(s);
const whenFull = (v: unknown) => { if (utcMidnight(str(v))) return new Date(str(v)).toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'}); const t = new Date(str(v)); return !str(v) || Number.isNaN(t.getTime()) ? str(v) || '-' : t.toLocaleString('en-US', {timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}) + ' CT'; };
const whenDate = (v: unknown) => {
  const s = str(v); if (!s) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
  const t = new Date(s); return Number.isNaN(t.getTime()) ? s : t.toLocaleDateString('en-US', {timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric'});
};
const toDateInput = (v: unknown) => { const s = str(v); if (!s) return ''; if (/^\d{4}-\d{2}-\d{2}/.test(s) && s.length === 10) return s; const t = new Date(s); if (Number.isNaN(t.getTime())) return ''; const c = chicago(t.getTime()); return c.y + '-' + pad(c.mo) + '-' + pad(c.d); };
const toDtInput = (v: unknown) => { const s = str(v); if (!s) return ''; const t = new Date(s); if (Number.isNaN(t.getTime())) return ''; const c = chicago(t.getTime()); return c.y + '-' + pad(c.mo) + '-' + pad(c.d) + 'T' + pad(c.h) + ':' + pad(c.mi); };
const fromDtInput = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v); if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const wall = (t: number) => { const c = chicago(t); return Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi); };
  if (new Date(target).toISOString().slice(0, 10) !== v.slice(0, 10)) return null;
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {const sample = target + hours * 3600000; offsets.add(wall(sample) - sample);}
  const candidates = [...new Set([...offsets].map(offset => target - offset).filter(candidate => wall(candidate) === target))];
  // Clock-change gaps and repeated wall times require an unambiguous local input.
  return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
};

const show = (c: Col, r: Rec): ReactNode => {
  const v = r[c.key];
  if (v === null || v === undefined || v === '') return <span className="wsc-dash" aria-label="empty">{'\u2013'}</span>;
  if (c.type === 'boolean') return v === true || v === 'true' ? 'Yes' : 'No';
  if (c.type === 'date') return whenDate(v);
  if (c.type === 'datetime') return whenFull(v);
  if (c.type === 'number') return typeof v === 'number' ? v.toLocaleString('en-US') : str(v);
  if (c.type === 'select') return <span className={'wsc-pill is-' + tone(str(v))}>{label(str(v))}</span>;
  return <span className="wsc-cell-clip" title={str(v)}>{str(v)}</span>;
};
/** Percent and money strings ("25.0%", "$10.00") align like numbers. */
const NUMERIC_TEXT = /^(conversion_rate|churn_rate|total_revenue|arpu)$/;
const isNumCol = (c: Col) => c.type === 'number' || c.type === 'date' || c.type === 'datetime' || NUMERIC_TEXT.test(c.key);
/** Raw captured markup is evidence, not a working column: kept in CSV, edit forms and details, hidden from tables and cards. */
const tableCols = (cols: Col[]) => cols.filter(c => c.key !== 'sourceDisplay');
const ACTION_ICON: Record<ActionKey, typeof Ban> = {'generate-report': FlaskConical, 'suspend-user': Ban, 'resume-user': RotateCcw, 'offboard-member': UserMinus, 'check-in-visitor': LogIn, 'check-out-visitor': LogOut, 'simulate-unlock': FlaskConical, 'simulate-lockdown': FlaskConical};
/** Sidebar grouping mirrors Kisi's navigation plus the Sheet. Unknown keys fall into a trailing "Other" group. */
const NAV_GROUPS: {label: string; keys: string[]}[] = [
  {label: 'Reports', keys: ['n8n-events', 'weekly-reports', 'packages', 'kpis', 'active-members', 'expiring', 'failed-payments', 'marketplace', 'leads', 'report-catalog', 'report-schedules']},
  {label: 'Dashboard', keys: [OVERVIEW, 'users', 'teams', 'groups', 'credentials', 'digital-credentials', 'apple-passes', 'access-rights', 'events', 'audit-events']},
  {label: 'Access control', keys: ['doors', 'hardware', 'floors', 'elevators', 'access-points', 'intrusion-zones', 'schedules']},
  {label: 'Applications', keys: ['visitors', 'visitor-points', 'badge-templates']},
  {label: 'Settings', keys: ['places', 'organization-settings', 'integrations', 'incidents', 'incident-policies', 'floor-plans', 'custom-roles', 'event-retention']},
];
type NavItem = {key: string; label: string; count?: number};

function LoadingSkeleton() {
  return <div role="status" aria-label="Loading local clone">
    <span className="wsc-sr">Loading local clone…</span>
    <div className="wsc-body" aria-hidden="true">
      <div className="wsc-nav"><div className="wsc-skel-nav">{Array.from({length: 10}, (_, i) => <span key={i} className="wsc-skel" style={{width: 60 + (i * 17) % 35 + '%'}} />)}</div></div>
      <div className="wsc-panel"><div className="wsc-sec-head"><span className="wsc-skel" style={{width: 180, height: 22}} /></div>
        {Array.from({length: 8}, (_, i) => <div key={i} className="wsc-skel-row"><span className="wsc-skel" /><span className="wsc-skel" /><span className="wsc-skel" /><span className="wsc-skel" /></div>)}</div>
    </div>
  </div>;
}

const csvCell = (v: unknown) => {
  let s = str(v);
  if (typeof v === 'string' && /^(?:\s*[=+\-@]|[\t\r])/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csvOf = (s: Section, rows: Rec[]) => {
  const head = ['ID', ...s.columns.map(c => c.label), 'Provenance'];
  const lines = rows.map(r => [csvCell(r.id), ...s.columns.map(c => csvCell(r[c.key])), csvCell(provOf(r))].join(','));
  return '\ufeff' + [head.map(h => csvCell(h)).join(','), ...lines].join('\r\n');
};

const initDraft = (s: Section, r?: Rec): Draft => {
  const d: Draft = {};
  for (const c of s.columns) {
    if (c.readOnly) continue;
    const v = r?.[c.key];
    d[c.key] = c.type === 'boolean' ? v === true || v === 'true' : c.type === 'date' ? toDateInput(v) : c.type === 'datetime' ? toDtInput(v) : v === null || v === undefined ? '' : str(v);
  }
  return d;
};

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
function Modal({labelId, descId, onClose, busy, children, alert}: {labelId: string; descId?: string; onClose: () => void; busy: boolean; children: ReactNode; alert?: boolean}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose); const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => { (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus(); }, 20);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); if (prev && document.contains(prev)) prev.focus(); };
  }, []);
  const trap = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)); const first = nodes[0], last = nodes[nodes.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return <div className="adm-overlay wsc-overlay"><section ref={ref} className="wsc-modal" role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={labelId} aria-describedby={descId} onKeyDown={trap}>{children}</section></div>;
}

/** Local badge preview. Nothing is sent or printed automatically; the person must press the print button. */
function BadgePreview({users}: {users: {id: string; name: string; title: string}[]}) {
  const [uid, setUid] = useState(''); const [name, setName] = useState(''); const [job, setJob] = useState(''); const [details, setDetails] = useState(''); const [logo, setLogo] = useState('');
  useEffect(() => () => { if (logo) URL.revokeObjectURL(logo); }, [logo]);
  const choose = (id: string) => { setUid(id); const u = users.find(x => x.id === id); if (u) { setName(u.name); setJob(u.title); } };
  return <div className="wsc-badge" role="group" aria-label="Local badge preview">
    <div className="wsc-badge-form">
      <h4>Badge preview <span className="wsc-pill is-local">Local only</span></h4>
      <p className="wsc-muted">Builds a preview in your browser. Nothing is saved, sent or printed until you press the print button.</p>
      <div className="wsc-field"><label htmlFor="wsc-b-user">User</label><select id="wsc-b-user" className="wsc-input" value={uid} onChange={e => choose(e.target.value)}><option value="">Choose a user (optional)</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div className="wsc-field"><label htmlFor="wsc-b-name">Name</label><input id="wsc-b-name" className="wsc-input" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="wsc-field"><label htmlFor="wsc-b-job">Job title</label><input id="wsc-b-job" className="wsc-input" value={job} onChange={e => setJob(e.target.value)} /></div>
      <div className="wsc-field"><label htmlFor="wsc-b-det">Details</label><textarea id="wsc-b-det" className="wsc-input" value={details} onChange={e => setDetails(e.target.value)} /></div>
      <div className="wsc-field"><label htmlFor="wsc-b-logo">Logo (stays in this browser)</label><input id="wsc-b-logo" className="wsc-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const f = e.target.files?.[0]; setLogo(f ? URL.createObjectURL(f) : ''); }} /></div>
      <button type="button" className="adm-button adm-secondary" disabled={!name.trim()} onClick={() => window.print()}>Print / Save local PDF</button>
    </div>
    <div className="wsc-badge-print" aria-label="Badge preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo && <img src={logo} alt="" className="wsc-badge-logo" />}
      <strong className="wsc-badge-name">{name || 'Name'}</strong>
      <span className="wsc-badge-job">{job || 'Job title'}</span>
      {details && <p className="wsc-badge-det">{details}</p>}
      <small className="wsc-badge-tag">Local preview, not a live credential</small>
    </div>
  </div>;
}

export default function WorkspaceClonePanel({canManage = true, onUnauthorized}: {canManage?: boolean; onUnauthorized: () => void}) {
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sectionKey, setSectionKey] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sorts, setSorts] = useState<Record<string, Sort>>({});
  const [ev, setEv] = useState<EvFilter>(NO_EV);
  const [detail, setDetail] = useState<{key: 'users' | 'groups'; id: string} | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogErr, setDialogErr] = useState('');
  const [conflict, setConflict] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const id = ++seq.current; if (!silent) { setLoading(true); setError(''); }
    try {
      const res = await request<Overview>('/admin/workspace-clone');
      if (id !== seq.current) return;
      setData({...res, sections: res.sections || [], summary: res.summary || {referenceActive: 0, referenceExpiring: 0, referenceFailed: 0, localActive: 0, localExpired: 0, localFailed: 0}});
    } catch (e) {
      if (id !== seq.current) return;
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      if (!silent) setError(msg(e));
    } finally { if (id === seq.current && !silent) setLoading(false); }
  }, [onUnauthorized]);
  useEffect(() => { if (!canManage) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load, canManage]);
  /* Live monitoring: refresh quietly every 30 s while nothing is being edited. */
  const liveOn = !!data?.live?.enabled;
  const pollBlocked = useRef(false);
  useEffect(() => { if (!liveOn) return; const t = setInterval(() => { if (!pollBlocked.current && document.visibilityState === 'visible') void load(true); }, 30000); return () => clearInterval(t); }, [liveOn, load]);
  const [liveBusy, setLiveBusy] = useState(false);
  const refreshLive = async () => { setLiveBusy(true); try { const res = await request<Overview>('/admin/workspace-clone/live/refresh', {method: 'POST', body: '{}'}); setData({...res, sections: res.sections || []}); toast.push({text: 'Live data refreshed from Kisi and the Sheet.'}); } catch (e) { if (e instanceof ApiError && e.status === 401) onUnauthorized(); toast.push({tone: 'error', text: msg(e)}); } finally { setLiveBusy(false); } };

  const sections = useMemo(() => data?.sections ?? [], [data]);
  const isOverview = sectionKey === OVERVIEW && sections.some(s => s.area === 'Access control');
  const section = isOverview ? undefined : sections.find(s => s.key === sectionKey) ?? sections[0];
  const navGroups = useMemo(() => {
    const items: NavItem[] = sections.map(s => ({key: s.key, label: s.label, count: s.records.length}));
    if (sections.some(s => s.area === 'Access control')) items.push({key: OVERVIEW, label: 'Overview'});
    const byKey = new Map(items.map(i => [i.key, i] as const)); const used = new Set<string>();
    const groups = NAV_GROUPS.map(g => ({label: g.label, items: g.keys.map(k => byKey.get(k)).filter((i): i is NavItem => !!i)}));
    groups.forEach(g => g.items.forEach(i => used.add(i.key)));
    const other = items.filter(i => !used.has(i.key));
    if (other.length) groups.push({label: 'Other', items: other});
    return groups.filter(g => g.items.length);
  }, [sections]);

  const statusCol = section?.columns.find(c => c.key === 'status');
  const statusOptions = useMemo(() => {
    if (!section || !statusCol) return [];
    return statusCol.options?.length ? statusCol.options : Array.from(new Set(section.records.map(r => str(r.status)).filter(Boolean))).sort();
  }, [section, statusCol]);

  const isEvents = !!section && EVENT_SECTIONS.includes(section.key);
  const evOptions = useMemo(() => !section || !isEvents ? {actions: [] as string[], users: [] as string[]} : {
    actions: Array.from(new Set(section.records.map(r => str(r.action)).filter(Boolean))).sort(),
    users: Array.from(new Set(section.records.map(r => str(r.user)).filter(Boolean))).sort(),
  }, [section, isEvents]);
  const evActive = isEvents && Object.values(ev).some(Boolean);
  const sort = section ? sorts[section.key] : undefined;
  const filtered = useMemo(() => {
    if (!section) return [];
    const q = search.trim().toLowerCase(); const oq = ev.object.trim().toLowerCase();
    const out = section.records.filter(r => {
      if (status && str(r.status) !== status) return false;
      if (q && !(r.id.toLowerCase().includes(q) || section.columns.some(c => str(r[c.key]).toLowerCase().includes(q)))) return false;
      if (EVENT_SECTIONS.includes(section.key)) {
        if (ev.action && str(r.action) !== ev.action) return false;
        if (ev.user && str(r.user) !== ev.user) return false;
        if (oq && !str(r.object).toLowerCase().includes(oq)) return false;
        if (ev.from || ev.to) { const d = toDateInput(r.occurredAt); if (!d || (ev.from && d < ev.from) || (ev.to && d > ev.to)) return false; }
      }
      return true;
    });
    const col = sort && section.columns.find(c => c.key === sort.key);
    if (!sort || !col) return out;
    const val = (r: Rec): number | string | null => {
      const v = r[col.key]; if (v === null || v === undefined || v === '') return null;
      if (col.type === 'number') { const n = Number(v); return Number.isFinite(n) ? n : null; }
      if (col.type === 'date' || col.type === 'datetime') { const t = Date.parse(str(v)); return Number.isNaN(t) ? str(v) : t; }
      if (col.type === 'boolean') return v === true || v === 'true' ? 1 : 0;
      return str(v).toLowerCase();
    };
    const m = sort.dir === 'asc' ? 1 : -1;
    return [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
      return String(x).localeCompare(String(y), undefined, {numeric: true}) * m;
    });
  }, [section, search, status, sort, ev]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages);
  const rows = filtered.slice((cur - 1) * pageSize, cur * pageSize);

  const pick = (key: string) => { setSectionKey(key); setSearch(''); setStatus(''); setPage(1); setEv(NO_EV); setDetail(null); };
  const toggleSort = (key: string) => {
    if (!section) return; const sk = section.key;
    setSorts(prev => { const c = prev[sk]; const next = {...prev};
      if (!c || c.key !== key) next[sk] = {key, dir: 'asc'}; else if (c.dir === 'asc') next[sk] = {key, dir: 'desc'}; else delete next[sk];
      return next; });
    setPage(1);
  };
  const onNavKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; const edge = e.key === 'Home' ? 0 : e.key === 'End' ? -1 : null;
    if (!dir && edge === null) return;
    const all = Array.from(e.currentTarget.closest('nav')?.querySelectorAll<HTMLButtonElement>('button.wsc-nav-item') ?? []); const i = all.indexOf(e.currentTarget);
    const j = edge === null ? Math.min(all.length - 1, Math.max(0, i + dir)) : edge < 0 ? all.length - 1 : 0;
    e.preventDefault(); all[j]?.focus();
  };

  useEffect(() => { pollBlocked.current = !!dialog || busy; }, [dialog, busy]);
  const closeDialog = () => { if (busy) return; setDialog(null); setDialogErr(''); setFieldErr({}); setConflict(false); };
  const openDialog = (d: Dialog, target: Section | undefined = section) => {
    setDialogErr(''); setFieldErr({}); setConflict(false); setUserId('');
    if (d.kind === 'form' && target) setDraft(initDraft(target, d.record));
    setDialog(d);
  };

  const exportCsv = () => {
    if (!section) return;
    const url = URL.createObjectURL(new Blob([csvOf(section, filtered)], {type: 'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'workspace-clone-' + section.key + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.push({text: 'Exported ' + filtered.length + ' row' + (filtered.length === 1 ? '' : 's') + ' from ' + section.label + '.'});
  };

  /** Runs a write, then swaps in the returned overview. A 409 means someone else changed the clone: ask for a reload. */
  const mutate = async (fn: (revision: number) => Promise<Overview>, done: string) => {
    if (!data) return;
    setBusy(true); setDialogErr(''); setConflict(false);
    try {
      const res = await fn(data.revision);
      setData({...res, sections: res.sections || []});
      setDialog(null);
      toast.push({text: res.notice || done});
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      if (e instanceof ApiError && e.status === 409) { setConflict(true); setDialogErr('The local clone changed since you loaded it, so nothing was saved. Reload the latest data and try again.'); }
      else setDialogErr(msg(e));
    } finally { setBusy(false); }
  };
  const reloadAfterConflict = async () => { setDialog(null); setConflict(false); setDialogErr(''); await load(); toast.push({tone: 'info', text: 'Reloaded the latest local clone data.'}); };

  const submitForm = (e: FormEvent) => {
    e.preventDefault();
    if (!section || dialog?.kind !== 'form') return;
    const errs: Record<string, string> = {}; const out: Record<string, unknown> = {};
    for (const c of section.columns) {
      if (c.readOnly) continue;
      const raw = draft[c.key]; const s = typeof raw === 'string' ? raw.trim() : '';
      if (c.type === 'boolean') { out[c.key] = raw === true; continue; }
      if (!s) { if (c.required) errs[c.key] = c.label + ' is required.'; out[c.key] = c.type === 'number' || c.type === 'date' || c.type === 'datetime' ? null : ''; continue; }
      if (c.type === 'number') { const n = Number(s); if (!Number.isFinite(n)) errs[c.key] = 'Enter a valid number.'; else out[c.key] = n; }
      else if (c.type === 'datetime') { const iso = fromDtInput(s); if (!iso) errs[c.key] = 'Enter a valid date and time.'; else out[c.key] = iso; }
      else out[c.key] = typeof raw === 'string' && c.type !== 'textarea' ? s : raw;
    }
    setFieldErr(errs);
    if (Object.keys(errs).length) { setTimeout(() => document.querySelector<HTMLElement>('.wsc-modal [aria-invalid="true"]')?.focus(), 0); return; }
    const base = '/admin/workspace-clone/records/' + encodeURIComponent(section.key);
    if (dialog.mode === 'create') void mutate(rev => request<Overview>(base, {method: 'POST', body: JSON.stringify({revision: rev, data: out})}), 'Local record added.');
    else void mutate(rev => request<Overview>(base + '/' + encodeURIComponent(dialog.record!.id), {method: 'PATCH', body: JSON.stringify({revision: rev, data: out})}), 'Local record saved.');
  };
  const submitDelete = () => {
    if (!section || dialog?.kind !== 'delete') return; const id = dialog.record.id;
    void mutate(rev => request<Overview>('/admin/workspace-clone/records/' + encodeURIComponent(section.key) + '/' + encodeURIComponent(id), {method: 'DELETE', body: JSON.stringify({revision: rev})}), 'Local record deleted.');
  };
  const userChoices = useMemo(() => (sections.find(s => s.key === 'users')?.records ?? []).map(r => ({id: r.id, name: str(r.name) || str(r.fullName) || str(r.email) || r.id, title: str(r.jobTitle)})), [sections]);
  const submitAction = () => {
    if (dialog?.kind !== 'action') return; const {def, record} = dialog;
    if (def.needsUser && !userId) { setDialogErr('Choose a user for the simulated unlock.'); return; }
    void mutate(rev => request<Overview>('/admin/workspace-clone/actions', {method: 'POST', body: JSON.stringify({revision: rev, action: def.action, ...((dialog.sec ?? section?.key) ? {section: dialog.sec ?? section?.key} : {}), ...(record ? {id: record.id} : {}), ...(def.needsUser ? {data: {userId}} : {})})}), def.label + ' done (local only).');
  };

  if (!canManage) return <section className="wsc"><EmptyState icon={<FlaskConical size={22} />} title="Administrators only" text="Workspace operations is available to administrator accounts." /></section>;

  const sectionActions = section ? (ACTIONS[section.key] ?? []).filter(a => a.scope === 'section').concat(section.key === 'doors' ? [DOORS_ALL] : []) : [];
  const rowActions = section ? (ACTIONS[section.key] ?? []).filter(a => a.scope === 'row') : [];
  const canEdit = !!section && !section.readOnly;
  const writesOn = !!data?.live?.enabled && !!data?.live?.writesEnabled;
  const kisiSection = writesOn && !!section && (data?.live?.syncSections ?? ['users', 'access-rights']).includes(section.key);
  /** A live row is editable only where two-way sync covers its section. */
  const rowEditable = (p: string) => p !== 'LIVE' || kisiSection;
  const dialogLive = (r?: Rec) => !!r && provOf(r) === 'LIVE' && writesOn;
  const hasDetail = !!section && DETAIL_SECTIONS.includes(section.key);
  const nameKey = hasDetail ? 'name' : '';
  const hasRowCol = canEdit || rowActions.length > 0 || hasDetail;
  const actSection = dialog?.kind === 'action' ? sections.find(s => s.key === (dialog.sec ?? section?.key)) : undefined;
  const sheets = safeUrl(data?.sourceLinks?.sheets), kisi = safeUrl(data?.sourceLinks?.kisi);
  const sum = data?.summary;

  const activeKey = isOverview ? OVERVIEW : section?.key ?? '';
  const titleKey = section?.columns.find(c => c.type === 'text')?.key;
  const lockdown = data?.localLockdown ? 'ON' : 'OFF';

  return (
    <section className="wsc" aria-label="Workspace operations" aria-busy={loading}>
      <div className="wsc-top">
        <p className="wsc-sub">{data ? (liveOn ? <><span className="wsc-live-dot" aria-hidden="true" /><span className="wsc-sub-long">Live from Kisi and the Workspace Growth sheet · </span>Kisi {ago(data.live?.kisi?.fetchedAt)} · Sheet {ago(data.live?.sheets?.fetchedAt)} · <span title="Simulated place lockdown">lockdown {lockdown}</span></> : <><span className="wsc-sub-long">Local copy of the Workspace Growth sheet and Kisi · </span>captured {whenFull(data.capturedAt)} · revision {data.revision} · <span title="Simulated place lockdown">lockdown {lockdown}</span></>) : 'Workspace Growth sheet and Kisi.'}</p>
        <div className="wsc-top-right">
          {sheets && <a className="wsc-src" href={sheets} target="_blank" rel="noopener noreferrer" aria-label="Reference sheet (read-only)">Sheet<ExternalLink size={13} aria-hidden="true" /></a>}
          {kisi && <a className="wsc-src" href={kisi} target="_blank" rel="noopener noreferrer" aria-label="Reference Kisi (read-only)">Kisi<ExternalLink size={13} aria-hidden="true" /></a>}
          {liveOn ? <button type="button" className="adm-button adm-secondary" disabled={liveBusy} onClick={() => void refreshLive()}><RefreshCw size={16} className={liveBusy ? 'adm-spin' : ''} aria-hidden="true" />Refresh live</button> : <button type="button" className="adm-button adm-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'adm-spin' : ''} aria-hidden="true" />Reload</button>}
        </div>
      </div>

      {liveOn ? <div className={'wsc-notice' + (data?.live?.kisi?.error || data?.live?.sheets?.error ? ' is-warn' : ' is-live')} role="status"><ShieldCheck size={16} aria-hidden="true" /><span>{data?.live?.kisi?.error ? 'Kisi live data paused: ' + data.live.kisi.error + ' ' : ''}{data?.live?.sheets?.error ? 'Sheet live data paused: ' + data.live.sheets.error + ' ' : ''}{!data?.live?.kisi?.error && !data?.live?.sheets?.error ? 'Live monitoring on: door and device status, users, groups, access and events refresh from Kisi every minute; the Sheet every 2 minutes. ' : ''}{data?.live?.writesEnabled ? 'Live sync to Kisi is on: changes to users and access rights apply to real doors. Other live rows are read-only.' : 'Live rows are read-only; live sync to Kisi is off.'}</span></div> : <div className="wsc-notice" role="note"><ShieldCheck size={16} aria-hidden="true" /><span>{BANNER}</span></div>}

      {error && <div className="adm-alert" role="alert">{error}<button type="button" className="adm-text-button" onClick={() => void load()}>Try again</button></div>}
      {loading && !data && !error && <LoadingSkeleton />}

      {data && <>
        {sum && <div className="wsc-kpis">
          <div className="wsc-kpi-group" role="group" aria-label="Captured reference counts">
            <h3>{liveOn ? 'Live from Sheet' : 'Captured from source'}</h3>
            <div className="wsc-kpi"><span>Active</span><strong>{sum.referenceActive}</strong></div><div className="wsc-kpi"><span>Expiring</span><strong>{sum.referenceExpiring}</strong></div><div className="wsc-kpi"><span>Failed</span><strong>{sum.referenceFailed}</strong></div>
          </div>
          <div className="wsc-kpi-group" role="group" aria-label="Local derived counts">
            <h3>{liveOn ? 'Counted from live members' : 'Live in this clone'}</h3>
            <div className="wsc-kpi"><span>Active</span><strong>{sum.localActive}</strong></div><div className="wsc-kpi"><span>Expired</span><strong>{sum.localExpired}</strong></div><div className="wsc-kpi"><span>Failed</span><strong>{sum.localFailed}</strong></div>
          </div>
        </div>}

        {sections.length === 0 ? <div className="wsc-panel"><div className="wsc-empty"><p>The backend returned no sections. Once the reference import has run, they will appear here.</p><button type="button" className="adm-button adm-secondary" onClick={() => void load()}>Reload</button></div></div> : <div className="wsc-body">
          <nav className="wsc-nav" aria-label="Sections">
            {navGroups.map((g, gi) => <div key={g.label} className="wsc-nav-group">
              <p className="wsc-nav-label" id={'wsc-grp-' + gi}>{g.label}</p>
              <ul aria-labelledby={'wsc-grp-' + gi}>
                {g.items.map(s => <li key={s.key}><button id={'wsc-tab-' + s.key} type="button" className="wsc-nav-item" aria-current={s.key === activeKey ? 'page' : undefined} onClick={() => pick(s.key)} onKeyDown={onNavKey}><span>{s.label}</span>{s.count !== undefined && <span className="wsc-nav-count">{s.count}</span>}</button></li>)}
              </ul>
            </div>)}
          </nav>

          <div className="wsc-main">
            <div className="wsc-select-wrap">
              <label htmlFor="wsc-section-select">Section</label>
              <select id="wsc-section-select" className="wsc-input" value={activeKey} onChange={e => pick(e.target.value)}>
                {navGroups.map(g => <optgroup key={g.label} label={g.label}>{g.items.map(s => <option key={s.key} value={s.key}>{s.label + (s.count !== undefined ? ' (' + s.count + ')' : '')}</option>)}</optgroup>)}
              </select>
            </div>

            {isOverview && <section className="wsc-panel" id="wsc-panel" aria-labelledby="wsc-sec-title">
              <div className="wsc-sec-head"><div className="wsc-sec-text"><h2 id="wsc-sec-title">Overview</h2><p>Place status, quick actions, doors and recent access activity from the local clone.</p></div></div>
              <OverviewView sections={sections} localLockdown={!!data.localLockdown}
                onAdd={key => { const t = sections.find(s => s.key === key); if (!t) return; pick(key); openDialog({kind: 'form', mode: 'create'}, t); }}
                onSuspendUsers={() => { pick('users'); setStatus('Enabled'); }}
                onViewAll={pick}
                onSimulate={door => openDialog({kind: 'action', def: ACTIONS.doors[0], record: door as Rec, sec: 'doors'})} />
            </section>}

            {section && <section className="wsc-panel" id="wsc-panel" aria-labelledby="wsc-sec-title">
              <div className="wsc-sec-head">
                <div className="wsc-sec-text"><h2 id="wsc-sec-title">{section.label}{section.readOnly && <span className="wsc-pill">Read-only</span>}</h2><p>{section.description}</p></div>
                <div className="wsc-sec-actions">
                  {sectionActions.map(a => <button key={a.label} type="button" className="adm-button adm-secondary" onClick={() => openDialog({kind: 'action', def: a})}><FlaskConical size={15} aria-hidden="true" />{a.label}</button>)}
                  {canEdit && <button type="button" className="adm-button adm-primary" onClick={() => openDialog({kind: 'form', mode: 'create'})}><Plus size={16} aria-hidden="true" />{kisiSection ? 'Add to Kisi' : 'Add local record'}</button>}
                </div>
              </div>
              <div className="wsc-toolbar">
                <div className="wsc-search"><Search size={15} aria-hidden="true" /><input className="wsc-input" type="search" aria-label={'Search ' + section.label} placeholder="Search this section…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
                {statusCol && <select className="wsc-input" aria-label="Filter by status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{statusOptions.map(o => <option key={o} value={o}>{label(o)}</option>)}</select>}
                <span className="wsc-toolbar-gap" />
                <label className="wsc-ipp">Items per page <select className="wsc-input" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
                <button type="button" className="adm-button adm-secondary" onClick={exportCsv} disabled={filtered.length === 0}><Download size={15} aria-hidden="true" />Export CSV</button>
              </div>

              {isEvents && <div className="wsc-evf" role="group" aria-label="Event filters">
                <label className="wsc-evf-f">Action<select className="wsc-input" value={ev.action} onChange={e => { setEv({...ev, action: e.target.value}); setPage(1); }}><option value="">All actions</option>{evOptions.actions.map(o => <option key={o} value={o}>{o}</option>)}</select></label>
                <label className="wsc-evf-f">User<select className="wsc-input" value={ev.user} onChange={e => { setEv({...ev, user: e.target.value}); setPage(1); }}><option value="">All users</option>{evOptions.users.map(o => <option key={o} value={o}>{o}</option>)}</select></label>
                <label className="wsc-evf-f">Object<input className="wsc-input" type="text" value={ev.object} onChange={e => { setEv({...ev, object: e.target.value}); setPage(1); }} /></label>
                <label className="wsc-evf-f">From (Chicago)<input className="wsc-input" type="date" value={ev.from} max={ev.to || undefined} onChange={e => { setEv({...ev, from: e.target.value}); setPage(1); }} /></label>
                <label className="wsc-evf-f">To (Chicago)<input className="wsc-input" type="date" value={ev.to} min={ev.from || undefined} onChange={e => { setEv({...ev, to: e.target.value}); setPage(1); }} /></label>
              </div>}
              {section.key === 'badge-templates' && <BadgePreview users={userChoices.map(u => ({id: u.id, name: u.name, title: u.title}))} />}
              {filtered.length === 0 ? <div className="wsc-empty" role="status"><p>{section.records.length === 0 ? 'No records in this section yet.' : 'No records match your search or filter.'}</p>
                {section.records.length === 0 && canEdit && <button type="button" className="adm-button adm-secondary" onClick={() => openDialog({kind: 'form', mode: 'create'})}><Plus size={15} aria-hidden="true" />Add the first local record</button>}
                {(search || status || evActive) && <button type="button" className="adm-text-button" onClick={() => { setSearch(''); setStatus(''); setEv(NO_EV); setPage(1); }}>Clear filters</button>}</div> : <div className="wsc-scroll" tabIndex={0} role="region" aria-label={section.label + ' table'}>
                <table className="wsc-table wsc-table--cards">
                  <thead><tr>{tableCols(section.columns).map(c => { const on = sort?.key === c.key; return <th key={c.key} scope="col" className={isNumCol(c) ? 'is-num' : ''} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className="wsc-sort" data-on={on} onClick={() => toggleSort(c.key)}>{c.label}<span className="wsc-sort-glyph" aria-hidden="true">{on ? (sort!.dir === 'asc' ? '\u25B2' : '\u25BC') : '\u21C5'}</span></button></th>; })}<th scope="col" className="wsc-nosort">Source</th>{hasRowCol && <th scope="col" className="wsc-row-actions wsc-row-actions-h wsc-nosort">Actions</th>}</tr></thead>
                  <tbody>{rows.map(r => { const p = provOf(r); const t = recTitle(section, r); return <tr key={r.id}>
                    {tableCols(section.columns).map(c => <td key={c.key} data-label={c.label} className={(isNumCol(c) ? 'is-num' : '') + (c.key === titleKey ? ' is-title' : '')}>{c.key === nameKey && str(r[c.key]) ? <button type="button" className="wsc-link" title={str(r[c.key])} onClick={() => setDetail({key: section.key as 'users' | 'groups', id: r.id})}>{str(r[c.key])}</button> : show(c, r)}</td>)}
                    <td data-label="Source">{p ? <span className={'wsc-pill ' + (p === 'LOCAL' ? 'is-local' : p === 'LIVE' ? 'is-live' : 'is-ref')}>{p === 'LOCAL' ? 'Local' : p === 'LIVE' ? 'Live' : 'Reference'}</span> : <span className="wsc-dash" aria-label="empty">{'\u2013'}</span>}</td>
                    {hasRowCol && <td className="wsc-row-actions"><div className="wsc-row-actions-inner">
                      {hasDetail && <button type="button" className="wsc-icon-btn" aria-label={'View ' + t} title="View" onClick={() => setDetail({key: section.key as 'users' | 'groups', id: r.id})}><Eye size={16} aria-hidden="true" /><span className="wsc-act-t" aria-hidden="true">View</span></button>}
                      {rowActions.filter(a => p !== 'LIVE' || LIVE_SAFE_ACTIONS.has(a.action) || (writesOn && KISI_ACTIONS.has(a.action))).map(a => { const Icon = ACTION_ICON[a.action]; return <button key={a.action} type="button" className="wsc-icon-btn" aria-label={a.label + ': ' + t} title={a.label} onClick={() => openDialog({kind: 'action', def: a, record: r})}><Icon size={16} aria-hidden="true" /><span className="wsc-act-t" aria-hidden="true">{a.label}</span></button>; })}
                      {canEdit && rowEditable(p) && <><button type="button" className="wsc-icon-btn" aria-label={'Edit ' + t} title="Edit" onClick={() => openDialog({kind: 'form', mode: 'edit', record: r})}><Pencil size={16} aria-hidden="true" /><span className="wsc-act-t" aria-hidden="true">Edit</span></button>
                      {(p !== 'LIVE' || section.key === 'access-rights') && <button type="button" className="wsc-icon-btn is-danger" aria-label={'Delete ' + t} title="Delete" onClick={() => openDialog({kind: 'delete', record: r})}><Trash2 size={16} aria-hidden="true" /><span className="wsc-act-t" aria-hidden="true">Delete</span></button>}</>}
                    </div></td>}
                  </tr>; })}</tbody>
                </table>
              </div>}

              <div className="wsc-foot">
                <span role="status">{filtered.length === section.records.length ? filtered.length + ' record' + (filtered.length === 1 ? '' : 's') : filtered.length + ' of ' + section.records.length + ' records'}</span>
                <div className="wsc-pager">
                  <button type="button" className="wsc-icon-btn" aria-label="Previous page" disabled={cur <= 1} onClick={() => setPage(cur - 1)}><ChevronLeft size={16} /></button>
                  <span>Page {cur} of {pages}</span>
                  <button type="button" className="wsc-icon-btn" aria-label="Next page" disabled={cur >= pages} onClick={() => setPage(cur + 1)}><ChevronRight size={16} /></button>
                </div>
              </div>
            </section>}
          </div>
        </div>}
      </>}

      {detail && (() => { const rec = sections.find(s => s.key === detail.key)?.records.find(r => r.id === detail.id); if (!rec) return null;
        const sec = sections.find(s => s.key === detail.key)!;
        return <RecordDrawer kind={detail.key} record={rec} sections={sections} canEdit={canEdit && !sec.readOnly && (provOf(rec) !== 'LIVE' || (writesOn && (data?.live?.syncSections ?? []).includes(sec.key)))} onClose={() => setDetail(null)}
          onEdit={() => openDialog({kind: 'form', mode: 'edit', record: rec}, sec)}
          onLocalAction={detail.key === 'users' ? a => openDialog({kind: 'action', def: ACTIONS.users.find(d => d.action === a)!, record: rec, sec: 'users'}, sec) : undefined} />; })()}

      {dialog?.kind === 'form' && section && <Modal labelId="wsc-form-title" onClose={closeDialog} busy={busy}>
        <form onSubmit={submitForm} noValidate style={{display: 'grid', gap: 14}}>
          <h2 id="wsc-form-title">{dialog.mode === 'create' ? 'Add local record' : 'Edit local record'}: {section.label}</h2>
          <p>{dialog.kind === 'form' && ((dialog.mode === 'create' && kisiSection) || dialogLive(dialog.record)) ? <><strong>Saved to Kisi.</strong> {REAL_KISI}</> : <>Saved only in the local clone. {NO_LIVE}</>}</p>
          <div className="wsc-form">
            {section.columns.filter(c => !c.readOnly).map(c => {
              const id = 'wsc-f-' + c.key; const err = fieldErr[c.key]; const v = draft[c.key]; const set = (x: string | boolean) => setDraft(d => ({...d, [c.key]: x}));
              const aria = {id, 'aria-invalid': err ? true : undefined, 'aria-describedby': err ? id + '-err' : undefined, 'aria-required': c.required || undefined} as const;
              const pickSrc = PICKER_SOURCE[c.key] && (c.type === 'text' || c.type === 'textarea') ? sections.find(s => s.key === PICKER_SOURCE[c.key]) : undefined;
              const pickOpts = pickSrc ? pickSrc.records.map(r => str(PICKER_SOURCE[c.key] === 'users' ? r.email : r.name)).filter(Boolean) : [];
              if (pickOpts.length) return <div key={c.key} className="wsc-field is-wide"><span>{c.label}{c.required && <span className="wsc-req" aria-hidden="true"> *</span>}</span>
                <MultiPicker id={id} label={c.label} options={pickOpts} value={String(v ?? '')} onChange={set} invalid={!!err} describedBy={err ? id + '-err' : undefined} required={c.required} />
                {err && <span className="wsc-err" id={id + '-err'}>{err}</span>}</div>;
              if (c.type === 'boolean') return <label key={c.key} className="wsc-field is-check"><input type="checkbox" id={id} checked={v === true} onChange={e => set(e.target.checked)} />{c.label}</label>;
              const opts = c.options ?? [];
              return <div key={c.key} className={'wsc-field' + (c.type === 'textarea' ? ' is-wide' : '')}>
                <label htmlFor={id}>{c.label}{c.required && <span className="wsc-req" aria-hidden="true"> *</span>}</label>
                {c.type === 'textarea' ? <textarea className="wsc-input" {...aria} value={String(v ?? '')} onChange={e => set(e.target.value)} />
                  : c.type === 'select' ? <select className="wsc-input" {...aria} value={String(v ?? '')} onChange={e => set(e.target.value)}><option value="">{c.required ? 'Choose…' : 'None'}</option>{opts.map(o => <option key={o} value={o}>{label(o)}</option>)}{!!v && !opts.includes(String(v)) && <option value={String(v)}>{String(v)}</option>}</select>
                  : <input className="wsc-input" {...aria} type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : c.type === 'datetime' ? 'datetime-local' : 'text'} step={c.type === 'number' ? 'any' : undefined} value={String(v ?? '')} onChange={e => set(e.target.value)} />}
                {c.type === 'datetime' && <span>Chicago time</span>}
                {err && <span className="wsc-err" id={id + '-err'}>{err}</span>}
              </div>;
            })}
          </div>
          {section.columns.some(c => c.readOnly) && <p>Read-only fields ({section.columns.filter(c => c.readOnly).map(c => c.label).join(', ')}) are managed by the clone and not editable.</p>}
          {dialogErr && <div className="adm-alert" role="alert" style={{margin: 0}}>{dialogErr}{conflict && <button type="button" className="adm-text-button" onClick={() => void reloadAfterConflict()}>Reload latest</button>}</div>}
          <div className="wsc-modal-actions">
            <button type="button" className="adm-button adm-secondary" disabled={busy} onClick={closeDialog}>Cancel</button>
            <button type="submit" className="adm-button adm-primary" disabled={busy}>{busy ? 'Saving…' : dialog.mode === 'create' ? 'Add local record' : 'Save local record'}</button>
          </div>
        </form>
      </Modal>}

      {dialog?.kind === 'delete' && section && <Modal labelId="wsc-del-title" descId="wsc-del-body" onClose={closeDialog} busy={busy} alert>
        <h2 id="wsc-del-title">{dialogLive(dialog.record) ? 'Remove this access in Kisi?' : 'Delete this local record?'}</h2>
        <p id="wsc-del-body">{dialogLive(dialog.record) ? <>&ldquo;{recTitle(section, dialog.record)}&rdquo; loses this door access in Kisi. {REAL_KISI}</> : <>&ldquo;{recTitle(section, dialog.record)}&rdquo; will be removed from the local clone. {NO_LIVE} The reference source is not changed.</>}</p>
        {dialogErr && <div className="adm-alert" role="alert" style={{margin: 0}}>{dialogErr}{conflict && <button type="button" className="adm-text-button" onClick={() => void reloadAfterConflict()}>Reload latest</button>}</div>}
        <div className="wsc-modal-actions">
          <button type="button" data-autofocus className="adm-button adm-secondary" disabled={busy} onClick={closeDialog}>Cancel</button>
          <button type="button" className="adm-button adm-delete" disabled={busy} onClick={submitDelete}>{busy ? 'Deleting…' : 'Delete local record'}</button>
        </div>
      </Modal>}

      {dialog?.kind === 'action' && <Modal labelId="wsc-act-title" descId="wsc-act-body" onClose={closeDialog} busy={busy} alert>
        <h2 id="wsc-act-title">{dialog.def.title}</h2>
        <p id="wsc-act-body">{dialog.def.body}{dialog.record && actSection ? ' Target: ' + recTitle(actSection, dialog.record) + '.' : ''}</p>
        {dialogLive(dialog.record) && KISI_ACTIONS.has(dialog.def.action) ? <p className="wsc-check-note is-real"><strong>Real change in Kisi.</strong> {REAL_KISI}</p> : <p className="wsc-check-note"><strong>No live changes.</strong> {NO_LIVE}</p>}
        {dialog.def.needsUser && <div className="wsc-field"><label htmlFor="wsc-unlock-user">User for the simulated unlock <span className="wsc-req" aria-hidden="true">*</span></label>
          <select id="wsc-unlock-user" className="wsc-input" aria-required="true" value={userId} onChange={e => { setUserId(e.target.value); setDialogErr(''); }}>
            <option value="">Choose a user…</option>{userChoices.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>{userChoices.length === 0 && <span className="wsc-err">No users in the clone yet. Add one in the Users section first.</span>}</div>}
        {dialogErr && <div className="adm-alert" role="alert" style={{margin: 0}}>{dialogErr}{conflict && <button type="button" className="adm-text-button" onClick={() => void reloadAfterConflict()}>Reload latest</button>}</div>}
        <div className="wsc-modal-actions">
          <button type="button" data-autofocus className="adm-button adm-secondary" disabled={busy} onClick={closeDialog}>Cancel</button>
          <button type="button" className="adm-button adm-primary" disabled={busy || (!!dialog.def.needsUser && userChoices.length === 0)} onClick={submitAction}>{busy ? 'Working…' : 'Run: ' + dialog.def.label}</button>
        </div>
      </Modal>}
    </section>
  );
}
