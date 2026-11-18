import { PRESET_META } from '@/utils/constants';
import { statusBg, type StatusKind } from '@/theme/tokens';

// 防护档位 → 语义色：宽松=绿 · 标准=蓝 · 严格=红 · 自定义=灰
const PRESET_KIND: Record<string, StatusKind> = {
  loose: 'allow',
  standard: 'info',
  strict: 'block',
  custom: 'disabled',
};

const PRESET_FG: Record<string, string> = {
  loose: '#256b4d',
  standard: '#3d6488',
  strict: '#a33d43',
  custom: '#6b757e',
};

const PRESET_DOT: Record<string, string> = {
  loose: '#2e7d5b',
  standard: '#4f7ba6',
  strict: '#b5484d',
  custom: '#97a1a8',
};

interface Props {
  preset: string;
  size?: 'sm' | 'md';
}

export function PresetTag({ preset, size = 'md' }: Props) {
  const kind = PRESET_KIND[preset] ?? 'disabled';
  const meta = PRESET_META[preset];
  return (
    <span
      title={meta?.desc}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: size === 'sm' ? 21 : 24,
        padding: '0 8px',
        borderRadius: 5,
        fontSize: size === 'sm' ? 12 : 13,
        fontWeight: 600,
        color: PRESET_FG[preset] ?? PRESET_FG.custom,
        background: statusBg[kind],
        whiteSpace: 'nowrap',
        flexShrink: 0,
        cursor: 'default',
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: PRESET_DOT[preset] ?? PRESET_DOT.custom,
          flexShrink: 0,
        }}
      />
      {meta?.label ?? preset}
    </span>
  );
}
