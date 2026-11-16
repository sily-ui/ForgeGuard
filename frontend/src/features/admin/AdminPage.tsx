import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Empty, Input, InputNumber, Segmented, Select, Spin, Table, Tag } from 'antd';
import {
  SlidersHorizontal,
  Gauge,
  Database,
  Trash2,
  KeyRound,
  RefreshCw,
  AlertTriangle,
  Camera,
} from 'lucide-react';
import { adminApi } from '@/services/api/resources';
import { ApiClientError } from '@/services/api/client';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { ModeBadge } from '@/components/common/ModeBadge';
import { confirmAction } from '@/components/common/confirmAction';
import { useAuthStore } from '@/stores/authStore';
import { ACTION_META, actionToStatus } from '@/utils/constants';
import { formatShort, percent } from '@/utils/format';
import type { SnapshotRecording } from '@/types/api';

export default function AdminPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const setMode = useAuthStore((s) => s.setMode);

  const metricsQuery = useQuery({ queryKey: ['admin-metrics'], queryFn: () => adminApi.metrics(), refetchInterval: 15000 });
  const snapshotsQuery = useQuery({ queryKey: ['admin-snapshots'], queryFn: () => adminApi.snapshots(1, 50) });
  const degradationsQuery = useQuery({ queryKey: ['admin-degradations'], queryFn: () => adminApi.degradations() });

  const metrics = metricsQuery.data;
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['admin-snapshots'] });
    queryClient.invalidateQueries({ queryKey: ['admin-degradations'] });
  };

  const err = (e: unknown, fallback: string) => message.error(e instanceof ApiClientError ? e.message : fallback);

  return (
    <div>
      <PageHeader
        icon={<SlidersHorizontal size={20} strokeWidth={1.5} />}
        title="平台管理"
        subtitle="运行指标 · 模型配额 · 实时/回放模式 · 快照录制 · 降级监控 · 清理与令牌"
        extra={
          <>
            {metrics && <ModeBadge mode={metrics.quota.mode} />}
            <Button icon={<RefreshCw size={15} />} onClick={invalidateAll}>刷新</Button>
          </>
        }
      />

      {metricsQuery.isLoading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" /></div>
      ) : metrics ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* 指标卡 */}
          <div data-tour="admin-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <MetricCard label="工具调用" value={metrics.total_calls} />
            <MetricCard label="风险告警" value={metrics.total_alerts} color="var(--fg-observe-text)" />
            <MetricCard label="存活实例" value={metrics.instances_alive} />
            <MetricCard label="活跃会话" value={metrics.sessions_active} />
            <MetricCard label="报告数" value={metrics.reports} />
            <MetricCard label="限流命中" value={metrics.rate_limit_hits} color="var(--fg-block-text)" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
            {/* 分布 */}
            <div data-tour="admin-dist">
            <SectionCard title="判定分布" extra={<Tag style={{ margin: 0 }} className="mono">{metrics.state_backend}</Tag>}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={microLabelStyle}>动作分布</div>
                  <DistBars data={metrics.action_distribution} labelMap={(k) => ACTION_META[k]?.verb ?? k} semantic />
                </div>
                <div>
                  <div style={microLabelStyle}>判定来源</div>
                  <DistBars data={metrics.judged_by_distribution} />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={markBoxStyle}>
                    <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--fg-block-text)' }}>{metrics.false_positive_marks}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-text-3)' }}>误报标注</div>
                  </div>
                  <div style={markBoxStyle}>
                    <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--fg-observe-text)' }}>{metrics.false_negative_marks}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-text-3)' }}>漏报标注</div>
                  </div>
                </div>
              </div>
            </SectionCard>
            </div>

            {/* 配额 + 模式 */}
            <div data-tour="admin-quota" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <QuotaCard quota={metrics.quota} onDone={() => { invalidateAll(); message.success('配额已更新'); }} onError={(e) => err(e, '配额更新失败')} />
              <ModeCard
                currentMode={metrics.quota.mode}
                snapshots={snapshotsQuery.data?.items ?? []}
                onDone={(mode) => { setMode(mode); invalidateAll(); message.success('运行模式已切换'); }}
                onError={(e) => err(e, '模式切换失败')}
              />
            </div>
          </div>

          {/* 快照 */}
          <SnapshotCard
            snapshots={snapshotsQuery.data?.items ?? []}
            loading={snapshotsQuery.isLoading}
            onChanged={() => { invalidateAll(); }}
            onError={(e) => err(e, '快照操作失败')}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
            {/* 降级监控 */}
            <SectionCard title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><AlertTriangle size={15} /> 降级监控</span>} extra={<Tag style={{ margin: 0 }}>{degradationsQuery.data?.total ?? 0}</Tag>}>
              {degradationsQuery.isLoading ? (
                <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
              ) : (degradationsQuery.data?.items.length ?? 0) === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无降级记录，链路健康" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                  {degradationsQuery.data!.items.map((d) => (
                    <div key={d.session_id} style={degRowStyle}>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-text-3)' }}>{d.session_id}</span>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                        {d.degradations.map((x, i) => (
                          <Tag key={i} color="warning" style={{ margin: 0, fontSize: 10, whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', lineHeight: 1.5, padding: '2px 8px', maxWidth: '100%' }}>{x}</Tag>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* 危险操作 */}
            <div data-tour="admin-danger">
            <SectionCard title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--fg-block-text)' }}><Trash2 size={15} /> 危险操作</span>}>
              <DangerZone onChanged={invalidateAll} onError={(e) => err(e, '操作失败')} />
            </SectionCard>
            </div>
          </div>
        </div>
      ) : (
        <Empty description="无法加载平台指标" />
      )}
    </div>
  );
}

