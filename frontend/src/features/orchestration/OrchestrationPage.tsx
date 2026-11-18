import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Drawer, Input, InputNumber, Select, Slider, Switch, Tooltip, Alert } from 'antd';
import { UserRound, Wrench, Gauge, Eye, Save, Rocket, Check, FileText, Mail, Globe, Terminal, Settings2, FilePen, Sparkles } from 'lucide-react';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { PromptEditor } from '@/components/editor/PromptEditor';
import { SimBadge } from '@/components/common/SimBadge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PresetTag } from '@/components/common/PresetTag';
import { configApi, instanceApi, templateApi } from '@/services/api/resources';
import { defaultConfig, configFromTemplate, enabledToolNames } from '@/utils/config';
import { TOOL_NAMES, TOOL_META, PRESET_META } from '@/utils/constants';
import { ApiClientError } from '@/services/api/client';
import type { AgentConfig, Policy, ToolName, ValidationResult } from '@/types/api';

const STEPS = [
  { key: 'identity', label: '基础身份', desc: '名称 · 用途 · 系统提示词', icon: UserRound },
  { key: 'tools', label: '工具能力', desc: '启用工具与权限边界', icon: Wrench },
  { key: 'limits', label: '调用约束', desc: '频次 · 会话 · 超时', icon: Gauge },
  { key: 'guard', label: '防护档位', desc: '三级判定灵敏度', icon: GuardIcon },
];

const TOOL_ICONS: Record<string, typeof FileText> = {
  read_file: FileText,
  write_file: FilePen,
  send_email: Mail,
  query_api: Globe,
  run_cmd: Terminal,
  update_config: Settings2,
};

