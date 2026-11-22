from fastapi import APIRouter, Body, Request

from ...core import quota
from ...core.errors import ApiError
from ...core.response import paginate, parse_pagination, slice_page
from ...core.security import iso, revoke_all_tokens, utcnow
from ...core.state import runtime
from ...internal.events import event_bus
from ...models import db as dbmod
from ...orchestration import suggestions
from ...orchestration.runner import record_session
from ...sandbox.partition import sandbox_manager
from ..deps import get_auth

router = APIRouter()


def _admin(request):
    ctx = get_auth(request)
    ctx.require("admin")
    return ctx


@router.put("/admin/quota")
def adjust_quota(request: Request, payload: dict = Body(...)):
    _admin(request)
    global_max = payload.get("global_max")
    session_max = payload.get("session_max")
    if global_max is not None and (not isinstance(global_max, int) or global_max < 1):
        raise ApiError(40000, detail="global_max 须为正整数")
    if session_max is not None and (not isinstance(session_max, int) or session_max < 1):
        raise ApiError(40000, detail="session_max 须为正整数")
    data = quota.adjust(global_max=global_max, session_max=session_max)
    return {"code": 0, "message": "ok", "data": data}


@router.post("/admin/snapshot")
def switch_mode(request: Request, payload: dict = Body(...)):
    _admin(request)
    mode = payload.get("mode")
    if mode not in ("live", "replay"):
        raise ApiError(40000, detail="mode 仅支持 live 或 replay")
    snapshot_id = payload.get("snapshot_id")
    if mode == "replay" and snapshot_id:
        with dbmod.session_scope() as db:
            if db.get(dbmod.SnapshotRecording, snapshot_id) is None:
                raise ApiError(40400, detail="快照不存在")
    reason = payload.get("reason") or ("管理员切换快照回放" if mode == "replay" else "管理员恢复实时模式")
    quota.set_mode(mode, reason=reason, snapshot_id=snapshot_id)
    return {"code": 0, "message": "ok", "data": {"mode": mode, "reason": reason, "snapshot_id": snapshot_id}}


@router.get("/admin/snapshots")
def list_snapshots(request: Request, page: int = 1, page_size: int = 20):
    _admin(request)
    page, page_size = parse_pagination(page, page_size)
    with dbmod.session_scope() as db:
        rows = (
            db.query(dbmod.SnapshotRecording)
            .order_by(dbmod.SnapshotRecording.created_at.desc())
            .all()
        )
        items = [
            {
                "snapshot_id": r.snapshot_id,
                "name": r.name,
                "session_id": r.session_id,
                "event_count": len(r.events.get("events", [])),
                "call_count": len(r.events.get("calls", [])),
                "created_at": r.created_at,
            }
            for r in rows
        ]
    return {
        "code": 0,
        "message": "ok",
        "data": paginate(slice_page(items, page, page_size), page, page_size, total=len(items)),
    }


@router.post("/admin/snapshots")
def create_snapshot(request: Request, payload: dict = Body(...)):
    _admin(request)
    session_id = payload.get("session_id")
    if not session_id:
        raise ApiError(40000, detail="缺少 session_id")
    with dbmod.session_scope() as db:
        if db.get(dbmod.Session, session_id) is None:
            raise ApiError(40400, detail="会话不存在")
    name = payload.get("name") or f"快照-{session_id}"
    snapshot_id = record_session(session_id, name)
    return {"code": 0, "message": "ok", "data": {"snapshot_id": snapshot_id, "name": name}}


