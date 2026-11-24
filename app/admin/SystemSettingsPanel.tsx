'use client';
/**
 * System settings (super admins only). Manages Stripe keys, email sending, notification inboxes and
 * other backend configuration. Secrets are write-only: the server never sends them back, so fields
 * start empty and only show a masked preview of what is stored. Saving asks for the account password
 * again, the server verifies credentials with the provider, then restarts the API to apply them.
 */
import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent} from 'react';
import {AlertTriangle, CheckCircle2, Eye, EyeOff, Lock, RefreshCw, RotateCcw, Send, ShieldCheck} from 'lucide-react';
import {ApiError, request} from './api';
import {useToast} from './ui';
import './system-settings.css';

type Setting = {key: string; label: string; help: string; kind: string; min: number | null; max: number | null; secret: boolean; source: 'dashboard' | 'env' | 'unset'; envFallback: boolean; configured: boolean; value: string | null; updatedAt: string | null; updatedBy: string | null};
type Group = {id: string; label: string; description: string; settings: Setting[]};
type Overview = {enabled: boolean; reason?: string; warning?: string | null; restartManaged: boolean; groups: Group[]; locked: Array<{key: string; configured: boolean}>};
type Draft = Record<string, string | null>;

const TESTS: Record<string, {target: 'smtp' | 'stripe' | 'kisi' | 'r2'; label: string}> = {payments: {target: 'stripe', label: 'Check Stripe connection'}, email: {target: 'smtp', label: 'Send me a test email'}, access: {target: 'kisi', label: 'Check Kisi key'}, storage: {target: 'r2', label: 'Check R2 bucket'}};
const SOURCE: Record<Setting['source'], string> = {dashboard: 'Set here', env: 'From server file', unset: 'Not set'};
const msg = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong.';
const when = (v: string | null) => v ? new Date(v).toLocaleString(undefined, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}) : '';

