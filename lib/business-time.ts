/** Booking dates and clock times belong to the venue, not the visitor's device. */
export const BUSINESS_TIME_ZONE = 'America/Chicago';
const venueClock = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function venueParts(value: Date) {
  return Object.fromEntries(venueClock.formatToParts(value).map(part => [part.type, part.value]));
}
export function businessDateKey(now = new Date()): string {
  const parts = venueParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
/** Convert a venue-local YYYY-MM-DD / HH:mm into an instant, including daylight saving time. */
export function businessStartAt(date: string, time: string): string {
  const message = 'Choose a valid reservation date and time in Central Time.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(message);
  const clock = `${date}T${time}:00.000Z`;
  const desired = Date.parse(clock);
  if (!Number.isFinite(desired) || new Date(desired).toISOString() !== clock) throw new Error(message);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = venueParts(new Date(candidate));
    const observed = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`);
    const correction = desired - observed;
    if (correction === 0) return new Date(candidate).toISOString();
    candidate += correction;
  }
  // A spring-forward clock gap has no matching instant. Never silently move a booking an hour.
  throw new Error('That time does not exist in Central Time. Please choose another time.');
}
