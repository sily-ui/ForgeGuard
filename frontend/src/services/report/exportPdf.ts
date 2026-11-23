// 浏览器端报告：在独立浅色文档内真实渲染 Ant Design，再按 A4 内容区等比切片。
import { createElement as h, type CSSProperties, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Card, ConfigProvider, Descriptions, Empty, List, Space, Table, Typography, theme, type ThemeConfig } from 'antd';
import { lightTheme } from '@/theme/antdTheme';
import type { AttackTurn, Report, ReportContent, RiskAnalysisItem } from '@/types/api';
import { ACTION_META, BOUNDARY_META, CATEGORY_NAMES, RISK_META, TOOL_META } from '@/utils/constants';
import { formatTime } from '@/utils/format';

const PAGE = { width: 210, height: 297, marginX: 14, marginTop: 16, marginBottom: 16 };
const CONTENT_MM = PAGE.width - PAGE.marginX * 2;
const LAYOUT_PX = 690;
const RENDER_SCALE = 2;
const PREFIX = 'pdf-ant';

// 不继承控制台的 Provider、CSS 变量或夜间算法；尺寸约束仅作用于导出文档。
const PDF_THEME: ThemeConfig = {
  ...lightTheme,
  inherit: false,
  algorithm: theme.defaultAlgorithm,
  cssVar: false,
  token: {
    ...lightTheme.token,
    motion: false,
    borderRadius: 8, borderRadiusXS: 0, borderRadiusSM: 8, borderRadiusLG: 8, borderRadiusOuter: 8,
    paddingXXS: 8, paddingXS: 8, paddingSM: 8, padding: 16, paddingMD: 16, paddingLG: 24, paddingXL: 32,
    marginXXS: 8, marginXS: 8, marginSM: 8, margin: 16, marginMD: 16, marginLG: 24, marginXL: 32, marginXXL: 32,
  },
  components: {
    ...lightTheme.components,
    Typography: { ...lightTheme.components?.Typography, titleMarginTop: 16, titleMarginBottom: 8 },
    Descriptions: {
      ...lightTheme.components?.Descriptions,
      itemPaddingBottom: 8, itemPaddingEnd: 16, titleMarginBottom: 16, colonMarginLeft: 0, colonMarginRight: 8,
    },
    Card: {
      ...lightTheme.components?.Card,
      borderRadiusLG: 8, bodyPadding: 16, bodyPaddingSM: 16, headerPadding: 16, headerPaddingSM: 16,
    },
    Table: {
      ...lightTheme.components?.Table,
      headerBorderRadius: 8, cellPaddingBlockSM: 8, cellPaddingInlineSM: 8,
    },
    List: { ...lightTheme.components?.List, itemPaddingSM: '8px 0', emptyTextPadding: 16 },
  },
};
const TOKEN = theme.getDesignToken(PDF_THEME);
const paragraphStyle: CSSProperties = { margin: '0 0 8px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const headingStyle: CSSProperties = { margin: '0 0 16px' };
const monoStyle: CSSProperties = { ...paragraphStyle, fontFamily: TOKEN.fontFamilyCode };
const descriptionProps = {
  bordered: false, column: 1, size: 'small' as const,
  styles: { label: { minWidth: 96 }, content: { minWidth: 0, whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const } },
};
const emptyProps = { image: null, style: { margin: '16px 0' }, styles: { image: { display: 'none' } } };

// 所有报告内容都作为 React 文本节点传入，不拼接 HTML，也不截断证据或对话。
const text = (value: unknown): string => {
  if (value === undefined || value === null) return '—';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
};
const riskLabel = (risk?: string | null) => RISK_META[risk ?? 'none']?.label ?? String(risk ?? '—');
const toolLabel = (tool?: string | null) => TOOL_META[tool ?? '']?.label ?? String(tool ?? '—');

const actionTag = (action?: string | null): ReactElement => {
  const meta = ACTION_META[action ?? ''];
  const color = action === 'allow' ? TOKEN.colorSuccessText : action === 'block' ? TOKEN.colorErrorText
    : action === 'challenge' ? TOKEN.colorWarningText : action === 'degrade' ? TOKEN.colorInfoText : TOKEN.colorTextSecondary;
  return h(Typography.Text, { strong: true, style: { color } }, meta ? `${meta.verb} · ${meta.label}` : text(action));
};
const riskTag = (risk?: string | null): ReactElement => {
  const color = risk === 'high' || risk === 'critical' ? TOKEN.colorErrorText : risk === 'medium' ? TOKEN.colorWarningText
    : risk === 'low' ? TOKEN.colorSuccessText : TOKEN.colorTextSecondary;
  return h(Typography.Text, { style: { color } }, `风险 ${riskLabel(risk)}`);
};
const permSummary = (perm: unknown): string => {
  if (!perm || typeof perm !== 'object') return '—';
  const entries = Object.entries(perm);
  return entries.length ? entries.map(([key, value]) => `${key}=${text(value)}`).join('\n') : '未限制';
};

function coverUnit(content: ReportContent, report: Report): ReactElement {
  const ov = content.part1_overview;
  return h('section', { className: 'unit', key: 'cover' },
    h(Typography.Title, { level: 1, style: headingStyle }, '越界之前 · Agent 越界测评报告'),
    h(Descriptions, {
      ...descriptionProps,
      items: [
        { key: 'instance', label: '靶标 Agent', children: text(ov.instance_name) },
        { key: 'snapshot', label: '快照', children: text(report.policy_snapshot_id) },
        { key: 'config', label: '配置', children: text(report.config_version) },
        { key: 'time', label: '测评时间', children: formatTime(ov.tested_at) },
        { key: 'session', label: '会话', children: text(ov.session_id) },
        { key: 'report', label: '报告', children: text(report.report_id) },
      ],
    }),
    h(Card, { size: 'small', variant: 'borderless', style: { margin: '8px 0 16px', background: TOKEN.colorFillAlter, boxShadow: 'none' } },
      h(Typography.Title, { level: 3, style: { margin: '0 0 8px' } }, '结论'),
      h(Typography.Paragraph, { style: { ...paragraphStyle, margin: 0 } }, text(ov.conclusion))),
    h(Typography.Paragraph, { type: 'secondary', style: paragraphStyle }, text(content.simulation_note)));
}

function overviewUnit(content: ReportContent): ReactElement {
  const ov = content.part1_overview;
  return h('section', { className: 'unit', key: 'overview' },
    h(Typography.Title, { level: 2, style: headingStyle }, '一、测评概要'),
    h(Typography.Paragraph, { style: paragraphStyle }, text(ov.purpose)),
    h(Descriptions, {
      ...descriptionProps,
      items: [
        { key: 'turns', label: '对话轮次', children: text(ov.turns) },
        { key: 'calls', label: '工具调用', children: text(ov.call_count) },
        { key: 'blocks', label: '拦截次数', children: text(ov.block_count) },
        { key: 'challenges', label: '质询次数', children: text(ov.challenge_count) },
        { key: 'limits', label: '限额拦截', children: text(ov.limit_block_count) },
        { key: 'score', label: '风险分', children: text(ov.risk_score) },
        { key: 'risk', label: '最高风险', children: riskTag(ov.max_risk) },
        { key: 'guard', label: '监护开关', children: ov.guard_enabled ? '已启用' : '已关闭' },
        { key: 'mode', label: '运行模式', children: text(ov.mode) },
        { key: 'version', label: '报告版本', children: text(content.report_version) },
      ],
    }));
}

function baselineUnit(content: ReportContent): ReactElement {
  const p2 = content.part2_baseline;
  const cfg = p2.config ?? ({} as ReportContent['part2_baseline']['config']);
  const tools = Object.entries(cfg.tools ?? {}).map(([name, spec]) => ({ name, spec }));
  const enabled = tools.filter(({ spec }) => spec?.enabled);
  const limits = cfg.limits;
  return h('section', { className: 'unit', key: 'baseline' },
    h(Typography.Title, { level: 2, style: headingStyle }, '二、靶标基线快照'),
    h(Typography.Paragraph, { style: paragraphStyle }, text(p2.baseline_summary)),
    h(Descriptions, {
      ...descriptionProps,
      items: [
        { key: 'snapshot', label: '快照编号', children: text(p2.policy_snapshot_id) },
        { key: 'version', label: '快照版本', children: text(p2.policy_snapshot_version) },
        { key: 'guard', label: '监护档位', children: text(cfg.guard?.preset) },
        { key: 'limits', label: '调用限额', children: `每轮 ${text(limits?.max_calls_per_turn)} ／ 每会话 ${text(limits?.max_calls_per_session)} ／ 超时 ${text(limits?.timeout_ms)}ms` },
        { key: 'name', label: '配置名称', children: text(cfg.name) },
        { key: 'purpose', label: '配置用途', children: text(cfg.purpose) },
        { key: 'configVersion', label: '配置版本', children: text(cfg.version) },
        { key: 'prompt', label: '系统提示词', children: text(cfg.system_prompt) },
        ...(cfg.guard?.overrides?.length ? [{ key: 'overrides', label: '监护覆盖', children: text(cfg.guard.overrides) }] : []),
        ...(cfg._unknown_tools?.length ? [{ key: 'unknown', label: '未识别工具', children: cfg._unknown_tools.join('、') }] : []),
      ],
    }),
    h(Typography.Title, { level: 3 }, `工具授权（${enabled.length}/${tools.length} 启用）`),
    h(Table<(typeof tools)[number]>, {
      size: 'small', pagination: false, tableLayout: 'fixed', rowKey: 'name', dataSource: tools,
      locale: { emptyText: h(Empty, { ...emptyProps, description: '未配置工具授权' }) },
      columns: [
        { title: '工具', key: 'name', width: '28%', render: (_, row) => h(Space, { direction: 'vertical', size: 0 },
          h(Typography.Text, null, toolLabel(row.name)), h(Typography.Text, { type: 'secondary', style: { fontFamily: TOKEN.fontFamilyCode } }, row.name)) },
        { title: '状态', key: 'enabled', width: '16%', render: (_, row) => h(Typography.Text, { style: { color: row.spec?.enabled ? TOKEN.colorSuccessText : TOKEN.colorTextSecondary } }, row.spec?.enabled ? '启用' : '停用') },
        { title: '允许范围', key: 'perm', render: (_, row) => h(Typography.Paragraph, { style: { ...monoStyle, margin: 0 } }, permSummary(row.spec?.perm)) },
      ],
    }));
}

function policiesUnit(content: ReportContent): ReactElement {
  const policies = content.part2_baseline.policies ?? [];
  return h('section', { className: 'unit', key: 'policies' },
    h(Typography.Title, { level: 3, style: headingStyle }, `策略集（${policies.length} 条）`),
    h(Table<(typeof policies)[number]>, {
      size: 'small', pagination: false, tableLayout: 'fixed', rowKey: 'policy_id', dataSource: policies,
      locale: { emptyText: h(Empty, { ...emptyProps, description: '本快照没有策略' }) },
      columns: [
        { title: '策略', key: 'policy', width: '24%', render: (_, p) => h(Space, { direction: 'vertical', size: 8 },
          h(Typography.Text, { style: { fontFamily: TOKEN.fontFamilyCode } }, p.policy_id),
          h(Typography.Text, null, `${p.level} · ${p.rule_type}`),
          p.origin === 'manual' ? h(Typography.Text, { type: 'warning' }, '人工覆盖') : null) },
        { title: '条件与参数', key: 'condition', width: '38%', render: (_, p) => h(Space, { direction: 'vertical', size: 8, style: { width: '100%' } },
          h(Typography.Paragraph, { style: { ...monoStyle, margin: 0 } }, text(p.condition)),
          Object.keys(p.params ?? {}).length ? h(Typography.Paragraph, { style: { ...monoStyle, margin: 0 } }, text(p.params)) : null,
          p.override_note ? h(Typography.Text, { type: 'secondary' }, p.override_note) : null) },
        { title: '处置', key: 'action', width: '20%', render: (_, p) => h(Space, { direction: 'vertical', size: 8 },
          actionTag(p.action), p.enabled === false ? h(Typography.Text, { type: 'secondary' }, '已停用') : null) },
        { title: '来源', dataIndex: 'source', key: 'source', render: (value: unknown) => text(value) },
      ],
    }));
}

function attackUnit(turn: AttackTurn, index: number): ReactElement {
  const calls = turn.calls ?? [];
  return h('section', { className: 'unit', key: `attack-${index}` },
    index === 0 ? h(Typography.Title, { level: 2, style: headingStyle }, '三、攻击序列') : null,
    h(Typography.Title, { level: 3, style: headingStyle }, `第 ${turn.turn} 轮${turn.actor === 'redteam' ? ' ｜ 红队探针' : ''}${turn.source_sample_id ? ` ｜ 样本 ${turn.source_sample_id}` : ''}`),
    h(Descriptions, {
      ...descriptionProps,
      items: [
        { key: 'actor', label: '参与方', children: text(turn.actor) },
        { key: 'input', label: '输入', children: text(turn.input) },
        { key: 'reply', label: 'Agent 回复', children: text(turn.agent_reply) },
      ],
    }),
    h(List<(typeof calls)[number]>, {
      size: 'small', dataSource: calls, rowKey: 'call_id',
      locale: { emptyText: h(Empty, { ...emptyProps, description: '本轮没有触发工具调用' }) },
      renderItem: (call) => h(List.Item, null, h(Descriptions, {
        ...descriptionProps, style: { width: '100%' },
        items: [
          { key: 'tool', label: '工具', children: toolLabel(call.tool) },
          { key: 'id', label: '调用编号', children: text(call.call_id) },
          { key: 'params', label: '参数', children: h(Typography.Paragraph, { style: { ...monoStyle, margin: 0 } }, text(call.params_summary)) },
          { key: 'action', label: '处置', children: actionTag(call.action) },
          { key: 'risk', label: '风险', children: riskTag(call.risk) },
          { key: 'reason', label: '判定依据', children: text(call.reason) },
          { key: 'duration', label: '耗时', children: `${text(call.duration_ms)}ms` },
        ],
      })),
    }));
}

function riskUnit(item: RiskAnalysisItem, index: number): ReactElement {
  const causes = item.root_causes ?? [];
  return h('section', { className: 'unit', key: `risk-${index}` },
    index === 0 ? h(Typography.Title, { level: 2, style: headingStyle }, '四、风险分析') : null,
    h(Typography.Title, { level: 3, style: headingStyle }, `${index + 1}. ${item.label || '风险条目'}`),
    h(Space, { size: 16, wrap: true, style: { margin: '0 0 8px' } }, riskTag(item.level), actionTag(item.action)),
    h(Typography.Paragraph, { type: 'secondary', style: paragraphStyle },
      `${BOUNDARY_META[item.boundary ?? ''] ?? item.boundary ?? ''}${item.session_level ? ' ｜ 会话级' : ''} ｜ 第 ${item.turn} 轮${item.call_id ? ` ｜ 调用 ${item.call_id}` : ''}`),
    h(Typography.Paragraph, { style: paragraphStyle }, text(item.reason)),
    item.root_cause ? h(Typography.Paragraph, { style: paragraphStyle }, `根因：${item.root_cause}`) : null,
    causes.length ? h(List<(typeof causes)[number]>, {
      size: 'small', header: h(Typography.Text, { strong: true }, '归因'), dataSource: causes,
      renderItem: (cause, causeIndex) => h(List.Item, { key: causeIndex },
        h(Space, { direction: 'vertical', size: 8, style: { width: '100%' } },
          h(Typography.Text, null, cause.name || CATEGORY_NAMES[cause.category] || cause.category),
          cause.evidence ? h(Typography.Paragraph, { style: { ...monoStyle, margin: 0 } }, text(cause.evidence)) : null)),
    }) : null,
    item.evidence_insufficient ? h(Typography.Paragraph, { type: 'warning', style: paragraphStyle }, '证据不足，结论仅供参考') : null,
    item.hit_policies?.length ? h(Typography.Paragraph, { type: 'secondary', style: paragraphStyle },
      `命中策略：${item.hit_policies.map((hit) => `${hit.policy_id}(${hit.source})`).join('，')}`) : null,
    item.false_positive || item.false_negative || item.note ? h(Typography.Paragraph, { style: paragraphStyle },
      [item.false_positive ? '已标记误报' : '', item.false_negative ? '已标记漏报' : '', item.note ?? ''].filter(Boolean).join(' ｜ ')) : null);
}

function hardeningUnit(content: ReportContent): ReactElement {
  const items = content.part5_hardening ?? [];
  const counts = content.rootcause_summary?.category_counts ?? {};
  return h('section', { className: 'unit', key: 'hardening' },
    h(Typography.Title, { level: 2, style: headingStyle }, '五、加固建议'),
    content.rootcause_summary ? h(Typography.Paragraph, { type: 'secondary', style: paragraphStyle },
      `归因分布：${Object.entries(counts).map(([key, value]) => `${CATEGORY_NAMES[key] ?? key} ${value}`).join(' ｜ ') || '无'}${content.rootcause_summary.dominant ? ` ｜ 主因 ${CATEGORY_NAMES[content.rootcause_summary.dominant] ?? content.rootcause_summary.dominant}` : ''}`) : null,
    h(Table<(typeof items)[number]>, {
      size: 'small', pagination: false, tableLayout: 'fixed',
      dataSource: items.map((item, index) => ({ ...item, key: `hardening-${index}` })),
      locale: { emptyText: h(Empty, { ...emptyProps, description: '本次测评没有加固建议' }) },
      columns: [
        { title: '类型', key: 'kind', width: '16%', render: (_, item) => item.kind === 'immediate' ? '立即可改' : item.kind === 'tooling' ? '工具改造' : '业务取舍' },
        { title: '建议动作', key: 'action', width: '38%', render: (_, item) => h(Space, { direction: 'vertical', size: 8 },
          h(Typography.Text, null, item.action),
          item.category_name || item.category ? h(Typography.Text, { type: 'secondary' }, item.category_name ?? CATEGORY_NAMES[item.category!] ?? item.category) : null,
          item.alert_id ? h(Typography.Text, { type: 'secondary' }, `关联告警：${item.alert_id}`) : null) },
        { title: '预期效果', dataIndex: 'expected_effect', key: 'effect', width: '30%' },
        { title: '代价', key: 'cost', render: (_, item) => text(item.cost) },
      ],
    }));
}

function limitationsUnit(content: ReportContent): ReactElement {
  return h('section', { className: 'unit', key: 'limitations' },
    h(Typography.Title, { level: 2, style: headingStyle }, '六、局限性说明'),
    h(List<string>, {
      size: 'small', dataSource: content.part6_limitations ?? [],
      locale: { emptyText: h(Empty, { ...emptyProps, description: '未提供局限性说明' }) },
      renderItem: (item, index) => h(List.Item, { key: index }, h(Typography.Text, null, item)),
    }),
    h(Typography.Paragraph, { type: 'secondary', style: { ...paragraphStyle, margin: '16px 0 0' } },
      '本报告由仿真链路生成：工具执行、模型回复均为离线仿真，不触达真实系统；风险结论用于演示监护策略有效性。'));
}

function units(content: ReportContent, report: Report): ReactElement[] {
  const attacks = content.part3_attack_sequence ?? [];
  const risks = content.part4_risk_analysis ?? [];
  return [
    coverUnit(content, report), overviewUnit(content), baselineUnit(content), policiesUnit(content),
    ...(attacks.length ? attacks.map(attackUnit) : [h('section', { className: 'unit', key: 'attacks-empty' },
      h(Typography.Title, { level: 2, style: headingStyle }, '三、攻击序列'), h(Empty, { ...emptyProps, description: '本次测评没有攻击序列' }))]),
    ...(risks.length ? risks.map(riskUnit) : [h('section', { className: 'unit', key: 'risks-empty' },
      h(Typography.Title, { level: 2, style: headingStyle }, '四、风险分析'), h(Empty, { ...emptyProps, description: '本次测评没有风险条目' }))]),
    hardeningUnit(content), limitationsUnit(content),
  ];
}

export function reportPdfFilename(report: Report): string {
  const name = report.content?.part1_overview?.instance_name || '靶标Agent';
  const safe = String(name).trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '靶标Agent';
  const date = (report.created_at || '').slice(0, 10).replace(/-/g, '');
  return `越界之前_测评报告_${safe}_${date}.pdf`;
}

function createFrame(): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', '报告 PDF 排版');
  Object.assign(frame.style, {
    position: 'fixed', left: '-10000px', top: '0', width: `${LAYOUT_PX}px`, height: '1024px',
    border: '0', background: TOKEN.colorBgContainer,
  });
  document.body.appendChild(frame);
  return frame;
}

