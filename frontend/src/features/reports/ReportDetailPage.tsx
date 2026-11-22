import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Empty, Input, Modal, Spin, Tag } from 'antd';
import {
  ArrowLeft,
  FileBarChart,
  Share2,
  Download,
  Copy,
  Check,
  ScrollText,
  Wrench,
  AlertTriangle,
  Info,
  FlaskConical,
  ChevronDown,
  ChevronRight,
  Bot,
  User,
} from 'lucide-react';
import { AttackIcon, GuardIcon } from '@/components/icons/SecurityIcons';
import { reportApi } from '@/services/api/resources';
import { rawClient, ApiClientError } from '@/services/api/client';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ModeBadge } from '@/components/common/ModeBadge';
import { SimBadge } from '@/components/common/SimBadge';
import { RiskRing } from '@/components/common/RiskRing';
import { PresetTag } from '@/components/common/PresetTag';
import { DossierSpine } from '@/components/common/DossierSpine';
import { DossierNo } from '@/components/common/DossierNo';
import { StampBadge } from '@/components/common/StampBadge';
import { RISK_META, BOUNDARY_META, CATEGORY_NAMES, TOOL_META } from '@/utils/constants';
import { formatTime, formatDuration, truncate } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import type { HardeningSuggestion, Policy, ReportContent } from '@/types/api';

// 处置动作 → 判定章。
const ACTION_STAMP: Record<'allow' | 'block' | 'challenge' | 'degrade', 'allow' | 'block' | 'challenge' | 'degrade'> = {
  allow: 'allow',
  block: 'block',
  challenge: 'challenge',
  degrade: 'degrade',
};

const SECTIONS = [
  { id: 'part1', label: '测评概要', icon: FileBarChart },
  { id: 'part2', label: '靶标基线快照', icon: ScrollText },
  { id: 'part3', label: '攻击序列', icon: AttackIcon },
  { id: 'part4', label: '风险分析', icon: AlertTriangle },
  { id: 'part5', label: '加固建议', icon: Wrench },
  { id: 'part6', label: '局限性说明', icon: Info },
];

const KIND_META: Record<string, { label: string; desc: string; hue: string }> = {
  immediate: { label: '立即可改', desc: '配置项可直接修订', hue: 'var(--fg-allow)' },
  tooling: { label: '工具改造', desc: '需修改工具入参校验', hue: 'var(--fg-info)' },
  tradeoff: { label: '业务取舍', desc: '需权衡代价', hue: 'var(--fg-observe)' },
};

