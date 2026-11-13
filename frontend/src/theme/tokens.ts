// 设计 Token 的 TS 镜像，供 X6 节点、图表、内联样式使用（与 CSS 变量保持一致）。
export const statusColor = {
  allow: { light: '#2b9477', lab: '#4fd1a8' },
  observe: { light: '#d69a43', lab: '#e8b45a' },
  block: { light: '#d85f63', lab: '#f0787c' },
  info: { light: '#5689b8', lab: '#7faed9' },
  disabled: { light: '#9aa7a3', lab: '#5d6f6b' },
} as const;

export const statusText = {
  allow: { light: '#1f7a5f', lab: '#4fd1a8' },
  observe: { light: '#a9781f', lab: '#e8b45a' },
  block: { light: '#c24a4f', lab: '#f0787c' },
  info: { light: '#3f6f9c', lab: '#7faed9' },
  disabled: { light: '#9aa7a3', lab: '#5d6f6b' },
} as const;

export const statusBg = {
  allow: { light: '#e6f4ef', lab: 'rgba(79,209,168,0.12)' },
  observe: { light: '#faf0dd', lab: 'rgba(232,180,90,0.12)' },
  block: { light: '#fbe9ea', lab: 'rgba(240,120,124,0.12)' },
  info: { light: '#e8f0f8', lab: 'rgba(127,174,217,0.12)' },
  disabled: { light: '#edf2f1', lab: 'rgba(93,111,107,0.14)' },
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
  light: ['#176b63', '#2d9184', '#5689b8', '#d69a43', '#d85f63', '#7c6bb8', '#4fb0a5', '#9aa7a3'],
  lab: ['#6bc7b3', '#4fb0a5', '#7faed9', '#e8b45a', '#f0787c', '#a99be0', '#5fd0c8', '#91a5a1'],
} as const;

export const brand = {
  light: { primary: '#176b63', secondary: '#2d9184', light: '#e4f2ef', deep: '#123f3c' },
  lab: { primary: '#6bc7b3', secondary: '#4fb0a5', light: '#1d3a3a', deep: '#0d1a20' },
} as const;

export const surface = {
  light: { page: '#f4f7f6', card: '#ffffff', subtle: '#edf2f1', border: '#e2eae7', text1: '#20312f', text2: '#71817d', text3: '#9aa7a3' },
  lab: { page: '#111c23', card: '#20333c', subtle: '#192831', border: '#30434a', text1: '#e8f0ee', text2: '#91a5a1', text3: '#6b7e7a' },
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