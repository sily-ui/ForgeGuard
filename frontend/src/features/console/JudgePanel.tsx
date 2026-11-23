import { useMemo, useState } from 'react';
import { Button, Card, Collapse, Descriptions, Empty, Input, Progress, Segmented, Tag, Typography } from 'antd';
import { BellRing, HelpCircle, Check, X, Flag, Layers, Timer, Box, AlertTriangle } from 'lucide-react';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { StatusBadge } from '@/components/common/StatusBadge';
import { JudgeBadge } from '@/components/common/JudgeBadge';
import { JsonViewer } from '@/components/common/JsonViewer';
import { CallChainDag } from '@/components/visualization/CallChainDag';
import { DossierNo } from '@/components/common/DossierNo';
import { useSessionStore } from '@/stores/sessionStore';
import { BOUNDARY_META, RISK_META, TOOL_META } from '@/utils/constants';
import { formatDuration, formatShort } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import type { Alert, CallRecord, GuardJudgementEvent } from '@/types/api';

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
      <Segmented
        aria-label="取证面板视图"
        size="small"
        value={tab}
        onChange={(key) => setTab(key as Tab)}
        style={{ margin: 8, alignSelf: 'flex-start' }}
        options={[
          { value: 'judge', label: '判定取证', icon: <GuardIcon size={14} /> },
          { value: 'alerts', label: `告警${alerts.length > 0 ? ` (${alerts.length})` : ''}`, icon: <BellRing size={14} /> },
          {
            value: 'challenges',
            label: <Typography.Text type={challengeList.length > 0 ? 'warning' : undefined}>质询{challengeList.length > 0 ? ` (${challengeList.length})` : ''}</Typography.Text>,
            icon: <HelpCircle size={14} />,
          },
        ]}
      />
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
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ margin: 32 }}
        description={(
          <>
            <Typography.Text strong>三级判定取证</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
              在中间「调用链」选择一次调用，查看 L1 规则 / L2 注入分类 / L3 语义判定的完整证据。
            </Typography.Paragraph>
          </>
        )}
      />
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
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Descriptions
        bordered={false}
        column={1}
        size="small"
        title="判定结论"
        styles={{ content: { overflowWrap: 'anywhere' } }}
        items={[
          {
            key: 'tool', label: '工具', children: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Typography.Text className="mono" strong>{tool}</Typography.Text>
                <Typography.Text type="secondary">{TOOL_META[tool]?.label}</Typography.Text>
              </div>
            ),
          },
          { key: 'action', label: '处置', children: <StatusBadge action={action} size="sm" /> },
          {
            key: 'risk', label: '风险', children: (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={risk === 'high' ? 'error' : risk === 'medium' ? 'warning' : 'success'} style={{ margin: 0 }}>{RISK_META[risk]?.label ?? risk}</Tag>
                {boundary && <Tag style={{ margin: 0 }}>{BOUNDARY_META[boundary] ?? boundary}</Tag>}
                {judgement?.is_violation && <Tag color="error" style={{ margin: 0 }}>越权</Tag>}
                {judgement?.guard_unavailable && <Tag color="warning" style={{ margin: 0 }}>监护降级</Tag>}
              </div>
            ),
          },
          ...(judgedBy ? [{ key: 'source', label: '判定来源', children: <JudgeBadge judgedBy={judgedBy} size="sm" /> }] : []),
          { key: 'reason', label: '理由', children: judgement?.reason || (live?.challenge_pending ? '等待人工裁决…' : '暂无判定理由') },
          ...(judgement?.hit_policies?.length ? [{
            key: 'policies', label: '命中策略', children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {judgement.hit_policies.map((h) => (
                  <div key={h.policy_id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Typography.Text className="mono">{h.policy_id}</Typography.Text>
                    <Typography.Text type="secondary">{h.source}</Typography.Text>
                  </div>
                ))}
              </div>
            ),
          }] : []),
        ]}
      />

      <Collapse
        ghost
        items={[{
          key: 'dag',
          label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Layers size={12} />调用链 DAG</span>,
          styles: { header: { padding: '8px 0' }, body: { padding: '8px 0' } },
          children: <CallChainDag live={live} full={full} />,
        }]}
      />

      <div>
        <Typography.Title level={5} style={{ margin: '0 0 8px' }}>三级判定链路</Typography.Title>
        <LayerCard
          name="L1 · 确定性规则"
          skipped={layers?.layers.l1?.skipped}
          available={!layers?.layers.l1?.skipped}
          timing={timings?.l1}
        >
          {layers?.layers.l1 ? (
            layers.layers.l1.skipped ? (
              <Muted>本轮跳过 L1（防护关闭或对照轮次）</Muted>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Row k="命中" v={layers.layers.l1.hit ? '是 · 短路判定' : '否 · 放行至下层'} highlight={layers.layers.l1.hit} />
                {layers.layers.l1.rules && layers.layers.l1.rules.length > 0 && <JsonViewer data={layers.layers.l1.rules} maxHeight={140} collapsed />}
              </div>
            )
          ) : <Muted>完整分层取证将在调用落库后显示</Muted>}
        </LayerCard>

        <LayerCard
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Row k="注入概率" v={layers.layers.l2.injection_prob != null ? layers.layers.l2.injection_prob.toFixed(3) : '—'} />
                <ProbBar value={layers.layers.l2.injection_prob ?? 0} />
                {layers.layers.l2.short_circuit && <Row k="短路" v="高危直接阻断" highlight />}
                {layers.layers.l2.highlight && layers.layers.l2.highlight.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {layers.layers.l2.highlight.map((h, i) => <Tag key={i} color="warning" style={{ margin: 0 }}>{h}</Tag>)}
                  </div>
                )}
              </div>
            )
          ) : <Muted>完整分层取证将在调用落库后显示</Muted>}
        </LayerCard>

        <LayerCard
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Row k="JSON 有效" v={layers.layers.l3.valid ? '是' : '否 · 保守兜底'} highlight={!layers.layers.l3.valid} />
                {layers.layers.l3.raw_json && <JsonViewer data={layers.layers.l3.raw_json} maxHeight={160} collapsed />}
              </div>
            )
          ) : <Muted>完整分层取证将在调用落库后显示</Muted>}
        </LayerCard>
      </div>

      {(full?.sandbox_result || full?.params_raw) && (
        <Collapse
          ghost
          items={[
            ...(full?.sandbox_result ? [{
              key: 'sandbox',
              label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Box size={12} />仿真沙盒结果<Tag style={{ margin: 0 }}>SIM</Tag></span>,
              styles: { header: { padding: '8px 0' }, body: { padding: '8px 0' } },
              children: <JsonViewer data={full.sandbox_result} maxHeight={180} collapsed />,
            }] : []),
            ...(full?.params_raw ? [{
              key: 'params',
              label: '原始入参',
              styles: { header: { padding: '8px 0' }, body: { padding: '8px 0' } },
              children: <JsonViewer data={full.params_raw} maxHeight={160} collapsed />,
            }] : []),
          ]}
        />
      )}
      {timings && (
        <Typography.Text type="secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Timer size={12} />总耗时 <span className="mono">{formatDuration(full?.duration_ms)}</span>
        </Typography.Text>
      )}
    </div>
  );
}

