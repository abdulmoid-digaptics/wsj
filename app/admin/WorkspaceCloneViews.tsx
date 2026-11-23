'use client';
/**
 * Derived, client-side views for the local workspace clone: Overview dashboard, record detail drawer and multi-select picker.
 * Everything is computed from section records already loaded by WorkspaceClonePanel. No network requests are made here.
 */
import {useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode} from 'react';
import {ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, DoorOpen, Pencil, Search, ShieldAlert, UserPlus, Users as UsersIcon, UserX, Share2, Ticket} from 'lucide-react';

export type VRec = {id: string; [k: string]: unknown};
export type VSection = {key: string; label: string; records: VRec[]};

const TZ = 'America/Chicago';
const str = (v: unknown) => v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const pad = (n: number) => String(n).padStart(2, '0');
const chicago = (ms: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute};
};
const fmtTime = (v: unknown) => { const t = new Date(str(v)); return !str(v) || Number.isNaN(t.getTime()) ? str(v) || '-' : t.toLocaleString('en-US', {timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}) + ' CT'; };
const pillTone = (s: string) => { const k = s.toLowerCase(); return /suspend|revok|fail|offline|denied/.test(k) ? 'bad' : /unknown|pending|reference|draft/.test(k) ? 'warn' : /enabled|active|online|unlocked|allowed/.test(k) ? 'good' : 'neutral'; };
export const splitList = (v: unknown) => str(v).split(',').map(s => s.trim()).filter(Boolean);
const recs = (secs: VSection[], key: string) => secs.find(s => s.key === key)?.records ?? [];
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ---------------------------------------------------------------- Multi-select picker */
export function MultiPicker({id, label, options, value, onChange, invalid, describedBy, required}: {id: string; label: string; options: string[]; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string; required?: boolean}) {
  const [q, setQ] = useState('');
  const selected = splitList(value);
  const known = useMemo(() => Array.from(new Set(options.filter(Boolean))), [options]);
  const extras = selected.filter(s => !known.includes(s));
  const all = [...known, ...extras];
  const shown = all.filter(o => o.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (o: string) => onChange((selected.includes(o) ? selected.filter(s => s !== o) : [...selected, o]).join(', '));
  return <div className="wsc-multi" role="group" aria-labelledby={id + '-lbl'}>
    <span id={id + '-lbl'} className="wsc-sr">{label}</span>
    <input id={id} className="wsc-input" type="search" placeholder={'Search ' + label.toLowerCase() + '…'} aria-label={'Search options for ' + label} aria-invalid={invalid ? true : undefined} aria-describedby={describedBy} aria-required={required || undefined} value={q} onChange={e => setQ(e.target.value)} />
    <div className="wsc-multi-list">
      {shown.length === 0 ? <span className="wsc-muted">No matches.</span> : shown.map((o, i) => <label key={o + i} className="wsc-multi-item"><input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} /><span>{o}{extras.includes(o) ? ' (not in list)' : ''}</span></label>)}
    </div>
    <span className="wsc-muted" role="status">{selected.length} selected{selected.length ? ': ' + selected.join(', ') : ''}</span>
  </div>;
}

/* ---------------------------------------------------------------- Overview */
function weekDays(offset: number) {
  const c = chicago(Date.now()); const base = Date.UTC(c.y, c.mo - 1, c.d);
  const dow = (new Date(base).getUTCDay() + 6) % 7;
  const mon = base - dow * 864e5 + offset * 7 * 864e5;
  return Array.from({length: 7}, (_, i) => new Date(mon + i * 864e5).toISOString().slice(0, 10));
}
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric'});

