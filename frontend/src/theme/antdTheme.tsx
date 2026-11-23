import { theme as antdTheme, ConfigProvider } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { readSiteVars, type SiteVars } from './siteVars';

// antd 是 JS Token 驱动的，CSS 变量层管不到它；这里把同一组 --site-* 变量喂给 ConfigProvider，
// 两套 Provider 的兜底值与日档/夜档原样式保持一致，未调参时画面无变化。
const round = (value: number) => Math.round(value);

function scale(site: SiteVars) {
  return {
    fontSize: round(14 * site.type),
    fontFamily: site.font,
    borderRadius: Math.max(0, round(site.radius - 2)),
    padding: round(16 * site.space),
    paddingSM: round(12 * site.space),
    paddingLG: round(24 * site.space),
    margin: round(16 * site.space),
    marginSM: round(12 * site.space),
    marginLG: round(24 * site.space),
    controlHeight: 36,
    wireframe: false,
    motionDurationFast: `${round(100 * site.motion)}ms`,
    motionDurationMid: `${round(200 * site.motion)}ms`,
    motionDurationSlow: `${round(300 * site.motion)}ms`,
  };
}

function shape(site: SiteVars) {
  const lg = Math.max(0, round(site.radius + 2));
  return {
    Card: { borderRadiusLG: lg },
    Button: { primaryShadow: 'none', defaultShadow: 'none' },
    Menu: { itemBorderRadius: Math.max(0, round(site.radius - 2)) },
    Tag: { borderRadiusSM: Math.max(0, round(site.radius - 3)) },
    Modal: { borderRadiusLG: lg },
  };
}

function useSite(): SiteVars {
  return useMemo(() => readSiteVars(), []);
}

export function AntdProvider({ children }: { children: ReactNode }) {
  const site = useSite();
  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          ...scale(site),
          colorInfo: '#3d6488',
          colorSuccess: '#2e7d5b',
          colorWarning: '#8f6a14',
          colorError: '#a33d3f',
          colorPrimary: site.accent,
          colorTextBase: site.fg,
          colorBgLayout: site.bg,
          colorBgContainer: site.surface,
          colorBgElevated: site.surface,
          colorBorder: site.border,
          colorBorderSecondary: '#ecede8',
          colorLink: site.accent,
        },
        components: {
          ...shape(site),
          Table: { headerBg: '#ecede8', rowHoverBg: site.bg },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

// 实验舱夜档：配色跟随深色空间，尺寸/字体/圆角/动效仍吃同一组站点变量。
export function LabAntdProvider({ children }: { children: ReactNode }) {
  const site = useSite();
  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: {
          ...scale(site),
          colorPrimary: '#6bc7b3',
          colorInfo: '#7fa8c9',
          colorTextBase: '#e8e6e0',
          colorBgLayout: '#14171b',
          colorBgContainer: '#1c2026',
          colorBgElevated: '#232830',
          colorBorder: '#333941',
          colorBorderSecondary: '#2a3038',
          colorLink: '#6bc7b3',
        },
        components: {
          ...shape(site),
          Table: { headerBg: '#191d22', rowHoverBg: '#232830' },
          Modal: { ...shape(site).Modal, contentBg: '#1c2026', headerBg: '#1c2026' },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
