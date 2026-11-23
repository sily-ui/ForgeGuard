import { Button, Space, Switch, Tooltip, Progress, Typography } from 'antd';
import { AlertCircle } from 'lucide-react';
import { ModeBadge } from '@/components/common/ModeBadge';
import { SimBadge } from '@/components/common/SimBadge';
import { RiskRing } from '@/components/common/RiskRing';
import { PresetTag } from '@/components/common/PresetTag';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { useSessionStore } from '@/stores/sessionStore';
import { useQuotaStore } from '@/stores/quotaStore';
import { percent } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';

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
  // 游客看自己的每日额度，其余角色看全局额度。
  const guestMax = quota?.guest_max_calls ?? 0;
  const usedCalls = guestMax ? quota?.guest_used_calls ?? 0 : quota?.global_used_calls ?? 0;
  const maxCalls = guestMax || quota?.global_max_calls || 0;
  const usedPct = percent(usedCalls, maxCalls);
  const leftCalls = Math.max(0, maxCalls - usedCalls);

  return (
    <header
      className="bb-topbar"
      style={{
        minHeight: 64,
        flexShrink: 0,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '8px 24px',
        background: 'var(--bb-topbar-bg)',
        borderBottom: '1px solid var(--bb-border)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            display: 'inline-flex',
            color: guardOn ? 'var(--bb-allow-text)' : 'var(--bb-block-text)',
            flexShrink: 0,
          }}
          title={guardOn ? '旁路监护运行中' : '旁路监护已关闭'}
        >
          <GuardIcon size={20} strokeWidth={1.5} />
        </span>
        <div style={{ minWidth: 0, lineHeight: 1.25 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--bb-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
            {session?.instance_name || '攻防控制台'}
          </div>
          <div className="mono" style={{ fontSize: 12.5, color: 'var(--bb-text-3)', display: 'flex', gap: 8, alignItems: 'center' }}>
            {session?.session_id ? (
              <>
                <span>档号 {dossierFromId(session.session_id)}</span>
                <span style={{ opacity: 0.65 }}>{session.session_id.slice(0, 8)}</span>
              </>
            ) : (
              '—'
            )}
          </div>
        </div>
      </div>

      <Space className="bb-topbar-guard" size={8} style={{ flexShrink: 0 }}>
        <Tooltip title={guardOn ? '旁路监护已启用，实时判定每次工具调用' : '防护已关闭（对照演示），调用不再被判定'}>
          <Space size={8}>
            <Typography.Text strong style={{ whiteSpace: 'nowrap', color: guardOn ? 'var(--bb-allow-text)' : 'var(--bb-block-text)' }}>
              {guardOn ? '监护开启' : '监护关闭'}
            </Typography.Text>
            <Switch
              size="small"
              aria-label="旁路监护"
              checked={guardOn}
              disabled={guardDisabled || !onToggleGuard}
              onChange={(v) => onToggleGuard?.(v)}
            />
          </Space>
        </Tooltip>
        <PresetTag preset={preset} />
      </Space>

      <div className="bb-topbar-meta" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <RiskRing score={session?.risk_score ?? 0} maxRisk={session?.max_risk ?? 'none'} size={40} stroke={4} />
        <Tooltip
          title={
            guestMax
              ? `游客今日已用 ${usedCalls}/${maxCalls} 次模型调用，剩余 ${leftCalls} 次（每工作区每日上限）`
              : `全局今日 ${usedCalls}/${maxCalls} 次模型调用`
          }
        >
          <div className="bb-topbar-quota" style={{ width: 104 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--bb-text-3)', marginBottom: 0 }}>
              <span>今日额度</span>
              <span className="mono" style={{ color: maxCalls && leftCalls === 0 ? 'var(--bb-block-text)' : undefined }}>
                {usedCalls}/{maxCalls || '—'}
              </span>
            </div>
            <Progress
              percent={usedPct}
              size="small"
              showInfo={false}
              strokeColor={usedPct > 85 ? 'var(--bb-block)' : usedPct > 60 ? 'var(--bb-observe)' : 'var(--bb-brand-primary)'}
              trailColor="var(--bb-border)"
              style={{ margin: 0 }}
            />
          </div>
        </Tooltip>
        {quotaError && (
          <Tooltip title={`配额加载失败：${quotaError}（点击重试）`}>
            <Button
              type="text"
              danger
              size="small"
              onClick={() => refreshQuota()}
              aria-label="重试加载配额"
              icon={<AlertCircle size={16} />}
              style={{ padding: 0 }}
            />
          </Tooltip>
        )}
        <ModeBadge mode={mode} />
        <SimBadge />
      </div>
    </header>
  );
}