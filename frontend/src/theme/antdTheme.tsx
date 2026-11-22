import { theme as antdTheme, ConfigProvider } from 'antd';
import type { ReactNode } from 'react';

const token = {
  borderRadius: 6,
  fontSize: 14,
  fontFamily:
    "'IBM Plex Sans', 'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  controlHeight: 36,
  wireframe: false,
  colorPrimary: '#1f6b5e',
  colorInfo: '#3d6488',
  colorSuccess: '#2e7d5b',
  colorWarning: '#8f6a14',
  colorError: '#a33d3f',
  colorTextBase: '#1c1f24',
  colorBgLayout: '#f4f5f2',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBorder: '#d9dcd7',
  colorBorderSecondary: '#ecede8',
  colorLink: '#1f6b5e',
};

export function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token,
        components: {
          Card: { borderRadiusLG: 10 },
          Button: { primaryShadow: 'none', defaultShadow: 'none' },
          Table: { headerBg: '#ecede8', rowHoverBg: '#f4f5f2' },
          Menu: { itemBorderRadius: 6 },
          Tag: { borderRadiusSM: 5 },
          Modal: { borderRadiusLG: 10 },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
