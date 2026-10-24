import type {
  AppSettings,
  AuthStatus,
  LyricsDoc,
  Playback,
  Result,
  Track,
} from '../../shared/types';

/** 主进程返回的都是 Result<T>，这里统一拆包：失败就抛错，让调用方 catch 后弹 toast。 */
async function unwrap<T>(pending: Promise<Result<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** 收藏分页：主进程没有单次「全部」接口，这里按页拉完，上限防止意外长跑。 */
const FAVORITES_PAGE = 50;
const FAVORITES_LIMIT = 800;

export const api = {
  authStatus: () => window.desktop.auth.status().catch(() => null),
  login: () => window.desktop.auth.login(),
  cancelLogin: () => window.desktop.auth.cancelLogin(),
  logout: () => window.desktop.auth.logout(),
  onAuthProgress: (listener: (message: string) => void) => window.desktop.auth.onProgress(listener),

  history: async (): Promise<Track[]> => {
    const data = await unwrap(window.desktop.music.history());
    return data.tracks;
  },

  favorites: async (refresh = false): Promise<{ tracks: Track[]; total: number }> => {
    const tracks: Track[] = [];
    const seen = new Set<string>();
    let start = 0;
    let hasMore = true;

    while (hasMore && tracks.length < FAVORITES_LIMIT) {
      const page = await unwrap(
        window.desktop.music.favorites({ start, limit: FAVORITES_PAGE, refresh: refresh && start === 0 }),
      );
      for (const track of page.tracks) {
        if (seen.has(track.id)) continue;
        seen.add(track.id);
        tracks.push(track);
      }
      hasMore = page.hasMore && page.tracks.length > 0;
      start = page.nextStart;
    }

    let total = tracks.length;
    try {
      total = (await unwrap(window.desktop.music.favoritesSummary())).total;
    } catch {
      // 总数字段偶尔取不到，用已拉取数量兜底，不能因此判定加载失败。
    }
    return { tracks, total };
  },

  resolvePlayback: (trackId: string, quality: AppSettings['quality']): Promise<Playback> =>
    unwrap(window.desktop.music.resolvePlayback({ trackId, quality })),

  lyrics: (track: Track): Promise<LyricsDoc> =>
    unwrap(
      window.desktop.music.lyrics({
        trackId: track.id,
        title: track.title,
        artist: track.artists.map(item => item.name).join(' / '),
        album: track.album?.title,
        durationSeconds: track.durationSeconds,
      }),
    ),

  favoriteState: (trackId: string): Promise<boolean> =>
    unwrap(window.desktop.music.favoriteState({ trackId })).then(data => data.favorite),

  setFavorite: (trackId: string, favorite: boolean): Promise<boolean> =>
    unwrap(window.desktop.music.setFavorite({ trackId, favorite })).then(data => data.favorite),

  settings: () => unwrap(window.desktop.settings.get()),
  updateSettings: (patch: Partial<AppSettings>) => unwrap(window.desktop.settings.update(patch)),
  loadQueue: () => window.desktop.queue.load().catch(() => null),
  saveQueue: (tracks: Track[], index: number, positionSeconds: number) =>
    window.desktop.queue.save({ tracks, index, positionSeconds }).catch(() => null),

  window: {
    minimize: () => window.desktop.window.minimize().catch(() => undefined),
    toggleMaximize: () => window.desktop.window.toggleMaximize().catch(() => undefined),
    close: () => window.desktop.window.close().catch(() => undefined),
    isMaximized: () => window.desktop.window.isMaximized().catch(() => false),
    onMaximized: (listener: (maximized: boolean) => void) => window.desktop.window.onMaximized(listener),
  },
};

export type { AuthStatus, Track };
