// 设计 Token 的 TS 镜像，供 X6 节点、图表、内联样式使用（与 CSS 变量保持一致）。
export const brand = {
  primary: '#1f6b5e',
  secondary: '#3e8f7e',
  light: '#e9f0ed',
  deep: '#12382f',
} as const;

export const statusColor = {
  allow: '#2e7d5b',
  observe: '#8f6a14',
  block: '#a33d3f',
  info: '#3d6488',
  disabled: '#97a1a8',
} as const;

export const statusText = {
  allow: '#256b4d',
  observe: '#7a5a12',
  block: '#8f3338',
  info: '#34557a',
  disabled: '#97a1a8',
} as const;

export const statusBg = {
  allow: '#e9f2ed',
  observe: '#f7efdc',
  block: '#f6e9ea',
  info: '#e9eff5',
  disabled: '#eef0ee',
} as const;

export type StatusKind = keyof typeof statusColor;

export function status(kind: StatusKind) {
  return {
    color: statusColor[kind],
    text: statusText[kind],
    bg: statusBg[kind],
  };
}

export const radius = { sm: 6, md: 8, lg: 10 } as const;
