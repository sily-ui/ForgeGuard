from .baseline import TOOL_NAMES, enabled_tools

PRESETS = {
    "loose": {
        "l2_high": 0.90,
        "l2_gray_low": 0.60,
        "block_medium": False,
        "challenge_enabled": False,
        "always_l3": False,
        "note": "仅高危越权拦截，中等风险只记录不阻断",
    },
    "standard": {
        "l2_high": 0.75,
        "l2_gray_low": 0.45,
        "block_medium": False,
        "challenge_enabled": True,
        "always_l3": False,
        "note": "越权一律阻断，可疑但未越权记录告警或质询",
    },
    "strict": {
        "l2_high": 0.60,
        "l2_gray_low": 0.30,
        "block_medium": True,
        "challenge_enabled": True,
        "always_l3": True,
        "note": "任何越权迹象即阻断，并做跨轮一致性检查",
    },
}

SENSITIVE_CONFIG_KEYS = [
    "admin_password",
    "api_key",
    "secret_key",
    "db_password",
    "guard_preset",
    "allow_paths",
]


def preset_params(preset):
    return dict(PRESETS.get(preset, PRESETS["standard"]))


def _policy(seq, level, rule_type, condition, action, source, params, id_prefix="pol"):
    return {
        "policy_id": f"{id_prefix}-{seq:02d}",
        "level": level,
        "rule_type": rule_type,
        "condition": condition,
        "action": action,
        "source": source,
        "origin": "auto",
        "enabled": True,
        "params": params,
    }


def generate_policies(config, preset=None, overrides=None, id_prefix="pol"):
    preset = preset or config["guard"]["preset"]
    params = preset_params(preset)
    policies = []
    seq = 0

    def add(level, rule_type, condition, action, source, rule_params):
        nonlocal seq
        seq += 1
        policies.append(
            _policy(seq, level, rule_type, condition, action, source, rule_params, id_prefix)
        )

    for name in TOOL_NAMES:
        enabled = config["tools"][name]["enabled"]
        condition = (
            f"{name} 已启用，允许在权限范围内调用"
            if enabled
            else f"{name} 未启用，任何调用均为越界调用工具"
        )
        add(
            "L1",
            "tool_existence",
            condition,
            "block",
            f"tools.{name}.enabled",
            {"tool": name, "enabled": enabled},
        )

    tools = config["tools"]
    if tools["read_file"]["enabled"]:
        perm = tools["read_file"]["perm"]
        add(
            "L1",
            "allow_path_prefix",
            f"read_file.path 不以 {', '.join(perm['allow_paths']) or '（空）'} 开头",
            "block",
            "read_file.allow_paths",
            {"allow_paths": perm["allow_paths"]},
        )
        add(
            "L1",
            "deny_filename",
            f"read_file.path 命中 {', '.join(perm['deny_names']) or '（空）'}",
            "block",
            "read_file.deny_names",
            {"deny_names": perm["deny_names"]},
        )
        add(
            "L1",
            "path_traversal",
            "read_file.path 含路径穿越片段（.. 或绝对路径）",
            "block",
            "read_file.perm",
            {},
        )
    if tools["write_file"]["enabled"]:
        perm = tools["write_file"]["perm"]
        add(
            "L1",
            "allow_path_prefix",
            f"write_file.path 不以 {', '.join(perm['allow_paths']) or '（空）'} 开头",
            "block",
            "write_file.allow_paths",
            {"allow_paths": perm["allow_paths"]},
        )
        add(
            "L1",
            "path_traversal",
            "write_file.path 含路径穿越片段（.. 或绝对路径）",
            "block",
            "write_file.perm",
            {},
        )
        add(
            "L1",
            "overwrite_check",
            "write_file 目标已存在且未授权覆盖",
            "block",
            "write_file.overwrite",
            {"overwrite": perm["overwrite"]},
        )
    if tools["send_email"]["enabled"]:
        perm = tools["send_email"]["perm"]
        add(
            "L1",
            "allow_domain_suffix",
            f"send_email 收件域名不在 {', '.join(perm['allow_domains'])} 内",
            "block",
            "send_email.allow_domains",
            {"allow_domains": perm["allow_domains"]},
        )
        add(
            "L1",
            "max_recipients",
            f"send_email 收件人数超过 {perm['max_recipients']}",
            "block",
            "send_email.max_recipients",
            {"max_recipients": perm["max_recipients"]},
        )
    if tools["query_api"]["enabled"]:
        perm = tools["query_api"]["perm"]
        add(
            "L1",
            "allow_endpoint",
            f"query_api.endpoint 不在 {', '.join(perm['allow_endpoints']) or '（空）'} 内",
            "block",
            "query_api.allow_endpoints",
            {"allow_endpoints": perm["allow_endpoints"]},
        )
        add(
            "L1",
            "mask_fields",
            f"query_api 返回须对 {', '.join(perm['mask_fields']) or '（空）'} 脱敏",
            "degrade",
            "query_api.mask_fields",
            {"mask_fields": perm["mask_fields"]},
        )
    if tools["run_cmd"]["enabled"]:
        perm = tools["run_cmd"]["perm"]
        add(
            "L1",
            "allow_cmd",
            f"run_cmd.cmd 不在 {', '.join(perm['allow_cmds']) or '（空）'} 内",
            "block",
            "run_cmd.allow_cmds",
            {"allow_cmds": perm["allow_cmds"]},
        )
    if tools["update_config"]["enabled"]:
        perm = tools["update_config"]["perm"]
        add(
            "L1",
            "allow_key",
            f"update_config.key 不在 {', '.join(perm['allow_keys']) or '（空）'} 内",
            "block",
            "update_config.allow_keys",
            {"allow_keys": perm["allow_keys"]},
        )
        add(
            "L1",
            "sensitive_key",
            f"update_config.key 命中敏感键 {', '.join(SENSITIVE_CONFIG_KEYS)}",
            "block",
            "update_config.sensitive",
            {"sensitive_keys": SENSITIVE_CONFIG_KEYS},
        )

    limits = config["limits"]
    add(
        "L1",
        "call_limit",
        f"单轮工具调用超过 {limits['max_calls_per_turn']} 次",
        "block",
        "limits.max_calls_per_turn",
        {"scope": "turn", "max": limits["max_calls_per_turn"]},
    )
    add(
        "L1",
        "call_limit",
        f"会话累计调用超过 {limits['max_calls_per_session']} 次",
        "block",
        "limits.max_calls_per_session",
        {"scope": "session", "max": limits["max_calls_per_session"]},
    )
    add(
        "L1",
        "timeout",
        f"单次调用超过 {limits['timeout_ms']} 毫秒",
        "block",
        "limits.timeout_ms",
        {"timeout_ms": limits["timeout_ms"]},
    )
    add(
        "L2",
        "threshold",
        f"注入概率 ≥ {params['l2_high']} 判高危短路，≥ {params['l2_gray_low']} 进灰区",
        "challenge",
        "guard.preset",
        {"high": params["l2_high"], "gray_low": params["l2_gray_low"]},
    )
    add(
        "L3",
        "prompt_rule",
        "语义判定须对照基线摘要，输出固定 JSON 结论",
        "challenge",
        "guard.preset",
        {"preset": preset},
    )

    rejected = apply_overrides(policies, overrides or [])
    return policies, rejected


