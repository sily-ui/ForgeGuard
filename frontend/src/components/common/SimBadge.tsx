import { FlaskConical } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

// 仿真标记：所有工具调用均为内存仿真，必须始终可见。
export function SimBadge({ compact = false }: { compact?: boolean }) {
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';
  return (
    <span
      className="mono"
      title="全部工具调用为内存仿真，不触及真实系统"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: compact ? 18 : 22,
        padding: '0 7px',
        borderRadius: 6,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        color: lab ? '#7faed9' : '#3f6f9c',
        background: lab ? 'rgba(127,174,217,0.12)' : '#e8f0f8',
        border: `1px solid ${lab ? 'rgba(127,174,217,0.3)' : '#5689b833'}`,
        whiteSpace: 'nowrap',
      }}
    >
      <FlaskConical size={compact ? 10 : 12} strokeWidth={1.8} />
      SIM
    </span>
  );
}