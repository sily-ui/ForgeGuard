import { useNavigate } from 'react-router-dom';
import { Alert, Button } from 'antd';
import { ArrowRight, FlaskConical, Gauge, UserRound, Boxes } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { AttackIcon, GuardIcon, ForensicsIcon } from '@/components/icons/SecurityIcons';
import { useAuthStore } from '@/stores/authStore';
import { SimBadge } from '@/components/common/SimBadge';
import { DossierNo } from '@/components/common/DossierNo';
import { dossierNo, getWorkspaceId, workspaceShort } from '@/utils/workspace';

const FEATURES = [
  { no: '01', icon: AttackIcon, title: '自适应红队测评', desc: '提示注入 / 越狱 / 越权 / 链式攻击样本库，一键载入复现' },
  { no: '02', icon: GuardIcon, title: '动态旁路监护', desc: 'L1 规则 → L2 分类 → L3 语义三级判定，实时阻断越界调用' },
  { no: '03', icon: ForensicsIcon, title: '根因与加固报告', desc: '六部分取证报告，配置缺陷归因与可执行加固建议' },
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
  const dossier = dossierNo(wsId);

  const submit = async () => {
    const ok = await enter();
    if (ok) navigate('/workspace', { replace: true });
  };

  return (
    <div className="bb-portal" style={{ minHeight: '100vh', display: 'flex', background: 'var(--bb-bg-page)' }}>
      {/* 左侧品牌区：品牌抬头 → 主张与能力 → 实验链路图 */}
      <div
        className="bb-portal-hero"
        style={{
          flex: '0 0 55%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 40,
          padding: '48px 56px',
          background: 'var(--bb-bg-card)',
          borderRight: '1px solid var(--bb-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={34} />
          <div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--bb-text-1)',
                fontFamily: 'var(--bb-font-display)',
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
              }}
            >
              越界之前 BeforeBound
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--bb-text-3)', marginTop: 1 }}>Agent 安全实验室</div>
            <DossierNo no={dossier} label="本工作区案卷档号" style={{ marginTop: 3 }} />
          </div>
        </div>

        <div style={{ maxWidth: 520 }}>
          <h1
            style={{
              // 字号交给 nudge.css 的 .bb-portal-hero h1，便于站点字号变量生效。
              lineHeight: 1.28,
              fontWeight: 700,
              margin: '0 0 14px',
              color: 'var(--bb-text-1)',
              fontFamily: 'var(--bb-font-display)',
              letterSpacing: 0.3,
            }}
          >
            为可编排 Agent 构建
            <br />
            自适应红队与旁路监护
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--bb-text-2)', margin: '0 0 28px', maxWidth: 460 }}>
            在内存仿真沙盒中编排靶标 Agent，载入真实攻击样本，观测三级判定网关如何实时拦截越界调用，并生成可追溯的根因加固报告。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--bb-brand-primary)', fontWeight: 600, marginTop: 4, flexShrink: 0, width: 18, textAlign: 'right' }}
                >
                  {f.no}
                </span>
                <span style={{ display: 'inline-flex', color: 'var(--bb-text-3)', marginTop: 2, flexShrink: 0 }}>
                  <f.icon size={16} strokeWidth={1.5} />
                </span>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--bb-text-1)' }}>{f.title}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--bb-text-2)', lineHeight: 1.5, marginTop: 2 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <LabDiagram />
      </div>

      {/* 右侧门户区：单一进入动作 */}
      <div className="bb-portal-panel" style={{ flex: '0 0 45%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--bb-text-2)', fontSize: 13.5, marginBottom: 16 }}>
            <FlaskConical size={14} strokeWidth={1.5} style={{ color: 'var(--bb-info-text)' }} />
            全内存仿真 · 不触及真实系统
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 8px', color: 'var(--bb-text-1)' }}>进入实验室</h2>
          <p style={{ fontSize: 14, color: 'var(--bb-text-2)', margin: '0 0 24px', lineHeight: 1.6 }}>
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
                <span style={{ display: 'inline-flex', color: 'var(--bb-text-3)', marginTop: 2, flexShrink: 0 }}>
                  <n.icon size={16} strokeWidth={1.5} />
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--bb-text-1)' }}>{n.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--bb-text-2)', lineHeight: 1.5, marginTop: 2 }}>{n.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--bb-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <SimBadge />
            <span className="mono" style={{ fontSize: 12, color: 'var(--bb-text-3)' }} title={`当前工作区 ${wsId}`}>
              工作区 {workspaceShort(wsId)} · 案卷 {dossier}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// 实验链路图：红队 → 靶标 Agent → 仿真沙盒，旁路监护镜像与阻断点。
// 6s 剧情循环：攻击注入 → Agent 发起工具调用 → 网关三级判定 → 阻断落印；
// 镜像/判定数据包持续流动。动效仅用 transform/opacity，reduced-motion 下退化为静态拓扑。
function LabDiagram() {
  return (
    <figure className="bb-diagram" style={{ margin: 0, maxWidth: 520 }}>
      <svg viewBox="0 0 520 264" width="100%" role="img" aria-label="实验链路：红队攻击源注入靶标 Agent，工具调用被旁路监护网关三级判定并实时阻断，镜像流量持续观测仿真沙盒">
        <defs>
          <pattern id="bb-portal-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="var(--bb-border)" strokeWidth="0.5" />
          </pattern>
          <radialGradient id="bb-portal-glow" cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="var(--bb-brand-primary)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--bb-brand-primary)" stopOpacity="0" />
          </radialGradient>
          <marker id="bb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 8 4 0 8Z" fill="var(--bb-text-3)" />
          </marker>
          <marker id="bb-arrow-block" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 8 4 0 8Z" fill="var(--bb-block)" />
          </marker>
          <marker id="bb-arrow-info" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 8 4 0 8Z" fill="var(--bb-info)" />
          </marker>
        </defs>
        <rect width="520" height="264" fill="url(#bb-portal-grid)" opacity="0.6" />
        <rect width="520" height="264" fill="url(#bb-portal-glow)" />

        {/* 攻击路径 */}
        <path className="bb-dash-attack" d="M106 84H234" stroke="var(--bb-block)" strokeWidth="1.5" strokeDasharray="5 5" markerEnd="url(#bb-arrow-block)" />
        {/* 工具调用 */}
        <path d="M286 84H414" stroke="var(--bb-text-3)" strokeWidth="1.5" markerEnd="url(#bb-arrow)" />
        {/* 旁路镜像与判定回注 */}
        <path className="bb-dash-mirror" d="M260 110V174" stroke="var(--bb-info)" strokeWidth="1.5" strokeDasharray="3 5" />
        <path className="bb-dash-mirror" d="M286 200H440V110" stroke="var(--bb-info)" strokeWidth="1.5" strokeDasharray="3 5" fill="none" markerEnd="url(#bb-arrow-info)" />

        {/* 阻断点：屏障随拦截剧情闪烁 */}
        <g className="bb-barrier">
          <path d="M350 72v24" stroke="var(--bb-block)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M345 76l10 16M355 76l-10 16" stroke="var(--bb-block)" strokeWidth="1" opacity="0.55" />
        </g>
        {/* 拦截落印 */}
        <g className="bb-chip">
          <rect x="322" y="40" width="56" height="20" rx="5" fill="var(--bb-block)" />
          <text x="350" y="54" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff">已拦截</text>
        </g>

        {/* 节点呼吸环 */}
        <circle className="bb-ring bb-ring-red" cx="80" cy="84" r="30" fill="none" stroke="var(--bb-block)" strokeWidth="1" />
        <circle className="bb-ring bb-ring-agent" cx="260" cy="84" r="30" fill="none" stroke="var(--bb-brand-primary)" strokeWidth="1" />
        <circle className="bb-ring bb-ring-guard" cx="260" cy="200" r="32" fill="none" stroke="var(--bb-info)" strokeWidth="1" />

        {/* 流动数据包 */}
        <circle className="bb-pk bb-pk-attack" r="4" fill="var(--bb-block)" />
        <circle className="bb-pk bb-pk-tool" r="4" fill="var(--bb-text-2)" />
        <circle className="bb-pk bb-pk-mirror" r="3" fill="var(--bb-info)" />
        <circle className="bb-pk bb-pk-verdict" r="3" fill="var(--bb-info)" />

        {/* 红队攻击源 */}
        <g className="bb-node" style={{ animationDelay: '0ms' }}>
          <rect x="54" y="58" width="52" height="52" rx="12" fill="var(--bb-bg-card)" stroke="var(--bb-border)" strokeWidth="1.5" />
          <g stroke="var(--bb-block)" strokeWidth="1.6" fill="none" strokeLinecap="round">
            <circle cx="80" cy="84" r="7.5" />
            <path d="M80 72v5M80 91v5M68 84h5M87 84h5" />
            <circle cx="80" cy="84" r="1.6" fill="var(--bb-block)" stroke="none" />
          </g>
          <text x="80" y="128" textAnchor="middle" fontSize="11" fill="var(--bb-text-2)">红队攻击源</text>
        </g>
        {/* 靶标 Agent */}
        <g className="bb-node" style={{ animationDelay: '70ms' }}>
          <rect x="234" y="58" width="52" height="52" rx="12" fill="var(--bb-bg-card)" stroke="var(--bb-border)" strokeWidth="1.5" />
          <g stroke="var(--bb-brand-primary)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <rect x="251" y="78" width="18" height="13" rx="3" />
            <path d="M260 78v-4M256 95h8" />
            <circle cx="256" cy="84" r="1.4" fill="var(--bb-brand-primary)" stroke="none" />
            <circle cx="264" cy="84" r="1.4" fill="var(--bb-brand-primary)" stroke="none" />
          </g>
          <text x="260" y="128" textAnchor="middle" fontSize="11" fill="var(--bb-text-2)">靶标 Agent</text>
        </g>
        {/* 仿真沙盒 */}
        <g className="bb-node" style={{ animationDelay: '140ms' }}>
          <rect x="414" y="58" width="52" height="52" rx="12" fill="var(--bb-bg-card)" stroke="var(--bb-border)" strokeWidth="1.5" />
          <g className="bb-sandbox-icon" stroke="var(--bb-brand-primary)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M440 74l10 5v10l-10 5-10-5V79z" />
            <path d="M430 79l10 5 10-5M440 84v10" />
          </g>
          <text x="440" y="128" textAnchor="middle" fontSize="11" fill="var(--bb-text-2)">仿真沙盒</text>
        </g>
        {/* 旁路监护网关 */}
        <g className="bb-node" style={{ animationDelay: '210ms' }}>
          <rect x="234" y="174" width="52" height="52" rx="12" fill="var(--bb-bg-card)" stroke="var(--bb-info)" strokeWidth="1.5" />
          <path d="M260 182l10 4v7c0 7-10 12-10 12s-10-5-10-12v-7z" stroke="var(--bb-info)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
          <path d="M256 194l3 3 6-6" stroke="var(--bb-info)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {/* 三级判定指示灯：L1 → L2 → L3 依次点亮 */}
          <rect className="bb-dot bb-dot-1" x="248" y="212" width="5" height="3" rx="1" fill="var(--bb-info)" />
          <rect className="bb-dot bb-dot-2" x="257" y="212" width="5" height="3" rx="1" fill="var(--bb-info)" />
          <rect className="bb-dot bb-dot-3" x="266" y="212" width="5" height="3" rx="1" fill="var(--bb-info)" />
          <text x="260" y="244" textAnchor="middle" fontSize="11" fill="var(--bb-text-2)">旁路监护网关</text>
        </g>
      </svg>
      <figcaption className="mono" style={{ fontSize: 11.5, color: 'var(--bb-text-3)', marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, borderTop: '2px dashed var(--bb-block)' }} /> 攻击路径
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, borderTop: '2px dashed var(--bb-info)' }} /> 旁路镜像
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 3, height: 12, background: 'var(--bb-block)', borderRadius: 2 }} /> 实时阻断
        </span>
      </figcaption>
    </figure>
  );
}