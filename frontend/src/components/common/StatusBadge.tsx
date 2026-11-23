import { Badge, Tag, Tooltip } from 'antd';
import type { CSSProperties } from 'react';
import { ACTION_META } from '@/utils/constants';

const ACTION_STATUS: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  allow: 'success',
  block: 'error',
  challenge: 'warning',
  degrade: 'warning',
  limit_block: 'error',
  unknown: 'default',
};

interface Props {
  action: string;
  size?: 'sm' | 'md';
  showText?: boolean;
  style?: CSSProperties;
}

export function StatusBadge({ action, size = 'md', showText = true, style }: Props) {
  const status = ACTION_STATUS[action] || 'default';
  const meta = ACTION_META[action] || ACTION_META.unknown;
  const dim = size === 'sm' ? 20 : 24;

  return (
    <Tooltip title={meta.verb}>
      {showText ? (
        <Tag
          color={status}
          style={{
            marginInlineEnd: 0,
            padding: '0 8px',
            fontSize: size === 'sm' ? 12 : 13,
            lineHeight: `${dim - 2}px`,
            whiteSpace: 'nowrap',
            ...style,
          }}
        >
          {meta.label}
        </Tag>
      ) : (
        <span
          role="img"
          aria-label={meta.verb}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: dim,
            height: dim,
            ...style,
          }}
        >
          <Badge status={status} />
        </span>
      )}
    </Tooltip>
  );
}
