// Small DTO cache only; never accepts provider payloads, credentials or playback URLs.
export const CACHE_MAX_BYTES = 5 * 1024 * 1024;
export function updateLibraryCache(cache, key, data, now = Date.now()) {
  const entries = cache && typeof cache === 'object' && !Array.isArray(cache) ? { ...cache } : {};
  delete entries[key];
  entries[key] = { savedAt: now, data };
  while (Buffer.byteLength(JSON.stringify(entries)) > CACHE_MAX_BYTES) {
    const oldest = Object.keys(entries)[0];
    if (!oldest) break;
    delete entries[oldest];
  }
  return entries;
}
export function cachedLibraryData(cache, key) {
  const entry = cache?.[key];
  if (!entry || !Number.isFinite(entry.savedAt) || !entry.data || typeof entry.data !== 'object') return null;
  return { ...entry.data, cacheHint: '离线缓存，可能不是最新；请恢复网络后刷新。' };
}
