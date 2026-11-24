import type { CSSProperties } from 'react';

// 档号：业务对象的全局身份，JetBrains Mono，贯穿导航、状态带、卡片与报告。
interface Props {
  no: string;
  label?: string;
  style?: CSSProperties;
}

export function DossierNo({ no, label, style }: Props) {
  return (
    <span
      className="mono"
      title={label ?? `档号 ${no}`}
      style={{
        fontSize: 11,
        letterSpacing: 0.5,
        color: 'var(--bb-brand-deep)',
        background: 'var(--bb-bg-brand)',
        border: '1px solid color-mix(in srgb, var(--bb-brand-primary) 22%, transparent)',
        borderRadius: 2,
        padding: '0 5px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {no}
    </span>
  );
}
