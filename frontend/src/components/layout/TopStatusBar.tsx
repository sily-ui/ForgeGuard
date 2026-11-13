import { Switch, Tooltip, Progress } from 'antd';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { ModeBadge } from '@/components/common/ModeBadge';
import { SimBadge } from '@/components/common/SimBadge';
import { RiskRing } from '@/components/common/RiskRing';
import { useSessionStore } from '@/stores/sessionStore';
import { useQuotaStore } from '@/stores/quotaStore';
import { PRESET_META } from '@/utils/constants';
import { percent } from '@/utils/format';
import { useUiStore } from '@/stores/uiStore';

interface Props {
  preset?: string;
  onToggleGuard?: (enabled: boolean) => void;
  guardDisabled?: boolean;
}

// 控制台顶栏：靶标身份 + 防护开关 + 风险环 + 配额 + 模式 + SIM。
export function TopStatusBar({ preset = 'standard', onToggleGuard, guardDisabled }: Props) {
  const session = useSessionStore((s) => s.session);
  const mode = useSessionStore((s) => s.mode);
  const quota = useQuotaStore((s) => s.quota);
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';
  const guardOn = session?.guard_enabled ?? true;
  const globalPct = quota ? percent(quota.global_used_calls, quota.global_max_calls) : 0;

  return (
    <header
      className="fg-topbar"
      style={{
        height: 60,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '0 20px',
        background: 'var(--fg-topbar-bg)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--fg-border)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: guardOn ? 'var(--fg-allow-bg)' : 'var(--fg-block-bg)',
            color: guardOn ? 'var(--fg-allow-text)' : 'var(--fg-block-text)',
            flexShrink: 0,
          }}
        >
          {guardOn ? <ShieldCheck size={18} strokeWidth={1.7} /> : <ShieldOff size={18} strokeWidth={1.7} />}
        </div>
        <div style={{ minWidth: 0, lineHeight: 1.25 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
            {session?.instance_name || '攻防控制台'}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-text-3)' }}>
            {session?.session_id || '—'}
          </div>
        </div>
      </div>

      <div className="fg-topbar-guard" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Tooltip title={guardOn ? '旁路监护已启用，实时判定每次工具调用' : '防护已关闭（对照演示），调用不再被判定'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 9, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', color: guardOn ? 'var(--fg-allow-text)' : 'var(--fg-block-text)' }}>
              {guardOn ? '监护开启' : '监护关闭'}
            </span>
            <Switch
              size="small"
              checked={guardOn}
              disabled={guardDisabled || !onToggleGuard}
              onChange={(v) => onToggleGuard?.(v)}
            />
          </div>
        </Tooltip>
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.04em',
            padding: '3px 8px',
            borderRadius: 6,
            color: lab ? '#6bc7b3' : '#176b63',
            background: lab ? 'rgba(107,199,179,0.12)' : '#e4f2ef',
            border: `1px solid ${lab ? 'rgba(107,199,179,0.3)' : '#cfe6e0'}`,
            textTransform: 'uppercase',
          }}
          title={PRESET_META[preset]?.desc}
        >
          {preset}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <RiskRing score={session?.risk_score ?? 0} maxRisk={session?.max_risk ?? 'none'} size={40} stroke={4} />
        <Tooltip title={quota ? `全局今日 ${quota.global_used_calls}/${quota.global_max_calls} 次模型调用` : '模型配额'}>
          <div style={{ width: 92 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-text-3)', marginBottom: 3 }}>
              <span>配额</span>
              <span className="mono">{globalPct}%</span>
            </div>
            <Progress
              percent={globalPct}
              size="small"
              showInfo={false}
              strokeColor={globalPct > 85 ? 'var(--fg-block)' : globalPct > 60 ? 'var(--fg-observe)' : 'var(--fg-brand-primary)'}
              trailColor={lab ? '#30434a' : '#e2eae7'}
            />
          </div>
        </Tooltip>
        <ModeBadge mode={mode} />
        <SimBadge />
      </div>
    </header>
  );
}