'use client';
/**
 * Shared admin UI primitives: toast dock (with Undo and a progress timer), skeleton rows,
 * actionable empty states and a right-hand slide-over drawer that keeps the page behind it usable.
 */
import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {AlertTriangle, CheckCircle2, Info, X} from 'lucide-react';
import './admin-ui.css';

type Tone = 'success' | 'warn' | 'error' | 'info';
type Toast = {id: number; tone: Tone; text: string; undo?: () => void | Promise<void>; ms: number};
type ToastApi = {push: (t: {tone?: Tone; text: string; undo?: () => void | Promise<void>; ms?: number}) => void};
const ToastCtx = createContext<ToastApi>({push: () => undefined});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({children}: {children: ReactNode}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const close = useCallback((id: number) => setToasts(list => list.filter(t => t.id !== id)), []);
  const push = useCallback<ToastApi['push']>(t => {
    const id = ++seq.current;
    const ms = t.ms ?? (t.undo ? 7000 : t.tone === 'error' ? 8000 : 4500);
    setToasts(list => [...list.slice(-3), {id, tone: t.tone ?? 'success', text: t.text, undo: t.undo, ms}]);
    setTimeout(() => close(id), ms);
  }, [close]);
  return (
    <ToastCtx.Provider value={{push}}>
      {children}
      <div className="adm-toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={'adm-toast is-' + t.tone} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span className="adm-toast-icon" aria-hidden="true">{t.tone === 'success' ? <CheckCircle2 size={18} /> : t.tone === 'info' ? <Info size={18} /> : <AlertTriangle size={18} />}</span>
            <span className="adm-toast-text">{t.text}</span>
            {t.undo && <button type="button" className="adm-toast-undo" onClick={() => { void t.undo?.(); close(t.id); }}>Undo</button>}
            <button type="button" className="adm-toast-x" aria-label="Dismiss" onClick={() => close(t.id)}><X size={15} /></button>
            <span className="adm-toast-timer" style={{animationDuration: t.ms + 'ms'}} aria-hidden="true" />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Placeholder rows shaped like the real table while it loads. */
export function SkeletonRows({rows = 6, cols = 5}: {rows?: number; cols?: number}) {
  return (
    <>
      {Array.from({length: rows}, (_, r) => (
        <tr key={r} className="adm-skel-row" aria-hidden="true">
          {Array.from({length: cols}, (_, c) => <td key={c}><span className="adm-skel" style={{width: c === 0 ? '70%' : c === cols - 1 ? '30%' : (45 + ((r * 7 + c * 13) % 40)) + '%'}} /></td>)}
        </tr>
      ))}
    </>
  );
}

export function SkeletonCards({count = 4}: {count?: number}) {
  return <div className="adm-skel-cards" aria-hidden="true">{Array.from({length: count}, (_, i) => <div key={i} className="adm-skel-card"><span className="adm-skel" style={{width: '40%'}} /><span className="adm-skel adm-skel-big" style={{width: '60%'}} /><span className="adm-skel" style={{width: '50%'}} /></div>)}</div>;
}

/** Why the list is empty and what to do about it. */
export function EmptyState({icon, title, text, action}: {icon: ReactNode; title: string; text: string; action?: ReactNode}) {
  return (
    <div className="adm-empty-state">
      <span className="adm-empty-icon" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

/** Right-hand slide-over. The page behind stays in place (scroll, filters, page number). */
export function Drawer({open, title, subtitle, onClose, children, footer, width = 680}: {open: boolean; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number}) {
  const panel = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 0); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panel.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!mounted || !open) return null;
  return createPortal(
    <div className="adm-drawer-root">
      <div className="adm-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={panel} className="adm-root adm-drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'} tabIndex={-1} style={{width: 'min(' + width + 'px, 100vw)'}}>
        <header className="adm-drawer-head">
          <div><div className="adm-drawer-title">{title}</div>{subtitle && <div className="adm-drawer-sub">{subtitle}</div>}</div>
          <button type="button" className="adm-drawer-x" onClick={onClose} aria-label="Close panel"><X size={20} /></button>
        </header>
        <div className="adm-drawer-body">{children}</div>
        {footer && <footer className="adm-drawer-foot">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}