def apply_overrides(policies, overrides):
    """把人工覆盖合并进策略条目；工具存在性硬规则不允许停用。"""
    rejected = []
    by_id = {p["policy_id"]: p for p in policies}
    by_source = {}
    for p in policies:
        by_source.setdefault(p["source"], []).append(p)
    for ov in overrides:
        if not isinstance(ov, dict):
            continue
        targets = []
        if ov.get("policy_id") and ov["policy_id"] in by_id:
            targets = [by_id[ov["policy_id"]]]
        elif ov.get("source"):
            targets = by_source.get(ov["source"], [])
        for policy in targets:
            if policy["rule_type"] == "tool_existence" and ov.get("enabled") is False:
                rejected.append(
                    {"policy_id": policy["policy_id"], "reason": "工具存在性硬规则不允许停用"}
                )
                continue
            if "action" in ov and ov["action"] in ("allow", "block", "challenge", "degrade"):
                policy["action"] = ov["action"]
            if "enabled" in ov:
                policy["enabled"] = bool(ov["enabled"])
            if isinstance(ov.get("threshold"), dict):
                policy.setdefault("params", {}).update(ov["threshold"])
            policy["origin"] = "manual"
            if ov.get("note"):
                policy["override_note"] = ov["note"]
    return rejected


def baseline_summary(config, preset=None):
    preset = preset or config["guard"]["preset"]
    lines = [
        f"Agent 名称：{config['name']}",
        f"声明用途：{config['purpose'] or '未标注用途的自定义 Agent'}",
        f"系统提示词：{config['system_prompt']}",
        f"防护档位：{preset}（{preset_params(preset)['note']}）",
    ]
    enabled = enabled_tools(config)
    lines.append("启用工具：" + (", ".join(enabled) if enabled else "无"))
    for name in enabled:
        perm = config["tools"][name]["perm"]
        parts = []
        for key, value in perm.items():
            if isinstance(value, list):
                parts.append(f"{key}=[{', '.join(str(v) for v in value)}]")
            else:
                parts.append(f"{key}={value}")
        lines.append(f"  {name} 授权：{'；'.join(parts)}")
    disabled = [n for n in TOOL_NAMES if n not in enabled]
    if disabled:
        lines.append("未启用工具（任何调用均为越界）：" + ", ".join(disabled))
    limits = config["limits"]
    lines.append(
        f"调用约束：单轮 ≤ {limits['max_calls_per_turn']} 次，"
        f"会话 ≤ {limits['max_calls_per_session']} 次，"
        f"单次超时 {limits['timeout_ms']}ms"
    )
    manual = [p for p in config["guard"].get("overrides", []) if isinstance(p, dict)]
    if manual:
        lines.append(f"人工覆盖项：{len(manual)} 项（详见策略条目 origin=manual）")
    return "\n".join(lines)


def llm_cost_estimate(config):
    return {"l1": 0, "l2": 0, "l3": 1}