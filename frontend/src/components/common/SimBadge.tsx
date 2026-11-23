import { Tag, Tooltip } from 'antd';

// 仿真标记：所有工具调用均为内存仿真，必须始终可见。
export function SimBadge({ compact = false }: { compact?: boolean }) {
  return (
    <Tooltip title="全部工具调用为内存仿真，不触及真实系统">
      <Tag
        color="processing"
        style={{
          marginInlineEnd: 0,
          padding: '0 8px',
          fontSize: 12,
          lineHeight: compact ? '18px' : '22px',
          whiteSpace: 'nowrap',
        }}
      >
        {compact ? '仿真' : '仿真运行'}
      </Tag>
    </Tooltip>
  );
}