function AlertsList({ alerts, onFeedback }: { alerts: Alert[]; onFeedback: Props['onFeedback'] }) {
  if (alerts.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ margin: 32 }}
        description={(
          <>
            <Typography.Text strong>暂无风险告警</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>越权与可疑调用将在此聚合，可标注误报 / 漏报。</Typography.Paragraph>
          </>
        )}
      />
    );
  }
  const sorted = [...alerts].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sorted.map((a) => <AlertCard key={a.alert_id} alert={a} onFeedback={onFeedback} />)}
    </div>
  );
}

function AlertCard({ alert, onFeedback }: { alert: Alert; onFeedback: Props['onFeedback'] }) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(alert.note ?? '');
  const levelColor = alert.level === 'high' ? 'var(--bb-block)' : alert.level === 'medium' ? 'var(--bb-observe)' : 'var(--bb-info)';
  return (
    <Card size="small" variant="borderless" style={{ borderRadius: 8, boxShadow: 'none' }} styles={{ body: { padding: 16 } }}>
      <Descriptions
        bordered={false}
        column={1}
        size="small"
        title={(
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <AlertTriangle size={13} style={{ color: levelColor }} />
            <Typography.Text strong>{alert.label}</Typography.Text>
          </span>
        )}
        styles={{ content: { overflowWrap: 'anywhere' } }}
        items={[
          {
            key: 'risk', label: '风险', children: (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Tag style={{ margin: 0 }} color={alert.level === 'high' ? 'error' : alert.level === 'medium' ? 'warning' : 'default'}>{RISK_META[alert.level]?.label ?? alert.level}</Tag>
                {alert.session_level && <Tag style={{ margin: 0 }}>会话级</Tag>}
              </div>
            ),
          },
          { key: 'dossier', label: '编号', children: <DossierNo no={dossierFromId(alert.alert_id)} /> },
          { key: 'turn', label: '回合', children: <span className="mono">T{alert.turn}</span> },
          { key: 'reason', label: '理由', children: alert.reason },
          { key: 'action', label: '处置', children: <StatusBadge action={alert.action} size="sm" /> },
          ...(alert.boundary ? [{ key: 'boundary', label: '边界', children: <Tag style={{ margin: 0 }}>{BOUNDARY_META[alert.boundary] ?? alert.boundary}</Tag> }] : []),
          { key: 'time', label: '时间', children: formatShort(alert.created_at) },
        ]}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <Button
          size="small"
          type={alert.false_positive ? 'primary' : 'default'}
          danger={alert.false_positive}
          icon={<Flag size={12} />}
          onClick={() => onFeedback({ alertId: alert.alert_id, payload: { false_positive: !alert.false_positive, note: note || undefined } })}
        >误报</Button>
        <Button
          size="small"
          type={alert.false_negative ? 'primary' : 'default'}
          icon={<Flag size={12} />}
          onClick={() => onFeedback({ alertId: alert.alert_id, payload: { false_negative: !alert.false_negative, note: note || undefined } })}
        >漏报</Button>
      </div>
      <Collapse
        ghost
        activeKey={showNote ? ['note'] : []}
        onChange={(keys) => setShowNote(keys.length > 0)}
        items={[{
          key: 'note',
          label: '备注',
          styles: { header: { padding: '8px 0' }, body: { padding: 0 } },
          children: (
            <div style={{ display: 'flex', gap: 8 }}>
              <Input size="small" aria-label="复核备注" value={note} onChange={(e) => setNote(e.target.value)} placeholder="复核备注" maxLength={200} />
              <Button size="small" onClick={() => onFeedback({ alertId: alert.alert_id, payload: { note } })}>保存</Button>
            </div>
          ),
        }]}
      />
      {!showNote && alert.note && <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>备注：{alert.note}</Typography.Paragraph>}
    </Card>
  );
}

