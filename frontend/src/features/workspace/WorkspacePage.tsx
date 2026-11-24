import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Descriptions, Empty, Spin, Steps, Tag, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Play, LayoutGrid, Boxes, FileBarChart, ArrowRight, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { SimBadge } from '@/components/common/SimBadge';
import { ModeBadge } from '@/components/common/ModeBadge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PresetTag } from '@/components/common/PresetTag';
import { DossierNo } from '@/components/common/DossierNo';
import { AttackIcon, GuardIcon } from '@/components/icons/SecurityIcons';
import { templateApi, instanceApi, sessionApi, sampleApi, reportApi } from '@/services/api/resources';
import { useAuthStore } from '@/stores/authStore';
import { useQuotaStore } from '@/stores/quotaStore';
import { ApiClientError } from '@/services/api/client';
import { TOOL_META } from '@/utils/constants';
import { fromNow, formatShort } from '@/utils/format';
import { dossierFromId, getWorkspaceId, dossierNo } from '@/utils/workspace';
import type { Template } from '@/types/api';

const DEMO_STEPS = ['准备靶标', '开启会话', '载入样本', '进入控制台'];
const DEMO_PHASE_LABEL = ['正在准备靶标实例…', '正在开启攻防会话…', '正在载入攻击样本…'];
// 演示超时兜底：快速链路目标秒级完成；超时视为异常，避免前端长时间转圈。
const DEMO_TIMEOUT_MS = 120000;

class DemoCancelled extends Error {}

const CAPABILITIES = [
  { icon: LayoutGrid, title: '编排中心', desc: '配置靶标 Agent 的身份、工具、约束与防护档位', to: '/orchestration' },
  { icon: Boxes, title: '实例管理', desc: '运行、克隆、比对与回收靶标实例', to: '/instances' },
  { icon: FileBarChart, title: '测评报告', desc: '根因归因与可执行加固建议', to: '/reports' },
];

interface DemoPhase {
  templateId: string;
  phase: number;
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const mode = useAuthStore((s) => s.mode);
  const quota = useQuotaStore((s) => s.quota);
  const [demoPhase, setDemoPhase] = useState<DemoPhase | null>(null);
  const dossier = dossierNo(getWorkspaceId());
  // 取消与超时兜底：快速链路正常秒级完成，异常情况不再无限转圈。
  const demoCancelRef = useRef(false);
  const demoTimerRef = useRef<number | null>(null);

  const cancelDemo = () => {
    demoCancelRef.current = true;
    if (demoTimerRef.current) {
      window.clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
    }
  };

  // 演示启动：重置取消标记并挂超时兜底（快速链路秒级完成，超时即中止）。
  const startDemo = (template?: Template) => {
    const target = template ?? templates[0];
    if (!target || demo.isPending) return;
    demoCancelRef.current = false;
    if (demoTimerRef.current) window.clearTimeout(demoTimerRef.current);
    demoTimerRef.current = window.setTimeout(() => {
      demoCancelRef.current = true;
    }, DEMO_TIMEOUT_MS);
    demo.mutate(target);
  };

