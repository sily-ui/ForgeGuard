import { useUiStore } from '@/stores/uiStore';

// 品牌标识：开放的安全边界（对角括角）内，一条攻击路径在边界处被垂直拦截，
// 终止于靶标节点。单色、无渐变，深浅底通用。
export function Logo({ size = 32, withText = false }: { size?: number; withText?: boolean }) {
  const space = useUiStore((s) => s.space);
  const color = space === 'lab' ? '#5fb8a4' : '#176b63';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        <path d="M4 10V4h6" stroke={color} strokeWidth="2.2" />
        <path d="M28 22v6h-6" stroke={color} strokeWidth="2.2" />
        <path d="M26 6 14.5 17.5" stroke={color} strokeWidth="2.2" />
        <path d="M17.5 9.5l5 5" stroke={color} strokeWidth="2.2" />
        <rect x="9.5" y="17.5" width="5" height="5" fill={color} />
      </svg>
      {withText && (
        <span style={{ lineHeight: 1.2 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>
            Agent Security Lab
          </span>
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-text-3)', marginTop: 1 }}>
            智能体安全实验室
          </span>
        </span>
      )}
    </span>
  );
}