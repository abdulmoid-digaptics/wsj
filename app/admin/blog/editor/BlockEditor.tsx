'use client';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {EditorContent, useEditor, useEditorState, type Editor} from '@tiptap/react';
import {BubbleMenu} from '@tiptap/react/menus';
import {NodeSelection, TextSelection} from '@tiptap/pm/state';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, ChevronUp, Code, Copy, FileUp, Film, GripVertical, Heading2, Highlighter, ImagePlus, Images, Italic, LayoutGrid,
  Link2, List, ListChecks, ListOrdered, Maximize2, Minimize2, Minus, PanelTop, Quote, Redo2, Search, Strikethrough, Subscript as SubIcon, Superscript as SupIcon, Table2, Trash2, Underline, Undo2,
  Workflow, BarChart3, MessageSquareQuote, Columns3, SquareStack, MonitorPlay as Youtube, Palette, Eraser,
} from 'lucide-react';
import {editorExtensions, embedFromInput} from './extensions';
import {ChartView, DiagramView} from './nodeviews';
import {cleanPastedHtml, type PasteReport} from './paste';
import {ChartDialog, DiagramDialog, EmbedDialog, MediaDialog, TextDialog, uploadFiles, type MediaItem} from './dialogs';
import {request} from '../../api';

export type ImportReport = {title: string; notes: string[]};
type Dialog = null | {kind: 'image' | 'gallery' | 'video' | 'embed' | 'link' | 'chart' | 'diagram' | 'replace-image'; pos?: number};

const TEXT_COLORS = ['#1F2A24', '#0E3421', '#4F7A64', '#D7902A', '#A86B14', '#B5562E', '#A53A22', '#2F5D8A', '#6B4E8A', '#6B756F'];
const BG_COLORS = ['#FBE7B8', '#FFF59D', '#E3F1E8', '#EEF4F0', '#EAF2FA', '#FBE6E1', '#F3E8FA', '#F7F4ED', '#0E3421', '#FFFFFF'];
const FONT_SIZES = ['14px', '16px', '18px', '20px', '24px', '28px', '32px'];

type SlashItem = {label: string; hint: string; keys: string; icon: React.ReactNode; run: (e: Editor) => void};

