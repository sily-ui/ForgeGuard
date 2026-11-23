import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Tour } from 'antd';
import { useTourStore } from './tourStore';
import { TOURS, tourForPath } from './definitions';
import { TourMask } from './TourMask';
import { useAuthStore } from '@/stores/authStore';

// 全局漫游引导渲染器：路由切换时自动关闭旧引导、首次进入自动播放、跨页请求落地播放。
export function AppTour() {
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const activeTour = useTourStore((s) => s.activeTour);
  const current = useTourStore((s) => s.current);
  const setCurrent = useTourStore((s) => s.setCurrent);
  const close = useTourStore((s) => s.close);
  const tourId = tourForPath(location.pathname);

  useEffect(() => {
    const st = useTourStore.getState();
    if (st.activeTour && st.activeTour !== tourId) st.close();
    if (tourId && st.pending === tourId) st.start(tourId);
  }, [tourId]);

  // 首次访问自动播放：等待页面锚点就绪（懒加载 + 数据请求），最多等约 4.5s。
  useEffect(() => {
    if (!tourId || status !== 'authenticated') return;
    if (useTourStore.getState().seen[tourId]) return;
    let tries = 0;
    let timer = 0;
    const tick = () => {
      tries += 1;
      const ready = TOURS[tourId].steps.some((s) => typeof s.target === 'function' && s.target() != null);
      if (ready || tries >= 15) {
        useTourStore.getState().start(tourId);
      } else {
        timer = window.setTimeout(tick, 300);
      }
    };
    timer = window.setTimeout(tick, 500);
    return () => window.clearTimeout(timer);
  }, [tourId, status]);

  const def = activeTour ? TOURS[activeTour] : null;
  if (!def) return null;
  const total = def.steps.length;

  return (
    <>
      <TourMask />
      <Tour
        open
        current={current}
        onChange={setCurrent}
        onClose={close}
        onFinish={close}
        steps={def.steps}
        rootClassName="bb-tour"
        gap={{ offset: 0, radius: 8 }}
        popupAlign={{ offset: [0, 0], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } }}
        mask={false}
        // rc-tour 仅在换步时测量一次目标矩形：smooth 滚动会在测量后才移动页面，导致聚光罩与卡片停在旧坐标。
        scrollIntoViewOptions={{ block: 'center' }}
        indicatorsRender={(cur, tot) => (
          <div className="bb-tour-ind">
            <span className="bb-tour-count mono">
              {cur + 1} / {tot}
            </span>
            <div className="bb-tour-dots">
              {Array.from({ length: tot }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`跳到第 ${i + 1} 步`}
                  className={i === cur ? 'bb-tour-dot active' : 'bb-tour-dot'}
                  onClick={() => setCurrent(i)}
                />
              ))}
            </div>
          </div>
        )}
        actionsRender={(_, { current: cur, total: tot }) => (
          <div className="bb-tour-actions">
            {cur < tot - 1 ? (
              <Button size="small" type="text" className="bb-tour-skip" onClick={close}>
                跳过引导
              </Button>
            ) : (
              <span />
            )}
            <div className="bb-tour-nav">
              {cur > 0 && (
                <Button size="small" onClick={() => setCurrent(cur - 1)}>
                  上一步
                </Button>
              )}
              <Button size="small" type="primary" onClick={() => (cur === tot - 1 ? close() : setCurrent(cur + 1))}>
                {cur === tot - 1 ? '完成，开始探索' : '下一步'}
              </Button>
            </div>
          </div>
        )}
      />
    </>
  );
}