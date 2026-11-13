"""三级判定流水线：L1 确定命中短路 → L2 越阈短路 → 灰区进 L3，降级留痕。"""

import time

from ..core.state import runtime
from ..policies.snapshot import index_rules
from . import l1, l2, l3, risk as risk_mod
from .l2 import classifier


def _preset_of(snapshot):
    for policy in snapshot.get("policies", []):
        if policy.get("rule_type") == "prompt_rule":
            return policy.get("params", {}).get("preset", "standard")
    return "standard"


def _thresholds(snapshot):
    for policy in snapshot.get("policies", []):
        if policy.get("rule_type") == "threshold":
            params = policy.get("params", {})
            return float(params.get("high", 0.75)), float(params.get("gray_low", 0.45))
    return 0.75, 0.45


def resolve_action(risk_level, is_violation, preset, suggested=None):
    from ..policies.mapping import preset_params

    params = preset_params(preset)
    if is_violation:
        return "block"
    if risk_level == "high":
        if preset == "strict":
            return "block"
        if preset == "loose":
            return "allow"
        return "challenge" if params["challenge_enabled"] else "allow"
    if risk_level == "medium":
        if preset == "strict" and params["block_medium"]:
            return "block"
        if preset == "standard" and params["challenge_enabled"]:
            return "challenge"
        return "allow"
    if risk_level == "low":
        return "degrade"
    return "allow"


def _decision(risk_level, is_violation, boundary, action, hit_policies, reason, judged_by, **extra):
    decision = {
        "risk": risk_level,
        "is_violation": is_violation,
        "boundary": boundary,
        "action": action,
        "hit_policies": hit_policies,
        "reason": reason,
        "judged_by": judged_by,
    }
    decision.update(extra)
    return decision


async def run_judgement(mirror, snapshot, context=None, guard_enabled=True, session_id=None):
    started = time.perf_counter()
    context = context or {}
    tool = mirror.get("tool_name", "")
    params = mirror.get("tool_params") or {}
    preset = _preset_of(snapshot)
    layers = {"l1": {}, "l2": {}, "l3": {}}
    timings = {}

    if not guard_enabled:
        return {
            "final_decision": _decision(
                "none", False, None, "allow", [], "本次对话未启用防护（对照演示标记）", "skip"
            ),
            "layers": layers,
            "timings": timings,
            "duration_ms": 0,
        }

    rules = index_rules(snapshot.get("policies", []), tool)
    t0 = time.perf_counter()
    l1_result = l1.evaluate(tool, params, rules, context)
    timings["l1"] = round((time.perf_counter() - t0) * 1000, 2)
    layers["l1"] = {"hit": l1_result["hit"], "rules": l1_result["rules"]}

    if l1_result["certain"]:
        first = l1_result["rules"][0]
        hit_policies = [
            {"policy_id": h["policy_id"], "source": h["source"]} for h in l1_result["rules"]
        ]
        if first["kind"] == "limit":
            decision = _decision(
                "none", False, None, "block", hit_policies, first["reason"], "L1", kind="limit"
            )
        else:
            decision = _decision(
                "high",
                True,
                first["boundary"],
                first["action"],
                hit_policies,
                first["reason"],
                "L1",
            )
        layers["l2"] = {"skipped": True}
        layers["l3"] = {"skipped": True}
        return _finish(decision, layers, timings, started)

    t0 = time.perf_counter()
    l2_result = classifier.classify(mirror.get("user_input", ""), params)
    timings["l2"] = round((time.perf_counter() - t0) * 1000, 2)
    layers["l2"] = {
        "injection_prob": l2_result.get("injection_prob", 0.0),
        "highlight": l2_result.get("highlight", []),
        "available": l2_result.get("available", False),
        "short_circuit": False,
    }
    high, gray_low = _thresholds(snapshot)
    prob = l2_result.get("injection_prob", 0.0)

    if l2_result.get("available") and prob >= high:
        layers["l2"]["short_circuit"] = True
        action = resolve_action("high", False, preset)
        decision = _decision(
            "high",
            False,
            None,
            action,
            [],
            f"L2 注入概率 {prob:.2f} 越过阈值 {high}，判定高危注入倾向",
            "L2",
        )
        layers["l3"] = {"skipped": True}
        return _finish(decision, layers, timings, started)

    need_l3 = (
        (l2_result.get("available") and prob >= gray_low)
        or l1_result["hit"]
        or preset == "strict"
    )
    if need_l3:
        t0 = time.perf_counter()
        l3_result = await l3.judge(
            mirror, snapshot.get("baseline_summary", ""), l1_result, l2_result, session_id
        )
        timings["l3"] = round((time.perf_counter() - t0) * 1000, 2)
        layers["l3"] = {
            "raw_json": l3_result.get("raw_json"),
            "valid": l3_result.get("valid", False),
            "available": l3_result.get("available", False),
        }
        if l3_result.get("valid"):
            raw = l3_result["raw_json"]
            boundary = None
            hit_policies = []
            if l1_result["rules"]:
                boundary = l1_result["rules"][0]["boundary"]
                hit_policies = [
                    {"policy_id": h["policy_id"], "source": h["source"]}
                    for h in l1_result["rules"]
                ]
            action = resolve_action(
                raw["risk_level"], raw["is_violation"], preset, raw["suggested_action"]
            )
            decision = _decision(
                raw["risk_level"],
                raw["is_violation"],
                boundary,
                action,
                hit_policies,
                raw["reason"][:200],
                "L3",
                risk_label=raw["risk_label"],
            )
            return _finish(decision, layers, timings, started)
        runtime.note_degradation(session_id, "L3 语义层不可用，已按保守策略处理（监护不可用）")
        suspicious = prob >= gray_low or l1_result["hit"]
        if suspicious:
            action = "block" if preset == "strict" else (
                "challenge" if preset == "standard" else "allow"
            )
            decision = _decision(
                "medium", False, None, action, [],
                "监护不可用：语义层超时或输出校验失败，按保守策略处理", "fallback",
                guard_unavailable=True,
            )
        else:
            decision = _decision(
                "none", False, None, "allow", [],
                "监护不可用：L1/L2 未发现风险，放行（未覆盖语义层）", "fallback",
                guard_unavailable=True,
            )
        return _finish(decision, layers, timings, started)

    decision = _decision(
        "none", False, None, "allow", [],
        "L1 未命中且 L2 注入概率低于灰区阈值，对象与参数均在基线范围内",
        "L2" if l2_result.get("available") else "L1",
    )
    layers["l3"] = {"skipped": True}
    return _finish(decision, layers, timings, started)


def _finish(decision, layers, timings, started):
    return {
        "final_decision": decision,
        "layers": layers,
        "timings": timings,
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }