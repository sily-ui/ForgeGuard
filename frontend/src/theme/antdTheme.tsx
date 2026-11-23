import { ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import { useLayoutEffect, type ReactNode } from 'react';

const sharedTheme: ThemeConfig = {
  token: {
    fontFamily: "'IBM Plex Sans', 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 14,
    borderRadius: 6,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 8,
    paddingXXS: 8,
    paddingXS: 8,
    paddingSM: 8,
    padding: 16,
    paddingMD: 16,
    paddingLG: 24,
    paddingXL: 32,
    marginXXS: 8,
    marginXS: 8,
    marginSM: 8,
    margin: 16,
    marginMD: 16,
    marginLG: 24,
    marginXL: 32,
    marginXXL: 32,
    controlHeight: 32,
    boxShadow: 'none',
    boxShadowSecondary: 'none',
    boxShadowTertiary: 'none',
  },
  components: {
    Card: { bodyPadding: 16, bodyPaddingSM: 16, headerPadding: 16, headerPaddingSM: 16 },
    Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
    Collapse: { headerPadding: '8px 16px', contentPadding: '16px' },
    Descriptions: { itemPaddingBottom: 8 },
    Form: { itemMarginBottom: 16 },
    Menu: { itemBorderRadius: 6 },
  },
};

export const lightTheme: ThemeConfig = { ...sharedTheme, algorithm: antdTheme.defaultAlgorithm };
export const darkTheme: ThemeConfig = { ...sharedTheme, algorithm: antdTheme.darkAlgorithm };

// CSS 与画布的颜色也来自同一套 Ant Design 派生 token。
function applyColorTokens(element: HTMLElement, config: ThemeConfig) {
  const previous = new Map<string, string>();
  for (const [name, value] of Object.entries(antdTheme.getDesignToken(config))) {
    if (!name.startsWith('color') || typeof value !== 'string') continue;
    const property = `--ant-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    previous.set(property, element.style.getPropertyValue(property));
    element.style.setProperty(property, value);
  }
  return () => {
    for (const [property, value] of previous) {
      if (value) element.style.setProperty(property, value);
      else element.style.removeProperty(property);
    }
  };
}

export function AntdProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => applyColorTokens(document.documentElement, lightTheme), []);
  return <ConfigProvider theme={lightTheme}>{children}</ConfigProvider>;
}

export function LabAntdProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => applyColorTokens(document.body, darkTheme), []);
  return <ConfigProvider theme={darkTheme}>{children}</ConfigProvider>;
}
