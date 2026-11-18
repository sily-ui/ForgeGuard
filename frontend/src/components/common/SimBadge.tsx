// 仿真标记：所有工具调用均为内存仿真，必须始终可见。细边框小标签，不做装饰。
export function SimBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title="全部工具调用为内存仿真，不触及真实系统"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: compact ? 20 : 24,
        padding: '0 6px',
        borderRadius: 4,
        fontSize: compact ? 11.5 : 12,
        fontWeight: 500,
        color: '#3d6488',
        border: '1px solid rgba(79,123,166,0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      {compact ? '仿真' : '仿真运行'}
    </span>
  );
}
