from fastapi import APIRouter, Body, Request

from ...core.errors import ApiError
from ...core.ids import new_id
from ...core.response import paginate, parse_pagination, slice_page
from ...core.security import iso, utcnow
from ...models import db as dbmod
from ...policies.baseline import normalize_config, validate_config
from ...policies.mapping import generate_policies, llm_cost_estimate
from ..deps import get_auth

router = APIRouter()


def _validation_error(result):
    has_conflict = any(e["code"] == "conflict" for e in result["errors"])
    raise ApiError(
        40001 if has_conflict else 40000,
        detail="；".join(e["message"] for e in result["errors"]),
        field_errors=[{"field": e["field"], "error": e["message"]} for e in result["errors"]],
    )


def _get_config(config_id):
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Config, config_id)
        if row is None or row.deleted:
            raise ApiError(40400, detail="配置不存在")
        return row


@router.get("/configs")
def list_configs(request: Request, page: int = 1, page_size: int = 20):
    get_auth(request)
    page, page_size = parse_pagination(page, page_size)
    with dbmod.session_scope() as db:
        rows = (
            db.query(dbmod.Config)
            .filter(dbmod.Config.deleted.is_(False))
            .order_by(dbmod.Config.created_at.desc())
            .all()
        )
        items = [
            {
                "config_id": r.config_id,
                "name": r.name,
                "version": r.version,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
            for r in rows
        ]
    return {
        "code": 0,
        "message": "ok",
        "data": paginate(slice_page(items, page, page_size), page, page_size, total=len(items)),
    }


@router.post("/configs/validate")
def validate(request: Request, payload: dict = Body(...)):
    get_auth(request)
    return {"code": 0, "message": "ok", "data": validate_config(payload)}


@router.post("/configs/preview")
def preview(request: Request, payload: dict = Body(...)):
    get_auth(request)
    result = validate_config(payload)
    config = normalize_config(payload)
    policies, _ = generate_policies(config, id_prefix="pol-preview")
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "policies": policies,
            "llm_cost_estimate": llm_cost_estimate(config),
            "validation": result,
        },
    }


@router.post("/configs")
def create_config(request: Request, payload: dict = Body(...)):
    get_auth(request)
    result = validate_config(payload)
    if not result["valid"]:
        _validation_error(result)
    config = normalize_config(payload)
    config.pop("_unknown_tools", None)
    config_id = new_id("cfg")
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Config(
                config_id=config_id,
                name=config["name"],
                version="1.0",
                payload=config,
                created_at=now,
                updated_at=now,
                deleted=False,
            )
        )
        db.add(
            dbmod.ConfigVersion(
                config_id=config_id, version="1.0", payload=config, created_at=now
            )
        )
    return {"code": 0, "message": "ok", "data": {"config_id": config_id, "version": "1.0"}}


@router.get("/configs/{config_id}")
def get_config(request: Request, config_id: str):
    get_auth(request)
    row = _get_config(config_id)
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "config_id": row.config_id,
            "version": row.version,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            **row.payload,
        },
    }


@router.put("/configs/{config_id}")
def update_config(request: Request, config_id: str, payload: dict = Body(...)):
    get_auth(request)
    row = _get_config(config_id)
    result = validate_config(payload)
    if not result["valid"]:
        _validation_error(result)
    config = normalize_config(payload)
    config.pop("_unknown_tools", None)
    try:
        version = f"{float(row.version) + 0.1:.1f}"
    except ValueError:
        version = "1.1"
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Config, config_id)
        record.payload = config
        record.name = config["name"]
        record.version = version
        record.updated_at = now
        db.add(
            dbmod.ConfigVersion(
                config_id=config_id, version=version, payload=config, created_at=now
            )
        )
    return {"code": 0, "message": "ok", "data": {"config_id": config_id, "version": version}}


@router.delete("/configs/{config_id}")
def delete_config(request: Request, config_id: str):
    get_auth(request)
    _get_config(config_id)
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Config, config_id)
        record.deleted = True
        record.updated_at = iso(utcnow())
    return {"code": 0, "message": "ok", "data": {"config_id": config_id, "deleted": True}}


@router.post("/configs/import")
def import_config(request: Request, payload: dict = Body(...)):
    get_auth(request)
    raw = payload.get("config", payload)
    result = validate_config(raw)
    if not result["valid"]:
        _validation_error(result)
    config = normalize_config(raw)
    config.pop("_unknown_tools", None)
    config_id = new_id("cfg")
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Config(
                config_id=config_id,
                name=config["name"],
                version=str(raw.get("version", "1.0")),
                payload=config,
                created_at=now,
                updated_at=now,
                deleted=False,
            )
        )
        db.add(
            dbmod.ConfigVersion(
                config_id=config_id,
                version=str(raw.get("version", "1.0")),
                payload=config,
                created_at=now,
            )
        )
    return {
        "code": 0,
        "message": "ok",
        "data": {"config_id": config_id, "version": str(raw.get("version", "1.0")), "validation": result},
    }


@router.get("/configs/{config_id}/export")
def export_config(request: Request, config_id: str):
    get_auth(request)
    row = _get_config(config_id)
    payload = dict(row.payload)
    payload["version"] = row.version
    return {"code": 0, "message": "ok", "data": payload}