import { Check, OctagonX, HelpCircle, Minus, Circle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ACTION_META } from '@/utils/constants';
import { useUiStore } from '@/stores/uiStore';
import { status, type StatusKind } from '@/theme/tokens';

const ICONS: Record<string, typeof Check> = {
  allow: Check,
  block: OctagonX,
  challenge: HelpCircle,
  degrade: Minus,
  limit_block: OctagonX,
  unknown: Circle,
};

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

export function StatusBadge({ action, size = 'md', showText = true, style }: Props) {
  const space = useUiStore((s) => s.space);
  const kind = KIND[action] || 'disabled';
  const c = status(kind, space);
  const Icon = ICONS[action] || Circle;
  const meta = ACTION_META[action] || ACTION_META.unknown;
  const dim = size === 'sm' ? 18 : 22;
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: dim,
        padding: showText ? '0 8px' : 0,
        borderRadius: 6,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.color}33`,
        fontSize: size === 'sm' ? 10.5 : 11.5,
        fontWeight: 600,
        letterSpacing: '0.04em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
      title={meta.verb}
    >
      <Icon size={size === 'sm' ? 11 : 13} strokeWidth={2} />
      {showText && meta.label}
    </span>
  );
}