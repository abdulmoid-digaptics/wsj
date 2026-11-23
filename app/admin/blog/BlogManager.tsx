'use client';
import Image from 'next/image';
import {useCallback, useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDownUp, Copy, Download, Eye, Pencil, Pin, Plus, RefreshCw, Search, Star, Trash2, Archive} from 'lucide-react';
import {API, ApiError, authToken, request, revalidatePublic} from '../api';
import BlogEditor from './BlogEditor';
import './blog-studio.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form CMS metadata
type Row = {id: string; title: string; slug: string; path: string; state: 'draft' | 'scheduled' | 'published' | 'archived'; featured: boolean; featuredOrder: number | null; author: string; categories: string[]; publishAt: string | null; publishedAt: string | null; createdAt: string; updatedAt: string; seo: {ok: boolean; issues: string[]}; views: number; readingMinutes: number; metadata: Record<string, any>; pinned?: boolean; feedback?: {yes: number; no: number}};
type Options = {authors: Array<{id: string; name: string}>; categories: Array<{id: string; name: string}>};
const STATES = [['', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['archived', 'Archived']] as const;
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : '—');
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : '—');

export default function BlogManager({canWrite, isAdmin, onUnauthorized}: {canWrite: boolean; isAdmin: boolean; onUnauthorized: () => void}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [options, setOptions] = useState<Options | null>(null);
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [featured, setFeatured] = useState(false);
  const [author, setAuthor] = useState('');
  const [sort, setSort] = useState('updated');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const limit = 20;

  const fail = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) onUnauthorized(); setError(e instanceof Error ? e.message : 'Something went wrong'); }, [onUnauthorized]);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { void request<Options>('/admin/blog-studio/options').then(setOptions).catch(fail); }, [fail]);
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({page: String(page), limit: String(limit), sort, dir});
    if (state) params.set('state', state);
    if (query) params.set('q', query);
    if (category) params.set('category', category);
    if (featured) params.set('featured', 'true');
    if (author) params.set('author', author);
    request<{items: Row[]; total: number; counts: Record<string, number>}>('/admin/blog-studio?' + params)
      .then(data => { if (!live) return; setRows(data.items); setTotal(data.total); setCounts(data.counts || {}); setError(''); })
      .catch(e => live && fail(e))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [page, sort, dir, state, query, category, featured, author, reload, fail]);

  const refresh = () => { setLoading(true); setReload(r => r + 1); };
  async function create() {
    try { const p = await request<{id: string}>('/admin/blog-studio', {method: 'POST', body: JSON.stringify({title: 'Untitled post'})}); setEditing(p.id); }
    catch (e) { fail(e); }
  }
  async function act(fn: () => Promise<unknown>, done: string, publicChange = false) {
    setNotice(''); setError('');
    try { await fn(); setNotice(done); setSelected([]); refresh(); if (publicChange) void revalidatePublic(); } catch (e) { fail(e); }
  }
  async function preview(r: Row) {
    if (r.state === 'published') { window.open(r.path, '_blank', 'noopener'); return; }
    try { const res = await request<{url: string}>('/admin/blog-studio/' + r.id + '/preview-link', {method: 'POST'}); window.open(res.url, '_blank', 'noopener'); } catch (e) { fail(e); }
  }
  const bulk = (action: string, label: string) => {
    if (!selected.length) return;
    if (['delete', 'archive', 'unpublish'].includes(action) && !window.confirm(label + ' ' + selected.length + ' post(s)?' + (action === 'delete' ? ' This cannot be undone.' : ''))) return;
    void act(() => request('/admin/blog-studio/bulk', {method: 'POST', body: JSON.stringify({ids: selected, action})}), label + ': ' + selected.length + ' post(s).', true);
  };
  const toggleSort = (key: string) => { if (sort === key) setDir(x => (x === 'asc' ? 'desc' : 'asc')); else { setSort(key); setDir(key === 'title' ? 'asc' : 'desc'); } setPage(1); };
  const catName = (id: string) => options?.categories.find(c => c.id === String(id))?.name.replace(/\bbuss?iness\b/gi, 'Business');
  const pages = Math.max(1, Math.ceil(total / limit));
  const allChecked = rows.length > 0 && rows.every(r => selected.includes(r.id));

  /* The studio is a full-screen layer rendered outside the admin shell, so the admin's global typography rules do not restyle the article canvas. */
  if (editing) return createPortal(<div className="bs-portal" data-art="studio"><BlogEditor id={editing} canWrite={canWrite} onClose={changedFlag => { setEditing(null); if (changedFlag) refresh(); }} /></div>, document.body);

  /* Downloads every post (metadata, views, helpful votes; no article bodies) as a spreadsheet. */
  async function exportCsv() {
    try {
      const res = await fetch(API + '/admin/blog-studio/export', {headers: {Authorization: 'Bearer ' + (authToken() || '')}});
      if (!res.ok) throw new Error('Export failed (' + res.status + ')');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'journal-posts-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { window.alert(e instanceof Error ? e.message : 'Export failed'); }
  }

  return (
    <section className="bm" aria-busy={loading}>
      <div className="bm-head">
        <div className="bm-tabs" role="tablist" aria-label="Status">
          {STATES.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={state === key} onClick={() => { setState(key); setPage(1); setSelected([]); }}>{label}<span>{key ? counts[key] || 0 : Object.values(counts).reduce((a, b) => a + b, 0)}</span></button>)}
        </div>
        <div className="bm-actions">
          <button type="button" className="bs-btn" onClick={refresh}><RefreshCw size={15} /> Refresh</button>
          <button type="button" className="bs-btn" onClick={() => void exportCsv()}><Download size={15} /> Export CSV</button>
          {canWrite && <button type="button" className="bs-btn bs-primary" onClick={() => void create()}><Plus size={15} /> New post</button>}
        </div>
      </div>
      <div className="bm-filters">
        <label className="bs-search"><Search size={15} aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title, slug or excerpt" aria-label="Search posts" /></label>
        <select aria-label="Category" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}><option value="">All categories</option>{options?.categories.map(c => <option key={c.id} value={c.id}>{c.name.replace(/\bbuss?iness\b/gi, 'Business')}</option>)}</select>
        <select aria-label="Author" value={author} onChange={e => { setAuthor(e.target.value); setPage(1); }}><option value="">All authors</option>{options?.authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <label className="bs-check"><input type="checkbox" checked={featured} onChange={e => { setFeatured(e.target.checked); setPage(1); }} /> Featured only</label>
        {(q || category || author || featured || state) && <button type="button" className="bs-linkbtn" onClick={() => { setQ(''); setCategory(''); setAuthor(''); setFeatured(false); setState(''); setPage(1); }}>Clear filters</button>}
      </div>
      {error && <p className="bs-banner is-error" role="alert">{error}</p>}
      {notice && <p className="bs-banner is-ok" role="status">{notice}</p>}
      {selected.length > 0 && canWrite && <div className="bm-bulk" role="toolbar" aria-label="Bulk actions">
        <strong>{selected.length} selected</strong>
        <button type="button" onClick={() => bulk('publish', 'Published')}>Publish</button>
        <button type="button" onClick={() => bulk('unpublish', 'Unpublished')}>Unpublish</button>
        <button type="button" onClick={() => bulk('feature', 'Featured')}>Feature</button>
        <button type="button" onClick={() => bulk('unfeature', 'Unfeatured')}>Unfeature</button>
        <button type="button" onClick={() => bulk('archive', 'Archived')}>Archive</button>
        {isAdmin && <button type="button" className="is-danger" onClick={() => bulk('delete', 'Deleted')}>Delete</button>}
        <button type="button" className="bs-linkbtn" onClick={() => setSelected([])}>Clear</button>
      </div>}
      <div className="bm-table-wrap">
        <table className="bm-table">
          <thead><tr>
            <th className="bm-check"><input type="checkbox" aria-label="Select all on this page" checked={allChecked} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...rows.map(r => r.id)])] : selected.filter(id => !rows.some(r => r.id === id)))} /></th>
            <th><button type="button" onClick={() => toggleSort('title')}>Post <ArrowDownUp size={12} /></button></th>
            <th>Status</th><th>Author</th><th>Category</th><th>SEO</th>
            <th><button type="button" onClick={() => toggleSort('publish')}>Published / scheduled <ArrowDownUp size={12} /></button></th>
            <th><button type="button" onClick={() => toggleSort('updated')}>Updated <ArrowDownUp size={12} /></button></th>
            <th><button type="button" onClick={() => toggleSort('created')}>Created <ArrowDownUp size={12} /></button></th>
            <th className="bm-num">Views</th><th className="bm-num" title="Reader votes on Was this article helpful?">Helpful</th><th><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {!loading && !rows.length && <tr><td colSpan={11} className="bm-empty">{q || category || author || featured || state ? 'No posts match these filters.' : 'No posts yet. Create the first one.'}</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className={selected.includes(r.id) ? 'is-selected' : ''}>
                <td className="bm-check"><input type="checkbox" aria-label={'Select ' + r.title} checked={selected.includes(r.id)} onChange={e => setSelected(s => (e.target.checked ? [...s, r.id] : s.filter(x => x !== r.id)))} /></td>
                <td className="bm-title">
                  <div className="bm-title-row">{r.metadata?.featuredImage ? <Image src={r.metadata.featuredImage} alt="" width={56} height={40} loading="lazy" unoptimized /> : <span className="bm-noimg" />}
                    <div><button type="button" className="bm-link" onClick={() => setEditing(r.id)}>{r.title}</button>{r.featured && <span className="bm-star" title={'Featured' + (r.featuredOrder !== null ? ' · order ' + r.featuredOrder : '')}><Star size={12} fill="currentColor" /> Featured{r.featuredOrder !== null ? ' #' + r.featuredOrder : ''}</span>}{r.pinned && <span className="bm-star bm-pin" title="Pinned to the top of the latest stories"><Pin size={12} /> Pinned</span>}<small>{r.path} · {r.readingMinutes} min</small></div></div>
                </td>
                <td><span className={'bs-state is-' + r.state}>{r.state[0].toUpperCase() + r.state.slice(1)}</span></td>
                <td>{r.author || '—'}</td>
                <td>{r.categories.map(c => catName(String(c))).filter(n => n && !/^uncategori/i.test(n)).join(', ') || '—'}</td>
                <td><span className={'bm-seo ' + (r.seo.ok ? 'is-ok' : 'is-warn')} title={r.seo.issues.join('\n') || 'Looks good'}>{r.seo.ok ? 'Good' : r.seo.issues.length + ' to fix'}</span></td>
                <td>{r.state === 'scheduled' ? dt(r.publishAt) : d(r.publishedAt)}</td>
                <td>{d(r.updatedAt)}</td>
                <td>{d(r.createdAt)}</td>
                <td className="bm-num">{r.views.toLocaleString()}</td>
                <td className="bm-num">{(() => { const y = r.feedback?.yes ?? 0, n = r.feedback?.no ?? 0; return y + n ? <span title={y + ' yes · ' + n + ' no'}>{Math.round((y / (y + n)) * 100)}% <small>({y + n})</small></span> : '—'; })()}</td>
                <td className="bm-row-actions">
                  <button type="button" className="bs-icon" aria-label={'Edit ' + r.title} title="Edit" onClick={() => setEditing(r.id)}><Pencil size={15} /></button>
                  <button type="button" className="bs-icon" aria-label={'Preview ' + r.title} title={r.state === 'published' ? 'View live' : 'Private preview'} onClick={() => void preview(r)}><Eye size={15} /></button>
                  {canWrite && <button type="button" className="bs-icon" aria-label={'Duplicate ' + r.title} title="Duplicate" onClick={() => void act(async () => { const p = await request<{id: string; title: string}>('/admin/blog-studio/' + r.id + '/duplicate', {method: 'POST'}); setEditing(p.id); }, 'Duplicated.')}><Copy size={15} /></button>}
                  {canWrite && r.state !== 'archived' && <button type="button" className="bs-icon" aria-label={'Archive ' + r.title} title="Archive" onClick={() => { if (window.confirm('Archive "' + r.title + '"? It will be hidden from the website.')) void act(() => request('/admin/blog-studio/bulk', {method: 'POST', body: JSON.stringify({ids: [r.id], action: 'archive'})}), 'Archived.', true); }}><Archive size={15} /></button>}
                  {isAdmin && <button type="button" className="bs-icon is-danger" aria-label={'Delete ' + r.title} title="Delete permanently" onClick={() => { if (window.confirm('Delete "' + r.title + '" permanently, with its history? This cannot be undone.')) void act(() => request('/admin/blog-studio/' + r.id, {method: 'DELETE'}), 'Deleted.', true); }}><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bm-pager">
        <span>{total ? (page - 1) * limit + 1 + '–' + Math.min(total, page * limit) + ' of ' + total : 'No posts'}</span>
        <button type="button" className="bs-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button type="button" className="bs-btn" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </section>
  );
}
