import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Copy, Heart, Home, ListMusic, Minus, Search, Square, X } from 'lucide-react';
import type { AppSettings, AuthStatus, LyricsCacheInfo, Playlist, Track } from '../shared/types';
import { api } from './lib/api';
import { usePlayer } from './lib/player';
import { FavoritesScreen, HomeScreen, LoginScreen } from './screens';
import { HallScreen, PlaylistScreen, PlaylistsScreen, SearchScreen, SettingsScreen, SidebarFooter } from './pages';
import { MiniPlayer, PlayerScreen } from './PlayerView';
import logo from './assets/app-icon.png';

type Route =
  | { name: 'home' }
  | { name: 'hall' }
  | { name: 'favorites' }
  | { name: 'playlists' }
  | { name: 'settings' }
  | { name: 'playlist'; playlist: Playlist }
  | { name: 'search'; query: string };

function WindowControls({ maximized }: { maximized: boolean }) {
  return (
    <div className="window-controls">
      <button type="button" className="window-button" onClick={() => void api.window.minimize()} aria-label="最小化" title="最小化">
        <Minus size={15} />
      </button>
      <button
        type="button"
        className="window-button"
        onClick={() => void api.window.toggleMaximize()}
        aria-label={maximized ? '还原' : '最大化'}
        title={maximized ? '还原' : '最大化'}
      >
        {maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button type="button" className="window-button is-close" onClick={() => void api.window.close()} aria-label="关闭" title="关闭">
        <X size={16} />
      </button>
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [searchQuery, setSearchQuery] = useState('');
  const [favFilter, setFavFilter] = useState('');
  const [maximized, setMaximized] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | undefined>(undefined);

  const [favorites, setFavorites] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [lyricsCache, setLyricsCache] = useState<LyricsCacheInfo | null>(null);
  const [quality, setQuality] = useState<AppSettings['quality']>('lossless');
  const [volume, setVolume] = useState(0.8);

  const toastTimer = useRef<number | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);
  const mainRef = useRef<HTMLElement | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const player = usePlayer({
    quality,
    volume,
    onError: showToast,
    onVolumeCommit: next => {
      setVolume(next);
      void api.updateSettings({ volume: next }).catch(() => undefined);
    },
  });

  const play = useCallback(
    (tracks: Track[], index: number) => {
      player.playFrom(tracks, index);
      setPlayerOpen(true);
    },
    [player],
  );

  // 启动：读登录态、设置；已登录就直接拉资料库。
  useEffect(() => {
    void (async () => {
      const status = await api.authStatus();
      if (status?.ok) setAuth(status.data);

      const loaded = await api.settings().catch(() => null);
      if (loaded) {
        setSettings(loaded);
        setQuality(loaded.quality);
        setVolume(loaded.volume);
      }
      setBooting(false);
    })();
  }, []);

  // 无边框窗口：跟踪最大化状态，双击标题栏也能同步图标。
  useEffect(() => {
    void api.window.isMaximized().then(setMaximized).catch(() => undefined);
    return api.window.onMaximized(setMaximized);
  }, []);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const [favs, hist] = await Promise.all([
        api.favorites().catch(error => {
          setLibraryError(error instanceof Error ? error.message : String(error));
          return { tracks: [] as Track[], total: 0 };
        }),
        api.history().catch(() => [] as Track[]),
      ]);
      setFavorites(favs.tracks);
      setTotal(favs.total);
      setHistory(hist);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth?.authenticated) void loadLibrary();
    else {
      setFavorites([]);
      setHistory([]);
      setTotal(0);
    }
  }, [auth?.authenticated, loadLibrary]);

  // 歌单列表：登录后拉一次，失败不阻塞主界面。
  useEffect(() => {
    if (!auth?.authenticated) {
      setPlaylists([]);
      return;
    }
    setPlaylistsLoading(true);
    api
      .playlists()
      .then(setPlaylists)
      .catch(() => undefined)
      .finally(() => setPlaylistsLoading(false));
  }, [auth?.authenticated]);

  // 搜索：停顿 350ms 再发请求，边打字边跳页面会很吵。
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) return;
    const timer = window.setTimeout(() => setRoute({ name: 'search', query }), 350);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // 进设置页时才统计歌词缓存。
  useEffect(() => {
    if (route.name !== 'settings') return;
    void api.lyricsCacheInfo().then(setLyricsCache).catch(() => undefined);
  }, [route.name]);

  // 换页回到顶部：从歌单滚到一半切到收藏，不该停在半截。
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route]);

  // 队列持久化：切歌/换队列后延迟落盘，避免频繁写。
  useEffect(() => {
    if (player.queue.length === 0) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api.saveQueue(player.queue, player.index, player.position);
    }, 1200);
    return () => window.clearTimeout(saveTimer.current);
  }, [player.queue, player.index]);

  // 空格：播放/暂停（输入框里不抢键）；Esc 收播放页。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        player.toggle();
      }
      if (event.key === 'Escape') setPlayerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  const handleLogin = useCallback(async () => {
    setLoginPending(true);
    setLoginMessage('正在打开华为登录页…');
    const unsubscribe = api.onAuthProgress(message => setLoginMessage(message));
    try {
      const result = await api.login();
      if (result.ok) {
        setAuth(result.data);
        if (result.data.authenticated) showToast('登录成功，正在读取你的收藏。');
      } else {
        showToast(result.error.message);
      }
    } catch {
      showToast('登录流程没有完成，请重试。');
    } finally {
      unsubscribe();
      setLoginPending(false);
      setLoginMessage(undefined);
    }
  }, [showToast]);

  const handleCancelLogin = useCallback(async () => {
    await api.cancelLogin().catch(() => null);
  }, []);

  const handleLogout = useCallback(async () => {
    const result = await api.logout().catch(() => null);
    if (result?.ok) {
      setAuth(null);
      setPlayerOpen(false);
      setRoute({ name: 'home' });
      showToast('已退出登录。');
    } else {
      showToast('退出登录没有成功。');
    }
  }, [showToast]);

  const handleToggleFavorite = useCallback(
    async (track: Track) => {
      try {
        const value = await api.setFavorite(track.id, false);
        if (!value) {
          setFavorites(current => current.filter(item => item.id !== track.id));
          setTotal(current => Math.max(0, current - 1));
          showToast('已取消收藏。');
        }
      } catch {
        showToast('取消收藏没有成功，请稍后再试。');
      }
    },
    [showToast],
  );

  const handleUpdateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      try {
        const next = await api.updateSettings(patch);
        setSettings(next);
        if (patch.quality) setQuality(next.quality);
      } catch {
        showToast('设置没有保存成功。');
      }
    },
    [showToast],
  );

  const handleCloseBehavior = useCallback(
    async (value: AppSettings['closeBehavior']) => {
      try {
        setSettings(await api.window.setCloseBehavior(value));
        showToast(value === 'tray' ? '关闭窗口后会收进托盘。' : '关闭窗口就直接退出。');
      } catch {
        showToast('关闭行为没有保存成功。');
      }
    },
    [showToast],
  );

  const handleClearLyrics = useCallback(
    async (local: boolean) => {
      try {
        setLyricsCache(await api.clearLyricsCache(local));
        showToast(local ? '本地导入的歌词已清空。' : '歌词缓存已清空。');
      } catch {
        showToast('清理失败，稍后再试。');
      }
    },
    [showToast],
  );

  const openFavorites = useCallback(() => {
    if (!auth?.authenticated) {
      showToast('先登录才能读取收藏。');
      return;
    }
    setRoute({ name: 'favorites' });
  }, [auth?.authenticated, showToast]);

  const openPlaylist = useCallback((playlist: Playlist) => {
    setRoute({ name: 'playlist', playlist });
  }, []);

  const authenticated = Boolean(auth?.authenticated);
  const displayName = auth?.displayName;

  if (booting) {
    return (
      <div className="boot-screen">
        <img src={logo} alt="" className="boot-logo" />
        <span>正在启动…</span>
      </div>
    );
  }

  return (
    <div className={`app${playerOpen ? ' is-player' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="" className="brand-icon" />
          <span className="brand-name">音乐</span>
        </div>

        {authenticated ? (
          <>
            <nav className="nav">
              <button
                type="button"
                className={`nav-item ${route.name === 'home' ? 'is-active' : ''}`}
                onClick={() => setRoute({ name: 'home' })}
              >
                <Home size={17} />
                首页
              </button>
              <button
                type="button"
                className={`nav-item ${route.name === 'hall' ? 'is-active' : ''}`}
                onClick={() => setRoute({ name: 'hall' })}
              >
                <Compass size={17} />
                音乐厅
              </button>
              <button
                type="button"
                className={`nav-item ${route.name === 'favorites' ? 'is-active' : ''}`}
                onClick={openFavorites}
              >
                <Heart size={17} />
                我的收藏
                {total > 0 ? <span className="nav-count">{total}</span> : null}
              </button>
              <button
                type="button"
                className={`nav-item ${route.name === 'playlists' || route.name === 'playlist' ? 'is-active' : ''}`}
                onClick={() => setRoute({ name: 'playlists' })}
              >
                <ListMusic size={17} />
                我的歌单
                {playlists.length > 0 ? <span className="nav-count">{playlists.length}</span> : null}
              </button>
            </nav>
          </>
        ) : null}

        {authenticated ? (
          <div className="sidebar-bottom">
            <SidebarFooter active={route.name === 'settings'} onOpenSettings={() => setRoute({ name: 'settings' })} />
          </div>
        ) : null}
      </aside>

      <div className="stage">
        <header className="titlebar">
          {authenticated ? (
            <label className="titlebar-search">
              <Search size={14} />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="搜索歌曲"
                spellCheck={false}
                aria-label="搜索歌曲"
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => {
                    setSearchQuery('');
                    setRoute({ name: 'home' });
                  }}
                  aria-label="清空搜索"
                >
                  <X size={13} />
                </button>
              ) : null}
            </label>
          ) : null}
          <WindowControls maximized={maximized} />
        </header>

        <main className="main" ref={mainRef}>
          {!authenticated ? (
            <LoginScreen pending={loginPending} message={loginMessage} onLogin={() => void handleLogin()} />
          ) : route.name === 'home' ? (
            <HomeScreen
              history={history}
              favorites={favorites}
              total={total}
              loading={libraryLoading}
              displayName={displayName}
              currentId={player.current?.id}
              playing={player.playing}
              onPlay={play}
              onOpenFavorites={openFavorites}
            />
          ) : route.name === 'hall' ? (
            <HallScreen
              favorites={favorites}
              history={history}
              playlists={playlists}
              loading={playlistsLoading}
              currentId={player.current?.id}
              playing={player.playing}
              onPlay={play}
              onOpenPlaylist={openPlaylist}
              onSearchArtist={name => setSearchQuery(name)}
            />
          ) : route.name === 'favorites' ? (
            <FavoritesScreen
              tracks={favorites}
              total={total}
              loading={libraryLoading}
              currentId={player.current?.id}
              playing={player.playing}
              filter={favFilter}
              onFilterChange={setFavFilter}
              onPlay={play}
              onToggleFavorite={track => void handleToggleFavorite(track)}
            />
          ) : route.name === 'playlists' ? (
            <PlaylistsScreen playlists={playlists} loading={playlistsLoading} onOpen={openPlaylist} />
          ) : route.name === 'playlist' ? (
            <PlaylistScreen
              key={route.playlist.id}
              playlist={route.playlist}
              currentId={player.current?.id}
              playing={player.playing}
              onPlay={play}
              onBack={() => setRoute({ name: 'playlists' })}
            />
          ) : route.name === 'search' ? (
            <SearchScreen
              key={route.query}
              query={route.query}
              currentId={player.current?.id}
              playing={player.playing}
              onPlay={play}
            />
          ) : (
            <SettingsScreen
              auth={auth}
              settings={settings}
              cache={lyricsCache}
              displayName={displayName}
              onUpdate={patch => void handleUpdateSettings(patch)}
              onCloseBehavior={value => void handleCloseBehavior(value)}
              onLogout={() => void handleLogout()}
              onLogin={() => void handleLogin()}
              onClearCache={local => void handleClearLyrics(local)}
              onQuit={() => void api.app.quit()}
            />
          )}
          {libraryError && authenticated ? <div className="inline-error">{libraryError}</div> : null}
        </main>
      </div>

      <MiniPlayer player={player} onExpand={() => setPlayerOpen(true)} />

      {playerOpen && <PlayerScreen player={player} onClose={() => setPlayerOpen(false)} />}

      {loginPending ? (
        <div className="login-strip">
          <span>{loginMessage ?? '正在打开华为登录页…'}</span>
          <button type="button" className="ghost-button" onClick={() => void handleCancelLogin()}>
            取消登录
          </button>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
