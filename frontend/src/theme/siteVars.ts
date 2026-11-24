import { theme } from 'antd';

const FONT_STACK =
  "'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif";

function rootVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length ? value : fallback;
}

function rootNum(name: string, fallback: number): number {
  const parsed = parseFloat(rootVar(name, String(fallback)));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface SiteVars {
  bg: string;
  fg: string;
  accent: string;
  onAccent: string;
  surface: string;
  muted: string;
  border: string;
  font: string;
  radius: number;
  space: number;
  type: number;
  motion: number;
}

export function readSiteVars(): SiteVars {
  const token = theme.getDesignToken();
  return {
    bg: token.colorBgLayout,
    fg: token.colorText,
    accent: token.colorPrimary,
    onAccent: token.colorTextLightSolid,
    surface: token.colorBgContainer,
    muted: token.colorTextSecondary,
    border: token.colorBorderSecondary,
    font: rootVar('--site-font', FONT_STACK),
    radius: Math.min(8, rootNum('--site-radius', 8)),
    space: 1,
    type: rootNum('--site-type', 1),
    motion: rootNum('--site-motion', 1),
  };
}
