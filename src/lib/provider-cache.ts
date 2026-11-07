/** Public station-area data only. Never use this cache for guest origins or journeys. */
export class PublicVenueCache<T> {
  private readonly entries = new Map<string, { until: number; result: Promise<T> }>();

  constructor(private readonly ttlMs = 15 * 60_000, private readonly capacity = 32, private readonly clock = Date.now) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.until > this.clock()) return existing.result;
    this.entries.delete(key);
    for (const [candidate, entry] of this.entries) {
      if (entry.until <= this.clock()) this.entries.delete(candidate);
    }
    if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    const entry = { until: this.clock() + 30_000, result: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    void entry.result.then(() => {
      if (this.entries.get(key) === entry) entry.until = this.clock() + this.ttlMs;
    }, () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.result;
  }
}

/** Bound accumulation while streaming; Content-Length alone cannot be trusted. */
export async function boundedJson(response: Response, maxBytes = 2_000_000): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty provider response');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let source = '';
  try {
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes) throw new Error('Provider response exceeds limit');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Provider response exceeds limit');
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    return JSON.parse(source) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