  useEffect(() => cancelDemo, []);

  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: () => templateApi.list() });
  const instancesQuery = useQuery({ queryKey: ['instances', 'recent'], queryFn: () => instanceApi.list(undefined, 1, 6) });
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'recent'], queryFn: () => sessionApi.list(undefined, 1, 5) });
  const reportsQuery = useQuery({ queryKey: ['reports', 'recent'], queryFn: () => reportApi.list(undefined, 1, 4) });

  const demo = useMutation({
    mutationFn: async (template: Template) => {
      if (demoCancelRef.current) throw new DemoCancelled();
      setDemoPhase({ templateId: template.id, phase: 0 });
      // 同工作区已有该模板的就绪实例时直接复用，反复演示不新建实例、不会触发存活上限。
      let instanceId: string;
      if (demoCancelRef.current) throw new DemoCancelled();
      const existing = await instanceApi.list('ready', 1, 100);
      const reusable = existing.items.find((i) => i.name === template.name);
      if (reusable) {
        instanceId = reusable.instance_id;
      } else {
        if (demoCancelRef.current) throw new DemoCancelled();
        const inst = await instanceApi.create({
          config: template.config,
          name: template.name,
          guard_preset: template.suggested_guard,
        });
        instanceId = inst.instance_id;
      }
      if (demoCancelRef.current) throw new DemoCancelled();
      setDemoPhase({ templateId: template.id, phase: 1 });
      const sess = await sessionApi.create(instanceId, true);
      if (demoCancelRef.current) throw new DemoCancelled();
      setDemoPhase({ templateId: template.id, phase: 2 });
      const samples = await sampleApi.list(instanceId, undefined, 1, 100);
      const applicable = samples.items.filter((s) => s.applicable);
      // 演示优先选无需铺垫、一击即中的样本，保证一轮内就能看到拦截或放行结论。
      const target =
        applicable.find((s) => !(s.setup_turns ?? []).length) ||
        applicable[0] ||
        samples.items[0];
      if (demoCancelRef.current) throw new DemoCancelled();
      if (target) {
        try {
          // 快速链路：整条调用链走离线仿真，秒级完成、答辩可控、不耗配额。
          await sampleApi.load(sess.session_id, target.sample_id, true, true);
        } catch {
          /* 样本可能不适用，仍进入控制台 */
        }
      }
      if (demoCancelRef.current) throw new DemoCancelled();
      return sess.session_id;
    },
    onSuccess: (sessionId) => {
      setDemoPhase(null);
      cancelDemo();
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      message.success('演示已就绪，进入攻防控制台');
      navigate(`/console/${sessionId}`);
    },
    onError: (err) => {
      setDemoPhase(null);
      cancelDemo();
      if (err instanceof DemoCancelled) {
        message.info('演示已取消');
      } else {
        message.error(err instanceof ApiClientError ? err.message : '一键演示失败');
      }
    },
  });

  const templates = templatesQuery.data?.items ?? [];
  const instances = instancesQuery.data?.items ?? [];
  const sessions = sessionsQuery.data?.items ?? [];
  const reports = reportsQuery.data?.items ?? [];
  // 仅「当前正在演示的那个模板」显示 loading，避免点一个全部转圈。
  const demoTargetId = demo.variables?.id;
  const bannerPending = demoPhase !== null && demoTargetId === templates[0]?.id;
  const activeStep = demoPhase ? demoPhase.phase : -1;
  const activeLabel = demoPhase ? DEMO_PHASE_LABEL[Math.min(demoPhase.phase, DEMO_PHASE_LABEL.length - 1)] : '准备中';

  return (
    <div>
      <PageHeader title="案卷工作台" extra={<><ModeBadge mode={mode} /><SimBadge /></>} />

      {/* 演示进度与实际创建、载入阶段同步 */}
      <Card
        className="bb-demo-card"
        data-tour="demo-banner"
        size="small"
        variant="borderless"
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><AttackIcon size={16} strokeWidth={1.5} /> 一键演示</span>}
        extra={<DossierNo no={dossier} />}
        style={{ marginBottom: 16 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', minWidth: 0 }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <Typography.Text type="secondary">
              <InfoCircleOutlined /> 自动选用预置模板创建靶标实例与会话，载入攻击样本后进入实时控制台，全程内存仿真，演示走快速链路秒级完成
            </Typography.Text>
            <Steps size="small" current={bannerPending ? activeStep : -1} items={DEMO_STEPS.map((title) => ({ title }))} style={{ marginTop: 16 }} />
          </div>
          {bannerPending && (
            <Button
              type="text"
              size="large"
              onClick={cancelDemo}
              style={{ flexShrink: 0, color: 'var(--bb-text-2)' }}
            >
              取消
            </Button>
          )}
          <Button
            type="primary"
            size="large"
            onClick={() => startDemo()}
            disabled={!templates.length || demo.isPending}
            style={{ height: 44, padding: '0 24px', fontWeight: 600, flexShrink: 0 }}
            icon={bannerPending ? <Spin size="small" /> : <Play size={16} />}
          >
            {bannerPending ? activeLabel : '开始演示'}
          </Button>
        </div>
      </Card>

      {/* 能力入口：文书索引条目，不用等大卡片行 */}
      <div data-tour="capabilities" style={{ marginBottom: 16 }}>
        <Card className="bb-capability-index" size="small" variant="borderless">
          {CAPABILITIES.map((c, i) => (
            <button
              key={c.title}
              className="bb-capability-row"
              onClick={() => navigate(c.to)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                width: '100%',
                padding: '16px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                borderBottom: i < CAPABILITIES.length - 1 ? '1px solid var(--bb-border)' : 'none',
                transition: 'background-color 150ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bb-bg-subtle)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span className="bb-capability-no">{String(i + 1).padStart(2, '0')}</span>
              <c.icon size={16} strokeWidth={1.5} style={{ color: 'var(--bb-brand-primary)', flexShrink: 0 }} />
              <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--bb-text-1)', flexShrink: 0 }}>{c.title}</span>
              <span style={{ fontSize: 13, color: 'var(--bb-text-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.desc}</span>
              <ArrowRight size={14} style={{ color: 'var(--bb-text-3)', flexShrink: 0 }} />
            </button>
          ))}
        </Card>
      </div>

      <div className="bb-workspace-grid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* 靶标模板 */}
        <div data-tour="templates">
        <SectionCard
          title={<><GuardIcon size={15} strokeWidth={1.5} /> 当前可测靶标</>}
          extra={<Button size="small" type="link" onClick={() => navigate('/orchestration')}>去编排 <ArrowRight size={13} /></Button>}
          padding={16}
        >
          {templatesQuery.isLoading ? (
            <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>
          ) : templates.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><div>暂无模板</div><Typography.Text type="secondary">后端未返回预置模板</Typography.Text></>} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.slice(0, 4).map((t) => (
                <div
                  key={t.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderBottom: '1px solid var(--bb-border)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <DossierNo no={dossierFromId(t.id)} />
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--bb-text-1)' }}>{t.name}</span>
                      <PresetTag preset={t.suggested_guard} size="sm" />
                    </div>
                    <Typography.Text type="secondary"><InfoCircleOutlined /> {t.description}</Typography.Text>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      {t.suggested_tools.slice(0, 5).map((tool) => (
                        <Tag key={tool} style={{ margin: 0 }}>{TOOL_META[tool]?.label || tool}</Tag>
                      ))}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    ghost
                    size="small"
                    icon={<Play size={13} />}
                    loading={demoPhase !== null && demoTargetId === t.id}
                    disabled={demoPhase !== null && demoTargetId !== t.id}
                    onClick={() => startDemo(t)}
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
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><div>暂无会话</div><Typography.Text type="secondary">从实例或一键演示开始</Typography.Text></>} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {sessions.map((s) => (
                  <button
                    key={s.session_id}
                    onClick={() => navigate(`/console/${s.session_id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'background-color 150ms ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bb-bg-subtle)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <StatusBadge action={s.block_count > 0 ? 'block' : 'allow'} size="sm" showText={false} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--bb-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.instance_name}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--bb-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        档号 {dossierFromId(s.session_id)} · {s.session_id.slice(0, 8)} · {s.turn} 轮
                      </div>
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--bb-text-3)' }}>{fromNow(s.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="最近报告" padding={8}>
            {reports.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><div>暂无报告</div><Typography.Text type="secondary">在控制台生成测评报告</Typography.Text></>} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {reports.map((r) => (
                  <button
                    key={r.report_id}
                    onClick={() => navigate(`/reports/${r.report_id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'background-color 150ms ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bb-bg-subtle)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <FileBarChart size={15} strokeWidth={1.5} style={{ color: 'var(--bb-text-3)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--bb-text-1)' }}>{r.summary.instance_name}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--bb-text-3)' }}>
                        档号 {dossierFromId(r.report_id)} · 拦截 {r.summary.block_count} · {formatShort(r.created_at)}
                      </div>
                    </div>
                    <ArrowRight size={13} style={{ color: 'var(--bb-text-3)' }} />
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {quota && (
        <div style={{ marginTop: 16 }}>
          <Descriptions bordered={false} column={1} size="small" items={[
            { key: 'quota', label: '今日模型调用', children: `${quota.guest_used_calls ?? quota.global_used_calls}/${quota.guest_max_calls ?? quota.global_max_calls}` },
            { key: 'instances', label: '存活实例', children: instances.filter((i) => i.status !== 'destroyed').length },
          ]} />
          {(quota.guest_max_calls ?? 0) > 0 && (quota.guest_used_calls ?? 0) >= (quota.guest_max_calls ?? 0) && (
            <Typography.Text type="secondary"><InfoCircleOutlined /> 今日额度已用尽，明日恢复</Typography.Text>
          )}
        </div>
      )}
    </div>
  );
}