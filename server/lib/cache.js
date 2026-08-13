// Well permit detail pages are slow to fetch and don't change often, so
// results are worth holding onto for a while instead of re-scraping on
// every request. This is a plain in-memory cache — fine for a single
// server process; swap for something shared (e.g. Redis) if this ever
// runs across multiple instances.
class TtlCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

module.exports = { TtlCache };