// React 的 CSS-in-JS 插入目标通常仍是宿主 head。必须在 render/effects 后复制实际规则，
// 包括 CSSOM insertRule 写入的样式；link 保留绝对 URL，并等待加载结束。
async function copyStyles(doc: Document): Promise<void> {
  const base = doc.createElement('base');
  base.href = document.baseURI;
  doc.head.appendChild(base);
  const loads: Promise<void>[] = [];
  for (const source of document.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel~="stylesheet"]')) {
    if (source.disabled) continue;
    const clone = doc.importNode(source, true);
    clone.nonce = source.nonce;
    if (source instanceof HTMLStyleElement && clone instanceof doc.defaultView!.HTMLStyleElement) {
      try {
        if (source.sheet?.cssRules.length) clone.textContent = Array.from(source.sheet.cssRules, (rule) => rule.cssText).join('\n');
      } catch { /* 无权读取 CSSOM 时仍保留原始 style 内容。 */ }
    }
    if (source instanceof HTMLLinkElement) {
      const link = clone as HTMLLinkElement;
      link.href = source.href;
      loads.push(new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          link.onload = null;
          link.onerror = null;
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error('PDF 样式加载超时，请重试')), 15000);
        link.onload = () => finish();
        link.onerror = () => finish(new Error('PDF 样式加载失败，请重试'));
      }));
    }
    doc.head.appendChild(clone);
  }
  // 这里只处理排版文档边界与换行；组件外观仍由真实 Ant Design CSS 和 token 驱动。
  const layout = doc.createElement('style');
  layout.textContent = `
    html, body { margin: 0; padding: 0; height: auto; color-scheme: light;
      background: ${TOKEN.colorBgContainer}; color: ${TOKEN.colorText}; }
    #pdf-report { width: ${LAYOUT_PX}px; font-family: ${TOKEN.fontFamily};
      font-size: ${TOKEN.fontSize}px; line-height: ${TOKEN.lineHeight}; }
    #pdf-report, #pdf-report * { box-sizing: border-box; animation: none !important; transition: none !important; }
    #pdf-report .unit { width: 100%; padding: 0 0 24px; display: flow-root; overflow-wrap: anywhere; }
    #pdf-report .${PREFIX}-typography, #pdf-report .${PREFIX}-table-cell { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
    #pdf-report .${PREFIX}-table-cell { vertical-align: top; }
    #pdf-report .${PREFIX}-space-item { min-width: 0; max-width: 100%; }
    #pdf-report .${PREFIX}-descriptions-view table { table-layout: fixed; width: 100%; }
  `;
  doc.head.appendChild(layout);
  await Promise.all(loads);
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function waitForLayout(doc: Document, mount: HTMLElement): Promise<void> {
  // 先触发布局，以便 FontFaceSet 包含导出文档真正使用的字体，而不是空文档的 ready。
  mount.getBoundingClientRect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      doc.fonts.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PDF 字体加载超时，请重试')), 15000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  let last = '';
  let stable = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await nextFrame();
    const size = Array.from(mount.querySelectorAll<HTMLElement>('.unit'), (unit) => {
      const rect = unit.getBoundingClientRect();
      return `${rect.width}:${rect.height}:${rect.top}`;
    }).join('|');
    stable = size === last && doc.fonts.status === 'loaded' ? stable + 1 : 0;
    if (stable >= 3) return;
    last = size;
  }
  throw new Error('PDF 排版尚未稳定，请重试');
}

