// 品牌标识：越界之前 BeforeBound——Agent 在检查站前停步，箭头止于边界。
// 隐喻：虚线是「界」，机器方体是被监护的 Agent，品牌绿菱形是检查站判决符——越界之前先被看见。
// 墨线描边、品牌墨绿点睛，深浅底通用（取当前空间的 Token）。
export function Logo({ size = 32, withText = false }: { size?: number; withText?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        {/* 被监护的 Agent：机器方体 + 目光 */}
        <rect x="5.8" y="12.8" width="6.4" height="6.4" rx="1.9" stroke="var(--bb-text-1)" strokeWidth="1.8" />
        <circle cx="9" cy="16" r="1.25" fill="var(--bb-brand-primary)" />
        {/* 接近的箭头：止于检查站之前 */}
        <path d="M14.8 16 H17.6" stroke="var(--bb-text-1)" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="M16 13.9 L18.4 16 L16 18.1"
          stroke="var(--bb-text-1)"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* 检查站：立在边界线上的品牌绿判决符 */}
        <path
          d="M22.7 12.8 L25.9 16 L22.7 19.2 L19.5 16 Z"
          stroke="var(--bb-brand-primary)"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="22.7" cy="16" r="0.9" fill="var(--bb-brand-primary)" />
        {/* 界：上下两段虚线边界 */}
        <path
          d="M22.7 5.4 V11.5 M22.7 20.5 V26.6"
          stroke="var(--bb-text-1)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="2.6 2.3"
        />
      </svg>
      {withText && (
        <span style={{ lineHeight: 1.2 }}>
          <span
            style={{
              display: 'block',
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--bb-text-1)',
              fontFamily: 'var(--bb-font-display)',
              letterSpacing: 0.2,
              whiteSpace: 'nowrap',
            }}
          >
            越界之前 BeforeBound
          </span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--bb-text-3)', marginTop: 1 }}>
            Agent 安全实验室
          </span>
        </span>
      )}
    </span>
  );
}
