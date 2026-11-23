'use client';
/**
 * Reusable admin data table.
 * - Debounced (300 ms) search; each new request aborts the previous one.
 * - Filters (status, service, date preset) and sort live in the URL, so a filtered view can be shared.
 * - Sortable headers, column show/hide and dense/comfortable rows (remembered per screen).
 * - Row selection with a floating bulk-action bar (resource actions + CSV export of the selection).
 * - Skeleton rows while loading, explained empty states, stacked cards on phones.
 */
import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Inbox, Rows3, Search, SearchX, X} from 'lucide-react';
import {ApiError, request} from './api';
import {EmptyState, SkeletonRows, useToast} from './ui';
import './admin-table.css';

export type Row = Record<string, unknown> & {id: string};
export type Column = {key: string; label: string; sort?: string; optional?: boolean; hiddenByDefault?: boolean; render: (r: Row) => ReactNode; csv?: (r: Row) => string};
export type BulkAction = {id: string; label: string; run: (ids: string[]) => Promise<string>; danger?: boolean};
type Listing = {items: Row[]; total: number};

const PRESETS = [['', 'Any time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month']] as const;
function presetRange(p: string): {from?: string; to?: string} {
  const now = new Date(), d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  if (p === 'today') return {from: d0.toISOString()};
  if (p === 'yesterday') { const y = new Date(d0.getTime() - 86400000); return {from: y.toISOString(), to: new Date(d0.getTime() - 1).toISOString()}; }
  if (p === '7d') return {from: new Date(now.getTime() - 7 * 86400000).toISOString()};
  if (p === '30d') return {from: new Date(now.getTime() - 30 * 86400000).toISOString()};
  if (p === 'month') return {from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString()};
  return {};
}
const readUrl = () => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search));

