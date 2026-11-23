import type { ReactNode } from 'react';
import { Space, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  icon?: ReactNode;
}

export function PageHeader({ title, subtitle, extra, icon }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
      <Space size={8} align="start" style={{ minWidth: 0 }}>
        {icon && <Typography.Text type="secondary">{icon}</Typography.Text>}
        <Space direction="vertical" size={8} style={{ minWidth: 0 }}>
          <Typography.Title level={1} style={{ margin: 0, fontSize: 22 }}>{title}</Typography.Title>
          {subtitle && <Typography.Text type="secondary"><InfoCircleOutlined style={{ marginRight: 8 }} />{subtitle}</Typography.Text>}
        </Space>
      </Space>
      {extra && <Space size={8} wrap>{extra}</Space>}
    </div>
  );
}
