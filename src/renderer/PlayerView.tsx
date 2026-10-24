import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Heart,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Track } from '../shared/types';
import type { usePlayer } from './lib/player';
import { artistsOf, Cover, formatTime } from './ui';

type Player = ReturnType<typeof usePlayer>;

function VolumeIcon({ value }: { value: number }) {
  if (value <= 0.001) return <VolumeX size={16} />;
  if (value < 0.5) return <Volume1 size={16} />;
  return <Volume2 size={16} />;
}

function Scrubber({
  value,
  max,
  onCommit,
  onScrub,
  className = '',
}: {
  value: number;
  max: number;
  onCommit: (value: number) => void;
  onScrub?: (value: number) => void;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState(value);
  const percent = max > 0 ? Math.min(100, Math.max(0, ((dragging ? draft : value) / max) * 100)) : 0;

  return (
    <input
      type="range"
      className={`scrubber ${className}`}
      min={0}
      max={max || 0.0001}
      step={0.1}
      value={dragging ? draft : value}
      style={{ ['--fill' as string]: `${percent}%` }}
      onPointerDown={() => setDragging(true)}
      onChange={event => {
        const next = Number(event.target.value);
        setDraft(next);
        onScrub?.(next);
      }}
      onPointerUp={() => {
        setDragging(false);
        onCommit(draft);
      }}
      onKeyUp={() => setDragging(false)}
    />
  );
}

export function MiniPlayer({ player, onExpand }: { player: Player; onExpand: () => void }) {
  const track = player.current;
  const percent = player.duration > 0 ? (player.position / player.duration) * 100 : 0;

  // 播放条常驻：没在播放时也占位，桌面端不该因为它消失而整页跳动。
  if (!track) {
    return (
      <div className="mini-player is-idle">
        <div className="mini-idle">
          <span className="mini-idle-art">♪</span>
          <span className="mini-idle-text">未在播放</span>
        </div>
        <span className="mini-hint">从收藏里挑一首开始</span>
      </div>
    );
  }

  return (
    <div className="mini-player">
      <div className="mini-progress">
        <span style={{ width: `${percent}%` }} />
      </div>
      <button type="button" className="mini-track" onClick={onExpand} title="打开播放页">
        <Cover src={track.coverUrl} size={44} radius={10} />
        <div className="mini-meta">
          <span className="mini-title">{track.title}</span>
          <span className="mini-sub">{artistsOf(track)}</span>
        </div>
      </button>

      <div className="mini-controls">
        <button type="button" className="icon-button" onClick={() => player.previous()} aria-label="上一首" title="上一首">
          <SkipBack size={18} fill="currentColor" />
        </button>
        <button
          type="button"
          className="mini-play"
          onClick={() => player.toggle()}
          aria-label={player.playing ? '暂停' : '播放'}
          title={player.playing ? '暂停' : '播放'}
        >
          {player.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
        </button>
        <button type="button" className="icon-button" onClick={() => player.next()} aria-label="下一首" title="下一首">
          <SkipForward size={18} fill="currentColor" />
        </button>
      </div>

      <span className="mini-time">
        {formatTime(player.position)} / {formatTime(player.duration || track.durationSeconds)}
      </span>

      <div className="mini-volume">
        <VolumeIcon value={player.volume} />
        <Scrubber value={player.volume} max={1} onCommit={player.setVolume} className="volume" />
      </div>

      <button type="button" className="icon-button" onClick={onExpand} aria-label="展开播放页" title="展开播放页">
        <Maximize2 size={16} />
      </button>
    </div>
  );
}

export function PlayerScreen({ player, onClose }: { player: Player; onClose: () => void }) {
  const track = player.current;
  const linesRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  const lines = player.lyrics?.lines ?? [];
  const synced = Boolean(player.lyrics?.synced);

  const activeIndex = useMemo(() => {
    if (!synced || lines.length === 0) return -1;
    const ms = player.position * 1000;
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const time = lines[i].timeMs;
      if (time === null) continue;
      if (time <= ms) index = i;
      else break;
    }
    return index;
  }, [lines, player.position, synced]);

  useEffect(() => {
    if (activeIndex < 0) return;
    activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!track) return null;

  const qualityLabel =
    player.actualQuality === 'lossless'
      ? '无损 FLAC'
      : player.actualQuality === 'standard'
        ? '标准 MP3'
        : player.quality === 'lossless'
          ? '无损音质'
          : '标准音质';

  return (
    <div className="player-screen">
      <header className="player-head">
        <button type="button" className="icon-button" onClick={onClose} aria-label="收起播放页" title="收起播放页">
          <ChevronDown size={22} />
        </button>
        <div className="player-head-text">
          <span className="player-eyebrow">正在播放</span>
          <span className="player-album">{track.album?.title ?? '华为音乐'}</span>
        </div>
        <span className="quality-badge">{qualityLabel}</span>
      </header>

      <div className="player-body">
        <div className="player-left">
          <Cover src={track.coverUrl} radius={20} className="player-cover" />
          <div className="player-info">
            <h1 className="player-title">{track.title}</h1>
            <p className="player-artist">{artistsOf(track)}</p>
          </div>
        </div>

        <div className="player-lyrics" ref={linesRef}>
          {lines.length === 0 ? (
            <div className="lyrics-empty">
              <p>暂无歌词</p>
              <span>{player.lyrics ? '这首歌没有提供歌词' : '歌词还在路上…'}</span>
            </div>
          ) : (
            lines.map((line, i) => {
              // 以当前行为中心做「纵深」：离得越远越浅、越小。
              const distance = activeIndex < 0 ? 0 : Math.min(Math.abs(i - activeIndex), 8);
              const depthStyle =
                activeIndex < 0
                  ? undefined
                  : {
                      opacity: Math.max(0.14, 1 - distance * 0.16),
                      transform: `scale(${distance === 0 ? 1.05 : Math.max(0.82, 1 - distance * 0.03)})`,
                    };
              return (
                <p
                  key={`${line.timeMs}-${i}`}
                  ref={i === activeIndex ? activeLineRef : null}
                  className={`lyric-line ${i === activeIndex ? 'is-active' : ''} ${synced ? '' : 'is-plain'}`}
                  style={depthStyle}
                  onClick={() => line.timeMs !== null && player.seek(line.timeMs / 1000)}
                >
                  {line.text}
                  {line.translation ? <span className="lyric-translation">{line.translation}</span> : null}
                </p>
              );
            })
          )}
        </div>
      </div>

      <footer className="player-foot">
        <div className="player-progress">
          <span className="time">{formatTime(player.position)}</span>
          <Scrubber
            value={player.position}
            max={player.duration || track.durationSeconds || 0}
            onCommit={value => player.seek(value)}
          />
          <span className="time">{formatTime(player.duration || track.durationSeconds)}</span>
        </div>

        <div className="player-controls">
          <button
            type="button"
            className={`icon-button ${player.shuffle ? 'is-on' : ''}`}
            onClick={player.toggleShuffle}
            aria-label="随机播放"
            title="随机播放"
          >
            <Shuffle size={18} />
          </button>
          <button type="button" className="icon-button" onClick={() => player.previous()} aria-label="上一首" title="上一首">
            <SkipBack size={22} fill="currentColor" />
          </button>
          <PlayLook toggle={player.toggle} playing={player.playing} />
          <button type="button" className="icon-button" onClick={() => player.next()} aria-label="下一首" title="下一首">
            <SkipForward size={22} fill="currentColor" />
          </button>
          <button
            type="button"
            className={`icon-button ${player.repeat !== 'off' ? 'is-on' : ''}`}
            onClick={player.toggleRepeat}
            aria-label="循环模式"
            title={player.repeat === 'one' ? '单曲循环' : player.repeat === 'all' ? '列表循环' : '不循环'}
          >
            {player.repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </button>
          <button
            type="button"
            className={`icon-button favorite ${player.favorite ? 'is-on' : ''}`}
            onClick={() => void player.toggleFavorite()}
            aria-label={player.favorite ? '取消收藏' : '收藏'}
            title={player.favorite ? '取消收藏' : '收藏'}
          >
            <Heart size={18} fill={player.favorite ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="player-volume">
          <VolumeIcon value={player.volume} />
          <Scrubber value={player.volume} max={1} onCommit={player.setVolume} className="volume" />
        </div>
      </footer>
    </div>
  );
}

function PlayLook({ playing, toggle }: { playing: boolean; toggle: () => void }) {
  return (
    <button type="button" className="player-play" onClick={toggle} aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停' : '播放'}>
      {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 3 }} />}
    </button>
  );
}

export type { Track };
