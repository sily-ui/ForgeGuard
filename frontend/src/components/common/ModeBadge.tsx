import type { Mode } from '@/types/api';
import { StampBadge } from '@/components/common/StampBadge';

// 运行模式：实时 / 回放，以印章呈现——LIVE 实章（墨绿），REPLAY 虚章（墨琥珀，章框虚线）。
// REPLAY 必须始终可见但不刺眼，防止把回放数据误读为实时结果。
export function ModeBadge({ mode, size = 'md' }: { mode: Mode; size?: 'sm' | 'md' }) {
  return <StampBadge kind={mode === 'replay' ? 'replay' : 'live'} size={size} />;
}
