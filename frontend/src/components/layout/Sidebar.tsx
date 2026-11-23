import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutGrid, Boxes, FileBarChart, LogOut, Copy, RotateCcw } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { AttackIcon } from '@/components/icons/SecurityIcons';
import { useAuthStore } from '@/stores/authStore';
import { useQuotaStore } from '@/stores/quotaStore';
import { SimBadge } from '@/components/common/SimBadge';
import { DossierNo } from '@/components/common/DossierNo';
import { dossierNo, getWorkspaceId, regenerateWorkspace, workspaceShort } from '@/utils/workspace';

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
  color: active ? 'var(--bb-brand-primary)' : 'var(--bb-text-2)',
  background: active ? 'var(--bb-bg-subtle)' : 'transparent',
  transition: 'background-color 150ms ease, color 150ms ease',
});

export function Sidebar() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const quota = useQuotaStore((s) => s.quota);
  const refreshQuota = useQuotaStore((s) => s.refresh);
  const [wsId] = useState(getWorkspaceId);
  const dossier = dossierNo(wsId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  const guestUsed = quota?.guest_used_calls ?? 0;
  const guestMax = quota?.guest_max_calls ?? 0;
  const guestLeft = Math.max(0, guestMax - guestUsed);

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
      className="bb-sider"
      style={{
        width: 240,
        flexShrink: 0,
        height: '100vh',
        position: 'sticky',
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bb-sidebar-bg)',
        borderRight: '1px solid var(--bb-border)',
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
          borderBottom: '1px solid var(--bb-border)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Logo size={32} withText />
      </button>

      <div
        style={{
          padding: '10px 18px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <DossierNo no={dossier} label="本工作区案卷档号" />
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--bb-text-3)' }}>
          ARCHIVE
        </span>
      </div>

      <nav className="bb-sider-nav" style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <div className="bb-sider-label" style={{ fontSize: 12, fontWeight: 500, color: 'var(--bb-text-3)', padding: '8px 12px 6px' }}>
          案卷导航
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} style={({ isActive }) => rowStyle(isActive)}>
            <item.icon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</span>
          </NavLink>
        ))}

        <div className="bb-sider-label" style={{ fontSize: 12, fontWeight: 500, color: 'var(--bb-text-3)', padding: '20px 12px 6px' }}>
          攻防阅档舱
        </div>
        <button onClick={() => navigate('/workspace')} style={{ ...rowStyle(false), border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
          <AttackIcon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>实时控制台</span>
        </button>
      </nav>

      <div style={{ padding: 12, borderTop: '1px solid var(--bb-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 20 }}>
            <span style={{ fontSize: 12, color: 'var(--bb-text-3)' }}>工作区</span>
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
                color: copied ? 'var(--bb-brand-primary)' : 'var(--bb-text-2)',
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
              color: 'var(--bb-text-3)',
              fontSize: 12,
            }}
          >
            <RotateCcw size={11} strokeWidth={1.5} />
            切换到新工作区
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', height: 20 }}>
          <span style={{ fontSize: 12, color: 'var(--bb-text-3)' }}>今日调用</span>
          <span
            className="mono"
            title={guestMax ? `游客每工作区每日 ${guestMax} 次模型调用，剩余 ${guestLeft} 次` : '模型调用额度'}
            style={{ fontSize: 12, color: guestMax && guestLeft === 0 ? 'var(--bb-block-text)' : 'var(--bb-text-2)' }}
          >
            {guestMax ? `${guestUsed}/${guestMax}` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
          <SimBadge compact />
          <span style={{ fontSize: 12, color: 'var(--bb-text-3)' }}>游客</span>
        </div>
        <button
          onClick={async () => {
            await logout();
            navigate('/portal');
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 32,
            padding: '0 12px',
            borderRadius: 8,
            border: '1px solid var(--bb-border)',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--bb-text-2)',
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