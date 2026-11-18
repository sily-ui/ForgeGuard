import asyncio
import json

from fastapi import APIRouter, Body, Request
from fastapi.responses import StreamingResponse

from ...core import quota
from ...core.errors import ApiError
from ...core.ids import new_id
from ...core.response import paginate, parse_pagination, slice_page
from ...core.security import iso, utcnow
from ...core.state import runtime
from ...internal.events import event_bus, publish_threadsafe
from ...models import db as dbmod
from ...orchestration import redteam as redteam_mod
from ...orchestration.runner import process_message, record_session
from ...policies.snapshot import freeze_snapshot, get_snapshot
from ..deps import get_auth, get_sse_auth, heavy_check

router = APIRouter()


def _session_row(session_id, workspace="default"):
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Session, session_id)
        if row is None or row.workspace_id != workspace:
            raise ApiError(40400, detail="会话不存在")
        return row


def _session_view(row):
    with dbmod.session_scope() as db:
        instance = db.get(dbmod.Instance, row.instance_id)
    return {
        "session_id": row.session_id,
        "instance_id": row.instance_id,
        "instance_name": instance.name if instance else "",
        "status": row.status,
        "turn": row.turn,
        "call_count": row.call_count,
        "risk_score": round(row.risk_score, 2),
        "guard_enabled": row.guard_enabled,
        "policy_snapshot_id": row.policy_snapshot_id,
        "max_risk": row.max_risk,
        "block_count": row.block_count,
        "limit_block_count": row.limit_block_count,
        "challenge_count": row.challenge_count,
        "degrade_count": row.degrade_count,
        "allow_count": row.allow_count,
        "mode": row.mode,
        "degradations": row.degradations or [],
        "created_at": row.created_at,
        "terminated_at": row.terminated_at,
    }


@router.post("/sessions")
def create_session(request: Request, payload: dict = Body(...)):
    ctx = get_auth(request)
    instance_id = payload.get("instance_id")
    with dbmod.session_scope() as db:
        instance = db.get(dbmod.Instance, instance_id) if instance_id else None
    if instance is None or instance.workspace_id != ctx.workspace:
        raise ApiError(40400, detail="实例不存在")
    if instance.status == "destroyed":
        raise ApiError(40900, detail="实例已销毁，无法创建会话")
    if instance.status == "frozen":
        raise ApiError(40900, detail="实例已冻结，请先续期")
    session_id = new_id("sess")
    snapshot_id = freeze_snapshot(
        instance.instance_id, instance.config_payload, session_id=session_id, id_prefix="pol"
    )
    guard_enabled = bool(payload.get("guard_enabled", True))
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Session(
                session_id=session_id,
                workspace_id=ctx.workspace,
                instance_id=instance.instance_id,
                status="active",
                turn=0,
                context_summary="",
                call_count=0,
                risk_score=0.0,
                last_risk_turn=0,
                guard_enabled=guard_enabled,
                skip_guard_turns=[],
                policy_snapshot_id=snapshot_id,
                created_at=now,
                terminated_at=None,
                max_risk="none",
                block_count=0,
                challenge_count=0,
                limit_block_count=0,
                degrade_count=0,
                allow_count=0,
                mode=quota.get_mode(),
                degradations=[],
            )
        )
    publish_threadsafe(
        session_id,
        "session.status",
        {"session_id": session_id, "status": "active", "mode": quota.get_mode()},
    )
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "session_id": session_id,
            "status": "active",
            "instance_id": instance.instance_id,
            "policy_snapshot_id": snapshot_id,
            "created_at": now,
        },
    }


@router.get("/sessions")
def list_sessions(request: Request, instance_id: str | None = None, page: int = 1, page_size: int = 20):
    ctx = get_auth(request)
    page, page_size = parse_pagination(page, page_size)
    with dbmod.session_scope() as db:
        query = db.query(dbmod.Session).filter(dbmod.Session.workspace_id == ctx.workspace)
        if instance_id:
            query = query.filter(dbmod.Session.instance_id == instance_id)
        rows = query.order_by(dbmod.Session.created_at.desc()).all()
        items = [_session_view(r) for r in rows]
    return {
        "code": 0,
        "message": "ok",
        "data": paginate(slice_page(items, page, page_size), page, page_size, total=len(items)),
    }


@router.get("/sessions/{session_id}")
def get_session(request: Request, session_id: str):
    ctx = get_auth(request)
    row = _session_row(session_id, ctx.workspace)
    data = _session_view(row)
    data["context_summary"] = row.context_summary
    data["skip_guard_turns"] = row.skip_guard_turns or []
    return {"code": 0, "message": "ok", "data": data}


