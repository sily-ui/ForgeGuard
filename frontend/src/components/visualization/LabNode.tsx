import type { CSSProperties } from 'react';
import { Bot, Network, Wrench, Box, AlertCircle } from 'lucide-react';
import { AttackIcon, GuardIcon } from '@/components/icons/SecurityIcons';

export interface NodeData {
  label: string;
  sub?: string;
  kind: 'redteam' | 'agent' | 'guard' | 'gateway' | 'tool' | 'sandbox' | 'alert';
  active?: boolean;
  state?: 'allow' | 'block' | 'observe' | 'idle';
  count?: number;
}

const ICONS = {
  redteam: AttackIcon,
  agent: Bot,
  guard: GuardIcon,
  gateway: Network,
  tool: Wrench,
  sandbox: Box,
  alert: AlertCircle,
};

const ACCENT: Record<string, string> = {
  redteam: '#b5484d',
  agent: '#176b63',
  guard: '#4f7ba6',
  gateway: '#176b63',
  tool: '#2d9184',
  sandbox: '#8d97a1',
  alert: '#b5484d',
};

const STATE_COLOR: Record<string, string> = {
  allow: '#2e7d5b',
  block: '#b5484d',
  observe: '#c2892b',
  idle: '#c2cad0',
};

// X6 React 节点：控制台舱位，状态色描边标记实时活动。
export function LabNode({ node }: { node?: { getData: () => NodeData } }) {
  const data = (node?.getData?.() ?? { label: '', kind: 'agent' }) as NodeData;
  const Icon = ICONS[data.kind] || Bot;
  const accent = ACCENT[data.kind] || '#176b63';
  const stateColor = data.state ? STATE_COLOR[data.state] : accent;
  const active = data.active;

  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    borderRadius: 8,
    background: active ? '#ffffff' : '#fafbfb',
    border: `1px solid ${active ? stateColor : '#dfe3e7'}`,
    transition: 'background-color 200ms ease, border-color 200ms ease',
    cursor: 'default',
    position: 'relative',
    overflow: 'hidden',
  };

  return (
    <div style={style}>
      <span style={{ display: 'inline-flex', color: accent, flexShrink: 0 }}>
        <Icon size={16} strokeWidth={1.5} />
      </span>
      <div style={{ minWidth: 0, lineHeight: 1.2, flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1e2429', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {data.label}
        </div>
        {data.sub && (
          <div className="mono" style={{ fontSize: 11.5, color: '#8d97a1', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {data.sub}
          </div>
        )}
      </div>
      {data.count != null && data.count > 0 && (
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: stateColor, flexShrink: 0 }}>
          {data.count}
        </span>
      )}
      {active && (
        <span
          className="fg-breathe"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: stateColor,
          }}
        />
      )}
    </div>
  );
}
