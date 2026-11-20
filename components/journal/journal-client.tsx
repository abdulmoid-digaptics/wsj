'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Check, Link2, List} from 'lucide-react';
import {apiUrl} from '@/lib/public-api';

/** Submits the filter form as soon as a select or toggle changes (the form still works without JS). */
export function AutoSubmitForm({action, children, className, label}: {action: string; children: ReactNode; className?: string; label: string}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} method="get" className={className} role="search" aria-label={label}
      onChange={e => { const t = e.target as HTMLElement; if (t.tagName === 'SELECT' || (t as HTMLInputElement).type === 'checkbox') ref.current?.requestSubmit(); }}
      onSubmit={e => {
        /* Drop empty fields so URLs stay clean (/blogs/ instead of /blogs/?q=&sort=newest). */
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const params = new URLSearchParams();
        for (const [k, v] of data.entries()) { const s = String(v).trim(); if (s && !(k === 'sort' && s === 'newest')) params.set(k, s); }
        window.location.assign(action + (params.size ? '?' + params.toString() : ''));
      }}>
      {children}
    </form>
  );
}

/** Table of contents with the section in view highlighted. */
export function TableOfContents({headings}: {headings: Array<{id: string; text: string; level: number}>}) {
  const [active, setActive] = useState(headings[0]?.id || '');
  const navRef = useRef<HTMLElement>(null);
  /* Keep the highlighted section visible inside the sidebar as the reader moves down the article. */
  useEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector<HTMLElement>('li.is-active');
    if (!nav || !item || nav.scrollHeight <= nav.clientHeight) return;
    const top = item.offsetTop - nav.clientHeight / 2 + item.offsetHeight / 2;
    nav.scrollTo({top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }, [active]);
  useEffect(() => {
    const els = headings.map(h => document.getElementById(h.id)).filter((x): x is HTMLElement => Boolean(x));
    if (!els.length) return;
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, {rootMargin: '-110px 0px -65% 0px', threshold: 0});
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [headings]);
  const go = (id: string) => (e: React.MouseEvent) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block: 'start'});
    history.replaceState(null, '', '#' + id);
    setActive(id);
  };
  const list = (
    <ol className="jr-toc-list">
      {headings.map(h => (
        <li key={h.id} className={(h.level === 3 ? 'is-sub ' : '') + (active === h.id ? 'is-active' : '')}>
          <a href={'#' + h.id} onClick={go(h.id)} aria-current={active === h.id ? 'location' : undefined}>{h.text}</a>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <nav ref={navRef} className="jr-toc jr-toc-desktop" aria-label="Table of contents" data-lenis-prevent="" data-lenis-prevent-wheel="" tabIndex={-1}><p className="jr-side-title"><List size={15} aria-hidden="true" /> In this article</p>{list}</nav>
      <details className="jr-toc jr-toc-mobile"><summary><List size={16} aria-hidden="true" /> In this article <span>{headings.length} sections</span></summary>{list}</details>
    </>
  );
}

/** Copy-link button with visible and announced feedback. */
export function CopyLink({url}: {url: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="jr-share-btn" aria-label="Copy article link" onClick={() => {
      void navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
    }}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
      <span>{copied ? 'Copied' : 'Copy link'}</span>
      <span className="sr-only" role="status">{copied ? 'Link copied' : ''}</span>
    </button>
  );
}

/** Counts one view per article per browser session (powers "Popular"). Fire and forget. */
export function ViewBeacon({slug}: {slug: string}) {
  useEffect(() => {
    try {
      const key = 'wsj-viewed:' + slug;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* storage unavailable: still count */ }
    void fetch(apiUrl('/public/blog/' + encodeURIComponent(slug) + '/view'), {method: 'POST', keepalive: true}).catch(() => undefined);
  }, [slug]);
  return null;
}
