"""会话运行器：驱动业务 Agent 状态机，合并监护处置，落库取证，推送事件。"""

import asyncio
import json
import time
from datetime import timedelta

from ..core import quota
from ..core.config import settings
from ..core.errors import ApiError, QuotaExhausted
from ..core.ids import new_id
from ..core.security import iso, parse_iso, utcnow
from ..core.state import runtime
from ..guard import risk as risk_mod
from ..guard.judge import run_judgement
from ..internal.events import event_bus, publish_threadsafe
from ..internal.guard.mirror import build_mirror_request
from ..models import db as dbmod
from ..policies.snapshot import get_snapshot
from ..sandbox.invoke import invoke, new_call_id
from ..sandbox.partition import sandbox_manager
from .business_agent import ReasonContext, build_business_graph

RISK_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3}
CHALLENGE_TIMEOUT = 120
# 仿真/演示链路无人值守裁决，质询短暂等待后保守拒绝，保证一键演示秒级完成。
SIM_CHALLENGE_TIMEOUT = 8
REPLAY_EVENT_DELAY = 0.1


def _get_session(session_id):
    with dbmod.session_scope() as db:
        return db.get(dbmod.Session, session_id)


def _get_instance(instance_id):
    with dbmod.session_scope() as db:
        return db.get(dbmod.Instance, instance_id)


def _update_session(session_id, **fields):
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Session, session_id)
        if row is None:
            return None
        for key, value in fields.items():
            setattr(row, key, value)
        return row


def renew_if_stale(instance):
    """滑动 TTL：过期/冻结实例在被使用时自动续期复活，闲置实例仍会到期供回收。"""
    expires = parse_iso(instance.expires_at)
    if instance.status != "frozen" and not (expires and expires < utcnow()):
        return False
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Instance, instance.instance_id)
        row.expires_at = iso(utcnow() + timedelta(minutes=settings.instance_ttl_minutes))
        row.status = "ready"
    return True


def _params_summary(tool, params):
    summary = {}
    for key in ("path", "endpoint", "cmd", "command", "key", "to", "recipients", "subject"):
        if key in params:
            value = params[key]
            if isinstance(value, str) and len(value) > 80:
                value = value[:80] + "…"
            summary[key] = value
    if "content" in params:
        summary["content_length"] = len(str(params["content"]))
    if "value" in params:
        summary["value"] = params["value"]
    return summary or {"params": str(params)[:80]}


def _challenge_kind(tool, params, decision):
    target = (
        params.get("path")
        or params.get("endpoint")
        or ",".join(params.get("to", []) if isinstance(params.get("to"), list) else [str(params.get("to", ""))])
        or decision.get("boundary")
        or "intent"
    )
    return f"{tool}:{target}"


def _alert_seed(decision):
    action = decision.get("action")
    risk = decision.get("risk", "none")
    if decision.get("kind") == "limit":
        return None
    if action == "block":
        return "high"
    if action == "challenge":
        return "high" if risk == "high" else "medium"
    if action == "degrade":
        return "low"
    if action == "allow" and risk in ("medium", "high"):
        return "medium"
    return None


def _risk_label(decision):
    if decision.get("risk_label"):
        return decision["risk_label"]
    boundary = decision.get("boundary")
    return {
        "tool": "越界调用工具",
        "object": "对象边界越权",
        "param": "参数边界越权",
    }.get(boundary, "意图风险")


def _active_recording():
    from ..core.security import current_auth
    from ..data.demo_snapshot import builtin_recording

    meta = quota.get_mode_meta()
    ctx = current_auth()
    workspace = ctx.workspace if ctx else "default"
    with dbmod.session_scope() as db:
        row = None
        if meta.get("snapshot_id"):
            row = db.get(dbmod.SnapshotRecording, meta["snapshot_id"])
        if row is None:
            # 只回放本工作区录制的快照，避免跨工作区取数。
            row = (
                db.query(dbmod.SnapshotRecording)
                .filter(dbmod.SnapshotRecording.workspace_id == workspace)
                .order_by(dbmod.SnapshotRecording.created_at.desc())
                .first()
            )
        if row is not None:
            return {"snapshot_id": row.snapshot_id, "name": row.name, **row.events}
    return builtin_recording()


