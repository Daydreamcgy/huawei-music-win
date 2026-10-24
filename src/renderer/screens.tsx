import { useMemo, useState } from 'react';
import { ChevronRight, Heart, Play, Search } from 'lucide-react';
import type { Track } from '../shared/types';
import { artistsOf, Cover, EmptyState, formatTime, SectionHeader, SkeletonRows, TrackRow } from './ui';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

type PlayHandler = (tracks: Track[], index: number) => void;

export function HomeScreen({
  history,
  favorites,
  total,
  loading,
  displayName,
  currentId,
  playing,
  onPlay,
  onOpenFavorites,
}: {
  history: Track[];
  favorites: Track[];
  total: number;
  loading: boolean;
  displayName?: string;
  currentId?: string;
  playing: boolean;
  onPlay: PlayHandler;
  onOpenFavorites: () => void;
}) {
  // 首屏大图优先挑有封面的：历史里偶尔混进没有封面的条目，空白卡片很伤观感。
  const heroPool = [...history, ...favorites];
  const hero = heroPool.find(track => track.coverUrl) ?? heroPool[0];
  const recents = history.slice(0, 12);
  const picks = favorites.slice(0, 12);

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>
          {greeting()}
          {displayName ? `，${displayName}` : ''}
        </h1>
        <p className="screen-sub">今天想听点什么？</p>
      </header>

      {hero ? (
        <section className="hero" style={{ ['--hero-cover' as string]: `url(${hero.coverUrl ?? ''})` }}>
          <div className="hero-copy">
            <span className="hero-tag">继续听</span>
            <h2 className="hero-title">{hero.title}</h2>
            <p className="hero-artist">{artistsOf(hero)}</p>
            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={() => onPlay(heroPool, 0)}>
                <Play size={16} fill="currentColor" /> 播放
              </button>
              {hero.durationSeconds ? <span className="hero-meta">{formatTime(hero.durationSeconds)}</span> : null}
            </div>
          </div>
          <div className="hero-art">
            <Cover src={hero.coverUrl} radius={18} className="hero-cover" />
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeader title="最近播放" subtitle={recents.length ? undefined : '还没有播放记录'} />
        {loading && recents.length === 0 ? (
          <SkeletonRows count={2} />
        ) : recents.length ? (
          <div className="card-row">
            {recents.map((track, i) => (
              <button
                type="button"
                key={`${track.id}-${i}`}
                className={`card ${currentId === track.id ? 'is-active' : ''}`}
                onClick={() => onPlay(recents, i)}
              >
                <Cover src={track.coverUrl} radius={14} />
                <span className="card-title">{track.title}</span>
                <span className="card-sub">{artistsOf(track)}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="最近还没听过歌" hint="从收藏里挑一首开始吧" />
        )}
      </section>

      <section>
        <SectionHeader
          title="我的收藏"
          subtitle={total ? `共 ${total} 首` : undefined}
          action={
            <button type="button" className="ghost-link" onClick={onOpenFavorites}>
              查看全部 <ChevronRight size={14} />
            </button>
          }
        />
        {loading && picks.length === 0 ? (
          <SkeletonRows count={3} />
        ) : picks.length ? (
          <div className="card-row">
            {picks.map((track, i) => (
              <button
                type="button"
                key={track.id}
                className={`card ${currentId === track.id ? 'is-active' : ''}`}
                onClick={() => onPlay(favorites, i)}
              >
                <Cover src={track.coverUrl} radius={14} />
                <span className="card-title">{track.title}</span>
                <span className="card-sub">{artistsOf(track)}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="收藏还是空的" hint="在华为音乐里红心的歌会出现在这里" />
        )}
      </section>
    </div>
  );
}

export function FavoritesScreen({
  tracks,
  total,
  loading,
  currentId,
  playing,
  onPlay,
  onToggleFavorite,
}: {
  tracks: Track[];
  total: number;
  loading: boolean;
  currentId?: string;
  playing: boolean;
  onPlay: PlayHandler;
  onToggleFavorite: (track: Track) => void;
}) {
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return tracks;
    return tracks.filter(track => {
      const haystack = `${track.title} ${artistsOf(track)} ${track.album?.title ?? ''}`.toLowerCase();
      return haystack.includes(key);
    });
  }, [keyword, tracks]);

  return (
    <div className="screen">
      <header className="screen-head favorites-head">
        <div>
          <h1>我的收藏</h1>
          <p className="screen-sub">
            {loading && tracks.length === 0 ? '正在读取收藏…' : `共 ${total || tracks.length} 首`}
          </p>
        </div>
        <div className="favorites-tools">
          <label className="search-field">
            <Search size={15} />
            <input
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
              placeholder="筛选收藏"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={filtered.length === 0}
            onClick={() => onPlay(filtered, 0)}
          >
            <Play size={16} fill="currentColor" /> 播放全部
          </button>
        </div>
      </header>

      {loading && tracks.length === 0 ? (
        <SkeletonRows count={10} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={keyword ? '没有匹配的歌' : '收藏还是空的'}
          hint={keyword ? '换个关键词试试' : '在华为音乐里红心的歌会出现在这里'}
        />
      ) : (
        <div className="track-list">
          {filtered.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              order={i + 1}
              active={currentId === track.id}
              playing={playing && currentId === track.id}
              onPlay={() => onPlay(filtered, i)}
              onToggleFavorite={() => onToggleFavorite(track)}
              favorite
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LoginScreen({
  pending,
  message,
  onLogin,
}: {
  pending: boolean;
  message?: string;
  onLogin: () => void;
}) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-mark">
          <span>♪</span>
        </div>
        <h1>华为音乐</h1>
        <p className="login-desc">用华为账号登录，读取你的收藏与歌单。</p>
        <button type="button" className="primary-button login-button" onClick={onLogin} disabled={pending}>
          {pending ? '正在打开登录页…' : '使用华为账号登录'}
        </button>
        <p className="login-note">
          登录在官方页面上完成，客户端不接触你的密码。
          <br />
          非官方客户端，仅供个人使用。
        </p>
        {message ? <p className="login-status">{message}</p> : null}
      </div>
      <div className="login-orbit" aria-hidden="true">
        <Heart />
      </div>
    </div>
  );
}
