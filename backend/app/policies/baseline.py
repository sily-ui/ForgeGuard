TOOL_NAMES = [
    "read_file",
    "write_file",
    "send_email",
    "query_api",
    "run_cmd",
    "update_config",
]

DEFAULT_PERMS = {
    "read_file": {
        "allow_paths": ["./docs", "./report"],
        "deny_names": ["secret.txt", "credentials.json"],
    },
    "write_file": {"allow_paths": ["./tmp"], "overwrite": False},
    "send_email": {"allow_domains": ["example.com"], "max_recipients": 3},
    "query_api": {
        "allow_endpoints": ["/user/info", "/order/list"],
        "mask_fields": ["phone", "id_card"],
    },
    "run_cmd": {"allow_cmds": ["ls", "cat"]},
    "update_config": {"allow_keys": ["log_level", "theme"]},
}

DEFAULT_LIMITS = {
    "max_calls_per_turn": 5,
    "max_calls_per_session": 60,
    "timeout_ms": 15000,
}

PRESET_NAMES = ["loose", "standard", "strict", "custom"]


def _norm_path(value):
    path = str(value).strip().replace("\\", "/").rstrip("/")
    if path and not path.startswith(("./", "/")):
        path = "./" + path
    return path


def normalize_config(payload):
    """把 dict 或 list 形式的 tools 统一为按工具名索引的结构，并补齐默认值。"""
    if not isinstance(payload, dict):
        raise ValueError("配置必须是 JSON 对象")
    config = {
        "name": str(payload.get("name", "")).strip(),
        "purpose": str(payload.get("purpose", "") or ""),
        "system_prompt": str(payload.get("system_prompt", "") or ""),
        "tools": {},
        "limits": dict(DEFAULT_LIMITS),
        "guard": {"preset": "standard", "overrides": []},
    }
    raw_tools = payload.get("tools", {})
    entries = {}
    if isinstance(raw_tools, list):
        for item in raw_tools:
            if isinstance(item, dict) and item.get("name"):
                entries[item["name"]] = item
    elif isinstance(raw_tools, dict):
        entries = raw_tools
    for name in TOOL_NAMES:
        raw = entries.get(name, {}) or {}
        enabled = bool(raw.get("enabled", False))
        perm = dict(DEFAULT_PERMS[name])
        raw_perm = raw.get("perm") or {}
        if isinstance(raw_perm, dict):
            for key, value in raw_perm.items():
                if value is not None:
                    perm[key] = value
        for key in ("allow_paths", "deny_names", "allow_domains", "allow_endpoints", "mask_fields", "allow_cmds", "allow_keys"):
            if key in perm and not isinstance(perm[key], list):
                raise TypeError(f"tools.{name}.perm.{key} 必须是列表")
        if "allow_paths" in perm:
            perm["allow_paths"] = [_norm_path(p) for p in perm["allow_paths"] if str(p).strip()]
        config["tools"][name] = {"enabled": enabled, "perm": perm}
    unknown = [name for name in entries if name not in TOOL_NAMES]
    config["_unknown_tools"] = unknown

    raw_limits = payload.get("limits") or {}
    for key in DEFAULT_LIMITS:
        if key in raw_limits:
            try:
                config["limits"][key] = int(raw_limits[key])
            except (TypeError, ValueError):
                config["limits"][key] = DEFAULT_LIMITS[key]
    raw_guard = payload.get("guard") or {}
    preset = raw_guard.get("preset", "standard")
    config["guard"]["preset"] = preset if preset in PRESET_NAMES else "standard"
    overrides = raw_guard.get("overrides") or []
    config["guard"]["overrides"] = overrides if isinstance(overrides, list) else []
    return config


