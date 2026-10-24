import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, ListMusic, LogIn, LogOut, Play, RefreshCw, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import type { AppSettings, AuthStatus, LyricsCacheInfo, Playlist, Track } from '../shared/types';
import { api } from './lib/api';
import { artistsOf, Cover, EmptyState, SectionHeader, SkeletonRows, TrackRow } from './ui';

type PlayHandler = (tracks: Track[], index: number) => void;

/* ── 通用小控件 ─────────────────────────────────────────── */

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={`segmented-item ${option.value === value ? 'is-active' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function SettingRow({ title, hint, control }: { title: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-title">{title}</span>
        {hint ? <span className="setting-hint">{hint}</span> : null}
      </div>
      <div className="setting-control">{control}</div>
    </div>
  );
}

/** 结果列表的「加载更多」，排在列表末尾。 */
function LoadMore({ loading, hasMore, onClick }: { loading: boolean; hasMore: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <button type="button" className="ghost-button load-more" onClick={onClick} disabled={loading}>
      {loading ? '正在加载…' : '加载更多'}
    </button>
  );
}

/** 稳定洗牌：同一个 seed 出同一批，点「换一批」只换 seed。 */
function pickPicks(tracks: Track[], seed: number, size: number): Track[] {
  if (tracks.length <= size) return tracks;
  const pool = tracks.slice();
  let state = seed * 9301 + 49297;
  for (let i = pool.length - 1; i > 0; i -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const j = Math.floor((state / 233280) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size);
}

/* ── 音乐厅 ─────────────────────────────────────────────── */

export function HallScreen({
  favorites,
  history,
  playlists,
  loading,
  currentId,
  playing,
  onPlay,
  onOpenPlaylist,
  onSearchArtist,
}: {
  favorites: Track[];
  history: Track[];
  playlists: Playlist[];
  loading: boolean;
  currentId?: string;
  playing: boolean;
  onPlay: PlayHandler;
  onOpenPlaylist: (playlist: Playlist) => void;
  onSearchArtist: (name: string) => void;
}) {
  const [seed, setSeed] = useState(1);

  // 从播放记录里聚合常听歌手（只按第一艺人算，够用且不会把合唱算重）。
  const artists = useMemo(() => {
    const map = new Map<string, { name: string; coverUrl?: string; plays: number }>();
    for (const track of history) {
      const first = track.artists[0];
      if (!first?.name) continue;
      const key = first.id ?? first.name;
      const hit = map.get(key);
      if (hit) hit.plays += 1;
      else map.set(key, { name: first.name, coverUrl: track.coverUrl, plays: 1 });
    }
    return [...map.values()].sort((a, b) => b.plays - a.plays).slice(0, 8);
  }, [history]);

  const picks = useMemo(() => pickPicks(favorites, seed, 18), [favorites, seed]);

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>音乐厅</h1>
          <p className="screen-sub">从你自己的曲库和播放记录里翻出来的内容</p>
        </div>
      </header>

      <section>
        <SectionHeader title="最近常听" subtitle={artists.length ? '按播放记录聚合的歌手' : undefined} />
        {artists.length ? (
          <div className="artist-row">
            {artists.map(artist => (
              <button type="button" key={artist.name} className="artist-card" onClick={() => onSearchArtist(artist.name)}>
                <Cover src={artist.coverUrl} size={92} radius={46} />
                <span className="artist-name">{artist.name}</span>
                <span className="artist-sub">播过 {artist.plays} 首</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="还没有播放记录" hint="听几首歌之后这里会长出歌手" />
        )}
      </section>

      <section>
        <SectionHeader title="我的歌单" subtitle={playlists.length ? `共 ${playlists.length} 个` : undefined} />
        {loading && playlists.length === 0 ? (
          <SkeletonRows count={2} />
        ) : playlists.length ? (
          <div className="card-grid">
            {playlists.map(playlist => (
              <button type="button" key={playlist.id} className="card" onClick={() => onOpenPlaylist(playlist)}>
                <span className="card-art">
                  <Cover src={playlist.coverUrl} radius={12} />
                  <span className="card-play">
                    <ListMusic size={16} />
                  </span>
                </span>
                <span className="card-title">{playlist.title}</span>
                <span className="card-sub">{playlist.count ? `${playlist.count} 首` : '歌单'}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="还没有歌单" hint="在华为音乐里建的歌单会同步到这里" />
        )}
      </section>

      <section>
        <SectionHeader
          title="收藏精选"
          subtitle={picks.length ? '从收藏里随手抽的 18 首' : undefined}
          action={
            favorites.length > 18 ? (
              <button type="button" className="ghost-link" onClick={() => setSeed(value => value + 1)}>
                <RefreshCw size={13} /> 换一批
              </button>
            ) : undefined
          }
        />
        {picks.length ? (
          <div className="card-grid">
            {picks.map((track, i) => (
              <button
                type="button"
                key={track.id}
                className={`card ${currentId === track.id ? 'is-active' : ''}`}
                onClick={() => onPlay(picks, i)}
              >
                <span className="card-art">
                  <Cover src={track.coverUrl} radius={12} />
                  <span className="card-play">
                    <Play size={15} fill="currentColor" />
                  </span>
                </span>
                <span className="card-title">{track.title}</span>
                <span className="card-sub">{artistsOf(track)}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="收藏还是空的" hint="红心几首之后这里就有东西了" />
        )}
      </section>
    </div>
  );
}

/* ── 歌单详情 ───────────────────────────────────────────── */

const PAGE_SIZE = 50;

export function PlaylistScreen({
  playlist,
  currentId,
  playing,
  onPlay,
}: {
  playlist: Playlist;
  currentId?: string;
  playing: boolean;
  onPlay: PlayHandler;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [nextStart, setNextStart] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (start: number) => {
      if (start === 0) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = await api.playlistDetail({ id: playlist.id, kind: playlist.kind, start, limit: PAGE_SIZE });
        setTracks(previous => {
          const base = start === 0 ? [] : previous;
          const seen = new Set(base.map(item => item.id));
          return [...base, ...page.tracks.filter(item => !seen.has(item.id))];
        });
        setNextStart(page.nextStart);
        setHasMore(page.hasMore && page.tracks.length > 0);
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setHasMore(false);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [playlist.id, playlist.kind],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const count = playlist.count || tracks.length;

  return (
    <div className="screen">
      <header className="detail-head">
        <Cover src={playlist.coverUrl} size={132} radius={14} className="detail-cover" />
        <div className="detail-meta">
          <span className="detail-kind">{playlist.kind === 'chart' ? '榜单' : playlist.kind === 'collected' ? '收藏的歌单' : '歌单'}</span>
          <h1>{playlist.title}</h1>
          <p className="screen-sub">{loading && tracks.length === 0 ? '正在读取…' : `${count} 首`}</p>
          <div className="detail-actions">
            <button type="button" className="primary-button" disabled={tracks.length === 0} onClick={() => onPlay(tracks, 0)}>
              <Play size={15} fill="currentColor" />
              <span>播放全部</span>
            </button>
          </div>
        </div>
      </header>

      {error ? <div className="inline-error">{error}</div> : null}

      {loading && tracks.length === 0 ? (
        <SkeletonRows count={10} />
      ) : tracks.length === 0 ? (
        error ? null : <EmptyState title="这个歌单还没有歌" hint="换一个歌单看看" />
      ) : (
        <div className="track-list">
          <div className="track-list-head">
            <span className="track-index">#</span>
            <span />
            <span>标题</span>
            <span className="track-album">专辑</span>
            <span />
          </div>
          {tracks.map((track, i) => (
            <TrackRow
              key={`${track.id}-${i}`}
              track={track}
              order={i + 1}
              active={currentId === track.id}
              playing={playing && currentId === track.id}
              onPlay={() => onPlay(tracks, i)}
            />
          ))}
        </div>
      )}

      <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void load(nextStart)} />
    </div>
  );
}

/* ── 搜索 ───────────────────────────────────────────────── */

export function SearchScreen({
  query,
  currentId,
  playing,
  onPlay,
}: {
  query: string;
  currentId?: string;
  playing: boolean;
  onPlay: PlayHandler;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [nextStart, setNextStart] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (start: number) => {
      if (start === 0) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = await api.search(query, start, 30);
        setTracks(previous => {
          const base = start === 0 ? [] : previous;
          const seen = new Set(base.map(item => item.id));
          return [...base, ...page.tracks.filter(item => !seen.has(item.id))];
        });
        setTotal(page.total ?? 0);
        setNextStart(page.nextStart);
        setHasMore(page.hasMore && page.tracks.length > 0);
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setHasMore(false);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>搜索</h1>
          <p className="screen-sub">
            {loading && tracks.length === 0
              ? `正在搜「${query}」…`
              : tracks.length
                ? `「${query}」找到 ${total || tracks.length} 首`
                : `「${query}」`}
          </p>
        </div>
      </header>

      {error ? <div className="inline-error">{error}</div> : null}

      {loading && tracks.length === 0 ? (
        <SkeletonRows count={10} />
      ) : tracks.length === 0 && !error ? (
        <EmptyState title="没有找到歌" hint="换个关键词，或者检查代理是否正常" />
      ) : (
        <div className="track-list">
          <div className="track-list-head">
            <span className="track-index">#</span>
            <span />
            <span>标题</span>
            <span className="track-album">专辑</span>
            <span />
          </div>
          {tracks.map((track, i) => (
            <TrackRow
              key={`${track.id}-${i}`}
              track={track}
              order={i + 1}
              active={currentId === track.id}
              playing={playing && currentId === track.id}
              onPlay={() => onPlay(tracks, i)}
            />
          ))}
        </div>
      )}

      <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void load(nextStart)} />
    </div>
  );
}

/* ── 设置 ───────────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SettingsScreen({
  auth,
  settings,
  cache,
  displayName,
  onUpdate,
  onCloseBehavior,
  onLogout,
  onLogin,
  onClearCache,
  onQuit,
}: {
  auth: AuthStatus | null;
  settings: AppSettings | null;
  cache: LyricsCacheInfo | null;
  displayName?: string;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onCloseBehavior: (value: AppSettings['closeBehavior']) => void;
  onLogout: () => void;
  onLogin: () => void;
  onClearCache: (local: boolean) => void;
  onQuit: () => void;
}) {
  const authenticated = Boolean(auth?.authenticated);
  return (
    <div className="screen settings-screen">
      <header className="screen-head">
        <div>
          <h1>设置</h1>
          <p className="screen-sub">账号、播放行为、缓存和版本信息</p>
        </div>
      </header>

      <section className="settings-group">
        <h2 className="settings-group-title">账号</h2>
        <div className="account-card">
          <span className="avatar avatar-lg">{displayName?.[0] ?? (authenticated ? '华' : '?')}</span>
          <div className="account-text">
            <span className="account-name">{authenticated ? displayName ?? '已登录' : '未登录'}</span>
            <span className="account-sub">
              {authenticated ? '华为账号' : '登录后才能读取收藏和歌单'}
              {authenticated && auth?.persistence === 'memory-only' ? ' · 安全存储不可用，退出后需重新登录' : ''}
            </span>
          </div>
          {authenticated ? (
            <button type="button" className="ghost-button" onClick={onLogout}>
              <LogOut size={14} /> 退出登录
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={onLogin}>
              <LogIn size={15} /> <span>登录华为账号</span>
            </button>
          )}
        </div>
        <p className="settings-note">
          <ShieldCheck size={13} /> 登录在华为官方页面完成，客户端不接触密码；凭据只存在本机系统安全存储里。
        </p>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-title">播放</h2>
        <SettingRow
          title="默认音质"
          hint="无损需要会员；解析不到时会回落到标准"
          control={
            <Segmented
              label="默认音质"
              value={settings?.quality ?? 'lossless'}
              options={[
                { value: 'lossless', label: '无损' },
                { value: 'standard', label: '标准' },
              ]}
              onChange={value => onUpdate({ quality: value })}
            />
          }
        />
        <SettingRow
          title="关闭窗口时"
          hint={settings?.closeBehavior === 'tray' ? '收进托盘，音乐继续放' : '直接退出程序'}
          control={
            <Segmented
              label="关闭窗口时"
              value={settings?.closeBehavior ?? 'quit'}
              options={[
                { value: 'quit', label: '退出' },
                { value: 'tray', label: '收进托盘' },
              ]}
              onChange={onCloseBehavior}
            />
          }
        />
        <SettingRow
          title="上报播放历史"
          hint="播放时同步到华为音乐的历史记录"
          control={
            <Switch
              label="上报播放历史"
              checked={Boolean(settings?.syncHistory)}
              onChange={next => onUpdate({ syncHistory: next })}
            />
          }
        />
        <SettingRow
          title="第三方歌词匹配"
          hint="华为没提供歌词时，去酷狗 / LRCLIB 按歌名和时长找"
          control={
            <Switch
              label="第三方歌词匹配"
              checked={Boolean(settings?.thirdPartyLyrics)}
              onChange={next => onUpdate({ thirdPartyLyrics: next })}
            />
          }
        />
      </section>

      <section className="settings-group">
        <h2 className="settings-group-title">歌词缓存</h2>
        <SettingRow
          title="网络歌词"
          hint={cache ? `${cache.entries} 首 · ${formatBytes(cache.bytes)}` : '正在统计…'}
          control={
            <button type="button" className="ghost-button" onClick={() => onClearCache(false)} disabled={!cache?.entries}>
              <Trash2 size={13} /> 清空
            </button>
          }
        />
        <SettingRow
          title="本地导入歌词"
          hint={cache ? `${cache.localEntries} 首 · ${formatBytes(cache.localBytes)}` : '正在统计…'}
          control={
            <button type="button" className="ghost-button" onClick={() => onClearCache(true)} disabled={!cache?.localEntries}>
              <Trash2 size={13} /> 清空
            </button>
          }
        />
      </section>

      <section className="settings-group">
        <h2 className="settings-group-title">关于</h2>
        <SettingRow
          title="华为音乐 · 学习版"
          hint="0.0.1 内部版 · 非官方客户端，仅供个人学习研究，不得分发"
          control={
            <button type="button" className="ghost-button" onClick={onQuit}>
              退出程序
            </button>
          }
        />
        <p className="settings-note">
          <Info size={13} /> 音乐与账号数据来自华为音乐官方接口；客户端不代理、不分发任何内容，OAuth 身份属于华为官方应用。
        </p>
      </section>
    </div>
  );
}

/* ── 侧栏：歌单列表 + 底部设置 ──────────────────────────── */

export function SidebarPlaylists({
  playlists,
  loading,
  activeId,
  onOpen,
}: {
  playlists: Playlist[];
  loading: boolean;
  activeId?: string;
  onOpen: (playlist: Playlist) => void;
}) {
  return (
    <div className="side-playlists">
      <div className="side-section-head">
        <span>我的歌单</span>
        {playlists.length ? <span className="side-count">{playlists.length}</span> : null}
      </div>
      <div className="side-scroll">
        {loading && playlists.length === 0 ? (
          <div className="side-empty">正在读取…</div>
        ) : playlists.length === 0 ? (
          <div className="side-empty">还没有歌单</div>
        ) : (
          playlists.map(playlist => (
            <button
              type="button"
              key={playlist.id}
              className={`side-playlist ${activeId === playlist.id ? 'is-active' : ''}`}
              onClick={() => onOpen(playlist)}
              title={playlist.title}
            >
              <Cover src={playlist.coverUrl} size={24} radius={6} />
              <span className="side-playlist-title">{playlist.title}</span>
              {playlist.count ? <span className="side-count">{playlist.count}</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** 侧栏底部：设置入口（账号卡已经搬进设置页）。 */
export function SidebarFooter({ onOpenSettings, active }: { onOpenSettings: () => void; active: boolean }) {
  return (
    <button
      type="button"
      className={`nav-item side-settings ${active ? 'is-active' : ''}`}
      onClick={onOpenSettings}
      title="设置"
    >
      <Settings size={17} />
      <span>设置</span>
    </button>
  );
}
