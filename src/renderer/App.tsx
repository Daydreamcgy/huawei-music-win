import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Disc3, Heart, Home, LogOut, Minus, Search, Square, X } from 'lucide-react';
import type { AppSettings, AuthStatus, Track } from '../shared/types';
import { api } from './lib/api';
import { usePlayer } from './lib/player';
import { FavoritesScreen, HomeScreen, LoginScreen } from './screens';
import { MiniPlayer, PlayerScreen } from './PlayerView';
import logo from './assets/app-icon.png';

type Route = 'home' | 'favorites';

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
  const [route, setRoute] = useState<Route>('home');
  const [search, setSearch] = useState('');
  const [maximized, setMaximized] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | undefined>(undefined);

  const [favorites, setFavorites] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [quality, setQuality] = useState<AppSettings['quality']>('lossless');
  const [volume, setVolume] = useState(0.8);

  const toastTimer = useRef<number | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);

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

  // 启动：读登录态、设置；已登录就直接拉资料库。
  useEffect(() => {
    void (async () => {
      const status = await api.authStatus();
      if (status?.ok) setAuth(status.data);

      const settings = await api.settings().catch(() => null);
      if (settings) {
        setQuality(settings.quality);
        setVolume(settings.volume);
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

  const openFavorites = useCallback(() => {
    if (!auth?.authenticated) {
      showToast('先登录才能读取收藏。');
      return;
    }
    setRoute('favorites');
  }, [auth?.authenticated, showToast]);

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
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="" className="brand-icon" />
          <span className="brand-name">音乐</span>
        </div>

        <nav className="nav">
          <button type="button" className={`nav-item ${route === 'home' ? 'is-active' : ''}`} onClick={() => setRoute('home')}>
            <Home size={17} />
            首页
          </button>
          <button type="button" className={`nav-item ${route === 'favorites' ? 'is-active' : ''}`} onClick={openFavorites}>
            <Heart size={17} />
            我的收藏
            {total > 0 ? <span className="nav-count">{total}</span> : null}
          </button>
        </nav>

        <div className="sidebar-bottom">
          {authenticated ? (
            <div className="account">
              <span className="avatar">{displayName?.[0] ?? '华'}</span>
              <div className="account-text">
                <span className="account-name">{displayName ?? '已登录'}</span>
                <span className="account-sub">华为账号</span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => void handleLogout()}
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button type="button" className="ghost-button" onClick={() => void handleLogin()} disabled={loginPending}>
              <Disc3 size={15} /> 登录华为账号
            </button>
          )}
        </div>
      </aside>

      <div className="stage">
        <header className="titlebar">
          <label className="titlebar-search">
            <Search size={14} />
            <input
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                if (event.target.value.trim()) setRoute('favorites');
              }}
              placeholder="搜索我的收藏"
              spellCheck={false}
              aria-label="搜索我的收藏"
            />
            {search ? (
              <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="清空搜索">
                <X size={13} />
              </button>
            ) : null}
          </label>
          <WindowControls maximized={maximized} />
        </header>

        <main className="main">
          {!authenticated ? (
            <LoginScreen pending={loginPending} message={loginMessage} onLogin={() => void handleLogin()} />
          ) : route === 'home' ? (
            <HomeScreen
              history={history}
              favorites={favorites}
              total={total}
              loading={libraryLoading}
              displayName={displayName}
              currentId={player.current?.id}
              playing={player.playing}
              onPlay={(tracks, index) => {
                player.playFrom(tracks, index);
                setPlayerOpen(true);
              }}
              onOpenFavorites={openFavorites}
            />
          ) : (
            <FavoritesScreen
              tracks={favorites}
              total={total}
              loading={libraryLoading}
              currentId={player.current?.id}
              playing={player.playing}
              filter={search}
              onFilterChange={setSearch}
              onPlay={(tracks, index) => {
                player.playFrom(tracks, index);
                setPlayerOpen(true);
              }}
              onToggleFavorite={track => void handleToggleFavorite(track)}
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
