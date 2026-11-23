import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Empty, Spin, Tag, Tooltip } from 'antd';
import {
  ArrowLeft,
  GitCompare,
  ExternalLink,
  ArrowRight,
  Equal,
  Diff,
} from 'lucide-react';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { experimentApi, sessionApi } from '@/services/api/resources';
import { StatusBadge } from '@/components/common/StatusBadge';
import { RiskRing } from '@/components/common/RiskRing';
import { Logo } from '@/components/common/Logo';
import { SimBadge } from '@/components/common/SimBadge';
import { DossierSpine } from '@/components/common/DossierSpine';
import { RISK_META, TOOL_META } from '@/utils/constants';
import { formatDuration, formatShort, paramsSummaryText, truncate } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import type { ExperimentCall, ExperimentRun, Session } from '@/types/api';

export default function ExperimentPage() {
  const { pairId = '' } = useParams();
  const navigate = useNavigate();

  const expQuery = useQuery({ queryKey: ['experiment', pairId], queryFn: () => experimentApi.get(pairId), enabled: !!pairId });
  const exp = expQuery.data;

  const sessionAQuery = useQuery({
    queryKey: ['session', exp?.run_a.session_id],
    queryFn: () => sessionApi.get(exp!.run_a.session_id),
    enabled: !!exp?.run_a.session_id,
  });
  const sessionBQuery = useQuery({
    queryKey: ['session', exp?.run_b.session_id],
    queryFn: () => sessionApi.get(exp!.run_b.session_id),
    enabled: !!exp?.run_b.session_id,
  });

  const diffSteps = useMemo(() => {
    if (!exp) return 0;
    return exp.rows.filter((r) => (r.run_a.action ?? null) !== (r.run_b.action ?? null)).length;
  }, [exp]);

  if (expQuery.isLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Logo size={48} />
        <Spin />
        <div style={{ color: 'var(--bb-text-3)', fontSize: 14 }}>正在加载对照实验…</div>
      </div>
    );
  }

  if (!exp) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="对照实验不存在或已被清理">
          <Button type="primary" onClick={() => navigate('/instances')}>返回实例管理</Button>
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="bb-lab-nav" style={labNavStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Button size="small" icon={<ArrowLeft size={14} />} onClick={() => navigate(`/console/${exp.source_session_id}`)}>
            返回控制台
          </Button>
          <Logo size={24} />
          <span style={{ fontSize: 13.5, color: 'var(--bb-text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            对照实验 <span style={{ color: 'var(--bb-text-3)' }}>/</span>{' '}
            <b className="mono" style={{ color: 'var(--bb-text-1)' }}>{exp.pair_id}</b>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 4, border: '1px solid var(--bb-border)', color: 'var(--bb-text-2)' }}>
            {exp.dimension === 'guard' ? '防护对照' : '实例对照'}
          </span>
          <SimBadge />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 实验概要 */}
          <div data-tour="exp-summary" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <GitCompare size={18} strokeWidth={1.5} style={{ color: 'var(--bb-text-3)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--bb-text-1)' }}>
                  {exp.dimension === 'guard' ? '同一靶标 · 防护开关对照' : '同一输入 · 不同靶标对照'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--bb-text-3)', marginTop: 2 }}>
                  创建于 {formatShort(exp.created_at)} · 共 {exp.rows.length} 步 · {diffSteps} 步判定差异
                </div>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <Tag color={diffSteps > 0 ? 'warning' : 'success'} style={{ margin: 0 }}>
                  {diffSteps > 0 ? `${diffSteps} 步差异` : '判定一致'}
                </Tag>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--bb-text-3)', marginBottom: 6 }}>对照输入</div>
            <div style={inputBoxStyle}>{exp.input || '（复用起点会话首轮输入）'}</div>
            {exp.diff_items.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--bb-text-3)', marginBottom: 6 }}>配置差异</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {exp.diff_items.map((d, i) => (
                    <span key={i} className="mono" style={diffChipStyle}>
                      <b style={{ color: 'var(--bb-brand-primary)' }}>{d.field}</b>
                      <span style={{ color: 'var(--bb-text-2)' }}>{d.change}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* A/B 概要 */}
          <div data-tour="exp-runs" className="bb-exp-runs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <RunSummary label="A 组 · 起点" run={exp.run_a} session={sessionAQuery.data} loading={sessionAQuery.isLoading} accent="#7aa3c8" onOpen={() => navigate(`/console/${exp.run_a.session_id}`)} />
            <RunSummary label="B 组 · 对照" run={exp.run_b} session={sessionBQuery.data} loading={sessionBQuery.isLoading} accent="#d9a441" onOpen={() => navigate(`/console/${exp.run_b.session_id}`)} />
          </div>

          {/* 逐步对比 */}
          <div data-tour="exp-rows" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Diff size={16} strokeWidth={1.5} style={{ color: 'var(--bb-text-3)' }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--bb-text-1)' }}>逐步判定对比</span>
              <span style={{ fontSize: 12, color: 'var(--bb-text-3)' }}>左 A 组 · 右 B 组，判定动作不一致的步骤高亮</span>
            </div>
            {exp.rows.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="两组均未发生工具调用" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={diffHeadStyle}>
                  <span style={{ width: 40 }}>步</span>
                  <span style={{ flex: 1 }}>A 组 · 起点</span>
                  <span style={{ width: 28 }} />
                  <span style={{ flex: 1 }}>B 组 · 对照</span>
                </div>
                {exp.rows.map((row) => {
                  const diff = (row.run_a.action ?? null) !== (row.run_b.action ?? null);
                  return (
                    <div key={row.step} style={{ ...diffRowStyle, borderColor: diff ? 'var(--bb-observe)' : 'var(--bb-border)', background: diff ? 'var(--bb-observe-bg)' : 'var(--bb-bg-subtle)' }}>
                      <span className="mono" style={{ width: 40, fontSize: 12, fontWeight: 600, color: diff ? 'var(--bb-observe-text)' : 'var(--bb-text-3)', flexShrink: 0 }}>
                        {String(row.step).padStart(2, '0')}
                      </span>
                      <CallCell call={row.run_a} />
                      <span style={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        {diff ? <ArrowRight size={14} style={{ color: 'var(--bb-observe)' }} /> : <Equal size={13} style={{ color: 'var(--bb-text-3)' }} />}
                      </span>
                      <CallCell call={row.run_b} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function RunSummary({ label, run, session, loading, accent, onOpen }: { label: string; run: ExperimentRun; session?: Session; loading: boolean; accent: string; onOpen: () => void }) {
  return (
    <div style={{ ...cardStyle, borderTop: `3px solid ${accent}`, display: 'flex', alignItems: 'stretch' }}>
      <DossierSpine no={dossierFromId(run.session_id)} style={{ alignSelf: 'stretch' }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: accent }}>{label}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--bb-text-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.session_id}</span>
          <Button size="small" type="text" icon={<ExternalLink size={13} />} onClick={onOpen} style={{ marginLeft: 'auto', color: accent }}>
            控制台
          </Button>
        </div>
        {loading || !session ? (
          <div style={{ padding: '16px 0', textAlign: 'center' }}><Spin size="small" /></div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <RiskRing score={session.risk_score} maxRisk={session.max_risk} size={48} stroke={5} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--bb-text-1)' }}>{session.instance_name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  {session.guard_enabled ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--bb-allow-text)' }}><GuardIcon size={12} /> 防护开启</span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--bb-block-text)' }}><GuardIcon size={12} /> 防护关闭</span>
                  )}
                </div>
              </div>
            </div>
            <div className="bb-stats-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <Metric label="调用" value={session.call_count} />
              <Metric label="拦截" value={session.block_count} color="var(--bb-block-text)" />
              <Metric label="质询" value={session.challenge_count} color="var(--bb-observe-text)" />
              <Metric label="最高风险" value={RISK_META[session.max_risk]?.label ?? session.max_risk} small />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CallCell({ call }: { call: ExperimentCall }) {
  if (call.note || !call.tool) {
    return (
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--bb-text-3)', display: 'flex', alignItems: 'center' }}>
        {call.note ?? '本次运行未发生该步'}
      </span>
    );
  }
  return (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--bb-text-1)' }}>{call.tool}</span>
        <span style={{ fontSize: 11, color: 'var(--bb-text-3)' }}>{TOOL_META[call.tool]?.label}</span>
        <span style={{ marginLeft: 'auto' }}><StatusBadge action={call.action ?? 'unknown'} size="sm" showText={false} /></span>
      </span>
      <Tooltip title={paramsSummaryText(call.params_summary ?? {})}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--bb-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {truncate(paramsSummaryText(call.params_summary ?? {}), 40)}
        </span>
      </Tooltip>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {call.risk && <Tag style={{ margin: 0, fontSize: 10, lineHeight: '14px', padding: '0 4px' }} color={call.risk === 'high' ? 'error' : call.risk === 'medium' ? 'warning' : 'default'}>{RISK_META[call.risk]?.label ?? call.risk}</Tag>}
        {call.duration_ms != null && <span className="mono" style={{ fontSize: 10, color: 'var(--bb-text-3)' }}>{formatDuration(call.duration_ms)}</span>}
      </span>
    </span>
  );
}

