'use client';
/**
 * "Today": the admin home. Plain-language cards for what needs attention, what is coming up,
 * one-click shortcuts and a few business numbers. Works the same for Admin, Editor and Viewer
 * (shortcuts that change things are hidden for Viewers).
 */
import {useCallback, useEffect, useState} from 'react';
import {AlertTriangle, ArrowUpRight, BookOpen, CalendarDays, CheckCircle2, CreditCard, ExternalLink, LifeBuoy, Mail, MailWarning, MessageSquare, PenLine, RefreshCw, Tag} from 'lucide-react';
import './admin-simple.css';
import {ApiError, request} from './api';
import {Drawer, EmptyState, SkeletonCards, useToast} from './ui';

type Overview = {
  generatedAt: string;
  attention: {newInquiries: number; openSupport: number; pendingOrders: number; failedOrders: number; failedEmails: number};
  content: {scheduledPosts: number; draftPosts: number};
  business: {revenueMonthCents: number; paidOrdersMonth: number; activeSubscriptions: number; newCustomers30: number; subscribers: number; currency: string};
  today: {coworkingDays: number};
  upcoming: Array<{orderId: string; startAt: string; service: string; customer: string}>;
};

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const money = (cents: number, currency = 'usd') => new Intl.NumberFormat('en-US', {style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0}).format(cents / 100);
const when = (iso: string) => new Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(iso));

