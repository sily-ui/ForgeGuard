import { useEffect, useRef } from 'react';
import { Graph } from '@antv/x6';
import { register } from '@antv/x6-react-shape';
import type { CallRecord } from '@/types/api';
import type { LiveCall } from '@/stores/sessionStore';
import { TOOL_META } from '@/utils/constants';

type Tone = 'idle' | 'allow' | 'block' | 'observe' | 'info' | 'dim';

interface DagData {
  label: string;
  sub?: string;
  tone: Tone;
}

const TONE_COLOR: Record<Tone, string> = {
  idle: '#c2cad0',
  allow: '#2e7d5b',
  block: '#b5484d',
  observe: '#c2892b',
  info: '#4f7ba6',
  dim: '#dfe3e7',
};

function DagNode({ node }: { node?: { getData: () => DagData } }) {
  const data = (node?.getData?.() ?? { label: '', tone: 'idle' }) as DagData;
  const color = TONE_COLOR[data.tone];
  const dim = data.tone === 'dim';
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 10px',
        borderRadius: 8,
        background: dim ? 'var(--bb-bg-subtle)' : 'var(--bb-bg-card)',
        border: '1px solid var(--bb-border)',
        borderLeft: `3px solid ${color}`,
        opacity: dim ? 0.6 : 1,
        overflow: 'hidden',
      }}
    >
      <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--bb-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {data.label}
      </div>
      {data.sub && (
        <div style={{ fontSize: 10, color: dim ? 'var(--bb-text-3)' : color, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {data.sub}
        </div>
      )}
    </div>
  );
}

register({ shape: 'bb-dag-node', width: 128, height: 40, component: DagNode });

const LAYOUT: Record<string, { x: number; y: number }> = {
  msg: { x: 0, y: 8 },
  agent: { x: 150, y: 8 },
  tool: { x: 300, y: 8 },
  l1: { x: 0, y: 76 },
  l2: { x: 150, y: 76 },
  l3: { x: 300, y: 76 },
  verdict: { x: 450, y: 76 },
};

const CHAIN = [
  ['msg', 'agent'],
  ['agent', 'tool'],
  ['tool', 'l1'],
  ['l1', 'l2'],
  ['l2', 'l3'],
  ['l3', 'verdict'],
];

function derive(live: LiveCall | null, full: CallRecord | null): Record<string, DagData> {
  const turn = live?.turn ?? full?.turn ?? 0;
  const tool = live?.tool ?? full?.tool ?? '—';
  const actor = live?.actor ?? full?.actor ?? 'business';
  const layers = full?.layers?.layers;
  const action = live?.action ?? full?.judgement?.action;
  const pending = live?.challenge_pending;

  const l1: DagData = !layers?.l1
    ? { label: 'L1 规则', sub: '待落库', tone: 'idle' }
    : layers.l1.skipped
      ? { label: 'L1 规则', sub: '本轮跳过', tone: 'dim' }
      : layers.l1.hit
        ? { label: 'L1 规则', sub: '命中 · 短路', tone: 'block' }
        : { label: 'L1 规则', sub: '通过', tone: 'allow' };
  const l2: DagData = !layers?.l2
    ? { label: 'L2 注入分类', sub: '待落库', tone: 'idle' }
    : layers.l2.skipped
      ? { label: 'L2 注入分类', sub: '本轮跳过', tone: 'dim' }
      : layers.l2.available === false
        ? { label: 'L2 注入分类', sub: '不可用 · 降级', tone: 'observe' }
        : layers.l2.short_circuit
          ? { label: 'L2 注入分类', sub: '高危短路', tone: 'block' }
          : { label: 'L2 注入分类', sub: `p=${(layers.l2.injection_prob ?? 0).toFixed(2)}`, tone: (layers.l2.injection_prob ?? 0) >= 0.45 ? 'observe' : 'allow' };
  const l3: DagData = !layers?.l3
    ? { label: 'L3 语义', sub: '待落库', tone: 'idle' }
    : layers.l3.skipped
      ? { label: 'L3 语义', sub: '未触发', tone: 'dim' }
      : layers.l3.available === false
        ? { label: 'L3 语义', sub: '不可用 · 降级', tone: 'observe' }
        : { label: 'L3 语义', sub: layers.l3.valid ? 'JSON 有效' : '保守兜底', tone: layers.l3.valid ? 'allow' : 'observe' };
  const verdict: DagData = pending
    ? { label: '裁决', sub: '待人工裁决', tone: 'observe' }
    : action === 'allow'
      ? { label: '裁决', sub: '放行', tone: 'allow' }
      : action === 'block' || action === 'limit_block'
        ? { label: '裁决', sub: '阻断', tone: 'block' }
        : action === 'degrade'
          ? { label: '裁决', sub: '降级', tone: 'observe' }
          : action === 'challenge'
            ? { label: '裁决', sub: '质询', tone: 'observe' }
            : { label: '裁决', sub: '判定中', tone: 'idle' };

  return {
    msg: { label: `消息 T${turn}`, sub: actor === 'redteam' ? '红队注入' : '用户输入', tone: 'info' },
    agent: { label: '业务 Agent', sub: '决策发起', tone: 'info' },
    tool: { label: tool, sub: TOOL_META[tool]?.label ?? '工具调用', tone: 'info' },
    l1,
    l2,
    l3,
    verdict,
  };
}

