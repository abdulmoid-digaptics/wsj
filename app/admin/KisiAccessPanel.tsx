'use client';
/**
 * Door access (Kisi): configuration health, package-to-door-group mapping, and per-member access status.
 * Admin only. Sync, offboard and resume change real door access, so each one asks for confirmation first.
 */
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {AlertTriangle, CheckCircle2, KeyRound, RefreshCw, Search, ShieldOff, UserCheck} from 'lucide-react';
import {ApiError, request} from './api';
import {useToast} from './ui';
import './kisi-access.css';

type Group = {id: number | string; name: string};
type Plan = {id: string | number; name: string; enabled: boolean; groupId: string | null};
type Grant = {id: string | number; sourceKey: string; groupId: string | number; validFrom: string; validUntil: string; status: string; error: string | null};
type Member = {id: string | number; customerId: string | number; name: string; email: string; kisiUserId: string | null; blocked: boolean; status: string; error: string | null; grants: Grant[]};
type Overview = {configured: boolean; enabled: boolean; liveWritesAllowed?: boolean; error?: string; groups: Group[]; plans: Plan[]; members: Member[]};
type Confirm = {kind: 'sync'} | {kind: 'offboard'; member: Member} | {kind: 'resume'; member: Member};

const when = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('en-US', {timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}); };
const tone = (s: string) => { const k = s.toLowerCase(); return /fail|error|dead/.test(k) ? 'bad' : /block|revok|remov|offboard|expired|inactive/.test(k) ? 'warn' : /active|granted|synced|ok|ready/.test(k) ? 'good' : 'neutral'; };
const label = (s: string) => s.replace(/[_-]+/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const msg = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong.';

export default function KisiAccessPanel({onUnauthorized}: {onUnauthorized: () => void}) {
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [drafts, setDrafts] = useState<Record<string, {enabled: boolean; groupId: string}>>({});
  const [savingPlan, setSavingPlan] = useState('');
  const [planError, setPlanError] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const seq = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(async (term: string) => {
    const id = ++seq.current;
    setLoading(true); setError('');
    try {
      const res = await request<Overview>('/admin/kisi' + (term ? '?search=' + encodeURIComponent(term) : ''));
      if (id !== seq.current) return;
      setData({...res, groups: res.groups || [], plans: res.plans || [], members: res.members || []});
      setDrafts({});
    } catch (e) {
      if (id !== seq.current) return;
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      setError(msg(e));
    } finally { if (id === seq.current) setLoading(false); }
  }, [onUnauthorized]);

  useEffect(() => { const t = setTimeout(() => void load(''), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => cancelRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !acting) closeConfirm(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [confirm, acting]);

  const closeConfirm = () => { setConfirm(null); setActionError(''); opener.current?.focus(); };
  const ask = (c: Confirm, e: React.MouseEvent<HTMLElement>) => { opener.current = e.currentTarget; setActionError(''); setConfirm(c); };
  const submitSearch = (e: FormEvent) => { e.preventDefault(); const t = search.trim(); setApplied(t); void load(t); };

  const draftOf = (p: Plan) => drafts[String(p.id)] ?? {enabled: p.enabled, groupId: p.groupId ?? ''};
  const setDraft = (p: Plan, patch: Partial<{enabled: boolean; groupId: string}>) => setDrafts(d => ({...d, [String(p.id)]: {...draftOf(p), ...patch}}));
  const savePlan = async (e: FormEvent, p: Plan) => {
    e.preventDefault();
    const d = draftOf(p);
    if (d.enabled && !d.groupId) { setPlanError(x => ({...x, [String(p.id)]: 'Choose a door group before turning access on.'})); return; }
    setSavingPlan(String(p.id)); setPlanError(x => ({...x, [String(p.id)]: ''}));
    try {
      await request('/admin/kisi/plans/' + encodeURIComponent(String(p.id)), {method: 'PATCH', body: JSON.stringify({enabled: d.enabled, ...(d.groupId ? {groupId: d.groupId} : {})})});
      toast.push({text: 'Saved door access for ' + p.name + '. Members are updated on the next sync.'});
      await load(applied);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      setPlanError(x => ({...x, [String(p.id)]: msg(err)}));
    } finally { setSavingPlan(''); }
  };

  const run = async () => {
    if (!confirm) return;
    setActing(true); setActionError('');
    try {
      if (confirm.kind === 'sync') await request('/admin/kisi/sync', {method: 'POST', body: JSON.stringify({})});
      else await request('/admin/kisi/members/' + encodeURIComponent(String(confirm.member.customerId)) + '/' + confirm.kind, {method: 'POST', body: JSON.stringify({})});
      toast.push({text: confirm.kind === 'sync' ? 'Sync finished.' : confirm.kind === 'offboard' ? confirm.member.name + ' was offboarded.' : 'Access resumed for ' + confirm.member.name + '.'});
      setConfirm(null);
      opener.current?.focus();
      await load(applied);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      setActionError(msg(err));
    } finally { setActing(false); }
  };

  const copy = confirm?.kind === 'sync'
    ? {title: 'Sync door access now?', body: 'This compares paid, eligible members with Kisi and then grants or revokes door access to match. Changes reach the real door system straight away and can lock people out or let them in.', go: 'Sync door access'}
    : confirm?.kind === 'offboard'
      ? {title: 'Offboard ' + confirm.member.name + '?', body: 'This removes every Kisi door assignment for this member and blocks automatic syncing, so access will not come back by itself. This takes effect at the doors immediately.', go: 'Remove all access'}
      : confirm?.kind === 'resume'
        ? {title: 'Resume access for ' + confirm.member.name + '?', body: 'This unblocks automatic syncing and runs a sync for this member. No new manual access is given: they only get a door pass again if they have a paid, eligible package.', go: 'Unblock and sync'}
        : null;

  const dim = loading && !!data;
  return (
    <section className="kisi" aria-labelledby="kisi-title" aria-busy={loading}>
      <header className="kisi-head">
        <div><h2 id="kisi-title" className="kisi-title"><KeyRound size={20} aria-hidden="true" />Door access</h2><p>Decide which packages open which doors, and see every member&apos;s current Kisi access.</p></div>
        <div className="kisi-head-actions">
          <button type="button" className="adm-button adm-secondary" disabled={loading} onClick={() => void load(applied)}><RefreshCw size={16} className={loading ? 'adm-spin' : ''} />Refresh</button>
          <button type="button" className="adm-button adm-primary" disabled={!data?.configured || !data.enabled || !data.liveWritesAllowed || loading} onClick={e => ask({kind: 'sync'}, e)}>Retry sync</button>
        </div>
      </header>

      {error && <div className="adm-alert" role="alert">{error}<button type="button" className="adm-text-button" onClick={() => void load(applied)}>Try again</button></div>}
      {loading && !data && !error && <div className="kisi-card kisi-state" role="status"><RefreshCw className="adm-spin" size={22} /><strong>Loading door access…</strong></div>}

      {data && <>
        <div className="kisi-card kisi-health" role="group" aria-label="Kisi connection status">
          <span className={'kisi-pill is-' + (data.configured ? 'good' : 'bad')}>{data.configured ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}{data.configured ? 'Server key present' : 'No server key'}</span>
          <span className={'kisi-pill is-' + (data.enabled ? 'good' : 'warn')}>{data.enabled ? 'Automatic sync on' : 'Automatic sync off'}</span>
          <span className="kisi-muted">{data.groups.length} door group{data.groups.length === 1 ? '' : 's'} found</span>
          {!data.configured && <p className="kisi-note" role="status">The server has no Kisi key, so nothing can be granted or revoked. Set KISI_API_KEY in the backend environment. The key is never shown here.</p>}
          {!data.liveWritesAllowed && <p className="kisi-note" role="status">Live Kisi is locked read-only. Use Workspace operations for isolated clone changes. No real door access will be changed.</p>}
          {!data.enabled && <p className="kisi-note">Automatic synchronization is disabled.</p>}
          {data.error && <p className="kisi-note is-error" role="alert">{data.error}</p>}
        </div>

        <div className="kisi-card">
          <h3 className="kisi-sub">Packages and doors</h3>
          <p className="kisi-muted">Turn door access on for a package and pick the Kisi group its members can open.</p>
          {data.plans.length === 0 ? <p className="kisi-muted">No packages found.</p> : <ul className="kisi-plans">
            {data.plans.map(p => {
              const d = draftOf(p); const sid = String(p.id); const dirty = d.enabled !== p.enabled || d.groupId !== (p.groupId ?? '');
              return <li key={sid}><form onSubmit={e => void savePlan(e, p)} aria-label={'Door access for ' + p.name}>
                <strong className="kisi-plan-name">{p.name}</strong>
                <label className="kisi-check"><input type="checkbox" checked={d.enabled} onChange={e => setDraft(p, {enabled: e.target.checked})} /><span>Door access on</span></label>
                <label className="kisi-field"><span>Door group</span>
                  <select value={d.groupId} onChange={e => setDraft(p, {groupId: e.target.value})} aria-label={'Door group for ' + p.name}>
                    <option value="">No group</option>
                    {data.groups.map(g => <option key={String(g.id)} value={String(g.id)}>{g.name}</option>)}
                    {d.groupId && !data.groups.some(g => String(g.id) === d.groupId) && <option value={d.groupId}>Unknown group ({d.groupId})</option>}
                  </select></label>
                <button type="submit" className="adm-button adm-secondary" disabled={!dirty || savingPlan === sid}>{savingPlan === sid ? 'Saving…' : 'Save'}</button>
                {planError[sid] && <p className="kisi-note is-error" role="alert">{planError[sid]}</p>}
              </form></li>;
            })}
          </ul>}
        </div>

        <div className="kisi-card" aria-busy={dim}>
          <div className="kisi-members-head">
            <div><h3 className="kisi-sub">Members</h3><p className="kisi-muted">Access times are shown in Chicago time. Door offboarding does not cancel billing.</p></div>
            <form className="kisi-search" role="search" onSubmit={submitSearch}>
              <Search size={16} aria-hidden="true" />
              <input type="search" aria-label="Search members by name or email" placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} />
              <button type="submit" className="adm-button adm-secondary" disabled={loading}>Search</button>
            </form>
          </div>
          {data.members.length === 0 ? <p className="kisi-empty">{applied ? 'No members match “' + applied + '”.' : 'No members with door access yet.'}</p> : <ul className={'kisi-members' + (dim ? ' is-dim' : '')}>
            {data.members.map(m => <li key={String(m.customerId)} className="kisi-member">
              <div className="kisi-member-top">
                <div className="kisi-who"><strong>{m.name || m.email}</strong><small>{m.email}</small></div>
                <span className={'kisi-pill is-' + (/fail/i.test(m.status) ? 'bad' : m.blocked ? 'warn' : tone(m.status))}>{/fail/i.test(m.status) ? label(m.status) : m.blocked ? 'Blocked' : label(m.status)}</span>
                <div className="kisi-member-actions">
                  {m.blocked && m.status === 'REVOKE_FAILED' && <button type="button" className="adm-button adm-secondary kisi-danger" disabled={!data.liveWritesAllowed} onClick={e => ask({kind: 'offboard', member: m}, e)}>Retry offboarding</button>}
                  {m.blocked
                    ? <button type="button" className="adm-button adm-secondary" disabled={!data.liveWritesAllowed} onClick={e => ask({kind: 'resume', member: m}, e)} aria-label={'Resume access for ' + m.name}><UserCheck size={15} />Resume</button>
                    : <button type="button" className="adm-button adm-secondary kisi-danger" disabled={!data.liveWritesAllowed} onClick={e => ask({kind: 'offboard', member: m}, e)} aria-label={'Offboard ' + m.name}><ShieldOff size={15} />Offboard</button>}
                </div>
              </div>
              {m.error && <p className="kisi-note is-error">{m.error}</p>}
              {!m.kisiUserId && <p className="kisi-muted">Not linked to a Kisi user yet.</p>}
              {m.grants.length > 0 ? <div className="kisi-grants" role="region" tabIndex={0} aria-label={'Door grants for ' + m.name}><table>
                <thead><tr><th scope="col">Door group</th><th scope="col">From</th><th scope="col">Until</th><th scope="col">Status</th></tr></thead>
                <tbody>{m.grants.map(g => <tr key={String(g.id)}>
                  <td data-label="Door group">{data.groups.find(x => String(x.id) === String(g.groupId))?.name || 'Group ' + g.groupId}</td>
                  <td data-label="From">{when(g.validFrom)}</td><td data-label="Until">{when(g.validUntil)}</td>
                  <td data-label="Status"><span className={'kisi-pill is-' + tone(g.status)}>{label(g.status)}</span>{g.error && <small className="kisi-grant-err">{g.error}</small>}</td>
                </tr>)}</tbody></table></div> : <p className="kisi-muted">No door grants.</p>}
            </li>)}
          </ul>}
        </div>
      </>}

      {confirm && copy && <div className="adm-overlay"><section className="adm-confirm kisi-confirm" role="alertdialog" aria-modal="true" aria-labelledby="kisi-confirm-title" aria-describedby="kisi-confirm-body" onKeyDown={e => {if (e.key !== 'Tab') return; const nodes = e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'); const first = nodes[0], last = nodes[nodes.length - 1]; if (!first) {e.preventDefault(); return;} if (e.shiftKey && document.activeElement === first) {e.preventDefault(); last.focus();} else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first.focus();}}}>
        <span className="adm-delete-icon" aria-hidden="true"><AlertTriangle size={24} /></span>
        <h2 id="kisi-confirm-title">{copy.title}</h2>
        <p id="kisi-confirm-body">{copy.body}</p>
        {actionError && <div className="adm-alert" role="alert">{actionError}</div>}
        <div className="adm-actions">
          <button ref={cancelRef} type="button" className="adm-button adm-secondary" disabled={acting} onClick={closeConfirm}>Cancel</button>
          <button type="button" className={'adm-button ' + (confirm.kind === 'resume' || confirm.kind === 'sync' ? 'adm-primary' : 'adm-delete')} disabled={acting} onClick={() => void run()}>{acting ? 'Working…' : copy.go}</button>
        </div>
      </section></div>}
    </section>
  );
}
