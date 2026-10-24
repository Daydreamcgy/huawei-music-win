import { useCallback, useEffect, useRef, useState } from 'react';
import type { LyricsDoc, RepeatMode, Track } from '../../shared/types';
import { api } from './api';

type Quality = 'standard' | 'lossless';

type Options = {
  quality: Quality;
  volume: number;
  onError: (message: string) => void;
  onVolumeCommit: (volume: number) => void;
};

/**
 * 播放器内核：一个 Audio 元素 + 队列 + 单曲解析。
 * 只有当前歌曲变化（index/nonce）才会重新向主进程要播放地址，避免每帧 IPC。
 */
export function usePlayer({ quality, volume, onError, onVolumeCommit }: Options) {
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [nonce, setNonce] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyrics, setLyrics] = useState<LyricsDoc | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('all');
  const [shuffle, setShuffle] = useState(false);
  const [actualQuality, setActualQuality] = useState<'standard' | 'lossless' | 'unknown'>('unknown');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  const repeatRef = useRef<RepeatMode>(repeat);
  const shuffleRef = useRef(shuffle);
  const loadToken = useRef(0);
  const onErrorRef = useRef(onError);
  const nextRef = useRef<(auto?: boolean) => void>(() => undefined);
  const positionCommit = useRef(0);

  queueRef.current = queue;
  indexRef.current = index;
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  onErrorRef.current = onError;

  const current = index >= 0 ? queue[index] : undefined;

  /** 按当前队列重播同一首（单曲循环 / 手动重试）。 */
  const reload = useCallback(() => setNonce(value => value + 1), []);

  const playFrom = useCallback((tracks: Track[], startIndex: number) => {
    if (tracks.length === 0) return;
    const safeIndex = Math.min(Math.max(0, startIndex), tracks.length - 1);
    setQueue(tracks);
    queueRef.current = tracks;
    setIndex(safeIndex);
    indexRef.current = safeIndex;
    setNonce(value => value + 1);
  }, []);

  const next = useCallback((auto = false) => {
    const tracks = queueRef.current;
    if (tracks.length === 0) return;
    const i = indexRef.current;

    if (auto && repeatRef.current === 'one') {
      setNonce(value => value + 1);
      return;
    }
    if (shuffleRef.current && tracks.length > 1) {
      let target = i;
      while (target === i) target = Math.floor(Math.random() * tracks.length);
      setIndex(target);
      return;
    }
    if (i + 1 < tracks.length) {
      setIndex(i + 1);
      return;
    }
    if (repeatRef.current === 'all') {
      setIndex(0);
      return;
    }
    setPlaying(false);
  }, []);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
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

  const toggleRepeat = useCallback(() => {
    setRepeat(value => (value === 'all' ? 'one' : value === 'one' ? 'off' : 'all'));
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
    repeat,
    shuffle,
    actualQuality,
    quality,
    playFrom,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    reload,
    toggleFavorite,
    toggleRepeat,
    toggleShuffle: () => setShuffle(value => !value),
    positionCommit,
  };
}
