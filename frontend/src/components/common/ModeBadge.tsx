import type { Mode } from '@/types/api';
import { useUiStore } from '@/stores/uiStore';

// 运行模式：实时 / 回放，用状态点 + 文字区分，不做胶囊装饰。
export function ModeBadge({ mode, size = 'md' }: { mode: Mode; size?: 'sm' | 'md' }) {
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';
  const replay = mode === 'replay';
  const color = replay ? (lab ? '#d9a441' : '#8f6a14') : lab ? '#5fb8a4' : '#176b63';
  const dim = size === 'sm' ? 18 : 22;
  return (
    <span
      title={replay ? '快照回放模式：结论来自录制数据' : '实时模式：实时模型判定'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: dim,
        fontSize: size === 'sm' ? 11 : 12,
        fontWeight: 500,
        color: 'var(--fg-text-2)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {replay ? '回放' : '实时'}
    </span>
  );
}