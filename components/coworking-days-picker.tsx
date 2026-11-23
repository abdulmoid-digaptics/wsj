'use client';
/**
 * Coworking day picker.
 * - FLEX (Bronze 1, Silver 5, Gold 10): pick exactly `count` days, any order, all inside one
 *   `windowDays` window counted from the earliest chosen day.
 * - CONSECUTIVE (Platinum): pick a start date; the next `windowDays` days are highlighted.
 * Availability (closed days, fully booked days, same-day notice) comes from the server; the
 * server re-checks everything at checkout, so this is guidance, not the authority.
 */
import {useEffect, useMemo, useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {apiUrl} from '@/lib/public-api';
import {businessDateKey} from '@/lib/business-time';
import './coworking-days-picker.css';

export type CoworkAllowance = {mode: 'FLEX'; count: number} | {mode: 'CONSECUTIVE'; count: number};

export function coworkAllowance(metadata: Record<string, unknown> | undefined | null): CoworkAllowance | null {
  const credits = metadata && Array.isArray(metadata.includedCredits) ? (metadata.includedCredits as Array<Record<string, unknown>>) : [];
  const c = credits.find(x => x && x.kind === 'COWORKING_DAY');
  if (!c) return null;
  if (c.unlimited === true) return {mode: 'CONSECUTIVE', count: 1};
  const n = Number(c.amount);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? {mode: 'FLEX', count: n} : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const addDaysKey = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const spanDays = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const prettyDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'});

const cache = new Map<string, Promise<{windowDays: number; blocked: Record<string, string>}>>();
function loadMonth(from: string, to: string) {
  const key = from + ':' + to;
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch(apiUrl('/public/coworking-days/calendar?from=' + from + '&to=' + to), {cache: 'no-store'})
      .then(r => (r.ok ? r.json() : {days: [], config: {windowDays: 30}}))
      .then((b: {days?: Array<{date: string; reason: string}>; config?: {windowDays?: number}}) => ({windowDays: b.config?.windowDays ?? 30, blocked: Object.fromEntries((b.days ?? []).map(d => [d.date, d.reason]))}))
      .catch(() => ({windowDays: 30, blocked: {}}));
    cache.set(key, hit);
    setTimeout(() => cache.delete(key), 30000);
  }
  return hit;
}

export function CoworkingDaysPicker({allowance, selected, onChange, windowStart, windowEnd, extraBlocked}: {
  allowance: CoworkAllowance;
  selected: string[];
  onChange: (days: string[]) => void;
  /** Dashboard date change: fixed window instead of one anchored on the first pick. */
  windowStart?: string;
  windowEnd?: string;
  extraBlocked?: Record<string, string>;
}) {
  const todayKey = businessDateKey();
  const startKey = windowStart && windowStart > todayKey ? windowStart : todayKey;
  const [yr, setYr] = useState(Number(startKey.slice(0, 4)));
  const [mo, setMo] = useState(Number(startKey.slice(5, 7)) - 1);
  const [state, setState] = useState<{windowDays: number; blocked: Record<string, string>}>({windowDays: 30, blocked: {}});
  useEffect(() => {
    let live = true;
    const last = new Date(yr, mo + 1, 0).getDate();
    loadMonth(`${yr}-${pad(mo + 1)}-01`, `${yr}-${pad(mo + 1)}-${pad(last)}`).then(r => live && setState(r));
    return () => {live = false;};
  }, [yr, mo]);
  const windowDays = state.windowDays;
  const blocked = useMemo(() => ({...state.blocked, ...(extraBlocked ?? {})}), [state.blocked, extraBlocked]);
  const sorted = [...selected].sort();
  const full = allowance.mode === 'FLEX' ? selected.length >= allowance.count : selected.length >= 1;
  const platinumRange = allowance.mode === 'CONSECUTIVE' && sorted[0] ? new Set(Array.from({length: windowDays}, (_, i) => addDaysKey(sorted[0], i))) : null;

  const reason = (d: string): string | null => {
    if (d < todayKey) return 'Past';
    if (windowStart && d < windowStart) return 'Outside your 30-day window';
    if (windowEnd && d > windowEnd) return 'Outside your 30-day window';
    if (blocked[d]) return blocked[d];
    if (allowance.mode === 'FLEX' && !selected.includes(d) && sorted.length) {
      const lo = d < sorted[0] ? d : sorted[0];
      const hi = d > sorted[sorted.length - 1] ? d : sorted[sorted.length - 1];
      if (spanDays(lo, hi) > windowDays - 1) return `All days must be within ${windowDays} days`;
    }
    return null;
  };
  const toggle = (d: string) => {
    if (allowance.mode === 'CONSECUTIVE') return onChange(selected[0] === d ? [] : [d]);
    if (selected.includes(d)) return onChange(selected.filter(x => x !== d));
    if (full) return;
    onChange([...selected, d].sort());
  };

  const first = new Date(yr, mo, 1).getDay();
  const count = new Date(yr, mo + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(first).fill(null), ...Array.from({length: count}, (_, i) => i + 1)];
  const key = (d: number) => `${yr}-${pad(mo + 1)}-${pad(d)}`;
  const prev = () => (mo === 0 ? (setMo(11), setYr(y => y - 1)) : setMo(m => m - 1));
  const next = () => (mo === 11 ? (setMo(0), setYr(y => y + 1)) : setMo(m => m + 1));
  const canPrev = `${yr}-${pad(mo + 1)}` > todayKey.slice(0, 7);

  return (
    <div className="bk-cal-card cw-picker">
      <div className="bk-cal-nav">
        <button type="button" className="bk-cal-nav-btn wj-control" onClick={prev} disabled={!canPrev} aria-label="Previous month"><ChevronLeft size={16} aria-hidden="true" /></button>
        <span className="bk-cal-month">{new Date(yr, mo).toLocaleString('en-US', {month: 'long', year: 'numeric'})}</span>
        <button type="button" className="bk-cal-nav-btn wj-control" onClick={next} aria-label="Next month"><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <div className="bk-cal-scroll">
        <div className="bk-cal-grid" key={`${yr}-${mo}`}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(n => <div key={n} className="bk-cal-day-name">{n}</div>)}
          {cells.map((d, i) => {
            if (d === null) return <div key={'e' + i} className="bk-cal-day empty" />;
            const k = key(d);
            const on = selected.includes(k);
            const why = on ? null : reason(k);
            const disabled = !on && (Boolean(why) || (full && allowance.mode === 'FLEX'));
            const inRange = platinumRange?.has(k) && !on;
            return (
              <button key={k} type="button" aria-pressed={on} disabled={disabled} title={why || undefined}
                className={['bk-cal-day', 'wj-control', on ? 'selected' : '', disabled ? 'past' : '', inRange ? 'cw-range' : '', k === todayKey && !on ? 'today' : ''].join(' ').trim()}
                aria-label={prettyDay(k) + (on ? ', selected' : why ? ', ' + why : '')}
                onClick={() => !disabled && toggle(k)}>
                {d}
              </button>
            );
          })}
        </div>
      </div>
      <p className="bk-cal-note">
        {allowance.mode === 'FLEX'
          ? `${selected.length} of ${allowance.count} day${allowance.count === 1 ? '' : 's'} chosen. ${allowance.count > 1 ? `Pick any days within ${windowDays} days of your first day. ` : ''}Grayed-out days are closed or fully booked.`
          : sorted[0] ? `Access runs ${windowDays} days in a row: ${prettyDay(sorted[0])} to ${prettyDay(addDaysKey(sorted[0], windowDays - 1))}.` : `Pick your start date. You get ${windowDays} consecutive days.`}
      </p>
    </div>
  );
}
