import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutGrid, Boxes, FileBarChart, SlidersHorizontal, LogOut, Copy, RotateCcw } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { AttackIcon } from '@/components/icons/SecurityIcons';
import { useAuthStore } from '@/stores/authStore';
import { SimBadge } from '@/components/common/SimBadge';
import { getWorkspaceId, regenerateWorkspace, workspaceShort } from '@/utils/workspace';

const NAV = [
  { to: '/orchestration', label: '编排中心', icon: LayoutGrid },
  { to: '/instances', label: '实例管理', icon: Boxes },
  { to: '/reports', label: '测评报告', icon: FileBarChart },
];

const rowStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 36,
  padding: '0 12px',
  borderRadius: 8,
  textDecoration: 'none',
  color: active ? 'var(--fg-brand-primary)' : 'var(--fg-text-2)',
  background: active ? 'var(--fg-bg-subtle)' : 'transparent',
  transition: 'background-color 150ms ease, color 150ms ease',
});

export function Sidebar() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const logout = useAuthStore((s) => s.logout);
  const [wsId] = useState(getWorkspaceId);
  const [copied, setCopied] = useState(false);

  const copyWorkspace = async () => {
    try {
      await navigator.clipboard.writeText(wsId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默失败，标识仍可通过开发者工具查看。
    }
  };

  const switchWorkspace = () => {
    const ok = window.confirm('切换后将进入一个全新的空白工作区，当前工作区的数据不会随之迁移。确认切换？');
    if (!ok) return;
    regenerateWorkspace();
    window.location.reload();
  };

  return (
    <aside
      className="fg-sider"
      style={{
        width: 240,
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
          padding: 16,
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--fg-border)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Logo size={32} withText />
      </button>

      <nav className="fg-sider-nav" style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <div className="fg-sider-label" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-text-3)', padding: '8px 12px 6px' }}>
          科研工作区
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} style={({ isActive }) => rowStyle(isActive)}>
            <item.icon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</span>
          </NavLink>
        ))}

        <div className="fg-sider-label" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-text-3)', padding: '20px 12px 6px' }}>
          攻防实验舱
        </div>
        <button onClick={() => navigate('/workspace')} style={{ ...rowStyle(false), border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
          <AttackIcon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>实时控制台</span>
        </button>

        {role === 'admin' && (
          <NavLink to="/admin" style={({ isActive }) => ({ ...rowStyle(isActive), marginTop: 2 })}>
            <SlidersHorizontal size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>平台管理</span>
          </NavLink>
        )}
      </nav>

      <div style={{ padding: 12, borderTop: '1px solid var(--fg-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 20 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>工作区</span>
            <button
              onClick={copyWorkspace}
              title={`点击复制完整标识 ${wsId}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '0 4px',
                height: 20,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderRadius: 4,
                color: copied ? 'var(--fg-brand-primary)' : 'var(--fg-text-2)',
              }}
            >
              <span className="mono" style={{ fontSize: 12 }}>{copied ? '已复制' : workspaceShort(wsId)}</span>
              <Copy size={11} strokeWidth={1.5} />
            </button>
          </div>
          <button
            onClick={switchWorkspace}
            title="换一个全新的空白工作区"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-start',
              padding: '0 4px',
              height: 20,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 4,
              color: 'var(--fg-text-3)',
              fontSize: 12,
            }}
          >
            <RotateCcw size={11} strokeWidth={1.5} />
            切换到新工作区
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
          <SimBadge compact />
          <span className="mono" style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>
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
            height: 32,
            padding: '0 12px',
            borderRadius: 8,
            border: '1px solid var(--fg-border)',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--fg-text-2)',
            fontSize: 13.5,
            transition: 'background-color 150ms ease, color 150ms ease',
          }}
        >
          <LogOut size={14} strokeWidth={1.5} />
          退出实验室
        </button>
      </div>
    </aside>
  );
}