import { Typography } from 'antd';
import type { CSSProperties } from 'react';

interface Props {
  no: string;
  width?: number;
  style?: CSSProperties;
}

export function DossierSpine({ no, width = 34, style }: Props) {
  return (
    <Typography.Text
      className="mono"
      type="secondary"
      style={{
        width,
        flexShrink: 0,
        display: 'inline-block',
        alignSelf: 'center',
        textAlign: 'center',
        overflowWrap: 'anywhere',
        fontSize: 12,
        ...style,
      }}
    >
      档号 {no}
    </Typography.Text>
  );
}