async def replay_for_session(session_id, instance):
    recording = _active_recording()
    await event_bus.publish(
        session_id,
        "session.status",
        {
            "session_id": session_id,
            "status": "active",
            "mode": "replay",
            "reason": quota.get_mode_meta().get("reason") or "快照回放模式",
            "snapshot_id": recording.get("snapshot_id"),
        },
    )
    id_map = {}
    calls = recording.get("calls", [])
    alerts = recording.get("alerts", [])
    with dbmod.session_scope() as db:
        for call in calls:
            fresh = new_call_id()
            id_map[call["call_id"]] = fresh
            db.add(
                dbmod.CallRecord(
                    call_id=fresh,
                    session_id=session_id,
                    instance_id=instance.instance_id,
                    turn=call.get("turn", 1),
                    tool=call.get("tool", ""),
                    params_raw=call.get("params_raw", {}),
                    params_summary=call.get("params_summary", {}),
                    judgement=call.get("judgement", {}),
                    hit_policy=call.get("hit_policy"),
                    sandbox_result=call.get("sandbox_result"),
                    duration_ms=call.get("duration_ms", 0),
                    layers=call.get("layers", {}),
                    status_color=call.get("status_color", "green"),
                    created_at=iso(utcnow()),
                    source_sample_id=call.get("source_sample_id"),
                    actor=call.get("actor", "business"),
                )
            )
        for alert in alerts:
            db.add(
                dbmod.Alert(
                    alert_id=new_id("alt"),
                    session_id=session_id,
                    instance_id=instance.instance_id,
                    call_id=id_map.get(alert.get("call_id")),
                    turn=alert.get("turn", 1),
                    level=alert.get("level", "medium"),
                    label=alert.get("label", ""),
                    boundary=alert.get("boundary"),
                    action=alert.get("action", "block"),
                    reason=alert.get("reason", ""),
                    hit_policies=alert.get("hit_policies", []),
                    created_at=iso(utcnow()),
                    session_level=alert.get("session_level", False),
                )
            )
    for record in recording.get("events", []):
        data = dict(record.get("data", {}))
        if data.get("call_id") in id_map:
            data["call_id"] = id_map[data["call_id"]]
        await event_bus.publish(session_id, record["event"], data)
        await asyncio.sleep(REPLAY_EVENT_DELAY)
    block_count = sum(
        1 for c in calls if c.get("judgement", {}).get("action") == "block"
        and c.get("judgement", {}).get("kind") != "limit"
    )
    max_risk = "none"
    for call in calls:
        risk = call.get("judgement", {}).get("risk", "none")
        if RISK_ORDER.get(risk, 0) > RISK_ORDER.get(max_risk, 0):
            max_risk = risk
    _update_session(
        session_id,
        call_count=len(calls),
        block_count=block_count,
        max_risk=max_risk,
        mode="replay",
    )
    return {
        "turn": 1,
        "reply": "（快照回放）已按录制序列重演完整攻防回合。",
        "actions": [c.get("judgement", {}).get("action", "allow") for c in calls],
        "max_risk": max_risk,
        "call_ids": list(id_map.values()),
        "mode": "replay",
    }


async def process_message(
    session_id, content, skip_guard=False, source_sample_id=None, actor="business"
):
    # 同会话消息串行化：用户消息与红队循环并发进入时，轮次与计数器读-改-写不丢失。
    async with runtime.session_lock(session_id):
        return await _process_message(
            session_id, content, skip_guard=skip_guard,
            source_sample_id=source_sample_id, actor=actor,
        )