@router.post("/sessions/{session_id}/messages")
async def send_message(request: Request, session_id: str, payload: dict = Body(...)):
    ctx = get_auth(request)
    content = str(payload.get("content", "")).strip()
    if not content:
        raise ApiError(40000, detail="消息内容不能为空")
    if len(content) > 4000:
        raise ApiError(40000, detail="消息长度超过 4000 字符上限")
    _session_row(session_id, ctx.workspace)
    result = await process_message(
        session_id,
        content,
        skip_guard=bool(payload.get("skip_guard", False)),
        source_sample_id=payload.get("source_sample_id"),
        actor=payload.get("actor", "business"),
    )
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "message_id": result.get("message_id", new_id("msg")),
            "accepted": True,
            "status": "processing",
            **result,
        },
    }


@router.post("/sessions/{session_id}/pause")
def pause_session(request: Request, session_id: str):
    ctx = get_auth(request)
    row = _session_row(session_id, ctx.workspace)
    if row.status not in ("active",):
        raise ApiError(40900, detail=f"会话当前状态为 {row.status}，无法暂停")
    with dbmod.session_scope() as db:
        db.get(dbmod.Session, session_id).status = "paused"
    publish_threadsafe(session_id, "session.status", {"session_id": session_id, "status": "paused"})
    return {"code": 0, "message": "ok", "data": {"session_id": session_id, "status": "paused"}}


@router.post("/sessions/{session_id}/resume")
def resume_session(request: Request, session_id: str):
    ctx = get_auth(request)
    row = _session_row(session_id, ctx.workspace)
    if row.status != "paused":
        raise ApiError(40900, detail=f"会话当前状态为 {row.status}，无法恢复")
    with dbmod.session_scope() as db:
        db.get(dbmod.Session, session_id).status = "active"
    publish_threadsafe(session_id, "session.status", {"session_id": session_id, "status": "active"})
    return {"code": 0, "message": "ok", "data": {"session_id": session_id, "status": "active"}}


@router.post("/sessions/{session_id}/terminate")
def terminate_session(request: Request, session_id: str):
    ctx = get_auth(request)
    row = _session_row(session_id, ctx.workspace)
    if row.status == "terminated":
        raise ApiError(40900, detail="会话已终止")
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Session, session_id)
        record.status = "terminated"
        record.terminated_at = now
    for call_id in list(runtime.challenges.keys()):
        runtime.cancel_challenge(call_id)
    publish_threadsafe(
        session_id, "session.status",
        {"session_id": session_id, "status": "terminated", "terminated_at": now},
    )
    return {"code": 0, "message": "ok", "data": {"session_id": session_id, "status": "terminated", "terminated_at": now}}


@router.post("/sessions/{session_id}/reset")
def reset_session(request: Request, session_id: str):
    ctx = get_auth(request)
    row = _session_row(session_id, ctx.workspace)
    with dbmod.session_scope() as db:
        instance = db.get(dbmod.Instance, row.instance_id)
    if instance is None or instance.status == "destroyed":
        raise ApiError(40900, detail="实例已销毁，无法重置会话")
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Session, session_id)
        record.status = "terminated"
        record.terminated_at = now
    new_session_id = new_id("sess")
    snapshot_id = freeze_snapshot(
        instance.instance_id, instance.config_payload, session_id=new_session_id, id_prefix="pol"
    )
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Session(
                session_id=new_session_id,
                workspace_id=ctx.workspace,
                instance_id=instance.instance_id,
                status="active",
                turn=0,
                context_summary="",
                call_count=0,
                risk_score=0.0,
                last_risk_turn=0,
                guard_enabled=row.guard_enabled,
                skip_guard_turns=[],
                policy_snapshot_id=snapshot_id,
                created_at=now,
                terminated_at=None,
                max_risk="none",
                block_count=0,
                challenge_count=0,
                limit_block_count=0,
                degrade_count=0,
                allow_count=0,
                mode=quota.get_mode(),
                degradations=[],
            )
        )
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "previous_session_id": session_id,
            "session_id": new_session_id,
            "status": "active",
            "policy_snapshot_id": snapshot_id,
        },
    }


