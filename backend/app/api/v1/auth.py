from fastapi import APIRouter, Body, Request
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from ...core import quota
from ...core.errors import ApiError
from ...core.security import (
    AUTH_LIMIT,
    issue_token,
    rate_limiter,
    revoke_token,
    verify_passcode,
)
from ...models import db as dbmod
from ..deps import client_ip, get_auth

router = APIRouter()


def _consume_one_time(passcode):
    """原子消费一次性口令：并发请求下仅一个成功，避免先读后写竞态。"""
    with dbmod.session_scope() as db:
        consumed = (
            db.query(dbmod.PasscodeUse)
            .filter_by(passcode=passcode, used_count=0)
            .update({"used_count": 1})
        )
        if consumed:
            return True
        stmt = (
            sqlite_insert(dbmod.PasscodeUse)
            .values(passcode=passcode, used_count=1)
            .on_conflict_do_nothing()
        )
        return db.execute(stmt).rowcount == 1


@router.post("/auth/token")
def auth_token(request: Request, payload: dict = Body(...)):
    rate_limiter.check(f"auth:{client_ip(request)}", AUTH_LIMIT)
    passcode = str(payload.get("passcode", ""))
    client_id = str(payload.get("client_id", ""))
    if not passcode:
        raise ApiError(40000, detail="passcode 不能为空", field_errors=[
            {"field": "passcode", "error": "必填"}
        ])
    role = verify_passcode(passcode, consume_hook=_consume_one_time)
    token, expires_in = issue_token(role, client_id)
    return {
        "code": 0,
        "message": "ok",
        "data": {"token": token, "expires_in": expires_in, "mode": quota.get_mode(), "role": role},
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