export function DataTable({resource, label, columns, statusOptions, serviceOptions, supportsQuery, bulkActions = [], reloadKey = 0, onOpen, renderActions, onUnauthorized, emptyAction}: {
  resource: string; label: string; columns: Column[]; statusOptions?: string[]; serviceOptions?: Array<{value: string; label: string}>;
  /** Backend accepts sort / from / to for this resource. */
  supportsQuery?: boolean; bulkActions?: BulkAction[]; reloadKey?: number;
  onOpen?: (r: Row) => void; renderActions?: (r: Row, reload: () => void) => ReactNode; onUnauthorized: () => void; emptyAction?: ReactNode;
}) {
  const toast = useToast();
  const initial = useMemo(() => { const u = readUrl(); return u.get('view') === resource ? u : new URLSearchParams(); }, [resource]);
  const [search, setSearch] = useState(initial.get('q') || '');
  const [debounced, setDebounced] = useState(search);
  const [status, setStatus] = useState(initial.get('status') || '');
  const [service, setService] = useState(initial.get('service') || '');
  const [preset, setPreset] = useState(initial.get('when') || '');
  const [sort, setSort] = useState(initial.get('sort') || '');
  const [dir, setDir] = useState<'asc' | 'desc'>(initial.get('dir') === 'asc' ? 'asc' : 'desc');
  const [page, setPage] = useState(Math.max(1, Number(initial.get('page')) || 1));
  const [data, setData] = useState<Listing>({items: [], total: 0});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => columns.filter(c => c.hiddenByDefault).map(c => c.key));
  const [dense, setDense] = useState(false);
  const [colMenu, setColMenu] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(t => t + 1), []);
  const LIMIT = 15;

  useEffect(() => { const t = setTimeout(() => { try { const h = localStorage.getItem('wsj-cols:' + resource); if (h) setHidden(JSON.parse(h)); setDense(localStorage.getItem('wsj-dense') === '1'); } catch { /* ignore */ } }, 0); return () => clearTimeout(t); }, [resource]);
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  /* Keep the URL in step so the exact view can be bookmarked or shared. */
  useEffect(() => {
    const u = new URLSearchParams({view: resource});
    if (debounced) u.set('q', debounced); if (status) u.set('status', status); if (service) u.set('service', service);
    if (preset) u.set('when', preset); if (sort) { u.set('sort', sort); u.set('dir', dir); } if (page > 1) u.set('page', String(page));
    window.history.replaceState(window.history.state, '', window.location.pathname + '?' + u.toString());
  }, [resource, debounced, status, service, preset, sort, dir, page]);

  const load = useCallback(async () => {
    abort.current?.abort();
    const ctl = new AbortController(); abort.current = ctl;
    setLoading(true); setError('');
    const q = new URLSearchParams({page: String(page), limit: String(LIMIT)});
    if (debounced.trim()) q.set('search', debounced.trim());
    if (status) q.set('status', status);
    if (service) q.set('serviceType', service);
    if (supportsQuery) { if (sort) { q.set('sort', sort); q.set('dir', dir); } const r = presetRange(preset); if (r.from) q.set('from', r.from); if (r.to) q.set('to', r.to); }
    try {
      const res = await request<Listing>('/admin/' + resource + '?' + q, {signal: ctl.signal});
      if (!ctl.signal.aborted) { setData({items: res.items || [], total: res.total || 0}); setSelected(s => s.filter(id => (res.items || []).some(r => r.id === id))); }
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      setData({items: [], total: 0}); setError(e instanceof Error ? e.message : 'Could not load.');
    } finally { if (!ctl.signal.aborted) setLoading(false); }
  }, [resource, page, debounced, status, service, preset, sort, dir, supportsQuery, onUnauthorized]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load, reloadKey, tick]);
  useEffect(() => () => abort.current?.abort(), []);

  const visible = columns.filter(c => !hidden.includes(c.key));
  const toggleCol = (k: string) => setHidden(h => { const next = h.includes(k) ? h.filter(x => x !== k) : [...h, k]; try { localStorage.setItem('wsj-cols:' + resource, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  const toggleDense = () => setDense(d => { try { localStorage.setItem('wsj-dense', d ? '0' : '1'); } catch { /* ignore */ } return !d; });
  const clickSort = (c: Column) => { if (!c.sort || !supportsQuery) return; if (sort === c.sort) setDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSort(c.sort); setDir(c.sort === 'name' || c.sort === 'title' ? 'asc' : 'desc'); } setPage(1); };
  const filtering = Boolean(debounced || status || service || preset);
  const allOnPage = data.items.length > 0 && data.items.every(r => selected.includes(r.id));

  function exportSelected() {
    const rows = data.items.filter(r => selected.includes(r.id));
    const cell = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? '"' + v.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : v);
    const cols = columns.filter(c => c.csv);
    const csv = '\uFEFF' + [cols.map(c => c.label).join(','), ...rows.map(r => cols.map(c => cell(c.csv!(r))).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
    const a = document.createElement('a'); a.href = url; a.download = resource.replace(/\W+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.push({tone: 'success', text: 'Exported ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + '.'});
  }
  async function runBulk(a: BulkAction) {
    if (a.danger && !window.confirm(a.label + ' ' + selected.length + ' item(s)?')) return;
    try { const msg = await a.run(selected); toast.push({tone: 'success', text: msg}); setSelected([]); reload(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onUnauthorized(); toast.push({tone: 'error', text: e instanceof Error ? e.message : 'Bulk action failed.'}); }
  }

  return (
    <section className={'adm-dt' + (dense ? ' is-dense' : '')} aria-label={label} aria-busy={loading}>
      <div className="adm-dt-toolbar">
        <label className="adm-dt-search"><Search size={17} aria-hidden="true" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder={'Search ' + label.toLowerCase() + '…'} aria-label={'Search ' + label} />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</label>
        {statusOptions && <select aria-label="Filter by status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{statusOptions.map(s => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</select>}
        {serviceOptions && <select aria-label="Filter by service" value={service} onChange={e => { setService(e.target.value); setPage(1); }}><option value="">All services</option>{serviceOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>}
        {supportsQuery && <select aria-label="Filter by date" value={preset} onChange={e => { setPreset(e.target.value); setPage(1); }}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
        <span className="adm-dt-count">{loading ? 'Loading…' : data.total + ' ' + (data.total === 1 ? 'record' : 'records')}</span>
        <div className="adm-dt-tools">
          <button type="button" className="adm-dt-tool" aria-pressed={dense} onClick={toggleDense} title={dense ? 'Comfortable rows' : 'Compact rows'}><Rows3 size={16} /><span>{dense ? 'Compact' : 'Comfortable'}</span></button>
          <div className="adm-dt-colwrap">
            <button type="button" className="adm-dt-tool" aria-expanded={colMenu} onClick={() => setColMenu(v => !v)}><Columns3 size={16} /><span>Columns</span></button>
            {colMenu && <div className="adm-dt-colmenu" role="menu">{columns.filter(c => c.optional).map(c => <label key={c.key}><input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleCol(c.key)} />{c.label}</label>)}</div>}
          </div>
        </div>
      </div>

      {error && <div className="adm-alert" role="alert">{error}<button className="adm-text-button" onClick={reload}>Try again</button></div>}

      <div className="adm-dt-scroll" tabIndex={0} role="region" aria-label={label + ' table'}>
        <table className="adm-dt-table">
          <thead><tr>
            <th className="adm-dt-check"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...data.items.map(r => r.id)])] : selected.filter(id => !data.items.some(r => r.id === id)))} /></th>
            {visible.map(c => <th key={c.key} aria-sort={sort && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>{c.sort && supportsQuery ? <button type="button" className="adm-dt-sort" onClick={() => clickSort(c)}>{c.label}{sort === c.sort ? (dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <span className="adm-dt-sort-idle" aria-hidden="true">↕</span>}</button> : c.label}</th>)}
            {renderActions && <th><span className="adm-sr-only">Actions</span></th>}
          </tr></thead>
          <tbody>
            {loading && !data.items.length ? <SkeletonRows rows={6} cols={visible.length + 1 + (renderActions ? 1 : 0)} />
              : !data.items.length ? <tr><td colSpan={visible.length + 2}>{filtering
                ? <EmptyState icon={<SearchX size={26} />} title="Nothing matches these filters" text="Try a different search word, a wider date range or clear the filters." action={<button type="button" className="adm-button adm-secondary" onClick={() => { setSearch(''); setStatus(''); setService(''); setPreset(''); }}>Clear filters</button>} />
                : <EmptyState icon={<Inbox size={26} />} title={'No ' + label.toLowerCase() + ' yet'} text={'When there are ' + label.toLowerCase() + ', they will be listed here.'} action={emptyAction} />}</td></tr>
              : data.items.map(r => (
                <tr key={r.id} className={selected.includes(r.id) ? 'is-selected' : ''} onClick={e => { if (onOpen && !(e.target as HTMLElement).closest('button, a, input, label, select')) onOpen(r); }} style={onOpen ? {cursor: 'pointer'} : undefined}>
                  <td className="adm-dt-check"><input type="checkbox" aria-label="Select row" checked={selected.includes(r.id)} onChange={e => setSelected(s => (e.target.checked ? [...s, r.id] : s.filter(x => x !== r.id)))} /></td>
                  {visible.map(c => <td key={c.key} data-label={c.label}>{c.render(r)}</td>)}
                  {renderActions && <td className="adm-dt-actions">{renderActions(r, reload)}</td>}
                </tr>
              ))}
          </tbody>
        </table>
      </div>


      <footer className="adm-dt-foot">
        <span>{data.total === 0 ? 'No records' : ((page - 1) * LIMIT + 1) + '–' + Math.min(page * LIMIT, data.total) + ' of ' + data.total}</span>
        <div><button type="button" className="adm-icon" aria-label="Previous page" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft size={18} /></button><span>Page {page}</span><button type="button" className="adm-icon" aria-label="Next page" disabled={page * LIMIT >= data.total || loading} onClick={() => setPage(p => p + 1)}><ChevronRight size={18} /></button></div>
      </footer>

      {selected.length > 0 && (
        <div className="adm-dt-bulk" role="toolbar" aria-label="Actions for selected rows">
          <strong>{selected.length} selected</strong>
          {bulkActions.map(a => <button key={a.id} type="button" className={a.danger ? 'is-danger' : ''} onClick={() => void runBulk(a)}>{a.label}</button>)}
          <button type="button" onClick={exportSelected}><Download size={15} />Export CSV</button>
          <button type="button" className="adm-dt-bulk-x" aria-label="Clear selection" onClick={() => setSelected([])}><X size={16} /></button>
        </div>
      )}
    </section>
  );
}
