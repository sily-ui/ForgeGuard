import { Switch, Tooltip, Progress } from 'antd';
import { AlertCircle } from 'lucide-react';
import { ModeBadge } from '@/components/common/ModeBadge';
import { SimBadge } from '@/components/common/SimBadge';
import { RiskRing } from '@/components/common/RiskRing';
import { PresetTag } from '@/components/common/PresetTag';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { useSessionStore } from '@/stores/sessionStore';
import { useQuotaStore } from '@/stores/quotaStore';
import { percent } from '@/utils/format';

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
  const quotaError = useQuotaStore((s) => s.error);
  const refreshQuota = useQuotaStore((s) => s.refresh);
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
        <span
          style={{
            display: 'inline-flex',
            color: guardOn ? 'var(--fg-allow-text)' : 'var(--fg-block-text)',
            flexShrink: 0,
          }}
          title={guardOn ? '旁路监护运行中' : '旁路监护已关闭'}
        >
          <GuardIcon size={20} strokeWidth={1.5} />
        </span>
        <div style={{ minWidth: 0, lineHeight: 1.25 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
            {session?.instance_name || '攻防控制台'}
          </div>
          <div className="mono" style={{ fontSize: 12.5, color: 'var(--fg-text-3)' }}>
            {session?.session_id || '—'}
          </div>
        </div>
      </div>

      <div className="fg-topbar-guard" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Tooltip title={guardOn ? '旁路监护已启用，实时判定每次工具调用' : '防护已关闭（对照演示），调用不再被判定'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 9, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', color: guardOn ? 'var(--fg-allow-text)' : 'var(--fg-block-text)' }}>
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
        <PresetTag preset={preset} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <RiskRing score={session?.risk_score ?? 0} maxRisk={session?.max_risk ?? 'none'} size={40} stroke={4} />
        <Tooltip title={quota ? `全局今日 ${quota.global_used_calls}/${quota.global_max_calls} 次模型调用` : '模型配额'}>
          <div style={{ width: 92 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--fg-text-3)', marginBottom: 3 }}>
              <span>配额</span>
              <span className="mono">{globalPct}%</span>
            </div>
            <Progress
              percent={globalPct}
              size="small"
              showInfo={false}
              strokeColor={globalPct > 85 ? 'var(--fg-block)' : globalPct > 60 ? 'var(--fg-observe)' : 'var(--fg-brand-primary)'}
              trailColor="#e2e5e8"
            />
          </div>
        </Tooltip>
        {quotaError && (
          <Tooltip title={`配额加载失败：${quotaError}（点击重试）`}>
            <button
              onClick={() => refreshQuota()}
              aria-label="重试加载配额"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: 4,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--fg-block)',
              }}
            >
              <AlertCircle size={15} />
            </button>
          </Tooltip>
        )}
        <ModeBadge mode={mode} />
        <SimBadge />
      </div>
    </header>
  );
}