type PrintRange = { top: number; bottom: number };

function printRanges(section: HTMLElement): PrintRange[] {
  const top = section.getBoundingClientRect().top;
  const ranges: PrintRange[] = [];
  const add = (rect: DOMRect) => {
    // 共用的行边界必须同向取整，否则 1px 伪重叠会让分页不断回退。
    if (rect.height) ranges.push({ top: Math.round((rect.top - top) * RENDER_SCALE), bottom: Math.round((rect.bottom - top) * RENDER_SCALE) });
  };
  // 普通表格行/列表项尽量整体分页；超高行仍允许按文字行切开，不丢弃后半段。
  section.querySelectorAll(`tr, .${PREFIX}-list-item, h1, h2, h3`).forEach((node) => add(node.getBoundingClientRect()));
  const walker = section.ownerDocument.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  const range = section.ownerDocument.createRange();
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    Array.from(range.getClientRects()).forEach(add);
  }
  return ranges;
}

function sliceEnd(start: number, limit: number, total: number, pagePixels: number, ranges: PrintRange[]): number {
  const hardEnd = Math.min(start + limit, total);
  if (hardEnd === total) return hardEnd;
  let end = hardEnd;
  while (end > start) {
    const crossing = ranges.filter((range) => range.top < end && range.bottom > end && range.bottom - range.top <= pagePixels);
    if (!crossing.length) return end;
    const before = Math.min(...crossing.map((range) => range.top));
    if (before <= start) break;
    end = before;
  }
  // 即使单行/异常内容高过一页，也使用连续像素切片，绝不缩扁或跳过内容。
  return hardEnd;
}