interface Props {
  live: LiveCall | null;
  full: CallRecord | null;
}

// X6 调用链 DAG：消息 → Agent → 工具 → L1/L2/L3 → 裁决；选中调用切换时重建，数据变化局部更新。
export function CallChainDag({ live, full }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const callId = live?.call_id ?? full?.call_id ?? null;

  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      height: 148,
      autoResize: true,
      background: { color: 'transparent' },
      grid: { visible: true, type: 'dot', size: 18, args: { color: '#eef1f3', thickness: 1 } },
      interacting: false,
      panning: false,
      mousewheel: false,
    });
    graphRef.current = graph;
    const fit = () => {
      try {
        graph.zoomToFit({ padding: 10, maxScale: 1 });
      } catch {
        /* 容器尚未布局 */
      }
    };
    requestAnimationFrame(fit);
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      graph.dispose();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!callId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !callId) return;
    graph.clearCells();
    const data = derive(live, full);
    for (const [id, pos] of Object.entries(LAYOUT)) {
      graph.addNode({ id, shape: 'bb-dag-node', x: pos.x, y: pos.y, width: 128, height: 40, data: data[id] });
    }
    for (const [source, target] of CHAIN) {
      const elbow = source === 'tool';
      graph.addEdge({
        id: `${source}-${target}`,
        source: { cell: source, anchor: elbow ? 'bottom' : 'right' },
        target: { cell: target, anchor: target === 'l1' ? 'top' : 'left' },
        attrs: { line: { stroke: '#b9c2c9', strokeWidth: 1.4, targetMarker: { name: 'classic', width: 7, height: 5 } } },
        connector: { name: 'rounded', args: { radius: 8 } },
        // 水平间距仅 22px，manhattan 的 padding 会撑出绕行环；水平直连、仅 tool→L1 走折线
        router: elbow ? { name: 'manhattan', args: { padding: 6 } } : undefined,
        zIndex: 0,
      });
    }
    requestAnimationFrame(() => {
      try {
        graph.zoomToFit({ padding: 10, maxScale: 1 });
      } catch {
        /* ignore */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !callId) return;
    const data = derive(live, full);
    for (const [id, d] of Object.entries(data)) {
      const cell = graph.getCellById(id);
      if (cell && cell.isNode()) cell.setData(d, { overwrite: true });
    }
    const verdictTone = data.verdict.tone;
    const edge = graph.getCellById('l3-verdict');
    if (edge && edge.isEdge()) {
      edge.setAttrs({ line: { stroke: TONE_COLOR[verdictTone], strokeWidth: 1.8, targetMarker: { name: 'classic', width: 7, height: 5 } } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, live?.action, live?.challenge_pending, live?.resolved, full?.layers, full?.judgement?.action]);

  if (!callId) return null;
  return <div ref={containerRef} style={{ width: '100%', height: 148 }} />;
}