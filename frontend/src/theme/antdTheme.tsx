import { ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import { useLayoutEffect, type ReactNode } from 'react';

const fontFamily = "'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif";

const sharedTheme: ThemeConfig = {
  token: {
    fontFamily,
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
    Card: {
      bodyPadding: 16,
      bodyPaddingSM: 16,
      headerPadding: 16,
      headerPaddingSM: 16,
      headerBg: 'transparent',
    },
    Button: {
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      fontWeight: 600,
      defaultBorderColor: '#d9dcd7',
      defaultColor: '#1c1f24',
    },
    Collapse: { headerPadding: '8px 16px', contentPadding: '16px', headerBg: '#ecede8' },
    Descriptions: { itemPaddingBottom: 8, labelBg: '#ecede8' },
    Form: { itemMarginBottom: 16, labelColor: '#5a6168' },
    Menu: { itemBorderRadius: 4, itemBg: 'transparent', subMenuItemBg: 'transparent' },
    Table: { headerBg: '#ecede8', headerColor: '#5a6168', rowHoverBg: '#f4f5f2', borderColor: '#d9dcd7' },
    Tabs: { itemColor: '#5a6168', itemHoverColor: '#1f6b5e', itemSelectedColor: '#1f6b5e', inkBarColor: '#1f6b5e' },
    Input: { activeBorderColor: '#1f6b5e', hoverBorderColor: '#3e8f7e', activeShadow: 'none' },
    Select: { optionSelectedBg: '#e9f0ed', optionSelectedColor: '#12382f' },
    Segmented: { itemSelectedBg: '#ffffff', itemSelectedColor: '#1f6b5e', trackBg: '#ecede8' },
    Tag: { defaultBg: '#ecede8', defaultColor: '#5a6168' },
    Tooltip: { colorBgSpotlight: '#1c1f24' },
    Modal: { headerBg: '#ffffff', contentBg: '#ffffff', footerBg: '#ffffff' },
  },
};

const lightTokens: ThemeConfig['token'] = {
  colorPrimary: '#1f6b5e',
  colorInfo: '#3d6488',
  colorSuccess: '#2e7d5b',
  colorWarning: '#8f6a14',
  colorError: '#a33d3f',
  colorTextBase: '#1c1f24',
  colorBgBase: '#ffffff',
  colorBgLayout: '#f4f5f2',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBorder: '#c9cec8',
  colorBorderSecondary: '#d9dcd7',
  colorFill: '#d9dcd7',
  colorFillSecondary: '#ecede8',
  colorFillTertiary: '#f0f1ed',
  colorFillQuaternary: '#f4f5f2',
};

const darkTokens: ThemeConfig['token'] = {
  colorPrimary: '#6bc7b3',
  colorInfo: '#88a9c7',
  colorSuccess: '#79bf9a',
  colorWarning: '#d2ad62',
  colorError: '#d88486',
  colorTextBase: '#e8e6e0',
  colorBgBase: '#191d22',
  colorBgLayout: '#14171b',
  colorBgContainer: '#1c2026',
  colorBgElevated: '#20252c',
  colorBorder: '#3c444d',
  colorBorderSecondary: '#333941',
  colorFill: '#333941',
  colorFillSecondary: '#292f36',
  colorFillTertiary: '#232930',
  colorFillQuaternary: '#20252b',
};

const darkComponents: ThemeConfig['components'] = {
  Card: { headerBg: 'transparent' },
  Button: { defaultBorderColor: '#3c444d', defaultColor: '#e8e6e0' },
  Collapse: { headerBg: '#232930' },
  Descriptions: { labelBg: '#232930' },
  Form: { labelColor: '#9aa1a8' },
  Table: { headerBg: '#232930', headerColor: '#9aa1a8', rowHoverBg: '#252b32', borderColor: '#333941' },
  Tabs: { itemColor: '#9aa1a8', itemHoverColor: '#6bc7b3', itemSelectedColor: '#6bc7b3', inkBarColor: '#6bc7b3' },
  Input: { activeBorderColor: '#6bc7b3', hoverBorderColor: '#6bc7b3', activeShadow: 'none' },
  Select: { optionSelectedBg: '#243b36', optionSelectedColor: '#b8e6da' },
  Segmented: { itemSelectedBg: '#303941', itemSelectedColor: '#b8e6da', trackBg: '#20252b' },
  Tag: { defaultBg: '#292f36', defaultColor: '#9aa1a8' },
  Tooltip: { colorBgSpotlight: '#303941' },
  Modal: { headerBg: '#1c2026', contentBg: '#1c2026', footerBg: '#1c2026' },
};

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: { ...sharedTheme.token, ...lightTokens },
  components: sharedTheme.components,
};
export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: { ...sharedTheme.token, ...darkTokens },
  components: { ...sharedTheme.components, ...darkComponents },
};

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
