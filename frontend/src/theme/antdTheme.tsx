import { theme as antdTheme, ConfigProvider } from 'antd';
import type { ReactNode } from 'react';

const token = {
  borderRadius: 8,
  fontSize: 16,
  fontFamily:
    "'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  controlHeight: 36,
  wireframe: false,
  colorPrimary: '#176b63',
  colorInfo: '#4f7ba6',
  colorSuccess: '#2e7d5b',
  colorWarning: '#c2892b',
  colorError: '#b5484d',
  colorTextBase: '#1e2429',
  colorBgLayout: '#f4f5f6',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBorder: '#e2e5e8',
  colorBorderSecondary: '#eef0f2',
  colorLink: '#176b63',
};

export function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token,
        components: {
          Card: { borderRadiusLG: 12 },
          Button: { primaryShadow: 'none', defaultShadow: 'none' },
          Table: { headerBg: '#f4f5f6', rowHoverBg: '#f4f5f6' },
          Menu: { itemBorderRadius: 8 },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
