import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Empty, Input, Modal, Segmented, Select, Spin, Switch, Tag, Tooltip } from 'antd';
import {
  ArrowLeft,
  Filter,
  Lock,
  Unlock,
  PencilLine,
  ScrollText,
  GitBranch,
} from 'lucide-react';
import { instanceApi } from '@/services/api/resources';
import { ApiClientError } from '@/services/api/client';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { JsonViewer } from '@/components/common/JsonViewer';
import { PresetTag } from '@/components/common/PresetTag';
import { DossierNo } from '@/components/common/DossierNo';
import { StatusLine } from '@/components/common/StatusLine';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { formatShort } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import type { Action, Policy } from '@/types/api';

const LEVEL_META: Record<string, { name: string; desc: string; hue: string }> = {
  L1: { name: 'L1 · 确定性规则', desc: '工具存在性 / 对象边界 / 参数边界 / 调用约束，命中即短路', hue: '#4f7ba6' },
  L2: { name: 'L2 · 注入分类', desc: '注入概率打分，高危短路、灰区质询', hue: '#176b63' },
  L3: { name: 'L3 · 语义判定', desc: '对照基线摘要的语义越权判定，输出固定 JSON', hue: '#64748b' },
};

// 三级案卷的档号式编号：卷一 / 卷二 / 卷三。
const CN_NUM: Record<string, string> = { L1: '卷一', L2: '卷二', L3: '卷三' };

const ACTION_OPTIONS: { value: Action; label: string }[] = [
  { value: 'allow', label: '放行 allow' },
  { value: 'block', label: '阻断 block' },
  { value: 'challenge', label: '质询 challenge' },
  { value: 'degrade', label: '降级 degrade' },
];

