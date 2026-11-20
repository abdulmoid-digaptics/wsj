'use client';
/**
 * Progressive enhancement for rendered articles: Mermaid diagrams are drawn in the browser (strict
 * security level, loaded only when an article has a diagram), and code blocks get a copy button.
 * Without JavaScript the diagram source and code stay readable.
 */
import {useEffect} from 'react';

let mermaidLoad: Promise<typeof import('mermaid').default> | null = null;

export async function renderDiagrams(root: ParentNode = document) {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.wj-article [data-type="mermaid"]:not([data-rendered])'));
  if (!nodes.length) return;
  mermaidLoad ??= import('mermaid').then(m => {
    m.default.initialize({startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: 'inherit', themeVariables: {primaryColor: '#F7F4ED', primaryBorderColor: '#0E3421', primaryTextColor: '#1F2A24', lineColor: '#4F7A64', secondaryColor: '#FBF0DC', tertiaryColor: '#EEF4F0'}});
    return m.default;
  });
  const mermaid = await mermaidLoad;
  for (const [i, node] of nodes.entries()) {
    const code = node.getAttribute('data-code') || node.textContent || '';
    try {
      const {svg} = await mermaid.render('wj-diagram-' + Date.now().toString(36) + i, code);
      node.innerHTML = svg;
      node.setAttribute('data-rendered', 'true');
      node.setAttribute('role', 'img');
      if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', 'Diagram');
    } catch {
      node.setAttribute('data-rendered', 'error');
      node.innerHTML = '<p class="wj-diagram-error">This diagram could not be drawn.</p><pre></pre>';
      node.querySelector('pre')!.textContent = code;
    }
  }
}

export function ArticleEnhancer() {
  useEffect(() => {
    void renderDiagrams();
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('.wj-article pre:not([data-copy])'));
    for (const pre of blocks) {
      pre.setAttribute('data-copy', 'true');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wj-copy-code';
      button.textContent = 'Copy';
      button.addEventListener('click', () => {
        void navigator.clipboard?.writeText(pre.innerText.replace(/\nCopy$/, '')).then(() => { button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1600); });
      });
      pre.appendChild(button);
    }
  }, []);
  return null;
}
