import { Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

// 线形状态：实线=运行/正常，虚线=待定/观察，半线=过期/停用，划线=禁用/已回收。
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
    display: 'block',
    width: variant === 'half' ? 16 : 32,
    borderTop: `${thickness}px ${variant === 'dashed' ? 'dashed' : 'solid'} ${color}`,
    transform: variant === 'strike' ? 'rotate(-15deg)' : undefined,
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
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', width: 32, height: 16, flexShrink: 0 }}>
        <span style={lineStyle} />
      </span>
      {label !== undefined && (
        <Typography.Text type="secondary" ellipsis style={{ fontSize: 12, minWidth: 0 }}>
          {label}
        </Typography.Text>
      )}
    </span>
  );
}
