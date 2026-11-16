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
  redteam: '#e0686d',
  agent: '#5fb8a4',
  guard: '#7aa3c8',
  gateway: '#5fb8a4',
  tool: '#4fb0a5',
  sandbox: '#9aa4ae',
  alert: '#e0686d',
};

const STATE_COLOR: Record<string, string> = {
  allow: '#4cb88a',
  block: '#e0686d',
  observe: '#d9a441',
  idle: '#6e7984',
};

// X6 React 节点：控制台舱位，状态色描边标记实时活动。
export function LabNode({ node }: { node?: { getData: () => NodeData } }) {
  const data = (node?.getData?.() ?? { label: '', kind: 'agent' }) as NodeData;
  const Icon = ICONS[data.kind] || Bot;
  const accent = ACCENT[data.kind] || '#5fb8a4';
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
    background: active ? '#191e25' : '#1d222a',
    border: `1px solid ${active ? stateColor : '#2b323c'}`,
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
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#e7eaed', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {data.label}
        </div>
        {data.sub && (
          <div className="mono" style={{ fontSize: 9.5, color: '#6e7984', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {data.sub}
          </div>
        )}
      </div>
      {data.count != null && data.count > 0 && (
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 600, color: stateColor, flexShrink: 0 }}>
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