import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Segmented, Table, Tag, Tooltip, Modal, Radio, Input, Spin } from 'antd';
import { Boxes, LayoutGrid, Table2, Plus, Copy, RefreshCw, Trash2, Clock } from 'lucide-react';
import { AttackIcon, GuardIcon } from '@/components/icons/SecurityIcons';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { SimBadge } from '@/components/common/SimBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { PresetTag } from '@/components/common/PresetTag';
import { DossierNo } from '@/components/common/DossierNo';
import { StatusLine } from '@/components/common/StatusLine';
import { confirmAction } from '@/components/common/confirmAction';
import { instanceApi, sessionApi } from '@/services/api/resources';
import { INSTANCE_STATUS_META, PRESET_META, TOOL_META } from '@/utils/constants';
import { fromNow, formatShort } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import { ApiClientError } from '@/services/api/client';
import type { Instance } from '@/types/api';

const STATUS_COLOR: Record<string, string> = {
  ready: 'green',
  creating: 'blue',
  pending_retry: 'orange',
  frozen: 'default',
  destroyed: 'default',
};

// 实例状态 → 线形状态：实线=运行、虚线=待启动、半线=即将过期、划线=已回收。
const STATUS_LINE: Record<string, { variant: 'solid' | 'dashed' | 'half' | 'strike'; color: string }> = {
  ready: { variant: 'solid', color: 'var(--fg-allow)' },
  creating: { variant: 'dashed', color: 'var(--fg-brand-primary)' },
  pending_retry: { variant: 'half', color: 'var(--fg-observe)' },
  frozen: { variant: 'half', color: 'var(--fg-observe)' },
  destroyed: { variant: 'strike', color: 'var(--fg-text-3)' },
};