const OV_ROWS = 6;
export function OverviewView({sections, localLockdown, onAdd, onSuspendUsers, onSimulate, onViewAll}: {sections: VSection[]; localLockdown: boolean; onAdd: (key: 'users' | 'access-rights' | 'visitors') => void; onSuspendUsers: () => void; onSimulate: (door: VRec) => void; onViewAll?: (key: 'doors' | 'events') => void}) {
  const [doorQ, setDoorQ] = useState(''); const [week, setWeek] = useState(0);
  const places = recs(sections, 'places'), doors = recs(sections, 'doors'), hardware = recs(sections, 'hardware'), events = recs(sections, 'events');
  const place = places[0];
  const bad = hardware.filter(h => str(h.status).toLowerCase() !== 'online');
  const ok = bad.length === 0 && !localLockdown;
  const dq = doorQ.trim().toLowerCase();
  const doorRows = doors.filter(d => !dq || str(d.name).toLowerCase().includes(dq) || str(d.floor).toLowerCase().includes(dq));
  const history = useMemo(() => {
    const stamp = (r: VRec) => { const t = Date.parse(str(r.occurredAt)); return Number.isNaN(t) ? null : t; };
    const dated = events.filter(r => stamp(r) !== null).sort((a, b) => stamp(b)! - stamp(a)!);
    return [...dated, ...events.filter(r => stamp(r) === null)].slice(0, OV_ROWS);
  }, [events]);
  const days = weekDays(week);
  const counts = useMemo(() => {
    const sets: Record<string, Set<string>> = Object.fromEntries(days.map(d => [d, new Set<string>()]));
    for (const e of events) {
      if (str(e.provenance).toUpperCase() !== 'LOCAL' || !/UNLOCK_ALLOWED/i.test(str(e.action))) continue;
      const t = Date.parse(str(e.occurredAt)); if (Number.isNaN(t)) continue;
      const c = chicago(t); const k = c.y + '-' + pad(c.mo) + '-' + pad(c.d);
      if (sets[k]) sets[k].add(str(e.user).toLowerCase() || e.id);
    }
    return days.map(d => sets[d].size);
  }, [events, days]);
  const max = Math.max(1, ...counts);
  const quick: {key: string; title: string; text: string; icon: ReactNode; run: () => void}[] = [
    {key: 'add', title: 'Add Users', text: 'Create a local user record.', icon: <UserPlus size={16} aria-hidden="true" />, run: () => onAdd('users')},
    {key: 'share', title: 'Share Access', text: 'Assign a group with a time window.', icon: <Share2 size={16} aria-hidden="true" />, run: () => onAdd('access-rights')},
    {key: 'guest', title: 'Guest Access', text: 'Invite a visitor locally.', icon: <Ticket size={16} aria-hidden="true" />, run: () => onAdd('visitors')},
    {key: 'susp', title: 'Suspend Users', text: 'Open enabled users to suspend.', icon: <UserX size={16} aria-hidden="true" />, run: onSuspendUsers},
  ];
  const shownDoors = doorRows.slice(0, OV_ROWS);
  return <div className="wsc-ov">
    <section className="wsc-ov-card wsc-ov-span6" aria-labelledby="wsc-ov-place"><h3 id="wsc-ov-place">Place</h3>
      {place ? <><strong className="wsc-ov-big">{str(place.name) || 'Unnamed place'}</strong><p className="wsc-muted">{str(place.address) || 'No address'}</p></> : <p className="wsc-muted">No place record.</p>}
      <div className="wsc-ov-more"><span className="wsc-pill">{doors.length} door{doors.length === 1 ? '' : 's'}</span></div>
    </section>
    <section className="wsc-ov-card wsc-ov-span6" aria-labelledby="wsc-ov-status"><h3 id="wsc-ov-status">Status</h3>
      {ok ? <p className="wsc-ov-state is-ok"><Check size={16} aria-hidden="true" /> Your place is fully operational</p> : <div className="wsc-ov-state is-warn"><ShieldAlert size={16} aria-hidden="true" /> Attention needed
        <ul>{bad.map(h => <li key={h.id}>{str(h.name) || h.id}: {str(h.status) || 'Unknown'}</li>)}{localLockdown && <li>Place lockdown is ON (simulated)</li>}</ul></div>}
      <p className="wsc-muted">{hardware.some(h => str(h.provenance).toUpperCase() === 'LIVE') ? 'Live from Kisi: doors and devices refresh every minute.' : 'Captured reference, not live.'} Simulated lockdown: {localLockdown ? 'ON' : 'OFF'}.</p>
    </section>
    <section className="wsc-ov-span12" aria-labelledby="wsc-ov-quick-h"><h3 id="wsc-ov-quick-h" className="wsc-ov-h" style={{marginBottom: 8}}>Quick actions</h3>
      <div className="wsc-ov-quick">{quick.map(q => <button key={q.key} type="button" className="wsc-ov-action" onClick={q.run}>{q.icon}<strong>{q.title}</strong><span>{q.text}</span></button>)}</div>
    </section>
    <section className="wsc-ov-card wsc-ov-span6" aria-labelledby="wsc-ov-doors"><h3 id="wsc-ov-doors">Quick Access</h3>
      <div className="wsc-search" style={{flex: 'none'}}><Search size={15} aria-hidden="true" /><input className="wsc-input" type="search" aria-label="Search doors" placeholder="Search doors…" value={doorQ} onChange={e => setDoorQ(e.target.value)} /></div>
      {shownDoors.length === 0 ? <p className="wsc-muted">No doors found.</p> : <ul className="wsc-ov-list">{shownDoors.map(d => <li key={d.id}>
        <div><strong title={str(d.name) || d.id}>{str(d.name) || d.id}</strong><span className="wsc-muted">Floor: {str(d.floor) || '\u2013'}</span></div>
        <span className={'wsc-pill is-' + pillTone(str(d.status))}>{str(d.status) || 'Unknown'}</span>
        <button type="button" className="wsc-icon-btn" aria-label={'Simulate unlock: ' + (str(d.name) || d.id)} onClick={() => onSimulate(d)}><DoorOpen size={16} aria-hidden="true" />Simulate unlock</button>
      </li>)}</ul>}
      <div className="wsc-ov-more"><span>{shownDoors.length} of {doorRows.length} door{doorRows.length === 1 ? '' : 's'}</span>{onViewAll && <button type="button" className="wsc-link" style={{flex: 'none'}} aria-label="View all doors" onClick={() => onViewAll('doors')}>View all</button>}</div>
    </section>
    <section className="wsc-ov-card wsc-ov-span6" aria-labelledby="wsc-ov-hist"><h3 id="wsc-ov-hist">Unlock History</h3>
      {history.length === 0 ? <p className="wsc-muted">No events yet.</p> : <ul className="wsc-ov-list">{history.map(e => <li key={e.id}>
        <div><strong title={str(e.object) || undefined}>{str(e.object) || '\u2013'}</strong><span className="wsc-muted">{str(e.action) || '\u2013'}{str(e.user) ? ' by ' + str(e.user) : ''}</span></div>
        <span className="wsc-ov-time">{str(e.occurredAt) ? fmtTime(e.occurredAt) : str(e.sourceDisplay).slice(0, 60) || '\u2013'}</span>
      </li>)}</ul>}
      <div className="wsc-ov-more"><span>{history.length} most recent</span>{onViewAll && <button type="button" className="wsc-link" style={{flex: 'none'}} aria-label="View all access event history" onClick={() => onViewAll('events')}>View all</button>}</div>
    </section>
    <section className="wsc-ov-card wsc-ov-span12" aria-labelledby="wsc-ov-chart"><div className="wsc-ov-head"><h3 id="wsc-ov-chart">Unique users this week</h3>
      <div className="wsc-pager"><button type="button" className="wsc-icon-btn is-bordered" aria-label="Previous week" onClick={() => setWeek(w => w - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
        <span role="status">{dayLabel(days[0])} - {dayLabel(days[6])}</span>
        <button type="button" className="wsc-icon-btn is-bordered" aria-label="Next week" disabled={week >= 0} onClick={() => setWeek(w => Math.min(0, w + 1))}><ChevronRight size={16} aria-hidden="true" /></button></div></div>
      <div className="wsc-chart" role="img" aria-label={'Unique users per day: ' + days.map((d, i) => DAYS[i] + ' ' + counts[i]).join(', ')}>
        {days.map((d, i) => <div key={d} className="wsc-chart-col"><span className="wsc-chart-n">{counts[i]}</span><div className="wsc-chart-bar" style={{height: Math.round(counts[i] / max * 100) + '%'}} /><span className="wsc-chart-d">{DAYS[i]}</span></div>)}
      </div>
      <p className="wsc-muted">Counts distinct users in local simulated events with an allowed unlock, by Chicago day.</p>
    </section>
  </div>;
}

/* ---------------------------------------------------------------- Detail drawer */
const PERMS: [string, string][] = [['primaryDeviceRestriction', 'Primary device restriction'], ['geofenceRestriction', 'Geofence restriction'], ['readerProximityRestriction', 'Reader proximity restriction'], ['readerTapRestriction', 'Reader tap restriction'], ['timeRestriction', 'Time restriction'], ['appAccess', 'Allow app access'], ['policyReviewed', 'Local policy reviewed']];
const toMin = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim()); return m ? +m[1] * 60 + +m[2] : null; };

