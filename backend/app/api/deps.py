from fastapi import Request

from ..core.errors import ApiError
from ..core.security import (
    GENERAL_LIMIT,
    HEAVY_LIMIT,
    rate_limiter,
    resolve_token,
)


def client_ip(request: Request):
    return request.client.host if request.client else "unknown"


def get_auth(request: Request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise ApiError(40100, detail="缺少 Bearer 令牌")
    ctx = resolve_token(header[7:].strip())
    rate_limiter.check(f"ip:{client_ip(request)}", GENERAL_LIMIT)
    rate_limiter.check(f"token:{ctx.token}", GENERAL_LIMIT)
    return ctx


def get_sse_auth(request: Request):
    """EventSource 无法携带请求头，SSE 通道额外支持查询参数令牌。"""
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.startswith("Bearer ") else request.query_params.get("token")
    return resolve_token(token)


def heavy_check(request: Request, kind: str):
    rate_limiter.check(f"heavy:{kind}:{client_ip(request)}", HEAVY_LIMIT)