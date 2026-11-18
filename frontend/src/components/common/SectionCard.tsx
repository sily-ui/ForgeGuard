import type { CSSProperties, ReactNode } from 'react';

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
  return (
    <section
      className="fg-card"
      style={{
        border: noBorder ? 'none' : undefined,
        boxShadow: noBorder ? 'none' : undefined,
        background: noBorder ? 'transparent' : undefined,
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title || extra) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--fg-border)',
          }}
        >
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg-text-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {title}
          </div>
          {extra && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{extra}</div>}
        </header>
      )}
      <div style={{ padding, ...bodyStyle }}>{children}</div>
    </section>
  );
}