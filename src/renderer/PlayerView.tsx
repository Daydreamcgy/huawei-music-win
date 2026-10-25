import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Heart,
  ListMusic,
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
import { modeLabel } from './lib/player';
import { artistsOf, Cover, formatTime } from './ui';

type Player = ReturnType<typeof usePlayer>;

export type { Player, Track };

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

function PlayLook({ toggle, playing }: { toggle: () => void; playing: boolean }) {
  return (
    <button
      type="button"
      className="bar-play"
      onClick={toggle}
      aria-label={playing ? '暂停' : '播放'}
      title={playing ? '暂停' : '播放'}
    >
      {playing ? (
        <Pause size={19} fill="currentColor" />
      ) : (
        <Play size={19} fill="currentColor" style={{ marginLeft: 2 }} />
      )}
    </button>
  );
}

/** 一个按钮四个状态：顺序 → 列表循环 → 单曲循环 → 随机 → 顺序。 */
function ModeButton({ player }: { player: Player }) {
  const label = modeLabel(player.mode);
  return (
    <button
      type="button"
      className={`icon-button bar-mode ${player.mode === 'sequential' ? '' : 'is-on'}`}
      onClick={() => player.cycleMode()}
      aria-label={`播放模式：${label}`}
      title={player.mode === 'sequential' ? '顺序播放（点一下切列表循环）' : label}
    >
      {player.mode === 'shuffle' ? (
        <Shuffle size={17} />
      ) : player.mode === 'one' ? (
        <Repeat1 size={17} />
      ) : (
        <Repeat size={17} />
      )}
    </button>
  );
}

/**
 * 底部唯一的播放条：收起时它就是迷你条；展开时它不动，上面盖一层播放页。
 * 左边那块「封面 + 歌名 + 歌手」是共享元素 —— 展开 / 收起时由 PlayerShell
 * 把它从条里的位置放大到播放页里的位置（以及反过来）。
 */
export function PlayerBar({
  player,
  expanded,
  onToggleStage,
  onToggleQueue,
  queueOpen,
  hideNowPlaying,
  arriving,
  coverRef,
  metaRef,
}: {
  player: Player;
  expanded: boolean;
  onToggleStage: () => void;
  onToggleQueue: () => void;
  queueOpen: boolean;
  /** 播放页展开期间把条里的这份藏起来（播放页上有一份更大的）。 */
  hideNowPlaying: boolean;
  /** 收起动画进行到后半段：把条里的歌名淡回来，接住飞下来的那一份。 */
  arriving: boolean;
  coverRef: React.RefObject<HTMLSpanElement | null>;
  metaRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const track = player.current;
  const total = player.duration || track?.durationSeconds || 0;
  const percent = total > 0 ? Math.min(100, Math.max(0, (player.position / total) * 100)) : 0;

  const [scrub, setScrub] = useState<number | null>(null);
  const dragging = useRef(false);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const ratioAt = (clientX: number) => {
    const el = progressRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const nowClass = ['bar-now', hideNowPlaying ? 'is-away' : '', hideNowPlaying && arriving ? 'is-arriving' : '']
    .filter(Boolean)
    .join(' ');

  if (!track) {
    return (
      <footer className="bar is-idle">
        <div className="bar-idle">
          <span className="bar-idle-art">♪</span>
          <span className="bar-idle-text">未在播放</span>
        </div>
        <span className="bar-hint">双击任意一首开始</span>
      </footer>
    );
  }

  return (
    <footer className="bar">
      <div
        className={`bar-progress ${scrub !== null ? 'is-scrubbing' : ''}`}
        ref={progressRef}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(player.position)}
        title="点击或拖动跳转"
        onPointerDown={event => {
          if (total <= 0) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setScrub(ratioAt(event.clientX));
        }}
        onPointerMove={event => {
          if (dragging.current) setScrub(ratioAt(event.clientX));
        }}
        onPointerUp={event => {
          if (!dragging.current) return;
          dragging.current = false;
          const ratio = ratioAt(event.clientX);
          setScrub(null);
          if (total > 0) player.seek(ratio * total);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setScrub(null);
        }}
      >
        <span style={{ width: `${(scrub ?? percent / 100) * 100}%` }} />
        {scrub !== null ? <i className="bar-thumb" style={{ left: `${scrub * 100}%` }} /> : null}
      </div>

      <div className={nowClass}>
        <button
          type="button"
          className="bar-track"
          onClick={onToggleStage}
          title={expanded ? '收起播放页' : '打开播放页'}
        >
          <span className="bar-cover" ref={coverRef}>
            <Cover src={track.coverUrl} size={44} radius={10} />
          </span>
          <span className="bar-meta" ref={metaRef}>
            <span className="bar-title">{track.title}</span>
            <span className="bar-artist">{artistsOf(track)}</span>
          </span>
        </button>
      </div>

      <div className="bar-center">
        <ModeButton player={player} />
        <button type="button" className="icon-button" onClick={() => player.previous()} aria-label="上一首" title="上一首">
          <SkipBack size={18} fill="currentColor" />
        </button>
        <PlayLook toggle={player.toggle} playing={player.playing} />
        <button type="button" className="icon-button" onClick={() => player.next()} aria-label="下一首" title="下一首">
          <SkipForward size={18} fill="currentColor" />
        </button>
      </div>

      <div className="bar-right">
        <span className="bar-time">
          {formatTime(player.position)} / {formatTime(total)}
        </span>

        <button
          type="button"
          className={`icon-button favorite ${player.favorite ? 'is-on' : ''}`}
          onClick={() => void player.toggleFavorite()}
          aria-label={player.favorite ? '取消收藏' : '收藏'}
          title={player.favorite ? '取消收藏' : '收藏'}
        >
          <Heart size={17} fill={player.favorite ? 'currentColor' : 'none'} />
        </button>

        <button
          type="button"
          className={`icon-button ${queueOpen ? 'is-on' : ''}`}
          onClick={onToggleQueue}
          aria-label="播放队列"
          title="播放队列"
        >
          <ListMusic size={16} />
        </button>

        <div className="bar-volume">
          <VolumeIcon value={player.volume} />
          <Scrubber value={player.volume} max={1} onCommit={player.setVolume} className="volume" />
        </div>

        <button
          type="button"
          className="icon-button"
          onClick={onToggleStage}
          aria-label={expanded ? '收起播放页' : '展开播放页'}
          title={expanded ? '收起播放页' : '展开播放页'}
        >
          {expanded ? <ChevronDown size={18} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </footer>
  );
}

/** 播放页内容层：大封面 + 歌词，坐在同一条 bar 上面（bar 不动）。 */
export function PlayerStage({
  player,
  open,
  coverRef,
  metaRef,
}: {
  player: Player;
  open: boolean;
  coverRef: React.RefObject<HTMLDivElement | null>;
  metaRef: React.RefObject<HTMLDivElement | null>;
}) {
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
    <div className={`player-screen ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <header className="player-head">
        <div className="player-head-text">
          <span className="player-eyebrow">正在播放</span>
          <span className="player-album">{track.album?.title ?? '华为音乐'}</span>
        </div>
        <span className="quality-badge">{qualityLabel}</span>
      </header>

      <div className="player-body">
        <div className="player-left">
          <div className="player-cover-wrap" ref={coverRef}>
            <Cover src={track.coverUrl} radius={0} className="player-cover-img" />
          </div>
          <div className="player-info" ref={metaRef}>
            <h1 className="player-title" title={track.title}>
              {track.title}
            </h1>
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
                      transform: `scale(${distance === 0 ? 1 : Math.max(0.82, 1 - distance * 0.03)})`,
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
    </div>
  );
}