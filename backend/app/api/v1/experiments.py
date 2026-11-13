from fastapi import APIRouter, Body, Request

from ...core.errors import ApiError
from ...core.idempotency import get_cached, store
from ...core.ids import new_id
from ...core.security import iso, utcnow
from ...models import db as dbmod
from ...orchestration.runner import process_message
from ...policies.snapshot import freeze_snapshot
from ..deps import get_auth, heavy_check
from .instances import _diff_configs

router = APIRouter()


def _new_session_for(instance, guard_enabled):
    session_id = new_id("sess")
    snapshot_id = freeze_snapshot(
        instance.instance_id, instance.config_payload, session_id=session_id, id_prefix="pol"
    )
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Session(
                session_id=session_id,
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
                mode="live",
                degradations=[],
            )
        )
    return session_id


@router.post("/experiments/compare")
async def compare(request: Request, payload: dict = Body(...)):
    get_auth(request)
    heavy_check(request, "compare")
    idem_key = request.headers.get("X-Idempotency-Key")
    cached = get_cached(idem_key, "experiments.compare")
    if cached is not None:
        return cached
    dimension = payload.get("dimension", "instance")
    if dimension not in ("guard", "instance"):
        raise ApiError(40000, detail="dimension 仅支持 guard 或 instance")
    source_session_id = payload.get("source_session_id")
    content = str(payload.get("input", "")).strip()
    with dbmod.session_scope() as db:
        source = db.get(dbmod.Session, source_session_id) if source_session_id else None
    if source is None:
        raise ApiError(40400, detail="起点会话不存在")
    if not content:
        with dbmod.session_scope() as db:
            first_turn = (
                db.query(dbmod.Turn)
                .filter(dbmod.Turn.session_id == source_session_id)
                .order_by(dbmod.Turn.turn)
                .first()
            )
        if first_turn is None:
            raise ApiError(40000, detail="缺少 input 且起点会话无历史输入可复用")
        content = first_turn.user_input

    with dbmod.session_scope() as db:
        source_instance = db.get(dbmod.Instance, source.instance_id)
    if source_instance is None or source_instance.status == "destroyed":
        raise ApiError(40900, detail="起点实例已销毁，无法对照")

    if dimension == "guard":
        target_instance = source_instance
        guard_enabled = not bool(source.guard_enabled)
        diff_items = [
            {
                "field": "guard_enabled",
                "change": f"{bool(source.guard_enabled)} → {guard_enabled}",
            }
        ]
    else:
        target_instance_id = payload.get("target_instance_id")
        with dbmod.session_scope() as db:
            target_instance = db.get(dbmod.Instance, target_instance_id) if target_instance_id else None
        if target_instance is None:
            raise ApiError(40400, detail="对照实例不存在")
        if target_instance.status == "destroyed":
            raise ApiError(40900, detail="对照实例已销毁")
        guard_enabled = bool(payload.get("guard_enabled", True))
        diff_items = _diff_configs(source_instance.config_payload, target_instance.config_payload)

    run_b_session_id = _new_session_for(target_instance, guard_enabled)
    result_b = await process_message(run_b_session_id, content)

    pair_id = new_id("exp")
    run_a = {"session_id": source.session_id, "instance_id": source.instance_id}
    run_b = {"session_id": run_b_session_id, "instance_id": target_instance.instance_id}
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Experiment(
                pair_id=pair_id,
                dimension=dimension,
                source_session_id=source_session_id,
                run_a=run_a,
                run_b=run_b,
                input=content,
                diff_items=diff_items,
                status="ready",
                created_at=now,
            )
        )
    response = {
        "code": 0,
        "message": "ok",
        "data": {
            "pair_id": pair_id,
            "dimension": dimension,
            "run_a": run_a,
            "run_b": run_b,
            "diff_items": diff_items,
            "run_b_summary": {
                "actions": result_b.get("actions", []),
                "max_risk": result_b.get("max_risk", "none"),
            },
        },
    }
    store(idem_key, "experiments.compare", response)
    return response


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
            "params_summary": c.params_summary,
            "action": c.judgement.get("action"),
            "risk": c.judgement.get("risk"),
            "reason": c.judgement.get("reason"),
            "status_color": c.status_color,
            "duration_ms": c.duration_ms,
        }
        for c in rows
    ]


@router.get("/experiments/{pair_id}")
def get_experiment(request: Request, pair_id: str):
    get_auth(request)
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Experiment, pair_id)
        if row is None:
            raise ApiError(40400, detail="对照实验不存在")
        calls_a = _calls_of(db, row.run_a["session_id"])
        calls_b = _calls_of(db, row.run_b["session_id"])
        experiment = {
            "pair_id": row.pair_id,
            "dimension": row.dimension,
            "source_session_id": row.source_session_id,
            "run_a": row.run_a,
            "run_b": row.run_b,
            "input": row.input,
            "diff_items": row.diff_items,
            "status": row.status,
            "created_at": row.created_at,
        }
    rows = []
    for step in range(1, max(len(calls_a), len(calls_b)) + 1):
        a = calls_a[step - 1] if step <= len(calls_a) else None
        b = calls_b[step - 1] if step <= len(calls_b) else None
        if b is None:
            b = {"note": "本次运行未发生该步"}
        if a is None:
            a = {"note": "本次运行未发生该步"}
        rows.append({"step": step, "run_a": a, "run_b": b})
    experiment["rows"] = rows
    return {"code": 0, "message": "ok", "data": experiment}


@router.get("/experiments")
def list_experiments(request: Request, page: int = 1, page_size: int = 20):
    get_auth(request)
    from ...core.response import paginate, parse_pagination, slice_page

    page, page_size = parse_pagination(page, page_size)
    with dbmod.session_scope() as db:
        rows = db.query(dbmod.Experiment).order_by(dbmod.Experiment.created_at.desc()).all()
        items = [
            {
                "pair_id": r.pair_id,
                "dimension": r.dimension,
                "run_a": r.run_a,
                "run_b": r.run_b,
                "diff_count": len(r.diff_items or []),
                "status": r.status,
                "created_at": r.created_at,
            }
            for r in rows
        ]
    return {
        "code": 0,
        "message": "ok",
        "data": paginate(slice_page(items, page, page_size), page, page_size, total=len(items)),
    }