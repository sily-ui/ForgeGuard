import { theme as antdTheme, ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { useUiStore } from '@/stores/uiStore';

const shared = {
  borderRadius: 8,
  fontSize: 14,
  fontFamily:
    "'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  controlHeight: 34,
  wireframe: false,
};

const lightToken = {
  ...shared,
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

const labToken = {
  ...shared,
  colorPrimary: '#5fb8a4',
  colorInfo: '#7aa3c8',
  colorSuccess: '#4cb88a',
  colorWarning: '#d9a441',
  colorError: '#e0686d',
  colorTextBase: '#e7eaed',
  colorBgLayout: '#15181d',
  colorBgContainer: '#191e25',
  colorBgElevated: '#1d222a',
  colorBorder: '#2b323c',
  colorBorderSecondary: '#232a33',
  colorLink: '#5fb8a4',
};

export function AntdProvider({ children }: { children: ReactNode }) {
  const space = useUiStore((s) => s.space);
  const isLab = space === 'lab';
  return (
    <ConfigProvider
      theme={{
        algorithm: isLab ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: isLab ? labToken : lightToken,
        components: {
          Card: { borderRadiusLG: 12 },
          Button: { primaryShadow: 'none', defaultShadow: 'none' },
          Table: { headerBg: isLab ? '#191e25' : '#f4f5f6', rowHoverBg: isLab ? '#1d222a' : '#f4f5f6' },
          Menu: { itemBorderRadius: 8 },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}