export function TodayDashboard({name, canWrite, onNavigate, onUnauthorized, onNewPost, onOpenInquiry}: {name: string; canWrite: boolean; onNavigate: (key: string) => void; onUnauthorized: () => void; onNewPost: () => void; onOpenInquiry?: (item: never) => void}) {
  const [tray, setTray] = useState<'inquiries' | 'failed' | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await request<Overview>('/admin/overview?fresh=1')); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onUnauthorized(); setError(e instanceof Error ? e.message : 'Could not load today’s summary.'); }
    finally { setLoading(false); }
  }, [onUnauthorized]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const a = data?.attention;
  const tasks = a ? [
    {key: 'inquiries', n: a.newInquiries, icon: MessageSquare, one: 'new website inquiry', many: 'new website inquiries', action: 'Triage', tray: 'inquiries' as const},
    {key: 'support', n: a.openSupport, icon: LifeBuoy, one: 'open support request', many: 'open support requests', action: 'Answer'},
    {key: 'billing/orders', n: a.pendingOrders, icon: CreditCard, one: 'checkout waiting for payment', many: 'checkouts waiting for payment', action: 'Review'},
    {key: 'billing/orders', n: a.failedOrders, icon: AlertTriangle, one: 'failed payment this week', many: 'failed payments this week', action: 'Resolve', tone: 'bad', tray: 'failed' as const},
    {key: 'support', n: a.failedEmails, icon: MailWarning, one: 'email that could not be delivered', many: 'emails that could not be delivered', action: 'See support', tone: 'bad'},
  ].filter(t => t.n > 0) : [];
  const date = new Intl.DateTimeFormat('en-US', {weekday: 'long', month: 'long', day: 'numeric'}).format(new Date());

  return (
    <div className="adm-today">
      <header className="adm-today-head">
        <div>
          <p className="adm-today-date">{date}</p>
          <div role="heading" aria-level={1} className="adm-today-h1">{greeting()}, {name.split(' ')[0] || 'there'}.</div>
          <p className="adm-today-sub">{loading && !data ? 'Checking what needs you today…' : tasks.length ? `${tasks.reduce((s, t) => s + t.n, 0)} thing${tasks.reduce((s, t) => s + t.n, 0) === 1 ? '' : 's'} need${tasks.reduce((s, t) => s + t.n, 0) === 1 ? 's' : ''} your attention.` : 'You are all caught up. Nothing is waiting for you.'}</p>
        </div>
        <button type="button" className="adm-button adm-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'adm-spin' : ''} />Refresh</button>
      </header>

      {error && <div className="adm-alert" role="alert">{error}<button className="adm-text-button" onClick={() => void load()}>Try again</button></div>}

      <section aria-labelledby="adm-today-todo" className="adm-today-block">
        <div role="heading" aria-level={2} className="adm-today-h2" id="adm-today-todo">Needs your attention</div>
        {tasks.length ? (
          <ul className="adm-todo">
            {tasks.map((t, i) => (
              <li key={t.key + i}>
                <button type="button" className={'adm-todo-item' + (t.tone === 'bad' ? ' is-bad' : '')} onClick={() => (t.tray ? setTray(t.tray) : onNavigate(t.key))}>
                  <span className="adm-todo-icon"><t.icon size={20} /></span>
                  <span className="adm-todo-text"><strong>{t.n}</strong> {t.n === 1 ? t.one : t.many}</span>
                  <span className="adm-todo-action">{t.action}<ArrowUpRight size={15} /></span>
                </button>
              </li>
            ))}
          </ul>
        ) : !loading && <div className="adm-allclear"><CheckCircle2 size={22} /><span>All clear. New inquiries, support requests and payment problems will show up here.</span></div>}
      </section>

      <div className="adm-today-grid">
        <section aria-labelledby="adm-today-up" className="adm-today-block adm-card-plain">
          <div role="heading" aria-level={2} className="adm-today-h2" id="adm-today-up">Coming up</div>
          <p className="adm-today-note"><CalendarDays size={16} /> {data ? `${data.today.coworkingDays} coworking ${data.today.coworkingDays === 1 ? 'member' : 'members'} booked in today` : '…'}</p>
          {data?.upcoming.length ? (
            <ul className="adm-upcoming">
              {data.upcoming.map(u => <li key={u.orderId + u.startAt}><span className="adm-up-when">{when(u.startAt)}</span><span className="adm-up-what"><strong>{u.service}</strong><small>{u.customer}</small></span></li>)}
            </ul>
          ) : data && <p className="adm-muted">No room or studio bookings in the next 7 days.</p>}
          <button type="button" className="adm-text-button" onClick={() => onNavigate('bookings')}>All bookings<ArrowUpRight size={15} /></button>
        </section>

        <section aria-labelledby="adm-today-quick" className="adm-today-block adm-card-plain">
          <div role="heading" aria-level={2} className="adm-today-h2" id="adm-today-quick">Quick actions</div>
          <div className="adm-quick">
            {canWrite && <button type="button" onClick={onNewPost}><PenLine size={18} />Write a blog post</button>}
            <button type="button" onClick={() => onNavigate('inquiries')}><MessageSquare size={18} />Read inquiries</button>
            {canWrite && <button type="button" onClick={() => onNavigate('marketing/coupons')}><Tag size={18} />Make a discount code</button>}
            {canWrite && <button type="button" onClick={() => onNavigate('marketing/campaigns')}><Mail size={18} />Email subscribers</button>}
            {canWrite && <button type="button" onClick={() => onNavigate('catalog/plans')}><CreditCard size={18} />Change a price</button>}
            <a href="/" target="_blank" rel="noreferrer"><ExternalLink size={18} />Open the website</a>
          </div>
        </section>
      </div>

      <section aria-labelledby="adm-today-num" className="adm-today-block">
        <div role="heading" aria-level={2} className="adm-today-h2" id="adm-today-num">This month</div>
        {loading && !data ? <SkeletonCards count={5} /> : <div className="adm-kpis">
          <button type="button" className="adm-kpi" onClick={() => onNavigate('billing/orders')}><span>Money in</span><strong>{data ? money(data.business.revenueMonthCents, data.business.currency) : '…'}</strong><small>{data ? `${data.business.paidOrdersMonth} paid order${data.business.paidOrdersMonth === 1 ? '' : 's'}` : ''}</small></button>
          <button type="button" className="adm-kpi" onClick={() => onNavigate('billing/subscriptions')}><span>Active memberships</span><strong>{data?.business.activeSubscriptions ?? '…'}</strong><small>Renewing subscriptions</small></button>
          <button type="button" className="adm-kpi" onClick={() => onNavigate('billing/orders')}><span>New customers</span><strong>{data?.business.newCustomers30 ?? '…'}</strong><small>Last 30 days</small></button>
          <button type="button" className="adm-kpi" onClick={() => onNavigate('marketing/subscribers')}><span>Newsletter subscribers</span><strong>{data?.business.subscribers ?? '…'}</strong><small>Confirmed</small></button>
          <button type="button" className="adm-kpi" onClick={() => onNavigate('blog')}><span>Blog</span><strong>{data ? data.content.scheduledPosts : '…'} <em>scheduled</em></strong><small>{data ? `${data.content.draftPosts} draft${data.content.draftPosts === 1 ? '' : 's'}` : ''}</small></button>
        </div>}
      </section>

      {tray === 'inquiries' && <InquiryTray canWrite={canWrite} onClose={() => { setTray(null); void load(); }} onOpen={onOpenInquiry} onAll={() => { setTray(null); onNavigate('inquiries'); }} />}
      {tray === 'failed' && <FailedTray onClose={() => setTray(null)} onAll={() => { setTray(null); onNavigate('billing/orders'); }} />}

      <p className="adm-today-tip"><BookOpen size={15} /> Tip: press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere to jump to any screen. Turn on <strong>Advanced menu</strong> at the bottom of the sidebar for technical screens.</p>
    </div>
  );
}

