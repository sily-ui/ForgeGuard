import { useMemo } from 'react';
import { Button, Empty, List, Tag, Tooltip, Typography } from 'antd';
import { Network, ListTree, ArrowRight } from 'lucide-react';
import { TopologyFlow, type TopologyState } from '@/components/visualization/TopologyFlow';
import { StatusBadge } from '@/components/common/StatusBadge';
import { JudgeBadge } from '@/components/common/JudgeBadge';
import { useSessionStore, type LiveCall } from '@/stores/sessionStore';
import { TOOL_META } from '@/utils/constants';
import { formatDuration, paramsSummaryText, truncate } from '@/utils/format';

interface Props {
  topology: TopologyState;
  onSelectCall: (id: string) => void;
}

export function ChainPanel({ topology, onSelectCall }: Props) {
  const calls = useSessionStore((s) => s.calls);
  const callOrder = useSessionStore((s) => s.callOrder);
  const selectedCallId = useSessionStore((s) => s.selectedCallId);
  const session = useSessionStore((s) => s.session);

  const ordered = useMemo(() => callOrder.map((id) => calls[id]).filter(Boolean) as LiveCall[], [calls, callOrder]);
  const stats = useMemo(() => {
    const c = { allow: 0, block: 0, challenge: 0, degrade: 0 };
    for (const call of ordered) {
      const a = call.action;
      if (a === 'allow') c.allow++;
      else if (a === 'block' || a === 'limit_block') c.block++;
      else if (a === 'challenge') c.challenge++;
      else if (a === 'degrade') c.degrade++;
    }
    return c;
  }, [ordered]);

  return (
    <div data-tour="chain-panel" style={colStyle}>
      <div style={panelHeaderStyle}>
        <Typography.Text strong style={panelTitleStyle}><Network size={15} />攻防拓扑</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>红队 → 业务 → 网关 → 沙盒 · 监护旁路镜像</Typography.Text>
      </div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--bb-border)' }}>
        <TopologyFlow state={topology} height={236} />
      </div>

      <div style={panelHeaderStyle}>
        <Typography.Text strong style={panelTitleStyle}>
          <ListTree size={15} />调用链<Tag style={{ margin: 0 }}>{ordered.length}</Tag>
        </Typography.Text>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <StatChip label="放行" value={stats.allow} kind="allow" />
          <StatChip label="阻断" value={stats.block} kind="block" />
          <StatChip label="质询" value={stats.challenge} kind="observe" />
          <StatChip label="降级" value={stats.degrade} kind="observe" />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        {ordered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: 32 }}
            description={(
              <>
                <Typography.Text strong>尚无工具调用</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                  发送消息或载入样本后，每次工具调用将在此实时呈现，点击任意调用可在右侧查看三级判定取证。
                </Typography.Paragraph>
              </>
            )}
          />
        ) : (
          <List
            split={false}
            dataSource={ordered}
            renderItem={(call, idx) => (
              <List.Item key={call.call_id} style={{ padding: '0 0 8px' }}>
                <CallRow call={call} index={idx} active={call.call_id === selectedCallId} onSelect={() => onSelectCall(call.call_id)} />
              </List.Item>
            )}
          />
        )}
      </div>

      <div style={colFooterStyle}>
        <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
          会话累计 <b className="mono" style={{ color: 'var(--bb-text-2)' }}>{session?.call_count ?? ordered.length}</b> 次调用
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
          拦截 <b className="mono" style={{ color: 'var(--bb-block-text)' }}>{session?.block_count ?? stats.block}</b> · 告警{' '}
          <b className="mono" style={{ color: 'var(--bb-observe-text)' }}>{topology.alertCount}</b>
        </Typography.Text>
      </div>
    </div>
  );
}

function CallRow({ call, index, active, onSelect }: { call: LiveCall; index: number; active: boolean; onSelect: () => void }) {
  const meta = TOOL_META[call.tool];
  const pending = call.challenge_pending;
  const unresolved = !call.resolved && !pending;
  return (
    <Button
      block
      onClick={onSelect}
      aria-pressed={active}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 'auto',
        textAlign: 'left',
        whiteSpace: 'normal',
        padding: 8,
        background: active ? 'var(--bb-bg-subtle)' : 'var(--bb-bg-card)',
        borderColor: active ? 'var(--bb-brand-primary)' : 'var(--bb-border)',
        borderRadius: 8,
        boxShadow: 'none',
      }}
    >
      <span className="mono" style={{ fontSize: 11, color: 'var(--bb-text-3)', width: 22, flexShrink: 0 }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--bb-text-1)', overflowWrap: 'anywhere' }}>{call.tool}</span>
          <span style={{ fontSize: 11.5, color: 'var(--bb-text-3)' }}>{meta?.label}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--bb-text-3)', marginLeft: 'auto' }}>T{call.turn}</span>
        </span>
        <span className="mono" style={{ display: 'block', fontSize: 11.5, color: 'var(--bb-text-2)', marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {truncate(paramsSummaryText(call.params_summary), 64)}
        </span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        {pending ? (
          <Tag color="warning" style={{ margin: 0 }}>待裁决</Tag>
        ) : unresolved ? (
          <Tag style={{ margin: 0 }}>判定中</Tag>
        ) : (
          <StatusBadge action={call.action || 'unknown'} size="sm" />
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {call.judged_by && <JudgeBadge judgedBy={call.judged_by} size="sm" />}
          {call.duration_ms != null && <span className="mono" style={{ fontSize: 10.5, color: 'var(--bb-text-3)' }}>{formatDuration(call.duration_ms)}</span>}
        </span>
      </span>
      <ArrowRight size={13} style={{ color: active ? 'var(--bb-brand-primary)' : 'var(--bb-text-3)', flexShrink: 0 }} />
    </Button>
  );
}

function StatChip({ label, value, kind }: { label: string; value: number; kind: 'allow' | 'block' | 'observe' }) {
  return (
    <Tooltip title={`${label} ${value} 次`}>
      <Tag color={kind === 'allow' ? 'success' : kind === 'block' ? 'error' : 'warning'} style={{ margin: 0 }}>{label} {value}</Tag>
    </Tooltip>
  );
}

const colStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  background: 'var(--bb-bg-card)',
  border: '1px solid var(--bb-border)',
  borderRadius: 8,
  overflow: 'hidden',
};
const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 16px',
  borderBottom: '1px solid var(--bb-border)',
  flexShrink: 0,
  flexWrap: 'wrap',
};
const panelTitleStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 };
const colFooterStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '8px 16px', borderTop: '1px solid var(--bb-border)', flexShrink: 0 };
