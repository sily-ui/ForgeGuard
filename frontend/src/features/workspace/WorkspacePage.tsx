import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Spin, Tag } from 'antd';
import { Play, LayoutGrid, Boxes, FileBarChart, Swords, ArrowRight, ShieldCheck, Sparkles, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { SimBadge } from '@/components/common/SimBadge';
import { ModeBadge } from '@/components/common/ModeBadge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { templateApi, instanceApi, sessionApi, sampleApi, reportApi } from '@/services/api/resources';
import { useAuthStore } from '@/stores/authStore';
import { useQuotaStore } from '@/stores/quotaStore';
import { ApiClientError } from '@/services/api/client';
import { PRESET_META, TOOL_META } from '@/utils/constants';
import { fromNow, formatShort } from '@/utils/format';
import { idempotencyKey } from '@/utils/format';
import type { Template } from '@/types/api';

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.role);
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

  return (
    <div>
      <PageHeader
        icon={<Sparkles size={22} strokeWidth={1.7} />}
        title="实验室工作台"
        subtitle="编排靶标 Agent · 载入攻击样本 · 观测旁路监护 · 生成根因报告"
        extra={
          <>
            <ModeBadge mode={mode} />
            <SimBadge />
          </>
        }
      />

      {/* 一键演示横幅 */}
      <div
        data-tour="demo-banner"
        style={{
          position: 'relative',
          borderRadius: 16,
          padding: '26px 30px',
          marginBottom: 20,
          background: 'var(--fg-gradient-brand)',
          color: '#fff',
          overflow: 'hidden',
          boxShadow: 'var(--fg-shadow-2)',
        }}
      >
        <div style={{ position: 'absolute', right: -30, top: -30, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', right: 90, bottom: -60, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 560 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', background: 'rgba(255,255,255,0.16)', padding: '3px 10px', borderRadius: 7, marginBottom: 12 }}>
              <Swords size={13} /> 2 分钟完整攻防演示
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>一键体验：编排 → 攻击 → 监护 → 取证</h2>
            <p style={{ margin: 0, fontSize: 13.5, opacity: 0.9, lineHeight: 1.6 }}>
              自动选用预置靶标模板，创建实例与会话，载入攻击样本并进入实时控制台，全程内存仿真。
            </p>
          </div>
          <Button
            size="large"
            onClick={() => templates[0] && demo.mutate(templates[0])}
            disabled={!templates.length || demo.isPending}
            style={{ height: 50, padding: '0 28px', fontWeight: 700, fontSize: 15, background: '#fff', color: '#176b63', border: 'none' }}
            icon={demo.isPending ? <Spin size="small" /> : <Play size={18} fill="currentColor" />}
          >
            {demo.isPending ? demoStep || '准备中…' : '一键演示'}
          </Button>
        </div>
      </div>

      {/* 能力入口 */}
      <div data-tour="capabilities" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <CapabilityCard icon={<LayoutGrid size={20} />} title="编排中心" desc="可视化配置靶标 Agent 的身份、工具、约束与防护档位" onClick={() => navigate('/orchestration')} accent="#176b63" />
        <CapabilityCard icon={<Boxes size={20} />} title="实例管理" desc="运行、克隆、比对与回收靶标实例，进入攻防会话" onClick={() => navigate('/instances')} accent="#2d9184" />
        <CapabilityCard icon={<FileBarChart size={20} />} title="测评报告" desc="六部分取证报告，根因归因与可执行加固建议" onClick={() => navigate('/reports')} accent="#5689b8" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* 靶标模板 */}
        <div data-tour="templates">
        <SectionCard
          title={<><ShieldCheck size={15} style={{ color: 'var(--fg-brand-primary)' }} /> 预置靶标模板</>}
          extra={<Button size="small" type="link" onClick={() => navigate('/orchestration')}>去编排 <ArrowRight size={13} /></Button>}
          padding={12}
        >
          {templatesQuery.isLoading ? (
            <div style={{ padding: 30, textAlign: 'center' }}><Spin /></div>
          ) : templates.length === 0 ? (
            <EmptyState compact title="暂无模板" description="后端未返回预置模板" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {templates.slice(0, 4).map((t) => (
                <div
                  key={t.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--fg-border)', background: 'var(--fg-bg-subtle)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)' }}>{t.name}</span>
                      <Tag color="cyan" style={{ margin: 0, fontSize: 10.5 }}>{PRESET_META[t.suggested_guard]?.label || t.suggested_guard}</Tag>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--fg-text-2)', lineHeight: 1.5 }}>{t.description}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                      {t.suggested_tools.slice(0, 5).map((tool) => (
                        <span key={tool} className="mono" style={{ fontSize: 10, padding: '1px 7px', borderRadius: 5, background: 'var(--fg-bg-card)', border: '1px solid var(--fg-border)', color: 'var(--fg-text-2)' }}>
                          {TOOL_META[tool]?.label || tool}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button type="primary" ghost size="small" icon={<Play size={13} />} loading={demo.isPending} onClick={() => demo.mutate(t)}>
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
          <SectionCard title={<><Clock size={15} style={{ color: 'var(--fg-text-2)' }} /> 最近会话</>} padding={8}>
            {sessions.length === 0 ? (
              <EmptyState compact title="暂无会话" description="从实例或一键演示开始" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {sessions.map((s) => (
                  <button
                    key={s.session_id}
                    onClick={() => navigate(`/console/${s.session_id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    <StatusBadge action={s.block_count > 0 ? 'block' : 'allow'} size="sm" showText={false} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.instance_name}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--fg-text-3)' }}>{s.session_id} · {s.turn} 轮</div>
                    </div>
                    <span style={{ fontSize: 10.5, color: 'var(--fg-text-3)' }}>{fromNow(s.created_at)}</span>
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
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    <FileBarChart size={15} style={{ color: 'var(--fg-info)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{r.summary.instance_name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--fg-text-3)' }}>拦截 {r.summary.block_count} · {formatShort(r.created_at)}</div>
                    </div>
                    <ArrowRight size={13} style={{ color: 'var(--fg-text-3)' }} />
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {role === 'admin' && quota && (
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--fg-text-3)', display: 'flex', gap: 16 }}>
          <span>全局配额今日 {quota.global_used_calls}/{quota.global_max_calls}</span>
          <span>存活实例 {instances.filter((i) => i.status !== 'destroyed').length}</span>
        </div>
      )}
    </div>
  );
}

function CapabilityCard({ icon, title, desc, onClick, accent }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; accent: string }) {
  return (
    <button
      onClick={onClick}
      className="fg-card"
      style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: 18, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--fg-border)', transition: 'all 180ms ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--fg-shadow-2)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--fg-shadow-1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${accent}14`, color: accent, flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-text-1)' }}>{title}</span>
          <ArrowRight size={15} style={{ color: 'var(--fg-text-3)' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-text-2)', lineHeight: 1.55, marginTop: 5 }}>{desc}</div>
      </div>
    </button>
  );
}