import { Tag, Tooltip } from 'antd';
import { PRESET_META } from '@/utils/constants';

const PRESET_COLOR: Record<string, 'success' | 'processing' | 'error' | 'default'> = {
  loose: 'success',
  standard: 'processing',
  strict: 'error',
  custom: 'default',
};

interface Props {
  preset: string;
  size?: 'sm' | 'md';
}

export function PresetTag({ preset, size = 'md' }: Props) {
  const meta = PRESET_META[preset];
  return (
    <Tooltip title={meta?.desc}>
      <Tag
        color={PRESET_COLOR[preset] ?? 'default'}
        style={{
          marginInlineEnd: 0,
          padding: '0 8px',
          fontSize: size === 'sm' ? 12 : 13,
          lineHeight: size === 'sm' ? '18px' : '22px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {meta?.label ?? preset}
      </Tag>
    </Tooltip>
  );
}
