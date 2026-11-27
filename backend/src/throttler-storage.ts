/**
 * Throttler storage selection.
 *
 * - REDIS_URL set and the optional `ioredis` package installed: counters live in Redis, so limits are shared by
 *   every API process and survive PM2 restarts.
 * - Otherwise (local development, the single-process VPS today): the built-in in-memory store.
 *
 * Redis is never allowed to take the API down. If the client cannot be loaded or a Redis call fails, that request is
 * counted in memory instead and a warning is logged at most once a minute.
 */
import {createRequire} from 'node:module';
import {ThrottlerStorageService, type ThrottlerStorage} from '@nestjs/throttler';
import type {ThrottlerStorageRecord} from '@nestjs/throttler/dist/throttler-storage-record.interface';

/* One atomic round trip: count the hit, start the window on the first hit, and set/read the block key. */
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {hits, ttl, 1, blocked} end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}`;

type RedisLike = {eval(script: string, keys: number, ...args: (string | number)[]): Promise<unknown>; on?(event: string, cb: (e: unknown) => void): unknown};

const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

export class RedisThrottlerStorage implements ThrottlerStorage {
  private lastWarning = 0;
  constructor(private readonly redis: RedisLike, private readonly fallback: ThrottlerStorage = new ThrottlerStorageService(), private readonly prefix = 'wsj:rl:') {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const block = blockDuration > 0 ? blockDuration : ttl;
    try {
      const result = await this.redis.eval(SCRIPT, 2, this.prefix + throttlerName + ':' + key, this.prefix + throttlerName + ':' + key + ':block', ttl, limit, block) as number[];
      const [hits, ttlMs, isBlocked, blockMs] = result.map(Number);
      return {totalHits: hits, timeToExpire: seconds(ttlMs), isBlocked: isBlocked === 1, timeToBlockExpire: seconds(blockMs)};
    } catch (error) {
      if (Date.now() - this.lastWarning > 60000) {
        this.lastWarning = Date.now();
        console.warn('[throttler] Redis unavailable, counting this request in memory:', error instanceof Error ? error.message : String(error));
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}

export type ThrottlerStorageChoice = {storage: ThrottlerStorage; kind: 'redis' | 'memory'};

/** Never throws: any problem with Redis configuration results in the in-memory store. */
export function createThrottlerStorage(env: NodeJS.ProcessEnv = process.env, load: (id: string) => unknown = createRequire(__filename)): ThrottlerStorageChoice {
  const url = env.REDIS_URL?.trim();
  if (!url) return {storage: new ThrottlerStorageService(), kind: 'memory'};
  try {
    const mod = load('ioredis') as {default?: new (...a: unknown[]) => RedisLike} & (new (...a: unknown[]) => RedisLike);
    const Redis = (mod.default ?? mod) as new (url: string, options: Record<string, unknown>) => RedisLike;
    const client = new Redis(url, {maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000, lazyConnect: false});
    client.on?.('error', () => undefined); // reported per request by RedisThrottlerStorage; never crash the process
    console.log('[throttler] Using Redis-backed rate limit storage');
    return {storage: new RedisThrottlerStorage(client), kind: 'redis'};
  } catch (error) {
    console.warn('[throttler] REDIS_URL is set but Redis could not be used (' + (error instanceof Error ? error.message : String(error)) + '); falling back to in-memory rate limits. Install ioredis to enable Redis.');
    return {storage: new ThrottlerStorageService(), kind: 'memory'};
  }
}