function QuotaCard({ quota, onDone, onError }: { quota: { global_used_calls: number; global_max_calls: number; session_used_calls: number; session_max_calls: number }; onDone: () => void; onError: (e: unknown) => void }) {
  const [globalMax, setGlobalMax] = useState(quota.global_max_calls);
  const [sessionMax, setSessionMax] = useState(quota.session_max_calls);
  const mutation = useMutation({
    mutationFn: () => adminApi.adjustQuota({ global_max: globalMax, session_max: sessionMax }),
    onSuccess: onDone,
    onError,
  });
  const gPct = percent(quota.global_used_calls, quota.global_max_calls);
  const sPct = percent(quota.session_used_calls, quota.session_max_calls);
  return (
    <SectionCard title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Gauge size={15} /> 模型配额</span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <QuotaBar label="全局今日" used={quota.global_used_calls} max={quota.global_max_calls} pct={gPct} />
        <QuotaBar label="单会话" used={quota.session_used_calls} max={quota.session_max_calls} pct={sPct} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={fieldLabelStyle}>全局上限</div>
            <InputNumber min={1} value={globalMax} onChange={(v) => setGlobalMax(v ?? quota.global_max_calls)} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={fieldLabelStyle}>会话上限</div>
            <InputNumber min={1} value={sessionMax} onChange={(v) => setSessionMax(v ?? quota.session_max_calls)} style={{ width: '100%' }} />
          </div>
          <Button type="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>调整</Button>
        </div>
      </div>
    </SectionCard>
  );
}

