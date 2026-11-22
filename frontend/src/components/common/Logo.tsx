// 品牌标识：白盒 Whitebox——档案袋开盖，露出内部的靶心。
// 双重隐喻：白盒测评（看得见内部配置）+ 红队靶标 + 档案世界（档案袋标签）。
// 墨线描边、品牌墨绿点睛，深浅底通用（取当前空间的 Token）。
export function Logo({ size = 32, withText = false }: { size?: number; withText?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        {/* 开盖：档案袋的舌头向上翻开 */}
        <path
          d="M7.5 12.5 L11.5 6.5 L27 8.8 L24.5 12.5"
          stroke="var(--fg-text-1)"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* 盒身 */}
        <path
          d="M7.5 12.5 H24.5 V25.5 A1.5 1.5 0 0 1 23 27 H9 A1.5 1.5 0 0 1 7.5 25.5 Z"
          stroke="var(--fg-text-1)"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* 内部靶心：看得见的被测对象 */}
        <circle cx="16" cy="19.5" r="4.2" stroke="var(--fg-brand-primary)" strokeWidth="1.8" />
        <circle cx="16" cy="19.5" r="1.4" fill="var(--fg-brand-primary)" />
      </svg>
      {withText && (
        <span style={{ lineHeight: 1.2 }}>
          <span
            style={{
              display: 'block',
              fontSize: 16.5,
              fontWeight: 700,
              color: 'var(--fg-text-1)',
              fontFamily: 'var(--fg-font-display)',
              letterSpacing: 0.2,
            }}
          >
            白盒 Whitebox
          </span>
          <span style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-text-3)', marginTop: 1 }}>
            Agent 安全实验室
          </span>
        </span>
      )}
    </span>
  );
}
