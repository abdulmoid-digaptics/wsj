'use client';
import Image from 'next/image';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Film, ImagePlus, Search, Trash2, UploadCloud, X} from 'lucide-react';
import {API, authToken, request} from '../../api';
import {apiUrl} from '@/lib/public-api';
import {chartSvg, parseChart, CHART_PALETTE, type ChartType} from '@/lib/article/chart';
import {embedFromInput} from './extensions';
import {renderDiagrams} from '@/components/article/article-enhancer';

export type MediaItem = {id: string; url: string; originalName: string; mimeType: string; size: number; alt: string; createdAt: string};

function Modal({title, onClose, children, wide = false, footer}: {title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="bs-modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={'bs-modal' + (wide ? ' is-wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button type="button" className="bs-icon" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
        <div className="bs-modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

/** Upload with progress (XHR), several files at once, straight to the R2-backed media endpoint. */
export function uploadFiles(files: File[], onProgress: (pct: number) => void): Promise<{results: Array<{ok: boolean; item?: MediaItem; name?: string; error?: string}>}> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/admin/blog-studio/media', API));
    xhr.withCredentials = true;
    const token = authToken();
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let body: {message?: string | string[]; results?: unknown} | null = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body as {results: Array<{ok: boolean; item?: MediaItem; name?: string; error?: string}>});
      else reject(new Error(body?.message ? (Array.isArray(body.message) ? body.message.join(', ') : body.message) : 'Upload failed (' + xhr.status + ')'));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(form);
  });
}

const kb = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

