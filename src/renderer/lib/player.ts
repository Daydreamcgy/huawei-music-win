import { useCallback, useEffect, useRef, useState } from 'react';
import type { LyricsDoc, Track } from '../../shared/types';
import { api } from './api';

type Quality = 'standard' | 'lossless';

/**
 * 播放模式：顺序 / 列表循环 / 单曲循环 / 随机。
 * 界面上只有「一个按钮」，点一下切一格，所以这里是一个枚举，
 * 不是 repeat + shuffle 两个正交开关。
 */
export type PlayMode = 'sequential' | 'all' | 'one' | 'shuffle';

export function nextMode(mode: PlayMode): PlayMode {
  if (mode === 'sequential') return 'all';
  if (mode === 'all') return 'one';
  if (mode === 'one') return 'shuffle';
  return 'sequential';
}

export function modeLabel(mode: PlayMode): string {
  if (mode === 'all') return '列表循环';
  if (mode === 'one') return '单曲循环';
  if (mode === 'shuffle') return '随机播放';
  return '顺序播放';
}

type Options = {
  quality: Quality;
  volume: number;
  onError: (message: string) => void;
  onVolumeCommit: (volume: number) => void;
  /** 播放模式被用户改动时回报，交给 App 落盘。 */
  onPreferencesChange?: (next: PlayMode) => void;
};

/**
 * 播放器内核：一个 Audio 元素 + 队列 + 单曲解析。
 * 只有当前歌曲变化（index/nonce）才会重新向主进程要播放地址，避免每帧 IPC。
 */
