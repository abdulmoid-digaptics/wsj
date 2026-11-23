'use client';
/**
 * Keeps an active admin signed in and signs out an idle one.
 * - Activity (mouse, keys, scroll, touch) refreshes the 2-hour session cookie at most every 15 minutes.
 * - After 30 minutes without activity a 60-second warning appears: Stay signed in, or Sign out.
 *   When the countdown ends the session is closed on the server.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {request, setToken} from './api';

const IDLE_MS = 30 * 60000, WARN_S = 60, REFRESH_EVERY = 15 * 60000;

export function SessionGuard({onExpired}: {onExpired: () => void}) {
  const last = useRef(0);
  const lastRefresh = useRef(0);
  const [left, setLeft] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    lastRefresh.current = Date.now();
    try { const r = await request<{accessToken?: string}>('/auth/refresh', {method: 'POST'}); if (r.accessToken) setToken(r.accessToken); } catch { /* the next request will report an expired session */ }
  }, []);
  const signOut = useCallback(async () => {
    setLeft(null);
    try { await request('/auth/logout', {method: 'POST'}); } catch { /* already gone */ }
    setToken(null); onExpired();
  }, [onExpired]);

  useEffect(() => {
    last.current = Date.now(); lastRefresh.current = Date.now();
    const active = () => {
      last.current = Date.now();
      if (Date.now() - lastRefresh.current > REFRESH_EVERY) void refresh();
    };
    const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const;
    events.forEach(e => window.addEventListener(e, active, {passive: true}));
    const tick = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= IDLE_MS + WARN_S * 1000) void signOut();
      else if (idle >= IDLE_MS) setLeft(Math.max(0, Math.ceil((IDLE_MS + WARN_S * 1000 - idle) / 1000)));
    }, 1000);
    return () => { events.forEach(e => window.removeEventListener(e, active)); clearInterval(tick); };
  }, [refresh, signOut]);

  if (left === null) return null;
  return (
    <div className="adm-idle-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="adm-idle-title">
      <div className="adm-root adm-idle">
        <div id="adm-idle-title" className="adm-idle-title">Still there?</div>
        <div className="adm-idle-text">You have been inactive for 30 minutes. For security you will be signed out in <strong>{left}</strong> second{left === 1 ? '' : 's'}.</div>
        <div className="adm-idle-actions">
          <button type="button" className="adm-button adm-secondary" onClick={() => void signOut()}>Sign out</button>
          <button type="button" className="adm-button adm-primary" autoFocus onClick={() => { last.current = Date.now(); setLeft(null); void refresh(); }}>Stay signed in</button>
        </div>
      </div>
    </div>
  );
}