export default function PoliciesPage() {
  const { instanceId = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [originFilter, setOriginFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const instanceQuery = useQuery({
    queryKey: ['instance', instanceId],
    queryFn: () => instanceApi.get(instanceId),
    enabled: !!instanceId,
  });
  const policiesQuery = useQuery({
    queryKey: ['policies', instanceId],
    queryFn: () => instanceApi.policies(instanceId),
    enabled: !!instanceId,
  });
  const snapshotQuery = useQuery({
    queryKey: ['policy-snapshot', instanceId],
    queryFn: () => instanceApi.policySnapshot(instanceId),
    enabled: !!instanceId,
  });

  const policies = policiesQuery.data?.items ?? [];
  const instance = instanceQuery.data;
  const snapshot = snapshotQuery.data;

  const counts = useMemo(() => {
    const c: Record<string, number> = { L1: 0, L2: 0, L3: 0 };
    for (const p of policies) c[p.level] = (c[p.level] || 0) + 1;
    return c;
  }, [policies]);

  const filtered = useMemo(() => {
    return policies.filter((p) => {
      if (levelFilter !== 'all' && p.level !== levelFilter) return false;
      if (originFilter !== 'all' && p.origin !== originFilter) return false;
      if (keyword) {
        const hay = `${p.policy_id} ${p.rule_type} ${p.condition} ${p.source}`.toLowerCase();
        if (!hay.includes(keyword.toLowerCase())) return false;
      }
      return true;
    });
  }, [policies, levelFilter, originFilter, keyword]);

  const grouped = useMemo(() => {
    const g: Record<string, Policy[]> = { L1: [], L2: [], L3: [] };
    for (const p of filtered) (g[p.level] ||= []).push(p);
    return g;
  }, [filtered]);

  const selected = policies.find((p) => p.policy_id === selectedId) ?? null;

  const overrideMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      instanceApi.overridePolicy(instanceId, selected!.policy_id, payload),
    onSuccess: (data) => {
      message.success(`已生成新策略快照 v${(snapshot?.version ?? 0) + 1}`);
      setOverrideOpen(false);
      queryClient.invalidateQueries({ queryKey: ['policies', instanceId] });
      queryClient.invalidateQueries({ queryKey: ['policy-snapshot', instanceId] });
      queryClient.invalidateQueries({ queryKey: ['instance', instanceId] });
      void data;
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '覆盖失败'),
  });

  const loading = policiesQuery.isLoading || instanceQuery.isLoading;

  return (
    <div>
      <PageHeader
        icon={<GuardIcon size={20} strokeWidth={1.5} />}
        title="策略管理"
        subtitle={
          instance ? (
            <span>
              靶标 <b style={{ color: 'var(--fg-text-1)' }}>{instance.name}</b> · 防护档位 <PresetTag preset={instance.guard.preset} size="sm" /> · 当前快照 v{snapshot?.version ?? '—'}
            </span>
          ) : (
            '三级判定策略的可视化与人工覆盖'
          )
        }
        extra={
          <>
            <Button icon={<ArrowLeft size={15} />} onClick={() => navigate('/instances')}>
              返回实例
            </Button>
            <Button
              type="primary"
              icon={<GitBranch size={15} />}
              onClick={() => navigate('/instances')}
            >
              进入会话测评
            </Button>
          </>
        }
      />

      {/* 三级案卷叠放 */}
      <div data-tour="policies-levels" style={{ marginBottom: 16 }}>
      <SectionCard padding={0}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {(['L1', 'L2', 'L3'] as const).map((lv) => {
            const meta = LEVEL_META[lv];
            const active = levelFilter === lv;
            const dim = levelFilter !== 'all' && !active;
            return (
              <button
                key={lv}
                onClick={() => setLevelFilter(levelFilter === lv ? 'all' : lv)}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  width: '100%',
                  textAlign: 'left',
                  background: active ? 'var(--fg-allow-bg)' : 'transparent',
                  border: 'none',
                  borderLeft: active ? '3px solid var(--fg-allow)' : '3px solid transparent',
                  borderBottom: lv !== 'L3' ? '1px solid var(--fg-border)' : 'none',
                  cursor: 'pointer',
                  opacity: dim ? 0.6 : 1,
                  transition: 'background-color 160ms ease, opacity 160ms ease',
                }}
              >
                {/* 档号式编号 */}
                <div
                  style={{
                    width: 56,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRight: '1px solid var(--fg-border)',
                    background: active ? 'var(--fg-allow-bg)' : 'var(--fg-bg-subtle)',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--fg-allow)' : 'var(--fg-text-2)' }}>{CN_NUM[lv]}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-text-3)', marginTop: 2 }}>{lv}</span>
                </div>
                <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.hue, flexShrink: 0 }} />
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{meta.name}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--fg-text-2)', lineHeight: 1.5 }}>{meta.desc}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg-text-1)' }}>
                      {counts[lv] ?? 0}
                    </span>
                    <StatusLine
                      variant={active ? 'solid' : 'dashed'}
                      color={active ? 'var(--fg-allow)' : 'var(--fg-text-3)'}
                      label={active ? '当前' : '未触发'}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>
      </div>

      <div className="fg-policies-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 16, alignItems: 'start' }}>
        {/* 左：策略列表 */}
        <SectionCard
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <ScrollText size={15} /> 策略条目
              <Tag style={{ marginInlineStart: 4 }}>{filtered.length}</Tag>
            </span>
          }
          extra={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input
                allowClear
                size="small"
                placeholder="搜索规则 / 来源"
                prefix={<Filter size={13} style={{ color: 'var(--fg-text-3)' }} />}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={{ width: 168 }}
              />
              <Segmented
                size="small"
                value={originFilter}
                onChange={(v) => setOriginFilter(v as string)}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '自动', value: 'auto' },
                  { label: '人工', value: 'manual' },
                ]}
              />
            </div>
          }
          padding={0}
        >
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Spin />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<ScrollText size={22} />} title="没有匹配的策略条目" description="调整筛选条件或清空搜索关键字" compact />
          ) : (
            <div style={{ maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>
              {(['L1', 'L2', 'L3'] as const).map((lv) =>
                grouped[lv]?.length ? (
                  <div key={lv}>
                    <div
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        padding: '7px 16px',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--fg-text-2)',
                        background: 'var(--fg-bg-subtle)',
                        borderBottom: '1px solid var(--fg-border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: LEVEL_META[lv].hue }} />
                      {LEVEL_META[lv].name} · {grouped[lv].length} 条
                    </div>
                    {grouped[lv].map((p) => (
                      <PolicyRow
                        key={p.policy_id}
                        policy={p}
                        active={p.policy_id === selectedId}
                        onSelect={() => setSelectedId(p.policy_id)}
                      />
                    ))}
                  </div>
                ) : null,
              )}
            </div>
          )}
        </SectionCard>

        {/* 右：详情 + 基线 */}
        <div className="fg-policies-aside" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 16 }}>
          <SectionCard
            title={selected ? '策略详情' : '基线摘要'}
            extra={
              selected && (
                <Button
                  size="small"
                  type="primary"
                  icon={<PencilLine size={13} />}
                  disabled={selected.rule_type === 'tool_existence'}
                  onClick={() => setOverrideOpen(true)}
                >
                  人工覆盖
                </Button>
              )
            }
          >
            {selected ? (
              <PolicyDetail policy={selected} />
            ) : snapshot ? (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <Tag color="processing">快照 v{snapshot.version}</Tag>
                  <Tag>人工覆盖 {snapshot.manual_override_count} 项</Tag>
                  <Tag>{formatShort(snapshot.created_at)}</Tag>
                </div>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    padding: 12,
                    background: 'var(--fg-bg-subtle)',
                    border: '1px solid var(--fg-border)',
                    borderRadius: 8,
                    fontSize: 12.5,
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'var(--fg-text-2)',
                    maxHeight: 360,
                    overflowY: 'auto',
                  }}
                >
                  {snapshot.baseline_summary}
                </pre>
                <div style={{ fontSize: 12.5, color: 'var(--fg-text-3)', marginTop: 10, lineHeight: 1.6 }}>
                  点击左侧任一策略条目查看详情并发起人工覆盖。覆盖将生成新版本快照（只增不改），历史会话仍引用其原快照。
                </div>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择策略条目查看详情" />
            )}
          </SectionCard>
        </div>
      </div>

      {selected && (
        <OverrideModal
          open={overrideOpen}
          policy={selected}
          loading={overrideMutation.isPending}
          onCancel={() => setOverrideOpen(false)}
          onSubmit={(payload) => overrideMutation.mutate(payload)}
        />
      )}
    </div>
  );
}