export default function ReportDetailPage() {
  const { reportId = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [active, setActive] = useState('part1');
  const [shareOpen, setShareOpen] = useState(false);

  const reportQuery = useQuery({ queryKey: ['report', reportId], queryFn: () => reportApi.get(reportId), enabled: !!reportId });
  const report = reportQuery.data;
  const content = report?.content;

  const shareMutation = useMutation({
    mutationFn: () => reportApi.shareLink(reportId, 72),
    onSuccess: () => setShareOpen(true),
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '生成分享链接失败'),
  });

  const pdfMutation = useMutation({
    mutationFn: async () => {
      const res = await rawClient().get(reportApi.pdfUrl(reportId), { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      const instName = (content?.part1_overview?.instance_name || '靶标Agent').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
      const date = (report?.created_at || '').slice(0, 10).replace(/-/g, '');
      a.download = `越界之前_测评报告_${instName}_${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    onSuccess: () => message.success('PDF 已开始下载'),
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : 'PDF 导出失败'),
  });

  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (reportQuery.isLoading) {
    return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  }
  if (!report || !content) {
    return (
      <div style={{ padding: 60 }}>
        <Empty description="报告不存在或已被清理">
          <Button type="primary" onClick={() => navigate('/reports')}>返回报告中心</Button>
        </Empty>
      </div>
    );
  }

  const ov = content.part1_overview;
  const dossierNo = dossierFromId(report.report_id);

  return (
    <div>
      <PageHeader
        icon={<FileBarChart size={20} strokeWidth={1.5} />}
        title={`测评报告 · ${ov.instance_name}`}
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <DossierNo no={dossierNo} label="报告档号" />
            <span>·</span>
            <span className="mono">{report.report_id}</span>
            <span>·</span>
            <span>{formatTime(report.created_at)}</span>
            <ModeBadge mode={ov.mode} size="sm" />
            <SimBadge compact />
            <span style={{ fontSize: 12, padding: '0 7px', borderRadius: 4, border: '1px solid var(--fg-border)', color: 'var(--fg-text-2)' }}>只读快照</span>
          </span>
        }
        extra={
          <div data-tour="report-export" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button icon={<ArrowLeft size={15} />} onClick={() => navigate('/reports')}>报告中心</Button>
            <Button icon={<Share2 size={15} />} loading={shareMutation.isPending} onClick={() => shareMutation.mutate()}>分享</Button>
            <Button type="primary" icon={<Download size={15} />} loading={pdfMutation.isPending} onClick={() => pdfMutation.mutate()}>导出 PDF</Button>
          </div>
        }
      />

      <div className="fg-report-grid" style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* 章节导航 */}
        <nav className="fg-report-nav" style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {SECTIONS.map((s, i) => (
            <button key={s.id} onClick={() => scrollTo(s.id)} style={{ ...navBtnStyle, color: active === s.id ? 'var(--fg-brand-primary)' : 'var(--fg-text-2)', background: active === s.id ? 'var(--fg-bg-subtle)' : 'transparent', fontWeight: active === s.id ? 600 : 500 }}>
              <span className="mono" style={{ fontSize: 11, color: active === s.id ? 'var(--fg-brand-primary)' : 'var(--fg-text-3)', width: 16 }}>{i + 1}</span>
              <s.icon size={14} strokeWidth={1.5} />
              {s.label}
            </button>
          ))}
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 10, fontSize: 11.5, color: 'var(--fg-text-3)', lineHeight: 1.6 }}>
            <FlaskConical size={13} style={{ marginBottom: 4 }} />
            <div>报告生成后不再随实例变化而改变，重新生成将产生新报告。</div>
          </div>
        </nav>

        {/* 报告正文 */}
        <div data-tour="report-body" style={{ display: 'flex', alignItems: 'flex-start' }}>
          <DossierSpine no={dossierNo} style={{ alignSelf: 'stretch', position: 'sticky', top: 16 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Part1 content={content} />
            <Part2 content={content} />
            <Part3 content={content} />
            <Part4 content={content} />
            <Part5 content={content} />
            <Part6 content={content} />
          </div>
        </div>
      </div>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} url={shareMutation.data ? `${window.location.origin}${shareMutation.data.share_url}` : ''} expiresAt={shareMutation.data?.expires_at} />
    </div>
  );
}

function PartAnchor({ id, index, title, icon, extra, children }: { id: string; index: number; title: string; icon: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <SectionCard
      style={{ scrollMarginTop: 16 }}
      title={
        <span id={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <span className="mono" style={{ width: 22, height: 22, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--fg-text-2)', background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)' }}>{index}</span>
          {icon}
          {title}
        </span>
      }
      extra={extra}
    >
      {children}
    </SectionCard>
  );
}

function Part1({ content }: { content: ReportContent }) {
  const ov = content.part1_overview;
  const rc = content.rootcause_summary;
  return (
    <PartAnchor id="part1" index={1} title="测评概要" icon={<FileBarChart size={15} />}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <RiskRing score={ov.risk_score} maxRisk={ov.max_risk} size={72} stroke={7} label="累计风险" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, color: 'var(--fg-text-3)', marginBottom: 4 }}>声明用途</div>
          <div style={{ fontSize: 14.5, color: 'var(--fg-text-1)', lineHeight: 1.6 }}>{ov.purpose || '未标注用途的自定义 Agent'}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Tag style={{ margin: 0 }}>{ov.guard_enabled ? '防护开启' : '防护关闭（对照）'}</Tag>
            <Tag style={{ margin: 0 }} className="mono">{ov.session_id}</Tag>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Metric label="回合" value={ov.turns} />
        <Metric label="工具调用" value={ov.call_count} />
        <Metric label="拦截" value={ov.block_count} color="var(--fg-allow-text)" />
        <Metric label="质询" value={ov.challenge_count} color="var(--fg-observe-text)" />
        <Metric label="限额拦截" value={ov.limit_block_count} color="var(--fg-block-text)" />
        <Metric label="最高风险" value={RISK_META[ov.max_risk]?.label ?? ov.max_risk} small />
      </div>
      <div style={{ display: 'flex', gap: 10, padding: 14, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 10, marginBottom: rc.dominant ? 16 : 0 }}>
        <GuardIcon size={18} style={{ color: 'var(--fg-brand-primary)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 14, color: 'var(--fg-text-1)', lineHeight: 1.7 }}>{ov.conclusion}</div>
      </div>
      {rc.dominant && (
        <div>
          <div style={microLabelStyle}>根因分布 · 主导：{rc.dominant}</div>
          <CategoryBars counts={rc.category_counts} />
        </div>
      )}
    </PartAnchor>
  );
}

function Part2({ content }: { content: ReportContent }) {
  const b = content.part2_baseline;
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => {
    const g: Record<string, Policy[]> = { L1: [], L2: [], L3: [] };
    for (const p of b.policies) (g[p.level] ||= []).push(p);
    return g;
  }, [b.policies]);
  return (
    <PartAnchor
      id="part2"
      index={2}
      title="靶标基线快照"
      icon={<ScrollText size={15} />}
      extra={<Tag style={{ margin: 0 }} className="mono">快照 v{b.policy_snapshot_version ?? '—'} · {b.policies.length} 条策略</Tag>}
    >
      <pre className="mono" style={baselinePreStyle}>{b.baseline_summary}</pre>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>防护档位 <PresetTag preset={b.config.guard.preset} /></span>
        <Tag style={{ margin: 0 }} className="mono">单轮 ≤ {b.config.limits.max_calls_per_turn}</Tag>
        <Tag style={{ margin: 0 }} className="mono">会话 ≤ {b.config.limits.max_calls_per_session}</Tag>
        <Tag style={{ margin: 0 }} className="mono">超时 {b.config.limits.timeout_ms}ms</Tag>
      </div>
      <button onClick={() => setOpen((o) => !o)} style={collapseBtnStyle}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} 策略清单（{b.policies.length}）
      </button>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(['L1', 'L2', 'L3'] as const).map((lv) =>
            grouped[lv]?.length ? (
              <div key={lv}>
                <div style={{ ...microLabelStyle, marginBottom: 6 }}>{lv} · {grouped[lv].length} 条</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {grouped[lv].map((p) => (
                    <div key={p.policy_id} style={policyRowStyle}>
                      <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-text-1)', width: 64, flexShrink: 0 }}>{p.policy_id}</span>
                      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg-text-2)', minWidth: 0 }}>{p.condition}</span>
                      <StatusBadge action={p.action} size="sm" showText={false} />
                      {!p.enabled && <Tag style={{ margin: 0, fontSize: 10 }}>停用</Tag>}
                      {p.origin === 'manual' && <Tag color="warning" style={{ margin: 0, fontSize: 10 }}>人工</Tag>}
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </PartAnchor>
  );
}

function Part3({ content }: { content: ReportContent }) {
  const seq = content.part3_attack_sequence;
  return (
    <PartAnchor id="part3" index={3} title="攻击序列" icon={<AttackIcon size={15} />} extra={<Tag style={{ margin: 0 }}>{seq.length} 回合</Tag>}>
      {seq.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次会话无对话回合" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {seq.map((t) => (
            <div key={t.turn} style={turnCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="mono" style={turnBadgeStyle}>T{t.turn}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--fg-text-2)' }}>
                  {t.actor === 'redteam' ? <AttackIcon size={12} style={{ color: 'var(--fg-observe)' }} /> : <User size={12} />}
                  {t.actor === 'redteam' ? '红队' : '业务用户'}
                </span>
                {t.source_sample_id && <Tag color="warning" style={{ margin: 0, fontSize: 10.5 }}>样本 {t.source_sample_id}</Tag>}
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--fg-text-3)' }}>{t.calls.length} 次调用</span>
              </div>
              <div style={bubbleStyle}><span style={{ color: 'var(--fg-text-3)', fontSize: 11.5 }}>输入</span><div style={{ marginTop: 3 }}>{t.input}</div></div>
              <div style={{ ...bubbleStyle, background: 'var(--fg-bg-card)', marginTop: 6 }}>
                <span style={{ color: 'var(--fg-text-3)', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Bot size={11} /> Agent 回复</span>
                <div style={{ marginTop: 3 }}>{t.agent_reply || '（无文本回复）'}</div>
              </div>
              {t.calls.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {t.calls.map((c) => (
                    <div key={c.call_id} style={callMiniStyle}>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-text-1)' }}>{c.tool}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>{TOOL_META[c.tool]?.label}</span>
                      <span style={{ flex: 1, fontSize: 11.5, color: 'var(--fg-text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{truncate(c.reason, 60)}</span>
                      {c.action === 'block' ? <StampBadge kind="block" size="sm" /> : <StatusBadge action={c.action} size="sm" showText={false} />}
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-text-3)' }}>{formatDuration(c.duration_ms)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PartAnchor>
  );
}

function Part4({ content }: { content: ReportContent }) {
  const items = content.part4_risk_analysis;
  return (
    <PartAnchor id="part4" index={4} title="风险分析" icon={<AlertTriangle size={15} />} extra={<Tag style={{ margin: 0 }}>{items.length} 条告警</Tag>}>
      {items.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 16, background: 'var(--fg-allow-bg)', borderRadius: 10, color: 'var(--fg-allow-text)', fontSize: 14 }}>
          <GuardIcon size={18} /> 本次测评未触发风险告警，链路全绿。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((a) => (
            <div key={a.alert_id} style={riskCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <AlertTriangle size={14} style={{ color: a.level === 'high' ? 'var(--fg-block)' : 'var(--fg-observe)' }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)' }}>{a.label}</span>
                <Tag color={a.level === 'high' ? 'error' : a.level === 'medium' ? 'warning' : 'default'} style={{ margin: 0 }}>{RISK_META[a.level]?.label ?? a.level}</Tag>
                {a.boundary && <Tag style={{ margin: 0 }}>{BOUNDARY_META[a.boundary]}</Tag>}
                <StampBadge kind={ACTION_STAMP[a.action]} size="sm" />
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-text-3)' }}>T{a.turn}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-text-2)', lineHeight: 1.65, marginBottom: 8 }}>{a.reason}</div>
              {a.evidence_insufficient ? (
                <div style={{ fontSize: 12.5, color: 'var(--fg-observe-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Info size={12} /> 证据不足，建议人工复核后再归类
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>根因：</span>
                  {a.root_causes.map((c, i) => (
                    <span key={i} style={miniTagStyle}>{c.name ?? CATEGORY_NAMES[c.category] ?? c.category}</span>
                  ))}
                  {a.root_cause && a.root_causes.length === 0 && <span style={miniTagStyle}>{a.root_cause}</span>}
                </div>
              )}
              {(a.false_positive || a.false_negative) && (
                <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                  {a.false_positive && <Tag color="error" style={{ margin: 0, fontSize: 11 }}>已标误报</Tag>}
                  {a.false_negative && <Tag color="warning" style={{ margin: 0, fontSize: 11 }}>已标漏报</Tag>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PartAnchor>
  );
}

function Part5({ content }: { content: ReportContent }) {
  const suggestions = content.part5_hardening;
  const grouped = useMemo(() => {
    const g: Record<string, HardeningSuggestion[]> = { immediate: [], tooling: [], tradeoff: [] };
    for (const s of suggestions) (g[s.kind] ||= []).push(s);
    return g;
  }, [suggestions]);
  return (
    <PartAnchor id="part5" index={5} title="加固建议" icon={<Wrench size={15} />} extra={<Tag style={{ margin: 0 }}>{suggestions.length} 项</Tag>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(['immediate', 'tooling', 'tradeoff'] as const).map((kind) =>
          grouped[kind]?.length ? (
            <div key={kind}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: KIND_META[kind].hue }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)' }}>{KIND_META[kind].label}</span>
                <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>{KIND_META[kind].desc} · {grouped[kind].length} 项</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {grouped[kind].map((s, i) => (
                  <div key={i} style={{ ...suggestionCardStyle, borderLeft: `3px solid ${KIND_META[kind].hue}` }}>
                    <div style={{ fontSize: 13.5, color: 'var(--fg-text-1)', lineHeight: 1.65, fontWeight: 600 }}>{s.action}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--fg-allow-text)', lineHeight: 1.6, marginTop: 5, display: 'flex', gap: 6 }}>
                      <Check size={13} style={{ flexShrink: 0, marginTop: 2 }} /> 预期：{s.expected_effect}
                    </div>
                    {s.cost && (
                      <div style={{ fontSize: 12, color: 'var(--fg-observe-text)', lineHeight: 1.6, marginTop: 4, display: 'flex', gap: 6 }}>
                        <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> 代价：{s.cost}
                      </div>
                    )}
                    {s.category_name && <Tag style={{ margin: '6px 0 0', fontSize: 11 }}>{s.category_name}</Tag>}
                  </div>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </div>
    </PartAnchor>
  );
}

function Part6({ content }: { content: ReportContent }) {
  return (
    <PartAnchor id="part6" index={6} title="局限性说明" icon={<Info size={15} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {content.part6_limitations.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: 'var(--fg-text-2)', lineHeight: 1.7 }}>
            <span className="mono" style={{ color: 'var(--fg-text-3)', flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: 12, background: 'var(--fg-info-bg)', border: '1px solid var(--fg-border)', borderRadius: 10, fontSize: 12.5, color: 'var(--fg-info-text)', lineHeight: 1.7, display: 'flex', gap: 8 }}>
        <FlaskConical size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        {content.simulation_note}
      </div>
    </PartAnchor>
  );
}

function CategoryBars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  if (entries.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      {entries.map(([cat, n]) => (
        <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 88, fontSize: 12.5, color: 'var(--fg-text-2)', flexShrink: 0 }}>{CATEGORY_NAMES[cat] ?? cat}</span>
          <div style={{ flex: 1, height: 8, borderRadius: 5, background: 'var(--fg-bg-subtle)', overflow: 'hidden' }}>
            <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: 'var(--fg-brand-primary)', borderRadius: 5 }} />
          </div>
          <span className="mono" style={{ width: 24, textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{n}</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, color, small }: { label: string; value: number | string; color?: string; small?: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '10px 6px', background: 'var(--fg-bg-subtle)', borderRadius: 9, border: '1px solid var(--fg-border)' }}>
      <div className="mono" style={{ fontSize: small ? 14 : 20, fontWeight: 600, color: color ?? 'var(--fg-text-1)' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-text-3)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function ShareModal({ open, onClose, url, expiresAt }: { open: boolean; onClose: () => void; url: string; expiresAt?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <Modal open={open} title="只读分享链接" onCancel={onClose} footer={<Button type="primary" onClick={onClose}>完成</Button>} width={520} centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
        <div style={{ fontSize: 13.5, color: 'var(--fg-text-2)', lineHeight: 1.7 }}>
          任何持有此链接的人无需登录即可查看报告（只读）。链接到期后自动失效。
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={url} readOnly />
          <Button icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy}>{copied ? '已复制' : '复制'}</Button>
        </div>
        {expiresAt && <div style={{ fontSize: 12.5, color: 'var(--fg-text-3)' }}>有效期至 {formatTime(expiresAt)}</div>}
      </div>
    </Modal>
  );
}

const navBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13.5, textAlign: 'left', transition: 'color 140ms ease, background-color 140ms ease', width: '100%' };
const microLabelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 500, color: 'var(--fg-text-3)', marginBottom: 4 };
const baselinePreStyle: React.CSSProperties = { margin: 0, padding: 14, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 10, fontSize: 12.5, lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--fg-text-2)', maxHeight: 320, overflowY: 'auto' };
const collapseBtnStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--fg-brand-primary)', padding: 0 };
const policyRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px', background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 8 };
const turnCardStyle: React.CSSProperties = { padding: 14, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 11 };
const turnBadgeStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--fg-text-2)', background: 'var(--fg-bg-card)', border: '1px solid var(--fg-border)', borderRadius: 4, padding: '1px 8px' };
const bubbleStyle: React.CSSProperties = { padding: '9px 12px', background: 'var(--fg-bg-page)', border: '1px solid var(--fg-border)', borderRadius: 9, fontSize: 13.5, color: 'var(--fg-text-1)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const callMiniStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--fg-bg-card)', border: '1px solid var(--fg-border)', borderRadius: 8 };
const riskCardStyle: React.CSSProperties = { padding: 14, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 11 };
const suggestionCardStyle: React.CSSProperties = { padding: '12px 14px', background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 10 };
const miniTagStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 500, color: 'var(--fg-text-2)', border: '1px solid var(--fg-border)', borderRadius: 4, padding: '0 6px', lineHeight: '17px', background: 'var(--fg-bg-card)', whiteSpace: 'nowrap' };