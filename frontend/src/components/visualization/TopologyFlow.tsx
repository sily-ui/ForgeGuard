import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  useViewport,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeHandle,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import gsap from 'gsap';
import { Bot, Network, Box, AlertCircle } from 'lucide-react';
import { AttackIcon, GuardIcon } from '@/components/icons/SecurityIcons';
import { PixiFX, type PixiFXHandle } from './PixiFX';
import { useSessionStore } from '@/stores/sessionStore';

export interface TopologyState {
  enabledTools: string[];
  activeTool?: string;
  lastAction?: string;
  blockCount: number;
  alertCount: number;
  callCount: number;
  guardOn: boolean;
  pulse: number;
}

export interface NodeData extends Record<string, unknown> {
  label: string;
  sub?: string;
  kind: 'redteam' | 'agent' | 'guard' | 'gateway' | 'sandbox' | 'alert';
  active?: boolean;
  state?: 'allow' | 'block' | 'observe' | 'idle';
  count?: number;
}

const ICONS = {
  redteam: AttackIcon,
  agent: Bot,
  guard: GuardIcon,
  gateway: Network,
  sandbox: Box,
  alert: AlertCircle,
};

const ACCENT: Record<string, string> = {
  redteam: '#b5484d',
  agent: '#176b63',
  guard: '#4f7ba6',
  gateway: '#176b63',
  sandbox: '#8d97a1',
  alert: '#b5484d',
};

const STATE_COLOR: Record<string, string> = {
  allow: '#2e7d5b',
  block: '#b5484d',
  observe: '#c2892b',
  idle: '#c2cad0',
};

const EDGE_COLOR: Record<string, string> = {
  normal: '#176b63',
  attack: '#c2892b',
  mirror: '#4f7ba6',
  block: '#b5484d',
  degrade: '#c2892b',
};

const W = 168;
const H = 56;
// 节点尺寸固定：显式提供 measured/handles，避免受控 nodes 更新后 RF 清空测量值
// 导致节点 visibility:hidden 且 ResizeObserver 不再触发（尺寸未变）而永久隐藏。
const NODE_GEOMETRY: { measured: { width: number; height: number }; handles: NodeHandle[] } = {
  measured: { width: W, height: H },
  handles: [
    { id: 'l', type: 'target', position: Position.Left, x: 0, y: H / 2 },
    { id: 't', type: 'target', position: Position.Top, x: W / 2, y: 0 },
    { id: 'r', type: 'source', position: Position.Right, x: W, y: H / 2 },
    { id: 'b', type: 'source', position: Position.Bottom, x: W / 2, y: H },
  ],
};
const POS: Record<string, { x: number; y: number }> = {
  redteam: { x: 0, y: 20 },
  agent: { x: 210, y: 20 },
  gateway: { x: 420, y: 20 },
  sandbox: { x: 630, y: 20 },
  guard: { x: 420, y: 150 },
  alert: { x: 630, y: 150 },
};

