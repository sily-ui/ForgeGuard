"""L1 规则层：纯函数、配置表驱动、按工具索引，时延预算 ≤ 20ms。"""

import posixpath

_BOUNDARY_ORDER = {"tool": 0, "object": 1, "param": 2}

_TOOL_NAMES = {"read_file", "write_file", "send_email", "query_api", "run_cmd", "update_config"}


def _rule_tool(policy):
    """工具专属规则只作用于其所属工具。

    优先取 params.tool；旧快照无此字段时按 source 前缀（如 write_file.allow_paths）推断，
    避免 write_file 的允许路径误判 read_file 等同名参数工具。全局规则（limits.*）返回 None。
    """
    tool = policy.get("params", {}).get("tool")
    if tool:
        return tool
    prefix = str(policy.get("source", "")).split(".", 1)[0]
    return prefix if prefix in _TOOL_NAMES else None


def _norm_path(path):
    path = str(path or "").strip().replace("\\", "/")
    if path and not path.startswith(("./", "/")):
        path = "./" + path
    return path


def _recipients(params):
    to = params.get("to") or params.get("recipients") or []
    if isinstance(to, str):
        to = [addr.strip() for addr in to.split(",") if addr.strip()]
    return [addr for addr in to if addr]


def _hit(policy, boundary, reason, confidence="certain", kind="risk"):
    return {
        "policy_id": policy["policy_id"],
        "source": policy["source"],
        "rule_type": policy["rule_type"],
        "boundary": boundary,
        "confidence": confidence,
        "action": policy.get("action", "block"),
        "reason": reason,
        "kind": kind,
    }


def evaluate(tool_name, params, rules, context=None):
    context = context or {}
    hits = []
    params = params or {}
    path = _norm_path(params.get("path"))

    for policy in rules:
        if policy.get("level") != "L1" or not policy.get("enabled", True):
            continue
        rule_type = policy["rule_type"]
        rule_params = policy.get("params", {})

        rule_tool = _rule_tool(policy)
        if rule_tool and rule_tool != tool_name:
            continue

        if rule_type == "tool_existence":
            if rule_params.get("tool") == tool_name and not rule_params.get("enabled", False):
                hits.append(
                    _hit(policy, "tool", f"越界调用工具：{tool_name} 未在实例中启用")
                )
        elif rule_type == "allow_path_prefix":
            allow = rule_params.get("allow_paths") or []
            # 前缀匹配带分隔符边界：./docs 放行 ./docs/x，但不得放行 ./docsEVIL/x。
            if path and allow and not any(
                path == prefix.rstrip("/") or path.startswith(prefix.rstrip("/") + "/")
                for prefix in allow
            ):
                hits.append(
                    _hit(
                        policy,
                        "object",
                        f"对象边界命中：{path} 不在允许路径 {', '.join(allow)} 内",
                    )
                )
        elif rule_type == "deny_filename":
            deny = rule_params.get("deny_names") or []
            name = posixpath.basename(path) if path else ""
            if name and name in deny:
                hits.append(
                    _hit(policy, "object", f"对象边界命中：{name} 在禁止读取清单内")
                )
        elif rule_type == "path_traversal":
            parts = path.split("/")
            if path and (".." in parts or path.startswith("/") or "\\" in str(params.get("path", ""))):
                hits.append(
                    _hit(policy, "param", f"参数边界命中：路径 {path} 含穿越片段或绝对路径")
                )
        elif rule_type == "overwrite_check":
            existing = context.get("existing_files") or set()
            if path and path in existing and not rule_params.get("overwrite", False):
                hits.append(
                    _hit(policy, "param", f"参数边界命中：{path} 已存在且未授权覆盖")
                )
        elif rule_type == "allow_domain_suffix":
            allow = rule_params.get("allow_domains") or []
            for addr in _recipients(params):
                domain = addr.split("@")[-1].lower()
                if allow and not any(domain == d or domain.endswith("." + d) for d in allow):
                    hits.append(
                        _hit(
                            policy,
                            "object",
                            f"对象边界命中：收件域名 {domain} 不在允许清单 {', '.join(allow)} 内",
                        )
                    )
                    break
        elif rule_type == "max_recipients":
            limit = int(rule_params.get("max_recipients", 3))
            recipients = _recipients(params)
            if len(recipients) > limit:
                hits.append(
                    _hit(
                        policy,
                        "param",
                        f"参数边界命中：收件人数 {len(recipients)} 超过上限 {limit}",
                    )
                )
        elif rule_type == "allow_endpoint":
            allow = rule_params.get("allow_endpoints") or []
            endpoint = str(params.get("endpoint", ""))
            if endpoint and allow and endpoint not in allow:
                hits.append(
                    _hit(
                        policy,
                        "object",
                        f"对象边界命中：接口 {endpoint} 不在允许端点清单内",
                    )
                )
        elif rule_type == "allow_cmd":
            allow = rule_params.get("allow_cmds") or []
            cmd = str(params.get("cmd") or params.get("command") or "").strip()
            name = cmd.split(" ")[0] if cmd else ""
            if name and allow and name not in allow:
                hits.append(
                    _hit(policy, "object", f"对象边界命中：命令 {name} 不在白名单内")
                )
        elif rule_type == "allow_key":
            allow = rule_params.get("allow_keys") or []
            key = str(params.get("key", ""))
            if key and allow and key not in allow:
                hits.append(
                    _hit(policy, "object", f"对象边界命中：配置键 {key} 不在允许清单内")
                )
        elif rule_type == "sensitive_key":
            sensitive = rule_params.get("sensitive_keys") or []
            key = str(params.get("key", ""))
            if key and key in sensitive:
                hits.append(
                    _hit(policy, "object", f"对象边界命中：{key} 为敏感配置键，单列高危")
                )
        elif rule_type == "call_limit":
            scope = rule_params.get("scope")
            limit = int(rule_params.get("max", 0))
            if scope == "turn":
                used = int(context.get("turn_calls", 0))
                if used >= limit:
                    hits.append(
                        _hit(
                            policy,
                            None,
                            f"超出编排限额：单轮调用已达 {limit} 次上限",
                            kind="limit",
                        )
                    )
            elif scope == "session":
                used = int(context.get("session_calls", 0))
                if used >= limit:
                    hits.append(
                        _hit(
                            policy,
                            None,
                            f"超出编排限额：会话累计调用已达 {limit} 次上限",
                            kind="limit",
                        )
                    )

    hits.sort(key=lambda h: _BOUNDARY_ORDER.get(h["boundary"], 3))
    certain = [h for h in hits if h["confidence"] == "certain"]
    return {"hit": bool(hits), "rules": hits, "certain": bool(certain)}