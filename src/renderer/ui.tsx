import { useState } from 'react';
import { Heart, Loader2, Pause, Play } from 'lucide-react';
import type { Track } from '../shared/types';

export function formatTime(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function artistsOf(track: Track): string {
  return track.artists.map(item => item.name).join(' / ') || '未知歌手';
}

export function Cover({
  src,
  size,
  radius = 12,
  className = '',
}: {
  src?: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const style = size ? { width: size, height: size, borderRadius: radius } : { borderRadius: radius };
  const usable = Boolean(src) && !broken;
  return (
    <div className={`cover ${className}`} style={style} data-empty={!usable}>
      {usable ? (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <span className="cover-fallback">♪</span>
      )}
    </div>
  );
}

export function PlayButton({
  playing,
  loading,
  onClick,
  size = 44,
  label,
}: {
  playing: boolean;
  loading?: boolean;
  onClick: () => void;
  size?: number;
  label: string;
}) {
  return (
    <button
      type="button"
      className="play-button"
      style={{ width: size, height: size }}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {loading ? (
        <Loader2 size={size * 0.42} className="spin" />
      ) : playing ? (
        <Pause size={size * 0.42} fill="currentColor" />
      ) : (
        <Play size={size * 0.42} fill="currentColor" style={{ marginLeft: 2 }} />
      )}
    </button>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p className="section-sub">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function TrackRow({
  track,
  order,
  active,
  playing,
  onPlay,
  onToggleFavorite,
  favorite,
  showAlbum = true,
}: {
  track: Track;
  order: number;
  active: boolean;
  playing: boolean;
  onPlay: () => void;
  onToggleFavorite?: () => void;
  favorite?: boolean;
  showAlbum?: boolean;
}) {
  return (
    <div
      className={`track-row ${active ? 'is-active' : ''}`}
      onDoubleClick={onPlay}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPlay();
        }
      }}
    >
      <div className="track-index">
        {active ? (
          <span className="eq" data-playing={playing}>
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="track-order">{String(order).padStart(2, '0')}</span>
        )}
        <button type="button" className="row-play" onClick={onPlay} aria-label="播放" title="播放">
          <Play size={14} fill="currentColor" />
        </button>
      </div>
      <Cover src={track.coverUrl} size={44} radius={8} />
      <div className="track-main">
        <div className="track-title">{track.title}</div>
        <div className="track-sub">{artistsOf(track)}</div>
      </div>
      {showAlbum ? <div className="track-album">{track.album?.title ?? ''}</div> : null}
      <div className="track-duration">{track.durationSeconds ? formatTime(track.durationSeconds) : ''}</div>
      {onToggleFavorite ? (
        <button
          type="button"
          className={`icon-button heart ${favorite ? 'is-on' : ''}`}
          onClick={event => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={favorite ? '取消收藏' : '收藏'}
          title={favorite ? '取消收藏' : '收藏'}
        >
          <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      ) : (
        <span className="icon-button heart is-hidden" />
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-glyph">♪</div>
      <p className="empty-title">{title}</p>
      {hint ? <p className="empty-hint">{hint}</p> : null}
    </div>
  );
}

export function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton-block" style={{ width: 44, height: 44 }} />
          <span className="skeleton-block" style={{ width: '38%', height: 12 }} />
          <span className="skeleton-block" style={{ width: '18%', height: 10 }} />
        </div>
      ))}
    </div>
  );
}