@router.post("/admin/cleanup")
def cleanup(request: Request, payload: dict = Body(...)):
    _admin(request)
    if not payload.get("confirm"):
        raise ApiError(40000, detail="清理需二次确认：请求体携带 confirm=true")
    scope = payload.get("scope", "daily")
    if scope not in ("daily", "pre_contest"):
        raise ApiError(40000, detail="scope 仅支持 daily 或 pre_contest")
    now = iso(utcnow())
    counts = {"instances": 0, "sessions": 0, "sandbox_partitions": 0, "suggestion_caches": 0}
    with dbmod.session_scope() as db:
        if scope == "daily":
            instances = (
                db.query(dbmod.Instance)
                .filter(dbmod.Instance.status.in_(("ready", "frozen", "pending")))
                .filter(dbmod.Instance.expires_at < now)
                .all()
            )
        else:
            instances = (
                db.query(dbmod.Instance)
                .filter(dbmod.Instance.status != "destroyed")
                .all()
            )
        for instance in instances:
            instance.status = "destroyed"
            counts["instances"] += 1
            session_rows = (
                db.query(dbmod.Session)
                .filter(dbmod.Session.instance_id == instance.instance_id)
                .filter(dbmod.Session.status != "terminated")
                .all()
            )
            for session in session_rows:
                session.status = "terminated"
                session.terminated_at = now
                counts["sessions"] += 1
        if scope == "pre_contest":
            terminated = (
                db.query(dbmod.Session)
                .filter(dbmod.Session.status != "terminated")
                .all()
            )
            for session in terminated:
                session.status = "terminated"
                session.terminated_at = now
                counts["sessions"] += 1
        counts["suggestion_caches"] = suggestions.prune_cache(db)
        db.add(
            dbmod.CleanupLog(scope=scope, counts=counts, operator="admin", created_at=now)
        )
    for key in sandbox_manager.keys():
        if scope == "pre_contest" or key.replace("sbx:", "") not in _alive_instance_ids():
            sandbox_manager.destroy(key)
            counts["sandbox_partitions"] += 1
    return {"code": 0, "message": "ok", "data": {"scope": scope, "counts": counts, "cleaned_at": now}}


def _alive_instance_ids():
    with dbmod.session_scope() as db:
        rows = (
            db.query(dbmod.Instance.instance_id)
            .filter(dbmod.Instance.status.in_(("creating", "pending", "ready", "frozen")))
            .all()
        )
        return {r[0] for r in rows}


@router.get("/admin/metrics")
def metrics(request: Request):
    _admin(request)
    with dbmod.session_scope() as db:
        total_calls = db.query(dbmod.CallRecord).count()
        total_alerts = db.query(dbmod.Alert).count()
        false_positive = db.query(dbmod.Alert).filter(dbmod.Alert.false_positive.is_(True)).count()
        false_negative = db.query(dbmod.Alert).filter(dbmod.Alert.false_negative.is_(True)).count()
        action_rows = db.query(dbmod.CallRecord.judgement).all()
        instances_alive = (
            db.query(dbmod.Instance)
            .filter(dbmod.Instance.status.in_(("creating", "pending", "ready", "frozen")))
            .count()
        )
        sessions_active = db.query(dbmod.Session).filter(dbmod.Session.status == "active").count()
        reports = db.query(dbmod.Report).count()
    action_dist = {}
    judged_by_dist = {}
    for (judgement,) in action_rows:
        action = (judgement or {}).get("action", "unknown")
        action_dist[action] = action_dist.get(action, 0) + 1
        judged_by = (judgement or {}).get("judged_by", "unknown")
        judged_by_dist[judged_by] = judged_by_dist.get(judged_by, 0) + 1
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "total_calls": total_calls,
            "total_alerts": total_alerts,
            "false_positive_marks": false_positive,
            "false_negative_marks": false_negative,
            "action_distribution": action_dist,
            "judged_by_distribution": judged_by_dist,
            "instances_alive": instances_alive,
            "sessions_active": sessions_active,
            "reports": reports,
            "quota": quota.status(),
            "state_backend": runtime.state_backend,
            "rate_limit_hits": len(rate_limiter_hits()),
        },
    }


def rate_limiter_hits():
    from ...core.security import rate_limiter

    return list(rate_limiter.hit_log)


@router.post("/admin/tokens/invalidate")
def invalidate_tokens(request: Request):
    ctx = _admin(request)
    count = revoke_all_tokens()
    return {"code": 0, "message": "ok", "data": {"invalidated": count}}


@router.get("/admin/degradations")
def degradations(request: Request):
    _admin(request)
    with dbmod.session_scope() as db:
        rows = (
            db.query(dbmod.Session)
            .filter(dbmod.Session.degradations.isnot(None))
            .all()
        )
        items = [
            {"session_id": r.session_id, "degradations": r.degradations}
            for r in rows
            if r.degradations
        ]
    return {"code": 0, "message": "ok", "data": {"items": items, "total": len(items)}}