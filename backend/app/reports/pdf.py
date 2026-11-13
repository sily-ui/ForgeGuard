"""报告 PDF 导出（reportlab）：章节结构与在线内容一致，不裁剪告警明细。"""

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
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

_FONT_NAME = "ForgeGuardCJK"
_font_registered = False

_LEVEL_NAMES = {"high": "高危", "medium": "中危", "low": "低危", "none": "无"}
_ACTION_NAMES = {"allow": "放行", "block": "拦截", "challenge": "质询", "degrade": "降级放行"}
_KIND_NAMES = {"immediate": "立即可改的配置项", "tooling": "需改造的工具入参校验", "tradeoff": "需权衡的业务取舍"}


def _register_font():
    global _font_registered, _FONT_NAME
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
                _font_registered = True
                return
            except Exception:
                continue
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    _FONT_NAME = "STSong-Light"
    _font_registered = True


def _styles():
    _register_font()
    base = ParagraphStyle("base", fontName=_FONT_NAME, fontSize=10, leading=15)
    return {
        "title": ParagraphStyle("title", parent=base, fontSize=18, leading=24, spaceAfter=8),
        "h2": ParagraphStyle("h2", parent=base, fontSize=14, leading=20, spaceBefore=14, spaceAfter=6),
        "h3": ParagraphStyle("h3", parent=base, fontSize=11.5, leading=17, spaceBefore=8, spaceAfter=4),
        "body": base,
        "small": ParagraphStyle("small", parent=base, fontSize=8.5, leading=12),
        "mono": ParagraphStyle("mono", parent=base, fontSize=8, leading=11),
    }


def _p(text, style):
    escaped = (
        str(text if text is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return Paragraph(escaped, style)


def _table(rows, styles, widths=None):
    data = [[_p(cell, styles["small"]) for cell in row] for row in rows]
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def render_pdf(report):
    styles = _styles()
    content = report["content"]
    overview = content["part1_overview"]
    baseline = content["part2_baseline"]
    story = []

    story.append(_p(f"ForgeGuard 测评报告 {report['report_id']}", styles["title"]))
    story.append(
        _p(
            f"生成时间：{report['created_at']} ｜ 策略快照版本：{baseline.get('policy_snapshot_version')} ｜ "
            f"报告结构版本：{content.get('report_version')}",
            styles["small"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(_p(content.get("simulation_note", ""), styles["small"]))

    story.append(_p("一、测评概要", styles["h2"]))
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
    story.append(_table(kv_rows, styles, widths=[60 * mm, 110 * mm]))
    story.append(Spacer(1, 4))
    story.append(_p(f"总体结论：{overview.get('conclusion')}", styles["body"]))

    story.append(_p("二、靶标基线快照", styles["h2"]))
    story.append(_p(f"策略快照：{baseline.get('policy_snapshot_id')}", styles["body"]))
    story.append(_p(baseline.get("baseline_summary", ""), styles["small"]))
    story.append(_p("编排配置（原样）", styles["h3"]))
    story.append(_p(json.dumps(baseline.get("config"), ensure_ascii=False, indent=2), styles["mono"]))
    story.append(_p("生效策略条目", styles["h3"]))
    policy_rows = [["编号", "层级", "规则类型", "条件", "处置", "来源配置项"]]
    for policy in baseline.get("policies", []):
        policy_rows.append(
            [
                policy.get("policy_id", ""), policy.get("level", ""), policy.get("rule_type", ""),
                policy.get("condition", ""),
                _ACTION_NAMES.get(policy.get("action"), policy.get("action", "")),
                policy.get("source", ""),
            ]
        )
    story.append(_table(policy_rows, styles, widths=[24 * mm, 12 * mm, 30 * mm, 52 * mm, 16 * mm, 36 * mm]))

    story.append(_p("三、攻击序列", styles["h2"]))
    for turn in content["part3_attack_sequence"]:
        actor = "红队" if turn.get("actor") == "redteam" else "业务 Agent"
        story.append(_p(f"第 {turn['turn']} 轮（{actor}）", styles["h3"]))
        if turn.get("source_sample_id"):
            story.append(_p(f"样本：{turn['source_sample_id']}", styles["small"]))
        story.append(_p(f"输入：{turn['input']}", styles["body"]))
        story.append(_p(f"Agent 回复：{turn['agent_reply']}", styles["body"]))
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
            story.append(_table(call_rows, styles, widths=[22 * mm, 38 * mm, 16 * mm, 14 * mm, 64 * mm, 16 * mm]))
        else:
            story.append(_p("本轮无工具调用。", styles["small"]))

    story.append(_p("四、风险分析", styles["h2"]))
    if not content["part4_risk_analysis"]:
        story.append(_p("本次会话未产生告警。", styles["body"]))
    for alert in content["part4_risk_analysis"]:
        story.append(
            _p(
                f"{_LEVEL_NAMES.get(alert['level'], alert['level'])}告警 {alert['alert_id']}"
                f"（第 {alert['turn']} 轮，{alert.get('label', '')}）",
                styles["h3"],
            )
        )
        story.append(_p(f"结论：{alert['reason']}", styles["body"]))
        story.append(
            _p(
                f"处置：{_ACTION_NAMES.get(alert['action'], alert['action'])} ｜ "
                f"边界：{alert.get('boundary') or '会话级'} ｜ "
                f"根因：{alert.get('root_cause') or '证据不足，建议人工复核'}",
                styles["body"],
            )
        )
        for cause in alert.get("root_causes", []):
            story.append(_p(f"· {cause.get('basis', '')}", styles["small"]))
        for hit in alert.get("hit_policies", []):
            story.append(_p(f"命中策略：{hit.get('policy_id')} ← 来源配置项 {hit.get('source')}", styles["small"]))
        marks = []
        if alert.get("false_positive"):
            marks.append("已标记误报")
        if alert.get("false_negative"):
            marks.append("已标记漏报")
        if alert.get("note"):
            marks.append(f"备注：{alert['note']}")
        if marks:
            story.append(_p("；".join(marks), styles["small"]))

    story.append(_p("五、加固建议", styles["h2"]))
    for idx, suggestion in enumerate(content["part5_hardening"], 1):
        story.append(_p(f"建议 {idx}（{_KIND_NAMES.get(suggestion['kind'], suggestion['kind'])}）", styles["h3"]))
        story.append(_p(f"配置动作：{suggestion['action']}", styles["body"]))
        story.append(_p(f"预期效果：{suggestion['expected_effect']}", styles["body"]))
        if suggestion.get("cost"):
            story.append(_p(f"取舍代价：{suggestion['cost']}", styles["body"]))

    story.append(_p("六、局限性说明", styles["h2"]))
    for item in content["part6_limitations"]:
        story.append(_p(f"· {item}", styles["body"]))

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"ForgeGuard 测评报告 {report['report_id']}",
    )
    doc.build(story)
    return buffer.getvalue()