import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutGrid, Boxes, ShieldCheck, FileBarChart, SlidersHorizontal, Swords, LogOut } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { SimBadge } from '@/components/common/SimBadge';

const NAV = [
  { to: '/orchestration', label: '编排中心', desc: '配置靶标 Agent', icon: LayoutGrid },
  { to: '/instances', label: '实例管理', desc: '运行与克隆', icon: Boxes },
  { to: '/reports', label: '测评报告', desc: '根因与加固', icon: FileBarChart },
];

export function Sidebar() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const logout = useAuthStore((s) => s.logout);
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';

  return (
    <aside
      className="fg-sider"
      style={{
        width: 224,
        flexShrink: 0,
        height: '100vh',
        position: 'sticky',
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--fg-sidebar-bg)',
        borderRight: '1px solid var(--fg-border)',
      }}
    >
      <button
        onClick={() => navigate('/workspace')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '18px 18px 16px',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--fg-border)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Logo size={34} withText />
      </button>

      <nav className="fg-sider-nav" style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
        <div className="fg-sider-label" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--fg-text-3)', padding: '4px 10px 8px' }}>
          科研工作区
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '10px 12px',
              borderRadius: 10,
              textDecoration: 'none',
              color: isActive ? (lab ? '#6bc7b3' : '#176b63') : 'var(--fg-text-2)',
              background: isActive ? (lab ? 'rgba(107,199,179,0.1)' : '#e4f2ef') : 'transparent',
              border: `1px solid ${isActive ? (lab ? 'rgba(107,199,179,0.25)' : '#cfe6e0') : 'transparent'}`,
              transition: 'all 160ms ease',
            })}
          >
            {({ isActive }) => (
              <>
                <item.icon size={18} strokeWidth={1.6} style={{ flexShrink: 0, color: isActive ? 'inherit' : 'var(--fg-text-3)' }} />
                <span style={{ lineHeight: 1.2 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: isActive ? 600 : 500 }}>{item.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-text-3)', marginTop: 1 }}>{item.desc}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}

        <div className="fg-sider-label" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--fg-text-3)', padding: '16px 10px 8px' }}>
          攻防实验舱
        </div>
        <button
          onClick={() => navigate('/workspace')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px dashed var(--fg-border)',
            background: 'var(--fg-bg-subtle)',
            cursor: 'pointer',
            textAlign: 'left',
            color: 'var(--fg-text-2)',
          }}
        >
          <Swords size={18} strokeWidth={1.6} style={{ color: 'var(--fg-observe)' }} />
          <span style={{ lineHeight: 1.2 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>实时控制台</span>
            <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-text-3)', marginTop: 1 }}>从实例进入会话</span>
          </span>
        </button>

        {role === 'admin' && (
          <NavLink
            to="/admin"
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '10px 12px',
              borderRadius: 10,
              marginTop: 4,
              textDecoration: 'none',
              color: isActive ? (lab ? '#6bc7b3' : '#176b63') : 'var(--fg-text-2)',
              background: isActive ? (lab ? 'rgba(107,199,179,0.1)' : '#e4f2ef') : 'transparent',
            })}
          >
            <SlidersHorizontal size={18} strokeWidth={1.6} />
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>平台管理</span>
          </NavLink>
        )}
      </nav>

      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--fg-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SimBadge compact />
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: role === 'admin' ? 'var(--fg-observe-text)' : 'var(--fg-text-3)',
              textTransform: 'uppercase',
            }}
          >
            {role || 'guest'}
          </span>
        </div>
        <button
          onClick={async () => {
            await logout();
            navigate('/access');
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--fg-border)',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--fg-text-2)',
            fontSize: 12.5,
          }}
        >
          <LogOut size={14} strokeWidth={1.6} />
          退出实验室
        </button>
      </div>
    </aside>
  );
}