/**
 * Block-editor schema. Every node renders to the HTML contract that lib/article/sanitize.ts allows and
 * components/article/article.css styles, so the editor, the preview and the public page agree.
 */
import {Extension, Node, mergeAttributes} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {TextStyleKit} from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {Table, TableRow, TableHeader, TableCell} from '@tiptap/extension-table';
import {TaskList, TaskItem} from '@tiptap/extension-list';
import {Details, DetailsSummary, DetailsContent} from '@tiptap/extension-details';
import {Placeholder, CharacterCount} from '@tiptap/extensions';
import {parseChart} from '@/lib/article/chart';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wjBlocks: {
      insertFigure: (attrs: {src: string; alt?: string; caption?: string; align?: string; width?: string}) => ReturnType;
      insertGallery: (images: Array<{src: string; alt?: string; caption?: string}>, columns?: number) => ReturnType;
      insertVideo: (attrs: {src: string; poster?: string; caption?: string}) => ReturnType;
      insertEmbed: (attrs: {src: string; provider: string; caption?: string}) => ReturnType;
      insertCallout: (variant?: string) => ReturnType;
      insertColumns: (count?: number) => ReturnType;
      insertSection: (background?: string) => ReturnType;
      insertChart: (spec: string, caption?: string) => ReturnType;
      insertDiagram: (code: string, caption?: string) => ReturnType;
    };
  }
}

const attr = (name: string, fallback: unknown = null) => ({default: fallback, parseHTML: (el: HTMLElement) => el.getAttribute('data-' + name) ?? fallback, renderHTML: (a: Record<string, unknown>) => (a[name] === null || a[name] === undefined || a[name] === '' ? {} : {['data-' + name]: a[name]})});

/** Image with caption, alignment (left/center/right/wide/full) and width (50/75/100). */
export const Figure = Node.create({
  name: 'figureImage', group: 'block', atom: true, draggable: true, selectable: true,
  addAttributes: () => ({
    src: {default: ''}, alt: {default: ''}, caption: {default: ''}, href: {default: ''},
    align: attr('align', 'center'), width: attr('width', '100'),
  }),
  parseHTML: () => [
    {tag: 'figure[data-type="image"]', getAttrs: el => {
      const e = el as HTMLElement, img = e.querySelector('img');
      return {src: img?.getAttribute('src') || '', alt: img?.getAttribute('alt') || '', caption: e.querySelector('figcaption')?.textContent || '', href: e.querySelector('a')?.getAttribute('href') || '', align: e.getAttribute('data-align') || 'center', width: e.getAttribute('data-width') || '100'};
    }},
    /* Plain images (Word paste, legacy HTML) become figures too. */
    {tag: 'img[src]', getAttrs: el => ({src: (el as HTMLElement).getAttribute('src') || '', alt: (el as HTMLElement).getAttribute('alt') || ''})},
  ],
  renderHTML: ({node}) => {
    const img = ['img', {src: node.attrs.src, alt: node.attrs.alt || '', loading: 'lazy', decoding: 'async'}];
    return ['figure', {'data-type': 'image', 'data-align': node.attrs.align || 'center', 'data-width': node.attrs.width || '100'},
      node.attrs.href ? ['a', {href: node.attrs.href}, img] : img,
      ...(node.attrs.caption ? [['figcaption', {}, node.attrs.caption]] : [])];
  },
});

export const Gallery = Node.create({
  name: 'gallery', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({images: {default: [] as Array<{src: string; alt?: string; caption?: string}>}, columns: attr('columns', '3')}),
  parseHTML: () => [{tag: 'div[data-type="gallery"]', getAttrs: el => ({columns: (el as HTMLElement).getAttribute('data-columns') || '3', images: Array.from((el as HTMLElement).querySelectorAll('figure')).map(f => ({src: f.querySelector('img')?.getAttribute('src') || '', alt: f.querySelector('img')?.getAttribute('alt') || '', caption: f.querySelector('figcaption')?.textContent || ''})).filter(i => i.src)})}],
  renderHTML: ({node}) => ['div', {'data-type': 'gallery', 'data-columns': String(node.attrs.columns || 3)},
    ...(node.attrs.images as Array<{src: string; alt?: string; caption?: string}>).map(i => ['figure', {}, ['img', {src: i.src, alt: i.alt || '', loading: 'lazy'}], ...(i.caption ? [['figcaption', {}, i.caption]] : [])])],
});

