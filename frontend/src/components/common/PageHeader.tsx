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
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
        {icon && (
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--fg-gradient-brand)',
              color: '#fff',
              flexShrink: 0,
              boxShadow: 'var(--fg-shadow-2)',
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--fg-text-1)', letterSpacing: '-0.01em' }}>
            {title}
          </h1>
          {subtitle && <div style={{ fontSize: 13, color: 'var(--fg-text-2)', marginTop: 3, lineHeight: 1.5 }}>{subtitle}</div>}
        </div>
      </div>
      {extra && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{extra}</div>}
    </div>
  );
}