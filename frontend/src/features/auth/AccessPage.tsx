import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Form } from 'antd';
import { KeyRound, ArrowRight, FlaskConical } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { AttackIcon, GuardIcon, ForensicsIcon } from '@/components/icons/SecurityIcons';
import { useAuthStore } from '@/stores/authStore';
import { SimBadge } from '@/components/common/SimBadge';

const FEATURES = [
  { icon: AttackIcon, title: '自适应红队测评', desc: '提示注入 / 越狱 / 越权 / 链式攻击样本库，一键载入复现' },
  { icon: GuardIcon, title: '动态旁路监护', desc: 'L1 规则 → L2 分类 → L3 语义三级判定，实时阻断越界调用' },
  { icon: ForensicsIcon, title: '根因与加固报告', desc: '六部分取证报告，配置缺陷归因与可执行加固建议' },
];

export default function AccessPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const [passcode, setPasscode] = useState('');

  const submit = async () => {
    if (!passcode.trim()) return;
    const ok = await login(passcode.trim());
    if (ok) navigate('/workspace', { replace: true });
  };

  return (
    <div className="fg-access" style={{ minHeight: '100vh', display: 'flex', background: 'var(--fg-bg-page)' }}>
      {/* 左侧品牌区：石墨底 + 实验链路图 */}
      <div
        className="fg-access-hero"
        style={{
          flex: '0 0 55%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 32,
          padding: '56px 64px',
          background: 'var(--fg-bg-card)',
          borderRight: '1px solid var(--fg-border)',
        }}
      >
        <div style={{ maxWidth: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
            <Logo size={34} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-text-1)' }}>Agent Security Lab</div>
              <div style={{ fontSize: 12.5, color: 'var(--fg-text-3)', marginTop: 1 }}>智能体安全实验室 · ForgeGuard</div>
            </div>
          </div>

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

      {/* 右侧准入区 */}
      <div className="fg-access-panel" style={{ flex: '0 0 45%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--fg-text-2)', fontSize: 13.5, marginBottom: 16 }}>
              <FlaskConical size={14} strokeWidth={1.5} style={{ color: 'var(--fg-info-text)' }} />
              全内存仿真 · 不触及真实系统
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px', color: 'var(--fg-text-1)' }}>进入实验室</h2>
            <p style={{ fontSize: 14, color: 'var(--fg-text-2)', margin: 0, lineHeight: 1.6 }}>
              输入准入口令以获取会话令牌。令牌仅存于内存，不写入地址栏。
            </p>
          </div>

          <Form layout="vertical" onFinish={submit}>
            <Form.Item label={<span style={{ fontWeight: 500, fontSize: 14 }}>准入口令</span>} validateStatus={error ? 'error' : undefined} help={error || undefined}>
              <Input.Password
                size="large"
                prefix={<KeyRound size={16} strokeWidth={1.5} style={{ color: 'var(--fg-text-3)' }} />}
                placeholder="请输入准入口令"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                autoFocus
                allowClear
              />
            </Form.Item>
            <Button type="primary" size="large" htmlType="submit" block loading={status === 'loading'} style={{ height: 44, fontWeight: 600, fontSize: 15 }}>
              进入实验室 <ArrowRight size={16} strokeWidth={1.5} />
            </Button>
          </Form>

          <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg-text-3)', marginBottom: 10 }}>演示口令</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PasscodeHint code="demo-2026" role="评委 / 演示" onPick={() => setPasscode('demo-2026')} />
              <PasscodeHint code="admin-2026" role="平台管理员" onPick={() => setPasscode('admin-2026')} />
            </div>
          </div>

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
            <SimBadge />
          </div>
        </div>
      </div>
    </div>
  );
}

function PasscodeHint({ code, role, onPick }: { code: string; role: string; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid var(--fg-border)',
        background: 'var(--fg-bg-card)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fg-bg-subtle)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--fg-bg-card)'; }}
    >
      <span className="mono" style={{ fontSize: 14, color: 'var(--fg-text-1)' }}>{code}</span>
      <span style={{ fontSize: 12.5, color: 'var(--fg-text-3)' }}>{role}</span>
    </button>
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
          <pattern id="fg-access-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="var(--fg-border)" strokeWidth="0.5" />
          </pattern>
          <marker id="fg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 8 4 0 8Z" fill="var(--fg-text-3)" />
          </marker>
          <marker id="fg-arrow-block" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 8 4 0 8Z" fill="var(--fg-block)" />
          </marker>
        </defs>
        <rect width="520" height="252" fill="url(#fg-access-grid)" opacity="0.6" />

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