function PolicyRow({ policy, active, onSelect }: { policy: Policy; active: boolean; onSelect: () => void }) {
  const hard = policy.rule_type === 'tool_existence';
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        textAlign: 'left',
        padding: '11px 16px',
        background: active ? 'var(--fg-bg-subtle)' : 'transparent',
        border: 'none',
        borderLeft: `3px solid ${active ? 'var(--fg-brand-primary)' : 'transparent'}`,
        borderBottom: '1px solid var(--fg-border)',
        cursor: 'pointer',
        opacity: policy.enabled ? 1 : 0.55,
        transition: 'background-color 140ms ease',
      }}
    >
      <span style={{ flexShrink: 0, color: policy.enabled ? 'var(--fg-allow-text)' : 'var(--fg-text-3)' }}>
        {hard ? <Lock size={15} /> : policy.enabled ? <Unlock size={15} /> : <Lock size={15} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>
            {policy.policy_id}
          </span>
          <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>{policy.rule_type}</span>
          {policy.origin === 'manual' && (
            <Tag color="warning" style={{ margin: 0, fontSize: 11, lineHeight: '16px', padding: '0 5px' }}>
              人工
            </Tag>
          )}
        </span>
        <span style={{ display: 'block', marginTop: 2, marginBottom: 2 }}>
          <DossierNo no={dossierFromId(policy.policy_id)} />
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            color: 'var(--fg-text-2)',
            marginTop: 3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {policy.condition}
        </span>
      </span>
      <StatusBadge action={policy.action} size="sm" />
    </button>
  );
}

