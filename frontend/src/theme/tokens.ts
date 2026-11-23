export const brand = {
  primary: 'var(--ant-color-primary)',
  secondary: 'var(--ant-color-primary-hover)',
  light: 'var(--ant-color-primary-bg)',
  deep: 'var(--ant-color-primary-text-active)',
} as const;

export const statusColor = {
  allow: 'var(--ant-color-success)',
  observe: 'var(--ant-color-warning)',
  block: 'var(--ant-color-error)',
  info: 'var(--ant-color-info)',
  disabled: 'var(--ant-color-text-disabled)',
} as const;

export const statusText = {
  allow: 'var(--ant-color-success-text)',
  observe: 'var(--ant-color-warning-text)',
  block: 'var(--ant-color-error-text)',
  info: 'var(--ant-color-info-text)',
  disabled: 'var(--ant-color-text-disabled)',
} as const;

export const statusBg = {
  allow: 'var(--ant-color-success-bg)',
  observe: 'var(--ant-color-warning-bg)',
  block: 'var(--ant-color-error-bg)',
  info: 'var(--ant-color-info-bg)',
  disabled: 'var(--ant-color-fill-quaternary)',
} as const;

export type StatusKind = keyof typeof statusColor;

export function status(kind: StatusKind) {
  return {
    color: statusColor[kind],
    text: statusText[kind],
    bg: statusBg[kind],
  };
}

export const radius = { sm: 6, md: 8, lg: 8 } as const;
