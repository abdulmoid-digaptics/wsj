'use client';
import {apiUrl} from '@/lib/public-api';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {AlertCircle, ArrowUpRight, Check, Clock, Copy, Loader2, Mail, XCircle} from 'lucide-react';
import './booking-status.css';

type Confirmation = {id:string;status:string;serviceName:string;bookingDate?:string|null;bookingTime?:string|null;totalPrice:number;currency:string};

const POLL_MS = 2500;
const MAX_ATTEMPTS = 36; // ~90 seconds. The server also asks Stripe directly, so this rarely runs long.

function money(amount:number, currency:string):string {
 try { return amount.toLocaleString('en-US', {style:'currency', currency: currency.toUpperCase()}); }
 catch { return '$' + amount.toFixed(2); }
}

type Tone = 'pending' | 'success' | 'warning' | 'error' | 'neutral';
const ICONS: Record<Tone, ReactNode> = {
 pending: <Loader2 size={30} className="bc-spin" aria-hidden="true" />,
 success: <Check size={30} strokeWidth={2.6} aria-hidden="true" />,
 warning: <Clock size={30} aria-hidden="true" />,
 error: <XCircle size={30} aria-hidden="true" />,
 neutral: <AlertCircle size={30} aria-hidden="true" />,
};

/** One consistent result card for every payment state. */
function Card({tone, eyebrow, title, children, live}:{tone:Tone; eyebrow:string; title:string; children?:ReactNode; live?:boolean}) {
 return (
  <section className={'bc-card bc-' + tone} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
   <div className="bc-icon">{ICONS[tone]}</div>
   <p className="bc-eyebrow">{eyebrow}</p>
   <h2 className="bc-title">{title}</h2>
   <div className="bc-body">{children}</div>
  </section>
 );
}

