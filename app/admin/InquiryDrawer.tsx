'use client';
/**
 * Inquiry triage slide-over: status flow (New → Contacted → Qualified → Closed), lead tags,
 * private note, assignment and quick-reply templates. Status changes are optimistic with Undo.
 */
import {useEffect, useState} from 'react';
import {Check, Mail, Phone, UserCheck} from 'lucide-react';
import {request} from './api';
import {Drawer, useToast} from './ui';

export type Inquiry = {id: string; name: string; email: string; phone?: string | null; service?: string | null; message: string; status: string; tags?: string[]; notes?: string | null; assignedTo?: string | null; createdAt: string; updatedAt?: string};
export const STEPS = [['NEW', 'New'], ['CONTACTED', 'Contacted'], ['QUALIFIED', 'Qualified'], ['CLOSED', 'Closed']] as const;
const LEGACY: Record<string, string> = {READ: 'CONTACTED', RESOLVED: 'CLOSED'};
export const stepOf = (s: string) => LEGACY[s] || s;
const TAGS = ['Hot lead', 'Tour requested', 'Pricing question', 'Coworking', 'Virtual office', 'Meeting room', 'Studio', 'Event', 'Follow up', 'Spam'];
const BUSINESS = 'Workspace Junction · (773) 986-1908 · grow@workspacejunction.com';
const TEMPLATES = [
  {id: 'thanks', label: 'Thanks, we will call you', subject: 'Thanks for contacting Workspace Junction', body: (n: string) => `Hi ${n},\n\nThanks for reaching out to Workspace Junction. We received your message and someone from our team will call you within one business day.\n\nIf it is easier, you can also reply to this email with a good time to talk.\n\nBest regards,\n${BUSINESS}`},
  {id: 'tour', label: 'Invite for a tour', subject: 'Come see Workspace Junction', body: (n: string) => `Hi ${n},\n\nWe would love to show you around. Tours take about 15 minutes and you can try the space for free afterwards.\n\nWhich day and time suit you best this week? We are at 1S280 Summit Ave Unit E2 Suite 1, Oakbrook Terrace, IL 60181.\n\nBest regards,\n${BUSINESS}`},
  {id: 'pricing', label: 'Send pricing', subject: 'Workspace Junction pricing', body: (n: string) => `Hi ${n},\n\nThanks for your interest. You can see all current plans and prices here: https://workspacejunction.com/pricing/\n\nHappy to recommend the best fit if you tell me a little about how you work.\n\nBest regards,\n${BUSINESS}`},
];

