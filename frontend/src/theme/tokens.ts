// 设计 Token 的 TS 镜像，供 X6 节点、图表、内联样式使用（与 CSS 变量保持一致）。
export const statusColor = {
  allow: '#2e7d5b',
  observe: '#c2892b',
  block: '#b5484d',
  info: '#4f7ba6',
  disabled: '#97a1a8',
} as const;

export const statusText = {
  allow: '#256b4d',
  observe: '#8f6a14',
  block: '#a33d43',
  info: '#3d6488',
  disabled: '#97a1a8',
} as const;

export const statusBg = {
  allow: '#e9f2ed',
  observe: '#f7efdc',
  block: '#f6e9ea',
  info: '#e9eff5',
  disabled: '#eef0f2',
} as const;

export type StatusKind = keyof typeof statusColor;

export function status(kind: StatusKind) {
  return {
    color: statusColor[kind],
    text: statusText[kind],
    bg: statusBg[kind],
  };
}

export const radius = { sm: 8, md: 12, lg: 16 } as const;