export default function InstancesPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'card' | 'table'>('card');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [cloneTarget, setCloneTarget] = useState<Instance | null>(null);

  const instancesQuery = useQuery({ queryKey: ['instances'], queryFn: () => instanceApi.list(undefined, 1, 100) });
  const instances = instancesQuery.data?.items ?? [];
  const filtered = statusFilter === 'all' ? instances : instances.filter((i) => i.status === statusFilter);
  const alive = instances.filter((i) => i.status !== 'destroyed');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['instances'] });

  const enterSession = useMutation({
    mutationFn: (instanceId: string) => sessionApi.create(instanceId, true),
    onSuccess: (data) => {
      message.success('会话已创建');
      navigate(`/console/${data.session_id}`);
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '创建会话失败'),
  });

  const recycle = useMutation({
    mutationFn: (id: string) => instanceApi.recycle(id),
    onSuccess: () => { message.success('实例已回收'); invalidate(); },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '回收失败'),
  });

  const renew = useMutation({
    mutationFn: (id: string) => instanceApi.renew(id),
    onSuccess: () => { message.success('实例已续期'); invalidate(); },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '续期失败'),
  });

  return (
    <div>
      <PageHeader
        icon={<Boxes size={20} strokeWidth={1.5} />}
        title="实例管理"
        subtitle="运行中的靶标 Agent 实例：进入攻防会话、克隆比对、查看策略、续期与回收"
        extra={
          <div data-tour="instances-header" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SimBadge />
            <Segmented
              value={view}
              onChange={(v) => setView(v as 'card' | 'table')}
              options={[
                { value: 'card', icon: <LayoutGrid size={14} /> },
                { value: 'table', icon: <Table2 size={14} /> },
              ]}
            />
            <Button type="primary" icon={<Plus size={15} />} onClick={() => navigate('/orchestration')}>新建实例</Button>
          </div>
        }
      />

      {/* 统计 */}
      <div data-tour="instances-stats" className="fg-stats-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        <StatCard label="存活实例" value={alive.length} accent="var(--fg-brand-primary)" />
        <StatCard label="就绪" value={instances.filter((i) => i.status === 'ready').length} />
        <StatCard label="累计调用" value={instances.reduce((s, i) => s + (i.stats?.call_count || 0), 0)} />
        <StatCard label="已销毁" value={instances.filter((i) => i.status === 'destroyed').length} />
      </div>

      <div data-tour="instances-filter" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'ready', 'frozen', 'destroyed'].map((s) => (
          <Button key={s} size="small" type={statusFilter === s ? 'primary' : 'default'} onClick={() => setStatusFilter(s)}>
            {s === 'all' ? '全部' : INSTANCE_STATUS_META[s]?.label || s}
          </Button>
        ))}
        <Button size="small" icon={<RefreshCw size={13} />} onClick={() => instancesQuery.refetch()} style={{ marginLeft: 'auto' }}>刷新</Button>
      </div>

      <div data-tour="instances-list">
      {instancesQuery.isLoading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" /></div>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Boxes size={26} strokeWidth={1.5} />}
            title="暂无实例"
            description="前往编排中心配置靶标 Agent 并创建实例，或在工作台使用一键演示。"
            actionLabel="去编排"
            onAction={() => navigate('/orchestration')}
          />
        </SectionCard>
      ) : view === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 16 }}>
          {filtered.map((inst) => (
            <InstanceCard
              key={inst.instance_id}
              instance={inst}
              onEnter={() => enterSession.mutate(inst.instance_id)}
              entering={enterSession.isPending}
              onClone={() => setCloneTarget(inst)}
              onPolicies={() => navigate(`/policies/${inst.instance_id}`)}
              onRenew={() => renew.mutate(inst.instance_id)}
              onRecycle={() =>
                confirmAction({
                  title: '回收实例',
                  content: `将销毁实例「${inst.name}」及其沙盒分区，关联会话将被终止。此操作不可逆。`,
                  okText: '确认回收',
                  onOk: () => recycle.mutateAsync(inst.instance_id),
                })
              }
            />
          ))}
        </div>
      ) : (
        <SectionCard padding={0}>
          <Table
            dataSource={filtered}
            rowKey="instance_id"
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: 860 }}
            columns={[
              { title: '名称', dataIndex: 'name', render: (v, r) => <span style={{ fontWeight: 600 }}>{v}<div className="mono" style={{ fontSize: 11, color: 'var(--fg-text-3)' }}>{r.instance_id}</div><div style={{ marginTop: 2 }}><DossierNo no={dossierFromId(r.instance_id)} /></div></span> },
              { title: '状态', dataIndex: 'status', render: (v) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <StatusLine variant={STATUS_LINE[v]?.variant ?? 'solid'} color={STATUS_LINE[v]?.color} thickness={3} />
                  <Tag color={STATUS_COLOR[v]}>{INSTANCE_STATUS_META[v]?.label || v}</Tag>
                </span>
              ) },
              { title: '防护', dataIndex: ['guard', 'preset'], render: (v) => <PresetTag preset={v} /> },
              { title: '工具', dataIndex: 'enabled_tools', render: (v: string[]) => <span className="mono" style={{ fontSize: 12 }}>{v.length} 个</span> },
              { title: '调用', dataIndex: ['stats', 'call_count'], render: (v) => <span className="mono">{v || 0}</span> },
              { title: '过期', dataIndex: 'expires_at', render: (v) => <span style={{ fontSize: 13 }}>{formatShort(v)}</span> },
              {
                title: '操作', key: 'action', width: 200,
                render: (_, r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="small" type="primary" ghost disabled={r.status === 'destroyed'} onClick={() => enterSession.mutate(r.instance_id)}>会话</Button>
                    <Button size="small" disabled={r.status === 'destroyed'} onClick={() => setCloneTarget(r)}>克隆</Button>
                    <Button size="small" onClick={() => navigate(`/policies/${r.instance_id}`)}>策略</Button>
                  </div>
                ),
              },
            ]}
          />
        </SectionCard>
      )}
      </div>

      <CloneModal instance={cloneTarget} onClose={() => setCloneTarget(null)} onDone={invalidate} />
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="fg-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: 'var(--fg-text-3)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: accent ?? 'var(--fg-text-1)', lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function InstanceCard({ instance, onEnter, entering, onClone, onPolicies, onRenew, onRecycle }: {
  instance: Instance;
  onEnter: () => void;
  entering: boolean;
  onClone: () => void;
  onPolicies: () => void;
  onRenew: () => void;
  onRecycle: () => void;
}) {
  const destroyed = instance.status === 'destroyed';
  return (
    <div className="fg-card" style={{ padding: 18, opacity: destroyed ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 600, color: 'var(--fg-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{instance.name}</div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--fg-text-3)', marginTop: 2 }}>{instance.instance_id}</div>
          <div style={{ marginTop: 2 }}><DossierNo no={dossierFromId(instance.instance_id)} /></div>
        </div>
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          <Tag color={STATUS_COLOR[instance.status]} style={{ margin: 0 }}>{INSTANCE_STATUS_META[instance.status]?.label}</Tag>
          <StatusLine variant={STATUS_LINE[instance.status]?.variant ?? 'solid'} color={STATUS_LINE[instance.status]?.color} thickness={3} />
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <PresetTag preset={instance.guard.preset} size="sm" />
        <SimBadge compact />
        {instance.clone_source_id && <span style={{ fontSize: 11.5, padding: '1px 8px', borderRadius: 4, border: '1px solid var(--fg-border)', color: 'var(--fg-text-2)' }}>克隆体</span>}
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--fg-text-3)', marginBottom: 6 }}>启用工具</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {instance.enabled_tools.length === 0 && <span style={{ fontSize: 13, color: 'var(--fg-text-3)' }}>无</span>}
          {instance.enabled_tools.map((t) => (
            <Tooltip key={t} title={TOOL_META[t]?.desc}>
              <span className="mono" style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 6, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', color: 'var(--fg-text-2)' }}>{t}</span>
            </Tooltip>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, fontSize: 13, color: 'var(--fg-text-2)' }}>
        <span>调用 <b className="mono" style={{ color: 'var(--fg-text-1)' }}>{instance.stats?.call_count || 0}</b></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {fromNow(instance.expires_at)}过期</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 4, borderTop: '1px solid var(--fg-border)' }}>
        <Button type="primary" size="small" icon={<AttackIcon size={13} />} disabled={destroyed} loading={entering} onClick={onEnter} style={{ flex: 1 }}>进入会话</Button>
        <Tooltip title="克隆比对"><Button size="small" icon={<Copy size={13} />} disabled={destroyed} onClick={onClone} /></Tooltip>
        <Tooltip title="查看策略"><Button size="small" icon={<GuardIcon size={13} />} onClick={onPolicies} /></Tooltip>
        <Tooltip title="续期"><Button size="small" icon={<RefreshCw size={13} />} disabled={destroyed} onClick={onRenew} /></Tooltip>
        <Tooltip title="回收"><Button size="small" danger icon={<Trash2 size={13} />} disabled={destroyed} onClick={onRecycle} /></Tooltip>
      </div>
    </div>
  );
}