function PolicyDetail({ policy }: { policy: Policy }) {
  const hard = policy.rule_type === 'tool_existence';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-text-1)' }}>
          {policy.policy_id}
        </span>
        <StatusBadge action={policy.action} size="sm" />
        <Tag color={policy.enabled ? 'success' : 'default'}>{policy.enabled ? '启用' : '停用'}</Tag>
        {hard && (
          <Tooltip title="工具存在性硬规则不允许停用或改判">
            <Tag icon={<Lock size={11} />} color="error">
              硬规则
            </Tag>
          </Tooltip>
        )}
      </div>
      <Field label="规则类型" value={policy.rule_type} mono />
      <Field label="命中条件" value={policy.condition} />
      <Field label="配置来源" value={policy.source} mono />
      <Field label="来源" value={policy.origin === 'manual' ? '人工覆盖' : '自动生成'} />
      {policy.override_note && <Field label="覆盖备注" value={policy.override_note} />}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-text-3)', marginBottom: 6 }}>参数</div>
        <JsonViewer data={policy.params} maxHeight={200} collapsed />
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-text-3)', marginBottom: 3 }}>{label}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 13.5, color: 'var(--fg-text-1)', lineHeight: 1.6, wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
  );
}

function OverrideModal({
  open,
  policy,
  loading,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  policy: Policy;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [action, setAction] = useState<Action>(policy.action);
  const [enabled, setEnabled] = useState(policy.enabled);
  const [note, setNote] = useState(policy.override_note ?? '');
  const [high, setHigh] = useState<number | undefined>(
    typeof policy.params?.high === 'number' ? (policy.params.high as number) : undefined,
  );
  const [grayLow, setGrayLow] = useState<number | undefined>(
    typeof policy.params?.gray_low === 'number' ? (policy.params.gray_low as number) : undefined,
  );

  // 重新打开时同步当前策略值
  const [lastId, setLastId] = useState(policy.policy_id);
  if (lastId !== policy.policy_id) {
    setLastId(policy.policy_id);
    setAction(policy.action);
    setEnabled(policy.enabled);
    setNote(policy.override_note ?? '');
    setHigh(typeof policy.params?.high === 'number' ? (policy.params.high as number) : undefined);
    setGrayLow(typeof policy.params?.gray_low === 'number' ? (policy.params.gray_low as number) : undefined);
  }

  const isThreshold = policy.level === 'L2' && policy.rule_type === 'threshold';

  const submit = () => {
    const payload: Record<string, unknown> = { action, enabled, note: note.trim() || undefined };
    if (isThreshold) {
      const threshold: Record<string, number> = {};
      if (high != null) threshold.high = high;
      if (grayLow != null) threshold.gray_low = grayLow;
      if (Object.keys(threshold).length) payload.threshold = threshold;
    }
    onSubmit(payload);
  };

  return (
    <Modal
      open={open}
      title={`人工覆盖 · ${policy.policy_id}`}
      onCancel={onCancel}
      onOk={submit}
      confirmLoading={loading}
      okText="生成新快照"
      cancelText="取消"
      width={520}
      centered
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
        <div style={{ fontSize: 13.5, color: 'var(--fg-text-2)', lineHeight: 1.6, background: 'var(--fg-bg-subtle)', padding: 12, borderRadius: 8 }}>
          {policy.condition}
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>判定动作</div>
            <Select value={action} onChange={setAction} options={ACTION_OPTIONS} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>启用状态</div>
            <Switch checked={enabled} onChange={setEnabled} checkedChildren="启用" unCheckedChildren="停用" />
          </div>
        </div>
        {isThreshold && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>高危阈值 high</div>
              <Select
                value={high}
                onChange={setHigh}
                style={{ width: '100%' }}
                options={[0.5, 0.6, 0.7, 0.75, 0.8, 0.9].map((v) => ({ value: v, label: v.toFixed(2) }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>灰区下限 gray_low</div>
              <Select
                value={grayLow}
                onChange={setGrayLow}
                style={{ width: '100%' }}
                options={[0.2, 0.3, 0.4, 0.45, 0.5, 0.6].map((v) => ({ value: v, label: v.toFixed(2) }))}
              />
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>覆盖备注（可选）</div>
          <Input.TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="记录覆盖原因，便于审计与回溯"
            maxLength={200}
            showCount
          />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-text-3)', lineHeight: 1.6 }}>
          覆盖会生成新的策略快照版本（只增不改）。已有会话仍引用其创建时的快照，新会话将使用最新版本。
        </div>
      </div>
    </Modal>
  );
}