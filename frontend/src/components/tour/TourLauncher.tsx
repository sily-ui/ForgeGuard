import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App, Button, List, Popover, Space, Tag, Typography } from 'antd';
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
    <Space direction="vertical" size={8} style={{ width: 'min(320px, calc(100vw - 64px))' }}>
      <Typography.Text type="secondary">每个页面首次进入自动播放，也可随时重看</Typography.Text>
      <List
        split={false}
        dataSource={TOUR_META}
        style={{ maxHeight: 'min(344px, calc(100dvh - 224px))', overflowY: 'auto' }}
        renderItem={(m) => {
          const here = m.id === tourId;
          const done = !!seen[m.id];
          return (
            <List.Item key={m.id} style={{ padding: 0 }}>
              <Button
                block
                type={here ? 'default' : 'text'}
                icon={<m.icon size={16} strokeWidth={1.5} />}
                aria-label={`${done ? '重播' : '播放'}${m.label}引导`}
                onClick={() => play(m.id)}
                style={{ height: 'auto', padding: 8, textAlign: 'left', whiteSpace: 'normal' }}
              >
                <Space direction="vertical" size={0} style={{ flex: 1, minWidth: 0 }}>
                  <Space size={8} wrap>
                    <Typography.Text strong>{m.label}</Typography.Text>
                    {here && <Tag color="processing">本页</Tag>}
                    {done && <Tag icon={<Check size={12} />}>已看</Tag>}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {m.desc}
                    {m.contextual && !here ? ' · 进入页面后播放' : ''}
                  </Typography.Text>
                </Space>
                <Play size={16} style={{ flexShrink: 0 }} />
              </Button>
            </List.Item>
          );
        }}
      />
      <Button
        block
        type="text"
        icon={<RotateCcw size={16} />}
        onClick={() => {
          resetSeen();
          message.success('已重置，各页面首次进入将重新自动播放');
        }}
      >
        重置全部自动播放
      </Button>
    </Space>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topRight"
      arrow={false}
      title={
        <Space size={8}>
          <LifeBuoy size={16} strokeWidth={1.5} />
          <Typography.Text strong>新手引导中心</Typography.Text>
        </Space>
      }
      content={menu}
    >
      <Button
        type="primary"
        aria-label="打开新手引导"
        aria-expanded={open}
        className="bb-tour-fab"
        style={{ width: 46, height: 46 }}
        icon={<Compass size={20} strokeWidth={1.5} />}
      >
        {pending && <span className="bb-tour-fab-dot" />}
      </Button>
    </Popover>
  );
}