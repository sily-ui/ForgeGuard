"""报告 PDF 导出（reportlab）：章节结构与在线内容一致，不裁剪告警明细。

排版：品牌色封面抬头 + 页眉页脚页码 + 彩色表头表格 + 风险/处置着色，
编排配置以可读表格呈现（不再原样倾倒 JSON）。
"""

import io
import json
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_FONT_NAME = "ForgeGuardCJK"
_FONT_BOLD = "ForgeGuardCJK-Bold"
_font_registered = False

_LEVEL_NAMES = {"high": "高危", "medium": "中危", "low": "低危", "none": "无"}
_ACTION_NAMES = {"allow": "放行", "block": "拦截", "challenge": "质询", "degrade": "降级放行"}
_KIND_NAMES = {"immediate": "立即可改的配置项", "tooling": "需改造的工具入参校验", "tradeoff": "需权衡的业务取舍"}
_TOOL_NAMES = {
    "read_file": "读取文件", "write_file": "写入文件", "send_email": "发送邮件",
    "query_api": "查询接口", "run_cmd": "执行命令", "update_config": "修改配置",
}

BRAND = colors.HexColor("#1f6b5e")
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
LINE = colors.HexColor("#e5e7eb")
ZEBRA = colors.HexColor("#f6faf8")
RED = colors.HexColor("#a33d3f")
AMBER = colors.HexColor("#b45309")
BLUE = colors.HexColor("#3d6488")
GREEN = colors.HexColor("#2e7d5b")

_LEVEL_COLORS = {"high": "#a33d3f", "medium": "#b45309", "low": "#3d6488", "none": "#6b7280"}
_ACTION_COLORS = {"block": "#a33d3f", "challenge": "#b45309", "degrade": "#3d6488", "allow": "#2e7d5b"}


def _register_font():
    global _font_registered, _FONT_NAME, _FONT_BOLD
    if _font_registered:
        return
    candidates = [
        os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        for name in ("msyh.ttc", "msyh.ttf", "simhei.ttf", "simsun.ttc")
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont(_FONT_NAME, path))
                try:
                    pdfmetrics.registerFont(TTFont(_FONT_BOLD, path, subfontIndex=1))
                except Exception:
                    _FONT_BOLD = _FONT_NAME
                _font_registered = True
                return
            except Exception:
                continue
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    _FONT_NAME = "STSong-Light"
    _FONT_BOLD = "STSong-Light"
    _font_registered = True


def _styles():
    _register_font()
    base = ParagraphStyle("base", fontName=_FONT_NAME, fontSize=9.5, leading=15, textColor=INK)
    return {
        "title": ParagraphStyle("title", parent=base, fontName=_FONT_BOLD, fontSize=21, leading=28, textColor=BRAND),
        "subtitle": ParagraphStyle("subtitle", parent=base, fontName=_FONT_BOLD, fontSize=13, leading=19, textColor=INK, spaceBefore=2),
        "h2": ParagraphStyle("h2", parent=base, fontName=_FONT_BOLD, fontSize=13.5, leading=19, textColor=BRAND, spaceBefore=14, spaceAfter=2),
        "h3": ParagraphStyle("h3", parent=base, fontName=_FONT_BOLD, fontSize=10.5, leading=16, textColor=INK, spaceBefore=8, spaceAfter=3),
        "body": base,
        "label": ParagraphStyle("label", parent=base, fontName=_FONT_BOLD, textColor=MUTED),
        "small": ParagraphStyle("small", parent=base, fontSize=8.5, leading=12.5, textColor=MUTED),
        "mono": ParagraphStyle("mono", parent=base, fontSize=8, leading=11.5),
        "th": ParagraphStyle("th", parent=base, fontName=_FONT_BOLD, fontSize=8.5, leading=12, textColor=colors.white),
        "td": ParagraphStyle("td", parent=base, fontSize=8.5, leading=12.5),
        "stat_num": ParagraphStyle("stat_num", parent=base, fontName=_FONT_BOLD, fontSize=17, leading=22, alignment=1),
        "stat_label": ParagraphStyle("stat_label", parent=base, fontSize=8.5, leading=12, textColor=MUTED, alignment=1),
    }


