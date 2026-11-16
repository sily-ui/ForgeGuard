// 设计 Token 的 TS 镜像，供 X6 节点、图表、内联样式使用（与 CSS 变量保持一致）。
export const statusColor = {
  allow: { light: '#2e7d5b', lab: '#4cb88a' },
  observe: { light: '#c2892b', lab: '#d9a441' },
  block: { light: '#b5484d', lab: '#e0686d' },
  info: { light: '#4f7ba6', lab: '#7aa3c8' },
  disabled: { light: '#97a1a8', lab: '#5d6871' },
} as const;

export const statusText = {
  allow: { light: '#256b4d', lab: '#4cb88a' },
  observe: { light: '#8f6a14', lab: '#d9a441' },
  block: { light: '#a33d43', lab: '#e0686d' },
  info: { light: '#3d6488', lab: '#7aa3c8' },
  disabled: { light: '#97a1a8', lab: '#5d6871' },
} as const;

export const statusBg = {
  allow: { light: '#e9f2ed', lab: 'rgba(76,184,138,0.12)' },
  observe: { light: '#f7efdc', lab: 'rgba(217,164,65,0.12)' },
  block: { light: '#f6e9ea', lab: 'rgba(224,104,109,0.12)' },
  info: { light: '#e9eff5', lab: 'rgba(122,163,200,0.12)' },
  disabled: { light: '#eef0f2', lab: 'rgba(93,104,113,0.14)' },
} as const;

export type StatusKind = keyof typeof statusColor;
export type Space = 'light' | 'lab';

export function status(kind: StatusKind, space: Space = 'light') {
  return {
    color: statusColor[kind][space],
    text: statusText[kind][space],
    bg: statusBg[kind][space],
  };
}

export const chartPalette = {
  light: ['#176b63', '#4f7ba6', '#c2892b', '#b5484d', '#64748b', '#6a8f5f', '#4fb0a5', '#97a1a8'],
  lab: ['#5fb8a4', '#7aa3c8', '#d9a441', '#e0686d', '#a3b1bf', '#7fae7a', '#4fb0a5', '#6e7984'],
} as const;

export const brand = {
  light: { primary: '#176b63', secondary: '#2d9184', light: '#e7f0ee', deep: '#113c38' },
  lab: { primary: '#5fb8a4', secondary: '#4fb0a5', light: '#1d3532', deep: '#0f1a18' },
} as const;

export const surface = {
  light: { page: '#f4f5f6', card: '#ffffff', subtle: '#eef0f2', border: '#e2e5e8', text1: '#1e2429', text2: '#5b6570', text3: '#8d97a1' },
  lab: { page: '#15181d', card: '#1d222a', subtle: '#191e25', border: '#2b323c', text1: '#e7eaed', text2: '#9aa4ae', text3: '#6e7984' },
} as const;

// 判定动作 → 状态色语义
export const actionToStatus: Record<string, StatusKind> = {
  allow: 'allow',
  block: 'block',
  challenge: 'observe',
  degrade: 'observe',
  unknown: 'disabled',
};

// 风险等级 → 状态色语义
export const riskToStatus: Record<string, StatusKind> = {
  none: 'allow',
  low: 'allow',
  medium: 'observe',
  high: 'block',
  critical: 'block',
  none_risk: 'allow',
};

export const radius = { sm: 8, md: 12, lg: 16 } as const;