"""根因归类（FD8）：五类根因，允许并列，主因取三重边界最先命中者。

归类依据为审计记录字段（边界层级、命中策略、来源配置项、参数片段）
结合基线快照推导，不做推测性归类；证据不足时明确标注人工复核。
"""

CATEGORIES = {
    "config_defect": "编排配置缺陷",
    "param_validation": "工具参数校验缺失",
    "prompt_defect": "提示词缺陷",
    "model_alignment": "模型对齐缺陷",
    "context_pollution": "跨轮上下文污染",
}

_BOUNDARY_PRIMARY = {
    "tool": "config_defect",
    "object": "config_defect",
    "param": "param_validation",
}


def classify_alert(alert, call, config, session):
    """对单条告警归类，返回 {primary, secondary, causes, evidence_insufficient}。"""
    causes = []
    decision = (call or {}).get("judgement", {})
    boundary = alert.get("boundary") or decision.get("boundary")
    hit_policies = alert.get("hit_policies") or decision.get("hit_policies") or []
    sources = [p.get("source", "") for p in hit_policies if p.get("source")]
    tool = (call or {}).get("tool", "")
    params = (call or {}).get("params_raw", {})

    if alert.get("session_level"):
        causes.append(
            {
                "category": "context_pollution",
                "basis": "会话级风险分越阈，利用发生在铺垫轮次之后",
                "evidence": {"risk_score": session.get("risk_score"), "turn": alert.get("turn")},
            }
        )
    elif boundary in ("tool", "object"):
        perm = config.get("tools", {}).get(tool, {}).get("perm", {})
        causes.append(
            {
                "category": "config_defect",
                "basis": f"命中{('工具' if boundary == 'tool' else '对象')}边界，"
                "对应权限在基线中缺失或过宽",
                "evidence": {"boundary": boundary, "sources": sources, "perm": perm},
            }
        )
    elif boundary == "param":
        causes.append(
            {
                "category": "param_validation",
                "basis": "对象在授权范围内，但参数含穿越片段或超限取值",
                "evidence": {"boundary": boundary, "sources": sources, "params": _param_excerpt(params)},
            }
        )

    judged_by = decision.get("judged_by", "")
    reason = decision.get("reason", "") or alert.get("reason", "")
    if judged_by == "L3" or "注入" in reason or "越狱" in reason or "偏离" in reason:
        if not any(c["category"] == "prompt_defect" for c in causes):
            causes.append(
                {
                    "category": "prompt_defect",
                    "basis": "语义层识别到行为偏离声明用途或注入意图",
                    "evidence": {"judged_by": judged_by, "reason": reason[:200]},
                }
            )
    if "越狱" in reason and decision.get("risk") == "high":
        if not any(c["category"] == "model_alignment" for c in causes):
            causes.append(
                {
                    "category": "model_alignment",
                    "basis": "越狱载荷触发高危判定，属模型层对齐问题（需跨实例复现确认）",
                    "evidence": {"reason": reason[:200]},
                }
            )

    insufficient = not causes or (not boundary and not alert.get("session_level") and not sources)
    if insufficient:
        return {
            "primary": None,
            "secondary": [],
            "causes": [],
            "evidence_insufficient": True,
            "note": "证据不足，建议人工复核",
        }
    primary = causes[0]["category"]
    if boundary and boundary in _BOUNDARY_PRIMARY:
        primary = _BOUNDARY_PRIMARY[boundary]
        causes.sort(key=lambda c: 0 if c["category"] == primary else 1)
    return {
        "primary": primary,
        "primary_name": CATEGORIES[primary],
        "secondary": [c["category"] for c in causes[1:]],
        "causes": causes,
        "evidence_insufficient": False,
    }


def _param_excerpt(params):
    excerpt = {}
    for key in ("path", "endpoint", "cmd", "to", "recipients", "key"):
        if key in params:
            value = params[key]
            excerpt[key] = str(value)[:120]
    return excerpt


def classify_session(session, calls, alerts, config):
    """会话级归类汇总：逐条告警归类 + 会话级结论。"""
    call_map = {c["call_id"]: c for c in calls}
    items = []
    for alert in alerts:
        call = call_map.get(alert.get("call_id"))
        classification = classify_alert(alert, call, config, session)
        items.append({"alert_id": alert["alert_id"], **classification})
    category_counts = {}
    for item in items:
        for cause in item["causes"]:
            category_counts[cause["category"]] = category_counts.get(cause["category"], 0) + 1
    dominant = max(category_counts, key=category_counts.get) if category_counts else None
    return {
        "items": items,
        "category_counts": category_counts,
        "dominant": dominant,
        "dominant_name": CATEGORIES.get(dominant) if dominant else None,
    }