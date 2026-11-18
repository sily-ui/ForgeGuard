"""报告构建（FD8）：六部分固定结构，生成后只读快照。

六部分：测评概要 / 靶标基线快照 / 攻击序列 / 风险分析 / 加固建议 / 局限性说明。
报告一旦生成不再随实例变化而改变，重新生成产生新报告。
"""

from ..core.ids import new_id
from ..core.security import iso, utcnow
from ..models import db as dbmod
from ..policies.snapshot import get_snapshot
from .hardening import build_suggestions
from .rootcause import classify_session

REPORT_VERSION = "1.0"

SIMULATION_NOTE = (
    "本报告全部工具调用为内存仿真，不执行真实系统命令、不读写宿主文件系统、"
    "不连接外部邮件与业务系统、不对外发起网络探测；预置数据均为虚构。"
)


def _turns_of(db, session_id):
    rows = (
        db.query(dbmod.Turn)
        .filter(dbmod.Turn.session_id == session_id)
        .order_by(dbmod.Turn.turn)
        .all()
    )
    return [
        {
            "turn": r.turn,
            "user_input": r.user_input,
            "reply": r.reply,
            "actor": r.actor,
            "source_sample_id": r.source_sample_id,
            "created_at": r.created_at,
        }
        for r in rows
    ]


def _calls_of(db, session_id):
    rows = (
        db.query(dbmod.CallRecord)
        .filter(dbmod.CallRecord.session_id == session_id)
        .order_by(dbmod.CallRecord.created_at)
        .all()
    )
    return [
        {
            "call_id": c.call_id,
            "turn": c.turn,
            "tool": c.tool,
            "params_raw": c.params_raw,
            "params_summary": c.params_summary,
            "judgement": c.judgement,
            "hit_policy": c.hit_policy,
            "sandbox_result": c.sandbox_result,
            "duration_ms": c.duration_ms,
            "layers": c.layers,
            "status_color": c.status_color,
            "source_sample_id": c.source_sample_id,
            "actor": c.actor,
            "created_at": c.created_at,
        }
        for c in rows
    ]


def _alerts_of(db, session_id):
    rows = (
        db.query(dbmod.Alert)
        .filter(dbmod.Alert.session_id == session_id)
        .order_by(dbmod.Alert.created_at)
        .all()
    )
    return [
        {
            "alert_id": a.alert_id,
            "call_id": a.call_id,
            "turn": a.turn,
            "level": a.level,
            "label": a.label,
            "boundary": a.boundary,
            "action": a.action,
            "reason": a.reason,
            "hit_policies": a.hit_policies,
            "false_positive": a.false_positive,
            "false_negative": a.false_negative,
            "note": a.note,
            "session_level": a.session_level,
            "created_at": a.created_at,
        }
        for a in rows
    ]


def _conclusion(session, alerts):
    if session["block_count"] > 0:
        return (
            f"本次测评共拦截 {session['block_count']} 次越权调用，"
            f"最高风险等级 {session['max_risk']}，防护在已覆盖攻击面上有效；"
            "请按加固建议修订编排后重跑同一载荷验证。"
        )
    if alerts:
        return "本次测评未发生拦截，但存在风险告警，请结合风险分析与加固建议评估。"
    return (
        "本次测评未触发风险告警，链路全绿。注意：这仅代表已覆盖样本未命中，"
        "不代表该 Agent 已通过全部安全测试。"
    )


def _limitations(session, config, snapshot):
    items = [
        SIMULATION_NOTE,
        "仿真沙盒的文件树、接口数据与命令输出均为预置虚构内容，结论不能直接外推到真实系统。",
        "本次测评仅覆盖样本库已载入的攻击面；未覆盖的攻击面（如真实网络渗透、供应链投毒）不在结论范围内。",
    ]
    enabled = [t for t, spec in config.get("tools", {}).items() if spec.get("enabled")]
    disabled = [t for t, spec in config.get("tools", {}).items() if not spec.get("enabled")]
    if disabled:
        items.append(f"未启用工具（{', '.join(disabled)}）的攻击面本次未测评。")
    if session.get("degradations"):
        items.append("本次运行发生降级：" + "；".join(session["degradations"]) + "。降级期间的判定结论不完整。")
    if session.get("mode") == "replay":
        items.append("本次会话处于快照回放模式，结论来自录制数据而非实时判定。")
    skip_turns = session.get("skip_guard_turns") or []
    if skip_turns:
        items.append(f"第 {', '.join(str(t) for t in skip_turns)} 轮按对照要求跳过防护，该部分结果不代表防护能力。")
    l3_missing = any(
        "L3" in d or "监护" in d or "语义" in d for d in (session.get("degradations") or [])
    )
    if l3_missing:
        items.append("语义层（L3）曾不可用，相关轮次未覆盖语义判定。")
    return items


def build_report(session_id):
    with dbmod.session_scope() as db:
        session_row = db.get(dbmod.Session, session_id)
        if session_row is None:
            return None, "会话不存在"
        instance = db.get(dbmod.Instance, session_row.instance_id)
        if instance is None:
            return None, "实例不存在"
        session = {
            "session_id": session_row.session_id,
            "instance_id": session_row.instance_id,
            "turn": session_row.turn,
            "call_count": session_row.call_count,
            "risk_score": round(session_row.risk_score, 2),
            "guard_enabled": session_row.guard_enabled,
            "max_risk": session_row.max_risk,
            "block_count": session_row.block_count,
            "challenge_count": session_row.challenge_count,
            "limit_block_count": session_row.limit_block_count,
            "degrade_count": session_row.degrade_count,
            "allow_count": session_row.allow_count,
            "mode": session_row.mode,
            "degradations": session_row.degradations or [],
            "skip_guard_turns": session_row.skip_guard_turns or [],
            "created_at": session_row.created_at,
            "terminated_at": session_row.terminated_at,
        }
        config = instance.config_payload
        instance_name = instance.name
        turns = _turns_of(db, session_id)
        calls = _calls_of(db, session_id)
        alerts = _alerts_of(db, session_id)

    snapshot = get_snapshot(session_row.policy_snapshot_id)
    rootcause = classify_session(session, calls, alerts, config)
    suggestions = build_suggestions(rootcause, config, calls)

    attack_sequence = []
    for turn in turns:
        turn_calls = [c for c in calls if c["turn"] == turn["turn"]]
        attack_sequence.append(
            {
                "turn": turn["turn"],
                "actor": turn["actor"],
                "source_sample_id": turn["source_sample_id"],
                "input": turn["user_input"],
                "agent_reply": turn["reply"],
                "calls": [
                    {
                        "call_id": c["call_id"],
                        "tool": c["tool"],
                        "params_summary": c["params_summary"],
                        "action": c["judgement"].get("action"),
                        "risk": c["judgement"].get("risk"),
                        "reason": c["judgement"].get("reason"),
                        "status_color": c["status_color"],
                        "duration_ms": c["duration_ms"],
                    }
                    for c in turn_calls
                ],
            }
        )

    risk_analysis = []
    cause_map = {item["alert_id"]: item for item in rootcause["items"]}
    for alert in alerts:
        classification = cause_map.get(alert["alert_id"], {})
        risk_analysis.append(
            {
                **alert,
                "root_cause": classification.get("primary_name"),
                "root_causes": classification.get("causes", []),
                "evidence_insufficient": classification.get("evidence_insufficient", False),
            }
        )

    content = {
        "report_version": REPORT_VERSION,
        "part1_overview": {
            "instance_name": instance_name,
            "purpose": config.get("purpose", ""),
            "session_id": session_id,
            "tested_at": session["created_at"],
            "turns": session["turn"],
            "call_count": session["call_count"],
            "block_count": session["block_count"],
            "challenge_count": session["challenge_count"],
            "limit_block_count": session["limit_block_count"],
            "max_risk": session["max_risk"],
            "risk_score": session["risk_score"],
            "guard_enabled": session["guard_enabled"],
            "mode": session["mode"],
            "conclusion": _conclusion(session, alerts),
        },
        "part2_baseline": {
            "config": config,
            "policy_snapshot_id": session_row.policy_snapshot_id,
            "policy_snapshot_version": snapshot["version"] if snapshot else None,
            "baseline_summary": snapshot["baseline_summary"] if snapshot else "",
            "policies": snapshot["policies"] if snapshot else [],
        },
        "part3_attack_sequence": attack_sequence,
        "part4_risk_analysis": risk_analysis,
        "part5_hardening": suggestions,
        "part6_limitations": _limitations(session, config, snapshot),
        "rootcause_summary": {
            "category_counts": rootcause["category_counts"],
            "dominant": rootcause["dominant_name"],
        },
        "simulation_note": SIMULATION_NOTE,
    }
    summary = {
        "instance_name": instance_name,
        "max_risk": session["max_risk"],
        "block_count": session["block_count"],
        "turns": session["turn"],
        "conclusion": content["part1_overview"]["conclusion"],
    }
    report_id = new_id("rpt")
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Report(
                report_id=report_id,
                workspace_id=session_row.workspace_id,
                session_id=session_id,
                policy_snapshot_id=session_row.policy_snapshot_id,
                config_version=str(config.get("version", "1.0")),
                content=content,
                summary=summary,
                status="ready",
                share_token=None,
                share_expires_at=None,
                created_at=now,
            )
        )
    return {
        "report_id": report_id,
        "status": "ready",
        "summary": summary,
        "created_at": now,
    }, None