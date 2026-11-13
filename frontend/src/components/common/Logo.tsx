import { useUiStore } from '@/stores/uiStore';

// 品牌标识：盾形监护 + 链路节点，呼应「动态旁路监护」主题。
export function Logo({ size = 32, withText = false }: { size?: number; withText?: boolean }) {
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';
  const primary = lab ? '#6bc7b3' : '#176b63';
  const secondary = lab ? '#4fb0a5' : '#2d9184';
  const id = `fg-grad-${lab ? 'lab' : 'light'}`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor={primary} />
            <stop offset="1" stopColor={secondary} />
          </linearGradient>
        </defs>
        <path
          d="M24 3.5 41 10v12.5c0 10.5-7.2 18.6-17 22-9.8-3.4-17-11.5-17-22V10L24 3.5Z"
          fill={`url(#${id})`}
          opacity="0.16"
        />
        <path
          d="M24 3.5 41 10v12.5c0 10.5-7.2 18.6-17 22-9.8-3.4-17-11.5-17-22V10L24 3.5Z"
          stroke={`url(#${id})`}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="20" r="3" fill={primary} />
        <circle cx="32" cy="20" r="3" fill={secondary} />
        <circle cx="24" cy="32" r="3.4" fill={primary} />
        <path d="M18.6 21.4 22 29M29.4 21.4 26 29M19 20h10" stroke={secondary} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {withText && (
        <span style={{ lineHeight: 1.1 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--fg-text-1)', letterSpacing: '-0.01em' }}>
            Agent Security Lab
          </span>
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-text-3)', letterSpacing: '0.08em' }}>
            智能体安全实验室
          </span>
        </span>
      )}
    </span>
  );
}