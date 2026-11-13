from ..core.ids import new_id
from .partition import sandbox_manager
from .tools import TOOL_IMPLS, mask_fields


def invoke(request):
    """SandboxInvokeRequest → SandboxInvokeResult，处置在工具执行前合并生效。"""
    instance_id = request["instance_id"]
    tool = request["tool"]
    params = dict(request.get("params") or {})
    decision = request.get("policy_decision") or {}
    action = decision.get("action", "allow")
    sandbox_key = request.get("sandbox_key") or f"sbx:{instance_id}"

    if action == "block":
        return {
            "ok": False,
            "data": {"refused": True, "reason": decision.get("reason", "网关拦截")},
            "simulated": True,
            "log": {"delivery_log_id": None, "sandbox_action": "refused"},
        }

    partition = sandbox_manager.get(sandbox_key)
    if partition is None:
        return {
            "ok": False,
            "data": {"error": "沙盒分区不存在"},
            "simulated": True,
            "log": {"delivery_log_id": None, "sandbox_action": "missing_partition"},
        }

    impl = TOOL_IMPLS.get(tool)
    if impl is None:
        return {
            "ok": False,
            "data": {"error": f"工具 {tool} 未注册"},
            "simulated": True,
            "log": {"delivery_log_id": None, "sandbox_action": "unknown_tool"},
        }

    if tool == "query_api":
        perm_mask = params.pop("_mask_fields", None)
        if perm_mask is None:
            perm_mask = decision.get("mask_fields") or []
        params["_mask_fields"] = perm_mask
    if tool == "write_file":
        params["_overwrite_allowed"] = bool(decision.get("overwrite_allowed", False))

    result = impl(partition, params)

    if action == "degrade" and result.get("ok"):
        result = _degrade(tool, result, decision)

    delivery_log_id = result.get("delivery_log_id") if tool == "send_email" else None
    return {
        "ok": bool(result.get("ok")),
        "data": result,
        "simulated": True,
        "log": {
            "delivery_log_id": delivery_log_id,
            "sandbox_action": f"{tool}:{'ok' if result.get('ok') else 'error'}",
        },
    }


def _degrade(tool, result, decision):
    degraded = dict(result)
    if tool == "read_file":
        content = degraded.get("content", "")
        degraded["content"] = content[:80] + ("…（降级截断）" if len(content) > 80 else "")
        degraded["degraded"] = True
    elif tool == "query_api":
        fields = decision.get("mask_fields") or ["phone", "id_card"]
        degraded["data"] = mask_fields(degraded.get("data"), fields)
        degraded["degraded"] = True
    elif tool == "send_email":
        degraded["note"] = "降级放行：邮件正文已截断，仅写入沙盒日志"
        degraded["degraded"] = True
    else:
        degraded["degraded"] = True
    return degraded


def new_call_id():
    return new_id("rec")