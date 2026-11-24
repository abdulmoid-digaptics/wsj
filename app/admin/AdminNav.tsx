'use client';
/**
 * Task-based admin navigation.
 * - Simple mode (default) shows the everyday screens; Advanced adds technical and rarely used ones.
 * - Groups fold open/closed and remember their state; the current screen's group always opens.
 * - Ctrl/Cmd+K opens a quick-find palette for every screen the user can reach.
 * Role rules: settings, team, audit and payment logs are Admin-only.
 */
import {useEffect, useMemo, useRef, useState, type ComponentType} from 'react';
import {BookOpen, ChevronDown, CreditCard, LayoutDashboard, MessageSquare, Search, SlidersHorizontal, User} from 'lucide-react';
import {request} from './api';
import './admin-simple.css';

export type NavResource = {key: string; label: string; icon: ComponentType<{size?: number}>};
type Group = {id: string; label: string; simple: string[]; advanced: string[]};

const GROUPS: Group[] = [
  {id: 'customers', label: 'Customers & bookings', simple: ['inquiries', 'support', 'bookings', 'billing/orders', 'billing/subscriptions', 'kisi', 'workspace-clone'], advanced: ['booking-days']},
  {id: 'website', label: 'Website', simple: ['blog', 'pages', 'media', 'testimonials', 'popups'], advanced: ['use-cases', 'services', 'pricing', 'categories', 'tags', 'popup-events']},
  {id: 'services', label: 'Services & prices', simple: ['catalog/plans', 'catalog/services'], advanced: ['catalog/addons', 'catalog/amenities', 'plans', 'coworking', 'virtual-office', 'dedicated-desk', 'business-address', 'mailbox', 'podcast-packages', 'meeting-rooms', 'events-space', 'photo-studio', 'llc-services', 'workshops', 'webinars', 'memberships']},
  {id: 'marketing', label: 'Marketing', simple: ['marketing/campaigns', 'marketing/subscribers', 'marketing/coupons', 'marketing/overview'], advanced: []},
  {id: 'settings', label: 'Settings', simple: ['settings', 'system-settings', 'users'], advanced: ['audit', 'billing/events', 'billing/webhooks']},
];
/* Friendlier names in the menu (the screens keep their own titles). */
const RENAME: Record<string, string> = {'inquiries': 'Website inquiries', 'support': 'Support requests', 'billing/orders': 'Orders & payments', 'billing/subscriptions': 'Subscriptions', 'catalog/plans': 'Packages & prices', 'catalog/services': 'Service categories', 'marketing/overview': 'Email results', 'plans': 'Legacy packages (old)', 'media': 'Photos & files'};
const ADMIN_ONLY = ['kisi', 'workspace-clone', 'settings', 'system-settings', 'users', 'audit', 'billing/events', 'billing/webhooks'];
const HINT: Record<string, string> = {'system-settings': 'Stripe keys, email sending and notification inboxes', 'inquiries': 'Messages from the contact form', 'support': 'Help requests from customers', 'kisi': 'Which packages open which doors', 'workspace-clone': 'Local reports and access records', 'bookings': 'Scheduled bookings', 'billing/orders': 'Payments and receipts', 'blog': 'Write and publish articles', 'catalog/plans': 'Change what things cost', 'marketing/campaigns': 'Email your subscribers', 'marketing/coupons': 'Discount codes', 'users': 'Who can sign in', 'settings': 'Phone, address, hours'};

/* Everyday words people type, mapped to the screen that handles them. */
const SYN: Record<string, string> = {'system-settings': 'stripe keys api secret smtp email gmail app password env environment kisi r2 webhook', 'billing/orders': 'refund receipt invoice payment stripe paid failed', 'billing/subscriptions': 'membership renewal cancel recurring plan', 'catalog/plans': 'price cost package rate hourly', 'marketing/coupons': 'discount promo code offer', 'marketing/campaigns': 'newsletter email send blast announcement', 'marketing/subscribers': 'contacts list unsubscribe audience', 'users': 'staff team password access role employee', 'settings': 'phone address hours business logo seo', 'inquiries': 'contact form leads messages', 'support': 'help ticket complaint reschedule', 'kisi': 'door lock key access entry badge offboard sync', 'workspace-clone': 'sheets reports kpi members visitors doors badge credentials schedule leads audit clone local', 'bookings': 'reservation calendar schedule room studio', 'booking-days': 'block closed holiday day rules', 'media': 'image photo upload file picture', 'blog': 'article post journal news', 'popups': 'banner modal promotion'};