export default function OrchestrationPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [config, setConfig] = useState<AgentConfig>(defaultConfig());
  const [step, setStep] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: () => templateApi.list() });

  const previewQuery = useQuery({
    queryKey: ['preview', config],
    queryFn: () => configApi.preview(config),
    enabled: previewOpen,
  });

  const patch = (p: Partial<AgentConfig>) => setConfig((c) => ({ ...c, ...p }));
  const patchTool = (name: ToolName, p: Partial<{ enabled: boolean; perm: Record<string, unknown> }>) =>
    setConfig((c) => ({ ...c, tools: { ...c.tools, [name]: { ...c.tools[name], ...p, perm: { ...c.tools[name].perm, ...(p.perm || {}) } } } }));

  const validateMutation = useMutation({
    mutationFn: () => configApi.validate(config),
    onSuccess: (result) => {
      setValidation(result);
      if (result.valid) message.success('配置校验通过');
      else message.warning(`配置存在 ${result.errors.length} 处问题`);
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '校验失败'),
  });

  const saveMutation = useMutation({
    mutationFn: () => configApi.create(config),
    onSuccess: (data) => {
      message.success(`配置已保存（${data.config_id}）`);
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.fieldErrors.length) {
        setValidation({ valid: false, errors: err.fieldErrors.map((f) => ({ field: f.field, code: 'api', message: f.error })), warnings: [] });
      }
      message.error(err instanceof ApiClientError ? err.message : '保存失败');
    },
  });

  const createInstanceMutation = useMutation({
    mutationFn: () => instanceApi.create({ config, name: config.name, guard_preset: config.guard.preset }),
    onSuccess: (data) => {
      message.success('实例已创建，进入实例管理');
      navigate('/instances');
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '创建实例失败'),
  });

  const suggestPromptMutation = useMutation({
    mutationFn: () => configApi.suggestPrompt(config.name ?? '', config.purpose ?? ''),
    onSuccess: (data) => {
      patch({ system_prompt: data.system_prompt });
      message.success(data.simulated ? '模型不可用，已生成合规模板提示词' : 'AI 已生成系统提示词，可继续编辑');
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '生成系统提示词失败'),
  });

  const enabled = enabledToolNames(config);
  const policies = previewQuery.data?.policies ?? [];
  const grouped = useMemo(() => {
    const g: Record<string, Policy[]> = { L1: [], L2: [], L3: [] };
    for (const p of policies) g[p.level]?.push(p);
    return g;
  }, [policies]);

  return (
    <div>
      <PageHeader
        icon={<Wrench size={20} strokeWidth={1.5} />}
        title="编排中心"
        subtitle="可视化编排靶标 Agent：身份 → 工具能力 → 调用约束 → 防护档位，实时预览生成的三级策略"
        extra={
          <div data-tour="orch-header-extra" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SimBadge />
            <Select
              placeholder="从模板载入"
              style={{ width: 180 }}
              allowClear
              options={(templatesQuery.data?.items ?? []).map((t) => ({ label: t.name, value: t.id }))}
              onChange={(id) => {
                const t = templatesQuery.data?.items.find((x) => x.id === id);
                if (t) {
                  setConfig(configFromTemplate(t.config));
                  message.success(`已载入模板「${t.name}」`);
                }
              }}
            />
            <Button icon={<Eye size={15} />} onClick={() => setPreviewOpen(true)}>策略预览</Button>
          </div>
        }
      />

      <div className="fg-orch-grid" style={{ display: 'grid', gridTemplateColumns: '190px 1fr 280px', gap: 16, alignItems: 'start' }}>
        {/* 左侧步骤导航 */}
        <div className="fg-orch-steps" style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'sticky', top: 24 }}>
          {STEPS.map((s, i) => {
            const active = i === step;
            return (
              <button
                key={s.key}
                onClick={() => setStep(i)}
                style={{
                  display: 'flex',
                  gap: 11,
                  alignItems: 'flex-start',
                  padding: '12px 13px',
                  borderRadius: 11,
                  border: '1px solid var(--fg-border)',
                  background: active ? 'var(--fg-bg-subtle)' : 'var(--fg-bg-card)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 160ms ease, border-color 160ms ease',
                }}
              >
                <s.icon size={16} strokeWidth={1.5} style={{ color: active ? 'var(--fg-brand-primary)' : 'var(--fg-text-3)', marginTop: 2, flexShrink: 0 }} />
                <div style={{ lineHeight: 1.25 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--fg-brand-primary)' : 'var(--fg-text-1)' }}>{i + 1}. {s.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-text-3)', marginTop: 2 }}>{s.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* 中央编辑区 */}
        <div data-tour="orch-editor" style={{ minWidth: 0 }}>
          {step === 0 && (
            <SectionCard title="基础身份" padding={20}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <Field label="实例名称" required hint="不超过 32 字符">
                  <Input value={config.name} maxLength={32} onChange={(e) => patch({ name: e.target.value })} placeholder="例如：客服助手 Agent" />
                </Field>
                <Field label="声明用途" hint="供语义层对照基线，判断越权意图">
                  <Input value={config.purpose} onChange={(e) => patch({ purpose: e.target.value })} placeholder="例如：处理用户咨询与订单查询" />
                </Field>
                <Field
                  label="系统提示词"
                  required
                  hint="不超过 4000 字符，明确授权与禁止动作"
                  action={
                    <Tooltip title="依据实例名称与声明用途，调用模型自动生成系统提示词">
                      <Button
                        size="small"
                        icon={<Sparkles size={14} />}
                        loading={suggestPromptMutation.isPending}
                        disabled={!(config.name ?? '').trim() && !(config.purpose ?? '').trim()}
                        onClick={() => suggestPromptMutation.mutate()}
                      >
                        AI 生成
                      </Button>
                    </Tooltip>
                  }
                >
                  <PromptEditor value={config.system_prompt} onChange={(v) => patch({ system_prompt: v })} language="markdown" height={260} />
                </Field>
              </div>
            </SectionCard>
          )}

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {TOOL_NAMES.map((name) => {
                const spec = config.tools[name];
                const Icon = TOOL_ICONS[name];
                const meta = TOOL_META[name];
                return (
                  <SectionCard key={name} padding={0} style={{ border: `1px solid ${spec.enabled ? 'var(--fg-brand-primary)' : 'var(--fg-border)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: spec.enabled ? '1px solid var(--fg-border)' : 'none' }}>
                      <Icon size={17} strokeWidth={1.5} style={{ color: spec.enabled ? 'var(--fg-brand-primary)' : 'var(--fg-text-3)', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{name}</span>
                          <span style={{ fontSize: 13, color: 'var(--fg-text-2)' }}>{meta.label}</span>
                          <SimBadge compact />
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--fg-text-3)', marginTop: 2 }}>{meta.desc}</div>
                      </div>
                      <Switch checked={spec.enabled} onChange={(v) => patchTool(name, { enabled: v })} />
                    </div>
                    {spec.enabled && (
                      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--fg-bg-subtle)' }}>
                        <ToolPermEditor name={name} perm={spec.perm} onChange={(perm) => patchTool(name, { perm })} />
                      </div>
                    )}
                  </SectionCard>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <SectionCard title="调用约束" padding={20}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
                <SliderField label="单轮调用上限" hint="单轮对话内最多工具调用次数（1~20）" value={config.limits.max_calls_per_turn} min={1} max={20} onChange={(v) => patch({ limits: { ...config.limits, max_calls_per_turn: v } })} />
                <SliderField label="会话累计上限" hint="整个会话最多工具调用次数（1~500）" value={config.limits.max_calls_per_session} min={1} max={500} onChange={(v) => patch({ limits: { ...config.limits, max_calls_per_session: v } })} />
                <SliderField label="单次超时 (ms)" hint="单次调用超时阈值（1000~60000）" value={config.limits.timeout_ms} min={1000} max={60000} step={500} onChange={(v) => patch({ limits: { ...config.limits, timeout_ms: v } })} />
                {config.limits.max_calls_per_session < config.limits.max_calls_per_turn && (
                  <Alert type="error" showIcon message="会话调用上限不得小于单轮调用上限" />
                )}
              </div>
            </SectionCard>
          )}

          {step === 3 && (
            <SectionCard title="防护档位" padding={20}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {(['loose', 'standard', 'strict'] as const).map((preset) => {
                  const active = config.guard.preset === preset;
                  const meta = PRESET_META[preset];
                  return (
                    <button
                      key={preset}
                      onClick={() => patch({ guard: { ...config.guard, preset } })}
                      style={{
                        padding: 18,
                        borderRadius: 12,
                        border: `1px solid ${active ? 'var(--fg-brand-primary)' : 'var(--fg-border)'}`,
                        background: active ? 'var(--fg-bg-subtle)' : 'var(--fg-bg-card)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background-color 160ms ease, border-color 160ms ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: active ? 'var(--fg-brand-primary)' : 'var(--fg-text-1)' }}>{meta.label}</span>
                        {active && <Check size={18} style={{ color: 'var(--fg-brand-primary)' }} />}
                      </div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--fg-text-3)', marginBottom: 8 }}>{preset}</div>
                      <div style={{ fontSize: 13, color: 'var(--fg-text-2)', lineHeight: 1.55 }}>{meta.desc}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 18, padding: 14, borderRadius: 11, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)', fontSize: 13.5, color: 'var(--fg-text-2)', lineHeight: 1.6 }}>
                防护档位决定 L2 注入阈值与 L3 语义层的介入频率。严格档位会对任何越权迹象阻断并做跨轮一致性检查；宽松档位仅拦截高危越权。工具存在性硬规则在任何档位下都不允许停用。
              </div>
            </SectionCard>
          )}

          {/* 底部操作 */}
          <div data-tour="orch-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>上一步</Button>
              <Button disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>下一步</Button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button icon={<Check size={15} />} loading={validateMutation.isPending} onClick={() => validateMutation.mutate()}>校验配置</Button>
              <Button icon={<Save size={15} />} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>保存配置</Button>
              <Button type="primary" icon={<Rocket size={15} />} loading={createInstanceMutation.isPending} onClick={() => createInstanceMutation.mutate()}>创建实例</Button>
            </div>
          </div>
        </div>

        {/* 右侧实时预览 */}
        <div className="fg-orch-aside" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 24 }}>
          <SectionCard title="编排摘要" padding={16}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SummaryRow label="名称" value={config.name || '—'} />
              <SummaryRow label="防护档位" value={<PresetTag preset={config.guard.preset} size="sm" />} />
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg-text-3)', marginBottom: 6 }}>启用工具 ({enabled.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {enabled.length === 0 && <span style={{ fontSize: 13, color: 'var(--fg-text-3)' }}>未启用任何工具</span>}
                  {enabled.map((t) => (
                    <span key={t} className="mono" style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 4, background: 'var(--fg-bg-subtle)', color: 'var(--fg-text-2)', border: '1px solid var(--fg-border)' }}>{t}</span>
                  ))}
                </div>
              </div>
              <SummaryRow label="单轮 / 会话" value={`${config.limits.max_calls_per_turn} / ${config.limits.max_calls_per_session}`} />
              <SummaryRow label="超时" value={`${config.limits.timeout_ms}ms`} />
            </div>
          </SectionCard>

          {validation && (
            <SectionCard title="校验结果" padding={14}>
              {validation.valid ? (
                <Alert type="success" showIcon message="配置校验通过" style={{ marginBottom: validation.warnings.length ? 10 : 0 }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {validation.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 13, color: 'var(--fg-block-text)', lineHeight: 1.5 }}>
                      <span className="mono" style={{ opacity: 0.7 }}>{e.field}</span> · {e.message}
                    </div>
                  ))}
                </div>
              )}
              {validation.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 12.5, color: 'var(--fg-observe-text)', lineHeight: 1.5, marginTop: 4 }}>{w.message}</div>
              ))}
            </SectionCard>
          )}
        </div>
      </div>

      {/* 策略预览 Drawer */}
      <Drawer title="三级策略预览" width={560} open={previewOpen} onClose={() => setPreviewOpen(false)}>
        {previewQuery.isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-text-3)' }}>生成策略中…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {(['L1', 'L2', 'L3'] as const).map((level) => (
              <div key={level}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, padding: '2px 9px', borderRadius: 4, background: 'var(--fg-bg-subtle)', color: 'var(--fg-text-2)', border: '1px solid var(--fg-border)' }}>{level}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)' }}>
                    {level === 'L1' ? '确定性规则层' : level === 'L2' ? '注入分类层' : '语义判定层'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>{grouped[level].length} 条</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {grouped[level].map((p) => (
                    <div key={p.policy_id} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--fg-border)', background: 'var(--fg-bg-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>{p.policy_id} · {p.rule_type}</span>
                        <StatusBadge action={p.action} size="sm" />
                      </div>
                      <div style={{ fontSize: 13.5, color: 'var(--fg-text-1)', lineHeight: 1.5 }}>{p.condition}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--fg-text-3)', marginTop: 4 }}>来源 {p.source}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Field({ label, required, hint, action, children }: { label: string; required?: boolean; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)' }}>{label}{required && <span style={{ color: 'var(--fg-block)' }}> *</span>}</span>
        {hint && <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>{hint}</span>}
        {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
      </div>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ fontSize: 12.5, color: 'var(--fg-text-3)' }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-text-1)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function SliderField({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)' }}>{label}</span>
        <InputNumber size="small" value={value} min={min} max={max} step={step} onChange={(v) => onChange(v ?? min)} style={{ width: 100 }} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-text-3)', marginBottom: 8 }}>{hint}</div>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}

function ToolPermEditor({ name, perm, onChange }: { name: ToolName; perm: Record<string, unknown>; onChange: (perm: Record<string, unknown>) => void }) {
  const listField = (key: string, label: string, placeholder: string) => (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-text-2)', marginBottom: 5 }}>{label}</div>
      <Select
        mode="tags"
        style={{ width: '100%' }}
        value={(perm[key] as string[]) || []}
        onChange={(v) => onChange({ ...perm, [key]: v })}
        placeholder={placeholder}
        tokenSeparators={[',', ' ']}
        open={false}
        suffixIcon={null}
      />
    </div>
  );

  switch (name) {
    case 'read_file':
      return (
        <>
          {listField('allow_paths', '允许路径前缀', './docs')}
          {listField('deny_names', '禁止文件名', 'secret.txt')}
        </>
      );
    case 'write_file':
      return (
        <>
          {listField('allow_paths', '允许写入路径', './tmp')}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--fg-text-2)' }}>
            <Switch size="small" checked={!!perm.overwrite} onChange={(v) => onChange({ ...perm, overwrite: v })} />
            允许覆写已存在文件
          </label>
        </>
      );
    case 'send_email':
      return (
        <>
          {listField('allow_domains', '允许收件域名', 'example.com')}
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-text-2)', marginBottom: 5 }}>最大收件人数</div>
            <InputNumber min={1} max={50} value={(perm.max_recipients as number) ?? 3} onChange={(v) => onChange({ ...perm, max_recipients: v ?? 3 })} style={{ width: 120 }} />
          </div>
        </>
      );
    case 'query_api':
      return (
        <>
          {listField('allow_endpoints', '允许接口', '/user/info')}
          {listField('mask_fields', '脱敏字段', 'phone')}
        </>
      );
    case 'run_cmd':
      return listField('allow_cmds', '允许命令', 'ls');
    case 'update_config':
      return listField('allow_keys', '允许配置键', 'log_level');
    default:
      return null;
  }
}