import type { CSSProperties } from 'react';

// 判定章：双线方框 + 状态文字，-12° 旋转。颜色与状态语义一一对应，是全平台的签名图形。
export type StampKind = 'allow' | 'block' | 'challenge' | 'degrade' | 'info' | 'live' | 'replay';

const KIND_COLOR: Record<StampKind, string> = {
  allow: 'var(--fg-allow)',
  block: 'var(--fg-block)',
  challenge: 'var(--fg-observe)',
  degrade: 'var(--fg-observe)',
  info: 'var(--fg-info)',
  live: 'var(--fg-brand-primary)',
  replay: 'var(--fg-observe)',
};

const KIND_LABEL: Record<StampKind, string> = {
  allow: 'ALLOW · 放行',
  block: 'BLOCK · 拦截',
  challenge: 'CHALLENGE · 质询',
  degrade: 'DEGRADE · 降级',
  info: 'INFO · 处理中',
  live: 'LIVE · 实时',
  replay: 'REPLAY · 回放',
};

interface Props {
  kind: StampKind;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean; // 落印：一次落入 + 墨晕扩散，不循环
  style?: CSSProperties;
}

export function StampBadge({ kind, label, size = 'md', animate = false, style }: Props) {
  const color = KIND_COLOR[kind];
  const dim = size === 'sm' ? 22 : size === 'lg' ? 34 : 27;
  const fontSize = size === 'sm' ? 10 : size === 'lg' ? 13 : 11.5;
  const dashed = kind === 'replay';

  return (
    <span
      title={label ?? KIND_LABEL[kind]}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        height: dim,
        padding: '0 8px',
        border: `2px solid ${color}`,
        borderRadius: 6,
        outline: `1px solid ${color}`,
        outlineOffset: 2,
        borderStyle: dashed ? 'dashed' : 'solid',
        color: color,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 700,
        fontSize,
        letterSpacing: 0.5,
        whiteSpace: 'nowrap',
        background: 'transparent',
        transform: 'rotate(-12deg)',
        animation: animate ? 'fg-stamp-press 350ms cubic-bezier(0.16, 0.84, 0.3, 1.04) both' : undefined,
        ...style,
      }}
    >
      {label ?? KIND_LABEL[kind]}
    </span>
  );
}

// 落印时的墨晕扩散（一次性，包裹在判定章外层）。
export function StampInk({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 8,
        background: color,
        opacity: 0,
        animation: 'fg-stamp-ink 420ms ease-out 120ms both',
        pointerEvents: 'none',
        ...style,
      }}
    />
  );
}