export function BlockEditor({initialHtml, onChange, onImportReport, onUploadError}: {initialHtml: string; onChange: (html: string, doc: unknown, words: number) => void; onImportReport: (r: ImportReport) => void; onUploadError: (m: string) => void}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [slash, setSlash] = useState<{query: string; top: number; left: number; index: number} | null>(null);
  const [handle, setHandle] = useState<{top: number; pos: number} | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const docxInput = useRef<HTMLInputElement>(null);
  const reportRef = useRef(onImportReport);
  useEffect(() => { reportRef.current = onImportReport; }, [onImportReport]);

  const insertUploaded = useCallback(async (editor: Editor, files: File[], at?: number) => {
    const media = files.filter(f => /^(image|video)\//.test(f.type));
    if (!media.length) return false;
    setUploading('Uploading ' + media.length + ' file' + (media.length > 1 ? 's' : '') + '…');
    try {
      const res = await uploadFiles(media, pct => setUploading('Uploading… ' + pct + '%'));
      const ok = res.results.filter(r => r.ok && r.item).map(r => r.item!);
      const chain = editor.chain().focus();
      if (at !== undefined) chain.setTextSelection(at);
      const images = ok.filter(i => i.mimeType.startsWith('image/'));
      if (images.length > 2) chain.insertGallery(images.map(i => ({src: i.url, alt: i.alt})), 3);
      else images.forEach(i => chain.insertFigure({src: i.url, alt: i.alt || ''}));
      ok.filter(i => i.mimeType.startsWith('video/')).forEach(v => chain.insertVideo({src: v.url}));
      chain.run();
      const failed = res.results.filter(r => !r.ok);
      if (failed.length) onUploadError(failed.map(f => (f.name || 'File') + ': ' + f.error).join(' · '));
    } catch (e) { onUploadError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(null); }
    return true;
  }, [onUploadError]);

  const extensions = useMemo(() => editorExtensions().filter(e => !['chart', 'diagram'].includes(e.name)).concat([ChartView, DiagramView]), []);
  const editor = useEditor({
    extensions,
    content: initialHtml || '<p></p>',
    immediatelyRender: false,
    editorProps: {
      attributes: {class: 'wj-article bs-canvas', 'aria-label': 'Article content', spellcheck: 'true'},
      transformPastedHTML: html => {
        const {html: clean, report} = cleanPastedHtml(html);
        if (report.source !== 'html' || report.notes.length) reportRef.current({title: report.source === 'word' ? 'Pasted from Word' : report.source === 'google-docs' ? 'Pasted from Google Docs' : 'Pasted content', notes: summary(report)});
        return clean;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        /* Word puts a picture of the selection on the clipboard too; only treat it as an image paste when there is no HTML. */
        if (files.length && !event.clipboardData?.getData('text/html')) { event.preventDefault(); void insertUploaded(editorRef.current!, files); return true; }
        const text = event.clipboardData?.getData('text/plain')?.trim() || '';
        if (text && !event.clipboardData?.getData('text/html') && embedFromInput(text) && /^https?:\/\/\S+$/.test(text)) {
          editorRef.current?.chain().focus().insertEmbed({...embedFromInput(text)!}).run();
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({left: event.clientX, top: event.clientY})?.pos;
        void insertUploaded(editorRef.current!, files, pos);
        return true;
      },
    },
    onUpdate: ({editor}) => {
      onChange(editor.getHTML(), editor.getJSON(), editor.storage.characterCount?.words?.() ?? 0);
      updateSlash(editor);
    },
    onSelectionUpdate: ({editor}) => updateSlash(editor),
  });
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  function updateSlash(e: Editor) {
    const {$from, empty} = e.state.selection;
    if (!empty || $from.parent.type.name !== 'paragraph') { setSlash(null); return; }
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
    const m = /^\/([\w ]{0,20})$/.exec(before);
    if (!m) { setSlash(null); return; }
    const coords = e.view.coordsAtPos($from.pos);
    const box = wrap.current?.getBoundingClientRect();
    setSlash(prev => ({query: m[1].toLowerCase(), top: coords.bottom - (box?.top || 0) + 6, left: coords.left - (box?.left || 0), index: prev && prev.query === m[1].toLowerCase() ? prev.index : 0}));
  }

  const selectState = (e: Editor) => ({
      heading: [1, 2, 3, 4, 5, 6].find(l => e.isActive('heading', {level: l})) ?? 0,
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'), code: e.isActive('code'),
      sub: e.isActive('subscript'), sup: e.isActive('superscript'), link: e.isActive('link'), bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'),
      quote: e.isActive('blockquote'), align: ['left', 'center', 'right', 'justify'].find(a => e.isActive({textAlign: a})) || 'left', table: e.isActive('table'),
      fontSize: e.getAttributes('textStyle').fontSize || '', color: e.getAttributes('textStyle').color || '',
      canUndo: e.can().undo(), canRedo: e.can().redo(), words: e.storage.characterCount?.words?.() ?? 0, chars: e.storage.characterCount?.characters?.() ?? 0,
      atom: e.state.selection instanceof NodeSelection ? e.state.selection.node.type.name : '',
      atomAttrs: e.state.selection instanceof NodeSelection ? e.state.selection.node.attrs : null,
      cellBg: e.isActive('table') ? (e.getAttributes('tableCell').background || e.getAttributes('tableHeader').background || '') : '',
      tableVariant: e.isActive('table') ? e.getAttributes('table').variant || '' : '',
  });
  const tracked = useEditorState({editor, selector: ({editor: e}) => (e ? selectState(e) : null)});
  /* The hook only re-reads on the next transaction; read directly until it has a value. */
  const state = tracked ?? (editor && !editor.isDestroyed ? selectState(editor) : null);

  /* Block handle: follows the top-level block under the pointer. */
  const onMove = useCallback((ev: React.MouseEvent) => {
    if (!editor || !wrap.current) return;
    const canvas = wrap.current.querySelector('.bs-canvas') as HTMLElement | null;
    if (!canvas) return;
    const cbox = canvas.getBoundingClientRect();
    const hit = editor.view.posAtCoords({left: Math.max(cbox.left + 8, Math.min(ev.clientX, cbox.right - 8)), top: ev.clientY});
    if (!hit) return;
    const $pos = editor.state.doc.resolve(Math.min(hit.inside >= 0 ? hit.inside : hit.pos, editor.state.doc.content.size));
    const depth = Math.min(1, $pos.depth);
    const pos = depth === 0 ? hit.pos : $pos.before(1);
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || !(dom instanceof HTMLElement)) return;
    const wbox = wrap.current.getBoundingClientRect();
    setHandle(h => (h?.pos === pos ? h : {pos, top: dom.getBoundingClientRect().top - wbox.top}));
  }, [editor]);

  function blockAction(action: 'up' | 'down' | 'duplicate' | 'delete' | 'select') {
    if (!editor || !handle) return;
    const {state: st, view} = editor;
    const node = st.doc.nodeAt(handle.pos);
    if (!node) return;
    const from = handle.pos, to = from + node.nodeSize;
    let tr = st.tr;
    if (action === 'delete') tr = tr.delete(from, to);
    else if (action === 'duplicate') tr = tr.insert(to, node.copy(node.content));
    else if (action === 'select') { view.dispatch(tr.setSelection(NodeSelection.create(st.doc, from))); view.focus(); return; }
    else if (action === 'up') {
      const $from = st.doc.resolve(from);
      const index = $from.index(0);
      if (index === 0) return;
      const prev = st.doc.child(index - 1);
      tr = tr.delete(from, to).insert(from - prev.nodeSize, node);
      setHandle({...handle, pos: from - prev.nodeSize});
    } else if (action === 'down') {
      const after = st.doc.nodeAt(to);
      if (!after) return;
      tr = tr.delete(from, to).insert(from + after.nodeSize, node);
      setHandle({...handle, pos: from + after.nodeSize});
    }
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  /* Drag a block by its handle (ProseMirror moves the node on drop). */
  function startDrag(ev: React.DragEvent) {
    if (!editor || !handle) return;
    const {view, state: st} = editor;
    const sel = NodeSelection.create(st.doc, handle.pos);
    view.dispatch(st.tr.setSelection(sel));
    const slice = sel.content();
    const dom = view.nodeDOM(handle.pos) as HTMLElement | null;
    ev.dataTransfer.clearData();
    ev.dataTransfer.setData('text/html', dom?.outerHTML || '');
    ev.dataTransfer.effectAllowed = 'move';
    if (dom) ev.dataTransfer.setDragImage(dom, 0, 0);
    // eslint-disable-next-line react-hooks/immutability -- ProseMirror's drag API: the view reads `dragging` on drop.
    view.dragging = {slice, move: true};
  }

  const slashItems: SlashItem[] = useMemo(() => [
    {label: 'Heading 2', hint: 'Section heading', keys: 'h2 heading title', icon: <Heading2 size={16} />, run: e => e.chain().focus().setNode('heading', {level: 2}).run()},
    {label: 'Heading 3', hint: 'Sub-heading', keys: 'h3 heading subheading', icon: <Heading2 size={14} />, run: e => e.chain().focus().setNode('heading', {level: 3}).run()},
    {label: 'Bulleted list', hint: 'Simple list', keys: 'bullet list ul', icon: <List size={16} />, run: e => e.chain().focus().toggleBulletList().run()},
    {label: 'Numbered list', hint: 'Ordered steps', keys: 'number ordered list ol', icon: <ListOrdered size={16} />, run: e => e.chain().focus().toggleOrderedList().run()},
    {label: 'Checklist', hint: 'Tasks with checkboxes', keys: 'todo task check list', icon: <ListChecks size={16} />, run: e => e.chain().focus().toggleTaskList().run()},
    {label: 'Quote', hint: 'Pull quote', keys: 'quote blockquote', icon: <Quote size={16} />, run: e => e.chain().focus().toggleBlockquote().run()},
    {label: 'Callout', hint: 'Highlighted note', keys: 'callout note alert info tip', icon: <MessageSquareQuote size={16} />, run: e => e.chain().focus().insertCallout('note').run()},
    {label: 'Alert (warning)', hint: 'Warning box', keys: 'alert warning', icon: <MessageSquareQuote size={16} />, run: e => e.chain().focus().insertCallout('warning').run()},
    {label: 'Image', hint: 'Upload or choose', keys: 'image picture photo', icon: <ImagePlus size={16} />, run: () => setDialog({kind: 'image'})},
    {label: 'Gallery', hint: 'Several images', keys: 'gallery images grid', icon: <Images size={16} />, run: () => setDialog({kind: 'gallery'})},
    {label: 'Video upload', hint: 'MP4 or WebM', keys: 'video upload mp4', icon: <Film size={16} />, run: () => setDialog({kind: 'video'})},
    {label: 'YouTube / Vimeo', hint: 'Link or embed code', keys: 'youtube vimeo embed video', icon: <Youtube size={16} />, run: () => setDialog({kind: 'embed'})},
    {label: 'Table', hint: '3 × 3 with header', keys: 'table grid', icon: <Table2 size={16} />, run: e => e.chain().focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run()},
    {label: 'Comparison table', hint: 'Plans side by side', keys: 'comparison compare table plans', icon: <Table2 size={16} />, run: e => { e.chain().focus().insertTable({rows: 4, cols: 3, withHeaderRow: true}).updateAttributes('table', {variant: 'comparison'}).run(); }},
    {label: 'Two columns', hint: 'Side-by-side', keys: 'columns two layout', icon: <Columns3 size={16} />, run: e => e.chain().focus().insertColumns(2).run()},
    {label: 'Three columns', hint: 'Side-by-side', keys: 'columns three layout', icon: <Columns3 size={16} />, run: e => e.chain().focus().insertColumns(3).run()},
    {label: 'Colored section', hint: 'Background block', keys: 'section background band', icon: <SquareStack size={16} />, run: e => e.chain().focus().insertSection('#F7F4ED').run()},
    {label: 'Accordion', hint: 'Show/hide details', keys: 'accordion faq details toggle', icon: <PanelTop size={16} />, run: e => e.chain().focus().setDetails().run()},
    {label: 'Chart', hint: 'Bar, line, pie', keys: 'chart graph bar line pie', icon: <BarChart3 size={16} />, run: () => setDialog({kind: 'chart'})},
    {label: 'Diagram', hint: 'Flowchart, timeline', keys: 'diagram flowchart mermaid flow', icon: <Workflow size={16} />, run: () => setDialog({kind: 'diagram'})},
    {label: 'Code block', hint: 'Monospace', keys: 'code pre', icon: <Code size={16} />, run: e => e.chain().focus().toggleCodeBlock().run()},
    {label: 'Divider', hint: 'Horizontal line', keys: 'divider hr line separator', icon: <Minus size={16} />, run: e => e.chain().focus().setHorizontalRule().run()},
  ], []);
  const filtered = slash ? slashItems.filter(i => !slash.query || (i.label + ' ' + i.keys).toLowerCase().includes(slash.query)) : [];

  function runSlash(item: SlashItem) {
    if (!editor) return;
    const {$from} = editor.state.selection;
    editor.chain().focus().deleteRange({from: $from.start(), to: $from.pos}).run();
    setSlash(null);
    item.run(editor);
  }

  useEffect(() => {
    if (!slash || !filtered.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlash(s => s && {...s, index: (s.index + 1) % filtered.length}); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSlash(s => s && {...s, index: (s.index - 1 + filtered.length) % filtered.length}); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); runSlash(filtered[Math.min(slash.index, filtered.length - 1)]); }
      else if (e.key === 'Escape') setSlash(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && wrap.current?.contains(document.activeElement)) { e.preventDefault(); setFindOpen(true); }
      if (e.key === 'Escape' && fullscreen) setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  async function importDocx(file: File) {
    if (!editor) return;
    setUploading('Importing ' + file.name + '…');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await request<{html: string; title: string; warnings: string[]; notes: string[]}>('/admin/blog-studio/import/docx', {method: 'POST', body: form});
      const empty = editor.isEmpty;
      if (empty) editor.commands.setContent(res.html); else editor.chain().focus().insertContent(res.html).run();
      onImportReport({title: 'Imported "' + file.name + '"', notes: [...res.notes, ...res.warnings.map(w => 'Word: ' + w)]});
    } catch (e) { onUploadError(e instanceof Error ? e.message : 'Import failed'); }
    finally { setUploading(null); }
  }

  if (!editor || !state) return <div className="bs-loading">Loading the editor…</div>;
  const c = editor.chain().focus();

  const pick = (items: MediaItem[]) => {
    const d = dialog;
    setDialog(null);
    if (!d) return;
    if (d.kind === 'replace-image' && d.pos !== undefined) { editor.chain().focus().setNodeSelection(d.pos).updateAttributes('figureImage', {src: items[0].url, alt: items[0].alt || state.atomAttrs?.alt || ''}).run(); return; }
    if (d.kind === 'video') items.forEach(v => editor.chain().focus().insertVideo({src: v.url}).run());
    else if (d.kind === 'gallery' || items.length > 2) editor.chain().focus().insertGallery(items.map(i => ({src: i.url, alt: i.alt})), Math.min(4, Math.max(2, items.length === 4 ? 2 : 3))).run();
    else items.forEach(i => editor.chain().focus().insertFigure({src: i.url, alt: i.alt || ''}).run());
  };
  const atomPos = editor.state.selection instanceof NodeSelection ? editor.state.selection.from : -1;

  return (
    <div className={'bs-editor' + (fullscreen ? ' is-fullscreen' : '')} ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHandle(null)}>
      <div className="bs-toolbar" role="toolbar" aria-label="Formatting">
        <select className="bs-select" aria-label="Text style" value={state.heading ? 'h' + state.heading : 'p'} onChange={e => { const v = e.target.value; if (v === 'p') c.setParagraph().run(); else c.setHeading({level: Number(v.slice(1)) as 1}).run(); }}>
          <option value="p">Paragraph</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option><option value="h5">Heading 5</option><option value="h6">Heading 6</option><option value="h1">Heading 1 (title)</option>
        </select>
        <select className="bs-select is-narrow" aria-label="Font size" value={state.fontSize} onChange={e => (e.target.value ? c.setFontSize(e.target.value).run() : c.unsetFontSize().run())}>
          <option value="">Size</option>{FONT_SIZES.map(s => <option key={s} value={s}>{s.replace('px', '')}</option>)}
        </select>
        <span className="bs-sep" />
        <B label="Bold (Ctrl+B)" on={state.bold} onClick={() => c.toggleBold().run()}><Bold size={16} /></B>
        <B label="Italic (Ctrl+I)" on={state.italic} onClick={() => c.toggleItalic().run()}><Italic size={16} /></B>
        <B label="Underline (Ctrl+U)" on={state.underline} onClick={() => c.toggleUnderline().run()}><Underline size={16} /></B>
        <B label="Strikethrough" on={state.strike} onClick={() => c.toggleStrike().run()}><Strikethrough size={16} /></B>
        <B label="Inline code" on={state.code} onClick={() => c.toggleCode().run()}><Code size={16} /></B>
        <B label="Subscript" on={state.sub} onClick={() => c.toggleSubscript().run()}><SubIcon size={16} /></B>
        <B label="Superscript" on={state.sup} onClick={() => c.toggleSuperscript().run()}><SupIcon size={16} /></B>
        <B label="Link (Ctrl+K)" on={state.link} onClick={() => setDialog({kind: 'link'})}><Link2 size={16} /></B>
        <ColorMenu label="Text color" icon={<Palette size={16} />} colors={TEXT_COLORS} onPick={v => (v ? c.setColor(v).run() : c.unsetColor().run())} />
        <ColorMenu label="Highlight" icon={<Highlighter size={16} />} colors={BG_COLORS} onPick={v => (v ? c.setHighlight({color: v}).run() : c.unsetHighlight().run())} />
        <B label="Clear formatting" onClick={() => c.unsetAllMarks().clearNodes().run()}><Eraser size={16} /></B>
        <span className="bs-sep" />
        <B label="Align left" on={state.align === 'left'} onClick={() => c.setTextAlign('left').run()}><AlignLeft size={16} /></B>
        <B label="Align center" on={state.align === 'center'} onClick={() => c.setTextAlign('center').run()}><AlignCenter size={16} /></B>
        <B label="Align right" on={state.align === 'right'} onClick={() => c.setTextAlign('right').run()}><AlignRight size={16} /></B>
        <B label="Justify" on={state.align === 'justify'} onClick={() => c.setTextAlign('justify').run()}><AlignJustify size={16} /></B>
        <span className="bs-sep" />
        <B label="Bulleted list" on={state.bullet} onClick={() => c.toggleBulletList().run()}><List size={16} /></B>
        <B label="Numbered list" on={state.ordered} onClick={() => c.toggleOrderedList().run()}><ListOrdered size={16} /></B>
        <B label="Checklist" on={state.task} onClick={() => c.toggleTaskList().run()}><ListChecks size={16} /></B>
        <B label="Quote" on={state.quote} onClick={() => c.toggleBlockquote().run()}><Quote size={16} /></B>
        <span className="bs-sep" />
        <B label="Image" onClick={() => setDialog({kind: 'image'})}><ImagePlus size={16} /></B>
        <B label="Gallery" onClick={() => setDialog({kind: 'gallery'})}><Images size={16} /></B>
        <B label="Video upload" onClick={() => setDialog({kind: 'video'})}><Film size={16} /></B>
        <B label="YouTube or Vimeo" onClick={() => setDialog({kind: 'embed'})}><Youtube size={16} /></B>
        <B label="Table" onClick={() => c.insertTable({rows: 3, cols: 3, withHeaderRow: true}).run()}><Table2 size={16} /></B>
        <B label="Chart" onClick={() => setDialog({kind: 'chart'})}><BarChart3 size={16} /></B>
        <B label="Diagram" onClick={() => setDialog({kind: 'diagram'})}><Workflow size={16} /></B>
        <B label="Callout" onClick={() => c.insertCallout('note').run()}><MessageSquareQuote size={16} /></B>
        <B label="Columns" onClick={() => c.insertColumns(2).run()}><Columns3 size={16} /></B>
        <B label="Accordion" onClick={() => c.setDetails().run()}><PanelTop size={16} /></B>
        <B label="Divider" onClick={() => c.setHorizontalRule().run()}><Minus size={16} /></B>
        <span className="bs-sep" />
        <B label="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => c.undo().run()}><Undo2 size={16} /></B>
        <B label="Redo (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={() => c.redo().run()}><Redo2 size={16} /></B>
        <B label="Find and replace (Ctrl+F)" on={findOpen} onClick={() => setFindOpen(v => !v)}><Search size={16} /></B>
        <B label="Import Word .docx" onClick={() => docxInput.current?.click()}><FileUp size={16} /></B>
        <B label={fullscreen ? 'Exit full screen (Esc)' : 'Distraction-free'} on={fullscreen} onClick={() => setFullscreen(v => !v)}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</B>
        <input ref={docxInput} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importDocx(f); }} />
      </div>

      {state.table && <div className="bs-context" role="toolbar" aria-label="Table">
        <strong>Table</strong>
        <button type="button" onClick={() => c.addRowBefore().run()}>Row above</button><button type="button" onClick={() => c.addRowAfter().run()}>Row below</button><button type="button" onClick={() => c.deleteRow().run()}>Delete row</button>
        <button type="button" onClick={() => c.addColumnBefore().run()}>Column left</button><button type="button" onClick={() => c.addColumnAfter().run()}>Column right</button><button type="button" onClick={() => c.deleteColumn().run()}>Delete column</button>
        <button type="button" onClick={() => c.mergeOrSplit().run()}>Merge / split cells</button>
        <button type="button" onClick={() => c.toggleHeaderRow().run()}>Header row</button><button type="button" onClick={() => c.toggleHeaderColumn().run()}>Header column</button>
        <ColorMenu label="Cell color" icon={<span className="bs-swatch" style={{background: state.cellBg || '#fff'}} />} colors={BG_COLORS} onPick={v => c.setCellAttribute('background', v || null).run()} />
        <button type="button" aria-pressed={state.tableVariant === 'comparison'} onClick={() => c.updateAttributes('table', {variant: state.tableVariant === 'comparison' ? null : 'comparison'}).run()}>Comparison style</button>
        <button type="button" className="is-danger" onClick={() => c.deleteTable().run()}>Delete table</button>
      </div>}

      {state.atom && atomPos >= 0 && <div className="bs-context" role="toolbar" aria-label="Block settings">
        {state.atom === 'figureImage' && <>
          <strong>Image</strong>
          {['left', 'center', 'right', 'wide', 'full'].map(a => <button type="button" key={a} aria-pressed={state.atomAttrs?.align === a} onClick={() => c.updateAttributes('figureImage', {align: a}).run()}>{a === 'center' ? 'Center' : a[0].toUpperCase() + a.slice(1)}</button>)}
          <select aria-label="Image width" value={state.atomAttrs?.width || '100'} onChange={e => c.updateAttributes('figureImage', {width: e.target.value}).run()}><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option></select>
          <input aria-label="Alt text" placeholder="Alt text (describe the image)" value={state.atomAttrs?.alt || ''} onChange={e => editor.chain().updateAttributes('figureImage', {alt: e.target.value}).run()} />
          <input aria-label="Caption" placeholder="Caption" value={state.atomAttrs?.caption || ''} onChange={e => editor.chain().updateAttributes('figureImage', {caption: e.target.value}).run()} />
          <input aria-label="Image link" placeholder="Link (optional)" value={state.atomAttrs?.href || ''} onChange={e => editor.chain().updateAttributes('figureImage', {href: e.target.value}).run()} />
          <button type="button" onClick={() => setDialog({kind: 'replace-image', pos: atomPos})}>Replace</button>
        </>}
        {state.atom === 'gallery' && <><strong>Gallery</strong>{[2, 3, 4].map(n => <button type="button" key={n} aria-pressed={String(state.atomAttrs?.columns) === String(n)} onClick={() => c.updateAttributes('gallery', {columns: String(n)}).run()}>{n} columns</button>)}<span className="bs-muted">{(state.atomAttrs?.images || []).length} images</span></>}
        {state.atom === 'video' && <><strong>Video</strong><input aria-label="Caption" placeholder="Caption" value={state.atomAttrs?.caption || ''} onChange={e => editor.chain().updateAttributes('video', {caption: e.target.value}).run()} /><input aria-label="Poster image URL" placeholder="Poster image URL (optional)" value={state.atomAttrs?.poster || ''} onChange={e => editor.chain().updateAttributes('video', {poster: e.target.value}).run()} /></>}
        {state.atom === 'embed' && <><strong>{state.atomAttrs?.provider === 'vimeo' ? 'Vimeo' : 'YouTube'}</strong><input aria-label="Caption" placeholder="Caption / title" value={state.atomAttrs?.caption || ''} onChange={e => editor.chain().updateAttributes('embed', {caption: e.target.value}).run()} /></>}
        {state.atom === 'chart' && <><strong>Chart</strong><button type="button" onClick={() => setDialog({kind: 'chart', pos: atomPos})}>Edit data</button></>}
        {state.atom === 'diagram' && <><strong>Diagram</strong><button type="button" onClick={() => setDialog({kind: 'diagram', pos: atomPos})}>Edit diagram</button></>}
        {['callout', 'section', 'columns'].includes(state.atom) && <strong>{state.atom}</strong>}
        <button type="button" className="is-danger" onClick={() => c.deleteSelection().run()}><Trash2 size={14} /> Remove</button>
      </div>}
      {(editor.isActive('callout') || editor.isActive('section')) && !state.atom && <div className="bs-context" role="toolbar" aria-label="Block style">
        {editor.isActive('callout') && <><strong>Callout</strong>{['note', 'info', 'success', 'warning', 'danger', 'highlight'].map(v => <button type="button" key={v} aria-pressed={editor.getAttributes('callout').variant === v} onClick={() => c.updateAttributes('callout', {variant: v}).run()}>{v[0].toUpperCase() + v.slice(1)}</button>)}</>}
        {editor.isActive('section') && <><strong>Section</strong><ColorMenu label="Section background" icon={<span className="bs-swatch" style={{background: editor.getAttributes('section').background}} />} colors={BG_COLORS} onPick={v => c.updateAttributes('section', {background: v || '#F7F4ED'}).run()} /></>}
      </div>}

      {findOpen && <FindReplace editor={editor} onClose={() => setFindOpen(false)} />}
      {uploading && <p className="bs-uploading" role="status">{uploading}</p>}

      <BubbleMenu editor={editor} shouldShow={({editor: e, state: s}) => !s.selection.empty && !(s.selection instanceof NodeSelection) && !e.isActive('codeBlock')} className="bs-bubble">
        <B label="Bold" on={state.bold} onClick={() => c.toggleBold().run()}><Bold size={15} /></B>
        <B label="Italic" on={state.italic} onClick={() => c.toggleItalic().run()}><Italic size={15} /></B>
        <B label="Underline" on={state.underline} onClick={() => c.toggleUnderline().run()}><Underline size={15} /></B>
        <B label="Link" on={state.link} onClick={() => setDialog({kind: 'link'})}><Link2 size={15} /></B>
        <ColorMenu label="Text color" icon={<Palette size={15} />} colors={TEXT_COLORS} onPick={v => (v ? c.setColor(v).run() : c.unsetColor().run())} />
        <ColorMenu label="Highlight" icon={<Highlighter size={15} />} colors={BG_COLORS} onPick={v => (v ? c.setHighlight({color: v}).run() : c.unsetHighlight().run())} />
        <B label="Heading 2" on={state.heading === 2} onClick={() => c.toggleHeading({level: 2}).run()}><Heading2 size={15} /></B>
      </BubbleMenu>

      <div className="bs-canvas-wrap">
        {handle && <div className="bs-handle" style={{top: handle.top}}>
          <button type="button" draggable onDragStart={startDrag} className="bs-grip" aria-label="Drag to move block (or click to select)" title="Drag to move · click to select" onClick={() => blockAction('select')}><GripVertical size={16} /></button>
          <div className="bs-handle-menu">
            <button type="button" aria-label="Move block up" onClick={() => blockAction('up')}><ChevronUp size={14} /></button>
            <button type="button" aria-label="Move block down" onClick={() => blockAction('down')}><ChevronDown size={14} /></button>
            <button type="button" aria-label="Duplicate block" onClick={() => blockAction('duplicate')}><Copy size={14} /></button>
            <button type="button" aria-label="Delete block" onClick={() => blockAction('delete')}><Trash2 size={14} /></button>
          </div>
        </div>}
        <EditorContent editor={editor} />
        {slash && filtered.length > 0 && <ul className="bs-slash" role="listbox" aria-label="Insert block" style={{top: slash.top, left: Math.max(0, slash.left)}}>
          {filtered.map((item, i) => <li key={item.label} role="option" aria-selected={i === slash.index}><button type="button" onMouseDown={e => { e.preventDefault(); runSlash(item); }}>{item.icon}<span><strong>{item.label}</strong><small>{item.hint}</small></span></button></li>)}
        </ul>}
      </div>
      <div className="bs-status-bar"><span>{state.words.toLocaleString()} words · {state.chars.toLocaleString()} characters · about {Math.max(1, Math.round(state.words / 220))} min read</span><span>Type <kbd>/</kbd> for blocks · paste from Word or Google Docs · drop images to upload</span></div>

      {(dialog?.kind === 'image' || dialog?.kind === 'replace-image') && <MediaDialog onClose={() => setDialog(null)} onSelect={pick} multiple={dialog.kind === 'image'} />}
      {dialog?.kind === 'gallery' && <MediaDialog onClose={() => setDialog(null)} onSelect={pick} multiple title="Create a gallery" />}
      {dialog?.kind === 'video' && <MediaDialog onClose={() => setDialog(null)} onSelect={pick} multiple accept="video" />}
      {dialog?.kind === 'embed' && <EmbedDialog onClose={() => setDialog(null)} onInsert={a => { setDialog(null); c.insertEmbed(a).run(); }} />}
      {dialog?.kind === 'link' && <TextDialog title="Link" label="Address (https://…, /page/ or mailto:)" initial={editor.getAttributes('link').href || ''} placeholder="https://" onClose={() => setDialog(null)}
        validate={v => (!v.trim() || /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(v.trim()) ? null : 'Use an https address, a site path like /coworking/, or mailto:')}
        onSave={v => { setDialog(null); if (!v) c.extendMarkRange('link').unsetLink().run(); else c.extendMarkRange('link').setLink({href: v, target: /^https?:\/\//.test(v) ? '_blank' : null}).run(); }} />}
      {dialog?.kind === 'chart' && <ChartDialog initial={dialog.pos !== undefined ? {spec: state.atomAttrs?.spec, caption: state.atomAttrs?.caption} : undefined} onClose={() => setDialog(null)} onSave={(spec, caption) => { const p = dialog.pos; setDialog(null); if (p !== undefined) c.setNodeSelection(p).updateAttributes('chart', {spec, caption}).run(); else c.insertChart(spec, caption).run(); }} />}
      {dialog?.kind === 'diagram' && <DiagramDialog initial={dialog.pos !== undefined ? {code: state.atomAttrs?.code, caption: state.atomAttrs?.caption} : undefined} onClose={() => setDialog(null)} onSave={(code, caption) => { const p = dialog.pos; setDialog(null); if (p !== undefined) c.setNodeSelection(p).updateAttributes('diagram', {code, caption}).run(); else c.insertDiagram(code, caption).run(); }} />}
    </div>
  );
}

function B({on, label, onClick, children, disabled}: {on?: boolean; label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean}) {
  return <button type="button" className={'bs-tool' + (on ? ' is-on' : '')} aria-label={label} title={label} aria-pressed={on} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>;
}

function summary(r: PasteReport): string[] {
  const kept = [r.lists && r.lists + ' list(s)', r.tables && r.tables + ' table(s)', r.images && r.images + ' web image(s)'].filter(Boolean);
  return [...(kept.length ? ['Kept: ' + kept.join(', ') + '.'] : []), ...r.notes];
}

function ColorMenu({label, icon, colors, onPick}: {label: string; icon: React.ReactNode; colors: string[]; onPick: (v: string | null) => void}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="bs-color">
      <button type="button" className="bs-tool" aria-label={label} title={label} aria-expanded={open} onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)}>{icon}</button>
      {open && <span className="bs-color-pop" role="menu" aria-label={label}>
        {colors.map(col => <button type="button" key={col} role="menuitem" aria-label={col} style={{background: col}} onMouseDown={e => e.preventDefault()} onClick={() => { onPick(col); setOpen(false); }} />)}
        <label className="bs-color-custom" title="Custom color"><input type="color" onChange={e => { onPick(e.target.value); setOpen(false); }} />+</label>
        <button type="button" role="menuitem" className="bs-color-none" onMouseDown={e => e.preventDefault()} onClick={() => { onPick(null); setOpen(false); }}>None</button>
      </span>}
    </span>
  );
}

function FindReplace({editor, onClose}: {editor: Editor; onClose: () => void}) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCase] = useState(false);
  const matches = useMemo(() => {
    const out: Array<{from: number; to: number}> = [];
    if (!find) return out;
    const needle = caseSensitive ? find : find.toLowerCase();
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const hay = caseSensitive ? node.text : node.text.toLowerCase();
      let i = hay.indexOf(needle);
      while (i >= 0) { out.push({from: pos + i, to: pos + i + find.length}); i = hay.indexOf(needle, i + Math.max(1, find.length)); }
    });
    return out;
  }, [find, caseSensitive, editor.state.doc]);
  const [cursor, setCursor] = useState(0);
  const go = (i: number) => {
    if (!matches.length) return;
    const m = matches[(i + matches.length) % matches.length];
    setCursor((i + matches.length) % matches.length);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView());
  };
  const replaceOne = () => { const m = matches[cursor]; if (!m) return; editor.chain().focus().insertContentAt({from: m.from, to: m.to}, replace).run(); };
  const replaceAll = () => {
    let tr = editor.state.tr;
    [...matches].reverse().forEach(m => { tr = tr.insertText(replace, m.from, m.to); });
    editor.view.dispatch(tr);
  };
  return (
    <div className="bs-find" role="search">
      <input aria-label="Find" placeholder="Find" value={find} autoFocus onChange={e => { setFind(e.target.value); setCursor(0); }} onKeyDown={e => { if (e.key === 'Enter') go(cursor + (e.shiftKey ? -1 : 1)); if (e.key === 'Escape') onClose(); }} />
      <input aria-label="Replace with" placeholder="Replace with" value={replace} onChange={e => setReplace(e.target.value)} />
      <span className="bs-muted">{find ? (matches.length ? (cursor + 1) + ' of ' + matches.length : 'No matches') : ''}</span>
      <label className="bs-check"><input type="checkbox" checked={caseSensitive} onChange={e => setCase(e.target.checked)} /> Match case</label>
      <button type="button" onClick={() => go(cursor - 1)} disabled={!matches.length}>Previous</button>
      <button type="button" onClick={() => go(cursor + 1)} disabled={!matches.length}>Next</button>
      <button type="button" onClick={replaceOne} disabled={!matches.length}>Replace</button>
      <button type="button" onClick={replaceAll} disabled={!matches.length}>Replace all</button>
      <button type="button" className="bs-icon" aria-label="Close find" onClick={onClose}>×</button>
    </div>
  );
}

export {LayoutGrid};
