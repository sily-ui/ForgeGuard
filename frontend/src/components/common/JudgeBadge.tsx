const META: Record<string, { label: string; desc: string }> = {
  L1: { label: 'L1', desc: '确定性规则层' },
  L2: { label: 'L2', desc: '注入分类层' },
  L3: { label: 'L3', desc: '语义判定层' },
  skip: { label: 'SKIP', desc: '未启用防护' },
  fallback: { label: 'FALLBACK', desc: '监护降级保守处理' },
};

// 判定来源层：中性小标签，仅降级（fallback）用琥珀语义色。
export function JudgeBadge({ judgedBy, size = 'md' }: { judgedBy?: string; size?: 'sm' | 'md' }) {
  const meta = META[judgedBy || ''] || { label: judgedBy || '—', desc: '判定来源' };
  const warn = judgedBy === 'fallback';
  const dim = size === 'sm' ? 19 : 22;
  return (
    <span
      className="mono"
      title={meta.desc}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: dim,
        padding: '0 6px',
        borderRadius: 4,
        fontSize: size === 'sm' ? 11 : 11.5,
        fontWeight: 500,
        color: warn ? '#8f6a14' : 'var(--bb-text-2)',
        background: warn ? '#f7efdc' : 'var(--bb-bg-subtle)',
        border: '1px solid var(--bb-border)',
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}
