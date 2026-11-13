import type { CSSProperties } from 'react';
import { Bot, ShieldCheck, Network, Wrench, Box, BellRing, Swords } from 'lucide-react';

export interface NodeData {
  label: string;
  sub?: string;
  kind: 'redteam' | 'agent' | 'guard' | 'gateway' | 'tool' | 'sandbox' | 'alert';
  active?: boolean;
  state?: 'allow' | 'block' | 'observe' | 'idle';
  count?: number;
}

const ICONS = {
  redteam: Swords,
  agent: Bot,
  guard: ShieldCheck,
  gateway: Network,
  tool: Wrench,
  sandbox: Box,
  alert: BellRing,
};

const ACCENT: Record<string, string> = {
  redteam: '#e8b45a',
  agent: '#6bc7b3',
  guard: '#7faed9',
  gateway: '#6bc7b3',
  tool: '#4fb0a5',
  sandbox: '#91a5a1',
  alert: '#f0787c',
};

const STATE_COLOR: Record<string, string> = {
  allow: '#4fd1a8',
  block: '#f0787c',
  observe: '#e8b45a',
  idle: '#30434a',
};

// X6 React 节点：深海舱卡片，状态色描边 + 呼吸激活。
export function LabNode({ node }: { node?: { getData: () => NodeData } }) {
  const data = (node?.getData?.() ?? { label: '', kind: 'agent' }) as NodeData;
  const Icon = ICONS[data.kind] || Bot;
  const accent = ACCENT[data.kind] || '#6bc7b3';
  const stateColor = data.state ? STATE_COLOR[data.state] : accent;
  const active = data.active;

  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    borderRadius: 12,
    background: active ? '#243a44' : '#1c2e37',
    border: `1.5px solid ${active ? stateColor : '#30434a'}`,
    boxShadow: active ? `0 0 0 3px ${stateColor}22, 0 6px 18px rgba(0,0,0,0.4)` : '0 2px 8px rgba(0,0,0,0.3)',
    transition: 'all 220ms ease',
    cursor: 'default',
    position: 'relative',
    overflow: 'hidden',
  };

  return (
    <div style={style} className={active ? 'fg-node-active' : ''}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `${accent}1f`,
          color: accent,
          flexShrink: 0,
        }}
        className={active ? 'fg-breathe' : ''}
      >
        <Icon size={17} strokeWidth={1.7} />
      </div>
      <div style={{ minWidth: 0, lineHeight: 1.2, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e8f0ee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {data.label}
        </div>
        {data.sub && (
          <div className="mono" style={{ fontSize: 9.5, color: '#91a5a1', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {data.sub}
          </div>
        )}
      </div>
      {data.count != null && data.count > 0 && (
        <span
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: stateColor,
            background: `${stateColor}1f`,
            borderRadius: 6,
            padding: '1px 6px',
            flexShrink: 0,
          }}
        >
          {data.count}
        </span>
      )}
      {active && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: stateColor,
            boxShadow: `0 0 8px ${stateColor}`,
          }}
          className="fg-breathe"
        />
      )}
    </div>
  );
}