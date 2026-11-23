import type { ReactNode } from 'react';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  icon?: ReactNode;
}

export function PageHeader({ title, subtitle, extra, icon }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 20,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
        {icon && <span style={{ display: 'inline-flex', color: 'var(--bb-text-3)', flexShrink: 0 }}>{icon}</span>}
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--bb-text-1)',
              fontFamily: 'var(--bb-font-display)',
              letterSpacing: 0.2,
            }}
          >
            {title}
          </h1>
          {subtitle && <div style={{ fontSize: 14, color: 'var(--bb-text-2)', marginTop: 2, lineHeight: 1.5 }}>{subtitle}</div>}
        </div>
      </div>
      {extra && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{extra}</div>}
    </div>
  );
}