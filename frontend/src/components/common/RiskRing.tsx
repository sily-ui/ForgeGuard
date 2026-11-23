import { Progress, Space, Tooltip, Typography, theme } from 'antd';
import { riskToStatus } from '@/utils/constants';
import type { RiskLevel } from '@/types/api';

interface Props {
  score: number;
  maxRisk?: RiskLevel | string;
  size?: number;
  stroke?: number;
  label?: string;
}

// 风险环：累计风险分 + 最高风险等级，颜色随风险语义变化。
export function RiskRing({ score, maxRisk = 'none', size = 44, stroke = 4, label }: Props) {
  const { token } = theme.useToken();
  const kind = riskToStatus(maxRisk);
  const color = {
    allow: token.colorSuccess,
    block: token.colorError,
    observe: token.colorWarning,
    disabled: token.colorTextDisabled,
  }[kind];
  const textColor = {
    allow: token.colorSuccessText,
    block: token.colorErrorText,
    observe: token.colorWarningText,
    disabled: token.colorTextSecondary,
  }[kind];
  const clamped = Math.max(0, Math.min(1, score));

  return (
    <Tooltip title={`累计风险分 ${score.toFixed(2)}`}>
      <Space size={8}>
        <Progress
          type="circle"
          status="normal"
          size={size}
          percent={clamped * 100}
          strokeWidth={(stroke / size) * 100}
          strokeColor={color}
          trailColor={token.colorBorderSecondary}
          format={() => (
            <Typography.Text className="mono" style={{ fontSize: Math.max(12, size * 0.3), fontWeight: 600, color: textColor }}>
              {score.toFixed(1)}
            </Typography.Text>
          )}
        />
        {label && (
          <Space direction="vertical" size={0}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>{label}</Typography.Text>
            <Typography.Text style={{ fontSize: 14, fontWeight: 600, color: textColor }}>
              {String(maxRisk).toUpperCase()}
            </Typography.Text>
          </Space>
        )}
      </Space>
    </Tooltip>
  );
}