function ModeCard({ currentMode, snapshots, onDone, onError }: { currentMode: 'live' | 'replay'; snapshots: SnapshotRecording[]; onDone: (mode: 'live' | 'replay') => void; onError: (e: unknown) => void }) {
  const [mode, setModeLocal] = useState<'live' | 'replay'>(currentMode);
  const [snapshotId, setSnapshotId] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => adminApi.switchMode({ mode, snapshot_id: mode === 'replay' ? snapshotId : undefined, reason: reason.trim() || undefined }),
    onSuccess: () => onDone(mode),
    onError,
  });
  return (
    <SectionCard title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Database size={15} /> 运行模式</span>} extra={<ModeBadge mode={currentMode} size="sm" />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Segmented
          block
          value={mode}
          onChange={(v) => setModeLocal(v as 'live' | 'replay')}
          options={[
            { label: '实时', value: 'live' },
            { label: '回放', value: 'replay' },
          ]}
        />
        {mode === 'replay' && (
          <div>
            <div style={fieldLabelStyle}>回放快照</div>
            <Select
              value={snapshotId}
              onChange={setSnapshotId}
              placeholder="选择录制快照（留空用最近）"
              style={{ width: '100%' }}
              allowClear
              options={snapshots.map((s) => ({ value: s.snapshot_id, label: `${s.name}（${s.call_count} 调用）` }))}
              notFoundContent="暂无快照，请先录制"
            />
          </div>
        )}
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="切换原因（可选，计入审计）" maxLength={120} />
        <Button type="primary" loading={mutation.isPending} onClick={() => mutation.mutate()} disabled={mode === currentMode}>
          {mode === currentMode ? '当前模式' : `切换到 ${mode === 'live' ? '实时' : '回放'}`}
        </Button>
      </div>
    </SectionCard>
  );
}