def _call_view(c):
    return {
        "call_id": c.call_id,
        "session_id": c.session_id,
        "turn": c.turn,
        "tool": c.tool,
        "params_summary": c.params_summary,
        "params_raw": c.params_raw,
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


@router.get("/sessions/{session_id}/calls")
def list_calls(request: Request, session_id: str):
    ctx = get_auth(request)
    _session_row(session_id, ctx.workspace)
    with dbmod.session_scope() as db:
        rows = (
            db.query(dbmod.CallRecord)
            .filter(dbmod.CallRecord.session_id == session_id)
            .order_by(dbmod.CallRecord.created_at)
            .all()
        )
        items = [_call_view(c) for c in rows]
    return {"code": 0, "message": "ok", "data": {"items": items, "total": len(items)}}


def _alert_view(a):
    return {
        "alert_id": a.alert_id,
        "session_id": a.session_id,
        "instance_id": a.instance_id,
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


@router.get("/sessions/{session_id}/alerts")
def list_alerts(request: Request, session_id: str, level: str | None = None, action: str | None = None):
    ctx = get_auth(request)
    _session_row(session_id, ctx.workspace)
    with dbmod.session_scope() as db:
        query = db.query(dbmod.Alert).filter(dbmod.Alert.session_id == session_id)
        if level:
            query = query.filter(dbmod.Alert.level == level)
        if action:
            query = query.filter(dbmod.Alert.action == action)
        rows = query.order_by(dbmod.Alert.created_at).all()
        items = [_alert_view(a) for a in rows]
    return {"code": 0, "message": "ok", "data": {"items": items, "total": len(items)}}


@router.post("/alerts/{alert_id}/feedback")
def alert_feedback(request: Request, alert_id: str, payload: dict = Body(...)):
    ctx = get_auth(request)
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Alert, alert_id)
        if row is None:
            raise ApiError(40400, detail="告警不存在")
        session = db.get(dbmod.Session, row.session_id)
        if session is None or session.workspace_id != ctx.workspace:
            raise ApiError(40400, detail="告警不存在")
        if "false_positive" in payload:
            row.false_positive = bool(payload["false_positive"])
        if "false_negative" in payload:
            row.false_negative = bool(payload["false_negative"])
        if "note" in payload:
            row.note = str(payload["note"])[:500]
        data = _alert_view(row)
    return {"code": 0, "message": "ok", "data": data}


@router.post("/sessions/{session_id}/challenges/{call_id}")
def challenge_decision(request: Request, session_id: str, call_id: str, payload: dict = Body(...)):
    ctx = get_auth(request)
    _session_row(session_id, ctx.workspace)
    if "approved" not in payload:
        raise ApiError(40000, detail="缺少 approved 字段")
    resolved = runtime.resolve_challenge(call_id, bool(payload["approved"]))
    if not resolved:
        raise ApiError(40900, detail="该质询已超时或已被处理")
    return {
        "code": 0,
        "message": "ok",
        "data": {"call_id": call_id, "approved": bool(payload["approved"])},
    }


@router.post("/sessions/{session_id}/redteam/start")
async def start_redteam(request: Request, session_id: str, payload: dict = Body(default={})):
    ctx = get_auth(request)
    heavy_check(request, "redteam")
    row = _session_row(session_id, ctx.workspace)
    if row.status != "active":
        raise ApiError(40900, detail="仅活跃会话可启动红队")
    if runtime.redteam_flags.get(session_id):
        raise ApiError(40900, detail="该会话红队已在运行")
    max_rounds = int(payload.get("max_rounds", 5))
    time_limit_s = float(payload.get("time_limit_s", 120))
    task = asyncio.create_task(redteam_mod.run_redteam(session_id, max_rounds, time_limit_s))
    runtime.tasks[session_id] = task
    return {
        "code": 0,
        "message": "ok",
        "data": {"session_id": session_id, "status": "running", "max_rounds": max_rounds},
    }


@router.post("/sessions/{session_id}/redteam/stop")
def stop_redteam_route(request: Request, session_id: str):
    ctx = get_auth(request)
    _session_row(session_id, ctx.workspace)
    redteam_mod.stop_redteam(session_id)
    return {"code": 0, "message": "ok", "data": {"session_id": session_id, "status": "stopping"}}


@router.post("/sessions/{session_id}/record")
def record_snapshot(request: Request, session_id: str, payload: dict = Body(default={})):
    ctx = get_auth(request)
    ctx.require("admin")
    _session_row(session_id, ctx.workspace)
    name = payload.get("name") or f"会话录制-{session_id}"
    snapshot_id = record_session(session_id, name)
    return {"code": 0, "message": "ok", "data": {"snapshot_id": snapshot_id, "name": name}}


@router.get("/sessions/{session_id}/events")
async def session_events(request: Request, session_id: str):
    ctx = get_sse_auth(request)
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Session, session_id)
        if row is None or row.workspace_id != ctx.workspace:
            raise ApiError(40400, detail="会话不存在")
    last_id_raw = request.headers.get("Last-Event-ID") or request.query_params.get("last_event_id") or "0"
    try:
        last_id = int(last_id_raw)
    except ValueError:
        last_id = 0
    limit_raw = request.query_params.get("limit")
    try:
        limit = int(limit_raw) if limit_raw else None
    except ValueError:
        limit = None
    follow = request.query_params.get("follow", "true").lower() != "false"

    async def stream():
        queue = event_bus.subscribe(session_id)
        sent = 0
        try:
            for record in event_bus.history_since(session_id, last_id):
                yield _frame(record)
                sent += 1
                if limit is not None and sent >= limit:
                    return
            if not follow:
                return
            while True:
                if await request.is_disconnected():
                    break
                try:
                    record = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield _frame(record)
                sent += 1
                if limit is not None and sent >= limit:
                    break
        finally:
            event_bus.unsubscribe(session_id, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _frame(record):
    return f"id: {record['id']}\nevent: {record['event']}\ndata: {json.dumps(record['data'], ensure_ascii=False)}\n\n"