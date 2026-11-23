// Nudge 可调项：业务样式以 --site-* 根变量为准，未提供时回落到日档设计 Token 原值。

const FONT_STACK =
  "'IBM Plex Sans', 'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

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
  return {
    bg: rootVar('--site-bg', '#f4f5f2'),
    fg: rootVar('--site-fg', '#1c1f24'),
    accent: rootVar('--site-accent', '#1f6b5e'),
    onAccent: rootVar('--site-on-accent', '#ffffff'),
    surface: rootVar('--site-surface', '#ffffff'),
    muted: rootVar('--site-muted', '#5a6168'),
    border: rootVar('--site-border', '#d9dcd7'),
    font: rootVar('--site-font', FONT_STACK),
    radius: rootNum('--site-radius', 8),
    space: rootNum('--site-space', 1),
    type: rootNum('--site-type', 1),
    motion: rootNum('--site-motion', 1),
  };
}
