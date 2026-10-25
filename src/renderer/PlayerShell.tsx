import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PlayerBar, PlayerStage, type Player } from './PlayerView';

/** 与 styles.css 里播放页内容层的过渡时长对齐（收起后多久卸载）。 */
const MORPH_MS = 400;
const EASE = 'cubic-bezier(0.22, 0.68, 0.28, 1)';

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = () => setReduce(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

type Morph = { cover: string; radius: string; meta: string };

/**
 * 播放条 + 播放页的容器，负责「一条 bar 两种形态」之间的共享元素动画：
 * 收起时封面从播放页的大图缩进条里的 44px 槽位、歌名/歌手同步跟着走；展开时反过来。
 * bar 本身永远不动，播放页是盖在它上面的一层。
 *
 * 位移两端的坐标必须实时量，所以这里用 Web Animations API 而不是 CSS 过渡：
 * 过渡要靠「先写起手位、等浏览器重算一次样式、再写终态」才成立，
 * 中间任何一次合并重算都会让它直接跳过去；animate() 不会。
 */
export function PlayerShell({
  player,
  open,
  onOpen,
  onClose,
  queueOpen,
  onToggleQueue,
}: {
  player: Player;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
}) {
  const reduce = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [active, setActive] = useState(false);
  const [arriving, setArriving] = useState(false);

  const mountedRef = useRef(open);
  const stageCoverRef = useRef<HTMLDivElement | null>(null);
  const stageMetaRef = useRef<HTMLDivElement | null>(null);
  const barCoverRef = useRef<HTMLSpanElement | null>(null);
  const barMetaRef = useRef<HTMLSpanElement | null>(null);
  const animations = useRef<Animation[]>([]);

  const show = useCallback((value: boolean) => {
    mountedRef.current = value;
    setMounted(value);
  }, []);

  const stopAnimations = useCallback(() => {
    animations.current.forEach(anim => {
      try {
        anim.cancel();
      } catch {
        /* 元素已经卸载 */
      }
    });
    animations.current = [];
  }, []);

  /** 把播放页里的大封面映射到条里的槽位，得到一组 transform。 */
  const measure = useCallback((): Morph | null => {
    const cover = stageCoverRef.current;
    const barCover = barCoverRef.current;
    const meta = stageMetaRef.current;
    const barMeta = barMetaRef.current;
    if (!cover || !barCover) return null;
    const c = cover.getBoundingClientRect();
    const b = barCover.getBoundingClientRect();
    if (c.width < 1 || b.width < 1) return null;

    const scale = b.width / c.width;
    let metaTransform = 'none';
    if (meta && barMeta) {
      const m = meta.getBoundingClientRect();
      const bm = barMeta.getBoundingClientRect();
      metaTransform = `translate(${bm.left - m.left}px, ${bm.top - m.top}px)`;
    }
    return {
      cover: `translate(${b.left - c.left}px, ${b.top - c.top}px) scale(${scale})`,
      // 缩放后视觉圆角 = radius * scale，所以按比例放大回去，落在 10px 上
      radius: `${10 / scale}px`,
      meta: metaTransform,
    };
  }, []);

  const play = useCallback((direction: 'in' | 'out', morph: Morph) => {
    const cover = stageCoverRef.current;
    const meta = stageMetaRef.current;
    if (!cover || !meta) return;
    // 元素没挂载时 getComputedStyle 拿不到，重排一次也无妨
    const naturalRadius = getComputedStyle(cover).borderRadius || '20px';

    const coverFrames =
      direction === 'in'
        ? [
            { transform: morph.cover, borderRadius: morph.radius },
            { transform: 'none', borderRadius: naturalRadius },
          ]
        : [
            { transform: 'none', borderRadius: naturalRadius },
            { transform: morph.cover, borderRadius: morph.radius },
          ];

    // 歌名/歌手跟着封面走一段就淡掉：大字号划过下面那层内容会显得脏，
    // 后半程交给 bar 里那份（.bar-now.is-arriving 到 240ms 才淡回来）
    const metaFrames =
      direction === 'in'
        ? [
            { transform: morph.meta, opacity: 0 },
            { transform: morph.meta, opacity: 0, offset: 0.42 },
            { transform: 'none', opacity: 1 },
          ]
        : [
            { transform: 'none', opacity: 1 },
            { transform: morph.meta, opacity: 0, offset: 0.55 },
            { transform: morph.meta, opacity: 0 },
          ];

    const options = { duration: MORPH_MS, easing: EASE, fill: 'both' as FillMode };
    const coverAnim = cover.animate(coverFrames, options);
    const metaAnim = meta.animate(metaFrames, { ...options, fill: 'forwards' });
    // 「展开」结束时把动画撤掉，元素回到自己的常规样式；「收起」保持到卸载
    if (direction === 'in') {
      coverAnim.onfinish = () => coverAnim.cancel();
      metaAnim.onfinish = () => metaAnim.cancel();
    }
    animations.current.push(coverAnim, metaAnim);
  }, []);

  // 展开：挂上播放页 → 从条里的位置长出来 → 内容跟着浮上来
  useLayoutEffect(() => {
    if (!open) return;
    let cancelled = false;
    setArriving(false);

    const run = async () => {
      if (!mountedRef.current) {
        show(true);
        // 等 React 把播放页真正挂上去（下一帧），否则量不到大封面
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      if (cancelled) return;
      const morph = reduce ? null : measure();
      if (!morph) {
        stopAnimations();
        setActive(true);
        return;
      }
      stopAnimations();
      play('in', morph);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (cancelled) return;
      setActive(true);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, reduce, measure, play, show, stopAnimations]);

  // 收起：封面飞回条里，内容下沉淡出，动画放完再卸载
  useLayoutEffect(() => {
    if (open) return;
    if (!mountedRef.current) return;
    let cancelled = false;

    const run = async () => {
      const morph = reduce ? null : measure();
      stopAnimations();
      if (morph) play('out', morph);
      setActive(false);
      setArriving(true);
      await new Promise<void>(resolve => setTimeout(resolve, reduce ? 0 : MORPH_MS));
      if (cancelled) return;
      show(false);
      setArriving(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, reduce, measure, play, show, stopAnimations]);

  // 队列被清空时（没有当前曲目）直接收摊，避免留一层空播放页
  useEffect(() => {
    if (player.current) return;
    stopAnimations();
    show(false);
    setActive(false);
    setArriving(false);
    if (open) onClose();
  }, [player.current, open, onClose, show, stopAnimations]);

  return (
    <>
      <PlayerBar
        player={player}
        expanded={mounted}
        onToggleStage={() => (open ? onClose() : onOpen())}
        onToggleQueue={onToggleQueue}
        queueOpen={queueOpen}
        hideNowPlaying={mounted}
        arriving={arriving}
        coverRef={barCoverRef}
        metaRef={barMetaRef}
      />
      {mounted ? (
        <PlayerStage
          player={player}
          open={active}
          coverRef={stageCoverRef}
          metaRef={stageMetaRef}
        />
      ) : null}
    </>
  );
}
