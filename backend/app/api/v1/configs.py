from fastapi import APIRouter, Body, Request

from ...core.errors import ApiError, ModelUnavailable
from ...core.ids import new_id
from ...core.response import paginate, parse_pagination, slice_page
from ...core.security import iso, utcnow
from ...models import db as dbmod
from ...policies.baseline import normalize_config, validate_config
from ...policies.mapping import generate_policies, llm_cost_estimate
from ..deps import get_auth

router = APIRouter()


def _template_prompt(name, purpose):
    """模型不可用时的确定性回退：依据名称/用途生成合规系统提示词（≤200 字）。"""
    role = name or "企业内部助手"
    duty = (purpose or "协助用户完成授权的内部事务")[:60]
    return (
        f"你是{role}，职责：{duty}。"
        "仅访问与职责相关的公开文档与内部接口，敏感字段脱敏后展示。"
        "禁止读取凭证或敏感文件、向外域发送邮件、执行系统命令。"
        "越权请求须拒绝并说明原因。"
    )


@router.post("/configs/suggest-prompt")
async def suggest_prompt(request: Request, payload: dict = Body(...)):
    get_auth(request)
    name = str(payload.get("name", "")).strip()
    purpose = str(payload.get("purpose", "")).strip()
    if not name and not purpose:
        raise ApiError(40000, detail="请先填写实例名称或声明用途")

    from ...core.config import settings
    from ...internal.llm.proxy import llm_proxy, strip_code_fence

    if settings.model_configured:
        meta = [
            {
                "role": "system",
                "content": (
                    "你是 Agent 系统提示词撰写专家。根据给定的【实例名称】与【声明用途】，"
                    "撰写一段中文系统提示词，用于定义该 Agent 的人设与授权边界。要求：\n"
                    "1. 明确角色与职责（贴合声明用途）；\n"
                    "2. 明确允许的动作（可访问的文档/接口范围）；\n"
                    "3. 明确禁止的动作：禁止读取凭证或敏感文件、禁止向外部域名发送邮件、禁止执行系统命令；\n"
                    "4. 要求对越权请求拒绝并说明原因；\n"
                    "5. 纯文本、不超过 200 字，语言精炼，不要输出 Markdown 代码块或任何解释。"
                ),
            },
            {"role": "user", "content": f"【实例名称】{name or '（未填写）'}\n【声明用途】{purpose or '（未填写）'}"},
        ]
        try:
            result = await llm_proxy.chat("business", meta, max_tokens=1200, temperature=0.4)
            text = strip_code_fence(result["content"]).strip()
            if text:
                return {
                    "code": 0,
                    "message": "ok",
                    "data": {"system_prompt": text[:200], "simulated": False},
                }
        except ModelUnavailable:
            pass
    return {
        "code": 0,
        "message": "ok",
        "data": {"system_prompt": _template_prompt(name, purpose), "simulated": True},
    }


def _validation_error(result):
    has_conflict = any(e["code"] == "conflict" for e in result["errors"])
    raise ApiError(
        40001 if has_conflict else 40000,
        detail="；".join(e["message"] for e in result["errors"]),
        field_errors=[{"field": e["field"], "error": e["message"]} for e in result["errors"]],
    )


def _get_config(config_id, workspace="default"):
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Config, config_id)
        if row is None or row.deleted or row.workspace_id != workspace:
            raise ApiError(40400, detail="配置不存在")
        return row


@router.get("/configs")
def list_configs(request: Request, page: int = 1, page_size: int = 20):
    ctx = get_auth(request)
    page, page_size = parse_pagination(page, page_size)
    with dbmod.session_scope() as db:
        rows = (
            db.query(dbmod.Config)
            .filter(dbmod.Config.deleted.is_(False), dbmod.Config.workspace_id == ctx.workspace)
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
    ctx = get_auth(request)
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
                workspace_id=ctx.workspace,
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
    ctx = get_auth(request)
    row = _get_config(config_id, ctx.workspace)
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
    ctx = get_auth(request)
    row = _get_config(config_id, ctx.workspace)
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
    ctx = get_auth(request)
    _get_config(config_id, ctx.workspace)
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Config, config_id)
        record.deleted = True
        record.updated_at = iso(utcnow())
    return {"code": 0, "message": "ok", "data": {"config_id": config_id, "deleted": True}}


@router.post("/configs/import")
def import_config(request: Request, payload: dict = Body(...)):
    ctx = get_auth(request)
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
                workspace_id=ctx.workspace,
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
    ctx = get_auth(request)
    row = _get_config(config_id, ctx.workspace)
    payload = dict(row.payload)
    payload["version"] = row.version
    return {"code": 0, "message": "ok", "data": payload}