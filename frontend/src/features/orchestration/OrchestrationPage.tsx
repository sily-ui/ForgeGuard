import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Card, Collapse, Descriptions, Drawer, Form, Input, InputNumber, Select, Slider, Steps, Switch, Tag, Tooltip, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { UserRound, Wrench, Gauge, Eye, Save, Rocket, Check, FileText, Mail, Globe, Terminal, Settings2, FilePen, Sparkles } from 'lucide-react';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { PromptEditor } from '@/components/editor/PromptEditor';
import { SimBadge } from '@/components/common/SimBadge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PresetTag } from '@/components/common/PresetTag';
import { DossierNo } from '@/components/common/DossierNo';
import { configApi, instanceApi, templateApi } from '@/services/api/resources';
import { defaultConfig, configFromTemplate, enabledToolNames } from '@/utils/config';
import { TOOL_NAMES, TOOL_META, PRESET_META } from '@/utils/constants';
import { ApiClientError } from '@/services/api/client';
import { dossierFromId, dossierNo, getWorkspaceId } from '@/utils/workspace';
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
  const [savedConfigId, setSavedConfigId] = useState<string | null>(null);

  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: () => templateApi.list() });

  // 预览防抖：编辑停顿 500ms 后才请求，避免每次击键都 POST 预览。
  const [debouncedConfig, setDebouncedConfig] = useState(config);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedConfig(config), 500);
    return () => clearTimeout(t);
  }, [config]);

  const previewQuery = useQuery({
    queryKey: ['preview', debouncedConfig],
    queryFn: () => configApi.preview(debouncedConfig),
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
      else message.error(`配置存在 ${result.errors.length} 处问题`);
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '校验失败'),
  });

  const saveMutation = useMutation({
    mutationFn: () => configApi.create(config),
    onSuccess: (data) => {
      setSavedConfigId(data.config_id);
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
  const configDossierNo = savedConfigId ? dossierFromId(savedConfigId) : dossierNo(getWorkspaceId());
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

      <div className="bb-orch-grid" style={{ display: 'grid', gridTemplateColumns: '190px 1fr 280px', gap: 16, alignItems: 'start' }}>
        {/* 左侧步骤导航 */}
        <div className="bb-orch-steps" style={{ position: 'sticky', top: 24 }}>
          <Steps
            direction="vertical"
            size="small"
            current={step}
            onChange={setStep}
            items={STEPS.map((s) => ({
              key: s.key,
              title: s.label,
              description: s.desc,
              icon: <s.icon size={16} strokeWidth={1.5} />,
            }))}
          />
        </div>

        {/* 中央编辑区 */}
        <div data-tour="orch-editor" style={{ minWidth: 0 }}>
          {step === 0 && (
            <SectionCard title="基础身份" padding={16}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="实例名称" required hint="不超过 32 字符">
                  <Input value={config.name} maxLength={32} onChange={(e) => patch({ name: e.target.value })} placeholder="例如：客服助手 Agent" />
                </Field>
                <Field label="声明用途" hint="供语义层对照基线，判断越权意图">
                  <Input value={config.purpose} onChange={(e) => patch({ purpose: e.target.value })} placeholder="例如：处理用户咨询与订单查询" />
                </Field>
                <Field
                  label="系统提示词"
                  required
                  hint={`不超过 500 字符，明确授权与禁止动作（当前 ${(config.system_prompt ?? '').length} 字）`}
                  action={
                    <Tooltip title="依据实例名称与声明用途，调用模型自动生成约 200 字的系统提示词">
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {TOOL_NAMES.map((name) => {
                const spec = config.tools[name];
                const Icon = TOOL_ICONS[name];
                const meta = TOOL_META[name];
                return (
                  <SectionCard key={name} padding={0} style={{ border: `1px solid ${spec.enabled ? 'var(--bb-brand-primary)' : 'var(--bb-border)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderBottom: spec.enabled ? '1px solid var(--bb-border)' : 'none' }}>
                      <Icon size={17} strokeWidth={1.5} style={{ color: spec.enabled ? 'var(--bb-brand-primary)' : 'var(--bb-text-3)', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--bb-text-1)' }}>{name}</span>
                          <span style={{ fontSize: 13, color: 'var(--bb-text-2)' }}>{meta.label}</span>
                          <SimBadge compact />
                        </div>
                        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}><InfoCircleOutlined /> {meta.desc}</Typography.Text>
                      </div>
                      <Switch checked={spec.enabled} onChange={(v) => patchTool(name, { enabled: v })} />
                    </div>
                    {spec.enabled && (
                      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--bb-bg-subtle)' }}>
                        <ToolPermEditor name={name} perm={spec.perm} onChange={(perm) => patchTool(name, { perm })} />
                      </div>
                    )}
                  </SectionCard>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <SectionCard title="调用约束" padding={16}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <SliderField label="单轮调用上限" hint="单轮对话内最多工具调用次数（1~20）" value={config.limits.max_calls_per_turn} min={1} max={20} onChange={(v) => patch({ limits: { ...config.limits, max_calls_per_turn: v } })} />
                <SliderField label="会话累计上限" hint="整个会话最多工具调用次数（1~500）" error={config.limits.max_calls_per_session < config.limits.max_calls_per_turn ? '会话调用上限不得小于单轮调用上限' : undefined} value={config.limits.max_calls_per_session} min={1} max={500} onChange={(v) => patch({ limits: { ...config.limits, max_calls_per_session: v } })} />
                <SliderField label="单次超时 (ms)" hint="单次调用超时阈值（1000~60000）" value={config.limits.timeout_ms} min={1000} max={60000} step={500} onChange={(v) => patch({ limits: { ...config.limits, timeout_ms: v } })} />
              </div>
            </SectionCard>
          )}

          {step === 3 && (
            <SectionCard title="防护档位" padding={16}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                {(['loose', 'standard', 'strict'] as const).map((preset) => {
                  const active = config.guard.preset === preset;
                  const meta = PRESET_META[preset];
                  return (
                    <button
                      key={preset}
                      aria-pressed={active}
                      onClick={() => patch({ guard: { ...config.guard, preset } })}
                      style={{
                        padding: 16,
                        borderRadius: 8,
                        border: `1px solid ${active ? 'var(--bb-brand-primary)' : 'var(--bb-border)'}`,
                        background: active ? 'var(--bb-bg-subtle)' : 'var(--bb-bg-card)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background-color 160ms ease, border-color 160ms ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: active ? 'var(--bb-brand-primary)' : 'var(--bb-text-1)' }}>{meta.label}</span>
                        {active && <Check size={18} style={{ color: 'var(--bb-brand-primary)' }} />}
                      </div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--bb-text-3)', marginBottom: 8 }}>{preset}</div>
                      <Typography.Text type="secondary"><InfoCircleOutlined /> {meta.desc}</Typography.Text>
                    </button>
                  );
                })}
              </div>
              <Collapse
                ghost
                style={{ marginTop: 16 }}
                items={[{
                  key: 'guard-help',
                  label: '防护档位说明',
                  children: <Typography.Text type="secondary"><InfoCircleOutlined /> 防护档位决定 L2 注入阈值与 L3 语义层的介入频率。严格档位会对任何越权迹象阻断并做跨轮一致性检查；宽松档位仅拦截高危越权。工具存在性硬规则在任何档位下都不允许停用。</Typography.Text>,
                }]}
              />
            </SectionCard>
          )}

          {/* 底部操作 */}
          <div data-tour="orch-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>上一步</Button>
              <Button disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>下一步</Button>
            </div>
            <div className="bb-orch-actions" style={{ display: 'flex', gap: 8 }}>
              <Button icon={<Check size={15} />} loading={validateMutation.isPending} onClick={() => validateMutation.mutate()}>校验配置</Button>
              <Button icon={<Save size={15} />} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>保存配置</Button>
              <Button type="primary" icon={<Rocket size={15} />} loading={createInstanceMutation.isPending} onClick={() => createInstanceMutation.mutate()}>创建实例</Button>
            </div>
          </div>
        </div>

        {/* 右侧实时预览 */}
        <div className="bb-orch-aside" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 24 }}>
          <Card title="配置案卷" size="small" variant="borderless">
            <Descriptions bordered={false} column={1} size="small" items={[
              { key: 'dossier', label: '案卷档号', children: <DossierNo no={configDossierNo} /> },
              { key: 'name', label: '名称', children: config.name || '—' },
              { key: 'preset', label: '防护档位', children: <PresetTag preset={config.guard.preset} size="sm" /> },
              {
                key: 'tools', label: `启用工具 (${enabled.length})`,
                children: <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {enabled.length === 0 && <Typography.Text type="secondary">未启用任何工具</Typography.Text>}
                  {enabled.map((t) => <Tag key={t} className="mono" style={{ margin: 0 }}>{t}</Tag>)}
                </div>,
              },
              { key: 'limits', label: '单轮 / 会话', children: `${config.limits.max_calls_per_turn} / ${config.limits.max_calls_per_session}` },
              { key: 'timeout', label: '超时', children: `${config.limits.timeout_ms}ms` },
            ]} />
          </Card>

          {validation && (!validation.valid || validation.warnings.length > 0) && (
            <Card title="校验结果" size="small" variant="borderless">
              {!validation.valid && validation.errors.map((e, i) => (
                <Form.Item key={i} layout="vertical" label={<span className="mono">{e.field}</span>} validateStatus="error" help={e.message} style={{ marginBottom: 16 }} />
              ))}
              {validation.warnings.map((w, i) => (
                <Typography.Text key={i} type="secondary" style={{ display: 'block', marginTop: 8 }}><InfoCircleOutlined /> {w.message}</Typography.Text>
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* 策略预览 Drawer */}
      <Drawer title="三级策略预览" width="min(560px, 100vw)" open={previewOpen} onClose={() => setPreviewOpen(false)}>
        {previewQuery.isLoading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--bb-text-3)' }}>生成策略中…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {(['L1', 'L2', 'L3'] as const).map((level) => (
              <Card
                key={level}
                size="small"
                variant="borderless"
                title={`${level} · ${level === 'L1' ? '确定性规则层' : level === 'L2' ? '注入分类层' : '语义判定层'}`}
                extra={<Typography.Text type="secondary">{grouped[level].length} 条</Typography.Text>}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {grouped[level].map((p) => (
                    <Descriptions key={p.policy_id} bordered={false} column={1} size="small" items={[
                      { key: 'id', label: '策略', children: <span className="mono">{p.policy_id} · {p.rule_type}</span> },
                      { key: 'action', label: '判定动作', children: <StatusBadge action={p.action} size="sm" /> },
                      { key: 'condition', label: '命中条件', children: p.condition },
                      { key: 'source', label: '来源', children: <span className="mono">{p.source}</span> },
                    ]} />
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Field({ label, required, hint, action, children }: { label: string; required?: boolean; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Form.Item
      layout="vertical"
      label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{label}{action}</span>}
      required={required}
      help={hint}
      style={{ marginBottom: 0 }}
    >
      {children}
    </Form.Item>
  );
}

function SliderField({ label, hint, error, value, min, max, step = 1, onChange }: { label: string; hint: string; error?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <Form.Item layout="vertical" label={label} help={error || hint} validateStatus={error ? 'error' : undefined} style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Slider aria-label={label} value={value} min={min} max={max} step={step} onChange={onChange} style={{ flex: 1 }} />
        <InputNumber aria-label={label} size="small" value={value} min={min} max={max} step={step} onChange={(v) => onChange(v ?? min)} style={{ width: 100 }} />
      </div>
    </Form.Item>
  );
}

function ToolPermEditor({ name, perm, onChange }: { name: ToolName; perm: Record<string, unknown>; onChange: (perm: Record<string, unknown>) => void }) {
  const listField = (key: string, label: string, placeholder: string) => (
    <Form.Item layout="vertical" label={label} style={{ marginBottom: 0 }}>
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
    </Form.Item>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--bb-text-2)' }}>
            <Switch size="small" checked={!!perm.overwrite} onChange={(v) => onChange({ ...perm, overwrite: v })} />
            允许覆写已存在文件
          </label>
        </>
      );
    case 'send_email':
      return (
        <>
          {listField('allow_domains', '允许收件域名', 'example.com')}
          <Form.Item layout="vertical" label="最大收件人数" style={{ marginBottom: 0 }}>
            <InputNumber min={1} max={50} value={(perm.max_recipients as number) ?? 3} onChange={(v) => onChange({ ...perm, max_recipients: v ?? 3 })} style={{ width: 120 }} />
          </Form.Item>
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