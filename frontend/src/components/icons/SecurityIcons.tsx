// 核心安全语义专属图标：与品牌标识同源（边界 / 路径 / 拦截 / 节点），
// 区别于通用操作类 Lucide 图标。统一 viewBox 24、stroke 1.5、currentColor。
interface IconProps {
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

function base(size: number | string, strokeWidth: number | string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    'aria-hidden': true,
  } as const;
}

// 攻击：斜向侵入路径 + 箭头
export function AttackIcon({ size = 16, strokeWidth = 1.5, className, style }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className} style={style}>
      <path d="M19 5 9 15" />
      <path d="M9 9.5V15h5.5" />
    </svg>
  );
}

// 阻断：侵入路径被垂直拦截杆截断
export function BlockIcon({ size = 16, strokeWidth = 1.5, className, style }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className} style={style}>
      <path d="M20 4 10 14" />
      <path d="m8 8 8 8" />
      <path d="M10 14l-2 2" opacity="0.55" />
    </svg>
  );
}

// 监护：边界括角 + 受保护节点
export function GuardIcon({ size = 16, strokeWidth = 1.5, className, style }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className} style={style}>
      <path d="M4 8V4h4" />
      <path d="M20 16v4h-4" />
      <rect x="9" y="9" width="6" height="6" />
    </svg>
  );
}

// 取证：记录文档 + 校验行
export function ForensicsIcon({ size = 16, strokeWidth = 1.5, className, style }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className} style={style}>
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v4h4" />
      <path d="M10 12h5" />
      <path d="M10 16h3" />
    </svg>
  );
}