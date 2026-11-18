import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

// 攻防实验舱外壳：隐藏常规导航，整屏沉浸，由具体页面自管顶栏。
export function LabLayout() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div
      className="fg-lab"
      style={{
        minHeight: '100vh',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--fg-bg-page)',
        overflow: 'hidden',
      }}
    >
      <Outlet />
    </div>
  );
}
