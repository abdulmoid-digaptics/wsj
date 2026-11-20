/**
 * Minimum advance booking: studio, event, workshop and webinar bookings must start on or after
 * the day after tomorrow (venue time, America/Chicago), whatever the time of day now.
 * Monday 1:00 AM or 11:00 PM -> earliest date is Wednesday.
 */
import {BadRequestException} from '@nestjs/common';
import {venueDay} from './day-blocks';

export const ADVANCE_BOOKING_SERVICES: ReadonlySet<string> = new Set(['podcast-studio', 'photo-studio', 'events', 'workshops', 'webinars', 'meeting-rooms']);
export const ADVANCE_BOOKING_DAYS = 2;
export const ADVANCE_BOOKING_MESSAGE = 'Bookings must be made at least one full day in advance. The earliest available booking date is the day after tomorrow.';

const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function needsAdvanceBooking(service: string | null | undefined): boolean {
  return Boolean(service && ADVANCE_BOOKING_SERVICES.has(service));
}

/** Earliest bookable venue date (YYYY-MM-DD) for these services. */
export function earliestBookingDate(now = new Date()): string {
  return addDays(venueDay(now), ADVANCE_BOOKING_DAYS);
}

/** Venue dates in [from, to] that are too soon, for the public calendar. */
export function tooSoonDays(service: string, from: string, to: string, now = new Date()): Array<{date: string; reason: string; kind: 'notice'}> {
  if (!needsAdvanceBooking(service)) return [];
  const earliest = earliestBookingDate(now);
  const out: Array<{date: string; reason: string; kind: 'notice'}> = [];
  for (let d = from; d <= to && d < earliest; d = addDays(d, 1)) out.push({date: d, reason: ADVANCE_BOOKING_MESSAGE, kind: 'notice'});
  return out;
}

/** Throws a customer-readable 400 when a booking for these services starts too soon. */
export function assertAdvanceBooking(service: string | null | undefined, startAt: Date | string | null | undefined, now = new Date()) {
  if (!needsAdvanceBooking(service) || !startAt) return;
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  if (!Number.isFinite(start.getTime())) return;
  if (venueDay(start) < earliestBookingDate(now)) throw new BadRequestException(ADVANCE_BOOKING_MESSAGE);
}
