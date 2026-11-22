import { useEffect, useRef } from 'react';
import { Graph } from '@antv/x6';
import { register } from '@antv/x6-react-shape';
import { LabNode, type NodeData } from './LabNode';

register({
  shape: 'fg-lab-node',
  width: 168,
  height: 56,
  component: LabNode,
});

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

const NODES: { id: string; x: number; y: number; data: NodeData }[] = [
  { id: 'redteam', x: 24, y: 40, data: { label: '红队攻击者', sub: 'Red Team', kind: 'redteam' } },
  { id: 'agent', x: 232, y: 40, data: { label: '业务 Agent', sub: 'Business', kind: 'agent' } },
  { id: 'gateway', x: 440, y: 40, data: { label: '工具网关', sub: 'Tool Gateway', kind: 'gateway' } },
  { id: 'sandbox', x: 648, y: 40, data: { label: '仿真沙盒', sub: 'Sandbox · SIM', kind: 'sandbox' } },
  { id: 'guard', x: 440, y: 168, data: { label: '旁路监护', sub: 'Guardian L1·L2·L3', kind: 'guard' } },
  { id: 'alert', x: 648, y: 168, data: { label: '告警聚合', sub: 'Alerts', kind: 'alert' } },
];

const EDGES = [
  { id: 'e-red-agent', source: 'redteam', target: 'agent', kind: 'attack' },
  { id: 'e-agent-gw', source: 'agent', target: 'gateway', kind: 'normal' },
  { id: 'e-gw-sandbox', source: 'gateway', target: 'sandbox', kind: 'normal' },
  { id: 'e-gw-guard', source: 'gateway', target: 'guard', kind: 'mirror' },
  { id: 'e-guard-alert', source: 'guard', target: 'alert', kind: 'mirror' },
];

function edgeAttrs(kind: string) {
  const map: Record<string, { stroke: string; dash?: string; width: number }> = {
    normal: { stroke: '#176b63', width: 2 },
    attack: { stroke: '#c2892b', width: 2, dash: '6 4' },
    mirror: { stroke: '#4f7ba6', width: 1.6, dash: '4 5' },
    block: { stroke: '#b5484d', width: 2.4 },
    degrade: { stroke: '#c2892b', width: 1.6 },
  };
  const m = map[kind] || map.normal;
  return {
    line: {
      stroke: m.stroke,
      strokeWidth: m.width,
      strokeDasharray: m.dash || null,
      targetMarker: kind === 'block' ? { name: 'block', width: 10, height: 10 } : { name: 'classic', width: 9, height: 7 },
    },
  };
}

interface Props {
  state: TopologyState;
  height?: number;
}

// 攻防拓扑：红队 → 业务 → 网关 → 沙盒；监护旁路镜像。局部更新，稳定 ID，不整图重建。
export function TopologyGraph({ state, height = 268 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      height,
      autoResize: true,
      background: { color: 'transparent' },
      grid: { visible: true, type: 'dot', size: 22, args: { color: '#e2e5e8', thickness: 1 } },
      interacting: false,
      panning: false,
      mousewheel: false,
    });
    graphRef.current = graph;

    for (const n of NODES) {
      graph.addNode({
        id: n.id,
        shape: 'fg-lab-node',
        x: n.x,
        y: n.y,
        width: 168,
        height: 56,
        data: { ...n.data },
      });
    }
    for (const e of EDGES) {
      graph.addEdge({
        id: e.id,
        source: { cell: e.source, anchor: 'right' },
        target: { cell: e.target, anchor: e.kind === 'mirror' ? 'top' : 'left' },
        attrs: edgeAttrs(e.kind),
        connector: { name: 'rounded', args: { radius: 10 } },
        router: e.kind === 'mirror' ? { name: 'manhattan', args: { padding: 16 } } : { name: 'normal' },
        zIndex: 0,
      });
    }
    // 适配内容到容器宽度；容器尺寸变化（响应式降列/窗口缩放）时重新适配。
    const fit = () => {
      try {
        graph.zoomToFit({ padding: 16, maxScale: 1 });
      } catch {
        /* 容器尚未布局时忽略 */
      }
    };
    requestAnimationFrame(fit);
    let fitRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(fitRaf);
      fitRaf = requestAnimationFrame(fit);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(fitRaf);
      graph.dispose();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // 局部状态更新
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const { activeTool, lastAction, blockCount, alertCount, callCount, guardOn, enabledTools } = state;
    const blocked = lastAction === 'block' || lastAction === 'limit_block';
    const degraded = lastAction === 'degrade' || lastAction === 'challenge';
    const flowState = blocked ? 'block' : degraded ? 'observe' : activeTool ? 'allow' : 'idle';

    const setData = (id: string, patch: Partial<NodeData>) => {
      const cell = graph.getCellById(id);
      if (cell && cell.isNode()) {
        cell.setData({ ...cell.getData(), ...patch }, { overwrite: true });
      }
    };
    const setEdge = (id: string, kind: string) => {
      const cell = graph.getCellById(id);
      if (cell && cell.isEdge()) cell.setAttrs(edgeAttrs(kind));
    };

    setData('redteam', { active: !!activeTool, state: activeTool ? 'observe' : 'idle' });
    setData('agent', { active: !!activeTool, state: activeTool ? 'allow' : 'idle', sub: activeTool ? `调用 ${activeTool}` : 'Business' });
    setData('gateway', { active: !!activeTool, state: flowState, count: callCount, sub: `${enabledTools.length} 工具启用` });
    setData('sandbox', { active: !!activeTool && !blocked, state: blocked ? 'block' : activeTool ? 'allow' : 'idle', sub: 'Sandbox · SIM' });
    setData('guard', { active: guardOn && !!activeTool, state: !guardOn ? 'idle' : flowState, sub: guardOn ? 'Guardian L1·L2·L3' : '监护已关闭' });
    setData('alert', { active: alertCount > 0, state: alertCount > 0 ? 'block' : 'idle', count: alertCount });

    setEdge('e-red-agent', activeTool ? 'attack' : 'normal');
    setEdge('e-agent-gw', activeTool ? 'normal' : 'normal');
    setEdge('e-gw-sandbox', blocked ? 'block' : degraded ? 'degrade' : 'normal');
    setEdge('e-gw-guard', 'mirror');
    setEdge('e-guard-alert', alertCount > 0 ? 'block' : 'mirror');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pulse, state.activeTool, state.lastAction, state.blockCount, state.alertCount, state.callCount, state.guardOn]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height }} />
      <div style={{ position: 'absolute', bottom: 6, left: 12, display: 'flex', gap: 14, fontSize: 12, color: 'var(--fg-text-3)' }}>
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
