import { useNavigate } from 'react-router-dom';
import { Alert, Button } from 'antd';
import { ArrowRight, FlaskConical, Gauge, UserRound, Boxes } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { AttackIcon, GuardIcon, ForensicsIcon } from '@/components/icons/SecurityIcons';
import { useAuthStore } from '@/stores/authStore';
import { SimBadge } from '@/components/common/SimBadge';
import { getWorkspaceId, workspaceShort } from '@/utils/workspace';

const FEATURES = [
  { icon: AttackIcon, title: '自适应红队测评', desc: '提示注入 / 越狱 / 越权 / 链式攻击样本库，一键载入复现' },
  { icon: GuardIcon, title: '动态旁路监护', desc: 'L1 规则 → L2 分类 → L3 语义三级判定，实时阻断越界调用' },
  { icon: ForensicsIcon, title: '根因与加固报告', desc: '六部分取证报告，配置缺陷归因与可执行加固建议' },
];

const ENTRY_NOTES = [
  { icon: UserRound, title: '游客身份', desc: '无需注册与口令，令牌仅存于内存' },
  { icon: Gauge, title: '每日调用额度', desc: '模型调用按日限量，额度用尽次日恢复' },
  { icon: Boxes, title: '工作区隔离', desc: '实验数据仅属于当前浏览器工作区' },
];