export const navLabel = (r: NavResource) => RENAME[r.key] || r.label;

export function AdminNav({resources, active, role, onNavigate, badges = {}}: {resources: NavResource[]; active: string; role: string; onNavigate: (key: string) => void; badges?: Record<string, number>}) {
  const [advanced, setAdvanced] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { try { setAdvanced(localStorage.getItem('wsj-admin-advanced') === '1'); setClosed(JSON.parse(localStorage.getItem('wsj-admin-closed') || '{}')); } catch { /* storage blocked */ } }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const byKey = useMemo(() => new Map(resources.map(r => [r.key, r])), [resources]);
  const allowed = (key: string) => byKey.has(key) && (role === 'ADMIN' || !ADMIN_ONLY.includes(key));
  /* The screen you are on always shows, even if it is an Advanced one. */
  const groups = GROUPS.map(g => ({...g, keys: [...g.simple, ...(advanced ? g.advanced : g.advanced.filter(k => k === active))].filter(allowed)})).filter(g => g.keys.length);
  const toggleMode = () => { const v = !advanced; setAdvanced(v); try { localStorage.setItem('wsj-admin-advanced', v ? '1' : '0'); } catch { /* ignore */ } };
  const toggleGroup = (id: string) => setClosed(c => { const next = {...c, [id]: !c[id]}; try { localStorage.setItem('wsj-admin-closed', JSON.stringify(next)); } catch { /* ignore */ } return next; });
  const reachable = GROUPS.flatMap(g => [...g.simple, ...g.advanced]).filter(allowed).map(k => byKey.get(k)!);

  return (
    <>
      <button type="button" className="adm-quickfind" onClick={() => setPalette(true)} aria-keyshortcuts="Control+K">
        <Search size={16} /><span>Search</span><kbd>Ctrl K</kbd>
      </button>
      <nav aria-label="Admin navigation" className="adm-nav-simple">
        <button className={'adm-nav-item adm-nav-today' + (active === 'dashboard' ? ' adm-active' : '')} aria-current={active === 'dashboard' ? 'page' : undefined} onClick={() => onNavigate('dashboard')}><LayoutDashboard size={18} />Today</button>
        {groups.map(g => {
          const open = !closed[g.id] || g.keys.includes(active);
          return (
            <div className="adm-nav-group" key={g.id}>
              <button type="button" className="adm-nav-group-head" aria-expanded={open} onClick={() => toggleGroup(g.id)}>{g.label}<ChevronDown size={15} className={open ? 'is-open' : ''} /></button>
              {open && g.keys.map(k => {
                const r = byKey.get(k)!;
                const count = badges[k] || 0;
                return <button key={k} className={'adm-nav-item' + (active === k ? ' adm-active' : '')} aria-current={active === k ? 'page' : undefined} onClick={() => onNavigate(k)} title={HINT[k]}><r.icon size={18} /><span className="adm-nav-text">{navLabel(r)}</span>{count > 0 && <span className="adm-nav-badge" aria-label={count + ' waiting'}>{count > 99 ? '99+' : count}</span>}</button>;
              })}
            </div>
          );
        })}
      </nav>
      <button type="button" className="adm-mode-toggle" onClick={toggleMode} aria-pressed={advanced}>
        <SlidersHorizontal size={15} /><span>{advanced ? 'Advanced menu' : 'Simple menu'}</span><span className={'adm-switch' + (advanced ? ' is-on' : '')} aria-hidden="true"><span /></span>
      </button>
      {palette && <QuickFind items={reachable} onPick={k => { setPalette(false); onNavigate(k); }} onClose={() => setPalette(false)} />}
    </>
  );
}

