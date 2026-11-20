/**
 * Chart blocks are stored as data (never as markup) and drawn here as an inline SVG. The same
 * function renders the editor preview and the public article, so both always match. All text is
 * escaped and every number is validated, so the output cannot carry script or markup from content.
 */
export type ChartType = 'bar' | 'horizontal-bar' | 'line' | 'pie' | 'doughnut';
export type ChartSpec = {type: ChartType; title?: string; description?: string; labels: string[]; datasets: Array<{label: string; data: number[]; color?: string}>; showValues?: boolean; unit?: string};

export const CHART_PALETTE = ['#0E3421', '#D7902A', '#4F7A64', '#B5562E', '#8FA89A', '#2F5D8A', '#C9A227', '#6B4E8A'];
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeColor = (c: unknown, i: number) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : CHART_PALETTE[i % CHART_PALETTE.length]);
const fmt = (n: number, unit = '') => (Math.abs(n) >= 1000 ? n.toLocaleString('en-US') : String(Math.round(n * 100) / 100)) + unit;

export function parseChart(raw: unknown): ChartSpec | null {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || typeof v !== 'object') return null;
    const type = (['bar', 'horizontal-bar', 'line', 'pie', 'doughnut'] as const).includes(v.type) ? v.type as ChartType : 'bar';
    const labels = Array.isArray(v.labels) ? v.labels.slice(0, 40).map((l: unknown) => String(l ?? '').slice(0, 60)) : [];
    const datasets = Array.isArray(v.datasets) ? v.datasets.slice(0, 8).map((d: {label?: unknown; data?: unknown; color?: unknown}) => ({
      label: String(d?.label ?? '').slice(0, 60),
      data: labels.map((_: string, i: number) => { const n = Number(Array.isArray(d?.data) ? d.data[i] : 0); return Number.isFinite(n) ? n : 0; }),
      color: typeof d?.color === 'string' ? d.color : undefined,
    })) : [];
    if (!labels.length || !datasets.length) return null;
    return {type, title: v.title ? String(v.title).slice(0, 140) : undefined, description: v.description ? String(v.description).slice(0, 400) : undefined, labels, datasets, showValues: v.showValues !== false, unit: v.unit ? String(v.unit).slice(0, 8) : ''};
  } catch { return null; }
}

/** Accessible SVG markup for a chart spec. */
export function chartSvg(spec: ChartSpec): string {
  const W = 720, H = spec.type === 'horizontal-bar' ? Math.max(260, spec.labels.length * 38 + 70) : 360;
  const title = esc(spec.title || 'Chart'), desc = esc(spec.description || summary(spec));
  const open = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d" xmlns="http://www.w3.org/2000/svg" class="wj-chart-svg"><title id="t">${title}</title><desc id="d">${desc}</desc>`;
  if (spec.type === 'pie' || spec.type === 'doughnut') return open + pie(spec, W, H) + '</svg>';
  return open + axes(spec, W, H) + '</svg>';
}

function summary(spec: ChartSpec) {
  return spec.datasets.map(d => d.label + ': ' + spec.labels.map((l, i) => l + ' ' + fmt(d.data[i], spec.unit)).join(', ')).join('; ');
}