export const Video = Node.create({
  name: 'video', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({src: {default: ''}, poster: {default: ''}, caption: {default: ''}}),
  parseHTML: () => [{tag: 'figure[data-type="video"]', getAttrs: el => { const v = (el as HTMLElement).querySelector('video'); return {src: v?.getAttribute('src') || v?.querySelector('source')?.getAttribute('src') || '', poster: v?.getAttribute('poster') || '', caption: (el as HTMLElement).querySelector('figcaption')?.textContent || ''}; }}, {tag: 'video[src]', getAttrs: el => ({src: (el as HTMLElement).getAttribute('src')})}],
  renderHTML: ({node}) => ['figure', {'data-type': 'video'}, ['video', {src: node.attrs.src, controls: 'controls', preload: 'metadata', playsinline: 'playsinline', ...(node.attrs.poster ? {poster: node.attrs.poster} : {})}], ...(node.attrs.caption ? [['figcaption', {}, node.attrs.caption]] : [])],
});

/** Turns a YouTube/Vimeo URL or iframe embed code into an allowlisted player URL. Null when not supported. */
export function embedFromInput(input: string): {src: string; provider: string} | null {
  const raw = String(input || '').trim();
  const fromIframe = /<iframe[^>]+src=["']([^"']+)["']/i.exec(raw)?.[1];
  const value = (fromIframe || raw).replace(/&amp;/g, '&');
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'youtube-nocookie.com'].includes(host)) id = url.searchParams.get('v') || (/^\/(embed|shorts|live)\/([\w-]+)/.exec(url.pathname)?.[2] ?? '');
  if (id && /^[\w-]{6,20}$/.test(id)) {
    const start = Number(url.searchParams.get('t')?.replace(/s$/, '') || url.searchParams.get('start') || 0);
    return {src: 'https://www.youtube-nocookie.com/embed/' + id + (start > 0 ? '?start=' + Math.trunc(start) : ''), provider: 'youtube'};
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const vid = /(\d{4,15})/.exec(url.pathname)?.[1];
    if (vid) return {src: 'https://player.vimeo.com/video/' + vid, provider: 'vimeo'};
  }
  return null;
}

