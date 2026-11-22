import re
import time

from fastapi import Request

from ..core.config import settings
from ..core.errors import ApiError
from ..core.security import (
    GENERAL_LIMIT,
    GUEST_GENERAL_LIMIT,
    HEAVY_LIMIT,
    bind_auth,
    iso,
    rate_limiter,
    resolve_token,
    utcnow,
)
from ..models import db as dbmod

WORKSPACE_HEADER = "X-Workspace-Id"
DEFAULT_WORKSPACE = "default"
WORKSPACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$")

# last_seen 写库节流：同一工作区 5 分钟内只回写一次，避免高频请求写放大。
_SEEN_CACHE: dict[str, float] = {}
_SEEN_INTERVAL_S = 300


def client_ip(request: Request):
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _register_workspace(workspace_id: str):
    now = iso(utcnow())
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Workspace, workspace_id)
        if row is None:
            db.add(dbmod.Workspace(workspace_id=workspace_id, created_at=now, last_seen_at=now))
        else:
            row.last_seen_at = now


def resolve_workspace(request: Request) -> str:
    """匿名工作区标识：取自 X-Workspace-Id 头，缺失时回退到 default（兼容旧客户端）。"""
    raw = request.headers.get(WORKSPACE_HEADER, "").strip()
    if not raw:
        return DEFAULT_WORKSPACE
    if not WORKSPACE_RE.match(raw):
        raise ApiError(40000, detail="工作区标识格式非法")
    now = time.monotonic()
    if now - _SEEN_CACHE.get(raw, 0.0) > _SEEN_INTERVAL_S:
        _register_workspace(raw)
        _SEEN_CACHE[raw] = now
    return raw


def _apply_workspace(ctx, request: Request):
    """令牌已绑定工作区时强制一致，杜绝改头越权；未绑定的旧令牌沿用请求头。"""
    raw = request.headers.get(WORKSPACE_HEADER, "").strip()
    if ctx.workspace:
        if raw and raw != ctx.workspace:
            raise ApiError(40300, detail="工作区与令牌绑定不一致")
        return ctx.workspace
    ctx.workspace = resolve_workspace(request)
    return ctx.workspace


def get_auth(request: Request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise ApiError(40100, detail="缺少 Bearer 令牌")
    ctx = resolve_token(header[7:].strip())
    ctx.ip = client_ip(request)
    ip_limit = GUEST_GENERAL_LIMIT if ctx.role == "guest" else GENERAL_LIMIT
    rate_limiter.check(f"ip:{ctx.ip}", ip_limit)
    rate_limiter.check(f"token:{ctx.token}", GENERAL_LIMIT)
    _apply_workspace(ctx, request)
    rate_limiter.check(f"ws:{ctx.workspace}", ip_limit)
    bind_auth(ctx)
    return ctx


def get_sse_auth(request: Request):
    """SSE 通道鉴权：优先 Authorization 头，兼容查询参数令牌（旧式 EventSource 客户端）。"""
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.startswith("Bearer ") else request.query_params.get("token")
    ctx = resolve_token(token)
    ctx.ip = client_ip(request)
    ip_limit = GUEST_GENERAL_LIMIT if ctx.role == "guest" else GENERAL_LIMIT
    rate_limiter.check(f"ip:{ctx.ip}", ip_limit)
    rate_limiter.check(f"token:{ctx.token}", GENERAL_LIMIT)
    _apply_workspace(ctx, request)
    rate_limiter.check(f"ws:{ctx.workspace}", ip_limit)
    bind_auth(ctx)
    return ctx


def heavy_check(request: Request, kind: str):
    rate_limiter.check(f"heavy:{kind}:{client_ip(request)}", HEAVY_LIMIT)