function SnapshotCard({ snapshots, loading, onChanged, onError }: { snapshots: SnapshotRecording[]; loading: boolean; onChanged: () => void; onError: (e: unknown) => void }) {
  const { message } = App.useApp();
  const [sessionId, setSessionId] = useState('');
  const [name, setName] = useState('');
  const createMutation = useMutation({
    mutationFn: () => adminApi.createSnapshot(sessionId.trim(), name.trim() || undefined),
    onSuccess: () => { message.success('快照已录制'); setSessionId(''); setName(''); onChanged(); },
    onError,
  });
  return (
    <SectionCard
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Camera size={15} /> 快照录制</span>}
      extra={
        <div style={{ display: 'flex', gap: 8 }}>
          <Input size="small" placeholder="会话 ID" value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ width: 200 }} />
          <Input size="small" placeholder="快照名（可选）" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 150 }} />
          <Button size="small" type="primary" icon={<Camera size={13} />} disabled={!sessionId.trim()} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            录制
          </Button>
        </div>
      }
      padding={0}
    >
      <Table<SnapshotRecording>
        size="small"
        loading={loading}
        dataSource={snapshots}
        rowKey="snapshot_id"
        pagination={false}
        scroll={{ y: 260 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无录制快照" /> }}
        columns={[
          { title: '快照名', dataIndex: 'name', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
          { title: '快照 ID', dataIndex: 'snapshot_id', render: (v: string) => <span className="mono" style={{ fontSize: 11, color: 'var(--fg-text-3)' }}>{v}</span> },
          { title: '会话', dataIndex: 'session_id', render: (v: string) => <span className="mono" style={{ fontSize: 11 }}>{v}</span> },
          { title: '事件', dataIndex: 'event_count', width: 70, render: (v: number) => <span className="mono">{v}</span> },
          { title: '调用', dataIndex: 'call_count', width: 70, render: (v: number) => <span className="mono">{v}</span> },
          { title: '录制时间', dataIndex: 'created_at', width: 130, render: (v: string) => <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>{formatShort(v)}</span> },
        ]}
      />
    </SectionCard>
  );
}

function DangerZone({ onChanged, onError }: { onChanged: () => void; onError: (e: unknown) => void }) {
  const { message } = App.useApp();
  const cleanupMutation = useMutation({
    mutationFn: (scope: 'daily' | 'pre_contest') => adminApi.cleanup(scope),
    onSuccess: (data) => {
      message.success(`清理完成：实例 ${data.counts.instances ?? 0} · 会话 ${data.counts.sessions ?? 0} · 沙盒 ${data.counts.sandbox_partitions ?? 0}`);
      onChanged();
    },
    onError,
  });
  const invalidateMutation = useMutation({
    mutationFn: () => adminApi.invalidateTokens(),
    onSuccess: (data) => { message.success(`已撤销 ${data.invalidated} 个令牌`); onChanged(); },
    onError,
  });

  const doCleanup = (scope: 'daily' | 'pre_contest') =>
    confirmAction({
      title: scope === 'daily' ? '执行每日清理？' : '执行赛前清理？',
      content: scope === 'daily' ? '将销毁所有已过期实例及其活跃会话与沙盒分区。' : '将销毁全部非销毁状态实例、终止所有活跃会话并清空沙盒分区。此操作不可撤销。',
      okText: '确认清理',
      onOk: () => cleanupMutation.mutate(scope),
    });

  const doInvalidate = () =>
    confirmAction({
      title: '撤销全部访问令牌？',
      content: '所有已签发令牌（含当前会话）将立即失效，需重新输入口令进入实验室。',
      okText: '撤销全部',
      onOk: () => invalidateMutation.mutate(),
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DangerRow
        icon={<Trash2 size={15} />}
        title="每日清理"
        desc="销毁过期实例及其会话、沙盒分区"
        action={<Button size="small" danger loading={cleanupMutation.isPending} onClick={() => doCleanup('daily')}>执行</Button>}
      />
      <DangerRow
        icon={<Trash2 size={15} />}
        title="赛前清理"
        desc="销毁全部实例、终止所有会话、清空沙盒"
        action={<Button size="small" danger loading={cleanupMutation.isPending} onClick={() => doCleanup('pre_contest')}>执行</Button>}
      />
      <DangerRow
        icon={<KeyRound size={15} />}
        title="撤销全部令牌"
        desc="强制所有客户端重新认证"
        action={<Button size="small" danger loading={invalidateMutation.isPending} onClick={doInvalidate}>撤销</Button>}
      />
    </div>
  );
}

function DangerRow({ icon, title, desc, action }: { icon: React.ReactNode; title: string; desc: string; action: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 10 }}>
      <span style={{ color: 'var(--fg-block-text)', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-text-3)', marginTop: 1 }}>{desc}</div>
      </div>
      {action}
    </div>
  );
}

function DistBars({ data, labelMap, semantic }: { data: Record<string, number>; labelMap?: (k: string) => string; semantic?: boolean }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  const colorFor = (k: string) => {
    if (!semantic) return 'var(--fg-brand-primary)';
    const s = actionToStatus(k);
    return s === 'allow' ? 'var(--fg-allow)' : s === 'block' ? 'var(--fg-block)' : s === 'observe' ? 'var(--fg-observe)' : 'var(--fg-disabled)';
  };
  if (entries.length === 0) return <div style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>暂无数据</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {entries.map(([k, n]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 70, fontSize: 11.5, color: 'var(--fg-text-2)', flexShrink: 0 }}>{labelMap ? labelMap(k) : k}</span>
          <div style={{ flex: 1, height: 8, borderRadius: 5, background: 'var(--fg-bg-subtle)', overflow: 'hidden' }}>
            <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: colorFor(k), borderRadius: 5 }} />
          </div>
          <span className="mono" style={{ width: 28, textAlign: 'right', fontSize: 11.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{n}</span>
        </div>
      ))}
    </div>
  );
}

function QuotaBar({ label, used, max, pct }: { label: string; used: number; max: number; pct: number }) {
  const color = pct > 85 ? 'var(--fg-block)' : pct > 60 ? 'var(--fg-observe)' : 'var(--fg-brand-primary)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
        <span style={{ color: 'var(--fg-text-2)' }}>{label}</span>
        <span className="mono" style={{ color: 'var(--fg-text-3)' }}>{used} / {max} · {pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: 'var(--fg-bg-subtle)', overflow: 'hidden', border: '1px solid var(--fg-border)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 300ms ease' }} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="fg-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 24, fontWeight: 600, color: color ?? 'var(--fg-text-1)', lineHeight: 1.1 }}>{value}</span>
    </div>
  );
}

const microLabelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 500, color: 'var(--fg-text-3)' };
const fieldLabelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--fg-text-3)', marginBottom: 5 };
const markBoxStyle: React.CSSProperties = { flex: 1, textAlign: 'center', padding: '10px 6px', background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 9 };
const degRowStyle: React.CSSProperties = { padding: '9px 12px', background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', borderRadius: 9 };