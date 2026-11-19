import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App, Button, Popover } from 'antd';
import { Compass, LifeBuoy, Check, Play, RotateCcw } from 'lucide-react';
import { useTourStore, type TourId } from './tourStore';
import { TOUR_META, tourForPath } from './definitions';
import { useAuthStore } from '@/stores/authStore';

// 右下角引导悬浮按钮：重播本页引导 / 跳转播放其他页面引导 / 重置自动播放。
export function TourLauncher() {
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const status = useAuthStore((s) => s.status);
  const activeTour = useTourStore((s) => s.activeTour);
  const seen = useTourStore((s) => s.seen);
  const pending = useTourStore((s) => s.pending);
  const start = useTourStore((s) => s.start);
  const requestTour = useTourStore((s) => s.requestTour);
  const resetSeen = useTourStore((s) => s.resetSeen);
  const [open, setOpen] = useState(false);
  const tourId = tourForPath(location.pathname);

  if (status !== 'authenticated' || !tourId || activeTour) return null;

  const play = (id: TourId) => {
    setOpen(false);
    if (id === tourId) {
      start(id);
      return;
    }
    const meta = TOUR_META.find((m) => m.id === id);
    if (!meta) return;
    requestTour(id);
    navigate(meta.entry);
    if (meta.contextual) {
      message.info(`已标记「${meta.label}」引导，进入对应页面后自动播放`);
    }
  };

  const menu = (
    <div className="fg-tour-menu">
      <div className="fg-tour-menu-head">
        <div className="fg-tour-menu-title">
          <LifeBuoy size={15} strokeWidth={1.5} /> 新手引导中心
        </div>
        <div className="fg-tour-menu-sub">每个页面首次进入自动播放，也可随时重看</div>
      </div>
      <div className="fg-tour-menu-list">
        {TOUR_META.map((m) => {
          const here = m.id === tourId;
          const done = !!seen[m.id];
          return (
            <button key={m.id} type="button" className={here ? 'fg-tour-menu-item here' : 'fg-tour-menu-item'} onClick={() => play(m.id)}>
              <span className="fg-tour-menu-icon">
                <m.icon size={15} strokeWidth={1.5} />
              </span>
              <span className="fg-tour-menu-text">
                <span className="fg-tour-menu-label">
                  {m.label}
                  {here && <em>本页</em>}
                </span>
                <span className="fg-tour-menu-desc">
                  {m.desc}
                  {m.contextual && !here ? ' · 进入页面后播放' : ''}
                </span>
              </span>
              <span className="fg-tour-menu-state">{done ? <Check size={13} /> : <Play size={12} />}</span>
            </button>
          );
        })}
      </div>
      <div className="fg-tour-menu-foot">
        <Button
          size="small"
          type="text"
          icon={<RotateCcw size={13} />}
          onClick={() => {
            resetSeen();
            message.success('已重置，各页面首次进入将重新自动播放');
          }}
        >
          重置全部自动播放
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topRight"
      arrow={false}
      overlayClassName="fg-tour-popover"
      content={menu}
    >
      <button
        type="button"
        aria-label="打开新手引导"
        className="fg-tour-fab"
        style={{ bottom: 24 }}
      >
        <Compass size={20} strokeWidth={1.5} />
        {pending && <span className="fg-tour-fab-dot" />}
      </button>
    </Popover>
  );
}