export function usePlayer({ quality, volume, onError, onVolumeCommit, onPreferencesChange }: Options) {
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [nonce, setNonce] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyrics, setLyrics] = useState<LyricsDoc | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [mode, setModeState] = useState<PlayMode>('sequential');
  const [actualQuality, setActualQuality] = useState<'standard' | 'lossless' | 'unknown'>('unknown');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  const modeRef = useRef<PlayMode>(mode);
  /** 随机走过的索引，供「上一首」回退。 */
  const shuffleHistory = useRef<number[]>([]);
  const loadToken = useRef(0);
  const onErrorRef = useRef(onError);
  const onPreferencesRef = useRef(onPreferencesChange);
  const nextRef = useRef<(auto?: boolean) => void>(() => undefined);
  const positionCommit = useRef(0);
  /** 恢复上次队列时，第一次载入要跳到这个位置且不自动播。 */
  const pendingSeek = useRef<{ position: number; autoplay: boolean } | null>(null);

  queueRef.current = queue;
  indexRef.current = index;
  modeRef.current = mode;
  onErrorRef.current = onError;
  onPreferencesRef.current = onPreferencesChange;

  const current = index >= 0 ? queue[index] : undefined;

  /** 按当前队列重播同一首（单曲循环 / 手动重试）。 */
  const reload = useCallback(() => setNonce(value => value + 1), []);

  const playFrom = useCallback((tracks: Track[], startIndex: number) => {
    if (tracks.length === 0) return;
    const safeIndex = Math.min(Math.max(0, startIndex), tracks.length - 1);
    pendingSeek.current = null;
    setQueue(tracks);
    queueRef.current = tracks;
    setIndex(safeIndex);
    indexRef.current = safeIndex;
    setNonce(value => value + 1);
  }, []);

  /** 启动时恢复上次队列：定位到那一首、跳到那个进度，但不自动出声。 */
  const restore = useCallback((tracks: Track[], startIndex: number, positionSeconds: number) => {
    if (tracks.length === 0) return;
    const safeIndex = Math.min(Math.max(0, startIndex), tracks.length - 1);
    pendingSeek.current = { position: Math.max(0, positionSeconds), autoplay: false };
    setQueue(tracks);
    queueRef.current = tracks;
    setIndex(safeIndex);
    indexRef.current = safeIndex;
    setNonce(value => value + 1);
  }, []);

  /** 下一首播放：插到当前曲目后面，不打乱正在播的那首。 */
  const enqueueNext = useCallback(
    (tracks: Track[]) => {
      if (tracks.length === 0) return;
      const list = queueRef.current;
      const i = indexRef.current;
      if (list.length === 0 || i < 0) {
        playFrom(tracks, 0);
        return;
      }
      const next = [...list.slice(0, i + 1), ...tracks, ...list.slice(i + 1)];
      setQueue(next);
      queueRef.current = next;
    },
    [playFrom],
  );

  /** 添加到播放队列：接在队尾。 */
  const enqueueLast = useCallback(
    (tracks: Track[]) => {
      if (tracks.length === 0) return;
      const list = queueRef.current;
      if (list.length === 0 || indexRef.current < 0) {
        playFrom(tracks, 0);
        return;
      }
      const next = [...list, ...tracks];
      setQueue(next);
      queueRef.current = next;
    },
    [playFrom],
  );

  /** 从队列里扔掉某一项；扔的是正在播的那首就顺位接下一位。 */
  const removeAt = useCallback((position: number) => {
    const list = queueRef.current;
    if (position < 0 || position >= list.length) return;
    const playing = indexRef.current;
    const next = list.filter((_, i) => i !== position);

    if (next.length === 0) {
      queueRef.current = [];
      setQueue([]);
      indexRef.current = -1;
      setIndex(-1);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      setPlaying(false);
      return;
    }

    if (position === playing) {
      const target = Math.min(playing, next.length - 1);
      indexRef.current = target;
      setIndex(target);
      setNonce(value => value + 1);
    } else if (position < playing) {
      indexRef.current = playing - 1;
      setIndex(playing - 1);
    }
    setQueue(next);
    queueRef.current = next;
  }, []);

  /** 清空待播：只留有正在播的这一首。 */
  const clearUpcoming = useCallback(() => {
    const list = queueRef.current;
    const i = indexRef.current;
    if (i < 0) return;
    const next = list.slice(0, i + 1);
    queueRef.current = next;
    setQueue(next);
  }, []);

  /** 从队列里直接点某一首。 */
  const jumpTo = useCallback((position: number) => {
    const list = queueRef.current;
    if (position < 0 || position >= list.length) return;
    if (position === indexRef.current) return;
    pendingSeek.current = null;
    indexRef.current = position;
    setIndex(position);
    setNonce(value => value + 1);
  }, []);

  const next = useCallback((auto = false) => {
    const tracks = queueRef.current;
    if (tracks.length === 0) return;
    const i = indexRef.current;
    pendingSeek.current = null;

    const mode = modeRef.current;

    // 自动播完时的单曲循环；手动点「下一首」仍然往下走。
    if (auto && mode === 'one') {
      setNonce(value => value + 1);
      return;
    }
    if (mode === 'shuffle' && tracks.length > 1) {
      shuffleHistory.current.push(i);
      if (shuffleHistory.current.length > 200) shuffleHistory.current.shift();
      let target = i;
      while (target === i) target = Math.floor(Math.random() * tracks.length);
      setIndex(target);
      return;
    }
    if (i + 1 < tracks.length) {
      setIndex(i + 1);
      return;
    }
    if (mode === 'all') {
      setIndex(0);
      return;
    }
    setPlaying(false);
  }, []);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    pendingSeek.current = null;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      return;
    }
    // 随机模式回退到「上一首随机到的」，没有历史再顺序退。
    const history = shuffleHistory.current;
    if (modeRef.current === 'shuffle' && history.length > 0) {
      const target = history.pop() as number;
      setIndex(target);
      setNonce(value => value + 1);
      return;
    }
    setIndex(value => (value > 0 ? value - 1 : 0));
    setNonce(value => value + 1);
  }, []);

  nextRef.current = next;

  // Audio 元素只建一次，事件监听跟着组件生命周期。
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume;
    audioRef.current = audio;

    const element = audio;
    const onTime = () => {
      setPosition(element.currentTime);
      positionCommit.current = element.currentTime;
    };
    const onLoaded = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    const onPlaying = () => {
      setPlaying(true);
      setBuffering(false);
    };
    const onWaiting = () => setBuffering(true);
    const onPaused = () => setPlaying(false);
    const onEnded = () => nextRef.current(true);
    const onFailed = () => {
      setBuffering(false);
      setPlaying(false);
      onErrorRef.current('这首歌暂时没能播放，稍后可以再点一次。');
    };

    element.addEventListener('timeupdate', onTime);
    element.addEventListener('loadedmetadata', onLoaded);
    element.addEventListener('playing', onPlaying);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('pause', onPaused);
    element.addEventListener('ended', onEnded);
    element.addEventListener('error', onFailed);

    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('waiting', onWaiting);
      element.removeEventListener('pause', onPaused);
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('error', onFailed);
      element.pause();
      element.src = '';
      audioRef.current = null;
    };
    // 只在挂载时初始化，音量由下面的 effect 同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // 切歌：解析播放地址 → 载入 → 播放，同时并行取歌词与收藏状态。
  useEffect(() => {
    const track = queueRef.current[index];
    if (!track) return;

    const token = ++loadToken.current;
    const pending = pendingSeek.current;
    pendingSeek.current = null;
    setLyrics(null);
    setFavorite(false);
    setDuration(0);
    setPosition(0);
    setBuffering(true);

    void (async () => {
      try {
        const playback = await api.resolvePlayback(track.id, quality);
        if (token !== loadToken.current) return;
        const audio = audioRef.current;
        if (!audio) return;
        setActualQuality(playback.actualQuality);
        audio.src = playback.url;

        if (pending) {
          // 恢复上次进度：必须等元数据到了再改 currentTime，否则会被当成 0 丢掉。
          if (audio.readyState < 1) {
            await new Promise<void>(resolve => {
              const done = () => resolve();
              audio.addEventListener('loadedmetadata', done, { once: true });
              window.setTimeout(done, 4000);
            });
          }
          if (token !== loadToken.current) return;
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          const target = duration > 1 ? Math.min(pending.position, duration - 0.5) : pending.position;
          audio.currentTime = Math.max(0, target);
          setPosition(audio.currentTime);
          positionCommit.current = audio.currentTime;
          if (pending.autoplay) await audio.play();
          else setBuffering(false);
          return;
        }

        audio.currentTime = 0;
        await audio.play();
      } catch (error) {
        if (token !== loadToken.current) return;
        setBuffering(false);
        // 用户快速切歌会导致 play() 被 abort，这属于正常打断，不提示。
        if (error instanceof DOMException && error.name === 'AbortError') return;
        onErrorRef.current('这首歌暂时没能播放，稍后可以再点一次。');
      }
    })();

    void api
      .lyrics(track)
      .then(doc => {
        if (token === loadToken.current) setLyrics(doc);
      })
      .catch(() => undefined);

    void api
      .favoriteState(track.id)
      .then(value => {
        if (token === loadToken.current) setFavorite(value);
      })
      .catch(() => undefined);
    // nonce 变化表示「同一首重播」，也要重新走一遍解析。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, nonce, quality]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setPosition(seconds);
  }, []);

  const setVolume = useCallback(
    (value: number) => {
      const next = Math.min(1, Math.max(0, value));
      if (audioRef.current) audioRef.current.volume = next;
      onVolumeCommit(next);
    },
    [onVolumeCommit],
  );

  const toggleFavorite = useCallback(async () => {
    const track = queueRef.current[indexRef.current];
    if (!track) return;
    const next = !favorite;
    setFavorite(next);
    try {
      const value = await api.setFavorite(track.id, next);
      setFavorite(value);
    } catch {
      setFavorite(!next);
      onErrorRef.current(next ? '收藏没有成功，请稍后再试。' : '取消收藏没有成功，请稍后再试。');
    }
  }, [favorite]);

  /** 一个按钮四个状态：顺序 → 列表循环 → 单曲循环 → 随机 → 顺序。 */
  const cycleMode = useCallback(() => {
    setModeState(value => {
      const next = nextMode(value);
      onPreferencesRef.current?.(next);
      return next;
    });
  }, []);

  /** 启动时把落盘的模式灌进按钮（以前是硬编码 all + false）。 */
  const setPreferences = useCallback((next: PlayMode) => {
    shuffleHistory.current = [];
    setModeState(next);
  }, []);

  return {
    queue,
    index,
    current,
    playing,
    buffering,
    position,
    duration,
    volume,
    lyrics,
    favorite,
    mode,
    actualQuality,
    quality,
    playFrom,
    restore,
    enqueueNext,
    enqueueLast,
    removeAt,
    clearUpcoming,
    jumpTo,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    reload,
    toggleFavorite,
    cycleMode,
    setPreferences,
    positionCommit,
  };
}
