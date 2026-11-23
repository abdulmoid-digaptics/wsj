'use client';
import Image from 'next/image';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, CalendarClock, Check, Eye, History, ImagePlus, Link2, Monitor, Smartphone, X} from 'lucide-react';
import {ApiError, request, revalidatePublic} from '../api';
import {BlockEditor, type ImportReport} from './editor/BlockEditor';
import {MediaDialog} from './editor/dialogs';
import {SeoAnalysis} from './SeoAnalysis';
import {prepareArticle} from '@/lib/article/render';
import {renderDiagrams} from '@/components/article/article-enhancer';
import '@/components/article/article.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form CMS metadata
export type Post = {id: string; title: string; slug: string; path: string; status: string; state: 'draft' | 'scheduled' | 'published' | 'archived'; excerpt: string | null; content: {html?: string; doc?: unknown; version?: number} | null; metadata: Record<string, any>; publishAt: string | null; publishedAt: string | null; createdAt: string; updatedAt: string; readingMinutes: number; seo: {ok: boolean; issues: string[]}; views: number; pinned?: boolean; feedback?: {yes: number; no: number}; redirects?: string[]; pendingAutosave?: {id: string; at: string} | null};
type Options = {authors: Array<{id: string; name: string}>; categories: Array<{id: string; name: string}>; tags: Array<{id: string; name: string}>; siteUrl: string};
type Revision = {id: string; title: string; status: string; reason: string; actorName: string | null; createdAt: string; words: number};
type Meta = {subtitle: string; featured: boolean; featuredOrder: string; featuredImage: string; featuredImageAlt: string; authorId: string; author: string; authorAvatar: string; categories: string[]; tags: string[]; seo: {title: string; description: string; canonical: string; noindex: boolean}; og: {title: string; description: string; image: string}; internalNotes: string; pinned: boolean; authorBio: string; focusKeyword: string; feedbackDisabled: boolean};

const TZ = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form CMS metadata
const metaFrom = (m: Record<string, any>): Meta => ({
  subtitle: m.subtitle || '', featured: m.featured === true, featuredOrder: m.featuredOrder === null || m.featuredOrder === undefined ? '' : String(m.featuredOrder), featuredImage: m.featuredImage || '', featuredImageAlt: m.featuredImageAlt || '',
  authorId: m.authorId || '', author: m.author || '', authorAvatar: m.authorAvatar || '', categories: (m.categories || []).map(String), tags: (m.tags || []).map(String),
  seo: {title: m.seo?.title || '', description: m.seo?.description || '', canonical: m.seo?.canonical || '', noindex: m.seo?.noindex === true}, og: {title: m.og?.title || '', description: m.og?.description || '', image: m.og?.image || ''}, internalNotes: m.internalNotes || '',
  pinned: m.pinned === true, authorBio: m.authorBio || '', focusKeyword: m.focusKeyword || '', feedbackDisabled: m.feedbackDisabled === true,
});
const slugify = (v: string) => v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90).replace(/-+$/g, '');
const toLocalInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
/** A local datetime-input value as an ISO instant with this browser's offset. */
const localToIso = (v: string) => (v ? new Date(v).toISOString() : '');
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '—');
const STATE_LABEL = {draft: 'Draft', scheduled: 'Scheduled', published: 'Published', archived: 'Archived'} as const;