function LabFlowNode({ data }: NodeProps<Node<NodeData>>) {
  const Icon = ICONS[data.kind] || Bot;
  const accent = ACCENT[data.kind] || '#176b63';
  const stateColor = data.state ? STATE_COLOR[data.state] : accent;
  const active = !!data.active;
  return (
    <div
      data-flow-node={data.kind}
      style={{
        width: W,
        height: H,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        borderRadius: 10,
        background: active ? '#ffffff' : 'rgba(250,251,251,0.92)',
        border: `1px solid ${active ? stateColor : '#dfe3e7'}`,
        boxShadow: active ? `0 0 0 3px ${stateColor}1e, 0 4px 14px ${stateColor}26` : '0 1px 3px rgba(30,36,41,0.06)',
        transition: 'background-color 200ms ease, border-color 200ms ease, box-shadow 200ms ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: `${accent}14`, color: accent, flexShrink: 0 }}>
        <Icon size={16} strokeWidth={1.6} />
      </span>
      <div style={{ minWidth: 0, lineHeight: 1.2, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1e2429', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.label}</div>
        {data.sub && (
          <div className="mono" style={{ fontSize: 10.5, color: '#8d97a1', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.sub}</div>
        )}
      </div>
      {data.count != null && data.count > 0 && (
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: stateColor, flexShrink: 0 }}>{data.count}</span>
      )}
      <span
        className={active ? 'fg-breathe' : undefined}
        style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: active ? stateColor : '#dfe3e7' }}
      />
      <Handle id="l" type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="t" type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle id="r" type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle id="b" type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

interface FlowEdgeData extends Record<string, unknown> {
  kind: string;
  active?: boolean;
}

function LabFlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const kind = data?.kind ?? 'normal';
  const color = EDGE_COLOR[kind] || EDGE_COLOR.normal;
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  const dashed = kind === 'attack' || kind === 'mirror';
  const runClass = data?.active ? (kind === 'attack' ? 'fg-flow-run-attack' : kind === 'mirror' ? 'fg-flow-run-mirror' : kind === 'block' ? 'fg-flow-run-block' : 'fg-flow-run-normal') : '';
  return (
    <BaseEdge
      id={id}
      path={path}
      className={`fg-flow-edge ${runClass}`}
      style={{ stroke: color, strokeWidth: kind === 'block' ? 2.4 : dashed ? 1.6 : 2, strokeDasharray: kind === 'attack' ? '6 4' : kind === 'mirror' ? '4 5' : undefined }}
      markerEnd={`url(#fg-flow-arrow-${kind})`}
    />
  );
}

const NODE_BASE: { id: string; data: NodeData }[] = [
  { id: 'redteam', data: { label: '红队攻击者', sub: 'Red Team', kind: 'redteam' } },
  { id: 'agent', data: { label: '业务 Agent', sub: 'Business', kind: 'agent' } },
  { id: 'gateway', data: { label: '工具网关', sub: 'Tool Gateway', kind: 'gateway' } },
  { id: 'sandbox', data: { label: '仿真沙盒', sub: 'Sandbox · SIM', kind: 'sandbox' } },
  { id: 'guard', data: { label: '旁路监护', sub: 'Guardian L1·L2·L3', kind: 'guard' } },
  { id: 'alert', data: { label: '告警聚合', sub: 'Alerts', kind: 'alert' } },
];

const EDGE_BASE: { id: string; source: string; target: string; sh: string; th: string; kind: string }[] = [
  { id: 'e-red-agent', source: 'redteam', target: 'agent', sh: 'r', th: 'l', kind: 'attack' },
  { id: 'e-agent-gw', source: 'agent', target: 'gateway', sh: 'r', th: 'l', kind: 'normal' },
  { id: 'e-gw-sandbox', source: 'gateway', target: 'sandbox', sh: 'r', th: 'l', kind: 'normal' },
  { id: 'e-gw-guard', source: 'gateway', target: 'guard', sh: 'b', th: 't', kind: 'mirror' },
  { id: 'e-guard-alert', source: 'guard', target: 'alert', sh: 'r', th: 'l', kind: 'mirror' },
];

const nodeTypes = { lab: LabFlowNode };
const edgeTypes = { lab: LabFlowEdge };

const EVENT_TEXT: Record<string, string> = {
  call: 'tool.call',
  judge: 'guard.judgement',
  resolve: 'chain.update',
  alert: 'alert.created',
  redteam: 'redteam.step',
};

interface Props {
  state: TopologyState;
  height?: number;
}

// 活体攻防拓扑：React Flow 承载节点/边与缩放，PixiJS 承载数据包与爆发粒子，GSAP 编排事件时间轴。
export function TopologyFlow(props: Props) {
  return (
    <ReactFlowProvider>
      <TopologyInner {...props} />
    </ReactFlowProvider>
  );
}

function TopologyInner({ state, height = 268 }: Props) {
  const fxRef = useRef<PixiFXHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stampRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const activityTimerRef = useRef<number>(0);
  const vp = useViewport();
  const { fitView } = useReactFlow();
  const fxEvent = useSessionStore((s) => s.fxEvent);
  const [stamp, setStamp] = useState<{ key: number; x: number; y: number } | null>(null);
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const { activeTool, lastAction, blockCount, alertCount, callCount, guardOn, enabledTools } = state;
  const blocked = lastAction === 'block' || lastAction === 'limit_block';
  const degraded = lastAction === 'degrade' || lastAction === 'challenge';
  const flowState = blocked ? 'block' : degraded ? 'observe' : activeTool ? 'allow' : 'idle';

  const nodes = useMemo<Node<NodeData>[]>(() => {
    const patch: Record<string, Partial<NodeData>> = {
      redteam: { active: !!activeTool, state: activeTool ? 'observe' : 'idle' },
      agent: { active: !!activeTool, state: activeTool ? 'allow' : 'idle', sub: activeTool ? `调用 ${activeTool}` : 'Business' },
      gateway: { active: !!activeTool, state: flowState, count: callCount, sub: `${enabledTools.length} 工具启用` },
      sandbox: { active: !!activeTool && !blocked, state: blocked ? 'block' : activeTool ? 'allow' : 'idle' },
      guard: { active: guardOn && !!activeTool, state: !guardOn ? 'idle' : flowState, sub: guardOn ? 'Guardian L1·L2·L3' : '监护已关闭' },
      alert: { active: alertCount > 0, state: alertCount > 0 ? 'block' : 'idle', count: alertCount },
    };
    return NODE_BASE.map((n) => ({
      id: n.id,
      type: 'lab',
      position: POS[n.id],
      ...NODE_GEOMETRY,
      data: { ...n.data, ...patch[n.id] },
      draggable: false,
      connectable: false,
      selectable: false,
    }));
  }, [activeTool, flowState, blocked, callCount, alertCount, guardOn, enabledTools.length]);

  const edges = useMemo<Edge<FlowEdgeData>[]>(() => {
    const kinds: Record<string, string> = {
      'e-red-agent': activeTool ? 'attack' : 'normal',
      'e-agent-gw': 'normal',
      'e-gw-sandbox': blocked ? 'block' : degraded ? 'degrade' : 'normal',
      'e-gw-guard': 'mirror',
      'e-guard-alert': alertCount > 0 ? 'block' : 'mirror',
    };
    return EDGE_BASE.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sh,
      targetHandle: e.th,
      type: 'lab',
      data: { kind: kinds[e.id], active: !!activeTool || e.kind === 'mirror' },
    }));
  }, [activeTool, blocked, degraded, alertCount]);

  // 容器尺寸变化时重新适配（响应式降列/窗口缩放）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fitView({ padding: 0.1, maxZoom: 1, duration: 0 }));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [fitView]);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    clearTimeout(activityTimerRef.current);
  }, []);

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id);
      fn();
    }, ms);
    timersRef.current.push(id);
  };

  // 事件编排：SSE 逐事件驱动数据包飞行、阻断爆发与落印
  useEffect(() => {
    if (!fxEvent || reduced) return;
    const fx = fxRef.current;
    if (!fx) return;
    const z = vp.zoom;
    const pt = (id: string, side: 'l' | 'r' | 't' | 'b' | 'c') => {
      const p = POS[id];
      const local =
        side === 'l' ? { x: p.x, y: p.y + H / 2 }
        : side === 'r' ? { x: p.x + W, y: p.y + H / 2 }
        : side === 't' ? { x: p.x + W / 2, y: p.y }
        : side === 'b' ? { x: p.x + W / 2, y: p.y + H }
        : { x: p.x + W / 2, y: p.y + H / 2 };
      return { x: local.x * z + vp.x, y: local.y * z + vp.y };
    };
    const shake = (id: string) => {
      const el = wrapRef.current?.querySelector(`[data-flow-node="${id}"]`);
      if (el) gsap.fromTo(el, { x: 0 }, { x: 4, duration: 0.06, repeat: 5, yoyo: true, ease: 'none', onComplete: () => gsap.set(el, { x: 0 }) });
    };
    const wake = () => {
      fx.setActivity(1);
      clearTimeout(activityTimerRef.current);
      activityTimerRef.current = window.setTimeout(() => fx.setActivity(0.3), 2600);
    };
    wake();
    const gwR = pt('gateway', 'r');
    const sbL = pt('sandbox', 'l');
    const mid = { x: (gwR.x + sbL.x) / 2, y: (gwR.y + sbL.y) / 2 };

    switch (fxEvent.kind) {
      case 'call':
        fx.packet([pt('redteam', 'r'), pt('agent', 'l')], '#c2892b', 0.4);
        later(() => fx.packet([pt('agent', 'r'), pt('gateway', 'l')], '#176b63', 0.4), 200);
        break;
      case 'judge':
        fx.packet([pt('gateway', 'b'), pt('guard', 't')], '#4f7ba6', 0.4);
        if (fxEvent.action === 'challenge') later(() => fx.burst(pt('guard', 'c').x, pt('guard', 'c').y, '#c2892b'), 380);
        break;
      case 'resolve':
        if (fxEvent.action === 'block' || fxEvent.action === 'limit_block') {
          fx.packet([gwR, mid], '#b5484d', 0.28);
          later(() => {
            fx.burst(mid.x, mid.y, '#b5484d');
            shake('gateway');
            shake('sandbox');
            setStamp({ key: fxEvent.at, x: mid.x, y: mid.y - 34 * z });
          }, 280);
        } else if (fxEvent.action === 'degrade') {
          fx.packet([gwR, sbL], '#c2892b', 0.45);
        } else {
          fx.packet([gwR, sbL], '#2e7d5b', 0.45);
        }
        break;
      case 'alert':
        fx.packet([pt('guard', 'r'), pt('alert', 'l')], '#b5484d', 0.4);
        later(() => fx.burst(pt('alert', 'c').x, pt('alert', 'c').y, '#b5484d'), 380);
        break;
      case 'redteam':
        fx.packet([pt('redteam', 'r'), pt('agent', 'l')], '#c2892b', 0.4);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxEvent?.at]);

  // 落印时间轴：弹入 → 停留 → 淡出
  useEffect(() => {
    const el = stampRef.current;
    if (!el || !stamp) return;
    if (reduced) {
      const t = window.setTimeout(() => setStamp(null), 1600);
      return () => clearTimeout(t);
    }
    const tl = gsap.timeline({ onComplete: () => setStamp(null) });
    tl.fromTo(el, { opacity: 0, scale: 0.85, y: 6 }, { opacity: 1, scale: 1, y: 0, duration: 0.22, ease: 'power3.out' })
      .to(el, { opacity: 1, duration: 1.1 })
      .to(el, { opacity: 0, y: -6, duration: 0.25, ease: 'power2.in' });
    return () => { tl.kill(); };
  }, [stamp?.key, reduced]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height }}>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          {Object.entries(EDGE_COLOR).map(([kind, color]) => (
            <marker key={kind} id={`fg-flow-arrow-${kind}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10Z" fill={color} />
            </marker>
          ))}
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch
        panOnDrag
        minZoom={0.4}
        maxZoom={1.6}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#e2e5e8" />
        <Controls showInteractive={false} position="top-right" />
      </ReactFlow>
      <PixiFX ref={fxRef} />
      {stamp && (
        <div style={{ left: stamp.x, top: stamp.y, position: 'absolute', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
          <div ref={stampRef} className="fg-flow-stamp">已拦截</div>
        </div>
      )}
      <div style={{ position: 'absolute', top: 6, left: 10, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-text-3)', pointerEvents: 'none' }}>
        <span className="fg-blink" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--fg-allow)' }} />
        <span className="mono" style={{ fontWeight: 600, letterSpacing: 0.4 }}>LIVE</span>
        {fxEvent && (
          <span key={fxEvent.at} className="mono fg-flow-event" style={{ color: 'var(--fg-text-2)' }}>
            {EVENT_TEXT[fxEvent.kind]}
            {fxEvent.tool ? ` · ${fxEvent.tool}` : ''}
            {fxEvent.action ? ` → ${fxEvent.action}` : ''}
          </span>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 6, left: 12, display: 'flex', gap: 14, fontSize: 12, color: 'var(--fg-text-3)', pointerEvents: 'none' }}>
        <Legend color="#176b63" label="正常调用" />
        <Legend color="#c2892b" label="攻击 / 降级" dash />
        <Legend color="#4f7ba6" label="旁路镜像" dash />
        <Legend color="#b5484d" label="阻断" />
      </div>
    </div>
  );
}

function Legend({ color, label, dash }: { color: string; label: string; dash?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <svg width="20" height="6">
        <line x1="0" y1="3" x2="20" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash ? '3 3' : undefined} />
      </svg>
      {label}
    </span>
  );
}