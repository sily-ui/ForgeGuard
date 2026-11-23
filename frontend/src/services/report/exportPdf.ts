// 浏览器端测评报告 PDF 导出：后端 reportlab 已按方案B移除，这里用排版 DOM + html2canvas + jsPDF 生成。
// 只使用 16 进制颜色与系统字体：html2canvas 不支持 oklch/color-mix，宿主主题变量不能让它们进排版文档。
import type { AttackTurn, Report, ReportContent, RiskAnalysisItem } from '@/types/api';
import { ACTION_META, BOUNDARY_META, CATEGORY_NAMES, RISK_META, TOOL_META } from '@/utils/constants';
import { formatTime } from '@/utils/format';

const PAGE = { width: 210, height: 297, marginX: 14, marginTop: 16, marginBottom: 16 };
const CONTENT_MM = PAGE.width - PAGE.marginX * 2;
// 排版视口宽度：794px 约为 A4 内容宽在 96dpi 下的像素宽，字号即按此基准设计。
const LAYOUT_PX = 690;
const RENDER_SCALE = 2;

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:${LAYOUT_PX}px;background:#ffffff;color:#14161a;
  font:13px/1.62 "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.unit{width:${LAYOUT_PX}px;padding:0 0 10px}
h1{font-size:26px;line-height:1.25;letter-spacing:.5px}
h2{font-size:17px;margin:6px 0 8px;padding-bottom:6px;border-bottom:2px solid #14161a}
h3{font-size:14px;margin:8px 0 4px}
p{margin:3px 0}
.muted{color:#6b7280}
.mono{font-family:"JetBrains Mono",Consolas,monospace}
.eyebrow{font-size:11px;letter-spacing:2px;color:#6b7280;text-transform:uppercase}
.rule{height:1px;background:#e5e7eb;margin:8px 0}
.grid{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
.cell{width:157px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:4px;background:#f7f8fa}
.cell b{display:block;font-size:17px;font-weight:600}
.cell span{font-size:11px;color:#6b7280}
table{width:100%;border-collapse:collapse;margin:6px 0;font-size:12px}
th,td{border:1px solid #dfe2e6;padding:5px 7px;text-align:left;vertical-align:top;word-break:break-word}
th{background:#f2f3f5;font-weight:600;white-space:nowrap}
.tag{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;border:1px solid #dfe2e6;background:#f2f3f5}
.allow{color:#1f8a5b;border-color:#b7e0cb;background:#eef8f2}
.block{color:#c0392b;border-color:#f0c3bd;background:#fdf0ee}
.challenge{color:#b7791f;border-color:#eeddb0;background:#fdf7e9}
.degrade{color:#7c5cbf;border-color:#d5c8ee;background:#f4f0fb}
.limit{color:#2b6cb0;border-color:#c3d9f0;background:#eef4fb}
.neutral{color:#4b5563}
.card{border:1px solid #e5e7eb;border-left:3px solid #14161a;border-radius:3px;padding:8px 10px;margin:6px 0;background:#fcfcfd}
.quote{border-left:3px solid #c9ccd1;padding:4px 10px;margin:4px 0;background:#f7f8fa;white-space:pre-wrap}
ol,ul{margin:4px 0 4px 20px}
li{margin:2px 0}
`;

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const riskLabel = (risk?: string | null) => RISK_META[risk ?? 'none']?.label ?? String(risk ?? '—');

const actionTag = (action?: string | null): string => {
  const meta = ACTION_META[action ?? ''];
  if (!meta) return `<span class="tag neutral">${esc(action ?? '—')}</span>`;
  const cls = action === 'allow' ? 'allow' : action === 'block' ? 'block'
    : action === 'challenge' ? 'challenge' : action === 'degrade' ? 'degrade' : 'limit';
  return `<span class="tag ${cls}">${esc(meta.verb)} · ${esc(meta.label)}</span>`;
};

const riskTag = (risk?: string | null): string => {
  const cls = risk === 'high' || risk === 'critical' ? 'block' : risk === 'medium' ? 'challenge'
    : risk === 'low' ? 'allow' : 'neutral';
  return `<span class="tag ${cls}">风险 ${esc(riskLabel(risk))}</span>`;
};

const toolLabel = (tool?: string | null): string => TOOL_META[tool ?? '']?.label ?? String(tool ?? '—');

const short = (value: unknown, limit = 220): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const permSummary = (perm: unknown): string => {
  if (!perm || typeof perm !== 'object') return '—';
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(perm as Record<string, unknown>)) {
    if (raw === undefined || raw === null || raw === false) continue;
    if (typeof raw === 'boolean') {
      if (raw) parts.push(key);
      continue;
    }
    const list = Array.isArray(raw) ? raw : [raw];
    const text = list.map((v) => String(v)).filter(Boolean);
    if (!text.length) continue;
    parts.push(`${key}=${text.join(', ')}`);
  }
  return parts.length ? short(parts.join(' · '), 400) : ' unrestricted';
};

function coverUnit(content: ReportContent, report: Report): string {
  const ov = content.part1_overview;
  return `
<div class="unit">
  <p class="eyebrow">BeforeBound · Agent Guard Assessment</p>
  <h1>越界之前 · Agent 越界测评报告</h1>
  <div class="rule"></div>
  <p><b>${esc(ov.instance_name)}</b><span class="muted"> ｜ 快照 ${esc(report.policy_snapshot_id)} ｜ 配置 ${esc(report.config_version)}</span></p>
  <p class="muted">测评时间 ${esc(formatTime(ov.tested_at))} ｜ 会话 ${esc(ov.session_id)} ｜ 报告 ${esc(report.report_id)}</p>
  <div class="card">
    <h3>结论</h3>
    <p>${esc(ov.conclusion)}</p>
  </div>
  <p class="muted">${esc(content.simulation_note)}</p>
</div>`;
}

function overviewUnit(content: ReportContent): string {
  const ov = content.part1_overview;
  const cell = (label: string, value: unknown) => `<div class="cell"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  return `
<div class="unit">
  <h2>一、测评概要</h2>
  <p>${esc(ov.purpose || '')}</p>
  <div class="grid">
    ${cell('对话轮次', ov.turns)}
    ${cell('工具调用', ov.call_count)}
    ${cell('拦截次数', ov.block_count)}
    ${cell('质询次数', ov.challenge_count)}
    ${cell('限额拦截', ov.limit_block_count)}
    ${cell('风险分', ov.risk_score)}
  </div>
  <table>
    <tr><th>最高风险</th><td>${riskTag(ov.max_risk)}</td><th>监护开关</th><td>${esc(ov.guard_enabled ? '已启用' : '已关闭')}</td></tr>
    <tr><th>运行模式</th><td>${esc(ov.mode)}</td><th>报告版本</th><td class="mono">${esc(content.report_version)}</td></tr>
  </table>
</div>`;
}

function baselineUnit(content: ReportContent): string {
  const p2 = content.part2_baseline;
  const cfg = p2.config ?? ({} as ReportContent['part2_baseline']['config']);
  const tools = Object.entries(cfg.tools ?? {});
  const enabled = tools.filter(([, t]) => t?.enabled);
  const limits = cfg.limits;
  return `
<div class="unit">
  <h2>二、靶标基线快照</h2>
  <p class="mono">${esc(p2.baseline_summary)}</p>
  <table>
    <tr><th>快照编号</th><td class="mono">${esc(p2.policy_snapshot_id)}</td><th>快照版本</th><td>${esc(p2.policy_snapshot_version ?? '—')}</td></tr>
    <tr><th>监护档位</th><td>${esc(cfg.guard?.preset ?? '—')}</td><th>调用限额</th><td>每轮 ${esc(limits?.max_calls_per_turn ?? '—')} ／ 每会话 ${esc(limits?.max_calls_per_session ?? '—')} ／ 超时 ${esc(limits?.timeout_ms ?? '—')}ms</td></tr>
  </table>
  <h3>工具授权（${enabled.length}/${tools.length} 启用）</h3>
  <table>
    <tr><th>工具</th><th>状态</th><th>允许范围</th></tr>
    ${tools.map(([name, spec]) => `
      <tr>
        <td>${esc(toolLabel(name))}<br><span class="muted mono">${esc(name)}</span></td>
        <td>${spec?.enabled ? '<span class="tag allow">启用</span>' : '<span class="tag neutral">停用</span>'}</td>
        <td class="mono">${esc(permSummary(spec?.perm))}</td>
      </tr>`).join('')}
  </table>
</div>`;
}

function policiesUnit(content: ReportContent): string {
  const policies = content.part2_baseline.policies ?? [];
  if (!policies.length) return '';
  return `
<div class="unit">
  <h3>策略集（${policies.length} 条）</h3>
  <table>
    <tr><th>策略</th><th>层级</th><th>类型</th><th>条件</th><th>处置</th><th>来源</th></tr>
    ${policies.map((p) => `
      <tr>
        <td class="mono">${esc(p.policy_id)}${p.origin === 'manual' ? '<br><span class="tag challenge">人工覆盖</span>' : ''}</td>
        <td>${esc(p.level)}</td>
        <td>${esc(p.rule_type)}</td>
        <td class="mono">${esc(short(p.condition, 260))}</td>
        <td>${actionTag(p.action)}${p.enabled === false ? '<br><span class="muted">已停用</span>' : ''}</td>
        <td class="mono">${esc(p.source)}</td>
      </tr>`).join('')}
  </table>
</div>`;
}

function attackUnit(turn: AttackTurn): string {
  const calls = turn.calls ?? [];
  return `
<div class="unit">
  <h3>第 ${esc(turn.turn)} 轮${turn.actor === 'redteam' ? ' ｜ 红队探针' : ''}${turn.source_sample_id ? ` ｜ 样本 ${esc(turn.source_sample_id)}` : ''}</h3>
  <p><b>输入</b></p>
  <div class="quote">${esc(short(turn.input, 900))}</div>
  <p><b>Agent 回复</b></p>
  <div class="quote">${esc(short(turn.agent_reply, 700))}</div>
  ${calls.length ? `
  <table>
    <tr><th>工具</th><th>参数</th><th>处置</th><th>风险</th><th>判定依据</th><th>耗时</th></tr>
    ${calls.map((c) => `
      <tr>
        <td>${esc(toolLabel(c.tool))}</td>
        <td class="mono">${esc(short(c.params_summary, 220))}</td>
        <td>${actionTag(c.action)}</td>
        <td>${riskTag(c.risk)}</td>
        <td>${esc(short(c.reason, 320))}</td>
        <td class="mono">${esc(c.duration_ms)}ms</td>
      </tr>`).join('')}
  </table>` : '<p class="muted">本轮没有触发工具调用。</p>'}
</div>`;
}

function riskUnit(item: RiskAnalysisItem, index: number): string {
  const causes = item.root_causes ?? [];
  return `
<div class="unit">
  <h3>${index + 1}. ${esc(item.label || '风险条目')} ${riskTag(item.level)} ${actionTag(item.action)}</h3>
  <p class="muted">${esc(BOUNDARY_META[item.boundary ?? ''] ?? item.boundary ?? '')}${item.session_level ? ' ｜ 会话级' : ''} ｜ 第 ${esc(item.turn)} 轮${item.call_id ? ` ｜ 调用 ${esc(item.call_id)}` : ''}</p>
  <p>${esc(item.reason)}</p>
  ${causes.length ? `<p><b>归因</b></p><ul>${causes.map((c) => `<li>${esc(c.name || CATEGORY_NAMES[c.category] || c.category)}${c.evidence ? `：<span class="mono">${esc(short(c.evidence, 240))}</span>` : ''}</li>`).join('')}</ul>` : ''}
  ${item.evidence_insufficient ? '<p class="tag challenge">证据不足，结论仅供参考</p>' : ''}
  ${item.hit_policies?.length ? `<p class="muted mono">命中策略：${esc(item.hit_policies.map((h) => `${h.policy_id}(${h.source})`).join('，'))}</p>` : ''}
</div>`;
}

function hardeningUnit(content: ReportContent): string {
  const items = content.part5_hardening ?? [];
  if (!items.length) return '';
  const counts = content.rootcause_summary?.category_counts ?? {};
  return `
<div class="unit">
  <h2>五、加固建议</h2>
  ${content.rootcause_summary ? `<p class="muted">归因分布：${esc(Object.entries(counts).map(([k, v]) => `${CATEGORY_NAMES[k] ?? k} ${v}`).join(' ｜ ') || '无')}${content.rootcause_summary.dominant ? ` ｜ 主因 ${esc(CATEGORY_NAMES[content.rootcause_summary.dominant] ?? content.rootcause_summary.dominant)}` : ''}</p>` : ''}
  <table>
    <tr><th>类型</th><th>建议动作</th><th>预期效果</th><th>代价</th></tr>
    ${items.map((s) => `
      <tr>
        <td>${esc(s.kind === 'immediate' ? '立即可改' : s.kind === 'tooling' ? '工具改造' : '业务取舍')}</td>
        <td>${esc(s.action)}${s.category_name || s.category ? `<br><span class="muted">${esc(s.category_name ?? CATEGORY_NAMES[s.category!] ?? s.category)}</span>` : ''}</td>
        <td>${esc(s.expected_effect)}</td>
        <td>${esc(s.cost ?? '—')}</td>
      </tr>`).join('')}
  </table>
</div>`;
}

function limitationsUnit(content: ReportContent): string {
  const items = content.part6_limitations ?? [];
  return `
<div class="unit">
  <h2>六、局限性说明</h2>
  <ul>${items.map((t) => `<li>${esc(t)}</li>`).join('') || '<li>—</li>'}</ul>
  <div class="rule"></div>
  <p class="muted">本报告由仿真链路生成：工具执行、模型回复均为离线仿真，不触达真实系统；风险结论用于演示监护策略有效性。</p>
</div>`;
}

function units(content: ReportContent, report: Report): string[] {
  return [
    coverUnit(content, report),
    overviewUnit(content),
    baselineUnit(content),
    policiesUnit(content),
    `<div class="unit"><h2>三、攻击序列</h2></div>`,
    ...(content.part3_attack_sequence ?? []).map(attackUnit),
    `<div class="unit"><h2>四、风险分析</h2></div>`,
    ...(content.part4_risk_analysis ?? []).map(riskUnit),
    hardeningUnit(content),
    limitationsUnit(content),
  ].filter(Boolean);
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
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${LAYOUT_PX}px;height:600px;border:0;background:#fff`;
  document.body.appendChild(frame);
  return frame;
}

function writeDocument(frame: HTMLIFrameElement, html: string): Document {
  const doc = frame.contentDocument;
  if (!doc) throw new Error('无法创建 PDF 排版文档');
  doc.open();
  doc.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${html}</body></html>`);
  doc.close();
  return doc;
}

async function waitForFonts(doc: Document): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts) {
    try {
      await Promise.race([fonts.ready, new Promise((resolve) => setTimeout(resolve, 1200))]);
    } catch { /* 字体就绪等待失败时按当前排版继续 */ }
  }
}

export async function exportReportPdf(report: Report): Promise<string> {
  const content = report.content;
  if (!content) throw new Error('报告内容缺失，无法导出 PDF');
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const frame = createFrame();
  try {
    const doc = writeDocument(frame, units(content, report).join(''));
    await waitForFonts(doc);
    const sections = Array.from(doc.querySelectorAll<HTMLElement>('.unit'));
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pageBottom = PAGE.height - PAGE.marginBottom;
    let cursor = PAGE.marginTop;
    let pages = 0;

    for (const section of sections) {
      const canvas = await html2canvas(section, {
        scale: RENDER_SCALE,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
      });
      if (!canvas.width || !canvas.height) continue;
      let heightMm = (canvas.height / canvas.width) * CONTENT_MM;
      const available = pageBottom - cursor;
      if (heightMm > available) {
        if (heightMm > pageBottom - PAGE.marginTop) {
          // 单块超一页：等比压缩到一页高度，保证不被裁掉。
          heightMm = pageBottom - PAGE.marginTop;
        } else {
          pdf.addPage();
          pages += 1;
          cursor = PAGE.marginTop;
        }
      }
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', PAGE.marginX, cursor, CONTENT_MM, heightMm, undefined, 'FAST');
      cursor += heightMm + 3;
    }

    pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
      pdf.setPage(p);
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120, 125, 133);
      pdf.text('BeforeBound · Agent Guard Assessment', PAGE.marginX, PAGE.height - 8);
      pdf.text(`${report.report_id}  ${p}/${pages}`, PAGE.width - PAGE.marginX, PAGE.height - 8, { align: 'right' });
    }
    const filename = reportPdfFilename(report);
    pdf.save(filename);
    return filename;
  } finally {
    frame.remove();
  }
}
