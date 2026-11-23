import type { ReactNode } from 'react';
import { Button, Empty, Space, Typography } from 'antd';

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
    <Empty
      image={icon ?? Empty.PRESENTED_IMAGE_SIMPLE}
      style={{ margin: compact ? 16 : 32 }}
      description={
        <Space direction="vertical" size={8}>
          <Typography.Text>{title}</Typography.Text>
          {description && <Typography.Text type="secondary">{description}</Typography.Text>}
        </Space>
      }
    >
      {actionLabel && onAction && <Button type="primary" onClick={onAction}>{actionLabel}</Button>}
    </Empty>
  );
}
