// Account writes are serialized. An unknown outcome blocks a blind repeat until read-back
// resolves it; all callbacks use the caller's captured session, never a newly switched account.
export class WriteOutcomeError extends Error {
  constructor(message, kind = 'unknown') {
    super(message);
    this.name = 'WriteOutcomeError';
    this.kind = kind;
    this.retryable = false;
  }
}

const uncertain = message => new WriteOutcomeError(`${message}结果待确认；请刷新核对，不要重复提交。`);

/** @param {{ load: () => Promise<any>, save: (intent: any) => Promise<void> }} intentStore */
export function createWriteController(api, intentStore = { load: async () => null, save: async (_intent) => {} }) {
  let busy = false;
  let loadedIntent = false;
  let pendingCreate = null;
  const favoritePending = new Map();

  async function exclusive(action) {
    if (busy) throw new WriteOutcomeError('另一项账号写操作正在进行，请稍后再试。');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }

  async function owned(id) {
    const listing = await api.playlists();
    if (!listing.playlists.some(item => item.id === id && item.kind === 'owned')) {
      throw new WriteOutcomeError('只能修改当前账号中已确认的自建歌单。', 'permission');
    }
    return listing;
  }

  return {
    get busy() { return busy; },
    setFavorite(id, target) {
      return exclusive(async () => {
        let before;
        try { before = await api.favoriteExist(id); }
        catch { throw uncertain('收藏'); }
        if (favoritePending.has(id)) {
          const previousTarget = favoritePending.get(id);
          if (before !== previousTarget) throw uncertain('上一项收藏操作');
          favoritePending.delete(id);
        }
        if (before === target) return { favorite: before };
        favoritePending.set(id, target);
        try { await api.setFavorite(id, target); } catch { /* Read back even after a timeout. */ }
        let after;
        try { after = await api.favoriteExist(id); } catch { throw uncertain('收藏'); }
        if (after !== target) throw uncertain('收藏');
        favoritePending.delete(id);
        return { favorite: after };
      });
    },
    createPlaylist(name, trackIds) {
      return exclusive(async () => {
        if (!loadedIntent) {
          const stored = await intentStore.load();
          if (stored) {
            if (typeof stored.name !== 'string' || !Array.isArray(stored.baseline)) throw uncertain('上一项创建歌单操作');
            pendingCreate = { name: stored.name, baseline: new Set(stored.baseline), id: stored.id };
          }
          loadedIntent = true;
        }
        if (pendingCreate) {
          const listing = await api.playlists();
          const candidates = listing.playlists.filter(item => item.kind === 'owned'
            && !pendingCreate.baseline.has(item.id) && item.title === pendingCreate.name
            && (!pendingCreate.id || item.id === pendingCreate.id));
          if (candidates.length === 1 && (!listing.truncated || pendingCreate.id)) {
            const found = candidates[0];
            await intentStore.save(null);
            pendingCreate = null;
            return { id: found.id };
          }
          throw uncertain('上一项创建歌单操作');
        }
        const listing = await api.playlists();
        if (listing.truncated) throw new WriteOutcomeError('歌单列表尚未完整读取，无法建立创建基线。');
        pendingCreate = { name, baseline: new Set(listing.playlists.map(item => item.id)), id: undefined };
        await intentStore.save({ name, baseline: [...pendingCreate.baseline] });
        try { pendingCreate.id = await api.createPlaylist(name, trackIds); } catch { /* Never resend. */ }
        if (pendingCreate.id) await intentStore.save({ name, baseline: [...pendingCreate.baseline], id: pendingCreate.id });
        const expected = pendingCreate;
        let after;
        try { after = await api.playlists(); } catch { throw uncertain('创建歌单'); }
        const candidates = after.playlists.filter(item => item.kind === 'owned'
          && !expected.baseline.has(item.id) && item.title === name && (!expected.id || item.id === expected.id));
        if (candidates.length !== 1 || (after.truncated && !expected.id)) throw uncertain('创建歌单');
        await intentStore.save(null);
        pendingCreate = null;
        return { id: candidates[0].id };
      });
    },
    updateDescription(id, description) {
      return exclusive(async () => {
        await owned(id);
        const before = await api.playlistDetail(id);
        if ((before.playlist.description ?? '') === description) return { id };
        try { await api.updateDescription(id, description); } catch { /* Read back before reporting. */ }
        let after;
        try { after = await api.playlistDetail(id); } catch { throw uncertain('简介修改'); }
        if ((after.playlist.description ?? '') !== description) throw uncertain('简介修改');
        return { id };
      });
    },
    deletePlaylist(id) {
      return exclusive(async () => {
        await owned(id);
        try { await api.deletePlaylist(id); } catch { /* Timeout can still mean applied. */ }
        let after;
        try { after = await api.playlists(); } catch { throw uncertain('删除歌单'); }
        if (after.truncated || after.playlists.some(item => item.id === id)) throw uncertain('删除歌单');
        return { id };
      });
    },
  };
}
