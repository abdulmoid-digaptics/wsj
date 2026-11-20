'use client';
/** Newsletter confirmation (double opt-in) and unsubscribe pages. Both work from a signed token in the link. */
import {useEffect, useRef, useState, type ReactNode} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {ArrowUpRight, Check, Loader2, MailX, XCircle} from 'lucide-react';
import {apiUrl} from '@/lib/public-api';
import {NewsletterForm} from './forms';
import './booking-status.css';

type Tone = 'pending' | 'success' | 'error' | 'neutral';
const ICONS: Record<Tone, ReactNode> = {
  pending: <Loader2 size={30} className="bc-spin" aria-hidden="true" />,
  success: <Check size={30} strokeWidth={2.6} aria-hidden="true" />,
  error: <XCircle size={30} aria-hidden="true" />,
  neutral: <MailX size={30} aria-hidden="true" />,
};

function Card({tone, eyebrow, title, children, live}: {tone: Tone; eyebrow: string; title: string; children?: ReactNode; live?: boolean}) {
  return (
    <section className={'bc-card bc-' + tone} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
      <div className="bc-icon">{ICONS[tone]}</div>
      <p className="bc-eyebrow">{eyebrow}</p>
      <h2 className="bc-title">{title}</h2>
      <div className="bc-body">{children}</div>
    </section>
  );
}

const Primary = ({href, children}: {href: string; children: ReactNode}) => <Link className="bc-btn bc-btn-primary" href={href}>{children} <ArrowUpRight size={17} aria-hidden="true" /></Link>;
const Secondary = ({href, children}: {href: string; children: ReactNode}) => <Link className="bc-btn bc-btn-secondary" href={href}>{children}</Link>;

async function post(path: string, body: unknown) {
  const res = await fetch(apiUrl(path), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), cache: 'no-store'});
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(res.status === 429 ? 'Too many attempts. Please wait a minute and try again.' : Array.isArray(data?.message) ? data.message.join(', ') : data?.message || 'Something went wrong.');
  return data;
}

function Resubscribe({source}: {source: string}) {
  return <div className="nl-form"><NewsletterForm source={source} compact /></div>;
}

export function NewsletterConfirm() {
  const t = useSearchParams().get('t') || '';
  const [state, setState] = useState<{kind: 'loading'} | {kind: 'ok'; email: string} | {kind: 'error'; message: string}>(t ? {kind: 'loading'} : {kind: 'error', message: 'This link is missing its confirmation code.'});
  const sent = useRef(false);
  useEffect(() => {
    if (!t || sent.current) return;
    sent.current = true;
    post('/public/newsletter/confirm', {t})
      .then(d => setState({kind: 'ok', email: String(d?.email || '')}))
      .catch(e => setState({kind: 'error', message: e instanceof Error ? e.message : 'This confirmation link is invalid or has expired.'}));
  }, [t]);
  return (
    <div className="bc-wrap">
      {state.kind === 'loading' && <Card tone="pending" eyebrow="One moment" title="Confirming your subscription…" live />}
      {state.kind === 'ok' && <Card tone="success" eyebrow="Subscription confirmed" title="You're subscribed." live>
        <p>{state.email ? <>We&apos;ll send news, events and member offers to <strong>{state.email}</strong>.</> : <>We&apos;ll send you news, events and member offers.</>} Every email has a one-click unsubscribe link.</p>
        <div className="bc-actions"><Primary href="/blogs/">Read the Journal</Primary><Secondary href="/">Back to the website</Secondary></div>
      </Card>}
      {state.kind === 'error' && <Card tone="error" eyebrow="Link not valid" title="We couldn't confirm this subscription.">
        <p>{state.message} Confirmation links work for 7 days. Enter your email below and we&apos;ll send a fresh one.</p>
        <Resubscribe source="confirm-retry" />
      </Card>}
    </div>
  );
}

const REASONS = ['', 'Too many emails', 'Not relevant to me', 'I never signed up', 'Other'];

export function NewsletterUnsubscribe() {
  const t = useSearchParams().get('t') || '';
  const [info, setInfo] = useState<{kind: 'loading'} | {kind: 'ready'; email: string; status: string} | {kind: 'invalid'}>(t ? {kind: 'loading'} : {kind: 'invalid'});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!t) return;
    let live = true;
    fetch(apiUrl('/public/newsletter/preferences?t=' + encodeURIComponent(t)), {cache: 'no-store'})
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (live) setInfo({kind: 'ready', email: String(d.email || ''), status: String(d.status || '')}); })
      .catch(() => { if (live) setInfo({kind: 'invalid'}); });
    return () => { live = false; };
  }, [t]);

  async function unsubscribe() {
    setBusy(true); setError('');
    try { await post('/public/newsletter/unsubscribe', {t, ...(reason ? {reason} : {})}); setDone(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not unsubscribe. Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="bc-wrap">
      {info.kind === 'loading' && <Card tone="pending" eyebrow="One moment" title="Loading your preferences…" live />}
      {info.kind === 'invalid' && <Card tone="error" eyebrow="Link not valid" title="We couldn't find your subscription.">
        <p>This unsubscribe link is incomplete or no longer valid. Use the link at the bottom of our most recent email, or contact us and we&apos;ll remove you straight away.</p>
        <div className="bc-actions"><Primary href="/contact-us/">Contact us</Primary><Secondary href="/">Back to the website</Secondary></div>
      </Card>}
      {info.kind === 'ready' && (done || info.status === 'UNSUBSCRIBED') && <Card tone="neutral" eyebrow="Unsubscribed" title="You won't get marketing emails from us." live>
        <p><strong>{info.email}</strong> has been removed from our mailing list. You&apos;ll still receive emails about your own bookings and account.</p>
        <p className="bc-note">Changed your mind? Subscribe again below; we&apos;ll ask you to confirm by email.</p>
        <Resubscribe source="resubscribe" />
      </Card>}
      {info.kind === 'ready' && !done && info.status !== 'UNSUBSCRIBED' && <Card tone="neutral" eyebrow="Email preferences" title="Unsubscribe from our emails?">
        <p>You&apos;re about to stop news, events and offers sent to <strong>{info.email}</strong>. Emails about your bookings and account will continue.</p>
        <label className="nl-field">
          <span>Tell us why (optional)</span>
          <select value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(r => <option key={r} value={r}>{r || 'Choose a reason'}</option>)}</select>
        </label>
        {error && <p className="bc-error" role="alert">{error}</p>}
        <div className="bc-actions">
          <button type="button" className="bc-btn bc-btn-primary" disabled={busy} onClick={() => void unsubscribe()}>{busy ? 'Unsubscribing…' : 'Unsubscribe'}</button>
          <Secondary href="/">Keep me subscribed</Secondary>
        </div>
      </Card>}
    </div>
  );
}
