import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Form } from 'antd';
import { KeyRound, ArrowRight, ShieldCheck, Swords, FileBarChart, FlaskConical } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { SimBadge } from '@/components/common/SimBadge';

const FEATURES = [
  { icon: Swords, title: '自适应红队测评', desc: '提示注入 / 越狱 / 越权 / 链式攻击样本库，一键载入复现' },
  { icon: ShieldCheck, title: '动态旁路监护', desc: 'L1 规则 → L2 分类 → L3 语义三级判定，实时阻断越界调用' },
  { icon: FileBarChart, title: '根因与加固报告', desc: '六部分取证报告，配置缺陷归因与可执行加固建议' },
];

export default function AccessPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const setSpace = useUiStore((s) => s.setSpace);
  const [passcode, setPasscode] = useState('');

  useEffect(() => {
    setSpace('light');
  }, [setSpace]);

  const submit = async () => {
    if (!passcode.trim()) return;
    const ok = await login(passcode.trim());
    if (ok) navigate('/workspace', { replace: true });
  };

  return (
    <div className="fg-access" style={{ minHeight: '100vh', display: 'flex', background: 'var(--fg-bg-page)' }}>
      {/* 左侧品牌区 55% */}
      <div
        className="fg-access-hero"
        style={{
          flex: '0 0 55%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '64px 72px',
          background: 'var(--fg-gradient-brand)',
          color: '#fff',
          overflow: 'hidden',
        }}
      >
        <TopologyBackdrop />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 }}>
            <div style={{ background: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 8, display: 'flex' }}>
              <Logo size={36} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Agent Security Lab</div>
              <div style={{ fontSize: 11.5, opacity: 0.8, letterSpacing: '0.1em' }}>智能体安全实验室 · ForgeGuard</div>
            </div>
          </div>

          <h1 style={{ fontSize: 38, lineHeight: 1.2, fontWeight: 800, margin: '0 0 18px', letterSpacing: '-0.02em' }}>
            为可编排 Agent 构建
            <br />
            自适应红队与旁路监护
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.7, opacity: 0.9, margin: '0 0 36px', maxWidth: 460 }}>
            在内存仿真沙盒中编排靶标 Agent，载入真实攻击样本，观测三级判定网关如何实时拦截越界调用，并生成可追溯的根因加固报告。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <f.icon size={19} strokeWidth={1.7} />
                </div>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{f.title}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.82, lineHeight: 1.5, marginTop: 2 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧准入区 45% */}
      <div className="fg-access-panel" style={{ flex: '0 0 45%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: 'var(--fg-brand-light)', color: 'var(--fg-brand-primary)', fontSize: 11.5, fontWeight: 600, marginBottom: 18 }}>
              <FlaskConical size={13} strokeWidth={1.8} />
              全内存仿真 · 不触及真实系统
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: 'var(--fg-text-1)' }}>进入实验室</h2>
            <p style={{ fontSize: 13.5, color: 'var(--fg-text-2)', margin: 0, lineHeight: 1.6 }}>
              输入准入口令以获取会话令牌。令牌仅存于内存，不写入地址栏。
            </p>
          </div>

          <Form layout="vertical" onFinish={submit}>
            <Form.Item label={<span style={{ fontWeight: 600, fontSize: 13 }}>准入口令</span>} validateStatus={error ? 'error' : undefined} help={error || undefined}>
              <Input.Password
                size="large"
                prefix={<KeyRound size={16} strokeWidth={1.7} style={{ color: 'var(--fg-text-3)' }} />}
                placeholder="请输入准入口令"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                autoFocus
                allowClear
              />
            </Form.Item>
            <Button type="primary" size="large" htmlType="submit" block loading={status === 'loading'} style={{ height: 46, fontWeight: 600, fontSize: 15 }}>
              进入实验室 <ArrowRight size={17} strokeWidth={2} />
            </Button>
          </Form>

          <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--fg-text-3)', marginBottom: 10 }}>演示口令</div>
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
        borderRadius: 9,
        border: '1px solid var(--fg-border)',
        background: 'var(--fg-bg-card)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-brand-primary)' }}>{code}</span>
      <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>{role}</span>
    </button>
  );
}

// 品牌区动态拓扑背景：红队 → 业务 → 网关 → 沙盒，监护旁路镜像。
function TopologyBackdrop() {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 600 600"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', inset: 0, opacity: 0.16, zIndex: 1 }}
      aria-hidden
    >
      <defs>
        <pattern id="fg-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#fff" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="600" height="600" fill="url(#fg-grid)" />
      <g stroke="#fff" strokeWidth="1.5" fill="none">
        <path d="M80 300 H220" strokeDasharray="6 6" className="fg-flow" />
        <path d="M300 300 H420" strokeDasharray="6 6" className="fg-flow" />
        <path d="M260 340 V440 H420" strokeDasharray="4 6" opacity="0.7" />
      </g>
      {[
        [80, 300],
        [260, 300],
        [460, 300],
        [460, 440],
        [260, 440],
      ].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="26" fill="rgba(255,255,255,0.1)" stroke="#fff" strokeWidth="1.5" />
          <circle cx={x} cy={y} r="6" fill="#fff" className="fg-breathe" />
        </g>
      ))}
    </svg>
  );
}