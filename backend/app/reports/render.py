"""报告网页渲染：与导出 PDF 内容一致，不裁剪告警明细。"""

import html
import json

_STATUS_COLORS = {"green": "#16a34a", "yellow": "#d97706", "red": "#dc2626", "gray": "#6b7280", "orange": "#ea580c"}
_LEVEL_NAMES = {"high": "高危", "medium": "中危", "low": "低危", "none": "无"}
_ACTION_NAMES = {"allow": "放行", "block": "拦截", "challenge": "质询", "degrade": "降级放行"}


def _e(value):
    return html.escape(str(value if value is not None else ""))


def _json_block(value):
    return html.escape(json.dumps(value, ensure_ascii=False, indent=2))


def render_html(report):
    content = report["content"]
    overview = content["part1_overview"]
    baseline = content["part2_baseline"]
    parts = []
    parts.append(f"<h1>ForgeGuard 测评报告 {_e(report['report_id'])}</h1>")
    parts.append(
        f"<p class='meta'>生成时间：{_e(report['created_at'])} ｜ 策略快照版本：{_e(baseline.get('policy_snapshot_version'))} ｜ "
        f"报告结构版本：{_e(content.get('report_version'))}</p>"
    )
    parts.append(f"<p class='sim-note'>{_e(content.get('simulation_note', ''))}</p>")

    parts.append("<h2>一、测评概要</h2>")
    parts.append("<table class='kv'>")
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
        parts.append(f"<tr><th>{_e(label)}</th><td>{_e(value)}</td></tr>")
    parts.append("</table>")
    parts.append(f"<p class='conclusion'><strong>总体结论：</strong>{_e(overview.get('conclusion'))}</p>")

    parts.append("<h2>二、靶标基线快照</h2>")
    parts.append(f"<p>策略快照：{_e(baseline.get('policy_snapshot_id'))}</p>")
    parts.append(f"<pre>{_e(baseline.get('baseline_summary'))}</pre>")
    parts.append("<h3>编排配置（原样）</h3>")
    parts.append(f"<pre>{_json_block(baseline.get('config'))}</pre>")
    parts.append("<h3>生效策略条目</h3>")
    parts.append("<table><tr><th>编号</th><th>层级</th><th>规则类型</th><th>条件</th><th>处置</th><th>来源配置项</th><th>启用</th></tr>")
    for policy in baseline.get("policies", []):
        parts.append(
            "<tr>"
            f"<td>{_e(policy.get('policy_id'))}</td><td>{_e(policy.get('level'))}</td>"
            f"<td>{_e(policy.get('rule_type'))}</td><td>{_e(policy.get('condition'))}</td>"
            f"<td>{_e(_ACTION_NAMES.get(policy.get('action'), policy.get('action')))}</td>"
            f"<td>{_e(policy.get('source'))}</td><td>{_e('是' if policy.get('enabled', True) else '否')}</td>"
            "</tr>"
        )
    parts.append("</table>")

    parts.append("<h2>三、攻击序列</h2>")
    for turn in content["part3_attack_sequence"]:
        actor = "红队" if turn.get("actor") == "redteam" else "业务 Agent"
        parts.append(f"<h3>第 {_e(turn['turn'])} 轮（{_e(actor)}）</h3>")
        if turn.get("source_sample_id"):
            parts.append(f"<p>样本：{_e(turn['source_sample_id'])}</p>")
        parts.append(f"<p><strong>输入：</strong>{_e(turn['input'])}</p>")
        parts.append(f"<p><strong>Agent 回复：</strong>{_e(turn['agent_reply'])}</p>")
        if turn["calls"]:
            parts.append("<table><tr><th>工具</th><th>参数摘要</th><th>处置</th><th>风险</th><th>理由</th><th>耗时(ms)</th></tr>")
            for call in turn["calls"]:
                color = _STATUS_COLORS.get(call.get("status_color"), "#374151")
                parts.append(
                    "<tr>"
                    f"<td>{_e(call['tool'])}</td><td><code>{_json_block(call['params_summary'])}</code></td>"
                    f"<td style='color:{color}'><strong>{_e(_ACTION_NAMES.get(call.get('action'), call.get('action')))}</strong></td>"
                    f"<td>{_e(_LEVEL_NAMES.get(call.get('risk'), call.get('risk')))}</td>"
                    f"<td>{_e(call.get('reason'))}</td><td>{_e(call.get('duration_ms'))}</td>"
                    "</tr>"
                )
            parts.append("</table>")
        else:
            parts.append("<p>本轮无工具调用。</p>")

    parts.append("<h2>四、风险分析</h2>")
    if not content["part4_risk_analysis"]:
        parts.append("<p>本次会话未产生告警。</p>")
    for alert in content["part4_risk_analysis"]:
        parts.append(
            f"<h3>{_e(_LEVEL_NAMES.get(alert['level'], alert['level']))}告警 {_e(alert['alert_id'])}"
            f"（第 {_e(alert['turn'])} 轮，{_e(alert.get('label'))}）</h3>"
        )
        parts.append(f"<p><strong>结论：</strong>{_e(alert['reason'])}</p>")
        parts.append(
            f"<p>处置：{_e(_ACTION_NAMES.get(alert['action'], alert['action']))} ｜ "
            f"边界：{_e(alert.get('boundary') or '会话级')} ｜ "
            f"根因：{_e(alert.get('root_cause') or '证据不足，建议人工复核')}</p>"
        )
        for cause in alert.get("root_causes", []):
            parts.append(f"<p class='cause'>· {_e(cause.get('basis'))}</p>")
        if alert.get("hit_policies"):
            parts.append("<p>命中策略：</p><ul>")
            for hit in alert["hit_policies"]:
                parts.append(f"<li>{_e(hit.get('policy_id'))} ← 来源配置项 {_e(hit.get('source'))}</li>")
            parts.append("</ul>")
        marks = []
        if alert.get("false_positive"):
            marks.append("已标记误报")
        if alert.get("false_negative"):
            marks.append("已标记漏报")
        if alert.get("note"):
            marks.append(f"备注：{alert['note']}")
        if marks:
            parts.append(f"<p>{_e('；'.join(marks))}</p>")

    parts.append("<h2>五、加固建议</h2>")
    kind_names = {"immediate": "立即可改的配置项", "tooling": "需改造的工具入参校验", "tradeoff": "需权衡的业务取舍"}
    for idx, suggestion in enumerate(content["part5_hardening"], 1):
        parts.append(f"<h3>建议 {idx}（{_e(kind_names.get(suggestion['kind'], suggestion['kind']))}）</h3>")
        parts.append(f"<p><strong>配置动作：</strong>{_e(suggestion['action'])}</p>")
        parts.append(f"<p><strong>预期效果：</strong>{_e(suggestion['expected_effect'])}</p>")
        if suggestion.get("cost"):
            parts.append(f"<p><strong>取舍代价：</strong>{_e(suggestion['cost'])}</p>")

    parts.append("<h2>六、局限性说明</h2><ul>")
    for item in content["part6_limitations"]:
        parts.append(f"<li>{_e(item)}</li>")
    parts.append("</ul>")

    body = "\n".join(parts)
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>ForgeGuard 测评报告 {_e(report['report_id'])}</title>
<style>
body {{ font-family: "Segoe UI", "Microsoft YaHei", sans-serif; margin: 2rem auto; max-width: 960px; color: #111827; line-height: 1.6; }}
h1 {{ border-bottom: 3px solid #111827; padding-bottom: .4rem; }}
h2 {{ margin-top: 2rem; border-left: 4px solid #2563eb; padding-left: .6rem; }}
table {{ border-collapse: collapse; width: 100%; margin: .8rem 0; }}
th, td {{ border: 1px solid #d1d5db; padding: .4rem .6rem; text-align: left; font-size: 14px; vertical-align: top; }}
th {{ background: #f3f4f6; }}
table.kv th {{ width: 220px; }}
pre {{ background: #f9fafb; border: 1px solid #e5e7eb; padding: .8rem; overflow-x: auto; font-size: 13px; white-space: pre-wrap; }}
.meta {{ color: #6b7280; font-size: 14px; }}
.sim-note {{ background: #eff6ff; border: 1px solid #bfdbfe; padding: .6rem .8rem; font-size: 14px; }}
.conclusion {{ background: #f0fdf4; border: 1px solid #bbf7d0; padding: .6rem .8rem; }}
.cause {{ color: #374151; margin: .2rem 0; }}
</style>
</head>
<body>
{body}
</body>
</html>"""