import { useEffect, useId, useState } from 'react';
import { useTourStore } from './tourStore';
import { TOURS } from './definitions';

interface Hole {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 自绘聚光罩：rc-tour 自带 Mask 在目标超出视口时会写出负宽高 rect（控制台报错且漏拦截），
// 这里对所有 rect 做视口钳制，并跟随滚动/resize 实时刷新聚光位置。
export function TourMask() {
  const activeTour = useTourStore((s) => s.activeTour);
  const current = useTourStore((s) => s.current);
  const [hole, setHole] = useState<Hole | null>(null);
  const maskId = useId();

  useEffect(() => {
    if (!activeTour) {
      setHole(null);
      return;
    }
    const step = TOURS[activeTour].steps[current];
    const measure = () => {
      const el = typeof step?.target === 'function' ? step.target() : null;
      if (!el) {
        setHole(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.max(0, r.left);
      const y = Math.max(0, r.top);
      const w = Math.max(0, Math.min(vw, r.right) - x);
      const h = Math.max(0, Math.min(vh, r.bottom) - y);
      setHole(w > 0 && h > 0 ? { x, y, w, h } : null);
    };
    measure();
    let raf = 0;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [activeTour, current]);

  if (!activeTour) return null;
  const color = 'rgba(21, 40, 37, 0.48)';
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    <div className="bb-tour-mask" style={{ pointerEvents: hole ? 'none' : 'auto' }} aria-hidden>
      <svg>
        {hole && (
          <defs>
            <mask id={maskId}>
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={8} fill="black" />
            </mask>
          </defs>
        )}
        <rect x="0" y="0" width="100%" height="100%" fill={color} mask={hole ? `url(#${maskId})` : undefined} />
        {hole && (
          <>
            {hole.y > 0 && <rect x="0" y="0" width="100%" height={hole.y} fill="transparent" pointerEvents="auto" />}
            {hole.x > 0 && <rect x="0" y="0" width={hole.x} height="100%" fill="transparent" pointerEvents="auto" />}
            {hole.y + hole.h < vh && <rect x="0" y={hole.y + hole.h} width="100%" height={vh - hole.y - hole.h} fill="transparent" pointerEvents="auto" />}
            {hole.x + hole.w < vw && <rect x={hole.x + hole.w} y="0" width={vw - hole.x - hole.w} height="100%" fill="transparent" pointerEvents="auto" />}
          </>
        )}
      </svg>
    </div>
  );
}