def _escape(text):
    return (
        str(text if text is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )


def _p(text, style):
    return Paragraph(_escape(text), style)


def _colored(text, hex_color, style):
    return Paragraph(f'<font color="{hex_color}">{_escape(text)}</font>', style)


def _table(rows, styles, widths=None, colored_cols=None):
    """colored_cols: {列索引: {文本: 颜色}}，用于风险/处置等着色。"""
    colored_cols = colored_cols or {}

    def cell(value, style):
        return value if isinstance(value, Paragraph) else _p(value, style)

    data = []
    for r, row in enumerate(rows):
        cells = []
        for c, value in enumerate(row):
            if r == 0:
                cells.append(cell(value, styles["th"]))
            elif c in colored_cols and str(value) in colored_cols[c]:
                cells.append(_colored(value, colored_cols[c][str(value)], styles["td"]))
            else:
                cells.append(cell(value, styles["td"]))
        data.append(cells)
    table = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, BRAND),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ZEBRA]),
    ]
    table.setStyle(TableStyle(style))
    return table


def _section(story, styles, title):
    story.append(_p(title, styles["h2"]))
    story.append(HRFlowable(width="100%", thickness=0.6, color=LINE, spaceAfter=6))


def _kv(label, value, styles):
    return [_p(label, styles["label"]), _p(value, styles["td"])]