/** Media library: upload (drag and drop, multiple), search, grid/list, select one or many, copy URL, delete. */
export function MediaDialog({onClose, onSelect, multiple = false, accept = 'image', title}: {onClose: () => void; onSelect: (items: MediaItem[]) => void; multiple?: boolean; accept?: 'image' | 'video' | 'any'; title?: string}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const matches = (m: MediaItem) => accept === 'any' || m.mimeType.startsWith(accept + '/');

  const load = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const data = await request<{items: MediaItem[]}>('/admin/media?limit=100' + (term ? '&search=' + encodeURIComponent(term) : ''));
      setItems(data.items || []);
    } catch (e) { setMessages([e instanceof Error ? e.message : 'Could not load the media library']); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(q), 250); return () => clearTimeout(t); }, [q, load]);

  async function upload(files: File[]) {
    const list = files.filter(f => accept === 'any' || f.type.startsWith(accept + '/'));
    if (!list.length) { setMessages(['Choose ' + (accept === 'video' ? 'MP4 or WebM videos' : 'JPEG, PNG, WebP, GIF or AVIF images') + '.']); return; }
    const tooBig = list.filter(f => f.size > (f.type.startsWith('video/') ? 100 : 15) * 1048576);
    if (tooBig.length) { setMessages(tooBig.map(f => f.name + ' is too large (images up to 15 MB, videos up to 100 MB).')); return; }
    setProgress(0); setMessages([]);
    try {
      const res = await uploadFiles(list, setProgress);
      const ok = res.results.filter(r => r.ok && r.item).map(r => r.item!);
      setItems(prev => [...ok, ...prev]);
      setSelected(prev => (multiple ? [...prev, ...ok.map(i => i.id)] : ok[0] ? [ok[0].id] : prev));
      setMessages(res.results.filter(r => !r.ok).map(r => (r.name || 'File') + ': ' + r.error));
    } catch (e) { setMessages([e instanceof Error ? e.message : 'Upload failed']); }
    finally { setProgress(null); }
  }

  async function remove(item: MediaItem) {
    if (!window.confirm('Delete "' + item.originalName + '" from the media library? Articles that still use it will show a missing image.')) return;
    const drop = () => { setItems(prev => prev.filter(i => i.id !== item.id)); setSelected(s => s.filter(x => x !== item.id)); };
    try { await request('/admin/media/' + item.id, {method: 'DELETE'}); drop(); }
    catch (e) {
      /* The server refuses while a page still uses the file; deleting anyway is an explicit second choice. */
      if (e instanceof Error && /still used/i.test(e.message) && window.confirm(e.message + '\n\nDelete it anyway?')) {
        try { await request('/admin/media/' + item.id + '?force=true', {method: 'DELETE'}); drop(); } catch (e2) { setMessages([e2 instanceof Error ? e2.message : 'Could not delete']); }
      } else setMessages([e instanceof Error ? e.message : 'Could not delete']);
    }
  }

  const toggle = (id: string) => setSelected(prev => (multiple ? (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]) : [id]));
  const visible = items.filter(matches);
  const chosen = selected.map(id => items.find(i => i.id === id)).filter(Boolean) as MediaItem[];

  return (
    <Modal title={title || (accept === 'video' ? 'Add video' : multiple ? 'Add images' : 'Choose image')} onClose={onClose} wide
      footer={<><span className="bs-muted">{chosen.length ? chosen.length + ' selected' : 'Select ' + (multiple ? 'one or more files' : 'a file')}</span><button type="button" className="bs-btn" onClick={onClose}>Cancel</button><button type="button" className="bs-btn bs-primary" disabled={!chosen.length} onClick={() => onSelect(chosen)}>Insert{chosen.length > 1 ? ' ' + chosen.length : ''}</button></>}>
      <div className={'bs-drop' + (drag ? ' is-drag' : '')} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); void upload(Array.from(e.dataTransfer.files)); }}>
        <UploadCloud size={26} aria-hidden="true" />
        <p><strong>Drop {accept === 'video' ? 'videos' : 'images'} here</strong> or <button type="button" className="bs-linkbtn" onClick={() => input.current?.click()}>browse</button></p>
        <small>{accept === 'video' ? 'MP4 or WebM, up to 100 MB each.' : 'JPEG, PNG, WebP, GIF or AVIF, up to 15 MB each.'} Files are stored in Cloudflare R2.</small>
        <input ref={input} type="file" hidden multiple accept={accept === 'video' ? 'video/mp4,video/webm' : accept === 'image' ? 'image/jpeg,image/png,image/webp,image/gif,image/avif' : 'image/*,video/mp4,video/webm'} onChange={e => { void upload(Array.from(e.target.files || [])); e.target.value = ''; }} />
        {progress !== null && <div className="bs-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{width: progress + '%'}} /> <em>{progress < 100 ? 'Uploading ' + progress + '%' : 'Processing…'}</em></div>}
      </div>
      {messages.map((m, i) => <p key={i} className="bs-error" role="alert">{m}</p>)}
      <div className="bs-media-tools">
        <label className="bs-search"><Search size={15} aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by file name or alt text" aria-label="Search media" /></label>
        <div className="bs-seg" role="group" aria-label="View"><button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button></div>
      </div>
      {loading ? <p className="bs-muted">Loading media…</p> : !visible.length ? <p className="bs-muted">No {accept === 'video' ? 'videos' : 'images'} yet. Upload some above.</p> :
        <ul className={'bs-media ' + (view === 'list' ? 'is-list' : '')}>
          {visible.map(m => (
            <li key={m.id} className={selected.includes(m.id) ? 'is-on' : ''}>
              <button type="button" className="bs-media-pick" aria-pressed={selected.includes(m.id)} onClick={() => toggle(m.id)}>
                {m.mimeType.startsWith('video/') ? <span className="bs-media-video"><Film size={22} /></span> : (
                  <Image src={m.url} alt={m.alt || ''} width={view === 'list' ? 72 : 240} height={view === 'list' ? 72 : 180}
                    sizes={view === 'list' ? '72px' : '(max-width: 360px) 100vw, 240px'} style={{height: 'auto'}} loading="lazy" unoptimized />
                )}
                <span className="bs-media-meta"><strong>{m.originalName}</strong><small>{m.mimeType.split('/')[1]?.toUpperCase()} · {kb(m.size)} · {new Date(m.createdAt).toLocaleDateString()}</small></span>
              </button>
              <div className="bs-media-actions">
                <button type="button" className="bs-icon" aria-label={'Copy URL of ' + m.originalName} onClick={() => void navigator.clipboard?.writeText(m.url)}>URL</button>
                <button type="button" className="bs-icon" aria-label={'Delete ' + m.originalName} onClick={() => void remove(m)}><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>}
    </Modal>
  );
}

export function EmbedDialog({onClose, onInsert}: {onClose: () => void; onInsert: (attrs: {src: string; provider: string; caption: string}) => void}) {
  const [value, setValue] = useState('');
  const [caption, setCaption] = useState('');
  const parsed = value.trim() ? embedFromInput(value) : null;
  return (
    <Modal title="Embed a video" onClose={onClose} footer={<><button type="button" className="bs-btn" onClick={onClose}>Cancel</button><button type="button" className="bs-btn bs-primary" disabled={!parsed} onClick={() => parsed && onInsert({...parsed, caption})}>Embed</button></>}>
      <label className="bs-field"><span>YouTube or Vimeo link, or the embed code</span><textarea rows={3} value={value} onChange={e => setValue(e.target.value)} placeholder="https://www.youtube.com/watch?v=…  or  <iframe src=&quot;https://www.youtube.com/embed/…&quot;></iframe>" autoFocus /></label>
      {value.trim() && !parsed && <p className="bs-error" role="alert">Only YouTube and Vimeo videos can be embedded. Other iframe code is not allowed for security.</p>}
      {parsed && <div className="bs-embed-preview"><iframe src={parsed.src} title="Preview" allowFullScreen loading="lazy" /></div>}
      <label className="bs-field"><span>Caption (optional)</span><input value={caption} onChange={e => setCaption(e.target.value)} /></label>
    </Modal>
  );
}

const EMPTY_CHART = JSON.stringify({type: 'bar', title: 'Quarterly members', labels: ['Q1', 'Q2', 'Q3', 'Q4'], datasets: [{label: 'Members', data: [42, 58, 71, 90], color: CHART_PALETTE[0]}], showValues: true, unit: ''});

/** Chart data editor with a live preview drawn by the same renderer as the public page. */
export function ChartDialog({initial, onClose, onSave}: {initial?: {spec: string; caption: string}; onClose: () => void; onSave: (spec: string, caption: string) => void}) {
  const start = parseChart(initial?.spec || EMPTY_CHART) || parseChart(EMPTY_CHART)!;
  const [type, setType] = useState<ChartType>(start.type);
  const [title, setTitle] = useState(start.title || '');
  const [description, setDescription] = useState(start.description || '');
  const [unit, setUnit] = useState(start.unit || '');
  const [showValues, setShowValues] = useState(start.showValues !== false);
  const [labels, setLabels] = useState<string[]>(start.labels);
  const [sets, setSets] = useState(start.datasets.map((d, i) => ({...d, color: d.color || CHART_PALETTE[i % CHART_PALETTE.length]})));
  const [caption, setCaption] = useState(initial?.caption || '');
  const spec = {type, title, description, unit, showValues, labels, datasets: sets};
  const svg = parseChart(spec) ? chartSvg(parseChart(spec)!) : '';
  const setCell = (di: number, li: number, v: string) => setSets(prev => prev.map((d, i) => (i === di ? {...d, data: d.data.map((x, j) => (j === li ? Number(v) || 0 : x))} : d)));
  return (
    <Modal title="Chart" wide onClose={onClose} footer={<><button type="button" className="bs-btn" onClick={onClose}>Cancel</button><button type="button" className="bs-btn bs-primary" onClick={() => onSave(JSON.stringify(spec), caption)}>Save chart</button></>}>
      <div className="bs-chart-grid">
        <div>
          <div className="bs-row">
            <label className="bs-field"><span>Type</span><select value={type} onChange={e => setType(e.target.value as ChartType)}><option value="bar">Bar</option><option value="horizontal-bar">Horizontal bar</option><option value="line">Line</option><option value="pie">Pie</option><option value="doughnut">Doughnut</option></select></label>
            <label className="bs-field"><span>Unit</span><input value={unit} maxLength={8} placeholder="%, $, h" onChange={e => setUnit(e.target.value)} /></label>
          </div>
          <label className="bs-field"><span>Title</span><input value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label className="bs-field"><span>Description for screen readers</span><input value={description} onChange={e => setDescription(e.target.value)} placeholder="What the chart shows, in one sentence" /></label>
          <label className="bs-check"><input type="checkbox" checked={showValues} onChange={e => setShowValues(e.target.checked)} /> Show values on the chart</label>
          <div className="bs-table-scroll">
            <table className="bs-data">
              <thead><tr><th>Label</th>{sets.map((d, di) => <th key={di}><input aria-label={'Series ' + (di + 1) + ' name'} value={d.label} onChange={e => setSets(p => p.map((x, i) => (i === di ? {...x, label: e.target.value} : x)))} /><input type="color" aria-label="Series color" value={d.color} onChange={e => setSets(p => p.map((x, i) => (i === di ? {...x, color: e.target.value} : x)))} /></th>)}<th /></tr></thead>
              <tbody>{labels.map((l, li) => <tr key={li}><td><input aria-label={'Row ' + (li + 1) + ' label'} value={l} onChange={e => setLabels(p => p.map((x, i) => (i === li ? e.target.value : x)))} /></td>{sets.map((d, di) => <td key={di}><input type="number" aria-label={d.label + ' ' + l} value={d.data[li]} onChange={e => setCell(di, li, e.target.value)} /></td>)}<td><button type="button" className="bs-icon" aria-label="Remove row" onClick={() => { setLabels(p => p.filter((_, i) => i !== li)); setSets(p => p.map(d => ({...d, data: d.data.filter((_, i) => i !== li)}))); }}><X size={14} /></button></td></tr>)}</tbody>
            </table>
          </div>
          <div className="bs-row"><button type="button" className="bs-btn" onClick={() => { setLabels(p => [...p, 'New']); setSets(p => p.map(d => ({...d, data: [...d.data, 0]}))); }}>Add row</button><button type="button" className="bs-btn" disabled={sets.length >= 6 || type === 'pie' || type === 'doughnut'} onClick={() => setSets(p => [...p, {label: 'Series ' + (p.length + 1), data: labels.map(() => 0), color: CHART_PALETTE[p.length % CHART_PALETTE.length]}])}>Add series</button>{sets.length > 1 && <button type="button" className="bs-btn" onClick={() => setSets(p => p.slice(0, -1))}>Remove last series</button>}</div>
          <label className="bs-field"><span>Caption (optional)</span><input value={caption} onChange={e => setCaption(e.target.value)} /></label>
        </div>
        <div className="wj-article bs-chart-preview"><figure data-type="chart"><div className="wj-chart" dangerouslySetInnerHTML={{__html: svg}} /></figure></div>
      </div>
    </Modal>
  );
}

const DIAGRAM_SAMPLES: Record<string, string> = {
  'Flowchart': 'flowchart LR\n  A[Sign up] --> B{Member?}\n  B -- Yes --> C[Book a room]\n  B -- No --> D[Take a tour]\n  D --> A',
  'Process (top-down)': 'flowchart TD\n  A[Idea] --> B[Plan]\n  B --> C[Build]\n  C --> D[Launch]',
  'Sequence': 'sequenceDiagram\n  Member->>Front desk: Check in\n  Front desk-->>Member: Room key',
  'Timeline': 'timeline\n  title Growth\n  2024 : Opened\n  2025 : 100 members\n  2026 : Second floor',
  'Pie': 'pie title Members by plan\n  "Coworking" : 45\n  "Dedicated" : 30\n  "Virtual office" : 25',
};

export function DiagramDialog({initial, onClose, onSave}: {initial?: {code: string; caption: string}; onClose: () => void; onSave: (code: string, caption: string) => void}) {
  const [code, setCode] = useState(initial?.code || DIAGRAM_SAMPLES.Flowchart);
  const [caption, setCaption] = useState(initial?.caption || '');
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const el = preview.current;
      if (!el) return;
      el.innerHTML = '';
      const node = document.createElement('div');
      node.setAttribute('data-type', 'mermaid');
      node.setAttribute('data-code', code);
      node.textContent = code;
      el.appendChild(node);
      void renderDiagrams(el.parentElement || el);
    }, 400);
    return () => clearTimeout(t);
  }, [code]);
  return (
    <Modal title="Diagram" wide onClose={onClose} footer={<><button type="button" className="bs-btn" onClick={onClose}>Cancel</button><button type="button" className="bs-btn bs-primary" onClick={() => onSave(code, caption)}>Save diagram</button></>}>
      <div className="bs-chart-grid">
        <div>
          <label className="bs-field"><span>Start from</span><select defaultValue="" onChange={e => e.target.value && setCode(DIAGRAM_SAMPLES[e.target.value])}><option value="">Choose a template…</option>{Object.keys(DIAGRAM_SAMPLES).map(k => <option key={k}>{k}</option>)}</select></label>
          <label className="bs-field"><span>Diagram (Mermaid syntax)</span><textarea rows={12} className="bs-code" value={code} onChange={e => setCode(e.target.value)} spellCheck={false} /></label>
          <p className="bs-muted">Write steps as <code>A[Step] --&gt; B[Next]</code>. Preview updates as you type.</p>
          <label className="bs-field"><span>Accessible description</span><input value={caption} onChange={e => setCaption(e.target.value)} placeholder="e.g. How a new member books a room" /></label>
        </div>
        <div className="wj-article bs-chart-preview"><div ref={preview} /></div>
      </div>
    </Modal>
  );
}

export function TextDialog({title, label, initial = '', placeholder, onClose, onSave, validate}: {title: string; label: string; initial?: string; placeholder?: string; onClose: () => void; onSave: (v: string) => void; validate?: (v: string) => string | null}) {
  const [value, setValue] = useState(initial);
  const problem = validate?.(value) ?? null;
  return (
    <Modal title={title} onClose={onClose} footer={<><button type="button" className="bs-btn" onClick={onClose}>Cancel</button><button type="button" className="bs-btn bs-primary" disabled={!!problem} onClick={() => onSave(value.trim())}>Save</button></>}>
      <label className="bs-field"><span>{label}</span><input value={value} autoFocus placeholder={placeholder} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !problem) onSave(value.trim()); }} /></label>
      {problem && value && <p className="bs-error">{problem}</p>}
    </Modal>
  );
}

export {Modal, ImagePlus};
