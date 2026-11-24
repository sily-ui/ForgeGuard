import type { CSSProperties, ReactNode } from 'react';
import { Card } from 'antd';

interface Props {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  noBorder?: boolean;
}

export function SectionCard({ title, extra, children, padding = 16, style, bodyStyle, noBorder }: Props) {
  const spacing = typeof padding === 'number' ? Math.min(32, Math.max(0, Math.round(padding / 8) * 8)) : 16;
  return (
    <Card
      className="bb-section-card"
      size="small"
      variant="borderless"
      title={title}
      extra={extra}
      style={{ ...style, ...(noBorder ? { background: 'transparent' } : {}) }}
      styles={{ body: { padding: spacing, ...bodyStyle } }}
    >
      {children}
    </Card>
  );
}
