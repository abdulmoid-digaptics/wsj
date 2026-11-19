'use client';
/**
 * Booking day rules: lock services on days another service is booked, and close days by hand.
 * Every check runs on the server at checkout under a per-day lock; this screen only edits settings.
 */
import {useCallback, useEffect, useState} from 'react';
import {CalendarX, Plus, RefreshCw, Search, Trash2, X} from 'lucide-react';
import {ApiError, request} from './api';

type Service = {slug: string; name: string; minBookingHours: number | null; active: boolean};
type Rule = {id: string; name: string; enabled: boolean; triggerServices: string[]; blockedServices: string[]; reverse: boolean; countUnpaid: boolean; weekdays: number[]; activeFrom: string | null; activeUntil: string | null; note: string | null; version: number};
type Closure = {id: string; date: string; services: string[]; reason: string | null};
type Draft = Omit<Rule, 'id' | 'version'> & {id?: string; version?: number};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY: Draft = {name: '', enabled: true, triggerServices: [], blockedServices: [], reverse: false, countUnpaid: true, weekdays: [], activeFrom: null, activeUntil: null, note: null};
const today = () => new Date().toISOString().slice(0, 10);
const prettyDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});

function ServicePicker({services, value, onChange, disabled = []}: {services: Service[]; value: string[]; onChange: (v: string[]) => void; disabled?: string[]}) {
  return (
    <div className="dayb-pills">
      {services.map(s => {
        const on = value.includes(s.slug);
        const off = disabled.includes(s.slug);
        return (
          <button type="button" key={s.slug} disabled={off} className={'dayb-pill' + (on ? ' is-on' : '')} aria-pressed={on} title={off ? 'Already chosen on the other side of this rule' : undefined} onClick={() => onChange(on ? value.filter(v => v !== s.slug) : [...value, s.slug])}>
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

export default function DayBlocksManager({canWrite, onUnauthorized}: {canWrite: boolean; onUnauthorized: () => void}) {
  const [services, setServices] = useState<Service[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [closeForm, setCloseForm] = useState({date: '', until: '', services: [] as string[], reason: ''});
  const [check, setCheck] = useState({service: '', date: ''});
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) onUnauthorized();
    setError(e instanceof Error ? e.message : 'Something went wrong.');
  }, [onUnauthorized]);

  const load = useCallback(async () => {
    try {
      const data = await request<{services: Service[]; rules: Rule[]; closures: Closure[]}>('/admin/day-blocks');
      setServices(data.services);
      setRules(data.rules);
      setClosures(data.closures);
      setError('');
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [fail]);
  useEffect(() => {
    let live = true;
    request<{services: Service[]; rules: Rule[]; closures: Closure[]}>('/admin/day-blocks')
      .then(data => {if (!live) return; setServices(data.services); setRules(data.rules); setClosures(data.closures);})
      .catch(e => live && fail(e))
      .finally(() => live && setLoading(false));
    return () => {live = false;};
  }, [fail]);

  const name = (slug: string) => services.find(s => s.slug === slug)?.name ?? slug;
  const list = (slugs: string[]) => (slugs.length ? slugs.map(name).join(', ') : 'every service');

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNotice('');
    try {
      await work();
      setNotice(done);
      setError('');
      await load();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const {id, version, ...body} = editing;
    const ok = await run(() => request('/admin/day-blocks/rules' + (id ? '/' + id : ''), {method: id ? 'PUT' : 'POST', body: JSON.stringify(id ? {...body, expectedVersion: version} : body)}), id ? 'Rule saved.' : 'Rule created.');
    if (ok) setEditing(null);
  }

  const toggle = (rule: Rule) => run(() => request('/admin/day-blocks/rules/' + rule.id, {method: 'PUT', body: JSON.stringify({name: rule.name, enabled: !rule.enabled, triggerServices: rule.triggerServices, blockedServices: rule.blockedServices, reverse: rule.reverse, countUnpaid: rule.countUnpaid, weekdays: rule.weekdays, activeFrom: rule.activeFrom, activeUntil: rule.activeUntil, note: rule.note, expectedVersion: rule.version})}), rule.enabled ? 'Rule turned off.' : 'Rule turned on. It applies to new bookings from now.');

  async function runCheck(event: React.FormEvent) {
    event.preventDefault();
    if (!check.service || !check.date) return;
    try {
      const data = await request<{conflicts: Array<{reason: string}>}>('/admin/day-blocks/check?service=' + encodeURIComponent(check.service) + '&date=' + check.date);
      setCheckResult(data.conflicts.length ? data.conflicts[0].reason : name(check.service) + ' can be booked on ' + prettyDate(check.date) + '.');
    } catch (e) {
      fail(e);
    }
  }

  return (
    <section className="adm-table-card dayb" aria-busy={loading}>
      <div className="dayb-head">
        <p className="dayb-intro">Rules stop new bookings only; existing bookings are never cancelled. Dates use Chicago (venue) time.</p>
        <div className="dayb-actions">
          <button className="adm-button" onClick={() => {setLoading(true); void load();}} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          {canWrite && <button className="adm-button adm-primary" onClick={() => setEditing({...EMPTY})}><Plus size={15} /> New rule</button>}
        </div>
      </div>
      {error && <p className="adm-error" role="alert">{error}</p>}
      {notice && <p className="adm-success" role="status">{notice}</p>}

      <h3 className="dayb-title">Same-day rules</h3>
      {!loading && !rules.length && <p className="adm-help">No rules yet.</p>}
      <div className="dayb-list">
        {rules.map(rule => (
          <article key={rule.id} className={'dayb-rule' + (rule.enabled ? ' is-on' : '')}>
            <div className="dayb-rule-main">
              <strong>{rule.name}</strong>
              <p>When <b>{list(rule.triggerServices)}</b> {rule.triggerServices.length > 1 ? 'are' : 'is'} booked, block <b>{list(rule.blockedServices)}</b> for the rest of that day.{rule.reverse ? ' Also works the other way round.' : ''}</p>
              <small>
                {rule.weekdays.length ? 'Only on ' + rule.weekdays.map(d => WEEKDAYS[d]).join(', ') + '. ' : ''}
                {rule.activeFrom || rule.activeUntil ? 'From ' + (rule.activeFrom ? prettyDate(rule.activeFrom) : 'now') + ' to ' + (rule.activeUntil ? prettyDate(rule.activeUntil) : 'no end date') + '. ' : ''}
                {rule.countUnpaid ? 'Unpaid checkouts in progress also hold the day.' : 'Only paid bookings count.'}
              </small>
            </div>
            <div className="dayb-rule-side">
              <span className={'adm-badge ' + (rule.enabled ? 'adm-badge-green' : '')}>{rule.enabled ? 'On' : 'Off'}</span>
              {canWrite && <>
                <button className="adm-button" disabled={busy} onClick={() => void toggle(rule)}>{rule.enabled ? 'Turn off' : 'Turn on'}</button>
                <button className="adm-button" disabled={busy} onClick={() => setEditing({...rule})}>Edit</button>
                <button className="adm-icon" aria-label={'Delete ' + rule.name} disabled={busy} onClick={() => window.confirm('Delete this rule?') && void run(() => request('/admin/day-blocks/rules/' + rule.id, {method: 'DELETE'}), 'Rule deleted.')}><Trash2 size={16} /></button>
              </>}
            </div>
          </article>
        ))}
      </div>

      <h3 className="dayb-title">Closed days</h3>
      {canWrite && (
        <form className="dayb-close" onSubmit={e => {e.preventDefault(); void run(() => request('/admin/day-blocks/closures', {method: 'POST', body: JSON.stringify(closeForm)}), 'Day closed.').then(ok => ok && setCloseForm({date: '', until: '', services: [], reason: ''}));}}>
          <label className="adm-field"><span>From</span><input type="date" required min={today()} value={closeForm.date} onChange={e => setCloseForm({...closeForm, date: e.target.value})} /></label>
          <label className="adm-field"><span>Until (optional)</span><input type="date" min={closeForm.date || today()} value={closeForm.until} onChange={e => setCloseForm({...closeForm, until: e.target.value})} /></label>
          <label className="adm-field dayb-wide"><span>Reason (optional, shown to customers)</span><input maxLength={200} value={closeForm.reason} placeholder="Private event" onChange={e => setCloseForm({...closeForm, reason: e.target.value})} /></label>
          <div className="adm-span"><span className="dayb-label">Services to close (none selected = every service)</span><ServicePicker services={services} value={closeForm.services} onChange={v => setCloseForm({...closeForm, services: v})} /></div>
          <button className="adm-button adm-primary" disabled={busy || !closeForm.date}><CalendarX size={15} /> Close day</button>
        </form>
      )}
      <div className="dayb-list">
        {!loading && !closures.length && <p className="adm-help">No upcoming closed days.</p>}
        {closures.map(c => (
          <article key={c.id} className="dayb-rule">
            <div className="dayb-rule-main"><strong>{prettyDate(c.date)}</strong><p>Closed: {list(c.services)}{c.reason ? ' (' + c.reason + ')' : ''}</p></div>
            {canWrite && <div className="dayb-rule-side"><button className="adm-button" disabled={busy} onClick={() => void run(() => request('/admin/day-blocks/closures/' + c.id, {method: 'DELETE'}), 'Day reopened.')}>Reopen</button></div>}
          </article>
        ))}
      </div>

      <h3 className="dayb-title">Check a day</h3>
      <form className="dayb-close" onSubmit={runCheck}>
        <label className="adm-field"><span>Service</span><select required value={check.service} onChange={e => setCheck({...check, service: e.target.value})}><option value="">Choose…</option>{services.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label>
        <label className="adm-field"><span>Date</span><input type="date" required value={check.date} onChange={e => setCheck({...check, date: e.target.value})} /></label>
        <button className="adm-button"><Search size={15} /> Check</button>
      </form>
      {checkResult && <p className="adm-help dayb-result" role="status">{checkResult}</p>}

      {editing && (
        <div className="adm-overlay" onClick={e => {if (e.target === e.currentTarget && !busy) setEditing(null);}}>
          <section className="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="dayb-edit-title">
            <header className="adm-dialog-head">
              <div><span className="adm-eyebrow">BOOKING DAY RULE</span><h2 id="dayb-edit-title">{editing.id ? 'Edit rule' : 'New rule'}</h2></div>
              <button className="adm-icon" aria-label="Close" disabled={busy} onClick={() => setEditing(null)}><X size={20} /></button>
            </header>
            <form className="adm-edit-form" onSubmit={saveRule}>
              <div className="adm-form-grid">
                <label className="adm-field adm-span"><span>Rule name</span><input required maxLength={120} value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} /></label>
                <div className="adm-span"><span className="dayb-label">When any of these is booked…</span><ServicePicker services={services} value={editing.triggerServices} disabled={editing.blockedServices} onChange={v => setEditing({...editing, triggerServices: v})} /></div>
                <div className="adm-span"><span className="dayb-label">…nobody can book these on that day</span><ServicePicker services={services} value={editing.blockedServices} disabled={editing.triggerServices} onChange={v => setEditing({...editing, blockedServices: v})} /></div>
                <label className="adm-field adm-span dayb-check"><input type="checkbox" checked={editing.reverse} onChange={e => setEditing({...editing, reverse: e.target.checked})} /><span>Also the other way round: if a blocked service is already booked, the first group cannot be booked that day</span></label>
                <label className="adm-field adm-span dayb-check"><input type="checkbox" checked={editing.countUnpaid} onChange={e => setEditing({...editing, countUnpaid: e.target.checked})} /><span>Count checkouts still being paid (recommended: stops two people paying for conflicting services at once)</span></label>
                <div className="adm-span"><span className="dayb-label">Only on these weekdays (none = every day)</span>
                  <div className="dayb-pills">{WEEKDAYS.map((d, i) => {const on = editing.weekdays.includes(i); return <button type="button" key={d} className={'dayb-pill' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => setEditing({...editing, weekdays: on ? editing.weekdays.filter(x => x !== i) : [...editing.weekdays, i]})}>{d}</button>;})}</div>
                </div>
                <label className="adm-field"><span>Starts (optional)</span><input type="date" value={editing.activeFrom ?? ''} onChange={e => setEditing({...editing, activeFrom: e.target.value || null})} /></label>
                <label className="adm-field"><span>Ends (optional)</span><input type="date" value={editing.activeUntil ?? ''} min={editing.activeFrom ?? undefined} onChange={e => setEditing({...editing, activeUntil: e.target.value || null})} /></label>
                <label className="adm-field adm-span dayb-check"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({...editing, enabled: e.target.checked})} /><span>Rule is on</span></label>
                <label className="adm-field adm-span"><span>Internal note (optional)</span><textarea rows={2} maxLength={500} value={editing.note ?? ''} onChange={e => setEditing({...editing, note: e.target.value || null})} /></label>
              </div>
              <p className="adm-help">Existing bookings are never cancelled by a rule. It only stops new bookings.</p>
              <footer className="adm-dialog-foot">
                <button type="button" className="adm-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                <button className="adm-button adm-primary" disabled={busy || !editing.name.trim() || !editing.triggerServices.length || !editing.blockedServices.length}>{busy ? 'Saving…' : 'Save rule'}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