function QuickFind({items, onPick, onClose}: {items: NavResource[]; onPick: (key: string) => void; onClose: () => void}) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const all = [{key: 'dashboard', label: 'Today', icon: LayoutDashboard} as NavResource, ...items];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  useEffect(() => { input.current?.focus(); }, []);
  /* Records: customers, orders, articles and inquiries, searched on the server (debounced, stale requests aborted). */
  type Hit = {view: string; q: string; title: string; sub: string; kind: 'customer' | 'order' | 'post' | 'inquiry'};
  const [hits, setHits] = useState<Hit[]>([]);
  useEffect(() => {
    const term = q.trim();
    const ctl = new AbortController();
    const t = setTimeout(() => {
      if (term.length < 2) { setHits([]); return; }
      request<{customers: Array<{name: string; email: string}>; orders: Array<{id: string; status: string; dueNowAmount: number; currency: string; customer?: {email: string; name: string}}>; posts: Array<{title: string; slug: string; status: string}>; inquiries: Array<{name: string; email: string; status: string}>}>('/admin/overview/search?q=' + encodeURIComponent(term), {signal: ctl.signal})
        .then(r => setHits([
          ...r.customers.map(c => ({view: 'billing/orders', q: c.email, title: c.name || c.email, sub: 'Customer · ' + c.email, kind: 'customer' as const})),
          ...r.orders.map(o => ({view: 'billing/orders', q: o.id, title: 'Order ' + o.id.slice(0, 8), sub: (o.customer?.email || '') + ' · ' + o.status.toLowerCase() + ' · ' + new Intl.NumberFormat('en-US', {style: 'currency', currency: (o.currency || 'usd').toUpperCase()}).format(o.dueNowAmount / 100), kind: 'order' as const})),
          ...r.posts.map(p => ({view: 'blog', q: p.title, title: p.title, sub: 'Article · ' + p.status.toLowerCase(), kind: 'post' as const})),
          ...r.inquiries.map(i => ({view: 'inquiries', q: i.email, title: i.name || i.email, sub: 'Inquiry · ' + i.email + ' · ' + i.status.toLowerCase(), kind: 'inquiry' as const})),
        ]))
        .catch(() => undefined);
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  const openHit = (h: Hit) => { window.history.replaceState(window.history.state, '', window.location.pathname + '?view=' + encodeURIComponent(h.view) + '&q=' + encodeURIComponent(h.q)); onPick(h.view); };
  const list = all.filter(r => { const hay = (navLabel(r) + ' ' + r.label + ' ' + (HINT[r.key] || '') + ' ' + (SYN[r.key] || '') + ' ' + r.key).toLowerCase(); return words.every(w => hay.includes(w)); }).slice(0, 12);
  const pick = Math.min(at, Math.max(0, list.length - 1));
  return (
    <div className="adm-qf-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-qf" role="dialog" aria-modal="true" aria-label="Find a screen">
        <div className="adm-qf-input"><Search size={18} /><input ref={input} value={q} placeholder="Type what you want to do, e.g. coupon, refund, blog" aria-label="Search screens" aria-controls="adm-qf-list" aria-activedescendant={list[pick] ? 'qf-' + list[pick].key : undefined}
          onChange={e => { setQ(e.target.value); setAt(0); }}
          onKeyDown={e => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(i + 1, list.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(i - 1, 0)); } else if (e.key === 'Enter' && list[pick]) onPick(list[pick].key); }} /><kbd>Esc</kbd></div>
        <ul id="adm-qf-list" role="listbox" className="adm-qf-list">
          {list.length ? list.map((r, i) => (
            <li key={r.key} id={'qf-' + r.key} role="option" aria-selected={i === pick} className={i === pick ? 'is-active' : ''} onMouseEnter={() => setAt(i)} onMouseDown={e => { e.preventDefault(); onPick(r.key); }}>
              <r.icon size={17} /><span><strong>{navLabel(r)}</strong>{HINT[r.key] && <small>{HINT[r.key]}</small>}</span>
            </li>
          )) : !hits.length && <li className="adm-qf-empty">No screen matches “{q}”.</li>}
          {hits.length > 0 && <li className="adm-qf-section" role="presentation">Records</li>}
          {hits.map((h, i) => { const Icon = h.kind === 'customer' ? User : h.kind === 'order' ? CreditCard : h.kind === 'post' ? BookOpen : MessageSquare; return (
            <li key={h.kind + i + h.q} role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); openHit(h); }}><Icon size={17} /><span><strong>{h.title}</strong><small>{h.sub}</small></span></li>
          ); })}
        </ul>
      </div>
    </div>
  );
}
