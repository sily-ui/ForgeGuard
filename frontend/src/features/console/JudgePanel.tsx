import { useMemo, useState } from 'react';
import { Button, Input, Tag } from 'antd';
import {
  BellRing,
  HelpCircle,
  Check,
  X,
  Flag,
  Layers,
  Timer,
  Box,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { StatusBadge } from '@/components/common/StatusBadge';
import { JudgeBadge } from '@/components/common/JudgeBadge';
import { JsonViewer } from '@/components/common/JsonViewer';
import { StampBadge, StampInk, type StampKind } from '@/components/common/StampBadge';
import { DossierNo } from '@/components/common/DossierNo';
import { useSessionStore } from '@/stores/sessionStore';
import { BOUNDARY_META, RISK_META, TOOL_META } from '@/utils/constants';
import { formatDuration, formatShort } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import type { Alert, CallRecord, GuardJudgementEvent } from '@/types/api';

// 处置动作 → 判定章类别与墨色。
const ACTION_STAMP: Record<string, { kind: StampKind; color: string }> = {
  allow: { kind: 'allow', color: 'var(--fg-allow)' },
  block: { kind: 'block', color: 'var(--fg-block)' },
  challenge: { kind: 'challenge', color: 'var(--fg-observe)' },
  degrade: { kind: 'degrade', color: 'var(--fg-observe)' },
};

type Tab = 'judge' | 'alerts' | 'challenges';

interface Props {
  fullCalls: Record<string, CallRecord>;
  onResolveChallenge: (args: { callId: string; approved: boolean }) => void;
  onFeedback: (args: { alertId: string; payload: { false_positive?: boolean; false_negative?: boolean; note?: string } }) => void;
}

export function JudgePanel({ fullCalls, onResolveChallenge, onFeedback }: Props) {
  const selectedCallId = useSessionStore((s) => s.selectedCallId);
  const calls = useSessionStore((s) => s.calls);
  const alerts = useSessionStore((s) => s.alerts);
  const challenges = useSessionStore((s) => s.challenges);
  const [tab, setTab] = useState<Tab>('judge');

  const challengeList = useMemo(() => Object.values(challenges), [challenges]);
  const selectedLive = selectedCallId ? calls[selectedCallId] : null;
  const selectedFull = selectedCallId ? fullCalls[selectedCallId] : null;

  // 选中调用时自动切到取证页
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  if (selectedCallId && selectedCallId !== lastSelected) {
    setLastSelected(selectedCallId);
    if (tab !== 'judge') setTab('judge');
  }

  return (
    <div data-tour="judge-panel" style={colStyle}>
      <div style={tabStripStyle}>
        <TabBtn active={tab === 'judge'} onClick={() => setTab('judge')} icon={<GuardIcon size={14} />} label="判定取证" />
        <TabBtn active={tab === 'alerts'} onClick={() => setTab('alerts')} icon={<BellRing size={14} />} label="告警" count={alerts.length} />
        <TabBtn active={tab === 'challenges'} onClick={() => setTab('challenges')} icon={<HelpCircle size={14} />} label="质询" count={challengeList.length} highlight={challengeList.length > 0} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'judge' && <JudgeDetail live={selectedLive} full={selectedFull} />}
        {tab === 'alerts' && <AlertsList alerts={alerts} onFeedback={onFeedback} />}
        {tab === 'challenges' && <ChallengeList challenges={challengeList} onResolve={onResolveChallenge} />}
      </div>
    </div>
  );
}

