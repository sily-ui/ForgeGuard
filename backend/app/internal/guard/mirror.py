"""流量镜像：业务 Agent 工具执行前的最小化取数，独立通道、不阻塞业务。"""

from ...core.ids import new_id
from ...core.security import iso, utcnow

CONTEXT_TRUNCATE = 400


def build_mirror_request(
    session_id, turn, user_input, context_summary, tool_name, tool_params, baseline_summary
):
    summary = context_summary or ""
    if len(summary) > CONTEXT_TRUNCATE:
        summary = summary[:CONTEXT_TRUNCATE] + "…（已截断）"
    return {
        "mirror_id": new_id("mir"),
        "session_id": session_id,
        "turn": turn,
        "user_input": (user_input or "")[:2000],
        "recent_context_summary": summary,
        "tool_name": tool_name,
        "tool_params": tool_params or {},
        "baseline_summary": baseline_summary,
        "timestamp": iso(utcnow()),
    }