import type { CSSProperties } from 'react';

// 骑缝条：卷宗左侧的装订斜纹条，竖排档号。表示"这是一卷完整的案卷"。
interface Props {
  no: string;
  width?: number;
  style?: CSSProperties;
}

export function DossierSpine({ no, width = 34, style }: Props) {
  return (
    <div
      aria-hidden
      style={{
        width,
        flexShrink: 0,
        backgroundImage: `repeating-linear-gradient(115deg, var(--bb-spine-1) 0 6px, var(--bb-spine-2) 6px 12px)`,
        borderRight: '1px solid var(--bb-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <span
        className="mono"
        style={{
          writingMode: 'vertical-rl',
          fontSize: 9.5,
          letterSpacing: 1,
          color: 'var(--bb-text-3)',
          fontWeight: 500,
        }}
      >
        骑缝 {no}
      </span>
    </div>
  );
}