function JudgeDetail({ live, full }: { live: ReturnType<typeof useSessionStore.getState>['calls'][string] | null; full: CallRecord | null }) {
  if (!live && !full) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-text-3)' }}>
        <GuardIcon size={28} strokeWidth={1.4} style={{ opacity: 0.5, marginBottom: 10 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-2)' }}>三级判定取证</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 6 }}>
          在中间「调用链」选择一次调用，
          <br />
          查看 L1 规则 / L2 注入分类 / L3 语义判定的完整证据。
        </div>
      </div>
    );
  }

  // SSE 实时判定优先于 REST 快照，避免慢响应把新判定覆盖回旧状态。
  const judgement = live?.judgement ?? full?.judgement;
  const tool = live?.tool ?? full?.tool ?? '';
  const action = judgement?.action ?? live?.action ?? 'unknown';
  const risk = judgement?.risk ?? live?.risk ?? 'none';
  const boundary = judgement?.boundary ?? null;
  const judgedBy = judgement?.judged_by ?? live?.judged_by;
  const layers = full?.layers;
  const timings = full?.layers?.timings;

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 结论：判定以盖章留证为核心呈现 */}
      <div style={verdictCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)' }}>{tool}</span>
          <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>{TOOL_META[tool]?.label}</span>
          <span style={{ marginLeft: 'auto' }}>
            <StatusBadge action={action} size="sm" />
          </span>
        </div>
        {ACTION_STAMP[action] && (
          <div
            key={`${live?.call_id ?? ''}-${action}`}
            style={{ position: 'relative', display: 'inline-flex', marginBottom: 10 }}
          >
            <StampInk color={ACTION_STAMP[action].color} />
            <StampBadge kind={ACTION_STAMP[action].kind} size="lg" animate />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <Tag color={risk === 'high' ? 'error' : risk === 'medium' ? 'warning' : 'success'} style={{ margin: 0 }}>
            风险 {RISK_META[risk]?.label ?? risk}
          </Tag>
          {boundary && <span style={miniTagStyle}>{BOUNDARY_META[boundary] ?? boundary}</span>}
          {judgedBy && <JudgeBadge judgedBy={judgedBy} size="sm" />}
          {judgement?.is_violation && <Tag color="error" style={{ margin: 0 }}>越权</Tag>}
          {judgement?.guard_unavailable && <Tag color="warning" style={{ margin: 0 }}>监护降级</Tag>}
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-text-2)', lineHeight: 1.65 }}>
          {judgement?.reason || live?.challenge_pending ? judgement?.reason || '等待人工裁决…' : '暂无判定理由'}
        </div>
        {judgement?.hit_policies && judgement.hit_policies.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={microLabelStyle}>命中策略</div>
            {judgement.hit_policies.map((h) => (
              <div key={h.policy_id} className="mono" style={{ fontSize: 11.5, color: 'var(--fg-text-2)', display: 'flex', gap: 6 }}>
                <span style={{ color: 'var(--fg-brand-primary)' }}>{h.policy_id}</span>
                <span style={{ color: 'var(--fg-text-3)' }}>{h.source}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 三级分层 */}
      <div>
        <div style={{ ...microLabelStyle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Layers size={12} /> 三级判定链路
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <LayerCard
            tag="A"
            name="L1 · 确定性规则"
            skipped={layers?.layers.l1?.skipped}
            available={!layers?.layers.l1?.skipped}
            timing={timings?.l1}
          >
            {layers?.layers.l1 ? (
              layers.layers.l1.skipped ? (
                <Muted>本轮跳过 L1（防护关闭或对照轮次）</Muted>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Row k="命中" v={layers.layers.l1.hit ? '是 · 短路判定' : '否 · 放行至下层'} highlight={layers.layers.l1.hit} />
                  {layers.layers.l1.rules && layers.layers.l1.rules.length > 0 && (
                    <JsonViewer data={layers.layers.l1.rules} maxHeight={140} collapsed />
                  )}
                </div>
              )
            ) : (
              <Muted>完整分层取证将在调用落库后显示</Muted>
            )}
          </LayerCard>

          <LayerCard
            tag="B"
            name="L2 · 注入分类"
            skipped={layers?.layers.l2?.skipped}
            available={layers?.layers.l2?.available}
            timing={timings?.l2}
          >
            {layers?.layers.l2 ? (
              layers.layers.l2.skipped ? (
                <Muted>本轮跳过 L2</Muted>
              ) : layers.layers.l2.available === false ? (
                <Muted>注入分类器不可用，已降级保守处理</Muted>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Row k="注入概率" v={layers.layers.l2.injection_prob != null ? layers.layers.l2.injection_prob.toFixed(3) : '—'} />
                  <ProbBar value={layers.layers.l2.injection_prob ?? 0} />
                  {layers.layers.l2.short_circuit && <Row k="短路" v="高危直接阻断" highlight />}
                  {layers.layers.l2.highlight && layers.layers.l2.highlight.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {layers.layers.l2.highlight.map((h, i) => (
                        <Tag key={i} color="warning" style={{ margin: 0, fontSize: 11 }}>{h}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              )
            ) : (
              <Muted>完整分层取证将在调用落库后显示</Muted>
            )}
          </LayerCard>

          <LayerCard
            tag="C"
            name="L3 · 语义判定"
            skipped={layers?.layers.l3?.skipped}
            available={layers?.layers.l3?.available}
            timing={timings?.l3}
          >
            {layers?.layers.l3 ? (
              layers.layers.l3.skipped ? (
                <Muted>本轮跳过 L3（未触发语义判定）</Muted>
              ) : layers.layers.l3.available === false ? (
                <Muted>语义模型不可用，已降级保守处理</Muted>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Row k="JSON 有效" v={layers.layers.l3.valid ? '是' : '否 · 保守兜底'} highlight={!layers.layers.l3.valid} />
                  {layers.layers.l3.raw_json && <JsonViewer data={layers.layers.l3.raw_json} maxHeight={160} collapsed />}
                </div>
              )
            ) : (
              <Muted>完整分层取证将在调用落库后显示</Muted>
            )}
          </LayerCard>
        </div>
      </div>

      {/* 沙盒结果 + 原始参数 */}
      {full?.sandbox_result && (
        <div>
          <div style={{ ...microLabelStyle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Box size={12} /> 仿真沙盒结果
            <span className="mono" style={miniTagStyle}>SIM</span>
          </div>
          <JsonViewer data={full.sandbox_result} maxHeight={180} collapsed />
        </div>
      )}
      {full?.params_raw && (
        <div>
          <div style={{ ...microLabelStyle, marginBottom: 8 }}>原始入参</div>
          <JsonViewer data={full.params_raw} maxHeight={160} collapsed />
        </div>
      )}
      {timings && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-text-3)' }}>
          <Timer size={12} />
          总耗时 <span className="mono" style={{ color: 'var(--fg-text-2)' }}>{formatDuration(full?.duration_ms)}</span>
        </div>
      )}
    </div>
  );
}

function AlertsList({ alerts, onFeedback }: { alerts: Alert[]; onFeedback: Props['onFeedback'] }) {
  if (alerts.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-text-3)' }}>
        <BellRing size={26} strokeWidth={1.4} style={{ opacity: 0.5, marginBottom: 10 }} />
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-text-2)' }}>暂无风险告警</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 6 }}>越权与可疑调用将在此聚合，可标注误报 / 漏报。</div>
      </div>
    );
  }
  const sorted = [...alerts].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((a) => (
        <AlertCard key={a.alert_id} alert={a} onFeedback={onFeedback} />
      ))}
    </div>
  );
}

function AlertCard({ alert, onFeedback }: { alert: Alert; onFeedback: Props['onFeedback'] }) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(alert.note ?? '');
  const levelColor = alert.level === 'high' ? 'var(--fg-block)' : alert.level === 'medium' ? 'var(--fg-observe)' : 'var(--fg-info)';
  return (
    <div style={{ ...alertCardStyle, borderLeft: `3px solid ${levelColor}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, flexWrap: 'wrap' }}>
        <AlertTriangle size={13} style={{ color: levelColor }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{alert.label}</span>
        <Tag style={{ margin: 0, fontSize: 10.5, lineHeight: '15px', padding: '0 5px' }} color={alert.level === 'high' ? 'error' : alert.level === 'medium' ? 'warning' : 'default'}>
          {RISK_META[alert.level]?.label ?? alert.level}
        </Tag>
        {alert.session_level && <span style={miniTagStyle}>会话级</span>}
        <DossierNo no={dossierFromId(alert.alert_id)} style={{ marginLeft: 'auto' }} />
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-text-3)' }}>T{alert.turn}</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-text-2)', lineHeight: 1.6, marginBottom: 6 }}>{alert.reason}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <StatusBadge action={alert.action} size="sm" />
        {alert.boundary && <span style={miniTagStyle}>{BOUNDARY_META[alert.boundary]}</span>}
        <span style={{ fontSize: 10.5, color: 'var(--fg-text-3)', alignSelf: 'center' }}>{formatShort(alert.created_at)}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          size="small"
          type={alert.false_positive ? 'primary' : 'default'}
          danger={alert.false_positive}
          icon={<Flag size={12} />}
          onClick={() => onFeedback({ alertId: alert.alert_id, payload: { false_positive: !alert.false_positive, note: note || undefined } })}
        >
          误报
        </Button>
        <Button
          size="small"
          type={alert.false_negative ? 'primary' : 'default'}
          icon={<Flag size={12} />}
          onClick={() => onFeedback({ alertId: alert.alert_id, payload: { false_negative: !alert.false_negative, note: note || undefined } })}
        >
          漏报
        </Button>
        <button onClick={() => setShowNote((s) => !s)} style={noteToggleStyle}>
          {showNote ? <ChevronDown size={11} /> : <ChevronRight size={11} />} 备注
        </button>
      </div>
      {showNote && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <Input size="small" value={note} onChange={(e) => setNote(e.target.value)} placeholder="复核备注" maxLength={200} />
          <Button size="small" onClick={() => onFeedback({ alertId: alert.alert_id, payload: { note } })}>
            保存
          </Button>
        </div>
      )}
      {!showNote && alert.note && <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--fg-text-3)' }}>备注：{alert.note}</div>}
    </div>
  );
}

function ChallengeList({ challenges, onResolve }: { challenges: GuardJudgementEvent[]; onResolve: Props['onResolveChallenge'] }) {
  if (challenges.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-text-3)' }}>
        <HelpCircle size={26} strokeWidth={1.4} style={{ opacity: 0.5, marginBottom: 10 }} />
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-text-2)' }}>无待裁决质询</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 6 }}>灰区调用会暂停等待人工批准或拒绝，超时将保守阻断。</div>
      </div>
    );
  }
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {challenges.map((c) => (
        <div key={c.call_id} style={challengeCardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, flexWrap: 'wrap' }}>
            <HelpCircle size={14} style={{ color: 'var(--fg-observe)' }} />
            <span className="mono" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{c.tool}</span>
            <StampBadge kind="challenge" size="sm" />
            <Tag color="warning" style={{ margin: 0, fontSize: 10.5 }}>待裁决</Tag>
            {c.risk && <Tag style={{ margin: 0, fontSize: 10.5 }}>{RISK_META[c.risk]?.label ?? c.risk}</Tag>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-text-2)', lineHeight: 1.6, marginBottom: 10 }}>{c.reason}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="primary" size="small" icon={<Check size={13} />} onClick={() => onResolve({ callId: c.call_id, approved: true })} style={{ flex: 1 }}>
              批准放行
            </Button>
            <Button danger size="small" icon={<X size={13} />} onClick={() => onResolve({ callId: c.call_id, approved: false })} style={{ flex: 1 }}>
              拒绝阻断
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LayerCard({ tag, name, skipped, available, timing, children }: { tag: string; name: string; skipped?: boolean; available?: boolean; timing?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const dim = skipped || available === false;
  return (
    <div style={{ border: '1px solid var(--fg-border)', borderRadius: 10, overflow: 'hidden', opacity: dim ? 0.7 : 1 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 11px', background: 'var(--fg-bg-subtle)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span className="mono" style={{ width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--fg-text-2)', background: 'var(--fg-bg-card)', border: '1px solid var(--fg-border)' }}>
          {tag}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-text-1)' }}>{name}</span>
        {skipped && <span style={miniTagStyle}>跳过</span>}
        {!skipped && available === false && <Tag color="warning" style={{ margin: 0, fontSize: 10, lineHeight: '14px', padding: '0 4px' }}>降级</Tag>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {timing != null && <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-text-3)' }}>{formatDuration(timing)}</span>}
          {open ? <ChevronDown size={13} style={{ color: 'var(--fg-text-3)' }} /> : <ChevronRight size={13} style={{ color: 'var(--fg-text-3)' }} />}
        </span>
      </button>
      {open && <div style={{ padding: '10px 12px' }}>{children}</div>}
    </div>
  );
}

function ProbBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = value >= 0.75 ? 'var(--fg-block)' : value >= 0.45 ? 'var(--fg-observe)' : 'var(--fg-allow)';
  return (
    <div style={{ height: 6, borderRadius: 4, background: 'var(--fg-bg-page)', overflow: 'hidden', border: '1px solid var(--fg-border)' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 300ms ease' }} />
    </div>
  );
}

function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
      <span style={{ color: 'var(--fg-text-3)' }}>{k}</span>
      <span className="mono" style={{ color: highlight ? 'var(--fg-observe-text)' : 'var(--fg-text-1)', fontWeight: highlight ? 600 : 500, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--fg-text-3)', lineHeight: 1.6 }}>{children}</div>;
}

function TabBtn({ active, onClick, icon, label, count, highlight }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number; highlight?: boolean }) {
  return (
    <button onClick={onClick} style={{ ...tabBtnStyle, color: active ? 'var(--fg-brand-primary)' : 'var(--fg-text-2)', borderBottomColor: active ? 'var(--fg-brand-primary)' : 'transparent' }}>
      {icon}
      {label}
      {count != null && count > 0 && (
        <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: highlight ? 'var(--fg-observe-text)' : 'var(--fg-text-3)', minWidth: 14, textAlign: 'center' }}>
          {count}
        </span>
      )}
    </button>
  );
}

const colStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--fg-bg-card)', border: '1px solid var(--fg-border)', borderRadius: 14, overflow: 'hidden' };
const tabStripStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px', borderBottom: '1px solid var(--fg-border)', background: 'var(--fg-bg-subtle)', flexShrink: 0 };
const tabBtnStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 11px', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, transition: 'color 140ms ease, border-color 140ms ease' };
const verdictCardStyle: React.CSSProperties = { padding: 13, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 11 };
const microLabelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 500, color: 'var(--fg-text-3)' };
const alertCardStyle: React.CSSProperties = { padding: 12, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 10 };
const challengeCardStyle: React.CSSProperties = { padding: 13, background: 'var(--fg-observe-bg)', border: '1px solid var(--fg-border)', borderRadius: 11 };
const noteToggleStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, color: 'var(--fg-text-3)', padding: 0 };
const miniTagStyle: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--fg-text-2)', border: '1px solid var(--fg-border)', borderRadius: 4, padding: '0 5px', lineHeight: '16px', background: 'var(--fg-bg-card)', whiteSpace: 'nowrap' };