import type { CSSProperties, ReactNode } from 'react';

// 线形状态：状态的第二载体。实线=运行/正常，虚线=待定/观察，半线=过期/停用，划线=禁用/已回收。
export type LineVariant = 'solid' | 'dashed' | 'half' | 'strike';

interface Props {
  variant: LineVariant;
  color?: string;
  label?: ReactNode;
  thickness?: number;
  style?: CSSProperties;
}

export function StatusLine({ variant, color = 'var(--bb-text-3)', label, thickness = 3, style }: Props) {
  const lineStyle: CSSProperties = {
    flexShrink: 0,
    borderRadius: 2,
    background: variant === 'strike' ? 'transparent' : color,
    border: variant === 'dashed' ? `${thickness}px dashed ${color}` : undefined,
    height: variant === 'half' ? 2 : thickness,
    position: 'relative',
    width: variant === 'half' ? '70%' : undefined,
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        ...style,
      }}
    >
      <span style={lineStyle}>
        {variant === 'strike' && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(to top right, transparent 47%, ${color} 47%, ${color} 53%, transparent 53%)`,
            }}
          />
        )}
      </span>
      {label !== undefined && (
        <span style={{ fontSize: 12, color: 'var(--bb-text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
      )}
    </span>
  );
}
