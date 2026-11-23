import { Tag, Tooltip } from 'antd';

const META: Record<string, { label: string; desc: string }> = {
  L1: { label: 'L1', desc: '确定性规则层' },
  L2: { label: 'L2', desc: '注入分类层' },
  L3: { label: 'L3', desc: '语义判定层' },
  skip: { label: 'SKIP', desc: '未启用防护' },
  fallback: { label: 'FALLBACK', desc: '监护降级保守处理' },
};

// 判定来源层：中性小标签，仅降级（fallback）使用警告语义色。
export function JudgeBadge({ judgedBy, size = 'md' }: { judgedBy?: string; size?: 'sm' | 'md' }) {
  const meta = META[judgedBy || ''] || { label: judgedBy || '—', desc: '判定来源' };
  return (
    <Tooltip title={meta.desc}>
      <Tag
        color={judgedBy === 'fallback' ? 'warning' : 'default'}
        style={{
          marginInlineEnd: 0,
          padding: '0 8px',
          fontSize: 12,
          lineHeight: size === 'sm' ? '18px' : '22px',
          whiteSpace: 'nowrap',
        }}
      >
        {meta.label}
      </Tag>
    </Tooltip>
  );
}