export function InquiryDrawer({item, me, canWrite, onClose, onChanged}: {item: Inquiry | null; me: string; canWrite: boolean; onClose: () => void; onChanged: (updated: Inquiry) => void}) {
  const toast = useToast();
  const [row, setRow] = useState<Inquiry | null>(item);
  const [notes, setNotes] = useState(item?.notes || '');
  useEffect(() => { const t = setTimeout(() => { setRow(item); setNotes(item?.notes || ''); }, 0); return () => clearTimeout(t); }, [item]);
  if (!row) return <Drawer open={false} title="" onClose={onClose}>{null}</Drawer>;

  async function patch(data: Partial<Inquiry>, label: string, undoable = true) {
    if (!row) return;
    const before = row;
    const next = {...row, ...data};
    setRow(next); onChanged(next);
    try {
      const saved = await request<Inquiry>('/admin/inquiries/' + row.id, {method: 'PATCH', body: JSON.stringify(data)});
      setRow(saved); onChanged(saved);
      toast.push({tone: 'success', text: label, undo: undoable ? async () => {
        const back: Partial<Inquiry> = {};
        for (const k of Object.keys(data) as Array<keyof Inquiry>) (back as Record<string, unknown>)[k] = before[k] ?? null;
        const restored = await request<Inquiry>('/admin/inquiries/' + row.id, {method: 'PATCH', body: JSON.stringify(back)});
        setRow(restored); onChanged(restored);
      } : undefined});
    } catch (e) {
      setRow(before); onChanged(before);
      toast.push({tone: 'error', text: e instanceof Error ? e.message : 'Could not save.'});
    }
  }
  const current = stepOf(row.status);
  const first = (row.name || '').split(' ')[0] || 'there';
  const mail = (t: typeof TEMPLATES[number]) => 'mailto:' + encodeURIComponent(row.email) + '?subject=' + encodeURIComponent(t.subject) + '&body=' + encodeURIComponent(t.body(first));

  return (
    <Drawer open title={row.name || row.email} subtitle={<>{row.service ? row.service + ' · ' : ''}Received {new Date(row.createdAt).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}</>} onClose={onClose}
      footer={<><a className="adm-button adm-secondary" href={'mailto:' + row.email}><Mail size={16} />Email</a>{row.phone && <a className="adm-button adm-secondary" href={'tel:' + row.phone}><Phone size={16} />Call</a>}<button type="button" className="adm-button adm-primary" onClick={onClose}>Done</button></>}>
      <div className="adm-inq">
        <div className="adm-inq-contact"><a href={'mailto:' + row.email}>{row.email}</a>{row.phone && <a href={'tel:' + row.phone}>{row.phone}</a>}</div>
        <div className="adm-inq-msg">{row.message}</div>

        <div className="adm-inq-label">Status</div>
        <div className="adm-steps" role="group" aria-label="Inquiry status">
          {STEPS.map(([k, label], i) => {
            const reached = STEPS.findIndex(s => s[0] === current) >= i;
            return <button key={k} type="button" disabled={!canWrite} className={'adm-step' + (current === k ? ' is-current' : reached ? ' is-done' : '')} aria-pressed={current === k} onClick={() => current !== k && void patch({status: k}, 'Marked as ' + label.toLowerCase() + '.')}>{reached && current !== k ? <Check size={14} /> : <span className="adm-step-n">{i + 1}</span>}{label}</button>;
          })}
        </div>

        <div className="adm-inq-label">Quick replies <small>(opens your email app; marks the inquiry contacted)</small></div>
        <div className="adm-templates">
          {TEMPLATES.map(t => <a key={t.id} className="adm-template" href={mail(t)} onClick={() => { if (canWrite && current === 'NEW') void patch({status: 'CONTACTED'}, 'Marked as contacted.'); }}><Mail size={15} />{t.label}</a>)}
        </div>

        <div className="adm-inq-label">Tags</div>
        <div className="adm-tags">
          {TAGS.map(tag => { const on = (row.tags || []).includes(tag); return <button key={tag} type="button" disabled={!canWrite} className={'adm-tag' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => void patch({tags: on ? (row.tags || []).filter(t => t !== tag) : [...(row.tags || []), tag]}, on ? 'Tag removed.' : 'Tagged ' + tag + '.', false)}>{tag}</button>; })}
        </div>

        <div className="adm-inq-label">Handled by</div>
        <div className="adm-inq-assign">
          <span>{row.assignedTo || 'Nobody yet'}</span>
          {canWrite && row.assignedTo !== me && <button type="button" className="adm-button adm-secondary" onClick={() => void patch({assignedTo: me}, 'Assigned to you.')}><UserCheck size={15} />Assign to me</button>}
          {canWrite && row.assignedTo && <button type="button" className="adm-text-button" onClick={() => void patch({assignedTo: null}, 'Unassigned.')}>Unassign</button>}
        </div>

        <div className="adm-inq-label">Private note</div>
        <textarea className="adm-inq-notes" rows={4} maxLength={4000} disabled={!canWrite} value={notes} placeholder="Only the team sees this. Saved when you click away." onChange={e => setNotes(e.target.value)} onBlur={() => { if ((row.notes || '') !== notes) void patch({notes: notes || null}, 'Note saved.', false); }} />
      </div>
    </Drawer>
  );
}
