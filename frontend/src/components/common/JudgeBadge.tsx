import { useUiStore } from '@/stores/uiStore';

const META: Record<string, { label: string; desc: string; hue: string }> = {
  L1: { label: 'L1', desc: '确定性规则层', hue: '#5689b8' },
  L2: { label: 'L2', desc: '注入分类层', hue: '#2d9184' },
  L3: { label: 'L3', desc: '语义判定层', hue: '#7c6bb8' },
  skip: { label: 'SKIP', desc: '未启用防护', hue: '#9aa7a3' },
  fallback: { label: 'FALLBACK', desc: '监护降级保守处理', hue: '#d69a43' },
};

export function JudgeBadge({ judgedBy, size = 'md' }: { judgedBy?: string; size?: 'sm' | 'md' }) {
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';
  const meta = META[judgedBy || ''] || { label: judgedBy || '—', desc: '判定来源', hue: '#9aa7a3' };
  const dim = size === 'sm' ? 17 : 20;
  return (
    <span
      className="mono"
      title={meta.desc}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: dim,
        padding: '0 6px',
        borderRadius: 5,
        fontSize: size === 'sm' ? 9.5 : 10.5,
        fontWeight: 700,
        letterSpacing: '0.04em',
        color: lab ? meta.hue : meta.hue,
        background: `${meta.hue}1a`,
        border: `1px solid ${meta.hue}40`,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}