function ScheduleGrid({group, schedules}: {group: VRec; schedules: VRec[]}) {
  if (group.timeRestriction === false) return <p className="wsc-note">No time restriction — access permitted any time</p>;
  const mine = schedules.filter(s => str(s.group) === str(group.name));
  const on = mine.filter(s => s.enabled === true);
  const cell = (day: number, h: number) => on.some(s => splitList(s.weekdays).map(Number).includes(day + 1) && (() => { const a = toMin(str(s.startTime)), b = toMin(str(s.endTime)); return a !== null && b !== null && a < (h + 1) * 60 && b > h * 60; })());
  const zones = Array.from(new Set(on.map(s => str(s.timeZone) || str(group.timeZone)).filter(Boolean)));
  return <div style={{display: 'grid', gap: 8}}>
    {group.timeRestriction !== true && <p className="wsc-note">Time restriction is unknown for this group. Any local schedules are shown below.</p>}
    {on.length === 0 ? <p className="wsc-note">No enabled schedules for this group{mine.length ? ' (' + mine.length + ' disabled)' : ''}.</p> : <>
      <p className="wsc-muted">Time zone: {zones.join(', ') || 'unspecified'}. Shaded cells are permitted windows.</p>
      <div className="wsc-scroll" tabIndex={0} role="region" aria-label="Weekly schedule grid">
        <table className="wsc-grid"><thead><tr><th scope="col"><span className="wsc-sr">Day</span></th>{Array.from({length: 24}, (_, h) => <th key={h} scope="col">{h % 3 === 0 ? h : ''}<span className="wsc-sr">{h}:00</span></th>)}</tr></thead>
          <tbody>{DAYS.map((d, di) => <tr key={d}><th scope="row">{d}</th>{Array.from({length: 24}, (_, h) => { const x = cell(di, h); return <td key={h} className={x ? 'is-on' : ''} title={d + ' ' + pad(h) + ':00' + (x ? ' permitted' : '')}><span className="wsc-sr">{x ? 'Permitted' : 'Not permitted'}</span></td>; })}</tr>)}</tbody></table>
      </div>
      {on.some(s => str(s.exceptionDates)) && <p className="wsc-muted">Restricted dates: {on.map(s => str(s.exceptionDates)).filter(Boolean).join('; ')}</p>}
    </>}
  </div>;
}