class _NumberedCanvas(Canvas):
    """两遍渲染：先攒页面状态，save 时统一补「第 X / Y 页」页脚。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._states = []

    def showPage(self):
        self._states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._states)
        for state in self._states:
            self.__dict__.update(state)
            self._draw_footer(total)
            super().showPage()
        super().save()

    def _draw_footer(self, total):
        width, _height = A4
        self.saveState()
        self.setStrokeColor(LINE)
        self.setLineWidth(0.5)
        self.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
        self.setFont(_FONT_NAME, 7.5)
        self.setFillColor(MUTED)
        self.drawString(18 * mm, 10 * mm, "越界之前 BeforeBound · 全内存仿真测评，不触及真实系统")
        self.drawRightString(width - 18 * mm, 10 * mm, f"第 {self.getPageNumber()} / {total} 页")
        self.restoreState()


def _page_header(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setStrokeColor(BRAND)
    canvas.setLineWidth(1.2)
    canvas.line(18 * mm, height - 12 * mm, width - 18 * mm, height - 12 * mm)
    canvas.setFont(_FONT_BOLD, 8)
    canvas.setFillColor(BRAND)
    canvas.drawString(18 * mm, height - 10 * mm, "越界之前 BeforeBound · Agent 安全实验室")
    canvas.setFont(_FONT_NAME, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width - 18 * mm, height - 10 * mm, "Agent 安全测评报告")
    canvas.restoreState()


def _config_tables(config, styles):
    """编排配置的可读呈现：基础项 + 每工具权限 + 调用约束。"""
    flow = []
    rows = [["配置项", "内容"]]
    rows.append(_kv("实例名称", config.get("name", ""), styles))
    rows.append(_kv("声明用途", config.get("purpose", ""), styles))
    rows.append(_kv("系统提示词", config.get("system_prompt", ""), styles))
    guard = config.get("guard") or {}
    preset_names = {"standard": "标准", "strict": "严格", "relaxed": "宽松"}
    guard_text = preset_names.get(guard.get("preset"), guard.get("preset", ""))
    if guard.get("overrides"):
        guard_text += f"（含 {len(guard['overrides'])} 条人工改写）"
    rows.append(_kv("防护档位", guard_text, styles))
    limits = config.get("limits") or {}
    rows.append(
        _kv(
            "调用约束",
            f"单轮 ≤ {limits.get('max_calls_per_turn', '')} 次 ｜ 会话 ≤ {limits.get('max_calls_per_session', '')} 次 ｜ "
            f"单次超时 {limits.get('timeout_ms', '')} ms",
            styles,
        )
    )
    flow.append(_table(rows, styles, widths=[30 * mm, 144 * mm]))
    flow.append(Spacer(1, 6))

    tool_rows = [["工具", "状态", "权限边界"]]
    for name, spec in (config.get("tools") or {}).items():
        enabled = spec.get("enabled")
        perm = json.dumps(spec.get("perm") or {}, ensure_ascii=False, separators=(",", ":"))
        tool_rows.append([
            f"{_TOOL_NAMES.get(name, name)}（{name}）",
            "启用" if enabled else "停用",
            perm if enabled else "—",
        ])
    flow.append(
        _table(
            tool_rows, styles, widths=[42 * mm, 14 * mm, 118 * mm],
            colored_cols={1: {"启用": "#2e7d5b", "停用": "#6b7280"}},
        )
    )
    return flow


def render_pdf(report):
    styles = _styles()
    content = report["content"]
    overview = content["part1_overview"]
    baseline = content["part2_baseline"]
    story = []

    # 封面抬头
    story.append(_p("Agent 安全测评报告", styles["title"]))
    story.append(_p(overview.get("instance_name") or "靶标 Agent", styles["subtitle"]))
    story.append(Spacer(1, 4))
    story.append(
        _p(
            f"报告编号 {report['report_id']} ｜ 生成时间 {report['created_at']} ｜ "
            f"策略快照版本 {baseline.get('policy_snapshot_version')} ｜ 报告结构版本 {content.get('report_version')}",
            styles["small"],
        )
    )
    story.append(Spacer(1, 2))
    story.append(_p(content.get("simulation_note", ""), styles["small"]))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=1.2, color=BRAND, spaceAfter=4))

    # 风险速览
    max_risk = overview.get("max_risk")
    stats = [
        [
            _colored(str(overview.get("block_count", 0)), "#a33d3f", styles["stat_num"]),
            _colored(str(overview.get("challenge_count", 0)), "#b45309", styles["stat_num"]),
            _colored(_LEVEL_NAMES.get(max_risk, max_risk), _LEVEL_COLORS.get(max_risk, "#6b7280"), styles["stat_num"]),
        ],
        [_p("拦截次数", styles["stat_label"]), _p("质询次数", styles["stat_label"]), _p("最高风险等级", styles["stat_label"])],
    ]
    stats_table = Table(stats, colWidths=[58 * mm] * 3)
    stats_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ZEBRA),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("LINEAFTER", (0, 0), (1, -1), 0.5, LINE),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(stats_table)

    _section(story, styles, "一、测评概要")
    kv_rows = [["项目", "值"]]
    for label, key in (
        ("实例名称", "instance_name"), ("用途", "purpose"), ("会话标识", "session_id"),
        ("测试时间", "tested_at"), ("轮次", "turns"), ("工具调用次数", "call_count"),
        ("拦截次数", "block_count"), ("质询次数", "challenge_count"),
        ("限额阻断次数（不计入拦截）", "limit_block_count"),
        ("最高风险等级", "max_risk"), ("累计风险分", "risk_score"), ("运行模式", "mode"),
    ):
        value = overview.get(key)
        if key == "max_risk":
            value = _LEVEL_NAMES.get(value, value)
        kv_rows.append([label, str(value if value is not None else "")])
    story.append(_table(kv_rows, styles, widths=[60 * mm, 114 * mm]))
    story.append(Spacer(1, 6))
    conclusion = Paragraph(
        f'<font color="#1f6b5e"><b>总体结论：</b></font>{_escape(overview.get("conclusion"))}',
        styles["body"],
    )
    story.append(conclusion)

    _section(story, styles, "二、靶标基线快照")
    story.append(_p(f"策略快照：{baseline.get('policy_snapshot_id')}", styles["small"]))
    story.append(Spacer(1, 2))
    story.append(_p(baseline.get("baseline_summary", ""), styles["body"]))
    story.append(_p("编排配置", styles["h3"]))
    story.extend(_config_tables(baseline.get("config") or {}, styles))
    story.append(_p("生效策略条目", styles["h3"]))
    policy_rows = [["编号", "层级", "规则类型", "条件", "处置", "来源配置项"]]
    action_colors = {_ACTION_NAMES.get(k, k): v for k, v in _ACTION_COLORS.items()}
    for policy in baseline.get("policies", []):
        policy_rows.append(
            [
                policy.get("policy_id", ""), policy.get("level", ""), policy.get("rule_type", ""),
                policy.get("condition", ""),
                _ACTION_NAMES.get(policy.get("action"), policy.get("action", "")),
                policy.get("source", ""),
            ]
        )
    story.append(
        _table(
            policy_rows, styles, widths=[24 * mm, 12 * mm, 30 * mm, 52 * mm, 16 * mm, 40 * mm],
            colored_cols={4: action_colors},
        )
    )

    _section(story, styles, "三、攻击序列")
    for turn in content["part3_attack_sequence"]:
        actor = "红队" if turn.get("actor") == "redteam" else "业务 Agent"
        block = [_p(f"第 {turn['turn']} 轮（{actor}）", styles["h3"])]
        if turn.get("source_sample_id"):
            block.append(_p(f"样本：{turn['source_sample_id']}", styles["small"]))
        block.append(
            Paragraph(f'<b>输入：</b>{_escape(turn["input"])}', styles["body"])
        )
        block.append(
            Paragraph(f'<b>Agent 回复：</b>{_escape(turn["agent_reply"])}', styles["body"])
        )
        if turn["calls"]:
            call_rows = [["工具", "参数摘要", "处置", "风险", "理由", "耗时ms"]]
            for call in turn["calls"]:
                call_rows.append(
                    [
                        call["tool"],
                        json.dumps(call["params_summary"], ensure_ascii=False),
                        _ACTION_NAMES.get(call.get("action"), call.get("action", "")),
                        _LEVEL_NAMES.get(call.get("risk"), call.get("risk", "")),
                        call.get("reason", ""), str(call.get("duration_ms", "")),
                    ]
                )
            level_colors = {_LEVEL_NAMES.get(k, k): v for k, v in _LEVEL_COLORS.items()}
            block.append(Spacer(1, 3))
            block.append(
                _table(
                    call_rows, styles, widths=[22 * mm, 38 * mm, 16 * mm, 14 * mm, 68 * mm, 16 * mm],
                    colored_cols={2: action_colors, 3: level_colors},
                )
            )
        else:
            block.append(_p("本轮无工具调用。", styles["small"]))
        story.append(KeepTogether(block))

    _section(story, styles, "四、风险分析")
    if not content["part4_risk_analysis"]:
        story.append(_p("本次会话未产生告警。", styles["body"]))
    for alert in content["part4_risk_analysis"]:
        level = alert["level"]
        block = [
            Paragraph(
                f'<font color="{_LEVEL_COLORS.get(level, "#6b7280")}"><b>{_LEVEL_NAMES.get(level, level)}告警</b></font> '
                f'{_escape(alert["alert_id"])}（第 {alert["turn"]} 轮，{_escape(alert.get("label", ""))}）',
                styles["h3"],
            ),
            Paragraph(f'<b>结论：</b>{_escape(alert["reason"])}', styles["body"]),
            Paragraph(
                f'<b>处置：</b>{_escape(_ACTION_NAMES.get(alert["action"], alert["action"]))} ｜ '
                f'<b>边界：</b>{_escape(alert.get("boundary") or "会话级")} ｜ '
                f'<b>根因：</b>{_escape(alert.get("root_cause") or "证据不足，建议人工复核")}',
                styles["body"],
            ),
        ]
        for cause in alert.get("root_causes", []):
            block.append(_p(f"· {cause.get('basis', '')}", styles["small"]))
        for hit in alert.get("hit_policies", []):
            block.append(_p(f"命中策略：{hit.get('policy_id')} ← 来源配置项 {hit.get('source')}", styles["small"]))
        marks = []
        if alert.get("false_positive"):
            marks.append("已标记误报")
        if alert.get("false_negative"):
            marks.append("已标记漏报")
        if alert.get("note"):
            marks.append(f"备注：{alert['note']}")
        if marks:
            block.append(_p("；".join(marks), styles["small"]))
        story.append(KeepTogether(block))
        story.append(Spacer(1, 4))

    _section(story, styles, "五、加固建议")
    for idx, suggestion in enumerate(content["part5_hardening"], 1):
        block = [
            _p(f"建议 {idx}（{_KIND_NAMES.get(suggestion['kind'], suggestion['kind'])}）", styles["h3"]),
            Paragraph(f'<b>配置动作：</b>{_escape(suggestion["action"])}', styles["body"]),
            Paragraph(f'<b>预期效果：</b>{_escape(suggestion["expected_effect"])}', styles["body"]),
        ]
        if suggestion.get("cost"):
            block.append(Paragraph(f'<b>取舍代价：</b>{_escape(suggestion["cost"])}', styles["body"]))
        story.append(KeepTogether(block))

    _section(story, styles, "六、局限性说明")
    for item in content["part6_limitations"]:
        story.append(_p(f"· {item}", styles["body"]))

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=20 * mm, bottomMargin=20 * mm,
        title=f"Agent 安全测评报告 {overview.get('instance_name') or ''} {report['report_id']}",
        author="越界之前 BeforeBound · Agent 安全实验室",
    )
    doc.build(story, onFirstPage=_page_header, onLaterPages=_page_header, canvasmaker=_NumberedCanvas)
    return buffer.getvalue()