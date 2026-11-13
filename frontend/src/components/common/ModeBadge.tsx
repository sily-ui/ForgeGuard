import { Radio, History } from 'lucide-react';
import type { Mode } from '@/types/api';
import { useUiStore } from '@/stores/uiStore';

// 运行模式徽标：LIVE 品牌色实时，REPLAY 琥珀色回放，必须可区分。
export function ModeBadge({ mode, size = 'md' }: { mode: Mode; size?: 'sm' | 'md' }) {
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';
  const replay = mode === 'replay';
  const color = replay ? (lab ? '#e8b45a' : '#a9781f') : lab ? '#6bc7b3' : '#176b63';
  const bg = replay ? (lab ? 'rgba(232,180,90,0.12)' : '#faf0dd') : lab ? 'rgba(107,199,179,0.12)' : '#e4f2ef';
  const Icon = replay ? History : Radio;
  const dim = size === 'sm' ? 18 : 22;
  return (
    <span
      className="mono"
      title={replay ? '快照回放模式：结论来自录制数据' : '实时模式：实时模型判定'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: dim,
        padding: '0 8px',
        borderRadius: 6,
        fontSize: size === 'sm' ? 10 : 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color,
        background: bg,
        border: `1px solid ${color}33`,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={size === 'sm' ? 10 : 12} strokeWidth={2} className={replay ? '' : 'fg-breathe'} />
      {replay ? 'REPLAY' : 'LIVE'}
    </span>
  );
}