'use client';
/**
 * Customer support inbox: every "Ask for help", refund, reschedule and closure request a
 * signed-in customer sends from their account. Staff read the message, reply by email and
 * move the request through Open -> In progress -> Resolved.
 */
import {useCallback, useEffect, useState} from 'react';
import {Check, LifeBuoy, Mail, RefreshCw, X} from 'lucide-react';
import {ApiError, request} from './api';

type SupportRequest = {id: string; type: string; subject: string; message: string; reference: string | null; status: string; createdAt: string; updatedAt: string; customerName: string; customerEmail: string};
const TYPE_LABEL: Record<string, string> = {SUPPORT: 'Help request', REFUND: 'Refund request', RESCHEDULE: 'Reschedule', BOOKING_CANCELLATION: 'Booking cancellation', OTHER: 'Other', CLOSURE: 'Account closure', CLAIM_DISPUTE: 'Purchase not recognised'};
const STATUS_LABEL: Record<string, string> = {OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved'};
const when = (value: string) => new Date(value).toLocaleString(undefined, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'});

export default function SupportInbox({canWrite, onUnauthorized}: {canWrite: boolean; onUnauthorized: () => void}) {
  const [items, setItems] = useState<SupportRequest[]>([]);
  const [open, setOpen] = useState(0);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<SupportRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await request<{items: SupportRequest[]; open: number}>('/admin/accounts/support-requests' + (filter ? '?status=' + filter : ''));
        if (cancelled) return;
        setItems(data.items ?? []);
        setOpen(data.open ?? 0);
        setError('');
      } catch (loadError) {
        if (cancelled) return;
        if (loadError instanceof ApiError && loadError.status === 401) onUnauthorized();
        setError(loadError instanceof Error ? loadError.message : 'Could not load support requests.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey, onUnauthorized]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadKey(key => key + 1);
  }, []);

  async function setStatus(item: SupportRequest, status: string) {
    setBusy(true);
    setError('');
    try {
      const updated = await request<SupportRequest>('/admin/accounts/support-requests/' + encodeURIComponent(item.id), {method: 'PATCH', body: JSON.stringify({status})});
      setSelected(current => (current && current.id === item.id ? {...current, status: updated.status} : current));
      setNotice('Marked "' + item.subject + '" as ' + (STATUS_LABEL[status] ?? status).toLowerCase() + '.');
      reload();
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) onUnauthorized();
      setError(saveError instanceof Error ? saveError.message : 'Could not update the request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="adm-alert" role="alert">{error}<button className="adm-text-button" onClick={reload}>Try again</button></div>}
      {notice && <div className="adm-success" role="status"><Check size={17} />{notice}<button className="adm-icon" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
      <section className="adm-table-card" aria-label="Customer support requests" aria-busy={loading}>
        <div className="adm-table-toolbar">
          <div className="adm-filter-row">
            <select aria-label="Filter by status" value={filter} onChange={event => { setLoading(true); setFilter(event.target.value); }}>
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
            </select>
            <span className="adm-record-count">{open} open · {items.length} shown</span>
            <button className="adm-button adm-secondary" disabled={loading} onClick={reload}><RefreshCw size={16} className={loading ? 'adm-spin' : ''} />Refresh</button>
          </div>
        </div>
        <div className="adm-table-scroll" tabIndex={0} role="region" aria-label="Support requests table">
          <table className="adm-table">
            <thead><tr><th>Customer</th><th>Request</th><th>Status</th><th>Received</th><th><span className="adm-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}><div className="adm-empty" role="status"><RefreshCw className="adm-spin" size={22} /><strong>Loading support requests…</strong></div></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5}><div className="adm-empty"><LifeBuoy size={30} /><strong>{filter ? 'No requests with this status' : 'No support requests yet'}</strong><p>Requests customers send with “Ask for help” in their account appear here.</p></div></td></tr>
              ) : items.map(item => (
                <tr key={item.id}>
                  <td><div className="adm-row-name"><span className="adm-row-avatar">{(item.customerName || item.customerEmail || '?').charAt(0).toUpperCase()}</span><div><strong>{item.customerName || 'Customer'}</strong><small>{item.customerEmail}</small></div></div></td>
                  <td className="adm-detail-cell"><strong>{TYPE_LABEL[item.type] ?? item.type}</strong> · {item.subject}</td>
                  <td><span className={'adm-badge adm-badge-' + (item.status === 'RESOLVED' ? 'published' : item.status === 'IN_PROGRESS' ? 'scheduled' : 'new')}>{STATUS_LABEL[item.status] ?? item.status}</span></td>
                  <td className="adm-date">{when(item.createdAt)}</td>
                  <td><div className="adm-row-actions"><button className="adm-text-button" onClick={() => setSelected(item)}>Open</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selected && (
        <div className="adm-overlay" onClick={event => { if (event.target === event.currentTarget && !busy) setSelected(null); }}>
          <section className="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="support-dialog-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) setSelected(null); }}>
            <header className="adm-dialog-head">
              <div><span className="adm-eyebrow">{(TYPE_LABEL[selected.type] ?? selected.type).toUpperCase()}</span><h2 id="support-dialog-title">{selected.subject}</h2></div>
              <button className="adm-icon" aria-label="Close" autoFocus disabled={busy} onClick={() => setSelected(null)}><X size={20} /></button>
            </header>
            <div className="adm-edit-form">
              <div className="adm-inquiry-detail">
                <h3>{selected.customerName || 'Customer'}</h3>
                <a href={'mailto:' + selected.customerEmail + '?subject=' + encodeURIComponent('Re: ' + selected.subject)}><Mail size={15} aria-hidden="true" /> {selected.customerEmail}</a>
                <p>Received {when(selected.createdAt)}{selected.reference ? ' · Reference ' + selected.reference : ''}</p>
                <p style={{whiteSpace: 'pre-wrap'}}>{selected.message}</p>
              </div>
              <footer className="adm-dialog-foot">
                <a className="adm-button adm-secondary" href={'mailto:' + selected.customerEmail + '?subject=' + encodeURIComponent('Re: ' + selected.subject)}><Mail size={16} />Reply by email</a>
                {canWrite && ['OPEN', 'IN_PROGRESS', 'RESOLVED'].filter(status => status !== selected.status).map(status => (
                  <button key={status} className={'adm-button ' + (status === 'RESOLVED' ? 'adm-primary' : 'adm-secondary')} disabled={busy} onClick={() => void setStatus(selected, status)}>
                    {status === 'RESOLVED' ? <Check size={16} /> : null}Mark {STATUS_LABEL[status].toLowerCase()}
                  </button>
                ))}
              </footer>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
