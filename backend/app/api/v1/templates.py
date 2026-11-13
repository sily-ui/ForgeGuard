from fastapi import APIRouter, Request

from ...core.response import paginate, parse_pagination, slice_page
from ...data.templates import TEMPLATES
from ..deps import get_auth

router = APIRouter()


@router.get("/templates")
def list_templates(request: Request, page: int = 1, page_size: int = 20):
    get_auth(request)
    page, page_size = parse_pagination(page, page_size)
    items = [
        {
            "id": t["id"],
            "name": t["name"],
            "description": t["description"],
            "suggested_tools": t["suggested_tools"],
            "suggested_guard": t["suggested_guard"],
            "risk_note": t["risk_note"],
            "config": t["config"],
        }
        for t in TEMPLATES
    ]
    return {
        "code": 0,
        "message": "ok",
        "data": paginate(slice_page(items, page, page_size), page, page_size, total=len(items)),
    }