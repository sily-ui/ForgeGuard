import copy
from datetime import timedelta

from fastapi import APIRouter, Body, Request

from ...core.config import settings
from ...core.errors import ApiError
from ...core.idempotency import get_cached, store
from ...core.ids import new_instance_id
from ...core.response import paginate, parse_pagination, slice_page
from ...core.security import iso, parse_iso, utcnow
from ...models import db as dbmod
from ...policies.baseline import enabled_tools, normalize_config, validate_config
from ...policies.snapshot import (
    apply_policy_override,
    freeze_snapshot,
    get_snapshot,
    snapshot_view,
)
from ...sandbox.partition import sandbox_manager
from ..deps import get_auth, heavy_check

router = APIRouter()

ALIVE_STATUSES = ("creating", "pending", "ready", "frozen")


def _instance_row(instance_id, workspace="default"):
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Instance, instance_id)
        if row is None or row.workspace_id != workspace:
            raise ApiError(40400, detail="实例不存在")
        return row


def _instance_view(row, with_config=False):
    data = {
        "instance_id": row.instance_id,
        "name": row.name,
        "status": row.status,
        "source_config_id": row.source_config_id,
        "clone_source_id": row.clone_source_id,
        "sandbox_key": row.sandbox_key,
        "policy_snapshot_id": row.policy_snapshot_id,
        "guard": {"preset": row.guard_preset, "enabled": row.status != "destroyed"},
        "created_at": row.created_at,
        "expires_at": row.expires_at,
        "last_active_at": row.last_active_at,
        "stats": row.stats or {},
        "enabled_tools": enabled_tools(row.config_payload),
    }
    if row.clone_source_id:
        data["diff_from_source"] = row.diff_from_source or []
    if with_config:
        data["config"] = row.config_payload
    return data


def _alive_count(db):
    return (
        db.query(dbmod.Instance)
        .filter(dbmod.Instance.status.in_(ALIVE_STATUSES))
        .count()
    )


def _create_instance(config, source_config_id, name, guard_preset, workspace="default", clone_source_id=None, diff=None):
    """原子四步：校验基线 → 冻结策略 → 分配分区 → 装载工具。"""
    result = validate_config(config)
    if not result["valid"]:
        raise ApiError(
            42200,
            detail="编排配置无法通过校验",
            field_errors=[{"field": e["field"], "error": e["message"]} for e in result["errors"]],
        )
    config = normalize_config(config)
    config["guard"]["preset"] = guard_preset or config["guard"]["preset"]
    instance_id = new_instance_id(name or config["name"])
    sandbox_key = f"sbx:{instance_id}"
    now = utcnow()
    snapshot_id = freeze_snapshot(instance_id, config, id_prefix="pol")
    sandbox_manager.create(sandbox_key)
    with dbmod.session_scope() as db:
        if _alive_count(db) >= settings.instance_max:
            sandbox_manager.destroy(sandbox_key)
            raise ApiError(42902, detail=f"存活实例数已达上限 {settings.instance_max}")
        db.add(
            dbmod.Instance(
                instance_id=instance_id,
                workspace_id=workspace,
                name=name or config["name"],
                source_config_id=source_config_id,
                clone_source_id=clone_source_id,
                diff_from_source=diff or [],
                status="ready",
                sandbox_key=sandbox_key,
                policy_snapshot_id=snapshot_id,
                config_payload=config,
                guard_preset=config["guard"]["preset"],
                created_at=iso(now),
                expires_at=iso(now + timedelta(minutes=settings.instance_ttl_minutes)),
                last_active_at=iso(now),
                stats={"call_count": 0, "risk_score": 0.0},
            )
        )
    return {
        "instance_id": instance_id,
        "status": "ready",
        "sandbox_key": sandbox_key,
        "policy_snapshot_id": snapshot_id,
        "created_at": iso(now),
    }