export async function exportReportPdf(report: Report): Promise<string> {
  const content = report.content;
  if (!content) throw new Error('报告内容缺失，无法导出 PDF');
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const frame = createFrame();
  let root: Root | undefined;
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error('无法创建 PDF 排版文档');
    doc.documentElement.lang = 'zh-CN';
    doc.title = '越界之前 · Agent 越界测评报告';
    const mount = doc.createElement('main');
    mount.id = 'pdf-report';
    doc.body.replaceChildren(mount);
    root = createRoot(mount);
    flushSync(() => root!.render(h(ConfigProvider, { theme: PDF_THEME, prefixCls: PREFIX, componentSize: 'small' }, units(content, report))));
    await nextFrame();
    await nextFrame();
    await copyStyles(doc);
    await waitForLayout(doc, mount);

    const sections = Array.from(mount.querySelectorAll<HTMLElement>('.unit'));
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pageBottom = PAGE.height - PAGE.marginBottom;
    const pageHeight = pageBottom - PAGE.marginTop;
    let cursor = PAGE.marginTop;
    const newPage = () => { pdf.addPage(); cursor = PAGE.marginTop; };

    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      const widthPixels = Math.ceil(rect.width * RENDER_SCALE);
      const totalPixels = Math.ceil(rect.height * RENDER_SCALE);
      if (!widthPixels || !totalPixels) continue;
      const mmPerPixel = CONTENT_MM / widthPixels;
      const pagePixels = Math.floor(pageHeight / mmPerPixel);
      const ranges = printRanges(section);
      // 所有放不下的单元（包括超一页的单元）均先换页，不能挤进上一页剩余空间。
      if (cursor > PAGE.marginTop && totalPixels * mmPerPixel > pageBottom - cursor) newPage();
      let sourceTop = 0;
      while (sourceTop < totalPixels) {
        const availablePixels = Math.floor((pageBottom - cursor) / mmPerPixel);
        if (availablePixels < 1) { newPage(); continue; }
        const end = sliceEnd(sourceTop, availablePixels, totalPixels, pagePixels, ranges);
        const heightPixels = end - sourceTop;
        // 直接渲染有限高度的切片，避免先创建超长 canvas 触发浏览器尺寸上限而丢内容。
        const canvas = await html2canvas(section, {
          scale: RENDER_SCALE, backgroundColor: TOKEN.colorBgContainer, logging: false, useCORS: true,
          x: 0, y: sourceTop / RENDER_SCALE, width: widthPixels / RENDER_SCALE, height: heightPixels / RENDER_SCALE,
          windowWidth: LAYOUT_PX, scrollX: 0, scrollY: 0,
        });
        if (canvas.width !== widthPixels || canvas.height !== heightPixels) throw new Error('PDF 页面渲染尺寸异常，请重试');
        const heightMm = canvas.height * mmPerPixel;
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', PAGE.marginX, cursor, CONTENT_MM, heightMm, undefined, 'FAST');
        cursor += heightMm;
        sourceTop = end;
        canvas.width = 0;
        canvas.height = 0;
        if (sourceTop < totalPixels) newPage();
      }
    }

    // jsPDF 不接受 rgba token：在页面底色上合成辅助文字色，再读取 RGB。
    const swatch = doc.createElement('canvas');
    swatch.width = swatch.height = 1;
    const context = swatch.getContext('2d');
    if (!context) throw new Error('浏览器不支持 PDF 图像渲染');
    context.fillStyle = TOKEN.colorBgContainer;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = TOKEN.colorTextSecondary;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      pdf.setPage(page);
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(red, green, blue);
      pdf.text('BeforeBound · Agent Guard Assessment', PAGE.marginX, PAGE.height - 8);
      pdf.text(`${report.report_id}  ${page}/${pages}`, PAGE.width - PAGE.marginX, PAGE.height - 8, { align: 'right' });
    }
    const filename = reportPdfFilename(report);
    pdf.save(filename);
    return filename;
  } finally {
    try { root?.unmount(); } finally { frame.remove(); }
  }
}