export default function PortalPage() {
  const navigate = useNavigate();
  const enter = useAuthStore((s) => s.enter);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const wsId = getWorkspaceId();

  const submit = async () => {
    const ok = await enter();
    if (ok) navigate('/workspace', { replace: true });
  };

  return (
    <div className="fg-portal" style={{ minHeight: '100vh', display: 'flex', background: 'var(--fg-bg-page)' }}>
      {/* 左侧品牌区：品牌抬头 → 主张与能力 → 实验链路图 */}
      <div
        className="fg-portal-hero"
        style={{
          flex: '0 0 55%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 40,
          padding: '48px 56px',
          background: 'var(--fg-bg-card)',
          borderRight: '1px solid var(--fg-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={34} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-text-1)' }}>Agent Security Lab</div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-text-3)', marginTop: 1 }}>智能体安全实验室 · ForgeGuard</div>
          </div>
        </div>

        <div style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 30, lineHeight: 1.3, fontWeight: 600, margin: '0 0 14px', color: 'var(--fg-text-1)' }}>
            为可编排 Agent 构建
            <br />
            自适应红队与旁路监护
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--fg-text-2)', margin: '0 0 28px', maxWidth: 460 }}>
            在内存仿真沙盒中编排靶标 Agent，载入真实攻击样本，观测三级判定网关如何实时拦截越界调用，并生成可追溯的根因加固报告。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ display: 'inline-flex', color: 'var(--fg-text-3)', marginTop: 2, flexShrink: 0 }}>
                  <f.icon size={16} strokeWidth={1.5} />
                </span>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{f.title}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--fg-text-2)', lineHeight: 1.5, marginTop: 2 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <LabDiagram />
      </div>

      {/* 右侧门户区：单一进入动作 */}
      <div className="fg-portal-panel" style={{ flex: '0 0 45%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--fg-text-2)', fontSize: 13.5, marginBottom: 16 }}>
            <FlaskConical size={14} strokeWidth={1.5} style={{ color: 'var(--fg-info-text)' }} />
            全内存仿真 · 不触及真实系统
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 8px', color: 'var(--fg-text-1)' }}>进入实验室</h2>
          <p style={{ fontSize: 14, color: 'var(--fg-text-2)', margin: '0 0 24px', lineHeight: 1.6 }}>
            以游客身份直接开始，无需注册。平台为每个浏览器分配独立工作区，并对模型调用按日限量。
          </p>

          <Button
            type="primary"
            size="large"
            block
            loading={status === 'loading'}
            onClick={submit}
            style={{ height: 46, fontWeight: 600, fontSize: 15 }}
          >
            {error ? '重试进入' : '进入实验室'} <ArrowRight size={16} strokeWidth={1.5} />
          </Button>

          {error && (
            <Alert
              type="error"
              showIcon
              message="暂时无法进入"
              description={error}
              style={{ marginTop: 12 }}
            />
          )}

          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {ENTRY_NOTES.map((n) => (
              <div key={n.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ display: 'inline-flex', color: 'var(--fg-text-3)', marginTop: 2, flexShrink: 0 }}>
                  <n.icon size={16} strokeWidth={1.5} />
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-text-1)' }}>{n.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--fg-text-2)', lineHeight: 1.5, marginTop: 2 }}>{n.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--fg-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <SimBadge />
            <span className="mono" style={{ fontSize: 12, color: 'var(--fg-text-3)' }} title={`当前工作区 ${wsId}`}>
              工作区 {workspaceShort(wsId)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// 实验链路图：红队 → 靶标 Agent → 仿真沙盒，旁路监护镜像与阻断点。
// 产品自身的拓扑作为门面视觉，攻击路径以流动虚线表示方向。
function LabDiagram() {
  const nodes: Array<{ x: number; y: number; label: string }> = [
    { x: 80, y: 84, label: '红队攻击源' },
    { x: 260, y: 84, label: '靶标 Agent' },
    { x: 440, y: 84, label: '仿真沙盒' },
    { x: 260, y: 196, label: '旁路监护网关' },
  ];
  return (
    <figure style={{ margin: 0, maxWidth: 520 }}>
      <svg viewBox="0 0 520 252" width="100%" role="img" aria-label="实验链路：红队攻击源到靶标 Agent 到仿真沙盒，旁路监护网关镜像判定并可阻断">
        <defs>
          <pattern id="fg-portal-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="var(--fg-border)" strokeWidth="0.5" />
          </pattern>
          <marker id="fg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 8 4 0 8Z" fill="var(--fg-text-3)" />
          </marker>
          <marker id="fg-arrow-block" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 8 4 0 8Z" fill="var(--fg-block)" />
          </marker>
        </defs>
        <rect width="520" height="252" fill="url(#fg-portal-grid)" opacity="0.6" />

        {/* 攻击路径 */}
        <path
          d="M104 84H232"
          stroke="var(--fg-block)"
          strokeWidth="1.5"
          strokeDasharray="5 5"
          markerEnd="url(#fg-arrow-block)"
          style={{ animation: 'fg-flow-dash 1.2s linear infinite' }}
        />
        {/* 工具调用 */}
        <path d="M288 84H412" stroke="var(--fg-text-3)" strokeWidth="1.5" markerEnd="url(#fg-arrow)" />
        {/* 阻断点：监护网关可在工具调用路径上拦截 */}
        <path d="M350 74v20" stroke="var(--fg-block)" strokeWidth="2" />
        {/* 旁路镜像 */}
        <path d="M260 108v64" stroke="var(--fg-info)" strokeWidth="1.5" strokeDasharray="3 5" />
        <path d="M288 196H440V112" stroke="var(--fg-info)" strokeWidth="1.5" strokeDasharray="3 5" fill="none" markerEnd="url(#fg-arrow)" />

        {nodes.map((n) => (
          <g key={n.label}>
            <rect x={n.x - 24} y={n.y - 24} width="48" height="48" rx="8" fill="var(--fg-bg-card)" stroke="var(--fg-border)" strokeWidth="1.5" />
            <rect x={n.x - 5} y={n.y - 5} width="10" height="10" fill={n.label.includes('监护') ? 'var(--fg-info)' : n.label.includes('红队') ? 'var(--fg-block)' : 'var(--fg-brand-primary)'} />
            <text x={n.x} y={n.y + 42} textAnchor="middle" fontSize="11" fill="var(--fg-text-2)">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mono" style={{ fontSize: 11.5, color: 'var(--fg-text-3)', marginTop: 8 }}>
        攻击路径 · 旁路镜像 · 实时阻断
      </figcaption>
    </figure>
  );
}