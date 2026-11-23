'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Bell, BellRing, CheckCheck} from 'lucide-react';
import {authToken} from '@/app/admin/api';
import {detectNativePlatform, isStandalone, nativeHaptic} from '@/lib/native-platform';
import {AppleInstallInstructions, registerWorker} from './pwa-registration';
import {BottomSheet} from './bottom-sheet';
import './notification-center.css';

type Audience = 'customer' | 'staff';
const TOPICS = {bookings: 'Bookings & Door Codes', billing: 'Invoices & Billing', system: 'Exclusive Offers & Announcements'};
type Topic = keyof typeof TOPICS;
type PushStatus = {active: boolean; topics: Topic[]};
type Entry = {id: string; title: string; body: string; url?: string | null; createdAt: string; readAt?: string | null; read?: boolean};
type Inbox = {items: Entry[]; unreadCount: number; total: number; page: number; limit: number};
const initial: Inbox = {items: [], unreadCount: 0, total: 0, page: 1, limit: 20};
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.GITHUB_PAGES === 'true' ? '/wsj' : '');
type PushState = 'checking' | 'install' | 'unsupported' | 'denied' | 'disabled' | 'available' | 'active';
const isRead = (entry: Entry) => entry.read ?? Boolean(entry.readAt);
const defaultTopics = Object.keys(TOPICS) as Topic[];

async function syncBadge(count: number) {
  try {
    if (count > 0) await navigator.setAppBadge?.(count);
    else await navigator.clearAppBadge?.();
  } catch { /* Not available on every browser. */ }
}