function MiniTable({head, rows, empty}: {head: string[]; rows: ReactNode[][]; empty: string}) {
  if (rows.length === 0) return <p className="wsc-empty">{empty}</p>;
  return <div className="wsc-scroll" tabIndex={0} role="region" aria-label={head.join(', ')}><table className="wsc-table"><thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
}

export function RecordDrawer({kind, record, sections, canEdit, onClose, onEdit, onLocalAction}: {kind: 'users' | 'groups'; record: VRec; sections: VSection[]; canEdit: boolean; onClose: () => void; onEdit: () => void; onLocalAction?: (a: 'suspend-user' | 'resume-user') => void}) {
  const ref = useRef<HTMLElement>(null); const closeRef = useRef(onClose); const uid = useId();
  const tabs = kind === 'users' ? ['Access Rights', 'Credentials', 'Events', 'Teams'] : ['General', 'Doors', 'Teams', 'Users', 'Permissions', 'Schedules'];
  const [tab, setTab] = useState(tabs[0]); const [copied, setCopied] = useState('');
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelectorAll('[aria-modal="true"]');
      if (open[open.length - 1] !== ref.current) return; // a form or confirm dialog is on top
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); if (prev && document.contains(prev)) prev.focus(); };
  }, []);
  const trap = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)); const first = nodes[0], last = nodes[nodes.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = tabs.length; let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % n; else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = n - 1;
    if (j < 0) return; e.preventDefault(); setTab(tabs[j]); setTimeout(() => document.getElementById(uid + '-t' + j)?.focus(), 0);
  };
  const email = str(record.email), name = str(record.name), gname = name;
  const teams = recs(sections, 'teams');
  const copy = async () => { try { await navigator.clipboard.writeText(str(record.sourceGroupId)); setCopied('Copied'); } catch { setCopied('Copy failed'); } setTimeout(() => setCopied(''), 2500); };

  let body: ReactNode = null;
  if (kind === 'users') {
    const em = email.toLowerCase();
    const rights = recs(sections, 'access-rights').filter(r => str(r.user).toLowerCase() === em);
    const myTeams = teams.filter(t => splitList(t.members).some(m => m.toLowerCase() === em));
    if (tab === 'Access Rights') body = <div style={{display: 'grid', gap: 12}}>
      <MiniTable head={['Group', 'Role', 'Status', 'Valid from', 'Valid until']} rows={rights.map(r => [str(r.group), str(r.role), str(r.status), fmtTime(r.validFrom), fmtTime(r.validUntil)])} empty="No access rights for this user." />
      <h4 className="wsc-ov-h">Groups through teams</h4>
      <MiniTable head={['Team', 'Groups']} rows={myTeams.filter(t => splitList(t.groups).length).map(t => [str(t.name), splitList(t.groups).join(', ')])} empty="No team groups." /></div>;
    else if (tab === 'Credentials') body = <div style={{display: 'grid', gap: 12}}>
      <MiniTable head={['Credential', 'Model', 'Status']} rows={recs(sections, 'credentials').filter(r => str(r.user).toLowerCase() === em).map(r => [str(r.name), str(r.model), str(r.status)])} empty="No physical credentials for this user." />
      <p className="wsc-note">Digital credentials: none linked to this user.</p></div>;
    else if (tab === 'Events') body = <MiniTable head={['Object', 'Action', 'Time']} rows={recs(sections, 'events').filter(r => str(r.user).toLowerCase() === em).slice(0, 50).map(r => [str(r.object), str(r.action), str(r.occurredAt) ? fmtTime(r.occurredAt) : str(r.sourceDisplay)])} empty="No events for this user." />;
    else body = <MiniTable head={['Team', 'Groups', 'Valid until']} rows={myTeams.map(t => [str(t.name), splitList(t.groups).join(', ') || '-', fmtTime(t.validUntil)])} empty="This user is not in any team." />;
  } else {
    if (tab === 'General') body = <dl className="wsc-dl"><dt>Name</dt><dd>{name || '-'}</dd><dt>Description</dt><dd>{str(record.description) || '-'}</dd><dt>Scope</dt><dd>{str(record.scope) || '-'}</dd>
      <dt>Source group ID</dt><dd>{str(record.sourceGroupId) || '-'} {str(record.sourceGroupId) && <button type="button" className="wsc-icon-btn" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />Copy ID</button>} <span role="status" className="wsc-muted">{copied}</span></dd></dl>;
    else if (tab === 'Doors') body = <MiniTable head={['Door']} rows={splitList(record.doors).map(d => [d])} empty="No doors assigned to this group." />;
    else if (tab === 'Teams') body = <MiniTable head={['Team', 'Description']} rows={teams.filter(t => splitList(t.groups).includes(gname)).map(t => [str(t.name), str(t.description) || '-'])} empty="No teams use this group." />;
    else if (tab === 'Users') body = <MiniTable head={['User', 'Role', 'Status']} rows={recs(sections, 'access-rights').filter(r => str(r.group) === gname).map(r => [str(r.user), str(r.role), str(r.status)])} empty="No users have access through this group." />;
    else if (tab === 'Permissions') body = <ul className="wsc-switches">{PERMS.map(([k, l]) => { const v = record[k]; const known = v === true || v === false; return <li key={k}><input type="checkbox" role="switch" id={uid + k} checked={v === true} readOnly disabled aria-readonly="true" /><label htmlFor={uid + k}>{l}</label><span className="wsc-pill">{known ? (v ? 'On' : 'Off') : 'Unknown'}</span></li>; })}</ul>;
    else body = <ScheduleGrid group={record} schedules={recs(sections, 'schedules')} />;
  }
  const status = str(record.status);
  return <div className="adm-overlay wsc-overlay is-drawer"><section ref={ref} className="wsc-modal wsc-drawer" role="dialog" aria-modal="true" aria-labelledby={uid + '-h'} onKeyDown={trap}>
    <div className="wsc-drawer-head">
      <button type="button" data-autofocus className="adm-button adm-secondary" onClick={onClose}><ArrowLeft size={15} aria-hidden="true" />Back</button>
      <div className="wsc-drawer-title" style={{minWidth: 0}}><h2 id={uid + '-h'}>{name || record.id}</h2><p>{kind === 'users' ? email : str(record.description)}</p></div>
      {kind === 'users' && status && <span className={'wsc-pill is-' + pillTone(status)}>{status}</span>}
    </div>
    {canEdit ? <div className="wsc-drawer-actions">
      {kind === 'users' && onLocalAction && <><button type="button" className="adm-button adm-secondary" disabled={status === 'Suspended'} onClick={() => onLocalAction('suspend-user')}>Local suspend</button>
        <button type="button" className="adm-button adm-secondary" disabled={status !== 'Suspended'} onClick={() => onLocalAction('resume-user')}>Local resume</button></>}
      <button type="button" className="adm-button adm-secondary" onClick={onEdit}><Pencil size={15} aria-hidden="true" />Edit</button>
    </div> : <span />}
    <div className="wsc-utabs" role="tablist" aria-label={kind === 'users' ? 'User details' : 'Group details'}>
      {tabs.map((t, i) => <button key={t} id={uid + '-t' + i} type="button" role="tab" className="wsc-utab" aria-selected={tab === t} aria-controls={uid + '-p'} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} onKeyDown={e => onTabKey(e, i)}>{t}</button>)}
    </div>
    <div className="wsc-drawer-body" id={uid + '-p'} role="tabpanel" aria-labelledby={uid + '-t' + tabs.indexOf(tab)}>{body}</div>
    <div className="wsc-drawer-foot"><p className="wsc-check-note"><UsersIcon size={14} aria-hidden="true" /> Derived from local clone records only. No live changes.</p></div>
  </section></div>;
}
