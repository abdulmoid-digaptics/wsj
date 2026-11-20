'use client';
/** Live previews inside the editor for blocks whose public rendering is computed (charts, diagrams). */
import {Chart, Diagram} from './extensions';
import {chartSvg, parseChart} from '@/lib/article/chart';
import {renderDiagrams} from '@/components/article/article-enhancer';

export const ChartView = Chart.extend({
  addNodeView() {
    return ({node}) => {
      const dom = document.createElement('figure');
      dom.setAttribute('data-type', 'chart');
      dom.className = 'bs-atom';
      const draw = (n: typeof node) => {
        const spec = parseChart(n.attrs.spec);
        dom.innerHTML = spec ? '<div class="wj-chart">' + chartSvg(spec) + '</div>' : '<p>Chart data is missing. Double-click to edit.</p>';
        if (n.attrs.caption) { const c = document.createElement('figcaption'); c.textContent = n.attrs.caption; dom.appendChild(c); }
      };
      draw(node);
      return {dom, update: updated => { if (updated.type.name !== 'chart') return false; draw(updated); return true; }};
    };
  },
});

export const DiagramView = Diagram.extend({
  addNodeView() {
    return ({node}) => {
      const dom = document.createElement('div');
      dom.className = 'bs-atom bs-diagram';
      const draw = (n: typeof node) => {
        dom.innerHTML = '';
        const inner = document.createElement('div');
        inner.setAttribute('data-type', 'mermaid');
        inner.setAttribute('data-code', n.attrs.code);
        inner.textContent = n.attrs.code;
        dom.appendChild(inner);
        /* The node view is attached after this returns. */
        setTimeout(() => void renderDiagrams(document), 0);
      };
      draw(node);
      return {dom, update: updated => { if (updated.type.name !== 'diagram') return false; draw(updated); return true; }};
    };
  },
});
