/**
 * Flood protection for the Next.js proxy (Next 16's renamed middleware).
 *
 * A sliding-window counter per client IP, kept in this process's memory. It is a coarse volumetric guard that drops
 * floods before any server rendering happens; fine-grained limits for logins, checkout and forms live in the API.
 *
 * Two budgets per IP, both per 10 seconds by default:
 *   - "page":     document requests, Server Actions and Next route handlers (default 100)
 *   - "prefetch": RSC payloads and router prefetches, which a single page view can trigger by the dozen (default 400)
 *
 * Client IP: nginx overwrites X-Real-IP with the connecting address, so that header is trusted first. Otherwise the
 * right-most X-Forwarded-For entry (the one our proxy appended) is used; the left-most entry is client-controlled.
 *
 * Settings (environment): PROXY_RATE_LIMIT=off disables it, PROXY_RATE_LIMIT_PAGE / PROXY_RATE_LIMIT_PREFETCH set the
 * budgets and PROXY_RATE_LIMIT_WINDOW_MS the window.
 */
import {isIP} from 'node:net';

export type Bucket = 'page' | 'prefetch';
export type Decision = {allowed: true; limit: number; remaining: number; reset: number} | {allowed: false; limit: number; remaining: 0; reset: number; retryAfter: number};
type Counter = {start: number; current: number; previous: number};

export type HeaderSource = {get(name: string): string | null};

export function proxyClientIp(headers: HeaderSource): string {
  const real = (headers.get('x-real-ip') || '').trim();
  if (isIP(real)) return real;
  const chain = (headers.get('x-forwarded-for') || '').split(',').map(v => v.trim()).filter(Boolean);
  const last = chain[chain.length - 1];
  return last && isIP(last) ? last : 'unknown';
}

export function bucketFor(method: string, headers: HeaderSource): Bucket {
  if (method === 'GET' && (headers.get('rsc') || headers.get('next-router-prefetch') || headers.get('purpose') === 'prefetch')) return 'prefetch';
  return 'page';
}

export class SlidingWindowLimiter {
  private readonly counters = new Map<string, Counter>();
  constructor(private readonly windowMs: number, private readonly maxEntries = 20000) {}

  hit(key: string, limit: number, now = Date.now()): Decision {
    const w = this.windowMs;
    let c = this.counters.get(key);
    if (!c) {
      if (this.counters.size >= this.maxEntries) this.sweep(now);
      c = {start: now - (now % w), current: 0, previous: 0};
      this.counters.set(key, c);
    }
    const elapsedWindows = Math.floor((now - c.start) / w);
    if (elapsedWindows >= 1) {
      c.previous = elapsedWindows === 1 ? c.current : 0;
      c.current = 0;
      c.start += elapsedWindows * w;
    }
    const weight = 1 - (now - c.start) / w;
    const estimate = c.previous * weight + c.current;
    const reset = Math.max(1, Math.ceil((c.start + w - now) / 1000));
    if (estimate + 1 > limit) {
      /* Time until the weighted previous window has decayed enough to admit one more request. */
      const need = estimate + 1 - limit;
      const wait = c.previous > 0 ? Math.min(w, (need / c.previous) * w) : c.start + w - now;
      return {allowed: false, limit, remaining: 0, reset, retryAfter: Math.max(1, Math.ceil(wait / 1000))};
    }
    c.current += 1;
    return {allowed: true, limit, remaining: Math.max(0, Math.floor(limit - estimate - 1)), reset};
  }

  /** Drop idle entries; if still full, start over rather than grow without bound under an IP-spray attack. */
  private sweep(now: number) {
    for (const [key, c] of this.counters) if (now - c.start >= 2 * this.windowMs) this.counters.delete(key);
    if (this.counters.size >= this.maxEntries) this.counters.clear();
  }

  get size() { return this.counters.size; }
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const proxyRateLimitConfig = (env: Record<string, string | undefined> = process.env) => ({
  enabled: env.PROXY_RATE_LIMIT !== 'off',
  windowMs: num(env.PROXY_RATE_LIMIT_WINDOW_MS, 10000),
  page: num(env.PROXY_RATE_LIMIT_PAGE, 100),
  prefetch: num(env.PROXY_RATE_LIMIT_PREFETCH, 400),
});