function axes(spec: ChartSpec, W: number, H: number) {
  const horizontal = spec.type === 'horizontal-bar';
  const all = spec.datasets.flatMap(d => d.data);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const pad = {l: horizontal ? 140 : 56, r: 24, t: 24, b: horizontal ? 24 : 56};
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  let out = '';
  /* Grid lines and value ticks. */
  for (let i = 0; i <= 4; i++) {
    const v = min + (span * i) / 4;
    if (horizontal) { const x = pad.l + (iw * i) / 4; out += `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + ih}" stroke="#E6E1D6"/><text x="${x}" y="${H - 6}" font-size="12" text-anchor="middle" fill="#59665F">${esc(fmt(v, spec.unit))}</text>`; }
    else { const y = pad.t + ih - (ih * i) / 4; out += `<line x1="${pad.l}" y1="${y}" x2="${pad.l + iw}" y2="${y}" stroke="#E6E1D6"/><text x="${pad.l - 8}" y="${y + 4}" font-size="12" text-anchor="end" fill="#59665F">${esc(fmt(v, spec.unit))}</text>`; }
  }
  const n = spec.labels.length, k = spec.datasets.length;
  const pos = (v: number) => ((v - min) / span);
  if (spec.type === 'line') {
    spec.datasets.forEach((d, di) => {
      const color = safeColor(d.color, di);
      const pts = d.data.map((v, i) => [pad.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1)), pad.t + ih - pos(v) * ih]);
      out += `<polyline fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
      pts.forEach(([x, y], i) => { out += `<circle cx="${x}" cy="${y}" r="4.5" fill="#fff" stroke="${color}" stroke-width="2.5"/>` + (spec.showValues ? `<text x="${x}" y="${y - 10}" font-size="12" text-anchor="middle" fill="#1F2A24">${esc(fmt(d.data[i], spec.unit))}</text>` : ''); });
    });
    spec.labels.forEach((l, i) => { const x = pad.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1)); out += `<text x="${x}" y="${pad.t + ih + 22}" font-size="12" text-anchor="middle" fill="#3B4741">${esc(l)}</text>`; });
  } else {
    const band = (horizontal ? ih : iw) / n, gap = band * 0.22, bar = (band - gap) / k;
    spec.labels.forEach((l, i) => {
      spec.datasets.forEach((d, di) => {
        const v = d.data[i], color = safeColor(d.color, di), zero = pos(0), p = pos(v);
        if (horizontal) {
          const y = pad.t + i * band + gap / 2 + di * bar, x0 = pad.l + Math.min(zero, p) * iw, w = Math.abs(p - zero) * iw;
          out += `<rect x="${x0}" y="${y}" width="${Math.max(1, w)}" height="${bar - 2}" rx="4" fill="${color}"/>` + (spec.showValues ? `<text x="${x0 + w + 6}" y="${y + bar / 2 + 3}" font-size="12" fill="#1F2A24">${esc(fmt(v, spec.unit))}</text>` : '');
        } else {
          const x = pad.l + i * band + gap / 2 + di * bar, y0 = pad.t + ih - Math.max(zero, p) * ih, h = Math.abs(p - zero) * ih;
          out += `<rect x="${x}" y="${y0}" width="${bar - 2}" height="${Math.max(1, h)}" rx="4" fill="${color}"/>` + (spec.showValues ? `<text x="${x + (bar - 2) / 2}" y="${y0 - 6}" font-size="12" text-anchor="middle" fill="#1F2A24">${esc(fmt(v, spec.unit))}</text>` : '');
        }
      });
      if (horizontal) out += `<text x="${pad.l - 10}" y="${pad.t + i * band + band / 2 + 4}" font-size="13" text-anchor="end" fill="#3B4741">${esc(l)}</text>`;
      else out += `<text x="${pad.l + i * band + band / 2}" y="${pad.t + ih + 22}" font-size="12" text-anchor="middle" fill="#3B4741">${esc(l)}</text>`;
    });
  }
  return out;
}

function pie(spec: ChartSpec, W: number, H: number) {
  const d = spec.datasets[0];
  const total = d.data.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  const cx = 200, cy = H / 2, r = 140, inner = spec.type === 'doughnut' ? 78 : 0;
  let angle = -Math.PI / 2, out = '';
  d.data.forEach((v, i) => {
    const frac = Math.max(0, v) / total, a2 = angle + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
    const p = (a: number, rad: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const color = safeColor(spec.datasets[i]?.color, i);
    if (frac >= 0.9999) out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
    else if (frac > 0) out += `<path d="M${p(angle, r)} A${r},${r} 0 ${large} 1 ${p(a2, r)} ${inner ? `L${p(a2, inner)} A${inner},${inner} 0 ${large} 0 ${p(angle, inner)}` : `L${cx},${cy}`} Z" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    angle = a2;
  });
  if (inner) out += `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="#fff"/><text x="${cx}" y="${cy + 6}" font-size="20" text-anchor="middle" fill="#0E3421" font-weight="700">${esc(fmt(total, spec.unit))}</text>`;
  spec.labels.forEach((l, i) => {
    const y = 60 + i * 30, color = safeColor(spec.datasets[i]?.color, i);
    out += `<rect x="400" y="${y - 12}" width="16" height="16" rx="4" fill="${color}"/><text x="426" y="${y + 1}" font-size="14" fill="#1F2A24">${esc(l)}${spec.showValues ? ` · ${esc(fmt(d.data[i], spec.unit))} (${Math.round((Math.max(0, d.data[i]) / total) * 100)}%)` : ''}</text>`;
  });
  return out;
}
