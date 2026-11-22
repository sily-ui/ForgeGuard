import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { PixiPlugin } from 'gsap/PixiPlugin';

gsap.registerPlugin(MotionPathPlugin, PixiPlugin);

export interface PixiFXHandle {
  /** 屏幕坐标（相对特效层容器）处的阻断/告警爆发：火花 + 扩散环 */
  burst: (x: number, y: number, color: string) => void;
  /** 沿屏幕坐标折线飞行的发光数据包，GSAP MotionPath 驱动 */
  packet: (points: { x: number; y: number }[], color: string, duration?: number) => void;
  /** 0~1 活跃度：驱动氛围粒子密度与扫光速度 */
  setActivity: (level: number) => void;
}

interface Props {
  className?: string;
}

const DUST_COLORS = [0x176b63, 0x4f7ba6, 0xc2892b, 0x8d97a1];

function dotTexture(app: Application): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

// WebGL 特效层：氛围粒子 + 周期扫光 + 事件数据包/爆发。WebGL 不可用或 reduced-motion 时静默退化为空层。
export const PixiFX = forwardRef<PixiFXHandle, Props>(function PixiFX({ className }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<PixiFXHandle | null>(null);

  useImperativeHandle(ref, () => ({
    burst: (x, y, color) => apiRef.current?.burst(x, y, color),
    packet: (points, color, duration) => apiRef.current?.packet(points, color, duration),
    setActivity: (level) => apiRef.current?.setActivity(level),
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let app: Application | null = null;
    let destroyed = false;
    let activity = 0.25;
    const dust: { s: Sprite; vx: number; vy: number; tw: number }[] = [];
    let sweep: Graphics | null = null;
    let tickerFn: ((time: number, deltaMS: number) => void) | null = null;
    const ctx = gsap.context(() => {}, host);

    const init = async () => {
      try {
        const a = new Application();
        await a.init({
          backgroundAlpha: 0,
          antialias: true,
          resizeTo: host,
          preference: 'webgl',
          resolution: Math.min(window.devicePixelRatio || 1, 1.5),
          autoDensity: true,
        });
        if (destroyed) {
          a.destroy(true, { children: true });
          return;
        }
        app = a;
        host.appendChild(a.canvas);
        a.canvas.style.position = 'absolute';
        a.canvas.style.inset = '0';
        a.canvas.style.pointerEvents = 'none';

        const tex = dotTexture(a);
        const layer = new Container();
        a.stage.addChild(layer);

        for (let i = 0; i < 46; i++) {
          const s = new Sprite(tex);
          s.anchor.set(0.5);
          const size = 2 + Math.random() * 5;
          s.width = s.height = size;
          s.tint = DUST_COLORS[i % DUST_COLORS.length];
          s.alpha = 0.05 + Math.random() * 0.16;
          s.x = Math.random() * host.clientWidth;
          s.y = Math.random() * host.clientHeight;
          layer.addChild(s);
          dust.push({ s, vx: (Math.random() - 0.5) * 0.012, vy: -0.004 - Math.random() * 0.012, tw: Math.random() * Math.PI * 2 });
        }

        sweep = new Graphics();
        sweep.rect(0, 0, 4096, 46).fill({ color: 0x176b63, alpha: 0.05 });
        sweep.rect(0, 44, 4096, 2).fill({ color: 0x176b63, alpha: 0.14 });
        sweep.y = -60;
        a.stage.addChildAt(sweep, 0);
        const sweepLoop = () => {
          if (!app || destroyed) return;
          ctx.add(() => {
            gsap.fromTo(
              sweep,
              { y: -60 },
              { y: host.clientHeight + 20, duration: 7 - activity * 3.5, ease: 'none', onComplete: sweepLoop },
            );
          });
        };
        sweepLoop();

        tickerFn = (_time, deltaMS) => {
          if (!app) return;
          const w = host.clientWidth;
          const h = host.clientHeight;
          const speed = 0.5 + activity * 1.6;
          for (const p of dust) {
            p.s.x += p.vx * deltaMS * speed;
            p.s.y += p.vy * deltaMS * speed;
            p.tw += deltaMS * 0.0012;
            p.s.alpha = (0.05 + 0.14 * activity) * (0.6 + 0.4 * Math.sin(p.tw));
            if (p.s.y < -8) { p.s.y = h + 6; p.s.x = Math.random() * w; }
            if (p.s.x < -8) p.s.x = w + 6;
            if (p.s.x > w + 8) p.s.x = -6;
          }
        };
        gsap.ticker.add(tickerFn);

        const hex = (c: string) => parseInt(c.replace('#', ''), 16);

        apiRef.current = {
          setActivity: (level) => { activity = Math.max(0, Math.min(1, level)); },
          burst: (x, y, color) => {
            if (!app) return;
            const tint = hex(color);
            ctx.add(() => {
              const ring = new Graphics();
              ring.circle(0, 0, 10).stroke({ width: 2, color: tint, alpha: 0.9 });
              ring.x = x; ring.y = y;
              app!.stage.addChild(ring);
              gsap.to(ring, { pixi: { scale: 3.4, alpha: 0 }, duration: 0.65, ease: 'power2.out', onComplete: () => ring.destroy() });
              for (let i = 0; i < 16; i++) {
                const sp = new Sprite(tex);
                sp.anchor.set(0.5);
                sp.tint = tint;
                sp.width = sp.height = 3 + Math.random() * 4;
                sp.x = x; sp.y = y;
                app!.stage.addChild(sp);
                const ang = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
                const dist = 18 + Math.random() * 30;
                gsap.to(sp, {
                  x: x + Math.cos(ang) * dist,
                  y: y + Math.sin(ang) * dist,
                  alpha: 0,
                  duration: 0.5 + Math.random() * 0.35,
                  ease: 'power2.out',
                  onComplete: () => sp.destroy(),
                });
              }
            });
          },
          packet: (points, color, duration = 0.7) => {
            if (!app || points.length < 2) return;
            ctx.add(() => {
              const sp = new Sprite(tex);
              sp.anchor.set(0.5);
              sp.tint = hex(color);
              sp.width = sp.height = 9;
              sp.x = points[0].x; sp.y = points[0].y;
              app!.stage.addChild(sp);
              const trail = new Sprite(tex);
              trail.anchor.set(0.5);
              trail.tint = hex(color);
              trail.width = trail.height = 16;
              trail.alpha = 0.25;
              trail.x = sp.x; trail.y = sp.y;
              app!.stage.addChildAt(trail, app!.stage.getChildIndex(sp));
              gsap.to(sp, {
                motionPath: { path: points, curviness: 0 },
                duration,
                ease: 'power1.inOut',
                onComplete: () => sp.destroy(),
              });
              gsap.to(trail, {
                motionPath: { path: points, curviness: 0 },
                duration,
                delay: 0.06,
                ease: 'power1.inOut',
                onComplete: () => trail.destroy(),
              });
            });
          },
        };
      } catch {
        /* WebGL 不可用：保留 CSS 静态底纹 */
      }
    };
    void init();

    return () => {
      destroyed = true;
      apiRef.current = null;
      if (tickerFn) gsap.ticker.remove(tickerFn);
      ctx.revert();
      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
    };
  }, []);

  return <div ref={hostRef} className={className} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} />;
});