type Inq = {id: string; name: string; email: string; message: string; status: string; service?: string | null; createdAt: string};
/** New inquiries with one-click triage; "Open" shows the full triage drawer. */
function InquiryTray({canWrite, onClose, onOpen, onAll}: {canWrite: boolean; onClose: () => void; onOpen?: (item: never) => void; onAll: () => void}) {
  const toast = useToast();
  const [rows, setRows] = useState<Inq[] | null>(null);
  useEffect(() => { request<{items: Inq[]}>('/admin/inquiries?status=NEW&limit=20').then(r => setRows(r.items)).catch(() => setRows([])); }, []);
  async function set(row: Inq, status: string, label: string) {
    setRows(list => (list || []).filter(r => r.id !== row.id));
    try {
      await request('/admin/inquiries/' + row.id, {method: 'PATCH', body: JSON.stringify({status})});
      toast.push({tone: 'success', text: row.name + ': ' + label, undo: async () => { await request('/admin/inquiries/' + row.id, {method: 'PATCH', body: JSON.stringify({status: 'NEW'})}); setRows(list => [row, ...(list || [])]); }});
    } catch (e) { setRows(list => [row, ...(list || [])]); toast.push({tone: 'error', text: e instanceof Error ? e.message : 'Could not update.'}); }
  }
  return (
    <Drawer open title="New website inquiries" subtitle="Reply, mark contacted or close each one." onClose={onClose} footer={<button type="button" className="adm-button adm-secondary" onClick={onAll}>Open the full list</button>}>
      {!rows ? <SkeletonCards count={3} /> : !rows.length ? <EmptyState icon={<CheckCircle2 size={26} />} title="All inquiries handled" text="New messages from the contact form will appear here." /> : (
        <ul className="adm-tray">
          {rows.map(r => (
            <li key={r.id} className="adm-tray-item">
              <div className="adm-tray-head"><strong>{r.name || r.email}</strong><small>{new Date(r.createdAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}{r.service ? ' · ' + r.service : ''}</small></div>
              <div className="adm-tray-msg">{r.message}</div>
              <div className="adm-tray-actions">
                <a className="adm-button adm-secondary" href={'mailto:' + r.email + '?subject=' + encodeURIComponent('Re: your message to Workspace Junction')} onClick={() => canWrite && void set(r, 'CONTACTED', 'marked contacted')}><Mail size={15} />Reply</a>
                {canWrite && <button type="button" className="adm-button adm-secondary" onClick={() => void set(r, 'CONTACTED', 'marked contacted')}>Mark contacted</button>}
                {canWrite && <button type="button" className="adm-button adm-secondary" onClick={() => void set(r, 'CLOSED', 'closed')}>Close</button>}
                {onOpen && <button type="button" className="adm-text-button" onClick={() => onOpen(r as never)}>Open</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

type FailedOrder = {id: string; title: string; excerpt: string; customerEmail: string; dueNowAmount: number; currency: string; stripePaymentIntentId?: string | null; updatedAt: string};
/** Failed payments: what failed, who to contact, and where to look in Stripe. */
function FailedTray({onClose, onAll}: {onClose: () => void; onAll: () => void}) {
  const [rows, setRows] = useState<FailedOrder[] | null>(null);
  useEffect(() => { request<{items: FailedOrder[]}>('/admin/billing/orders?status=FAILED&limit=20').then(r => setRows(r.items)).catch(() => setRows([])); }, []);
  const stripeBase = 'https://dashboard.stripe.com' + (typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname) ? '/test' : '');
  return (
    <Drawer open title="Failed payments" subtitle="The card was declined or the checkout failed. Nothing was charged." onClose={onClose} footer={<button type="button" className="adm-button adm-secondary" onClick={onAll}>Open all orders</button>}>
      {!rows ? <SkeletonCards count={2} /> : !rows.length ? <EmptyState icon={<CheckCircle2 size={26} />} title="No failed payments" text="Failed checkouts from the last week will show here." /> : (
        <ul className="adm-tray">
          {rows.map(o => (
            <li key={o.id} className="adm-tray-item">
              <div className="adm-tray-head"><strong>{o.title}</strong><small>{money(o.dueNowAmount, o.currency)} · {new Date(o.updatedAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</small></div>
              <div className="adm-tray-msg">{o.excerpt}</div>
              <div className="adm-tray-actions">
                <a className="adm-button adm-secondary" href={'mailto:' + o.customerEmail + '?subject=' + encodeURIComponent('Your Workspace Junction payment did not go through') + '&body=' + encodeURIComponent('Hi,\n\nYour recent payment to Workspace Junction did not go through, so nothing was charged. You can try again here: https://workspacejunction.com/pricing/\n\nIf you prefer, reply to this email and we will help.\n\nWorkspace Junction · (773) 986-1908')}><Mail size={15} />Email customer</a>
                {o.stripePaymentIntentId && <a className="adm-button adm-secondary" href={stripeBase + '/payments/' + o.stripePaymentIntentId} target="_blank" rel="noreferrer"><ExternalLink size={15} />View in Stripe</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
