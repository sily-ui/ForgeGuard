import { useNavigate } from 'react-router-dom';
import { App, Button, Descriptions, Typography, theme } from 'antd';
import { ArrowRight, Gauge, UserRound, Boxes } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { AttackIcon, GuardIcon, ForensicsIcon } from '@/components/icons/SecurityIcons';
import { useAuthStore } from '@/stores/authStore';
import { SimBadge } from '@/components/common/SimBadge';
import { DossierNo } from '@/components/common/DossierNo';
import { dossierNo, getWorkspaceId, workspaceShort } from '@/utils/workspace';

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
  const { message } = App.useApp();
  const enter = useAuthStore((s) => s.enter);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const wsId = getWorkspaceId();
  const dossier = dossierNo(wsId);

  const submit = async () => {
    const ok = await enter();
    if (ok) navigate('/workspace', { replace: true });
    else message.error(`暂时无法进入：${useAuthStore.getState().error ?? '游客准入失败'}`);
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
          gap: 32,
          padding: 32,
          backgroundColor: 'var(--bb-bg-card)',
          borderRight: '1px solid var(--bb-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
            <div style={{ fontSize: 12.5, color: 'var(--bb-text-3)', marginTop: 8 }}>Agent 安全实验室</div>
            <DossierNo no={dossier} label="本工作区案卷档号" style={{ marginTop: 8 }} />
          </div>
        </div>

        <div className="bb-portal-intro" style={{ maxWidth: 540 }}>
          <div className="bb-portal-filelabel">CASE FILE / AGENT SECURITY</div>
          <h1
            style={{
              // 字号交给 nudge.css 的 .bb-portal-hero h1，便于站点字号变量生效。
              lineHeight: 1.28,
              fontWeight: 700,
              margin: '0 0 16px',
              color: 'var(--bb-text-1)',
              fontFamily: 'var(--bb-font-display)',
              letterSpacing: 0.3,
            }}
          >
            为可编排 Agent 构建
            <br />
            自适应红队与旁路监护
          </h1>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 28, maxWidth: 490, fontSize: 14.5 }}>
            在内存仿真沙盒中编排靶标 Agent，载入真实攻击样本，观测三级判定网关如何实时拦截越界调用，并生成可追溯的根因加固报告。
          </Typography.Text>

          <div className="bb-feature-index" style={{ display: 'flex', flexDirection: 'column' }}>
            {FEATURES.map((f, index) => (
              <div key={f.title} className="bb-feature-row">
                <span className="bb-feature-no">{String(index + 1).padStart(2, '0')}</span>
                <span style={{ display: 'inline-flex', color: 'var(--bb-brand-primary)', marginTop: 1, flexShrink: 0 }}>
                  <f.icon size={17} strokeWidth={1.5} />
                </span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--bb-text-1)' }}>{f.title}</div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 13.5 }}>{f.desc}</Typography.Text>
                </div>
              </div>
            ))}
          </div>
        </div>

        <LabDiagram />
      </div>

      {/* 右侧门户区：单一进入动作 */}
      <div className="bb-portal-panel" style={{ flex: '0 0 45%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div className="bb-portal-filelabel">ACCESS / 访客准入</div>
          <div className="bb-simulation-stamp" aria-label="仅用于内存仿真">
            SIMULATION ONLY
            <small>内存仿真 · 无真实执行</small>
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 600, margin: '28px 0 10px', color: 'var(--bb-text-1)', letterSpacing: 0.2 }}>进入实验室</h2>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
            无需注册，即刻建立独立案卷。
          </Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24, fontSize: 13.5, lineHeight: 1.8 }}>
            平台为每个浏览器分配独立工作区，并对模型调用按日限量。所有工具执行均在仿真沙盒内完成。
          </Typography.Text>

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

          <div className="bb-entry-notes" style={{ marginTop: 32, display: 'flex', flexDirection: 'column' }}>
            {ENTRY_NOTES.map((n, index) => (
              <div key={n.title} className="bb-entry-row">
                <span className="bb-entry-no">{String(index + 1).padStart(2, '0')}</span>
                <span style={{ display: 'inline-flex', color: 'var(--bb-text-2)', marginTop: 1, flexShrink: 0 }}>
                  <n.icon size={16} strokeWidth={1.5} />
                </span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--bb-text-1)' }}>{n.title}</div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 12.5 }}>{n.desc}</Typography.Text>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--bb-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <SimBadge />
            <Descriptions bordered={false} column={1} size="small" items={[
              { key: 'workspace', label: '工作区', children: <span className="mono" title={`当前工作区 ${wsId}`}>{workspaceShort(wsId)}</span> },
              { key: 'dossier', label: '案卷', children: dossier },
            ]} />
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
  const { token } = theme.useToken();
  return (
    <figure className="bb-diagram" style={{ margin: 0, maxWidth: 520 }}>
      <svg viewBox="0 0 520 264" width="100%" role="img" aria-label="实验链路：红队攻击源注入靶标 Agent，工具调用被旁路监护网关三级判定并实时阻断，镜像流量持续观测仿真沙盒">
        <defs>
          <pattern id="bb-portal-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="var(--bb-border)" strokeWidth="0.5" />
          </pattern>
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
          <text x="350" y="54" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={token.colorTextLightSolid}>已拦截</text>
        </g>

        {/* 流动数据包 */}
        <circle className="bb-pk bb-pk-attack" r="4" fill="var(--bb-block)" />
        <circle className="bb-pk bb-pk-tool" r="4" fill="var(--bb-text-2)" />
        <circle className="bb-pk bb-pk-mirror" r="3" fill="var(--bb-info)" />
        <circle className="bb-pk bb-pk-verdict" r="3" fill="var(--bb-info)" />

        {/* 红队攻击源 */}
        <g className="bb-node" style={{ animationDelay: '0ms' }}>
          <rect x="54" y="58" width="52" height="52" rx="8" fill="var(--bb-bg-card)" stroke="var(--bb-border)" strokeWidth="1.5" />
          <g stroke="var(--bb-block)" strokeWidth="1.6" fill="none" strokeLinecap="round">
            <circle cx="80" cy="84" r="7.5" />
            <path d="M80 72v5M80 91v5M68 84h5M87 84h5" />
            <circle cx="80" cy="84" r="1.6" fill="var(--bb-block)" stroke="none" />
          </g>
          <text x="80" y="128" textAnchor="middle" fontSize="11" fill="var(--bb-text-2)">红队攻击源</text>
        </g>
        {/* 靶标 Agent */}
        <g className="bb-node" style={{ animationDelay: '70ms' }}>
          <rect x="234" y="58" width="52" height="52" rx="8" fill="var(--bb-bg-card)" stroke="var(--bb-border)" strokeWidth="1.5" />
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
          <rect x="414" y="58" width="52" height="52" rx="8" fill="var(--bb-bg-card)" stroke="var(--bb-border)" strokeWidth="1.5" />
          <g className="bb-sandbox-icon" stroke="var(--bb-brand-primary)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M440 74l10 5v10l-10 5-10-5V79z" />
            <path d="M430 79l10 5 10-5M440 84v10" />
          </g>
          <text x="440" y="128" textAnchor="middle" fontSize="11" fill="var(--bb-text-2)">仿真沙盒</text>
        </g>
        {/* 旁路监护网关 */}
        <g className="bb-node" style={{ animationDelay: '210ms' }}>
          <rect x="234" y="174" width="52" height="52" rx="8" fill="var(--bb-bg-card)" stroke="var(--bb-info)" strokeWidth="1.5" />
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 18, borderTop: '2px dashed var(--bb-block)' }} /> 攻击路径
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 18, borderTop: '2px dashed var(--bb-info)' }} /> 旁路镜像
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 3, height: 12, background: 'var(--bb-block)', borderRadius: 2 }} /> 实时阻断
        </span>
      </figcaption>
    </figure>
  );
}