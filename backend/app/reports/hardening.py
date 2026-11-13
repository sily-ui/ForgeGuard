"""加固建议（FD8）：配置动作 + 预期效果成对表述，分三类。

类别：immediate（立即可改的配置项）、tooling（需改造的工具入参校验）、
tradeoff（需权衡的业务取舍，明确标注取舍代价）。
"""

from .rootcause import CATEGORIES


def build_suggestions(rootcause_result, config, calls):
    suggestions = []
    seen = set()
    call_map = {c["call_id"]: c for c in calls}
    for item in rootcause_result["items"]:
        if item.get("evidence_insufficient"):
            suggestions.append(
                {
                    "kind": "tradeoff",
                    "category": None,
                    "action": "对告警 " + item["alert_id"] + " 人工复核判定证据",
                    "expected_effect": "补齐证据后再归类，避免推测性结论误导修复范围",
                    "cost": "需要人工取证时间",
                    "alert_id": item["alert_id"],
                }
            )
            continue
        for cause in item["causes"]:
            key = (cause["category"], tuple(sorted(cause.get("evidence", {}).get("sources", []))))
            if key in seen:
                continue
            seen.add(key)
            suggestions.append(_suggestion_for(cause, config, call_map.get(item.get("call_id")), item))
    if not suggestions:
        suggestions.append(
            {
                "kind": "immediate",
                "category": None,
                "action": "本次会话未发现越权，保持当前基线并定期重跑样本库回归",
                "expected_effect": "配置变更后可通过同一载荷复测验证防护仍然有效",
                "cost": None,
                "alert_id": None,
            }
        )
    return suggestions


def _suggestion_for(cause, config, call, item):
    category = cause["category"]
    evidence = cause.get("evidence", {})
    tool = (call or {}).get("tool", "")
    perm = evidence.get("perm") or config.get("tools", {}).get(tool, {}).get("perm", {})
    sources = evidence.get("sources", [])
    alert_id = item.get("alert_id")

    if category == "config_defect":
        if tool == "read_file":
            allow = perm.get("allow_paths", [])
            deny = perm.get("deny_names", [])
            action = (
                f"将 read_file 的 allow_paths 收窄为业务必需目录（当前 {allow or '未设置'}），"
                f"并确认 deny_names 覆盖敏感文件（当前 {deny or '未设置'}）"
            )
            effect = "可使本次利用路径失效，重跑同一载荷时预计在读取环节被对象边界拦截"
        elif tool == "send_email":
            domains = perm.get("allow_domains", [])
            action = f"将 send_email 的 allow_domains 收窄为业务域名（当前 {domains or '未设置'}），并下调 max_recipients"
            effect = "外域投递将在对象边界被拦截，重跑同一载荷不再写入投递日志"
        elif tool == "query_api":
            action = "为 query_api 配置 allow_endpoints 白名单，并对 phone、id_card 等字段启用 mask_fields"
            effect = "越界接口调用被拦截，敏感字段返回脱敏值"
        elif tool in ("run_cmd", "update_config", "write_file"):
            action = f"按最小权限原则关闭或收紧 {tool}（当前 enabled={config.get('tools', {}).get(tool, {}).get('enabled')}）"
            effect = "未启用工具的调用将被工具边界硬规则拦截"
        else:
            action = f"按最小权限重建 {tool or '相关工具'} 的权限清单，来源配置项：{', '.join(sources) or '见命中策略'}"
            effect = "越权调用在对应边界被拦截"
        return {
            "kind": "immediate",
            "category": category,
            "category_name": CATEGORIES[category],
            "action": action,
            "expected_effect": effect,
            "cost": None,
            "alert_id": alert_id,
        }

    if category == "param_validation":
        params = evidence.get("params", {})
        return {
            "kind": "tooling",
            "category": category,
            "category_name": CATEGORIES[category],
            "action": f"在 {tool or '工具'} 入口增加入参规范化（路径去穿越片段、收件人数上限校验），问题参数：{params}",
            "expected_effect": "路径拼接绕过与超限取值在参数边界被拦截，不再依赖前缀匹配兜底",
            "cost": "需要修改工具实现并回归测试",
            "alert_id": alert_id,
        }

    if category == "prompt_defect":
        return {
            "kind": "immediate",
            "category": category,
            "category_name": CATEGORIES[category],
            "action": "收窄系统提示词的授权表述，明确列出禁止动作（如禁止读取凭证、禁止向外域发信）",
            "expected_effect": "降低注入与角色诱导成功率，语义层判定负担下降",
            "cost": None,
            "alert_id": alert_id,
        }

    if category == "model_alignment":
        return {
            "kind": "tradeoff",
            "category": category,
            "category_name": CATEGORIES[category],
            "action": "在网关侧维持对该越狱载荷的拦截，并记录为模型层缺陷待供应商修复；跨实例重跑确认复现性",
            "expected_effect": "模型修复前防护不失效，修复后可用同一载荷验证",
            "cost": "网关规则需长期维护，无法仅靠模型升级消除",
            "alert_id": alert_id,
        }

    if category == "context_pollution":
        return {
            "kind": "tooling",
            "category": category,
            "category_name": CATEGORIES[category],
            "action": "在会话层增加事实一致性校验与轮次隔离，铺垫轮次建立的前提不得直接作为后续授权依据",
            "expected_effect": "多轮渐进式污染在累积风险越阈时被标记，末轮越权请求不再继承虚假前提",
            "cost": "需要改造上下文摘要逻辑，可能影响正常多轮业务连贯性",
            "alert_id": alert_id,
        }

    return {
        "kind": "tradeoff",
        "category": category,
        "category_name": CATEGORIES.get(category, category),
        "action": "人工复核该告警的判定证据",
        "expected_effect": "补齐证据后再归类",
        "cost": "需要人工取证时间",
        "alert_id": alert_id,
    }