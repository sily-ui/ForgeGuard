from fastapi import APIRouter, Body, Request

from ...core.errors import ApiError
from ...core.response import paginate, parse_pagination, slice_page
from ...data.samples import CATEGORY_NAMES, SAMPLES, applicability, get_sample, sample_view
from ...internal.llm.proxy import force_simulated
from ...models import db as dbmod
from ...orchestration.runner import process_message
from ...policies.baseline import enabled_tools
from ..deps import get_auth

router = APIRouter()


@router.get("/samples")
def list_samples(
    request: Request,
    instance_id: str | None = None,
    category: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    ctx = get_auth(request)
    page, page_size = parse_pagination(page, page_size)
    tools = []
    if instance_id:
        with dbmod.session_scope() as db:
            instance = db.get(dbmod.Instance, instance_id)
            if instance is None or instance.workspace_id != ctx.workspace:
                raise ApiError(40400, detail="实例不存在")
            tools = enabled_tools(instance.config_payload)
    items = []
    for sample in SAMPLES:
        if category and sample["category"] != category:
            continue
        view = sample_view(sample, tools)
        items.append(view)
    items.sort(key=lambda s: (not s["applicable"], s["category"], s["sample_id"]))
    return {
        "code": 0,
        "message": "ok",
        "data": {
            **paginate(slice_page(items, page, page_size), page, page_size, total=len(items)),
            "categories": CATEGORY_NAMES,
        },
    }


@router.post("/sessions/{session_id}/samples/{sample_id}/load")
async def load_sample(request: Request, session_id: str, sample_id: str, payload: dict = Body(default={})):
    ctx = get_auth(request)
    sample = get_sample(sample_id)
    if sample is None:
        raise ApiError(40400, detail="样本不存在")
    with dbmod.session_scope() as db:
        session = db.get(dbmod.Session, session_id)
        if session is None or session.workspace_id != ctx.workspace:
            raise ApiError(40400, detail="会话不存在")
        instance = db.get(dbmod.Instance, session.instance_id)
    if instance is None:
        raise ApiError(40400, detail="实例不存在")
    tools = enabled_tools(instance.config_payload)
    applicable, reason = applicability(sample, tools)
    if not applicable and not payload.get("force"):
        raise ApiError(40900, detail=reason)
    # fast：一键演示的快速链路——整条调用链走离线仿真，秒级完成、答辩可控、不耗配额。
    fast = bool(payload.get("fast"))
    results = []
    if fast:
        with force_simulated("演示链路：快速仿真模式"):
            for setup in sample.get("setup_turns", []):
                results.append(await process_message(session_id, setup, source_sample_id=sample_id))
            results.append(
                await process_message(session_id, sample["payload"], source_sample_id=sample_id)
            )
    else:
        for setup in sample.get("setup_turns", []):
            results.append(await process_message(session_id, setup, source_sample_id=sample_id))
        results.append(
            await process_message(session_id, sample["payload"], source_sample_id=sample_id)
        )
    final = results[-1]
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "sample_id": sample_id,
            "setup_turns_executed": len(results) - 1,
            "turn": final.get("turn"),
            "reply": final.get("reply"),
            "actions": final.get("actions", []),
            "max_risk": final.get("max_risk", "none"),
            "call_ids": final.get("call_ids", []),
            "mode": final.get("mode", "live"),
        },
    }