export default function SystemSettingsPanel({onUnauthorized}: {onUnauthorized: () => void}) {
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [testing, setTesting] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await request<Overview>('/admin/system-settings')); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onUnauthorized(); else setError(msg(e)); }
    finally { setLoading(false); }
  }, [onUnauthorized]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (confirming) passwordRef.current?.focus(); }, [confirming]);

  const byKey = useMemo(() => new Map((data?.groups || []).flatMap(g => g.settings).map(s => [s.key, s])), [data]);
  const changed = Object.keys(draft);
  const set = (key: string, value: string | null) => setDraft(d => { const next = {...d}; if (value === '' ) delete next[key]; else next[key] = value; return next; });
  const discard = () => { setDraft({}); setReveal({}); setSaveError(''); };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setSaving(true); setSaveError('');
    try {
      const result = await request<{saved: string[]; checks: string[]; restarting: boolean; message: string}>('/admin/system-settings', {method: 'PUT', body: JSON.stringify({changes: draft, currentPassword: password})});
      setPassword(''); setConfirming(false); setDraft({}); setReveal({});
      toast.push({tone: 'success', text: result.message + (result.checks.length ? ' Verified: ' + result.checks.join(' · ') : ''), ms: 9000});
      if (result.restarting) await waitForApi();
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { onUnauthorized(); return; }
      setSaveError(msg(e)); setPassword('');
    } finally { setSaving(false); }
  }
  async function waitForApi() {
    await new Promise(r => setTimeout(r, 4000));
    for (let i = 0; i < 20; i++) {
      try { await request('/admin/system-settings'); return; } catch (e) { if (e instanceof ApiError && e.status === 401) return; }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  async function runTest(target: string) {
    setTesting(target);
    try { const r = await request<{message: string}>('/admin/system-settings/test', {method: 'POST', body: JSON.stringify({target})}); toast.push({tone: 'success', text: r.message}); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onUnauthorized(); else toast.push({tone: 'error', text: msg(e)}); }
    finally { setTesting(''); }
  }

  if (loading && !data) return <section className="sys-panel" aria-busy="true"><div className="adm-empty" role="status"><RefreshCw className="adm-spin" size={22}/><strong>Loading system settings…</strong></div></section>;
  if (error) return <section className="sys-panel"><div className="sys-alert sys-bad" role="alert"><AlertTriangle size={18}/><div><strong>System settings are unavailable</strong><p>{error}</p></div></div><button className="adm-button adm-secondary" onClick={() => void load()}><RefreshCw size={16}/>Try again</button></section>;
  if (!data) return null;

  return <section className="sys-panel" aria-labelledby="sys-title">
    <header className="sys-head">
      <div><h2 id="sys-title"><ShieldCheck size={22}/>System settings</h2><p>Keys and addresses the website uses behind the scenes. Values you save here are encrypted and override the server file. Secrets are never shown again after saving.</p></div>
      <button className="adm-button adm-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'adm-spin' : ''}/>Refresh</button>
    </header>
    {!data.enabled && <div className="sys-alert sys-bad" role="alert"><Lock size={18}/><div><strong>Read-only</strong><p>{data.reason}</p></div></div>}
    {data.warning && <div className="sys-alert sys-warn" role="alert"><AlertTriangle size={18}/><div><strong>Attention</strong><p>{data.warning}</p></div></div>}

    {data.groups.map(group => <article key={group.id} className="sys-group" aria-labelledby={'sys-g-' + group.id}>
      <div className="sys-group-head"><div><h3 id={'sys-g-' + group.id}>{group.label}</h3><p>{group.description}</p></div>
        {TESTS[group.id] && <button type="button" className="adm-button adm-secondary" disabled={!!testing || changed.length > 0} title={changed.length ? 'Save or discard changes first' : undefined} onClick={() => void runTest(TESTS[group.id].target)}>{testing === TESTS[group.id].target ? <RefreshCw size={16} className="adm-spin"/> : <Send size={16}/>}{TESTS[group.id].label}</button>}
      </div>
      <div className="sys-rows">{group.settings.map(s => {
        const pending = s.key in draft, cleared = pending && draft[s.key] === null, id = 'sys-' + s.key;
        return <div key={s.key} className={'sys-row' + (pending ? ' is-pending' : '')}>
          <div className="sys-meta">
            <label htmlFor={id}>{s.label}</label>
            <span className={'sys-source sys-' + s.source}>{SOURCE[s.source]}</span>
            <small>{s.help}</small>
            <small className="sys-current">{s.configured ? <>Current: <code>{s.value}</code></> : 'No value yet'}{s.updatedAt && <> · changed {when(s.updatedAt)} by {s.updatedBy}</>}</small>
          </div>
          <div className="sys-input">
            {cleared ? <p className="sys-cleared">Will be removed from the dashboard{s.envFallback ? ' (the server file value applies again).' : '.'}</p>
              : s.kind === 'bool' || s.kind === 'onoff' ? <select id={id} value={pending ? String(draft[s.key]) : ''} onChange={e => set(s.key, e.target.value)} disabled={!data.enabled}>
                  <option value="">Keep current</option>{(s.kind === 'bool' ? ['true', 'false'] : ['on', 'off']).map(v => <option key={v} value={v}>{s.kind === 'bool' ? (v === 'true' ? 'On' : 'Off') : v === 'on' ? 'On' : 'Off'}</option>)}
                </select>
              : <div className="sys-field">
                  <input id={id} type={s.secret && !reveal[s.key] ? 'password' : s.kind === 'int' ? 'number' : s.kind === 'email' ? 'email' : 'text'} min={s.min ?? undefined} max={s.max ?? undefined}
                    autoComplete={s.secret ? 'new-password' : 'off'} spellCheck={false} autoCapitalize="off" disabled={!data.enabled}
                    placeholder={s.secret ? (s.configured ? 'Enter a new value to replace' : 'Paste value') : s.configured ? 'Enter a new value to change' : 'Enter value'}
                    value={pending ? String(draft[s.key] ?? '') : ''} onChange={e => set(s.key, e.target.value)}/>
                  {s.secret && <button type="button" className="adm-icon" aria-label={(reveal[s.key] ? 'Hide ' : 'Show ') + s.label} onClick={() => setReveal(r => ({...r, [s.key]: !r[s.key]}))}>{reveal[s.key] ? <EyeOff size={16}/> : <Eye size={16}/>}</button>}
                </div>}
            {s.source === 'dashboard' && !cleared && data.enabled && <button type="button" className="sys-link" onClick={() => set(s.key, null)}><RotateCcw size={14}/>Remove dashboard value</button>}
            {pending && <button type="button" className="sys-link" onClick={() => setDraft(d => { const n = {...d}; delete n[s.key]; return n; })}>Undo</button>}
          </div>
        </div>;
      })}</div>
    </article>)}

    <article className="sys-group"><div className="sys-group-head"><div><h3>Server-only settings</h3><p>These can only be changed on the server itself, so a dashboard account can never change the database, sign-in secrets, the encryption key or who is a super admin.</p></div></div>
      <ul className="sys-locked">{data.locked.map(l => <li key={l.key}><Lock size={14}/><code>{l.key}</code><span className={l.configured ? 'sys-ok' : 'sys-muted'}>{l.configured ? 'Set' : 'Not set'}</span></li>)}</ul>
    </article>

    {changed.length > 0 && <div className="sys-savebar" role="region" aria-label="Unsaved changes">
      <span><strong>{changed.length}</strong> unsaved change{changed.length === 1 ? '' : 's'}</span>
      <div><button className="adm-button adm-secondary" onClick={discard}>Discard</button><button className="adm-button adm-primary" onClick={() => { setSaveError(''); setConfirming(true); }}>Review and save</button></div>
    </div>}

    {confirming && <div className="adm-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) { setConfirming(false); setPassword(''); } }}>
      <form className="adm-confirm sys-confirm" role="alertdialog" aria-modal="true" aria-labelledby="sys-confirm-title" onSubmit={save}>
        <span className="adm-delete-icon sys-shield"><ShieldCheck size={24}/></span>
        <h2 id="sys-confirm-title">Confirm with your password</h2>
        <p>These settings will be checked with each provider, encrypted and applied{data.restartManaged ? '. The API restarts for about 10 seconds; checkout is briefly unavailable.' : '. Restart the API afterwards.'} All super admins get an email about this change.</p>
        <ul className="sys-change-list">{changed.map(k => <li key={k}>{draft[k] === null ? <RotateCcw size={14}/> : <CheckCircle2 size={14}/>}{byKey.get(k)?.label || k}{draft[k] === null ? ' (remove)' : ''}</li>)}</ul>
        {changed.some(k => k.startsWith('STRIPE_')) && <p className="sys-note"><AlertTriangle size={14}/>Changing Stripe keys switches where payments go. Make sure the webhook secret matches the same Stripe account and mode.</p>}
        <label className="adm-field"><span>Your password</span><input ref={passwordRef} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required/></label>
        {saveError && <p className="sys-error" role="alert">{saveError}</p>}
        <div className="adm-actions"><button type="button" className="adm-button adm-secondary" disabled={saving} onClick={() => { setConfirming(false); setPassword(''); }}>Cancel</button><button className="adm-button adm-primary" disabled={saving || !password}>{saving ? <><RefreshCw size={16} className="adm-spin"/>Verifying…</> : 'Save settings'}</button></div>
      </form>
    </div>}
  </section>;
}