function Metric({ label, value, color, small }: { label: string; value: number | string; color?: string; small?: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bb-bg-subtle)', borderRadius: 8, border: '1px solid var(--bb-border)' }}>
      <div className="mono" style={{ fontSize: small ? 13 : 18, fontWeight: 600, color: color ?? 'var(--bb-text-1)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--bb-text-3)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

const labNavStyle: React.CSSProperties = { height: 46, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--bb-border)', background: 'var(--bb-bg-subtle)' };
const cardStyle: React.CSSProperties = { background: 'var(--bb-bg-card)', border: '1px solid var(--bb-border)', borderRadius: 14, padding: 18 };
const inputBoxStyle: React.CSSProperties = { fontSize: 13.5, color: 'var(--bb-text-1)', lineHeight: 1.65, background: 'var(--bb-bg-subtle)', border: '1px solid var(--bb-border)', borderRadius: 9, padding: '10px 13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const diffChipStyle: React.CSSProperties = { display: 'inline-flex', gap: 8, fontSize: 12, padding: '4px 10px', borderRadius: 7, background: 'var(--bb-bg-subtle)', border: '1px solid var(--bb-border)' };
const diffHeadStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 6px', fontSize: 11.5, fontWeight: 500, color: 'var(--bb-text-3)' };
const diffRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--bb-border)', borderRadius: 10, transition: 'background-color 160ms ease, border-color 160ms ease' };