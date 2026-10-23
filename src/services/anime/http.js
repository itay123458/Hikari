export class ProviderError extends Error {
  constructor(provider, status) {
    super(`${provider} is unavailable${status ? ` (HTTP ${status})` : ''}. Please try again later.`);
    this.name = 'ProviderError';
    this.status = status;
  }
}

export class CachedHttp {
  constructor({ provider = 'Anime provider', interval = 1100, fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, maxEntries = 500, timeoutMs = 12000 } = {}) {
    Object.assign(this, { provider, interval, fetcher, sleep, now, maxEntries, timeoutMs });
    this.cache = new Map();
    this.inflight = new Map();
    this.tail = Promise.resolve();
    this.nextAt = 0;
  }

  async get(url, { ttl = 3600000, headers = {} } = {}) {
    const hit = this.cache.get(url);
    if (hit && hit.expires > this.now()) return structuredClone(hit.data);
    if (this.inflight.has(url)) return structuredClone(await this.inflight.get(url));
    const task = this.tail.catch(() => {}).then(async () => {
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.sleep(Math.max(0, this.nextAt - this.now()));
        this.nextAt = this.now() + this.interval;
        let response;
        try {
          response = await this.fetcher(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
        } catch {
          if (attempt === 2) throw new ProviderError(this.provider);
          await this.sleep(500 * 2 ** attempt);
          continue;
        }
        if (response.headers.get('X-RateLimit-Remaining') === '0') {
          const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
          if (Number.isFinite(reset)) this.nextAt = Math.max(this.nextAt, reset);
        }
        if (response.ok) {
          try { result = await response.json(); } catch { throw new ProviderError(this.provider); }
          break;
        }
        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new ProviderError(this.provider, response.status);
        const retry = response.headers.get('Retry-After');
        const wait = retry ? (/^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.now()) : 1000 * 2 ** attempt;
        this.nextAt = Math.max(this.nextAt, this.now() + Math.max(0, wait || 0));
        // Don't keep a Discord request hanging for a long provider cooldown.
        if (this.nextAt - this.now() > 30000) throw new ProviderError(this.provider, 429);
      }
      if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(url, { data: result, expires: this.now() + ttl });
      return result;
    });
    this.tail = task;
    this.inflight.set(url, task);
    try { return structuredClone(await task); }
    finally { this.inflight.delete(url); }
  }
}
