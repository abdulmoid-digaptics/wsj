/**
 * WsjThrottlerGuard: the application-wide rate limiter.
 *
 * Client identity
 *   - Real client IP comes from Express (`trust proxy` = loopback), which reads X-Forwarded-For from the right and
 *     stops at the first address that is not our own nginx. The left-most X-Forwarded-For entry is NOT used: nginx
 *     appends to whatever the client sent, so that entry is attacker-controlled and would let anyone dodge limits.
 *   - CF-Connecting-IP is honoured only when TRUST_CLOUDFLARE_IP=true, i.e. when the site really sits behind
 *     Cloudflare. Today workspacejunction.com resolves straight to the VPS, so that header could be forged.
 *   - Staff requests carrying a valid, signature-checked JWT are keyed by `user:<id>` so colleagues behind one office
 *     IP do not share a budget. Unverified tokens are ignored (otherwise a fake token would be a free bypass).
 *
 * Responses
 *   - Standard RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset headers, alongside the existing X-RateLimit-*.
 *   - 429 responses carry Retry-After (seconds) and the standard error envelope from errors.ts (code RATE_LIMITED).
 *
 * Per-email cooldown
 *   - `@EmailCooldown(limit, ttlMs)` additionally limits public forms per submitted email address, so one address
 *     cannot be flooded from many IPs. The address is hashed before it is used as a key.
 */
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {ExecutionContext, Injectable, SetMetadata} from '@nestjs/common';
import {ThrottlerException, ThrottlerGuard} from '@nestjs/throttler';
import jwt from 'jsonwebtoken';

export const EMAIL_COOLDOWN = 'wsj:email-cooldown';
export const RATE_LIMIT_MESSAGE = 'Too many requests. Please slow down and try again shortly.';

/** Limit how often one email address may be submitted to a public form, regardless of IP. */
export const EmailCooldown = (limit: number, ttlMs: number) => SetMetadata(EMAIL_COOLDOWN, {limit, ttl: ttlMs});

const header = (req: any, name: string): string => {
  const value = req?.headers?.[name];
  return (Array.isArray(value) ? value[0] : value ?? '').toString().trim();
};

const normalise = (ip: string) => (ip.startsWith('::ffff:') ? ip.slice(7) : ip);

/** The connecting client's IP, resistant to spoofed forwarding headers. */
export function clientIp(req: any, env: NodeJS.ProcessEnv = process.env): string {
  if (env.TRUST_CLOUDFLARE_IP === 'true') {
    const cf = header(req, 'cf-connecting-ip');
    if (isIP(cf)) return normalise(cf);
  }
  const ip = typeof req?.ip === 'string' && req.ip ? req.ip : (req?.socket?.remoteAddress ?? '');
  return normalise(ip) || 'unknown';
}

/** `user:<id>` for a verified staff JWT, otherwise null. Never touches the database. */
export function verifiedUserKey(req: any, secret = process.env.JWT_SECRET): string | null {
  if (req?.user?.id) return 'user:' + req.user.id;
  if (!secret) return null;
  const auth = header(req, 'authorization');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req?.cookies?.access_token;
  if (typeof token !== 'string' || !token || token.length > 4096) return null;
  try {
    const payload = jwt.verify(token, secret, {algorithms: ['HS256']}) as jwt.JwtPayload;
    return typeof payload.sub === 'string' && payload.sub ? 'user:' + payload.sub : null;
  } catch {
    return null;
  }
}

/** IPv6 clients control a whole /64, so they are grouped by that prefix; IPv4 is used as-is. */
export function ipBucket(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return groups.slice(0, 4).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

export function trackerFor(req: any): string {
  return verifiedUserKey(req) ?? 'ip:' + ipBucket(clientIp(req));
}

@Injectable()
export class WsjThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return trackerFor(req);
  }

  /** Emit the IETF draft headers as well as the existing X-RateLimit-* ones. */
  protected setResponseHeader(res: any, name: string, value: string | number): void {
    super.setResponseHeader(res, name, value);
    if (name.startsWith('X-RateLimit-')) super.setResponseHeader(res, 'RateLimit-' + name.slice('X-RateLimit-'.length), value);
  }

  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException(RATE_LIMIT_MESSAGE);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = await super.canActivate(context);
    if (!allowed || context.getType() !== 'http') return allowed;
    const rule = this.reflector.getAllAndOverride<{limit: number; ttl: number} | undefined>(EMAIL_COOLDOWN, [context.getHandler(), context.getClass()]);
    if (!rule) return true;
    const {req, res} = this.getRequestResponse(context);
    const email = typeof req?.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) return true;
    const route = context.getClass().name + '.' + context.getHandler().name;
    const key = createHash('sha256').update('email-cooldown|' + route + '|' + email).digest('hex');
    const record = await this.storageService.increment(key, rule.ttl, rule.limit, rule.ttl, 'email');
    if (record.isBlocked) {
      this.setResponseHeader(res, 'Retry-After', record.timeToBlockExpire || record.timeToExpire);
      await this.throwThrottlingException();
    }
    return true;
  }
}