async def _process_message(
    session_id, content, skip_guard=False, source_sample_id=None, actor="business"
):
    session = _get_session(session_id)
    if session is None:
        raise ApiError(40400, detail="会话不存在")
    if session.status != "active":
        raise ApiError(40900, detail=f"会话当前状态为 {session.status}，无法发送消息")
    instance = _get_instance(session.instance_id)
    if instance is None or instance.status == "destroyed":
        raise ApiError(40900, detail="实例已销毁，无法继续会话")
    renew_if_stale(instance)
    if quota.get_mode() == quota.MODE_REPLAY:
        return await replay_for_session(session_id, instance)

    snapshot = get_snapshot(session.policy_snapshot_id)
    config = instance.config_payload
    limits = config["limits"]
    turn = session.turn + 1
    guard_enabled = bool(session.guard_enabled) and not skip_guard
    skip_turns = list(session.skip_guard_turns or [])
    if skip_guard and turn not in skip_turns:
        skip_turns.append(turn)
    _update_session(
        session_id,
        turn=turn,
        skip_guard_turns=skip_turns,
    )

    turn_calls = 0
    actions = []
    call_ids = []
    max_risk_turn = "none"
    sandbox_key = instance.sandbox_key

    async def execute_tool(call):
        nonlocal turn_calls, max_risk_turn
        tool = str(call.get("tool", ""))
        params = dict(call.get("params") or {})
        call_id = new_call_id()
        call_ids.append(call_id)
        current = _get_session(session_id)
        summary = _params_summary(tool, params)
        started = time.perf_counter()

        over_limit = (
            turn_calls >= limits["max_calls_per_turn"]
            or current.call_count >= limits["max_calls_per_session"]
        )
        if over_limit:
            reason = (
                f"超出编排限额：单轮调用已达 {limits['max_calls_per_turn']} 次上限"
                if turn_calls >= limits["max_calls_per_turn"]
                else f"超出编排限额：会话累计调用已达 {limits['max_calls_per_session']} 次上限"
            )
            decision = {
                "risk": "none", "is_violation": False, "boundary": None,
                "action": "block", "hit_policies": [], "reason": reason,
                "judged_by": "L1", "kind": "limit",
            }
            await event_bus.publish(
                session_id, "tool.call",
                {"call_id": call_id, "turn": turn, "tool": tool, "params_summary": summary, "actor": actor},
            )
            await event_bus.publish(
                session_id, "guard.judgement",
                {"call_id": call_id, "tool": tool, **decision},
            )
            _persist_call(
                call_id, session_id, instance.instance_id, turn, tool, params, summary,
                decision, None, {"ok": False, "data": {"refused": True, "reason": reason}, "simulated": True},
                round((time.perf_counter() - started) * 1000, 2), {}, "gray", source_sample_id, actor,
            )
            _update_session(
                session_id,
                call_count=current.call_count + 1,
                limit_block_count=current.limit_block_count + 1,
            )
            await event_bus.publish(
                session_id, "chain.update",
                {"call_id": call_id, "turn": turn, "tool": tool, "status_color": "gray",
                 "action": "block", "kind": "limit", "duration_ms": 0},
            )
            actions.append("limit_block")
            return json.dumps({"tool": tool, "ok": False, "action": "block", "reason": reason}, ensure_ascii=False)

        turn_calls += 1
        await event_bus.publish(
            session_id, "tool.call",
            {"call_id": call_id, "turn": turn, "tool": tool, "params_summary": summary, "actor": actor},
        )
        mirror = build_mirror_request(
            session_id, turn, content, current.context_summary, tool, params,
            snapshot.get("baseline_summary", ""),
        )
        partition = sandbox_manager.get(sandbox_key)
        context = {
            "turn_calls": turn_calls - 1,
            "session_calls": current.call_count,
            "existing_files": set(partition.files.keys()) if partition else set(),
        }
        judge_result = await run_judgement(
            mirror, snapshot, context, guard_enabled=guard_enabled, session_id=session_id
        )
        decision = dict(judge_result["final_decision"])
        challenge_approved = None
        if decision["action"] == "challenge":
            kind = _challenge_kind(tool, params, decision)
            remembered = runtime.recalled_challenge(session_id, kind)
            if remembered is not None:
                challenge_approved = remembered
                decision["reason"] += "（同类质询已记忆此前选择）"
            else:
                await event_bus.publish(
                    session_id, "guard.judgement",
                    {"call_id": call_id, "tool": tool, "challenge_pending": True, **decision},
                )
                future = runtime.register_challenge(call_id, session_id=session_id)
                timed_out = False
                from ..internal.llm.proxy import current_simulated_reason
                wait_s = SIM_CHALLENGE_TIMEOUT if current_simulated_reason() else CHALLENGE_TIMEOUT
                try:
                    challenge_approved = await asyncio.wait_for(future, wait_s)
                except asyncio.CancelledError:
                    runtime.cancel_challenge(call_id)
                    raise
                except asyncio.TimeoutError:
                    runtime.cancel_challenge(call_id)
                    challenge_approved = False
                    timed_out = True
                    decision["reason"] += "（质询超时，默认拒绝）"
                # 超时拒绝不写入记忆：一次无人响应不应让同类调用在整个会话内永久被拒。
                if not timed_out:
                    runtime.remember_challenge(session_id, kind, challenge_approved)
            decision["action"] = "allow" if challenge_approved else "block"
            decision["challenge_approved"] = challenge_approved

        await event_bus.publish(
            session_id, "guard.judgement",
            {"call_id": call_id, "tool": tool, **decision},
        )

        perm = config["tools"].get(tool, {}).get("perm", {})
        sandbox_decision = dict(decision)
        sandbox_decision["mask_fields"] = perm.get("mask_fields", [])
        sandbox_decision["overwrite_allowed"] = perm.get("overwrite", False)
        sandbox_result = invoke(
            {
                "instance_id": instance.instance_id,
                "sandbox_key": sandbox_key,
                "tool": tool,
                "params": params,
                "policy_decision": sandbox_decision,
            }
        )

        if decision.get("kind") == "limit":
            color = "gray"
        elif decision["action"] == "block":
            color = "red"
        elif decision["action"] == "degrade":
            color = "yellow"
        elif decision.get("challenge_approved") is not None:
            color = "orange"
        else:
            color = "green"
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        hit_policy = decision["hit_policies"][0] if decision["hit_policies"] else None
        _persist_call(
            call_id, session_id, instance.instance_id, turn, tool, params, summary,
            decision, hit_policy, sandbox_result, duration_ms,
            {"layers": judge_result["layers"], "timings": judge_result["timings"]},
            color, source_sample_id, actor,
        )

        alert_level = _alert_seed(decision)
        if alert_level:
            alert_id = new_id("alt")
            alert = {
                "alert_id": alert_id,
                "session_id": session_id,
                "instance_id": instance.instance_id,
                "call_id": call_id,
                "turn": turn,
                "level": alert_level,
                "label": _risk_label(decision),
                "boundary": decision.get("boundary"),
                "action": decision["action"],
                "reason": decision["reason"],
                "hit_policies": decision["hit_policies"],
                "created_at": iso(utcnow()),
                "session_level": False,
            }
            _persist_alert(alert)
            await event_bus.publish(session_id, "alert.created", alert)

        fresh = _get_session(session_id)
        new_score = risk_mod.accumulate(
            fresh.risk_score, fresh.last_risk_turn, turn, decision["risk"]
        )
        counters = {
            "call_count": fresh.call_count + 1,
            "risk_score": new_score,
            "last_risk_turn": turn,
        }
        if decision["action"] == "block":
            counters["block_count"] = fresh.block_count + 1
        elif decision["action"] == "degrade":
            counters["degrade_count"] = fresh.degrade_count + 1
        elif decision["action"] == "allow":
            counters["allow_count"] = fresh.allow_count + 1
        if challenge_approved is not None:
            counters["challenge_count"] = fresh.challenge_count + 1
        if RISK_ORDER.get(decision["risk"], 0) > RISK_ORDER.get(fresh.max_risk, 0):
            counters["max_risk"] = decision["risk"]
        _update_session(session_id, **counters)

        if risk_mod.over_threshold(new_score):
            _maybe_session_alert(session_id, instance.instance_id, turn, new_score)

        if RISK_ORDER.get(decision["risk"], 0) > RISK_ORDER.get(max_risk_turn, 0):
            max_risk_turn = decision["risk"]
        actions.append(decision["action"])
        await event_bus.publish(
            session_id, "chain.update",
            {
                "call_id": call_id, "turn": turn, "tool": tool, "status_color": color,
                "action": decision["action"], "risk": decision["risk"],
                "duration_ms": duration_ms, "judged_by": decision["judged_by"],
            },
        )
        return json.dumps(
            {
                "tool": tool,
                "ok": sandbox_result["ok"],
                "action": decision["action"],
                "reason": decision["reason"],
                "data": sandbox_result.get("data"),
            },
            ensure_ascii=False,
        )[:1500]

    message_id = new_id("msg")

    async def publish_delta(delta):
        await event_bus.publish(
            session_id,
            "agent.delta",
            {"message_id": message_id, "role": "assistant", "delta": delta, "turn": turn, "actor": actor},
        )

    ctx = ReasonContext(
        session_id, config["system_prompt"], limits["max_calls_per_turn"], execute_tool,
        tools=config["tools"], on_delta=publish_delta,
    )
    messages = []
    if session.context_summary:
        messages.append({"role": "user", "content": f"[此前对话摘要] {session.context_summary}"})
    messages.append({"role": "user", "content": content})
    graph = build_business_graph(ctx)
    await event_bus.publish(
        session_id,
        "agent.message.start",
        {"message_id": message_id, "role": "assistant", "turn": turn, "actor": actor},
    )
    try:
        final_state = await graph.ainvoke(
            {"messages": messages, "tool_calls": [], "tool_index": 0}
        )
    except QuotaExhausted:
        await event_bus.publish(
            session_id, "agent.message",
            {"message_id": message_id, "role": "assistant", "content": "（本回合模型配额耗尽，自动切换快照回放）", "turn": turn, "actor": actor},
        )
        await event_bus.publish(
            session_id, "session.status",
            {
                "session_id": session_id, "status": "active", "mode": "replay",
                "reason": "模型配额耗尽，自动切换快照回放",
            },
        )
        return await replay_for_session(session_id, instance)
    except Exception as exc:
        # 收尾流式占位气泡，避免前端停留在“正在响应”
        await event_bus.publish(
            session_id, "agent.message",
            {"message_id": message_id, "role": "assistant", "content": f"（本轮处理失败：{type(exc).__name__}，请重试）", "turn": turn, "actor": actor},
        )
        raise

    reply = final_state.get("reply", "")
    if ctx.simulated_fallback:
        from ..internal.llm.proxy import current_simulated_reason

        forced = current_simulated_reason()
        reply += (
            f"\n（{forced}）" if forced else "\n（注：本轮模型接口不可达，使用离线仿真推理，已留痕）"
        )
    await event_bus.publish(
        session_id, "agent.message",
        {"message_id": message_id, "role": "assistant", "content": reply, "turn": turn, "actor": actor},
    )
    _append_context(session_id, turn, content, actions)
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Turn(
                session_id=session_id,
                turn=turn,
                user_input=content[:2000],
                reply=reply,
                actor=actor,
                source_sample_id=source_sample_id,
                created_at=iso(utcnow()),
            )
        )
    with dbmod.session_scope() as db:
        inst = db.get(dbmod.Instance, instance.instance_id)
        if inst:
            inst.last_active_at = iso(utcnow())
            stats = dict(inst.stats or {})
            stats["call_count"] = stats.get("call_count", 0) + len(call_ids)
            inst.stats = stats
    return {
        "turn": turn,
        "reply": reply,
        "actions": actions,
        "max_risk": max_risk_turn,
        "call_ids": call_ids,
        "message_id": message_id,
    }