export const Embed = Node.create({
  name: 'embed', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({src: {default: ''}, provider: {default: 'youtube'}, caption: {default: ''}}),
  parseHTML: () => [
    {tag: 'figure[data-type="embed"]', getAttrs: el => { const s = (el as HTMLElement).querySelector('iframe')?.getAttribute('src') || ''; const e = embedFromInput(s); return e ? {...e, caption: (el as HTMLElement).querySelector('figcaption')?.textContent || ''} : false; }},
    {tag: 'div[data-youtube-video]', getAttrs: el => { const e = embedFromInput((el as HTMLElement).querySelector('iframe')?.getAttribute('src') || ''); return e || false; }},
    {tag: 'iframe[src]', getAttrs: el => embedFromInput((el as HTMLElement).getAttribute('src') || '') || false},
  ],
  renderHTML: ({node}) => ['figure', {'data-type': 'embed', 'data-provider': node.attrs.provider}, ['div', {class: 'wj-embed-frame'}, ['iframe', {src: node.attrs.src, title: node.attrs.caption || (node.attrs.provider === 'vimeo' ? 'Vimeo video' : 'YouTube video'), allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share', allowfullscreen: 'true', loading: 'lazy'}]], ...(node.attrs.caption ? [['figcaption', {}, node.attrs.caption]] : [])],
});

export const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true, draggable: true,
  addAttributes: () => ({variant: attr('variant', 'note')}),
  parseHTML: () => [{tag: 'div[data-type="callout"]'}],
  renderHTML: ({HTMLAttributes}) => ['div', mergeAttributes(HTMLAttributes, {'data-type': 'callout'}), 0],
});

export const Section = Node.create({
  name: 'section', group: 'block', content: 'block+', defining: true, draggable: true,
  addAttributes: () => ({background: {default: '#F7F4ED', parseHTML: el => (el as HTMLElement).style.backgroundColor || (el as HTMLElement).getAttribute('data-background') || '#F7F4ED', renderHTML: a => ({style: 'background-color: ' + a.background, 'data-background': a.background})}}),
  parseHTML: () => [{tag: 'section[data-type="section"]'}],
  renderHTML: ({HTMLAttributes}) => ['section', mergeAttributes(HTMLAttributes, {'data-type': 'section'}), 0],
});

export const Column = Node.create({
  name: 'column', content: 'block+', isolating: true, defining: true,
  parseHTML: () => [{tag: 'div[data-type="column"]'}],
  renderHTML: ({HTMLAttributes}) => ['div', mergeAttributes(HTMLAttributes, {'data-type': 'column'}), 0],
});
export const Columns = Node.create({
  name: 'columns', group: 'block', content: 'column{2,4}', defining: true, draggable: true,
  addAttributes: () => ({columns: attr('columns', '2')}),
  parseHTML: () => [{tag: 'div[data-type="columns"]'}],
  renderHTML: ({node, HTMLAttributes}) => ['div', mergeAttributes(HTMLAttributes, {'data-type': 'columns', 'data-columns': String(node.childCount)}), 0],
});

export const Chart = Node.create({
  name: 'chart', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({spec: {default: '{}'}, caption: {default: ''}}),
  parseHTML: () => [{tag: 'figure[data-type="chart"]', getAttrs: el => ({spec: (el as HTMLElement).getAttribute('data-chart') || '{}', caption: (el as HTMLElement).querySelector('figcaption')?.textContent || ''})}],
  renderHTML: ({node}) => {
    const spec = parseChart(node.attrs.spec);
    /* The stored HTML keeps an accessible data table; the SVG is drawn at render time. */
    const table = spec ? ['table', {}, ['thead', {}, ['tr', {}, ['th', {}, ''], ...spec.datasets.map(d => ['th', {}, d.label || 'Value'])]], ['tbody', {}, ...spec.labels.map((l, i) => ['tr', {}, ['th', {}, l], ...spec.datasets.map(d => ['td', {}, String(d.data[i])])])]] : ['p', {}, 'Chart'];
    return ['figure', {'data-type': 'chart', 'data-chart': node.attrs.spec}, table, ...(node.attrs.caption ? [['figcaption', {}, node.attrs.caption]] : [])];
  },
});

export const Diagram = Node.create({
  name: 'diagram', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({code: {default: 'flowchart LR\n  A[Start] --> B[Finish]'}, caption: {default: ''}}),
  parseHTML: () => [{tag: 'div[data-type="mermaid"]', getAttrs: el => ({code: (el as HTMLElement).getAttribute('data-code') || (el as HTMLElement).textContent || ''})}],
  renderHTML: ({node}) => ['div', {'data-type': 'mermaid', 'data-code': node.attrs.code, 'aria-label': node.attrs.caption || 'Diagram'}, node.attrs.code],
});

/** Table cells keep Word/spreadsheet shading and borders. */
const cellAttrs = {
  background: {default: null, parseHTML: (el: HTMLElement) => el.style.backgroundColor || el.getAttribute('bgcolor') || null, renderHTML: (a: Record<string, unknown>) => (a.background ? {style: 'background-color: ' + a.background} : {})},
  align: {default: null, parseHTML: (el: HTMLElement) => el.style.textAlign || null, renderHTML: (a: Record<string, unknown>) => (a.align ? {style: 'text-align: ' + a.align} : {})},
};
export const WjTableCell = TableCell.extend({addAttributes() { return {...this.parent?.(), ...cellAttrs}; }});
export const WjTableHeader = TableHeader.extend({addAttributes() { return {...this.parent?.(), ...cellAttrs}; }});
export const WjTable = Table.extend({
  addAttributes() { return {...this.parent?.(), variant: {default: null, parseHTML: el => (el as HTMLElement).getAttribute('data-variant'), renderHTML: a => (a.variant ? {'data-variant': a.variant} : {})}}; },
});

/** Commands for the custom blocks. */
export const BlockCommands = Extension.create({
  name: 'wjBlocks',
  /* Media blocks are atoms: each insert is followed by an empty paragraph that receives the cursor, so the next insert never replaces the block just added. */
  addCommands() {
    return {
      insertFigure: attrs => ({commands}) => commands.insertContent([{type: 'figureImage', attrs}, {type: 'paragraph'}]),
      insertGallery: (images, columns = 3) => ({commands}) => commands.insertContent([{type: 'gallery', attrs: {images, columns: String(columns)}}, {type: 'paragraph'}]),
      insertVideo: attrs => ({commands}) => commands.insertContent([{type: 'video', attrs}, {type: 'paragraph'}]),
      insertEmbed: attrs => ({commands}) => commands.insertContent([{type: 'embed', attrs}, {type: 'paragraph'}]),
      insertCallout: (variant = 'note') => ({commands}) => commands.insertContent({type: 'callout', attrs: {variant}, content: [{type: 'paragraph', content: [{type: 'text', text: 'Write something worth noticing.'}]}]}),
      insertColumns: (count = 2) => ({commands}) => commands.insertContent({type: 'columns', attrs: {columns: String(count)}, content: Array.from({length: count}, (_, i) => ({type: 'column', content: [{type: 'paragraph', content: [{type: 'text', text: 'Column ' + (i + 1)}]}]}))}),
      insertSection: (background = '#F7F4ED') => ({commands}) => commands.insertContent({type: 'section', attrs: {background}, content: [{type: 'heading', attrs: {level: 3}, content: [{type: 'text', text: 'Section heading'}]}, {type: 'paragraph', content: [{type: 'text', text: 'Section text.'}]}]}),
      insertChart: (spec, caption = '') => ({commands}) => commands.insertContent([{type: 'chart', attrs: {spec, caption}}, {type: 'paragraph'}]),
      insertDiagram: (code, caption = '') => ({commands}) => commands.insertContent([{type: 'diagram', attrs: {code, caption}}, {type: 'paragraph'}]),
    };
  },
});

export function editorExtensions(placeholder = 'Write your story, or press “/” for blocks…') {
  return [
    StarterKit.configure({heading: {levels: [1, 2, 3, 4, 5, 6]}, link: {openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: {rel: 'noopener noreferrer'}}, dropcursor: {color: '#D7902A', width: 3}}),
    TextStyleKit.configure({fontFamily: false, lineHeight: false}),
    Highlight.configure({multicolor: true}),
    TextAlign.configure({types: ['heading', 'paragraph']}),
    Subscript, Superscript,
    WjTable.configure({resizable: true, HTMLAttributes: {}}), TableRow, WjTableHeader, WjTableCell,
    TaskList, TaskItem.configure({nested: true}),
    Details.configure({persist: true, HTMLAttributes: {}}), DetailsSummary, DetailsContent,
    Figure, Gallery, Video, Embed, Callout, Section, Column, Columns, Chart, Diagram, BlockCommands,
    Placeholder.configure({placeholder: ({node}) => (node.type.name === 'heading' ? 'Heading' : placeholder), includeChildren: false}),
    CharacterCount,
  ];
}
