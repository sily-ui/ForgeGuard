import type { ReactNode } from 'react';
import { Button } from 'antd';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, actionLabel, onAction, compact }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: compact ? '20px 16px' : '40px 24px',
        gap: 10,
        color: 'var(--fg-text-3)',
      }}
    >
      {icon && (
        <div
          style={{
            width: compact ? 40 : 56,
            height: compact ? 40 : 56,
            borderRadius: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--fg-bg-subtle)',
            border: '1px solid var(--fg-border)',
            color: 'var(--fg-text-2)',
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ fontSize: compact ? 13 : 15, fontWeight: 600, color: 'var(--fg-text-2)' }}>{title}</div>
      {description && <div style={{ fontSize: 13.5, maxWidth: 360, lineHeight: 1.6 }}>{description}</div>}
      {actionLabel && onAction && (
        <Button type="primary" size={compact ? 'small' : 'middle'} onClick={onAction} style={{ marginTop: 4 }}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}