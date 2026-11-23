import {Injectable, ServiceUnavailableException} from '@nestjs/common';

export type KisiObject = {id: number; email?: string; name?: string; role_id?: string; assignee_id?: number; assignee_type?: string; applies_to_id?: number; applies_to_type?: string; valid_from?: string | null; valid_until?: string | null};
export class KisiApiError extends Error {
  constructor(public readonly status: number) { super(status === 401 || status === 403 ? 'Kisi rejected the API key or its permissions.' : status === 429 ? 'Kisi rate limit reached. Retry shortly.' : `Kisi request failed (${status || 'network timeout'}).`); }
}
/** Fixed HTTPS origin. Neither credentials nor provider response bodies are logged or returned. */
@Injectable()
export class KisiClient {
  private tail: Promise<unknown> = Promise.resolve();
  private lastCall = 0;
  get configured() { return Boolean(process.env.KISI_API_KEY?.trim()); }
  async request<T>(endpoint: string, method = 'GET', body?: unknown): Promise<T> {
    if (!this.configured) throw new ServiceUnavailableException('KISI_API_KEY is not configured on the server.');
    // The current working Kisi organization is a read-only reference. Live writes
    // require a separate explicit deployment opt-in; the local clone never sets it.
    // A temporary event search is a read; every other write needs the explicit live-sync opt-in.
    const eventSearch = method === 'POST' && endpoint === '/event_sets';
    if (method !== 'GET' && !eventSearch && process.env.KISI_LIVE_WRITES !== 'true') throw new ServiceUnavailableException('Live Kisi changes are locked. Use the isolated Workspace operations clone.');
    const readOnly = /^\/(groups|users|role_assignments|locks|readers|controllers|places|floors|elevators|terminals|group_links|group_locks|cards|guests|event_sets|organization)(?:[/?]|$)/;
    if (!readOnly.test(endpoint)) throw new Error('Unsupported Kisi endpoint');
    // Writes are limited to the access-sync endpoints; everything else is monitor-only.
    if (method !== 'GET' && !(method === 'POST' && endpoint === '/event_sets') && !/^\/(users|role_assignments)(?:[/?]|$)/.test(endpoint)) throw new Error('Kisi writes are only allowed for access sync.');
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 300 - (Date.now() - this.lastCall))));
        this.lastCall = Date.now();
        let response: Response;
        try {
          response = await fetch('https://api.kisi.io' + endpoint, {method, headers: {Authorization: 'KISI-LOGIN ' + process.env.KISI_API_KEY!.trim(), Accept: 'application/json', 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(10000), redirect: 'error'});
        } catch {
          // A dropped connection is retried only for reads; a write may already have been applied.
          if ((method === 'GET' || (method === 'POST' && endpoint === '/event_sets')) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); continue; }
          throw new KisiApiError(0);
        }
        // Reads (and the read-only event search) retry temporary gateway errors; writes never retry.
        const safeRetry = method === 'GET' || (method === 'POST' && endpoint === '/event_sets');
        if ((response.status === 429 || (safeRetry && [502, 503, 504].includes(response.status))) && attempt < 2) {
          const retry = Number(response.headers.get('retry-after'));
          await new Promise(resolve => setTimeout(resolve, Math.min(10000, Math.max(1000 * 2 ** attempt, Number.isFinite(retry) ? retry * 1000 : 0))));
          continue;
        }
        if (!response.ok) throw new KisiApiError(response.status);
        if (response.status === 204 || method === 'DELETE') return undefined as T;
        try { return await response.json() as T; } catch { throw new KisiApiError(502); }
      }
      throw new KisiApiError(429);
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }
  async list(endpoint: string): Promise<KisiObject[]> {
    const items: KisiObject[] = [];
    for (let offset = 0; offset <= 20000; offset += 100) {
      const page = await this.request<KisiObject[]>(endpoint + (endpoint.includes('?') ? '&' : '?') + 'limit=100&offset=' + offset);
      if (!Array.isArray(page) || page.some(row => !Number.isSafeInteger(row.id))) throw new KisiApiError(502);
      items.push(...page);
      if (page.length < 100) return items;
    }
    // Never silently treat a partial list as complete, especially before offboarding.
    throw new Error('Kisi returned too many records to safely reconcile. Contact support.');
  }
  async remove(id: string) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid Kisi assignment ID');
    try { await this.request('/role_assignments/' + id, 'DELETE'); } catch (error) { if (!(error instanceof KisiApiError && error.status === 404)) throw error; }
  }
}
