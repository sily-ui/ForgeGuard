import { riskToStatus } from '@/utils/constants';
import { status } from '@/theme/tokens';
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
  const kind = riskToStatus(maxRisk);
  const c = status(kind);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, score));
  const offset = circ * (1 - clamped);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} title={`累计风险分 ${score.toFixed(2)}`}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e5e8" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={c.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 400ms ease, stroke 300ms ease' }}
          />
        </svg>
        <span
          className="mono"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(12, size * 0.3),
            fontWeight: 600,
            color: c.text,
          }}
        >
          {score.toFixed(1)}
        </span>
      </div>
      {label && (
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 13, color: 'var(--fg-text-3)' }}>{label}</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: c.text }}>
            {String(maxRisk).toUpperCase()}
          </div>
        </div>
      )}
    </div>
  );
}