@router.post("/instances")
def create_instance(request: Request, payload: dict = Body(...)):
    ctx = get_auth(request)
    heavy_check(request, "instance")
    idem_key = request.headers.get("X-Idempotency-Key")
    cached = get_cached(idem_key, "instances")
    if cached is not None:
        return cached
    config_id = payload.get("config_id")
    if config_id:
        with dbmod.session_scope() as db:
            cfg = db.get(dbmod.Config, config_id)
            if cfg is None or cfg.deleted or cfg.workspace_id != ctx.workspace:
                raise ApiError(40400, detail="配置不存在")
            config = copy.deepcopy(cfg.payload)
            config_version = cfg.version
    elif payload.get("config"):
        config = copy.deepcopy(payload["config"])
        config_version = str(config.get("version", "1.0"))
    else:
        raise ApiError(40000, detail="缺少 config_id 或 config")
    data = _create_instance(
        config,
        config_id or "inline",
        payload.get("name"),
        payload.get("guard_preset"),
        workspace=ctx.workspace,
    )
    data["config_version"] = config_version
    response = {"code": 0, "message": "ok", "data": data}
    store(idem_key, "instances", response)
    return response


@router.get("/instances")
def list_instances(request: Request, status: str | None = None, page: int = 1, page_size: int = 20):
    ctx = get_auth(request)
    page, page_size = parse_pagination(page, page_size)
    with dbmod.session_scope() as db:
        query = db.query(dbmod.Instance).filter(dbmod.Instance.workspace_id == ctx.workspace)
        if status:
            query = query.filter(dbmod.Instance.status == status)
        rows = query.order_by(dbmod.Instance.created_at.desc()).all()
        items = [_instance_view(r) for r in rows]
    return {
        "code": 0,
        "message": "ok",
        "data": paginate(slice_page(items, page, page_size), page, page_size, total=len(items)),
    }


@router.get("/instances/{instance_id}")
def get_instance(request: Request, instance_id: str):
    ctx = get_auth(request)
    row = _instance_row(instance_id, ctx.workspace)
    return {"code": 0, "message": "ok", "data": _instance_view(row, with_config=True)}


def _diff_configs(source, target):
    """逐项列出两份配置的差异，供比对视图与报告使用。"""
    diffs = []
    for field in ("name", "purpose", "system_prompt"):
        if source.get(field) != target.get(field):
            diffs.append({"field": field, "change": f"{source.get(field)!r} → {target.get(field)!r}"})
    s_tools, t_tools = source.get("tools", {}), target.get("tools", {})
    for tool in sorted(set(s_tools) | set(t_tools)):
        s, t = s_tools.get(tool), t_tools.get(tool)
        if s is None:
            diffs.append({"field": f"tools.{tool}", "change": "新增工具"})
            continue
        if t is None:
            diffs.append({"field": f"tools.{tool}", "change": "移除工具"})
            continue
        if bool(s.get("enabled")) != bool(t.get("enabled")):
            diffs.append(
                {"field": f"tools.{tool}.enabled", "change": f"{s.get('enabled')} → {t.get('enabled')}"}
            )
        s_perm, t_perm = s.get("perm", {}), t.get("perm", {})
        for key in sorted(set(s_perm) | set(t_perm)):
            if s_perm.get(key) != t_perm.get(key):
                diffs.append(
                    {
                        "field": f"tools.{tool}.perm.{key}",
                        "change": f"{s_perm.get(key)!r} → {t_perm.get(key)!r}",
                    }
                )
    if source.get("limits") != target.get("limits"):
        diffs.append({"field": "limits", "change": f"{source.get('limits')!r} → {target.get('limits')!r}"})
    if source.get("guard", {}).get("preset") != target.get("guard", {}).get("preset"):
        diffs.append(
            {
                "field": "guard.preset",
                "change": f"{source.get('guard', {}).get('preset')} → {target.get('guard', {}).get('preset')}",
            }
        )
    return diffs


def _merge_modified(base, modified):
    """modified_config 支持 tools 局部覆盖：{tool: {enabled, perm}}。"""
    merged = copy.deepcopy(base)
    if not modified:
        return merged
    for key, value in modified.items():
        if key == "tools" and isinstance(value, dict):
            for tool, spec in value.items():
                current = merged["tools"].setdefault(tool, {"enabled": False, "perm": {}})
                if isinstance(spec, dict):
                    if "enabled" in spec:
                        current["enabled"] = spec["enabled"]
                    if "perm" in spec:
                        current["perm"] = spec["perm"]
        else:
            merged[key] = copy.deepcopy(value)
    return merged


