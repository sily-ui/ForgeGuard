import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';

// 科研工作台外壳：侧边导航 + 内容区。
export function MainLayout() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="fg-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--fg-bg-page)' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, padding: 24, overflowX: 'hidden' }}>
        <div className="fg-page" style={{ maxWidth: 1320, margin: '0 auto' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