export default function BlogEditor({id, onClose, canWrite}: {id: string; onClose: (changed: boolean) => void; canWrite: boolean}) {
  const [post, setPost] = useState<Post | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugInfo, setSlugInfo] = useState<{available: boolean; problem: string | null; suggestion: string; path: string} | null>(null);
  const [excerpt, setExcerpt] = useState('');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [html, setHtml] = useState('');
  const [doc, setDoc] = useState<unknown>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<{kind: 'ok' | 'error' | 'info'; text: string} | null>(null);
  const [autosaved, setAutosaved] = useState<string | null>(null);
  const [tab, setTab] = useState<'post' | 'seo' | 'advanced'>('post');
  const [panel, setPanel] = useState<null | 'preview' | 'history'>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pickImage, setPickImage] = useState<null | 'featured' | 'og'>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [recovery, setRecovery] = useState<{html: string; title: string; at: string} | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const changed = useRef(false);
  const draftKey = 'wsj-blog-draft:' + id;

  const load = useCallback(async () => {
    const [p, o] = await Promise.all([request<Post>('/admin/blog-studio/' + id), request<Options>('/admin/blog-studio/options')]);
    setPost(p); setOptions(o);
    setTitle(p.title); setSlug(p.slug); setExcerpt(p.excerpt || ''); setMeta(metaFrom(p.metadata || {}));
    setHtml(p.content?.html || ''); setDoc(p.content?.doc ?? null);
    setScheduleAt(p.state === 'scheduled' ? toLocalInput(p.publishAt) : '');
    setSlugTouched(p.state !== 'draft' || !!p.publishedAt);
    setDirty(false);
    try {
      const local = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (local && local.at > p.updatedAt && local.html !== (p.content?.html || '')) setRecovery(local);
    } catch { /* ignore */ }
  }, [id, draftKey]);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() is async; state is set after the request resolves.
    load().catch(e => { if (live) setStatus({kind: 'error', text: e instanceof Error ? e.message : 'Could not open this post'}); });
    return () => { live = false; };
  }, [load]);

  /* Unsaved-change protection. */
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!slug) { setSlugInfo(null); return; } void request<{available: boolean; problem: string | null; suggestion: string; path: string}>('/admin/blog-studio/slug-check?slug=' + encodeURIComponent(slug) + '&id=' + id).then(setSlugInfo).catch(() => undefined); }, 350);
    return () => clearTimeout(t);
  }, [slug, id]);

  const body = useCallback((intent: string, extra: Record<string, unknown> = {}) => ({
    title, slug, excerpt, intent, content: {html, doc},
    meta: meta ? {...meta, featuredOrder: meta.featuredOrder === '' ? null : Number(meta.featuredOrder)} : {},
    expectedUpdatedAt: post?.updatedAt, ...extra,
  }), [title, slug, excerpt, html, doc, meta, post?.updatedAt]);

  /* Autosave: local copy immediately, server every 20 seconds of inactivity. */
  useEffect(() => {
    if (!dirty || !post || !canWrite) return;
    try { localStorage.setItem(draftKey, JSON.stringify({html, title, at: new Date().toISOString()})); } catch { /* storage full */ }
    const t = setTimeout(async () => {
      try {
        const res = await request<{saved: string; updatedAt: string}>('/admin/blog-studio/' + id + '/autosave', {method: 'POST', body: JSON.stringify(body('keep'))});
        if (res.saved === 'draft') { setPost(p => (p ? {...p, updatedAt: res.updatedAt} : p)); setDirty(false); changed.current = true; }
        setAutosaved((res.saved === 'draft' ? 'Draft autosaved ' : 'Changes kept in history ') + new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}));
      } catch (e) { setAutosaved(e instanceof ApiError && e.status === 409 ? 'Autosave paused: this post changed elsewhere' : 'Autosave failed. Your work is kept in this browser'); }
    }, 20000);
    return () => clearTimeout(t);
  }, [dirty, html, title, excerpt, meta, post, id, canWrite, body, draftKey]);

  async function save(intent: 'draft' | 'publish' | 'schedule' | 'unpublish' | 'archive' | 'keep', overwrite = false) {
    if (!post || !meta) return;
    if (!title.trim()) { setStatus({kind: 'error', text: 'Add a title first.'}); return; }
    if (slugInfo && !slugInfo.available) { setStatus({kind: 'error', text: slugInfo.problem || 'Choose another slug.'}); return; }
    if (intent === 'schedule' && !scheduleAt) { setStatus({kind: 'error', text: 'Choose the date and time to publish.'}); setTab('post'); return; }
    if (intent === 'publish' && post.state === 'draft' && meta.featuredImage && !meta.featuredImageAlt) { setStatus({kind: 'info', text: 'Tip: add alt text to the featured image for accessibility and SEO.'}); }
    setSaving(intent);
    try {
      const saved = await request<Post>('/admin/blog-studio/' + id, {method: 'PUT', body: JSON.stringify(body(intent, {publishAt: intent === 'schedule' ? localToIso(scheduleAt) : undefined, ...(overwrite ? {expectedUpdatedAt: undefined} : {})}))});
      setPost(p => ({...(p as Post), ...saved}));
      setDirty(false); changed.current = true;
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      if (saved.state === 'published' || post.state === 'published' || saved.state === 'scheduled') void revalidatePublic();
      const done: Record<string, string> = {draft: 'Saved as draft.', publish: 'Published. It is live now.', schedule: 'Scheduled for ' + fmt(saved.publishAt) + ' (' + TZ + ').', unpublish: 'Unpublished. The article is no longer public.', archive: 'Archived.', keep: saved.state === 'published' ? 'Changes are live.' : 'Saved.'};
      setStatus({kind: 'ok', text: done[intent]});
      setAutosaved(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /changed by someone else|another tab/i.test(e.message)) {
        if (window.confirm(e.message + '\n\nOK = overwrite with your version. Cancel = keep editing (you can copy your text, then reload).')) { setSaving(null); return save(intent, true); }
      }
      setStatus({kind: 'error', text: e instanceof Error ? e.message : 'Save failed'});
    } finally { setSaving(null); }
  }

  async function openHistory() {
    setPanel('history');
    setRevisions(null);
    try { setRevisions(await request<Revision[]>('/admin/blog-studio/' + id + '/revisions')); } catch (e) { setStatus({kind: 'error', text: e instanceof Error ? e.message : 'Could not load history'}); }
  }
  async function restore(rev: Revision) {
    if (dirty && !window.confirm('You have unsaved changes. Restoring replaces the editor content. Continue?')) return;
    if (!window.confirm('Restore the version from ' + fmt(rev.createdAt) + '? The current version is kept in history, and the publication status does not change.')) return;
    try {
      const restored = await request<Post>('/admin/blog-studio/' + id + '/revisions/' + rev.id + '/restore', {method: 'POST'});
      setPost(p => ({...(p as Post), ...restored}));
      setTitle(restored.title); setExcerpt(restored.excerpt || ''); setMeta(metaFrom(restored.metadata)); setHtml(restored.content?.html || ''); setDoc(restored.content?.doc ?? null);
      setEditorKey(k => k + 1); setDirty(false); changed.current = true; setPanel(null);
      if (restored.state === 'published') void revalidatePublic();
      setStatus({kind: 'ok', text: 'Restored the version from ' + fmt(rev.createdAt) + '.'});
    } catch (e) { setStatus({kind: 'error', text: e instanceof Error ? e.message : 'Restore failed'}); }
  }
  async function previewLink() {
    try { const r = await request<{url: string}>('/admin/blog-studio/' + id + '/preview-link', {method: 'POST'}); window.open(r.url, '_blank', 'noopener'); }
    catch (e) { setStatus({kind: 'error', text: e instanceof Error ? e.message : 'Could not create a preview link'}); }
  }

  const setM = (patch: Partial<Meta>) => { setMeta(m => (m ? {...m, ...patch} : m)); setDirty(true); };
  const onEditorChange = useCallback((h: string, d: unknown) => { setHtml(h); setDoc(d); setDirty(true); }, []);
  const onImportReport = useCallback((r: ImportReport) => setReport(r), []);
  const onUploadError = useCallback((m: string) => setStatus({kind: 'error', text: m}), []);
  const prepared = useMemo(() => (panel === 'preview' ? prepareArticle({html, version: 2}) : null), [panel, html]);
  useEffect(() => { if (prepared) setTimeout(() => void renderDiagrams(document), 50); }, [prepared, device]);

  if (!post || !meta || !options) return <div className="bs-shell"><div className="bs-loading">{status?.text || 'Opening the post…'}</div></div>;
  const siteOrigin = (options.siteUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
  const path = slug === post.slug ? post.path : post.path.replace(/[^/]+\/?$/, (slug || 'post') + '/');
  const publicUrl = siteOrigin + path;
  const seoTitle = meta.seo.title || title, seoDesc = meta.seo.description || excerpt || '';
  const live = post.state === 'published';

  return (
    <div className="bs-shell">
      <header className="bs-top">
        <button type="button" className="bs-btn bs-ghost" onClick={() => { if (dirty && !window.confirm('Leave without saving? Your latest changes are kept in this browser for recovery.')) return; onClose(changed.current); }}><ArrowLeft size={16} /> All posts</button>
        <div className="bs-top-mid">
          <span className={'bs-state is-' + post.state}>{STATE_LABEL[post.state]}{post.state === 'scheduled' ? ' · ' + fmt(post.publishAt) : ''}</span>
          <span className="bs-save-state" role="status" aria-live="polite">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : autosaved || 'All changes saved'}</span>
        </div>
        <div className="bs-top-actions">
          <button type="button" className="bs-btn" aria-pressed={panel === 'history'} onClick={() => (panel === 'history' ? setPanel(null) : void openHistory())}><History size={16} /> History</button>
          <button type="button" className="bs-btn" aria-pressed={panel === 'preview'} onClick={() => setPanel(p => (p === 'preview' ? null : 'preview'))}><Eye size={16} /> Preview</button>
          {canWrite && <>
            {!live && <button type="button" className="bs-btn" disabled={!!saving} onClick={() => void save('draft')}>Save draft</button>}
            {live ? <button type="button" className="bs-btn bs-primary" disabled={!!saving} onClick={() => void save('keep')}>{saving === 'keep' ? 'Updating…' : 'Update'}</button>
              : <button type="button" className="bs-btn bs-primary" disabled={!!saving} onClick={() => void save('publish')}>{saving === 'publish' ? 'Publishing…' : post.state === 'scheduled' ? 'Publish now' : 'Publish'}</button>}
          </>}
        </div>
      </header>
      {status && <div className={'bs-banner is-' + status.kind} role={status.kind === 'error' ? 'alert' : 'status'}><span>{status.text}</span>{status.kind === 'ok' && (post.state === 'published') && <a href={path} target="_blank" rel="noreferrer">View live <Link2 size={13} /></a>}<button type="button" className="bs-icon" aria-label="Dismiss" onClick={() => setStatus(null)}><X size={14} /></button></div>}
      {recovery && <div className="bs-banner is-info" role="status"><span>This browser has unsaved edits from {fmt(recovery.at)}.</span><button type="button" className="bs-btn" onClick={() => { setHtml(recovery.html); setTitle(recovery.title || title); setEditorKey(k => k + 1); setDirty(true); setRecovery(null); }}>Recover them</button><button type="button" className="bs-btn bs-ghost" onClick={() => { localStorage.removeItem(draftKey); setRecovery(null); }}>Discard</button></div>}
      {post.pendingAutosave && !recovery && <div className="bs-banner is-info"><span>An autosaved version from {fmt(post.pendingAutosave.at)} is newer than the published one. Open History to compare or restore it.</span><button type="button" className="bs-btn" onClick={() => void openHistory()}>Open history</button></div>}
      {report && <div className="bs-banner is-info bs-report" role="status"><div><strong>{report.title}</strong><ul>{report.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div><button type="button" className="bs-icon" aria-label="Dismiss import report" onClick={() => setReport(null)}><X size={14} /></button></div>}

      <div className="bs-body">
        <main className="bs-main">
          {panel === 'preview' && prepared ? (
            <div className="bs-preview">
              <div className="bs-preview-bar"><div className="bs-seg" role="group" aria-label="Device"><button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Monitor size={14} /> Desktop</button><button type="button" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone size={14} /> Mobile</button></div><span className="bs-muted">Rendered with the same renderer as the public article.</span><button type="button" className="bs-btn" onClick={() => void previewLink()}>Open full-page preview</button></div>
              <div className={'bs-preview-frame is-' + device}>
                <article className="bs-preview-article">
                  {meta.featuredImage && (
                    <Image className="bs-preview-cover" src={meta.featuredImage} alt={meta.featuredImageAlt}
                      width={782} height={391} sizes={device === 'mobile' ? '(max-width: 430px) calc(100vw - 82px), 348px' : '(max-width: 880px) 90vw, 782px'}
                      style={{height: 'auto'}} loading="eager" unoptimized />
                  )}
                  <h1>{title || 'Untitled'}</h1>
                  {meta.subtitle && <p className="bs-preview-sub">{meta.subtitle}</p>}
                  <p className="bs-preview-meta">{meta.author || 'Workspace Junction'} · {prepared.minutes} min read</p>
                  <div className="wj-article" dangerouslySetInnerHTML={{__html: prepared.html}} />
                </article>
              </div>
            </div>
          ) : panel === 'history' ? (
            <div className="bs-history">
              <h2>Version history</h2>
              <p className="bs-muted">Every save, publish and autosave is kept. Restoring brings back the title, text and settings; the URL and publication status stay as they are.</p>
              {!revisions ? <p className="bs-muted">Loading…</p> : <ol>{revisions.map(r => <li key={r.id}><div><strong>{fmt(r.createdAt)}</strong><span className="bs-chip">{r.reason}</span><small>{r.actorName || 'Unknown'} · {r.words.toLocaleString()} words · {r.title}</small></div>{canWrite && <button type="button" className="bs-btn" onClick={() => void restore(r)}>Restore</button>}</li>)}</ol>}
              <button type="button" className="bs-btn" onClick={() => setPanel(null)}>Back to editing</button>
            </div>
          ) : (
            <div className="bs-doc">
              <textarea className="bs-title" rows={1} value={title} placeholder="Post title" aria-label="Title" onChange={e => { const v = e.target.value.replace(/\n/g, ' '); setTitle(v); /* The slug follows the title until it is edited by hand or the post has been published. */ if (!slugTouched) setSlug(slugify(v)); setDirty(true); }} />
              <input className="bs-subtitle" value={meta.subtitle} placeholder="Optional subtitle" aria-label="Subtitle" onChange={e => setM({subtitle: e.target.value})} />
              <BlockEditor key={editorKey} initialHtml={html} onChange={onEditorChange} onImportReport={onImportReport} onUploadError={onUploadError} />
            </div>
          )}
        </main>

        <aside className="bs-side" aria-label="Post settings">
          <div className="bs-tabs" role="tablist">
            {(['post', 'seo', 'advanced'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'post' ? 'Post' : t === 'seo' ? 'SEO & social' : 'Advanced'}</button>)}
          </div>
          {tab === 'post' && <div className="bs-side-body">
            <section className="bs-card">
              <h4>Publication</h4>
              <dl className="bs-facts"><div><dt>Status</dt><dd>{STATE_LABEL[post.state]}</dd></div><div><dt>Published</dt><dd>{fmt(post.publishedAt)}</dd></div><div><dt>Last updated</dt><dd>{fmt(post.updatedAt)}</dd></div><div><dt>Reading time</dt><dd>{Math.max(1, Math.round(html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length / 220))} min</dd></div><div><dt>Views</dt><dd>{post.views.toLocaleString()}</dd></div></dl>
              <label className="bs-field"><span><CalendarClock size={14} /> Schedule for ({TZ})</span><input type="datetime-local" value={scheduleAt} min={toLocalInput(new Date(Date.now() + 120000).toISOString())} onChange={e => setScheduleAt(e.target.value)} /></label>
              {canWrite && <div className="bs-stack">
                <button type="button" className="bs-btn" disabled={!scheduleAt || !!saving} onClick={() => void save('schedule')}>{post.state === 'scheduled' ? 'Reschedule' : 'Schedule'}</button>
                {post.state === 'scheduled' && <button type="button" className="bs-btn" disabled={!!saving} onClick={() => void save('draft')}>Cancel schedule</button>}
                {live && <button type="button" className="bs-btn" disabled={!!saving} onClick={() => { if (window.confirm('Unpublish? The article will stop being public immediately.')) void save('unpublish'); }}>Unpublish</button>}
                {post.state !== 'archived' && <button type="button" className="bs-btn bs-ghost" disabled={!!saving} onClick={() => { if (window.confirm('Archive this post? It will be hidden from the website.')) void save('archive'); }}>Archive</button>}
              </div>}
            </section>
            <section className="bs-card">
              <h4>URL</h4>
              <label className="bs-field"><span>Slug</span><input value={slug} onChange={e => { setSlug(slugify(e.target.value) || e.target.value.toLowerCase()); setSlugTouched(true); setDirty(true); }} aria-describedby="bs-url" /></label>
              <p id="bs-url" className="bs-url"><a href={post.state === 'published' ? path : undefined} target="_blank" rel="noreferrer">{publicUrl}</a></p>
              {slugInfo && !slugInfo.available && <p className="bs-error">{slugInfo.problem}{slugInfo.suggestion !== slug && <> · <button type="button" className="bs-linkbtn" onClick={() => setSlug(slugInfo.suggestion)}>Use “{slugInfo.suggestion}”</button></>}</p>}
              {post.publishedAt && slug !== post.slug && <p className="bs-note">The old address will redirect to the new one.</p>}
              {post.redirects?.length ? <p className="bs-muted">Redirects here from: {post.redirects.join(', ')}</p> : null}
            </section>
            <section className="bs-card">
              <h4>Featured image</h4>
              {meta.featuredImage ? (
                <Image className="bs-thumb" src={meta.featuredImage} alt={meta.featuredImageAlt}
                  width={304} height={171} sizes="(max-width: 1100px) calc(100vw - 58px), 301px" style={{height: 'auto'}} loading="eager" unoptimized />
              ) : <div className="bs-thumb is-empty">No image</div>}
              <div className="bs-row"><button type="button" className="bs-btn" onClick={() => setPickImage('featured')}><ImagePlus size={15} /> {meta.featuredImage ? 'Replace' : 'Choose image'}</button>{meta.featuredImage && <button type="button" className="bs-btn bs-ghost" onClick={() => setM({featuredImage: ''})}>Remove</button>}</div>
              <label className="bs-field"><span>Alt text</span><input value={meta.featuredImageAlt} onChange={e => setM({featuredImageAlt: e.target.value})} placeholder="Describe the image" /></label>
            </section>
            <section className="bs-card">
              <h4>Excerpt</h4>
              <textarea rows={3} value={excerpt} onChange={e => { setExcerpt(e.target.value); setDirty(true); }} placeholder="Shown on cards. Leave empty to use the first sentences." aria-label="Excerpt" />
              <small className="bs-muted">{excerpt.length}/300</small>
            </section>
            <section className="bs-card">
              <h4>Author & topics</h4>
              <label className="bs-field"><span>Author</span><select value={meta.authorId} onChange={e => { const a = options.authors.find(x => x.id === e.target.value); setM({authorId: e.target.value, author: a?.name || meta.author}); }}><option value="">{meta.author ? meta.author + ' (as imported)' : 'Workspace Junction'}</option>{options.authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label className="bs-field"><span>Display name</span><input value={meta.author} onChange={e => setM({author: e.target.value})} placeholder="Workspace Junction" /></label>
              <TermPicker label="Categories" all={options.categories} value={meta.categories} onChange={v => setM({categories: v})} />
              <TermPicker label="Tags" all={options.tags} value={meta.tags} onChange={v => setM({tags: v})} empty="No tags exist yet. Create them under Website content › Tags." />
              <label className="bs-field"><span>Author bio <small className="bs-muted">{meta.authorBio.length}/600</small></span><textarea rows={3} maxLength={600} value={meta.authorBio} onChange={e => setM({authorBio: e.target.value})} placeholder="Shown in an About the author box under the article. Leave empty to hide it." /></label>
            </section>
            <section className="bs-card">
              <h4>Featured</h4>
              <label className="bs-check"><input type="checkbox" checked={meta.featured} onChange={e => setM({featured: e.target.checked})} /> Feature on the Journal</label>
              <label className="bs-check"><input type="checkbox" checked={meta.pinned} onChange={e => setM({pinned: e.target.checked})} /> Pin to the top of the latest stories</label>
              {meta.featured && <label className="bs-field"><span>Featured order (lower shows first)</span><input type="number" min={0} max={9999} value={meta.featuredOrder} onChange={e => setM({featuredOrder: e.target.value})} placeholder="e.g. 1" /></label>}
            </section>
          </div>}
          {tab === 'seo' && <div className="bs-side-body">
            <SeoAnalysis input={{title, seoTitle, seoDesc, slug, html, keyword: meta.focusKeyword, featuredImage: meta.featuredImage, featuredAlt: meta.featuredImageAlt, siteHost: siteOrigin.replace(/^https?:\/\//, '')}} onKeyword={v => setM({focusKeyword: v})} />
            <section className="bs-card">
              <h4>Search result</h4>
              <div className="bs-serp"><span className="bs-serp-url">{publicUrl.replace(/^https?:\/\//, '')}</span><strong>{seoTitle.slice(0, 65)}{seoTitle.length > 65 ? '…' : ''}</strong><p>{seoDesc.slice(0, 160)}{seoDesc.length > 160 ? '…' : ''}</p></div>
              <label className="bs-field"><span>SEO title <small className={seoTitle.length > 65 ? 'bs-warn' : 'bs-muted'}>{seoTitle.length}/65</small></span><input value={meta.seo.title} placeholder={title} onChange={e => setM({seo: {...meta.seo, title: e.target.value}})} /></label>
              <label className="bs-field"><span>Meta description <small className={seoDesc.length > 160 || seoDesc.length < 70 ? 'bs-warn' : 'bs-muted'}>{seoDesc.length}/160</small></span><textarea rows={3} value={meta.seo.description} placeholder={excerpt || 'Summarize the article in one or two sentences.'} onChange={e => setM({seo: {...meta.seo, description: e.target.value}})} /></label>
              <label className="bs-field"><span>Canonical URL</span><input value={meta.seo.canonical} placeholder={publicUrl} onChange={e => setM({seo: {...meta.seo, canonical: e.target.value}})} /></label>
              <label className="bs-check"><input type="checkbox" checked={meta.seo.noindex} onChange={e => setM({seo: {...meta.seo, noindex: e.target.checked}})} /> Hide from search engines (noindex)</label>
              {post.seo.issues.length > 0 && <ul className="bs-issues">{post.seo.issues.map(i => <li key={i}>{i}</li>)}</ul>}
            </section>
            <section className="bs-card">
              <h4>Social preview</h4>
              <div className="bs-social">
                {(meta.og.image || meta.featuredImage) ? (
                  <Image src={meta.og.image || meta.featuredImage} alt="" width={382} height={200}
                    sizes="(max-width: 1100px) calc(100vw - 60px), 299px" style={{height: 'auto'}} loading="eager" unoptimized />
                ) : <div className="bs-social-empty">No image</div>}
                <div><small>{siteOrigin.replace(/^https?:\/\//, '')}</small><strong>{meta.og.title || seoTitle}</strong><p>{(meta.og.description || seoDesc).slice(0, 120)}</p></div>
              </div>
              <label className="bs-field"><span>Social title</span><input value={meta.og.title} placeholder={seoTitle} onChange={e => setM({og: {...meta.og, title: e.target.value}})} /></label>
              <label className="bs-field"><span>Social description</span><textarea rows={2} value={meta.og.description} placeholder={seoDesc} onChange={e => setM({og: {...meta.og, description: e.target.value}})} /></label>
              <div className="bs-row"><button type="button" className="bs-btn" onClick={() => setPickImage('og')}>{meta.og.image ? 'Replace social image' : 'Choose social image'}</button>{meta.og.image && <button type="button" className="bs-btn bs-ghost" onClick={() => setM({og: {...meta.og, image: ''}})}>Use featured image</button>}</div>
            </section>
          </div>}
          {tab === 'advanced' && <div className="bs-side-body">
            <section className="bs-card"><h4>Reader feedback</h4>
              <label className="bs-check"><input type="checkbox" checked={!meta.feedbackDisabled} onChange={e => setM({feedbackDisabled: !e.target.checked})} /> Ask readers “Was this article helpful?”</label>
              <p className="bs-muted">{(post.feedback?.yes ?? 0) + (post.feedback?.no ?? 0) ? `${post.feedback?.yes ?? 0} found it helpful, ${post.feedback?.no ?? 0} did not.` : 'No votes yet.'}</p>
            </section>
            <section className="bs-card"><h4>Internal notes</h4><textarea rows={5} value={meta.internalNotes} placeholder="Only visible to the team. Never published." onChange={e => setM({internalNotes: e.target.value})} /></section>
            <section className="bs-card"><h4>Details</h4><dl className="bs-facts"><div><dt>Created</dt><dd>{fmt(post.createdAt)}</dd></div><div><dt>Format</dt><dd>{post.content?.version === 2 ? 'Block editor' : 'Imported (converted on next save)'}</dd></div><div><dt>Post ID</dt><dd><code>{post.id.slice(0, 8)}</code></dd></div></dl>
              <button type="button" className="bs-btn" onClick={() => void previewLink()}>Get a private preview link (1 hour)</button></section>
          </div>}
        </aside>
      </div>
      {pickImage && <MediaDialog onClose={() => setPickImage(null)} onSelect={items => { const i = items[0]; if (pickImage === 'featured') setM({featuredImage: i.url, featuredImageAlt: meta.featuredImageAlt || i.alt || ''}); else setM({og: {...meta.og, image: i.url}}); setPickImage(null); }} title={pickImage === 'featured' ? 'Featured image' : 'Social image'} />}
    </div>
  );
}

function TermPicker({label, all, value, onChange, empty}: {label: string; all: Array<{id: string; name: string}>; value: string[]; onChange: (v: string[]) => void; empty?: string}) {
  const visible = all.filter(t => !/^uncategori[sz]ed$/i.test(t.name) || value.includes(t.id));
  return (
    <fieldset className="bs-terms"><legend>{label}</legend>
      {visible.length ? visible.map(t => { const on = value.includes(t.id); return <button type="button" key={t.id} className={'bs-pill' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== t.id) : [...value, t.id])}>{on && <Check size={12} />}{t.name.replace(/\bbuss?iness\b/gi, 'Business')}</button>; }) : <p className="bs-muted">{empty || 'None yet.'}</p>}
    </fieldset>
  );
}
