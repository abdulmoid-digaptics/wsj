'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowUp, Check, Link2, List, Share2, ThumbsDown, ThumbsUp} from 'lucide-react';
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

/** "Was this article helpful?" One vote per browser per article (also limited per visitor on the server). */
export function HelpfulVote({slug}: {slug: string}) {
  const key = 'wsj-helpful:' + slug;
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [choice, setChoice] = useState<boolean | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { try { const v = localStorage.getItem(key); if (v === 'yes' || v === 'no') { setChoice(v === 'yes'); setState('done'); } } catch { /* storage blocked */ } }, 0);
    return () => clearTimeout(t);
  }, [key]);
  async function vote(helpful: boolean) {
    setState('sending'); setChoice(helpful);
    try {
      const r = await fetch(apiUrl('/public/blog/' + encodeURIComponent(slug) + '/feedback'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({helpful})});
      if (!r.ok && r.status !== 429) throw new Error();
      try { localStorage.setItem(key, helpful ? 'yes' : 'no'); } catch { /* storage blocked */ }
      setState('done');
    } catch { setState('error'); }
  }
  return (
    <div className="jr-helpful" role="group" aria-label="Was this article helpful?">
      {state === 'done' ? (
        <p className="jr-helpful-thanks" role="status"><Check size={16} aria-hidden="true" /> Thanks for the feedback{choice === false ? '. We will use it to improve this article.' : '!'}</p>
      ) : (
        <>
          <span className="jr-helpful-q">Was this article helpful?</span>
          <button type="button" className="jr-helpful-btn" disabled={state === 'sending'} onClick={() => void vote(true)}><ThumbsUp size={15} aria-hidden="true" /> Yes</button>
          <button type="button" className="jr-helpful-btn" disabled={state === 'sending'} onClick={() => void vote(false)}><ThumbsDown size={15} aria-hidden="true" /> No</button>
          {state === 'error' && <span className="jr-helpful-err" role="alert">Could not send. Please try again.</span>}
        </>
      )}
    </div>
  );
}

/** The phone's own share sheet, shown only where the browser supports it. */
export function NativeShare({url, title}: {url: string; title: string}) {
  const [supported, setSupported] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSupported(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), 0); return () => clearTimeout(t); }, []);
  if (!supported) return null;
  return <button type="button" className="jr-share-btn jr-share-native" onClick={() => { navigator.share({title, url}).catch(() => undefined); }}><Share2 size={15} aria-hidden="true" /> Share</button>;
}

/** Floating "back to top" button after the reader has scrolled a screen and a half. */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > window.innerHeight * 1.5);
    const first = setTimeout(on, 0);
    window.addEventListener('scroll', on, {passive: true});
    return () => { clearTimeout(first); window.removeEventListener('scroll', on); };
  }, []);
  return (
    <button type="button" className={'jr-top' + (show ? ' is-on' : '')} aria-label="Back to top" tabIndex={show ? 0 : -1} aria-hidden={!show}
      onClick={() => window.scrollTo({top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'})}>
      <ArrowUp size={18} aria-hidden="true" />
    </button>
  );
}