@router.post("/instances/{instance_id}/clone")
def clone_instance(request: Request, instance_id: str, payload: dict = Body(default={})):
    ctx = get_auth(request)
    heavy_check(request, "instance")
    row = _instance_row(instance_id, ctx.workspace)
    if row.status == "destroyed":
        raise ApiError(40900, detail="已销毁实例不可克隆")
    mode = payload.get("mode", "verbatim")
    config = copy.deepcopy(row.config_payload)
    if mode == "modified":
        config = _merge_modified(config, payload.get("modified_config"))
        result = validate_config(config)
        if not result["valid"]:
            raise ApiError(
                42200,
                detail="克隆配置无法通过校验",
                field_errors=[{"field": e["field"], "error": e["message"]} for e in result["errors"]],
            )
    diff = _diff_configs(row.config_payload, config)
    name = payload.get("name") or f"{row.name}-克隆"
    data = _create_instance(
        config,
        row.source_config_id,
        name,
        payload.get("guard_preset") or row.guard_preset,
        workspace=ctx.workspace,
        clone_source_id=instance_id,
        diff=diff,
    )
    data["diff_from_source"] = diff
    data["diff_note"] = payload.get("diff_note", "")
    return {"code": 0, "message": "ok", "data": data}


@router.post("/instances/{instance_id}/recycle")
def recycle_instance(request: Request, instance_id: str, payload: dict = Body(default={})):
    ctx = get_auth(request)
    row = _instance_row(instance_id, ctx.workspace)
    if not payload.get("confirm"):
        raise ApiError(40000, detail="回收需二次确认：请求体携带 confirm=true")
    if row.status == "destroyed":
        raise ApiError(40900, detail="实例已销毁")
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Instance, instance_id)
        record.status = "destroyed"
        db.query(dbmod.Session).filter(dbmod.Session.instance_id == instance_id).update(
            {"status": "terminated", "terminated_at": iso(utcnow())}, synchronize_session=False
        )
    sandbox_manager.destroy(row.sandbox_key)
    return {"code": 0, "message": "ok", "data": {"instance_id": instance_id, "status": "destroyed"}}


@router.post("/instances/{instance_id}/renew")
def renew_instance(request: Request, instance_id: str):
    ctx = get_auth(request)
    row = _instance_row(instance_id, ctx.workspace)
    if row.status == "destroyed":
        raise ApiError(40900, detail="已销毁实例不可续期")
    try:
        base = parse_iso(row.expires_at)
        if base < utcnow():
            base = utcnow()
    except (ValueError, TypeError):
        base = utcnow()
    new_expiry = iso(base + timedelta(minutes=settings.instance_ttl_minutes))
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Instance, instance_id)
        record.expires_at = new_expiry
        if record.status == "frozen":
            record.status = "ready"
    return {"code": 0, "message": "ok", "data": {"instance_id": instance_id, "expires_at": new_expiry}}


@router.get("/instances/{instance_id}/policies")
def list_policies(request: Request, instance_id: str):
    ctx = get_auth(request)
    row = _instance_row(instance_id, ctx.workspace)
    snapshot = get_snapshot(row.policy_snapshot_id)
    items = snapshot["policies"] if snapshot else []
    return {"code": 0, "message": "ok", "data": {"items": items, "total": len(items)}}


@router.put("/instances/{instance_id}/policies/{policy_id}")
def override_policy(request: Request, instance_id: str, policy_id: str, payload: dict = Body(...)):
    ctx = get_auth(request)
    row = _instance_row(instance_id, ctx.workspace)
    if row.status == "destroyed":
        raise ApiError(40900, detail="已销毁实例不可修改策略")
    snapshot = get_snapshot(row.policy_snapshot_id)
    target = next((p for p in (snapshot["policies"] if snapshot else []) if p["policy_id"] == policy_id), None)
    if target is None:
        raise ApiError(40400, detail="策略条目不存在")
    if target["rule_type"] == "tool_existence" and payload.get("enabled") is False:
        raise ApiError(40300, detail="工具存在性硬规则不允许停用")
    new_snapshot_id, error = apply_policy_override(instance_id, row.policy_snapshot_id, policy_id, payload)
    if error:
        raise ApiError(40000, detail=error)
    return {
        "code": 0,
        "message": "ok",
        "data": {"instance_id": instance_id, "policy_snapshot_id": new_snapshot_id, "policy_id": policy_id},
    }


@router.get("/instances/{instance_id}/policies/snapshot")
def policy_snapshot(request: Request, instance_id: str):
    ctx = get_auth(request)
    row = _instance_row(instance_id, ctx.workspace)
    snapshot = get_snapshot(row.policy_snapshot_id)
    if snapshot is None:
        raise ApiError(40400, detail="策略快照不存在")
    return {"code": 0, "message": "ok", "data": snapshot_view(snapshot)}