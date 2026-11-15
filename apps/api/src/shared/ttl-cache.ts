// A cache for read endpoints that cost an RPC call or a scan of the database (/health, /stats, the
// first page of /questions). Two jobs: a value is reused for a few seconds, and requests that arrive
// while it is being loaded wait for that one load instead of each starting their own. The second
// matters more: the public Fuji RPC bans bursts (Cloudflare error 1015), and a ban stops settles too.
//
// A load that throws is never cached, and `shouldCache` lets a caller refuse to keep a value that
// only describes a failure (health with the RPC down), so recovery shows on the very next request.
export interface TtlCache<T> {
  get(key: string, load: () => Promise<T> | T, shouldCache?: (value: T) => boolean): Promise<T>;
}

export function createTtlCache<T>(ttlMs: number, now: () => number, maxEntries = 100): TtlCache<T> {
  const fresh = new Map<string, { value: T; expiresAt: number }>();
  const loading = new Map<string, Promise<T>>();

  return {
    async get(key, load, shouldCache = () => true) {
      const hit = fresh.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;

      const running = loading.get(key);
      if (running) return running;

      const started = (async () => load())();
      loading.set(key, started);
      try {
        const value = await started;
        if (shouldCache(value)) {
          // Bounded: the oldest key goes first, so a stream of distinct keys cannot grow it.
          if (fresh.size >= maxEntries && !fresh.has(key)) {
            const oldest = fresh.keys().next().value;
            if (oldest !== undefined) fresh.delete(oldest);
          }
          fresh.set(key, { value, expiresAt: now() + ttlMs });
        }
        return value;
      } finally {
        loading.delete(key);
      }
    },
  };
}