def _persist_call(
    call_id, session_id, instance_id, turn, tool, params, summary,
    decision, hit_policy, sandbox_result, duration_ms, layers, color,
    source_sample_id, actor,
):
    with dbmod.session_scope() as db:
        db.add(
            dbmod.CallRecord(
                call_id=call_id,
                session_id=session_id,
                instance_id=instance_id,
                turn=turn,
                tool=tool,
                params_raw=params,
                params_summary=summary,
                judgement=decision,
                hit_policy=hit_policy,
                sandbox_result=sandbox_result,
                duration_ms=int(duration_ms),
                layers=layers,
                status_color=color,
                created_at=iso(utcnow()),
                source_sample_id=source_sample_id,
                actor=actor,
            )
        )


def _persist_alert(alert):
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Alert(
                alert_id=alert["alert_id"],
                session_id=alert["session_id"],
                instance_id=alert["instance_id"],
                call_id=alert.get("call_id"),
                turn=alert.get("turn", 0),
                level=alert["level"],
                label=alert.get("label", ""),
                boundary=alert.get("boundary"),
                action=alert["action"],
                reason=alert["reason"],
                hit_policies=alert.get("hit_policies", []),
                created_at=alert["created_at"],
                session_level=alert.get("session_level", False),
            )
        )


def _maybe_session_alert(session_id, instance_id, turn, score):
    with dbmod.session_scope() as db:
        existing = (
            db.query(dbmod.Alert)
            .filter(dbmod.Alert.session_id == session_id, dbmod.Alert.session_level.is_(True))
            .count()
        )
        if existing:
            return
    alert = {
        "alert_id": new_id("alt"),
        "session_id": session_id,
        "instance_id": instance_id,
        "call_id": None,
        "turn": turn,
        "level": "medium",
        "label": "跨轮上下文污染",
        "boundary": None,
        "action": "allow",
        "reason": f"会话累计风险分 {score:.2f} 越过阈值 {risk_mod.SESSION_THRESHOLD}，"
        "多轮渐进式污染迹象，本轮上下文已标记为可疑（不阻断正常调用）",
        "hit_policies": [],
        "created_at": iso(utcnow()),
        "session_level": True,
    }
    _persist_alert(alert)
    publish_threadsafe(session_id, "alert.created", alert)