def validate_config(payload):
    errors = []
    warnings = []
    try:
        config = normalize_config(payload)
    except (ValueError, TypeError) as exc:
        return {
            "valid": False,
            "errors": [{"field": "config", "code": "format", "message": f"配置格式非法：{exc}"}],
            "warnings": [],
        }

    if not config["name"]:
        errors.append({"field": "name", "code": "required", "message": "实例名称不能为空"})
    elif len(config["name"]) > 32:
        errors.append({"field": "name", "code": "too_long", "message": "实例名称不得超过 32 字符"})
    if not config["system_prompt"]:
        errors.append(
            {"field": "system_prompt", "code": "required", "message": "系统提示词不能为空"}
        )
    elif len(config["system_prompt"]) > 4000:
        errors.append(
            {"field": "system_prompt", "code": "too_long", "message": "系统提示词不得超过 4000 字符"}
        )
    for name in config.get("_unknown_tools", []):
        errors.append(
            {"field": f"tools.{name}", "code": "unknown_tool", "message": f"未知工具 {name}"}
        )

    tools = config["tools"]
    read_perm = tools["read_file"]["perm"]
    if tools["read_file"]["enabled"]:
        allow = set(read_perm["allow_paths"])
        for deny in read_perm["deny_names"]:
            for path in allow:
                if path == deny or path.endswith("/" + deny) or path.split("/")[-1] == deny:
                    errors.append(
                        {
                            "field": "tools.read_file.perm",
                            "code": "conflict",
                            "message": f"同一路径 {deny} 同时出现在允许与禁止清单",
                        }
                    )
        if not read_perm["deny_names"]:
            warnings.append(
                {
                    "code": "risk_no_deny",
                    "message": "启用 read_file 但未设置任何禁止项，越权读取敏感文件将无法被对象边界拦截",
                }
            )
    write_perm = tools["write_file"]["perm"]
    if tools["write_file"]["enabled"]:
        if any(p in (".", "./", "/") for p in write_perm["allow_paths"]):
            warnings.append(
                {
                    "code": "risk_write_root",
                    "message": "允许写入根路径，任意文件覆写可能被链式攻击利用",
                }
            )
    if tools["send_email"]["enabled"] and not tools["send_email"]["perm"]["allow_domains"]:
        errors.append(
            {
                "field": "tools.send_email.perm.allow_domains",
                "code": "required",
                "message": "启用 send_email 时收件域名清单不能为空",
            }
        )
    if tools["query_api"]["enabled"] and not tools["query_api"]["perm"]["mask_fields"]:
        warnings.append(
            {
                "code": "risk_no_mask",
                "message": "启用 query_api 但未配置脱敏字段，返回敏感字段将构成数据外泄风险",
            }
        )
    if tools["run_cmd"]["enabled"]:
        warnings.append(
            {
                "code": "risk_run_cmd",
                "message": "启用 run_cmd 会扩大攻击面，即使为仿真命令也建议最小化白名单",
            }
        )
    limits = config["limits"]
    if limits["max_calls_per_session"] < limits["max_calls_per_turn"]:
        errors.append(
            {
                "field": "limits.max_calls_per_session",
                "code": "conflict",
                "message": "会话调用上限不得小于单轮调用上限",
            }
        )
    if not 1 <= limits["max_calls_per_turn"] <= 20:
        errors.append(
            {
                "field": "limits.max_calls_per_turn",
                "code": "range",
                "message": "单轮调用上限应在 1~20 之间",
            }
        )
    if not 1 <= limits["max_calls_per_session"] <= 500:
        errors.append(
            {
                "field": "limits.max_calls_per_session",
                "code": "range",
                "message": "会话调用上限应在 1~500 之间",
            }
        )
    if not 1000 <= limits["timeout_ms"] <= 60000:
        errors.append(
            {
                "field": "limits.timeout_ms",
                "code": "range",
                "message": "单次超时应在 1000~60000 毫秒之间",
            }
        )
    return {"valid": not errors, "errors": errors, "warnings": warnings}


def parse_baseline(config):
    """基线解析：工具面 / 权限面 / 约束面。"""
    tool_facet = {}
    perm_facet = {}
    for name, item in config["tools"].items():
        if item["enabled"]:
            tool_facet[name] = item["perm"]
            perm_facet[name] = dict(item["perm"])
    return {
        "tools": tool_facet,
        "permissions": perm_facet,
        "limits": dict(config["limits"]),
        "preset": config["guard"]["preset"],
    }


def enabled_tools(config):
    return [name for name, item in config["tools"].items() if item["enabled"]]