function CloneModal({ instance, onClose, onDone }: { instance: Instance | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'verbatim' | 'modified'>('verbatim');
  const [guardPreset, setGuardPreset] = useState<string>('');
  const [name, setName] = useState('');

  const clone = useMutation({
    mutationFn: () =>
      instanceApi.clone(instance!.instance_id, {
        mode,
        name: name || undefined,
        guard_preset: guardPreset || undefined,
        modified_config: mode === 'modified' && guardPreset ? { guard: { preset: guardPreset } } : undefined,
      }),
    onSuccess: (data) => {
      message.success('克隆成功');
      onDone();
      onClose();
      if (data.diff_from_source?.length) {
        navigate(`/policies/${data.instance_id}`);
      }
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '克隆失败'),
  });

  return (
    <Modal
      title={`克隆实例「${instance?.name ?? ''}」`}
      open={!!instance}
      onCancel={onClose}
      onOk={() => clone.mutate()}
      confirmLoading={clone.isPending}
      okText="创建克隆"
      cancelText="取消"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>克隆模式</div>
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio.Button value="verbatim">原样克隆</Radio.Button>
            <Radio.Button value="modified">修改克隆</Radio.Button>
          </Radio.Group>
          <div style={{ fontSize: 12.5, color: 'var(--fg-text-3)', marginTop: 8, lineHeight: 1.5 }}>
            {mode === 'verbatim' ? '完整复制源实例配置，用于复现与回归。' : '在源配置基础上调整防护档位，用于对照实验。'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>克隆名称（可选）</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${instance?.name ?? ''}-克隆`} />
        </div>
        {mode === 'modified' && (
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>调整防护档位</div>
            <Radio.Group value={guardPreset} onChange={(e) => setGuardPreset(e.target.value)}>
              {['loose', 'standard', 'strict'].map((p) => (
                <Radio.Button key={p} value={p}>{PRESET_META[p].label}</Radio.Button>
              ))}
            </Radio.Group>
          </div>
        )}
      </div>
    </Modal>
  );
}