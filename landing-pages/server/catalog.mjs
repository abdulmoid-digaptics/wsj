/**
 * Server-side price catalog. The only source of truth for what gets charged.
 * The browser sends a plan id and (for hourly plans) a number of hours. It never sends a price.
 * Amounts are whole US cents.
 */

export const CURRENCY = 'usd';

/** @typedef {{
 *   id: string, offer: string, offerName: string, name: string, description: string,
 *   unitAmount: number, mode: 'payment' | 'subscription', interval?: 'month',
 *   unitLabel: string, minQuantity: number, maxQuantity: number, defaultQuantity: number,
 *   commitmentMonths?: number, promoLimitEnv?: string, promoLimitDefault?: number,
 *   claimedBaseEnv?: string, image: string, page: string
 * }} Plan */

/** @type {Plan[]} */
export const PLANS = [
  {
    id: 'podcast-starter', offer: 'podcast', offerName: 'Podcast Studio Thanksgiving Special',
    name: 'Podcast Studio - Starter', description: 'Professional studio setup, high-quality audio & video. Thanksgiving rate, 3-hour minimum.',
    unitAmount: 12000, mode: 'payment', unitLabel: 'hour', minQuantity: 3, maxQuantity: 12, defaultQuantity: 3,
    image: 'podcast-hero.webp', page: 'podcast-studio.html'
  },
  {
    id: 'podcast-standard', offer: 'podcast', offerName: 'Podcast Studio Thanksgiving Special',
    name: 'Podcast Studio - Standard', description: 'Studio setup, high-quality audio & video, raw recording files. Thanksgiving rate, 3-hour minimum.',
    unitAmount: 15000, mode: 'payment', unitLabel: 'hour', minQuantity: 3, maxQuantity: 12, defaultQuantity: 3,
    image: 'podcast-hero.webp', page: 'podcast-studio.html'
  },
  {
    id: 'podcast-premium', offer: 'podcast', offerName: 'Podcast Studio Thanksgiving Special',
    name: 'Podcast Studio - Premium', description: 'Studio setup, audio & video, raw files, editing options, content batching. Thanksgiving rate, 3-hour minimum.',
    unitAmount: 19900, mode: 'payment', unitLabel: 'hour', minQuantity: 3, maxQuantity: 12, defaultQuantity: 3,
    image: 'podcast-hero.webp', page: 'podcast-studio.html'
  },
  {
    id: 'conference-5h', offer: 'conference', offerName: 'Conference Room Thanksgiving Special',
    name: 'Conference Room - 5-Hour Package', description: '5 prepaid conference room hours at $25/hour. Use across multiple meetings, subject to available slots.',
    unitAmount: 12500, mode: 'payment', unitLabel: 'package', minQuantity: 1, maxQuantity: 4, defaultQuantity: 1,
    image: 'conference-hero.webp', page: 'conference-room.html'
  },
  {
    id: 'boardroom-5h', offer: 'boardroom', offerName: 'Thanksgiving Boardroom Special',
    name: 'Boardroom - 5-Hour Package', description: '5 prepaid boardroom hours at $50/hour (regular $70). Schedule 1-, 2-, or 3-hour meetings later.',
    unitAmount: 25000, mode: 'payment', unitLabel: 'package', minQuantity: 1, maxQuantity: 4, defaultQuantity: 1,
    image: 'boardroom-video-call.webp', page: 'boardroom.html'
  },
  {
    id: 'dedicated-desk', offer: 'desk', offerName: 'Black Friday Dedicated Desk Offer',
    name: 'Dedicated Desk - Black Friday Rate', description: 'Reserved workstation, 24/7 access, business Wi-Fi, meeting room credits. 12-month membership.',
    unitAmount: 25000, mode: 'subscription', interval: 'month', unitLabel: 'month', minQuantity: 1, maxQuantity: 1, defaultQuantity: 1,
    commitmentMonths: 12, promoLimitEnv: 'DESK_PROMO_LIMIT', promoLimitDefault: 10, claimedBaseEnv: 'DESK_CLAIMED_BASE',
    image: 'desk-hero.webp', page: 'dedicated-desk.html'
  },
  {
    id: 'mailbox', offer: 'mailbox', offerName: 'Black Friday Mailbox Offer',
    name: 'Business Mailbox - Black Friday Rate', description: 'Real street address, secure mail & package handling. 12-month contract.',
    unitAmount: 2500, mode: 'subscription', interval: 'month', unitLabel: 'month', minQuantity: 1, maxQuantity: 1, defaultQuantity: 1,
    commitmentMonths: 12, promoLimitEnv: 'MAILBOX_PROMO_LIMIT', promoLimitDefault: 50, claimedBaseEnv: 'MAILBOX_CLAIMED_BASE',
    image: 'mailbox-hero.webp', page: 'mailbox.html'
  }
];

const BY_ID = new Map(PLANS.map(p => [p.id, p]));
export const getPlan = id => (typeof id === 'string' ? BY_ID.get(id) : undefined) || null;

export function promoLimit(plan, env = process.env) {
  if (!plan.promoLimitEnv) return null;
  const n = Number.parseInt(env[plan.promoLimitEnv] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : plan.promoLimitDefault;
}
export function claimedBase(plan, env = process.env) {
  if (!plan.claimedBaseEnv) return 0;
  const n = Number.parseInt(env[plan.claimedBaseEnv] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Validate a checkout request. Returns {ok:true, value} or {ok:false, error}.
 * Strict: unknown plan, out-of-range quantity, bad email, missing name all fail.
 */
export function validateCheckout(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid request.' };
  const plan = getPlan(body.planId);
  if (!plan) return { ok: false, error: 'Please choose a valid package.' };

  let quantity = body.quantity === undefined ? plan.defaultQuantity : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < plan.minQuantity || quantity > plan.maxQuantity) {
    return { ok: false, error: plan.unitLabel === 'hour'
      ? `Please choose between ${plan.minQuantity} and ${plan.maxQuantity} hours.`
      : `Please choose a quantity between ${plan.minQuantity} and ${plan.maxQuantity}.` };
  }

  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
  const name = str(body.name, 120);
  const email = str(body.email, 200).toLowerCase();
  const phone = str(body.phone, 40);
  const notes = str(body.notes, 450);
  const preferredDate = str(body.preferredDate, 10);

  if (name.length < 2) return { ok: false, error: 'Please enter your full name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
  if (phone && !/^[0-9+().\-\s]{7,40}$/.test(phone)) return { ok: false, error: 'Please enter a valid phone number.' };
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return { ok: false, error: 'Please enter a valid date.' };
  if (plan.commitmentMonths && body.acceptTerms !== true) {
    return { ok: false, error: `Please confirm the ${plan.commitmentMonths}-month commitment.` };
  }
  return { ok: true, value: { plan, quantity, name, email, phone, notes, preferredDate } };
}

/** Public, price-only view of the catalog for the browser. */
export function publicCatalog() {
  return PLANS.map(p => ({
    id: p.id, offer: p.offer, name: p.name, unitAmount: p.unitAmount, currency: CURRENCY, mode: p.mode,
    interval: p.interval || null, unitLabel: p.unitLabel, minQuantity: p.minQuantity, maxQuantity: p.maxQuantity,
    defaultQuantity: p.defaultQuantity, commitmentMonths: p.commitmentMonths || null
  }));
}
