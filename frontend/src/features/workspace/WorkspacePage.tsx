import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Spin } from 'antd';
import { Play, LayoutGrid, Boxes, FileBarChart, ArrowRight, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { SimBadge } from '@/components/common/SimBadge';
import { ModeBadge } from '@/components/common/ModeBadge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { PresetTag } from '@/components/common/PresetTag';
import { AttackIcon, GuardIcon } from '@/components/icons/SecurityIcons';
import { templateApi, instanceApi, sessionApi, sampleApi, reportApi } from '@/services/api/resources';
import { useAuthStore } from '@/stores/authStore';
import { useQuotaStore } from '@/stores/quotaStore';
import { ApiClientError } from '@/services/api/client';
import { TOOL_META } from '@/utils/constants';
import { fromNow, formatShort } from '@/utils/format';
import type { Template } from '@/types/api';

const DEMO_STEPS = ['创建实例', '开启会话', '载入样本', '进入控制台'];

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const mode = useAuthStore((s) => s.mode);
  const quota = useQuotaStore((s) => s.quota);
  const [demoStep, setDemoStep] = useState<string | null>(null);

  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: () => templateApi.list() });
  const instancesQuery = useQuery({ queryKey: ['instances', 'recent'], queryFn: () => instanceApi.list(undefined, 1, 6) });
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'recent'], queryFn: () => sessionApi.list(undefined, 1, 5) });
  const reportsQuery = useQuery({ queryKey: ['reports', 'recent'], queryFn: () => reportApi.list(undefined, 1, 4) });

  const demo = useMutation({
    mutationFn: async (template: Template) => {
      setDemoStep('正在创建靶标实例…');
      const inst = await instanceApi.create({ config: template.config, name: template.name, guard_preset: template.suggested_guard });
      setDemoStep('正在开启攻防会话…');
      const sess = await sessionApi.create(inst.instance_id, true);
      setDemoStep('正在载入攻击样本…');
      const samples = await sampleApi.list(inst.instance_id, undefined, 1, 50);
      const target = samples.items.find((s) => s.applicable) || samples.items[0];
      if (target) {
        try {
          await sampleApi.load(sess.session_id, target.sample_id, true);
        } catch {
          /* 样本可能不适用，仍进入控制台 */
        }
      }
      return sess.session_id;
    },
    onSuccess: (sessionId) => {
      setDemoStep(null);
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      message.success('演示已就绪，进入攻防控制台');
      navigate(`/console/${sessionId}`);
    },
    onError: (err) => {
      setDemoStep(null);
      message.error(err instanceof ApiClientError ? err.message : '一键演示失败');
    },
  });

  const templates = templatesQuery.data?.items ?? [];
  const instances = instancesQuery.data?.items ?? [];
  const sessions = sessionsQuery.data?.items ?? [];
  const reports = reportsQuery.data?.items ?? [];
  // 仅「当前正在演示的那个模板」显示 loading，避免点一个全部转圈。
  const demoTargetId = demo.variables?.id;
  const bannerPending = demo.isPending && demoTargetId === templates[0]?.id;
  const activeStep = demoStep ? (demoStep.includes('实例') ? 0 : demoStep.includes('会话') ? 1 : 2) : -1;

  return (
    <div>
      <PageHeader title="实验室工作台" extra={<><ModeBadge mode={mode} /><SimBadge /></>} />

      {/* 演示序列：一键演示的流程面板，步骤状态实时可见 */}
      <div
        data-tour="demo-banner"
        className="fg-card"
        style={{ padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}
      >
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AttackIcon size={16} strokeWidth={1.5} style={{ color: 'var(--fg-text-3)' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-text-1)' }}>一键演示</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--fg-text-2)', lineHeight: 1.6 }}>
            自动选用预置模板创建靶标实例与会话，载入攻击样本后进入实时控制台，全程内存仿真
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
            {DEMO_STEPS.map((label, i) => {
              const state = bannerPending ? (i < activeStep ? 'done' : i === activeStep ? 'run' : 'idle') : 'idle';
              return (
                <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      color: state === 'run' ? 'var(--fg-brand-primary)' : state === 'done' ? 'var(--fg-text-2)' : 'var(--fg-text-3)',
                    }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: state === 'run' ? 600 : 400,
                      color: state === 'run' ? 'var(--fg-brand-primary)' : state === 'done' ? 'var(--fg-text-2)' : 'var(--fg-text-3)',
                    }}
                  >
                    {label}
                  </span>
                  {i < DEMO_STEPS.length - 1 && <span style={{ width: 16, height: 1, background: 'var(--fg-border)', marginLeft: 10 }} />}
                </span>
              );
            })}
          </div>
        </div>
        <Button
          type="primary"
          size="large"
          onClick={() => templates[0] && demo.mutate(templates[0])}
          disabled={!templates.length || demo.isPending}
          style={{ height: 44, padding: '0 24px', fontWeight: 600 }}
          icon={bannerPending ? <Spin size="small" /> : <Play size={16} />}
        >
          {bannerPending ? demoStep || '准备中' : '开始演示'}
        </Button>
      </div>

      {/* 能力入口 */}
      <div data-tour="capabilities" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
        <CapabilityCard icon={<LayoutGrid size={18} strokeWidth={1.5} />} title="编排中心" desc="配置靶标 Agent 的身份、工具、约束与防护档位" onClick={() => navigate('/orchestration')} />
        <CapabilityCard icon={<Boxes size={18} strokeWidth={1.5} />} title="实例管理" desc="运行、克隆、比对与回收靶标实例" onClick={() => navigate('/instances')} />
        <CapabilityCard icon={<FileBarChart size={18} strokeWidth={1.5} />} title="测评报告" desc="根因归因与可执行加固建议" onClick={() => navigate('/reports')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* 靶标模板 */}
        <div data-tour="templates">
        <SectionCard
          title={<><GuardIcon size={15} strokeWidth={1.5} /> 预置靶标模板</>}
          extra={<Button size="small" type="link" onClick={() => navigate('/orchestration')}>去编排 <ArrowRight size={13} /></Button>}
          padding={12}
        >
          {templatesQuery.isLoading ? (
            <div style={{ padding: 30, textAlign: 'center' }}><Spin /></div>
          ) : templates.length === 0 ? (
            <EmptyState compact title="暂无模板" description="后端未返回预置模板" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.slice(0, 4).map((t) => (
                <div
                  key={t.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 12, borderRadius: 8, border: '1px solid var(--fg-border)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{t.name}</span>
                      <PresetTag preset={t.suggested_guard} size="sm" />
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--fg-text-2)', lineHeight: 1.5 }}>{t.description}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {t.suggested_tools.slice(0, 5).map((tool) => (
                        <span key={tool} className="mono" style={{ fontSize: 11, padding: '1px 7px', borderRadius: 4, background: 'var(--fg-bg-subtle)', color: 'var(--fg-text-2)' }}>
                          {TOOL_META[tool]?.label || tool}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    ghost
                    size="small"
                    icon={<Play size={13} />}
                    loading={demo.isPending && demoTargetId === t.id}
                    disabled={demo.isPending && demoTargetId !== t.id}
                    onClick={() => demo.mutate(t)}
                  >
                    演示
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
        </div>

        {/* 最近记录 */}
        <div data-tour="recent" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SectionCard title={<><Clock size={15} strokeWidth={1.5} /> 最近会话</>} padding={8}>
            {sessions.length === 0 ? (
              <EmptyState compact title="暂无会话" description="从实例或一键演示开始" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {sessions.map((s) => (
                  <button
                    key={s.session_id}
                    onClick={() => navigate(`/console/${s.session_id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'background-color 150ms ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fg-bg-subtle)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <StatusBadge action={s.block_count > 0 ? 'block' : 'allow'} size="sm" showText={false} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--fg-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.instance_name}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-text-3)' }}>{s.session_id} · {s.turn} 轮</div>
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>{fromNow(s.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="最近报告" padding={8}>
            {reports.length === 0 ? (
              <EmptyState compact title="暂无报告" description="在控制台生成测评报告" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {reports.map((r) => (
                  <button
                    key={r.report_id}
                    onClick={() => navigate(`/reports/${r.report_id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'background-color 150ms ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fg-bg-subtle)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <FileBarChart size={15} strokeWidth={1.5} style={{ color: 'var(--fg-text-3)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--fg-text-1)' }}>{r.summary.instance_name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>拦截 {r.summary.block_count} · {formatShort(r.created_at)}</div>
                    </div>
                    <ArrowRight size={13} style={{ color: 'var(--fg-text-3)' }} />
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {quota && (
        <div className="mono" style={{ marginTop: 16, fontSize: 12.5, color: 'var(--fg-text-3)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>
            今日模型调用 {quota.guest_used_calls ?? quota.global_used_calls}/{quota.guest_max_calls ?? quota.global_max_calls}
          </span>
          <span>存活实例 {instances.filter((i) => i.status !== 'destroyed').length}</span>
          {(quota.guest_max_calls ?? 0) > 0 && (quota.guest_used_calls ?? 0) >= (quota.guest_max_calls ?? 0) && (
            <span style={{ color: 'var(--fg-block-text)' }}>今日额度已用尽，明日恢复</span>
          )}
        </div>
      )}
    </div>
  );
}

function CapabilityCard({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fg-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, cursor: 'pointer', textAlign: 'left', transition: 'background-color 150ms ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fg-bg-subtle)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--fg-bg-card)'; }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg-text-3)' }}>
        {icon}
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-text-1)' }}>{title}</span>
        <ArrowRight size={14} style={{ marginLeft: 'auto', color: 'var(--fg-text-3)' }} />
      </span>
      <span style={{ fontSize: 13, color: 'var(--fg-text-2)', lineHeight: 1.55 }}>{desc}</span>
    </button>
  );
}