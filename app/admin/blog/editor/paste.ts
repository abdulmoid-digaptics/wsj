/**
 * Clipboard clean-up for rich pastes (Microsoft Word, Google Docs, web pages).
 * Word puts lists, highlights and shading in proprietary CSS; this rewrites that into standard HTML the
 * editor schema understands, and reports what could not be carried over (a pasted Word document's
 * images live on the author's disk, and SmartArt/charts are drawing objects, not HTML).
 */
export type PasteReport = {source: 'word' | 'google-docs' | 'html'; lists: number; tables: number; images: number; skippedImages: number; skippedDrawings: number; notes: string[]};

const HIGHLIGHT: Record<string, string> = {yellow: '#FFF59D', green: '#C8E6C9', cyan: '#B2EBF2', magenta: '#F8BBD0', blue: '#BBDEFB', red: '#FFCDD2', darkblue: '#9FA8DA', darkcyan: '#80CBC4', darkgreen: '#A5D6A7', darkmagenta: '#CE93D8', darkred: '#EF9A9A', darkyellow: '#FFE082', gray: '#E0E0E0', lightgray: '#EEEEEE', black: '#424242'};

function styleMap(el: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (el.getAttribute('style') || '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) map.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return map;
}
function writeStyle(el: Element, map: Map<string, string>) {
  const keep = ['color', 'background-color', 'font-size', 'text-align', 'font-weight', 'font-style', 'text-decoration', 'vertical-align', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'width'];
  const out = [...map].filter(([k, v]) => keep.includes(k) && v && !/mso|windowtext|inherit|initial/i.test(v)).map(([k, v]) => k + ': ' + v.replace(/\s*!important/i, ''));
  if (out.length) el.setAttribute('style', out.join('; ')); else el.removeAttribute('style');
}

export function cleanPastedHtml(html: string): {html: string; report: PasteReport} {
  const word = /urn:schemas-microsoft-com:office|class=["']?Mso|mso-/i.test(html);
  const gdocs = /id=["']docs-internal-guid/i.test(html);
  const report: PasteReport = {source: word ? 'word' : gdocs ? 'google-docs' : 'html', lists: 0, tables: 0, images: 0, skippedImages: 0, skippedDrawings: 0, notes: []};
  /* VML drawings (SmartArt, shapes, charts) arrive as conditional comments. */
  report.skippedDrawings = (html.match(/<v:(shape|group|rect|oval|line)\b/gi) || []).length + (html.match(/<!--\[if gte vml/gi) || []).length;
  const cleaned = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?(o|w|m|v|st1):[^>]*>/gi, '');
  const doc = new DOMParser().parseFromString(cleaned, 'text/html');
  const body = doc.body;
  body.querySelectorAll('style, meta, link, script, xml, title').forEach(n => n.remove());

  /* Google Docs wraps everything in a bold tag with font-weight:normal. */
  body.querySelectorAll('b[id^="docs-internal-guid"]').forEach(b => b.replaceWith(...Array.from(b.childNodes)));

  /* Images: only http(s) sources can be kept (and are re-uploaded by the editor). */
  body.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (/^https?:\/\//i.test(src)) { report.images++; return; }
    report.skippedImages++;
    const p = doc.createElement('p');
    p.setAttribute('data-type', 'import-note');
    p.textContent = '[Image from the document was not included: add it with the Image block or import the .docx file]';
    img.replaceWith(p);
  });

  if (word) wordLists(doc, body, report);

  body.querySelectorAll('*').forEach(el => {
    const map = styleMap(el);
    /* Word: background:#xxx / mso-highlight:yellow / mso-shading → background-color */
    const bg = map.get('background') || map.get('background-color') || map.get('mso-shading');
    if (bg && /^#|rgb|^[a-z]+$/i.test(bg) && !/auto|transparent|white|windowtext/i.test(bg)) map.set('background-color', bg.split(' ')[0]);
    const hl = map.get('mso-highlight');
    if (hl && HIGHLIGHT[hl.toLowerCase()]) map.set('background-color', HIGHLIGHT[hl.toLowerCase()]);
    if (map.get('font-weight') === 'normal' && el.tagName === 'B') { el.replaceWith(...Array.from(el.childNodes)); return; }
    if (el.tagName === 'TD' || el.tagName === 'TH') {
      const bgAttr = el.getAttribute('bgcolor');
      if (bgAttr) map.set('background-color', bgAttr);
    }
    writeStyle(el, map);
    for (const a of Array.from(el.attributes)) if (/^(class|lang|align|valign|width|height|border|cellspacing|cellpadding|bgcolor)$/i.test(a.name) && !(el.tagName === 'IMG' && /width|height/i.test(a.name))) {
      if (a.name.toLowerCase() === 'align' && /^(P|H[1-6]|TD|TH)$/.test(el.tagName)) { const m = styleMap(el); m.set('text-align', a.value.toLowerCase()); writeStyle(el, m); }
      el.removeAttribute(a.name);
    }
  });

  /* Colour, highlight and size set on a whole paragraph move onto its text: the editor keeps them as text styles. */
  body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li').forEach(block => {
    const map = styleMap(block);
    const carry = ['color', 'background-color', 'font-size'].filter(k => map.get(k));
    if (!carry.length || !block.childNodes.length) return;
    const span = doc.createElement('span');
    span.setAttribute('style', carry.map(k => k + ': ' + map.get(k)).join('; '));
    span.append(...Array.from(block.childNodes));
    block.appendChild(span);
    carry.forEach(k => map.delete(k));
    writeStyle(block, map);
  });

  /* Word titles and headings. */
  body.querySelectorAll('p').forEach(p => {
    const cls = (p.getAttribute('data-cls') || '');
    if (/MsoTitle/i.test(cls)) { const h = doc.createElement('h1'); h.innerHTML = p.innerHTML; p.replaceWith(h); }
  });
  /* Empty spans and spacer paragraphs Word adds. */
  body.querySelectorAll('span:not([style])').forEach(s => s.replaceWith(...Array.from(s.childNodes)));
  body.querySelectorAll('p').forEach(p => { if (!p.textContent?.replace(/\u00a0/g, '').trim() && !p.querySelector('img')) p.remove(); });
  report.tables = body.querySelectorAll('table').length;
  body.querySelectorAll('table').forEach(t => { if (!t.querySelector('th') && t.rows[0]) { /* keep first row as body; authors can toggle the header row */ } });

  if (report.skippedImages) report.notes.push(report.skippedImages + ' image(s) could not be pasted (Word keeps pasted images on your computer). Use Import .docx to bring images in, or add them with the Image block.');
  if (report.skippedDrawings) report.notes.push(report.skippedDrawings + ' drawing(s), SmartArt or chart object(s) cannot be converted to HTML. Paste them as a picture, or rebuild with the Chart or Diagram block.');
  if (report.source === 'word') report.notes.push('Fonts are replaced by the site font. Colors, highlights, font sizes, lists and table shading were kept where Word provided them.');
  return {html: body.innerHTML, report};
}

/** Word list paragraphs (mso-list: l0 level2 lfo1) → real nested <ul>/<ol>. */
function wordLists(doc: Document, body: HTMLElement, report: PasteReport) {
  const paras = Array.from(body.querySelectorAll('p'));
  for (const p of paras) p.setAttribute('data-cls', p.getAttribute('class') || '');
  let i = 0;
  while (i < paras.length) {
    const p = paras[i];
    const info = listInfo(p);
    if (!info) { i++; continue; }
    report.lists++;
    const root = doc.createElement(info.ordered ? 'ol' : 'ul');
    p.before(root);
    const stack: Array<{level: number; list: HTMLElement}> = [{level: info.level, list: root}];
    while (i < paras.length) {
      const q = paras[i];
      const qi = listInfo(q);
      if (!qi) break;
      /* Stop when the next paragraph is not directly after the previous list item. */
      /* Each consumed paragraph is removed, so a continuing list paragraph sits right after the list. */
      if (q.previousElementSibling !== root) break;
      while (stack.length > 1 && qi.level < stack[stack.length - 1].level) stack.pop();
      let top = stack[stack.length - 1];
      if (qi.level > top.level) {
        const nested = doc.createElement(qi.ordered ? 'ol' : 'ul');
        const parentLi = top.list.lastElementChild || top.list.appendChild(doc.createElement('li'));
        parentLi.appendChild(nested);
        stack.push({level: qi.level, list: nested});
        top = stack[stack.length - 1];
      }
      q.querySelectorAll('span').forEach(s => { if (/mso-list:\s*ignore/i.test(s.getAttribute('style') || '')) s.remove(); });
      const li = doc.createElement('li');
      const para = doc.createElement('p');
      para.innerHTML = q.innerHTML.replace(/^(\s|&nbsp;|\u00a0)+/, '');
      li.appendChild(para);
      top.list.appendChild(li);
      q.remove();
      i++;
    }
  }
}

function listInfo(p: Element): {level: number; ordered: boolean} | null {
  const style = p.getAttribute('style') || '';
  const m = /mso-list:\s*l\d+\s+level(\d+)/i.exec(style);
  if (!m && !/MsoListParagraph/i.test(p.getAttribute('data-cls') || '')) return null;
  const marker = Array.from(p.querySelectorAll('span')).find(s => /mso-list:\s*ignore/i.test(s.getAttribute('style') || ''))?.textContent?.trim() || '';
  const ordered = /^(\(?[0-9]+[.)]|\(?[a-z][.)]|\(?[ivxlc]+[.)])$/i.test(marker);
  return {level: m ? Number(m[1]) : 1, ordered};
}
