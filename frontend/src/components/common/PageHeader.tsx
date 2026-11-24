import type { ReactNode } from 'react';
import { Space, Typography } from 'antd';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  icon?: ReactNode;
}

export function PageHeader({ title, subtitle, extra, icon }: Props) {
  return (
    <div className="bb-page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <Space size={10} align="start" style={{ minWidth: 0 }}>
        {icon && <Typography.Text style={{ color: 'var(--bb-brand-primary)', lineHeight: '34px' }}>{icon}</Typography.Text>}
        <Space direction="vertical" size={6} style={{ minWidth: 0 }}>
          <Typography.Title level={1} style={{ margin: 0 }}>{title}</Typography.Title>
          {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
        </Space>
      </Space>
      {extra && <Space size={8} wrap>{extra}</Space>}
    </div>
  );
}
