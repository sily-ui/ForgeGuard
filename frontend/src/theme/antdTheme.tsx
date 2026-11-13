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
  colorInfo: '#5689b8',
  colorSuccess: '#2b9477',
  colorWarning: '#d69a43',
  colorError: '#d85f63',
  colorTextBase: '#20312f',
  colorBgLayout: '#f4f7f6',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBorder: '#e2eae7',
  colorBorderSecondary: '#eef3f1',
  colorLink: '#176b63',
};

const labToken = {
  ...shared,
  colorPrimary: '#6bc7b3',
  colorInfo: '#7faed9',
  colorSuccess: '#4fd1a8',
  colorWarning: '#e8b45a',
  colorError: '#f0787c',
  colorTextBase: '#e8f0ee',
  colorBgLayout: '#111c23',
  colorBgContainer: '#192831',
  colorBgElevated: '#20333c',
  colorBorder: '#30434a',
  colorBorderSecondary: '#263a42',
  colorLink: '#6bc7b3',
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
          Table: { headerBg: isLab ? '#192831' : '#f4f7f6', rowHoverBg: isLab ? '#20333c' : '#f4f7f6' },
          Menu: { itemBorderRadius: 8 },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}