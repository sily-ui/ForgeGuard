import { useMemo } from 'react';
import { Collapse, Typography, theme } from 'antd';

interface Props {
  data: unknown;
  maxHeight?: number;
  collapsed?: boolean;
}

export function JsonViewer({ data, maxHeight = 280, collapsed = false }: Props) {
  const { token } = theme.useToken();
  const text = useMemo(() => {
    try {
      return JSON.stringify(data ?? {}, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  return (
    <Collapse
      ghost
      size="small"
      defaultActiveKey={collapsed ? [] : ['json']}
      items={[{
        key: 'json',
        label: <Typography.Text className="mono">JSON</Typography.Text>,
        extra: <Typography.Text copyable={{ text }} onClick={(event) => event.stopPropagation()} />,
        children: (
          <pre className="mono" style={{ margin: 0, padding: 8, maxHeight, overflow: 'auto', color: token.colorText, background: token.colorFillQuaternary, borderRadius: token.borderRadius, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {text}
          </pre>
        ),
      }]}
    />
  );
}
