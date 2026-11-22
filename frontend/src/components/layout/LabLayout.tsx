import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { LabAntdProvider } from '@/theme/antdTheme';

// 攻防实验舱外壳：隐藏常规导航，整屏沉浸，由具体页面自管顶栏。
// 夜档主题需要作用于 body（背景与滚动条），挂载时在 body 上切换，卸载时还原。
export function LabLayout() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    document.body.dataset.theme = 'lab';
    return () => {
      delete document.body.dataset.theme;
    };
  }, []);

  return (
    <div
      className="fg-lab"
      data-theme="lab"
      style={{
        minHeight: '100vh',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--fg-bg-page)',
        overflow: 'hidden',
      }}
    >
      <LabAntdProvider>
        <Outlet />
      </LabAntdProvider>
    </div>
  );
}
