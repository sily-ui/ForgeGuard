import { Check, HelpCircle, Minus } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ACTION_META } from '@/utils/constants';
import { status, type StatusKind } from '@/theme/tokens';
import { BlockIcon } from '@/components/icons/SecurityIcons';

const KIND: Record<string, StatusKind> = {
  allow: 'allow',
  block: 'block',
  challenge: 'observe',
  degrade: 'observe',
  limit_block: 'block',
  unknown: 'disabled',
};

interface Props {
  action: string;
  size?: 'sm' | 'md';
  showText?: boolean;
  style?: CSSProperties;
}

// 判定结果：常规动作用「状态点 + 文字」，仅阻断类使用强色底强调。
export function StatusBadge({ action, size = 'md', showText = true, style }: Props) {
  const kind = KIND[action] || 'disabled';
  const c = status(kind);
  const meta = ACTION_META[action] || ACTION_META.unknown;
  const strong = kind === 'block';
  const dim = size === 'sm' ? 18 : 22;
  const iconSize = size === 'sm' ? 11 : 13;

  if (!showText) {
    return (
      <span
        title={meta.verb}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: dim, height: dim, color: c.text, ...style }}
      >
        {strong ? <BlockIcon size={iconSize} strokeWidth={1.8} /> : <Dot color={c.color} />}
      </span>
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: dim,
        padding: strong ? '0 8px' : 0,
        borderRadius: 4,
        background: strong ? c.bg : 'transparent',
        color: c.text,
        fontSize: size === 'sm' ? 12 : 13,
        fontWeight: strong ? 600 : 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
      title={meta.verb}
    >
      {strong ? (
        <BlockIcon size={iconSize} strokeWidth={1.8} />
      ) : action === 'allow' ? (
        <Check size={iconSize} strokeWidth={1.8} />
      ) : action === 'challenge' ? (
        <HelpCircle size={iconSize} strokeWidth={1.8} />
      ) : action === 'degrade' ? (
        <Minus size={iconSize} strokeWidth={1.8} />
      ) : (
        <Dot color={c.color} />
      )}
      {meta.label}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />;
}