function Reference({id}:{id:string}) {
 const [copied, setCopied] = useState(false);
 return (
  <div className="bc-ref">
   <span>Reference</span>
   <code>{id.slice(0, 8).toUpperCase()}</code>
   <button type="button" className="bc-copy" onClick={() => { void navigator.clipboard?.writeText(id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }} aria-label="Copy full reference">
    {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}
   </button>
  </div>
 );
}

function Actions({children}:{children:ReactNode}) { return <div className="bc-actions">{children}</div>; }
const Primary = ({href, children}:{href:string; children:ReactNode}) => <Link className="bc-btn bc-btn-primary" href={href}>{children} <ArrowUpRight size={17} aria-hidden="true" /></Link>;
const Secondary = ({href, children}:{href:string; children:ReactNode}) => <Link className="bc-btn bc-btn-secondary" href={href}>{children}</Link>;

function Steps({paid}:{paid:boolean}) {
 const steps = [{label: 'Checkout', done: true}, {label: 'Payment', done: paid, active: !paid}, {label: 'Confirmed', done: paid}];
 return (
  <ol className="bc-steps" aria-label="Progress">
   {steps.map(step => <li key={step.label} className={step.done ? 'is-done' : step.active ? 'is-active' : ''}><span aria-hidden="true">{step.done ? <Check size={13} strokeWidth={3} /> : null}</span>{step.label}</li>)}
  </ol>
 );
}

export function BookingStatus({id}:{id:string}) {
 const [data, setData] = useState<Confirmation | null>(null);
 const [notFound, setNotFound] = useState(false);
 const [timedOut, setTimedOut] = useState(false);
 const attempts = useRef(0);

 useEffect(() => {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  async function poll() {
   try {
    const res = await fetch(apiUrl('/public/bookings/' + encodeURIComponent(id) + '/confirmation'));
    if (cancelled) return;
    if (res.status === 404) { setNotFound(true); return; }
    if (!res.ok) throw new Error('request failed');
    const body: Confirmation = await res.json();
    setData(body);
    attempts.current += 1;
    if (body.status === 'PENDING' && attempts.current < MAX_ATTEMPTS) timer = setTimeout(poll, POLL_MS);
    else if (body.status === 'PENDING') setTimedOut(true);
   } catch {
    attempts.current += 1;
    if (!cancelled && attempts.current < MAX_ATTEMPTS) timer = setTimeout(poll, POLL_MS);
    else if (!cancelled) setTimedOut(true);
   }
  }
  void poll();
  return () => { cancelled = true; clearTimeout(timer); };
 }, [id]);

 if (notFound) return <Card tone="neutral" eyebrow="Not found" title="We couldn't find that booking."><p>Check the link in your email, or get in touch and we will look it up for you.</p><Actions><Primary href="/contact-us/">Contact us</Primary><Secondary href="/">Return home</Secondary></Actions></Card>;
 if (!data) return <Card tone="pending" eyebrow="One moment" title="Checking your booking…" live />;
 if (data.status === 'CONFIRMED') return <Card tone="success" eyebrow="Booking confirmed" title="You're all set.">
  <p>We received {money(data.totalPrice, data.currency)} for <strong>{data.serviceName}</strong>{data.bookingDate ? <> on {data.bookingDate}{data.bookingTime ? ' at ' + data.bookingTime : ''}</> : null}. A confirmation is on its way to your inbox.</p>
  <Reference id={data.id} /><Actions><Primary href="/">Back to Workspace Junction</Primary></Actions></Card>;
 if (data.status === 'CANCELLED') return <Card tone="neutral" eyebrow="Cancelled" title="This booking was canceled."><p>Payment was not completed, so nothing was charged.</p><Actions><Primary href="/">Start a new booking</Primary></Actions></Card>;
 if (data.status === 'REFUNDED') return <Card tone="neutral" eyebrow="Refunded" title="This booking was refunded."><Reference id={data.id} /><Actions><Primary href="/contact-us/">Contact us</Primary></Actions></Card>;
 if (timedOut) return <Card tone="warning" eyebrow="Still processing" title="Your payment is taking longer than usual."><p>Nothing is lost: your booking completes automatically as soon as the bank confirms. Refresh in a minute, or call <a href="tel:+17739861908">(773) 986-1908</a>.</p><Reference id={data.id} /></Card>;
 return <Card tone="pending" eyebrow="Payment received" title="Confirming your booking…" live><Steps paid={false} /><p>This usually takes a few seconds. Please keep this page open.</p></Card>;
}

/* Without the buyer's own receipt proof the API returns payment state only (detail:false). */
type OrderStatusBody = {id:string;status:string;processing:boolean;paymentMethod:string;account:'ready'|'check_email'|null;detail:boolean;mode?:string;currency?:string;dueNowAmount?:number;recurringAmount?:number;recurringDescription?:string|null;items?:Array<{description:string;quantity:number;amount:number;billingType:string}>;subscriptions?:Array<{accessStatus:string;currentPeriodEnd:string|null}>};

/** The order-scoped proof checkout returned to this browser. It opens this one receipt and nothing else. */
function receiptProof(orderId:string):string {
 try { return sessionStorage.getItem('wsj-receipt:' + orderId) || ''; } catch { return ''; }
}

/**
 * Checkout result for the billing catalog. Access is never claimed from the browser redirect:
 * the page shows "processing" until the backend has recorded Stripe's confirmation (by webhook,
 * or by the server asking Stripe directly).
 */
export function OrderStatus({id}:{id:string}) {
 const [data, setData] = useState<OrderStatusBody | null>(null);
 const [notFound, setNotFound] = useState(false);
 const [timedOut, setTimedOut] = useState(false);
 const attempts = useRef(0);
 const cancellationComplete = useRef(false);
 const [hasProof, setHasProof] = useState(false);
 const [confirmCancel, setConfirmCancel] = useState(false);
 const [cancelling, setCancelling] = useState(false);
 const [cancelError, setCancelError] = useState('');

 useEffect(() => {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  async function poll() {
   try {
    const proof = receiptProof(id);
    setHasProof(Boolean(proof));
    const res = await fetch(apiUrl('/billing/orders/' + encodeURIComponent(id) + '/status'), {cache:'no-store', redirect:'error', credentials:'same-origin', headers: proof ? {'X-Order-Proof': proof} : undefined});
    if (cancelled) return;
    if (res.status === 404) { setNotFound(true); return; }
    if (!res.ok) throw new Error('request failed');
    const body: OrderStatusBody = await res.json();
    if (cancellationComplete.current) return;
    setData(body);
    attempts.current += 1;
    if (body.processing && attempts.current < MAX_ATTEMPTS) timer = setTimeout(poll, POLL_MS);
    else if (body.processing) setTimedOut(true);
   } catch {
    attempts.current += 1;
    if (!cancelled && attempts.current < MAX_ATTEMPTS) timer = setTimeout(poll, POLL_MS);
    else if (!cancelled) setTimedOut(true);
   }
  }
  void poll();
  return () => { cancelled = true; clearTimeout(timer); };
 }, [id]);

 async function cancelOrder() {
  const proof = receiptProof(id);
  if (!proof || cancelling) return;
  setCancelling(true);
  setCancelError('');
  try {
   const res = await fetch(apiUrl('/billing/orders/' + encodeURIComponent(id) + '/cancel'), {method:'POST', cache:'no-store', redirect:'error', credentials:'omit', headers:{'X-Order-Proof':proof}});
   if (!res.ok) throw new Error('not cancelled');
   const result: {status:string} = await res.json();
   if (result.status !== 'CANCELLED') throw new Error('not cancelled');
   cancellationComplete.current = true;
   setData(previous => previous ? {...previous, status:'CANCELLED', processing:false} : previous);
  } catch {
   setCancelError('We could not cancel this checkout. Your payment may already be processing. Refresh in a moment or contact us.');
  } finally { setCancelling(false); }
 }

 if (notFound) return <Card tone="neutral" eyebrow="Not found" title="We couldn't find that purchase."><p>Check the link in your email, or get in touch and we will look it up for you.</p><Actions><Primary href="/contact-us/">Contact us</Primary><Secondary href="/">Return home</Secondary></Actions></Card>;
 if (!data) return <Card tone="pending" eyebrow="One moment" title="Checking your payment…" live />;

 const amount = (minor:number) => money(minor/100, data.currency || 'usd');
 const summary = data.detail && data.items?.length ? (
  <dl className="bc-summary">
   {data.items.map((item, i) => <div key={i}><dt>{item.description}{item.quantity > 1 ? <span> × {item.quantity}</span> : null}</dt><dd>{amount(item.amount)}</dd></div>)}
   <div className="bc-total"><dt>{data.status === 'PAID' ? 'Paid today' : 'Due today'}</dt><dd>{amount(data.dueNowAmount ?? 0)}</dd></div>
  </dl>
 ) : null;

 if (data.status === 'PAID') return <Card tone="success" eyebrow="Payment confirmed" title="Thank you. You're all set.">
  <Steps paid />
  {summary}
  {data.detail && (data.recurringAmount ?? 0) > 0 && <p className="bc-note">Renews automatically at {amount(data.recurringAmount ?? 0)} {data.recurringDescription}. You can stop renewal any time from your account.</p>}
  {data.detail && data.subscriptions?.[0]?.currentPeriodEnd && <p className="bc-note">Your current paid period runs until {new Date(data.subscriptions[0].currentPeriodEnd).toLocaleDateString(undefined,{dateStyle:'medium'})}.</p>}
  {data.account === 'ready'
   ? <Actions><Primary href="/account/">Go to your dashboard</Primary><Secondary href="/">Back to the website</Secondary></Actions>
   : <>
      <div className="bc-callout"><Mail size={20} aria-hidden="true" /><div><strong>Check your email to finish setting up your account.</strong><p>We sent your receipt and a secure link to set your password. The link works once and expires in 24 hours.</p></div></div>
      <Actions><Primary href="/login/">Sign in</Primary><Secondary href="/login/">Didn&apos;t get the email?</Secondary></Actions>
     </>}
  <Reference id={data.id} />
 </Card>;

 if (data.paymentMethod === 'MANUAL') return <Card tone="warning" eyebrow="Awaiting payment" title="Your request is recorded.">
  <p>Our team will contact you to arrange payment. Nothing is active until payment is confirmed.</p>{summary}<Reference id={data.id} /></Card>;

 if (data.status === 'EXPIRED' || data.status === 'CANCELLED') return <Card tone="neutral" eyebrow={data.status === 'CANCELLED' ? 'Checkout canceled' : 'Checkout expired'} title="No payment was taken.">
  <p>This checkout {data.status === 'CANCELLED' ? 'was cancelled' : 'expired'} before payment completed, so nothing was charged.</p>
  <Actions><Primary href="/">Start again</Primary><Secondary href="/contact-us/">Need help?</Secondary></Actions></Card>;

 if (data.status === 'FAILED') return <Card tone="error" eyebrow="Payment failed" title="Your payment didn't go through.">
  <p>Nothing was charged and nothing was activated. You can try again with another card.</p>
  <Actions><Primary href="/">Try again</Primary><Secondary href="/contact-us/">Contact us</Secondary></Actions></Card>;

 if (timedOut) return <Card tone="warning" eyebrow="Still processing" title="Your payment is taking longer than usual.">
  <p>Nothing is lost: your purchase completes automatically as soon as the bank confirms, and we email you when it does. Refresh in a minute, or call <a href="tel:+17739861908">(773) 986-1908</a>.</p>
  {summary}<Reference id={data.id} /></Card>;

 const canCancel = data.status === 'PENDING' && data.paymentMethod === 'STRIPE' && data.detail && hasProof;
 return <Card tone="pending" eyebrow="Payment submitted" title="Confirming your payment…" live>
  <Steps paid={false} />
  <p>This usually takes a few seconds. Please keep this page open.</p>
  {summary}
  {canCancel && <div className="bc-cancel">
   {confirmCancel ? <>
    <p>Cancel this checkout? If your payment is already processing, it won&apos;t be canceled.</p>
    <div className="bc-actions">
     <button type="button" className="bc-btn bc-btn-danger" disabled={cancelling} onClick={() => void cancelOrder()}>{cancelling ? 'Canceling…' : 'Yes, cancel checkout'}</button>
     <button type="button" className="bc-btn bc-btn-secondary" disabled={cancelling} onClick={() => setConfirmCancel(false)}>Keep it</button>
    </div>
   </> : <button type="button" className="bc-textbtn" onClick={() => setConfirmCancel(true)}>Didn&apos;t mean to pay? Cancel this checkout</button>}
   {cancelError && <p className="bc-error" role="alert">{cancelError}</p>}
  </div>}
 </Card>;
}

export function BookingConfirmationClient() {
 const searchParams = useSearchParams();
 const booking = searchParams.get('booking') || undefined;
 const order = searchParams.get('order') || undefined;
 return (
  <div className="bc-wrap">
   {order
    ? <OrderStatus id={order}/>
    : booking
    ? <BookingStatus id={booking}/>
    : <Card tone="neutral" eyebrow="Missing reference" title="We couldn't find a booking in this link."><p>If you completed a payment and landed here by mistake, contact us and we will confirm it for you.</p><Actions><Primary href="/contact-us/">Contact us</Primary><Secondary href="/">Return home</Secondary></Actions></Card>}
  </div>
 );
}
