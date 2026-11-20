/** Preserve the existing coworking lead-time rule as catalog slugs evolve. */
export function blocksSameDayBooking(serviceSlug?: string, billingType?: string): boolean {
  return billingType === 'RECURRING' || serviceSlug === 'coworking' || serviceSlug === 'coworking-space';
}

/** Studios, events, workshops and webinars: earliest date is the day after tomorrow (server enforces the same). */
export const ADVANCE_BOOKING_SERVICES = new Set(['podcast-studio', 'photo-studio', 'events', 'workshops', 'webinars']);
export const ADVANCE_BOOKING_MESSAGE = 'Bookings must be made at least one full day in advance. The earliest available booking date is the day after tomorrow.';
export function advanceLeadDays(serviceSlug?: string): number {
  return serviceSlug && ADVANCE_BOOKING_SERVICES.has(serviceSlug) ? 2 : 0;
}
