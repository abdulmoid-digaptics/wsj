'use client';
/**
 * Task-based admin navigation.
 * - Simple mode (default) shows the everyday screens; Advanced adds technical and rarely used ones.
 * - Groups fold open/closed and remember their state; the current screen's group always opens.
 * - Ctrl/Cmd+K opens a quick-find palette for every screen the user can reach.
 * Role rules: settings, team, audit and payment logs are Admin-only.
 */
import {useEffect, useMemo, useRef, useState, type ComponentType} from 'react';
import {ChevronDown, LayoutDashboard, Search, SlidersHorizontal} from 'lucide-react';
import './admin-simple.css';

export type NavResource = {key: string; label: string; icon: ComponentType<{size?: number}>};
type Group = {id: string; label: string; simple: string[]; advanced: string[]};

const GROUPS: Group[] = [
  {id: 'customers', label: 'Customers & bookings', simple: ['inquiries', 'support', 'bookings', 'billing/orders', 'billing/subscriptions'], advanced: ['booking-days']},
  {id: 'website', label: 'Website', simple: ['blog', 'pages', 'media', 'testimonials', 'popups'], advanced: ['use-cases', 'services', 'pricing', 'categories', 'tags', 'popup-events']},
  {id: 'services', label: 'Services & prices', simple: ['catalog/plans', 'catalog/services'], advanced: ['catalog/addons', 'catalog/amenities', 'plans', 'coworking', 'virtual-office', 'dedicated-desk', 'business-address', 'mailbox', 'podcast-packages', 'meeting-rooms', 'events-space', 'photo-studio', 'llc-services', 'workshops', 'webinars', 'memberships']},
  {id: 'marketing', label: 'Marketing', simple: ['marketing/campaigns', 'marketing/subscribers', 'marketing/coupons', 'marketing/overview'], advanced: []},
  {id: 'settings', label: 'Settings', simple: ['settings', 'users'], advanced: ['audit', 'billing/events', 'billing/webhooks']},
];
/* Friendlier names in the menu (the screens keep their own titles). */
const RENAME: Record<string, string> = {'inquiries': 'Website inquiries', 'support': 'Support requests', 'billing/orders': 'Orders & payments', 'billing/subscriptions': 'Subscriptions', 'catalog/plans': 'Packages & prices', 'catalog/services': 'Service categories', 'marketing/overview': 'Email results', 'plans': 'Legacy packages (old)', 'media': 'Photos & files'};
const ADMIN_ONLY = ['settings', 'users', 'audit', 'billing/events', 'billing/webhooks'];
const HINT: Record<string, string> = {'inquiries': 'Messages from the contact form', 'support': 'Help requests from customers', 'bookings': 'Scheduled bookings', 'billing/orders': 'Payments and receipts', 'blog': 'Write and publish articles', 'catalog/plans': 'Change what things cost', 'marketing/campaigns': 'Email your subscribers', 'marketing/coupons': 'Discount codes', 'users': 'Who can sign in', 'settings': 'Phone, address, hours'};

/* Everyday words people type, mapped to the screen that handles them. */
const SYN: Record<string, string> = {'billing/orders': 'refund receipt invoice payment stripe paid failed', 'billing/subscriptions': 'membership renewal cancel recurring plan', 'catalog/plans': 'price cost package rate hourly', 'marketing/coupons': 'discount promo code offer', 'marketing/campaigns': 'newsletter email send blast announcement', 'marketing/subscribers': 'contacts list unsubscribe audience', 'users': 'staff team password access role employee', 'settings': 'phone address hours business logo seo', 'inquiries': 'contact form leads messages', 'support': 'help ticket complaint reschedule', 'bookings': 'reservation calendar schedule room studio', 'booking-days': 'block closed holiday day rules', 'media': 'image photo upload file picture', 'blog': 'article post journal news', 'popups': 'banner modal promotion'};

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
  useEffect(() => { input.current?.focus(); }, []);
  const all = [{key: 'dashboard', label: 'Today', icon: LayoutDashboard} as NavResource, ...items];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
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
          )) : <li className="adm-qf-empty">No screen matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
