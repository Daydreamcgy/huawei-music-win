// Short-lived in-process cache for library reads. It only holds normalized DTOs, never
// credentials or provider payloads, and disappears with the account or the app process.
export function createMemoryCache({ ttlMs = 5 * 60_000, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (now() - hit.savedAt > ttlMs) { entries.delete(key); return null; }
      return { data: hit.data, savedAt: hit.savedAt };
    },
    set(key, data) { entries.set(key, { data, savedAt: now() }); },
    invalidate(key) { entries.delete(key); },
    invalidatePrefix(prefix) {
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
    },
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
}
