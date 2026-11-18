import { useMemo } from 'react';
import { Tooltip } from 'antd';
import { Network, ListTree, ArrowRight } from 'lucide-react';
import { TopologyGraph, type TopologyState } from '@/components/visualization/TopologyGraph';
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
        <span style={panelTitleStyle}>
          <Network size={15} /> 攻防拓扑
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>红队 → 业务 → 网关 → 沙盒 · 监护旁路镜像</span>
      </div>
      <div style={{ padding: '6px 10px 2px', borderBottom: '1px solid var(--fg-border)' }}>
        <TopologyGraph state={topology} height={236} />
      </div>

      <div style={panelHeaderStyle}>
        <span style={panelTitleStyle}>
          <ListTree size={15} /> 调用链
          <span className="mono" style={countPillStyle}>{ordered.length}</span>
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <StatChip label="放行" value={stats.allow} kind="allow" />
          <StatChip label="阻断" value={stats.block} kind="block" />
          <StatChip label="质询" value={stats.challenge} kind="observe" />
          <StatChip label="降级" value={stats.degrade} kind="observe" />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px' }}>
        {ordered.length === 0 ? (
          <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--fg-text-3)' }}>
            <ListTree size={26} strokeWidth={1.4} style={{ opacity: 0.5, marginBottom: 10 }} />
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-text-2)' }}>尚无工具调用</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 6 }}>
              发送消息或载入样本后，每次工具调用将在此实时呈现，
              <br />
              点击任意调用可在右侧查看三级判定取证。
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {ordered.map((call, idx) => (
              <CallRow
                key={call.call_id}
                call={call}
                index={idx}
                active={call.call_id === selectedCallId}
                onSelect={() => onSelectCall(call.call_id)}
              />
            ))}
          </div>
        )}
      </div>

      <div style={colFooterStyle}>
        <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>
          会话累计 <b className="mono" style={{ color: 'var(--fg-text-2)' }}>{session?.call_count ?? ordered.length}</b> 次调用
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>
          拦截 <b className="mono" style={{ color: 'var(--fg-block-text)' }}>{session?.block_count ?? stats.block}</b> · 告警{' '}
          <b className="mono" style={{ color: 'var(--fg-observe-text)' }}>{topology.alertCount}</b>
        </span>
      </div>
    </div>
  );
}

function CallRow({ call, index, active, onSelect }: { call: LiveCall; index: number; active: boolean; onSelect: () => void }) {
  const meta = TOOL_META[call.tool];
  const pending = call.challenge_pending;
  const unresolved = !call.resolved && !pending;
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '9px 11px',
        background: active ? 'var(--fg-bg-subtle)' : 'var(--fg-bg-page)',
        border: `1px solid ${active ? 'var(--fg-brand-primary)' : 'var(--fg-border)'}`,
        borderLeft: `3px solid ${statusBorderColor(call)}`,
        borderRadius: 10,
        cursor: 'pointer',
        transition: 'background-color 140ms ease, border-color 140ms ease',
      }}
    >
      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-text-3)', width: 22, flexShrink: 0 }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-text-1)' }}>{call.tool}</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>{meta?.label}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-text-3)', marginLeft: 'auto' }}>T{call.turn}</span>
        </span>
        <span
          className="mono"
          style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-text-2)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {truncate(paramsSummaryText(call.params_summary), 64)}
        </span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        {pending ? (
          <span style={pendingBadgeStyle}>待裁决</span>
        ) : unresolved ? (
          <span style={{ ...pendingBadgeStyle, color: 'var(--fg-text-3)', background: 'var(--fg-bg-subtle)', borderColor: 'var(--fg-border)' }}>判定中</span>
        ) : (
          <StatusBadge action={call.action || 'unknown'} size="sm" />
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {call.judged_by && <JudgeBadge judgedBy={call.judged_by} size="sm" />}
          {call.duration_ms != null && (
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-text-3)' }}>{formatDuration(call.duration_ms)}</span>
          )}
        </span>
      </span>
      <ArrowRight size={13} style={{ color: active ? 'var(--fg-brand-primary)' : 'var(--fg-text-3)', flexShrink: 0 }} />
    </button>
  );
}

function statusBorderColor(call: LiveCall): string {
  if (call.challenge_pending) return 'var(--fg-observe)';
  const a = call.action;
  if (a === 'allow') return 'var(--fg-allow)';
  if (a === 'block' || a === 'limit_block') return 'var(--fg-block)';
  if (a === 'challenge' || a === 'degrade') return 'var(--fg-observe)';
  return 'var(--fg-border)';
}

function StatChip({ label, value, kind }: { label: string; value: number; kind: 'allow' | 'block' | 'observe' }) {
  const color = kind === 'allow' ? 'var(--fg-allow-text)' : kind === 'block' ? 'var(--fg-block-text)' : 'var(--fg-observe-text)';
  return (
    <Tooltip title={`${label} ${value} 次`}>
      <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, color, padding: '2px 7px', borderRadius: 6, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)' }}>
        {value}
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-text-3)' }}>{label}</span>
      </span>
    </Tooltip>
  );
}

const colStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  background: 'var(--fg-bg-card)',
  border: '1px solid var(--fg-border)',
  borderRadius: 14,
  overflow: 'hidden',
};
const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '11px 14px',
  borderBottom: '1px solid var(--fg-border)',
  flexShrink: 0,
  flexWrap: 'wrap',
};
const panelTitleStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)' };
const countPillStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 500, color: 'var(--fg-text-3)', marginLeft: 2 };
const colFooterStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid var(--fg-border)', flexShrink: 0 };
const pendingBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-observe-text)',
  background: 'var(--fg-observe-bg)',
  border: '1px solid var(--fg-border)',
  borderRadius: 6,
  padding: '2px 7px',
  whiteSpace: 'nowrap',
};