function ChallengeList({ challenges, onResolve }: { challenges: GuardJudgementEvent[]; onResolve: Props['onResolveChallenge'] }) {
  if (challenges.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ margin: 32 }}
        description={(
          <>
            <Typography.Text strong>无待裁决质询</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>灰区调用会暂停等待人工批准或拒绝，超时将保守阻断。</Typography.Paragraph>
          </>
        )}
      />
    );
  }
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {challenges.map((c) => (
        <Card key={c.call_id} size="small" variant="borderless" style={{ borderRadius: 8, boxShadow: 'none' }} styles={{ body: { padding: 16 } }}>
          <Descriptions
            bordered={false}
            column={1}
            size="small"
            styles={{ content: { overflowWrap: 'anywhere' } }}
            items={[
              { key: 'tool', label: '工具', children: <Typography.Text className="mono" strong>{c.tool}</Typography.Text> },
              { key: 'status', label: '状态', children: <Tag color="warning" style={{ margin: 0 }}>待裁决</Tag> },
              ...(c.risk ? [{ key: 'risk', label: '风险', children: RISK_META[c.risk]?.label ?? c.risk }] : []),
              { key: 'reason', label: '理由', children: c.reason },
            ]}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Button type="primary" size="small" icon={<Check size={13} />} onClick={() => onResolve({ callId: c.call_id, approved: true })} style={{ flex: 1 }}>批准放行</Button>
            <Button danger size="small" icon={<X size={13} />} onClick={() => onResolve({ callId: c.call_id, approved: false })} style={{ flex: 1 }}>拒绝阻断</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function LayerCard({ name, skipped, available, timing, children }: { name: string; skipped?: boolean; available?: boolean; timing?: number; children: React.ReactNode }) {
  return (
    <Collapse
      ghost
      items={[{
        key: name,
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Typography.Text strong>{name}</Typography.Text>
            {skipped && <Tag style={{ margin: 0 }}>跳过</Tag>}
            {!skipped && available === false && <Tag color="warning" style={{ margin: 0 }}>降级</Tag>}
          </span>
        ),
        extra: timing != null ? <Typography.Text type="secondary" className="mono">{formatDuration(timing)}</Typography.Text> : undefined,
        styles: { header: { padding: '8px 0' }, body: { padding: '8px 0' } },
        children,
      }]}
    />
  );
}

function ProbBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = value >= 0.75 ? 'var(--bb-block)' : value >= 0.45 ? 'var(--bb-observe)' : 'var(--bb-allow)';
  return <Progress percent={pct} showInfo={false} size="small" strokeColor={color} />;
}

function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return <Descriptions bordered={false} column={1} size="small" items={[{ key: k, label: k, children: <Typography.Text type={highlight ? 'warning' : undefined} strong={highlight}>{v}</Typography.Text> }]} />;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <Typography.Text type="secondary">{children}</Typography.Text>;
}

const colStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, background: 'var(--bb-bg-card)', border: '1px solid var(--bb-border)', borderRadius: 8, overflow: 'hidden' };