def _append_context(session_id, turn, content, actions):
    session = _get_session(session_id)
    line = f"第{turn}轮：用户请求「{content[:60]}」；处置={'/'.join(actions) if actions else '无工具调用'}"
    lines = (session.context_summary or "").splitlines()
    lines.append(line)
    _update_session(session_id, context_summary="\n".join(lines[-3:]))


def record_session(session_id, name, workspace_id="default"):
    """把会话完整事件序列与证据录制为快照（只增不改）。"""
    events = event_bus.full_history(session_id)
    with dbmod.session_scope() as db:
        calls = (
            db.query(dbmod.CallRecord)
            .filter(dbmod.CallRecord.session_id == session_id)
            .order_by(dbmod.CallRecord.created_at)
            .all()
        )
        alerts = (
            db.query(dbmod.Alert)
            .filter(dbmod.Alert.session_id == session_id)
            .order_by(dbmod.Alert.created_at)
            .all()
        )
        call_dicts = [
            {
                "call_id": c.call_id, "turn": c.turn, "tool": c.tool,
                "params_raw": c.params_raw, "params_summary": c.params_summary,
                "judgement": c.judgement, "hit_policy": c.hit_policy,
                "sandbox_result": c.sandbox_result, "duration_ms": c.duration_ms,
                "layers": c.layers, "status_color": c.status_color,
                "source_sample_id": c.source_sample_id, "actor": c.actor,
            }
            for c in calls
        ]
        alert_dicts = [
            {
                "call_id": a.call_id, "turn": a.turn, "level": a.level, "label": a.label,
                "boundary": a.boundary, "action": a.action, "reason": a.reason,
                "hit_policies": a.hit_policies, "session_level": a.session_level,
            }
            for a in alerts
        ]
    snapshot_id = new_id("snap")
    payload = {"events": events, "calls": call_dicts, "alerts": alert_dicts}
    with dbmod.session_scope() as db:
        db.add(
            dbmod.SnapshotRecording(
                snapshot_id=snapshot_id,
                name=name,
                session_id=session_id,
                workspace_id=workspace_id,
                events=payload,
                created_at=iso(utcnow()),
            )
        )
    return snapshot_id