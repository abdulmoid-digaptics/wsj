/**
 * Durable, dependency-free order log.
 * - orders.jsonl: append-only record of every checkout created and every webhook outcome.
 * - Processed webhook event ids are rebuilt from the log at boot, so redelivered events are ignored.
 * - Short-lived holds stop promo-limited offers (first 10 desks / first 50 mailboxes) from overselling
 *   while a buyer is on the payment form.
 */
import fs from 'node:fs';
import path from 'node:path';

export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'orders.jsonl');
  const orders = new Map();          // orderId -> latest merged record
  const processedEvents = new Set(); // stripe event ids already handled
  const holds = new Map();           // orderId -> { planId, expiresAt }

  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.eventId) processedEvents.add(rec.eventId);
        if (rec.orderId) orders.set(rec.orderId, { ...(orders.get(rec.orderId) || {}), ...rec });
      } catch { /* skip a torn final line after a crash */ }
    }
  }

  function append(rec) {
    const row = { ...rec, at: new Date().toISOString() };
    fs.appendFileSync(file, JSON.stringify(row) + '\n', { encoding: 'utf8', mode: 0o600 });
    if (row.orderId) orders.set(row.orderId, { ...(orders.get(row.orderId) || {}), ...row });
    if (row.eventId) processedEvents.add(row.eventId);
    return row;
  }

  function sweepHolds(now = Date.now()) {
    for (const [id, h] of holds) if (h.expiresAt <= now) holds.delete(id);
  }

  return {
    file,
    append,
    get: id => orders.get(id) || null,
    findBySession: sessionId => {
      for (const o of orders.values()) if (o.sessionId === sessionId) return o;
      return null;
    },
    hasEvent: id => processedEvents.has(id),
    /** Paid orders for a plan (subscriptions count once they are paid). */
    paidCount: planId => {
      let n = 0;
      for (const o of orders.values()) if (o.planId === planId && o.status === 'paid') n++;
      return n;
    },
    hold: (orderId, planId, ttlMs) => holds.set(orderId, { planId, expiresAt: Date.now() + ttlMs }),
    release: orderId => holds.delete(orderId),
    heldCount: planId => {
      sweepHolds();
      let n = 0;
      for (const h of holds.values()) if (h.planId === planId) n++;
      return n;
    }
  };
}
