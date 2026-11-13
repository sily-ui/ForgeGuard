"""多 Agent 消息协议辅助：CapabilitySummary 与 BaselineSummary（技术分册 4.6）。"""

from ..policies.baseline import enabled_tools


def capability_summary(config):
    """只给能力面摘要，不给具体策略条目，防止红队对着规则作弊。"""
    perm_ranges = {}
    for name in enabled_tools(config):
        perm = config["tools"][name]["perm"]
        perm_ranges[name] = {
            key: value for key, value in perm.items() if key != "mask_fields"
        }
    return {
        "tools": enabled_tools(config),
        "perm_ranges": perm_ranges,
        "guard_level": config["guard"]["preset"],
    }


def baseline_summary_message(snapshot):
    return {
        "baseline_text": snapshot.get("baseline_summary", ""),
        "tool_whitelist": [
            p["params"]["tool"]
            for p in snapshot.get("policies", [])
            if p.get("rule_type") == "tool_existence" and p["params"].get("enabled")
        ],
        "deny_names": next(
            (
                p["params"].get("deny_names", [])
                for p in snapshot.get("policies", [])
                if p.get("rule_type") == "deny_filename"
            ),
            [],
        ),
        "limits": next(
            (
                {"max": p["params"].get("max"), "scope": p["params"].get("scope")}
                for p in snapshot.get("policies", [])
                if p.get("rule_type") == "call_limit"
            ),
            {},
        ),
    }