async function call<T>(audience: Audience, path: string, method = 'GET', body?: unknown, query = ''): Promise<T> {
  const token = audience === 'staff' ? authToken() : null;
  // Same-origin is intentional: the service worker shares these scoped session cookies.
  const result = await fetch(`${base}/api/notifications/${path}/${query}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: {'X-WSJ-Audience': audience, 'X-WSJ-CSRF': '1', ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!result.ok) {
    const error = await result.json().catch(() => null);
    throw new Error(typeof error?.message === 'string' ? error.message : 'Notifications are unavailable right now. Try again in a moment.');
  }
  return result.json();
}

function browserSupported() {
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

function decodeKey(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0));
}

function notificationLink(value?: string | null) {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  const url = new URL(value, window.location.origin);
  return url.origin === window.location.origin ? url.pathname + url.search + url.hash : null;
}

export function NotificationCenter({audience}: {audience: Audience}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'inbox' | 'settings'>('inbox');
  const [inbox, setInbox] = useState(initial);
  const [ready, setReady] = useState(false);
  const [inboxError, setInboxError] = useState('');
  const [notice, setNotice] = useState('');
  const [pushState, setPushState] = useState<PushState>('checking');
  const [topics, setTopics] = useState<Topic[]>(defaultTopics);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const inboxRequest = useRef(0);

  const refresh = useCallback(async (index = 1, append = false) => {
    const request = ++inboxRequest.current;
    try {
      const next = await call<Inbox>(audience, 'in-app', 'GET', undefined, `?page=${index}&limit=20`);
      if (request !== inboxRequest.current) return;
      setInbox(current => append ? {...next, items: [...current.items, ...next.items.filter(item => !current.items.some(prior => prior.id === item.id))]} : next);
      setInboxError('');
      return next.unreadCount;
    } catch (error) {
      if (request === inboxRequest.current) setInboxError((error as Error).message);
    } finally {
      if (request === inboxRequest.current) setReady(true);
    }
  }, [audience]);

  const inspect = useCallback(async () => {
    if (detectNativePlatform() === 'ios' && !isStandalone()) return setPushState('install');
    if (!browserSupported()) return setPushState('unsupported');
    if (Notification.permission === 'denied') return setPushState('denied');
    try {
      const vapid = await call<{publicKey: string | null}>(audience, 'vapid-key');
      if (!vapid.publicKey) return setPushState('disabled');
      const registration = await registerWorker();
      const sub = await registration.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') {
        const status = await call<PushStatus>(audience, 'push-status', 'POST', {endpoint: sub.endpoint});
        if (status.active) {
          setTopics(status.topics);
          return setPushState('active');
        }
      }
      setPushState('available');
    } catch { setPushState('disabled'); }
  }, [audience]);

  useEffect(() => {
    const timer = window.setTimeout(() => {void refresh();}, 0);
    const onFocus = () => {void refresh();};
    const interval = window.setInterval(() => {if (!document.hidden) void refresh();}, 60000);
    window.addEventListener('focus', onFocus);
    const requestTracker = inboxRequest;
    return () => {window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener('focus', onFocus); requestTracker.current++;};
  }, [refresh]);

  function openSettings() {
    setView('settings');
    setNotice('');
    void inspect();
  }

  async function updateDevice(nextTopics: Topic[], ask = false) {
    setBusy(true); setNotice('');
    try {
      // Invoke the browser prompt immediately in the settings button’s user gesture.
      if (ask && Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
        if (Notification.permission === 'denied') setPushState('denied');
        setDismissed(true);
        return;
      }
      const {publicKey} = await call<{publicKey: string | null}>(audience, 'vapid-key');
      if (!publicKey) throw new Error('Push notifications are not enabled on the server.');
      await registerWorker();
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: decodeKey(publicKey)});
      try {
        await call(audience, 'push-subscribe', 'POST', {...subscription.toJSON(), topics: nextTopics});
      } catch (error) {
        if (!existing) await subscription.unsubscribe().catch(() => undefined);
        throw error;
      }
      setTopics(nextTopics);
      setPushState('active');
      setDismissed(true);
    } catch (error) {setNotice((error as Error).message); setOpen(true); setView('settings');}
    finally {setBusy(false);}
  }

  async function disconnect() {
    setBusy(true); setNotice('');
    try {
      const registration = await registerWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await call(audience, 'push-unsubscribe', 'DELETE', {endpoint: subscription.endpoint});
        await subscription.unsubscribe().catch(() => undefined);
      }
      await syncBadge(0);
      setPushState('available');
      setDismissed(true);
    } catch (error) {setNotice((error as Error).message);}
    finally {setBusy(false);}
  }

  async function mark(entry?: Entry) {
    setNotice('');
    try {
      if (!entry || !isRead(entry)) {
        await call(audience, entry ? `${encodeURIComponent(entry.id)}/read` : 'read-all', entry ? 'PATCH' : 'POST');
        const count = await refresh();
        if (count !== undefined) await syncBadge(count);
      }
    } catch (error) {setNotice((error as Error).message);}
    if (entry) {
      const link = notificationLink(entry.url);
      if (link) {setOpen(false); router.push(link);}
    }
  }

  const today = new Date().toDateString();
  const itemsToday = inbox.items.filter(item => new Date(item.createdAt).toDateString() === today);
  const earlier = inbox.items.filter(item => new Date(item.createdAt).toDateString() !== today);
  const supported = pushState === 'available' || pushState === 'active';
  return <div className="wsj-notify">
    <button ref={trigger} type="button" className="wsj-notify-bell" aria-haspopup="dialog" aria-label={inbox.unreadCount ? `Notifications (${inbox.unreadCount} unread)` : 'Notifications'} onClick={() => {setOpen(true); setView('inbox'); setNotice(''); void refresh(); void syncBadge(0);}}>
      <Bell size={20} aria-hidden="true"/>{inbox.unreadCount > 0 && <span aria-hidden="true">{inbox.unreadCount > 99 ? '99+' : inbox.unreadCount}</span>}
    </button>
    <BottomSheet open={open} onOpenChange={setOpen} busy={busy} title="Notifications" description="Updates from Workspace Junction" desktopVariant="drawer" className="wsj-notify-tray" returnFocusRef={trigger}>
      <nav className="wsj-notify-views" aria-label="Notification views">
        <button type="button" aria-pressed={view === 'inbox'} onClick={() => setView('inbox')}>Inbox</button>
        <button type="button" aria-pressed={view === 'settings'} onClick={openSettings}>Notification settings</button>
      </nav>
      {notice && <p className="wsj-notify-error" role="status">{notice}</p>}
      {view === 'inbox' ? <div className="wsj-notify-inbox">
        <button type="button" className="wsj-notify-mark" disabled={!inbox.unreadCount} onClick={() => void mark()}><CheckCheck size={16} aria-hidden="true"/>Mark all as read</button>
        {!ready && <p role="status">Loading notifications…</p>}
        {inboxError && <p role="status">{inboxError} <button type="button" onClick={() => void refresh()}>Retry</button></p>}
        {ready && !inboxError && !inbox.items.length && <p>You’re all caught up. New updates will appear here.</p>}
        {([{label: 'Today', items: itemsToday}, {label: 'Earlier', items: earlier}]).map(group => group.items.length > 0 && <section key={group.label}>
          <h3>{group.label}</h3><ul>{group.items.map(item => <li key={item.id}>
            <button type="button" data-unread={!isRead(item)} onClick={() => void mark(item)}>
              <strong>{item.title}{!isRead(item) && <span className="sr-only"> (unread)</span>}</strong>
              <span>{item.body}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}</time>
            </button>
          </li>)}</ul>
        </section>)}
        {inbox.page * inbox.limit < inbox.total && <button type="button" onClick={() => void refresh(inbox.page + 1, true)}>Load more</button>}
      </div> : <div className="wsj-notify-settings">
        <p>Choose which push updates this device receives. Your in-app inbox is always available.</p>
        {pushState === 'checking' && <p role="status">Checking device…</p>}
        {pushState === 'install' && <section className="wsj-notify-soft">
          <h3>Install Workspace Junction</h3>
          <AppleInstallInstructions/>
          <p>Then open the app from your Home Screen to turn on notifications. Requires iOS or iPadOS 16.4 or later.</p>
        </section>}
        {pushState === 'unsupported' && <p>Push isn’t available on this device or browser. Your inbox still works.</p>}
        {pushState === 'available' && !dismissed && <section className="wsj-notify-soft" aria-labelledby="wsj-push-heading">
          <BellRing size={24} aria-hidden="true"/>
          <h3 id="wsj-push-heading">{audience === 'customer' ? 'Get your access codes instantly' : 'Get new inquiries instantly'}</h3>
          <p>{audience === 'customer' ? 'Get booking updates, meeting reminders and payment alerts. Open the app to view your access codes and door PINs securely.' : 'Receive updates for new inquiries and payment alerts on this device.'}</p>
          <div className="wsj-notify-actions">
            <button type="button" onClick={() => setDismissed(true)}>Not now</button>
            <button type="button" className="wsj-notify-primary" disabled={busy} onClick={() => void updateDevice(topics, true)}>Turn on notifications</button>
          </div>
        </section>}
        {pushState === 'denied' && <p>Notifications are blocked. Allow them in your browser’s site settings, then reopen this panel.</p>}
        {pushState === 'disabled' && <p>Push is currently unavailable. You can still receive updates in your inbox.</p>}
        {supported && <fieldset disabled={busy}><legend>Push topics</legend>
          {defaultTopics.map(topic => <label key={topic}><span>{TOPICS[topic]}</span><input type="checkbox" role="switch" checked={topics.includes(topic)} onChange={event => {
            nativeHaptic();
            const next = event.target.checked ? [...topics, topic] : topics.filter(value => value !== topic);
            if (pushState === 'active') void updateDevice(next); else setTopics(next);
          }}/></label>)}
        </fieldset>}
        {pushState === 'available' && dismissed && <button type="button" onClick={() => setDismissed(false)}>Set up push notifications</button>}
        {pushState === 'active' && <button type="button" disabled={busy} onClick={() => void disconnect()}>Turn off push on this device</button>}
      </div>}
    </BottomSheet>
  </div>;
}
