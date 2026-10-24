// One account's in-memory favorite index. Both counting and UI pagination share requests.
// A total is published only after a complete scan; no guessed provider total fields.
export function createFavoritesCatalog(readPage, { limit = 50, maxPages = 2000 } = {}) {
  let version = 0;
  let total;
  let counting;
  const pages = new Map();
  const pending = new Map();
  const stale = () => new Error('收藏列表已刷新，请重新读取。');

  async function page(start = 0, pageLimit = limit) {
    const key = `${start}:${pageLimit}`;
    if (pages.has(key)) return { ...pages.get(key), total };
    if (pending.has(key)) return pending.get(key);
    const current = version;
    const request = Promise.resolve().then(() => readPage(start, pageLimit)).then(result => {
      if (current !== version) throw stale();
      pages.set(key, result);
      if (start === 0 && !result.hasMore) total = new Set(result.entryIds ?? result.tracks.map(track => track.id)).size;
      return { ...result, total };
    }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
    pending.set(key, request);
    return request;
  }

  return {
    invalidate() { version++; total = undefined; counting = undefined; pages.clear(); pending.clear(); },
    async page(start = 0, pageLimit = limit) {
      const result = await page(start, pageLimit);
      // Raw id/count fields are internal normalization evidence, not renderer DTOs.
      return { tracks: result.tracks, nextStart: result.nextStart, hasMore: result.hasMore, total: result.total };
    },
    summary() {
      if (total !== undefined) return Promise.resolve({ total });
      if (counting) return counting;
      const current = version;
      const scan = (async () => {
        const ids = new Set();
        let start = 0;
        for (let number = 0; number < maxPages; number++) {
          const result = await page(start, limit);
          if (current !== version) throw stale();
          const before = ids.size;
          for (const id of result.entryIds ?? result.tracks.map(track => track.id)) ids.add(id);
          if (!result.hasMore) {
            total = ids.size;
            return { total };
          }
          if (ids.size === before || result.nextStart <= start) throw new Error('收藏分页没有进展，尚不能确认总数。请刷新重试。');
          start = result.nextStart;
        }
        throw new Error('收藏分页达到安全上限，尚不能确认总数。');
      })();
      counting = scan;
      void scan.finally(() => { if (counting === scan) counting = undefined; }).catch(() => undefined);
      return scan;
    },
  };
}
