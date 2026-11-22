from fastapi import APIRouter, Body, Request

from ...core import quota
from ...core.config import settings
from ...core.errors import ApiError
from ...core.security import AUTH_LIMIT, issue_token, iso, rate_limiter, revoke_token, utcnow
from ...models import db as dbmod
from ..deps import DEFAULT_WORKSPACE, client_ip, get_auth, resolve_workspace

router = APIRouter()


@router.post("/auth/guest")
def auth_guest(request: Request, payload: dict = Body(default={})):
    """匿名游客准入：无需口令，凭工作区标识签发受限令牌。"""
    rate_limiter.check(f"auth:{client_ip(request)}", AUTH_LIMIT)
    workspace_id = resolve_workspace(request)
    if workspace_id == DEFAULT_WORKSPACE:
        raise ApiError(40000, detail="缺少工作区标识", field_errors=[
            {"field": "X-Workspace-Id", "error": "必填"}
        ])
    client_id = str(payload.get("client_id", ""))[:64]
    token, expires_in = issue_token("guest", client_id, workspace_id=workspace_id)
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "token": token,
            "expires_in": expires_in,
            "mode": quota.get_mode(),
            "role": "guest",
            "workspace_id": workspace_id,
            "daily_max_calls": settings.quota_guest_daily,
        },
    }


@router.post("/auth/admin")
def auth_admin(request: Request, payload: dict = Body(default={})):
    """管理员引导准入：凭部署时配置的 ADMIN_BOOTSTRAP_KEY 换取 admin 令牌。"""
    import secrets as _secrets

    rate_limiter.check(f"auth:{client_ip(request)}", AUTH_LIMIT)
    configured = settings.admin_bootstrap_key
    provided = str(payload.get("bootstrap_key", ""))
    if not configured or not _secrets.compare_digest(configured, provided):
        raise ApiError(40300, detail="管理员准入未开放或引导密钥错误")
    token, expires_in = issue_token("admin", "bootstrap")
    return {
        "code": 0,
        "message": "ok",
        "data": {"token": token, "expires_in": expires_in, "role": "admin"},
    }


@router.post("/auth/logout")
def logout(request: Request):
    ctx = get_auth(request)
    revoke_token(ctx.token)
    return {"code": 0, "message": "ok", "data": {"revoked": True}}


@router.get("/quota")
def get_quota(request: Request, session_id: str | None = None):
    get_auth(request)
    return {"code": 0, "message": "ok", "data": quota.status(session_id)}


@router.get("/auth/workspace")
def workspace_info(request: Request):
    ctx = get_auth(request)
    workspace_id = ctx.workspace
    alive_statuses = ("creating", "pending", "ready", "frozen")
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Workspace, workspace_id)
        alive_instances = (
            db.query(dbmod.Instance)
            .filter(
                dbmod.Instance.workspace_id == workspace_id,
                dbmod.Instance.status.in_(alive_statuses),
            )
            .count()
        )
        configs = (
            db.query(dbmod.Config)
            .filter(dbmod.Config.workspace_id == workspace_id, dbmod.Config.deleted.is_(False))
            .count()
        )
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "workspace_id": workspace_id,
            "is_default": workspace_id == "default",
            "created_at": row.created_at if row else None,
            "alive_instances": alive_instances,
            "configs": configs,
            "server_time": iso(utcnow()),
        },
    }