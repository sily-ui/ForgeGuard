import hashlib
import re
import secrets
from datetime import timedelta
from urllib.parse import quote

from fastapi import APIRouter, Body, Request
from fastapi.responses import Response

from ...core.errors import ApiError
from ...core.idempotency import get_cached, store
from ...core.response import paginate, parse_pagination, slice_page
from ...core.security import iso, parse_iso, utcnow
from ...models import db as dbmod
from ...reports.builder import build_report
from ...reports.pdf import render_pdf
from ...reports.render import render_html
from ..deps import get_auth

router = APIRouter()
public_router = APIRouter()

SHARE_TTL_HOURS = 72
CACHE_MAX_AGE = 3600


def _cached_asset(request: Request, content: bytes, media_type: str, version: str, extra_headers=None):
    """报告为只读快照：以快照稳定标识生成 ETag（PDF 渲染含时间戳，字节不可作指纹），支持 If-None-Match 协商缓存。"""
    etag = '"' + hashlib.sha256(version.encode("utf-8")).hexdigest()[:32] + '"'
    headers = {"Cache-Control": f"private, max-age={CACHE_MAX_AGE}", "ETag": etag}
    if extra_headers:
        headers.update(extra_headers)
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=content, media_type=media_type, headers=headers)


def _report_row(report_id, workspace="default"):
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Report, report_id)
        if row is None or row.workspace_id != workspace:
            raise ApiError(40400, detail="报告不存在")
        return row


def _report_view(row, with_content=True):
    data = {
        "report_id": row.report_id,
        "session_id": row.session_id,
        "policy_snapshot_id": row.policy_snapshot_id,
        "config_version": row.config_version,
        "status": row.status,
        "summary": row.summary,
        "created_at": row.created_at,
        "share_expires_at": row.share_expires_at,
    }
    if with_content:
        data["content"] = row.content
    return data


@router.post("/sessions/{session_id}/report")
def generate_report(request: Request, session_id: str):
    ctx = get_auth(request)
    with dbmod.session_scope() as db:
        session = db.get(dbmod.Session, session_id)
    if session is None or session.workspace_id != ctx.workspace:
        raise ApiError(40400, detail="会话不存在")
    idem_key = request.headers.get("X-Idempotency-Key")
    cached = get_cached(idem_key, f"report:{session_id}")
    if cached is not None:
        return cached
    result, error = build_report(session_id)
    if error:
        raise ApiError(40400, detail=error)
    response = {"code": 0, "message": "ok", "data": result}
    store(idem_key, f"report:{session_id}", response)
    return response


@router.get("/reports")
def list_reports(request: Request, session_id: str | None = None, page: int = 1, page_size: int = 20):
    ctx = get_auth(request)
    page, page_size = parse_pagination(page, page_size)
    with dbmod.session_scope() as db:
        query = db.query(dbmod.Report).filter(dbmod.Report.workspace_id == ctx.workspace)
        if session_id:
            query = query.filter(dbmod.Report.session_id == session_id)
        rows = query.order_by(dbmod.Report.created_at.desc()).all()
        items = [_report_view(r, with_content=False) for r in rows]
    return {
        "code": 0,
        "message": "ok",
        "data": paginate(slice_page(items, page, page_size), page, page_size, total=len(items)),
    }


@router.get("/reports/{report_id}")
def get_report(request: Request, report_id: str):
    ctx = get_auth(request)
    row = _report_row(report_id, ctx.workspace)
    return {"code": 0, "message": "ok", "data": _report_view(row)}


@router.post("/reports/{report_id}/share-link")
def share_link(request: Request, report_id: str, payload: dict = Body(default={})):
    ctx = get_auth(request)
    _report_row(report_id, ctx.workspace)
    token = secrets.token_urlsafe(24)
    hours = int(payload.get("ttl_hours", SHARE_TTL_HOURS))
    expires = iso(utcnow() + timedelta(hours=max(1, min(hours, 24 * 30))))
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Report, report_id)
        record.share_token = token
        record.share_expires_at = expires
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "report_id": report_id,
            "share_url": f"/share/reports/{token}",
            "share_token": token,
            "expires_at": expires,
            "read_only": True,
        },
    }


@public_router.get("/share/reports/{share_token}")
def shared_report(share_token: str, request: Request):
    """只读分享页，无需令牌；过期即失效。"""
    with dbmod.session_scope() as db:
        row = (
            db.query(dbmod.Report)
            .filter(dbmod.Report.share_token == share_token)
            .first()
        )
        if row is None:
            raise ApiError(40400, detail="分享链接不存在")
        expires = parse_iso(row.share_expires_at)
        if expires is None or expires < utcnow():
            raise ApiError(40100, detail="分享链接已过期")
        report = {
            "report_id": row.report_id,
            "created_at": row.created_at,
            "content": row.content,
        }
    return _cached_asset(
        request,
        render_html(report).encode("utf-8"),
        "text/html; charset=utf-8",
        f"{report['report_id']}:{report['created_at']}",
    )


@router.get("/reports/{report_id}/view")
def report_view(request: Request, report_id: str):
    ctx = get_auth(request)
    row = _report_row(report_id, ctx.workspace)
    html = render_html({"report_id": row.report_id, "created_at": row.created_at, "content": row.content})
    return _cached_asset(request, html.encode("utf-8"), "text/html; charset=utf-8", f"{row.report_id}:{row.created_at}")


@router.get("/reports/{report_id}/export.pdf")
def export_pdf(request: Request, report_id: str):
    ctx = get_auth(request)
    row = _report_row(report_id, ctx.workspace)
    pdf_bytes = render_pdf(
        {"report_id": row.report_id, "created_at": row.created_at, "content": row.content}
    )
    filename = _pdf_filename(row)
    return _cached_asset(
        request,
        pdf_bytes,
        "application/pdf",
        f"{row.report_id}:{row.created_at}",
        {
            "Content-Disposition": (
                f'attachment; filename="beforebound-report.pdf"; '
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )


def _pdf_filename(row):
    """语义化文件名：越界之前_测评报告_{实例名}_{日期}.pdf（RFC 5987 编码中文）。"""
    name = (row.content.get("part1_overview") or {}).get("instance_name") or "靶标Agent"
    safe = re.sub(r'[\\/:*?"<>|\s]+', "_", str(name).strip())[:40] or "靶标Agent"
    date = (row.created_at or "")[:10].replace("-", "")
    return f"越界之前_测评报告_{safe}_{date}.pdf"