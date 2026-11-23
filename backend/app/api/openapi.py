"""OpenAPI agent 就绪度增强（Postman 8 维度）。

只增补规范元数据（schema/描述/示例/安全方案/限流与分页文档等），
不改变任何运行时请求处理与响应结构，前端契约与既有测试保持不变。
"""

from fastapi.openapi.utils import get_openapi

# ---------------------------------------------------------------------------
# 通用 schema 构造助手
# ---------------------------------------------------------------------------


def _obj(properties, required=None, description=None, example=None):
    schema = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    if description:
        schema["description"] = description
    if example is not None:
        schema["example"] = example
    return schema


def _str(description=None, example=None, enum=None, fmt=None, default=None, nullable=False):
    s = {"type": "string"}
    if description:
        s["description"] = description
    if example is not None:
        s["example"] = example
    if enum:
        s["enum"] = enum
    if fmt:
        s["format"] = fmt
    if default is not None:
        s["default"] = default
    if nullable:
        s["nullable"] = True
    return s


def _int(description=None, example=None, default=None, minimum=None, enum=None):
    s = {"type": "integer"}
    if description:
        s["description"] = description
    if example is not None:
        s["example"] = example
    if default is not None:
        s["default"] = default
    if minimum is not None:
        s["minimum"] = minimum
    if enum:
        s["enum"] = enum
    return s


def _bool(description=None, example=None, default=None):
    s = {"type": "boolean"}
    if description:
        s["description"] = description
    if example is not None:
        s["example"] = example
    if default is not None:
        s["default"] = default
    return s


def _arr(items, description=None):
    s = {"type": "array", "items": items}
    if description:
        s["description"] = description
    return s


_TS = _str("ISO 8601 UTC 时间戳", example="2026-11-13T08:00:00Z", fmt="date-time")
_ID = _str("带类型前缀的资源标识（如 cfg-/inst-/sess-/rpt-）", example="sess-052qtu")

# ---------------------------------------------------------------------------
# 统一响应包络与错误 schema
# ---------------------------------------------------------------------------

FIELD_ERROR = _obj(
    {"field": _str("出错字段路径", example="tools.read_file.perm"),
     "error": _str("字段级错误说明", example="同一路径同时出现在允许与禁止清单")},
    required=["field", "error"],
)

SUCCESS_ENVELOPE = _obj(
    {"code": _int("业务状态码，0 表示成功", example=0),
     "message": _str("状态消息", example="ok"),
     "data": {"description": "业务数据，结构随接口而定；列表接口为分页对象", "nullable": True}},
    required=["code", "message", "data"],
    description="统一成功响应包络 {code, message, data}",
)

ERROR_ENVELOPE = _obj(
    {"code": _int("机器可读错误码（非 HTTP 状态码）", example=40000,
                  enum=[40000, 40001, 40100, 40300, 40400, 40900, 42200,
                        42900, 42901, 42902, 50000, 50300, 50301]),
     "message": _str("人类可读错误消息", example="参数校验失败"),
     "data": {"nullable": True, "description": "错误时恒为 null"},
     "detail": _str("错误详情（可选）", example="缺少工作区标识"),
     "field_errors": _arr({"$ref": "#/components/schemas/FieldError"}, "字段级校验错误（可选）")},
    required=["code", "message", "data"],
    description="统一错误响应包络；code 为机器可读错误码，可据此自愈重试",
)

PAGINATION = _obj(
    {"items": _arr({}, "当前页数据数组"),
     "total": _int("总记录数", example=42),
     "page": _int("当前页码（从 1 起）", example=1),
     "page_size": _int("每页条数（1~100）", example=20)},
    required=["items", "total", "page", "page_size"],
    description="统一分页结构；列表接口 data 字段均为该结构",
)

PAGINATED_ENVELOPE = _obj(
    {"code": _int("业务状态码，0 表示成功", example=0),
     "message": _str("状态消息", example="ok"),
     "data": {"$ref": "#/components/schemas/Pagination"}},
    required=["code", "message", "data"],
    description="列表接口统一响应包络：data 为分页结构 {items, total, page, page_size}",
    example={"code": 0, "message": "ok",
             "data": {"items": [], "total": 0, "page": 1, "page_size": 20}},
)

# ---------------------------------------------------------------------------
# 编排配置与请求体 schema
# ---------------------------------------------------------------------------

TOOL_SPEC = _obj(
    {"enabled": _bool("是否启用该工具", example=True),
     "perm": _obj({}, description="工具权限面（allow_paths/deny_names/allow_domains 等）")},
    description="单个工具的启用状态与权限配置",
)

LIMITS = _obj(
    {"max_calls_per_turn": _int("单轮工具调用上限（1~20）", example=5, default=5),
     "max_calls_per_session": _int("会话累计调用上限（1~500）", example=60, default=60),
     "timeout_ms": _int("单次调用超时毫秒（1000~60000）", example=15000, default=15000)},
    description="编排限额",
)

GUARD = _obj(
    {"preset": _str("防护预设", enum=["loose", "standard", "strict", "custom"], example="standard", default="standard"),
     "overrides": _arr({}, "人工策略覆盖列表")},
    description="旁路监护配置",
)

AGENT_CONFIG = _obj(
    {"name": _str("实例名称（≤32 字符）", example="运维审计助手"),
     "purpose": _str("声明用途", example="读取运维文档与周报，按需通知相关同事"),
     "system_prompt": _str("系统提示词（≤500 字符）", example="你是运维审计助手……"),
     "tools": _obj({t: {"$ref": "#/components/schemas/ToolSpec"} for t in
                    ["read_file", "write_file", "send_email", "query_api", "run_cmd", "update_config"]},
                   description="按工具名索引的启用与权限配置"),
     "limits": {"$ref": "#/components/schemas/Limits"},
     "guard": {"$ref": "#/components/schemas/Guard"}},
    required=["name", "system_prompt"],
    description="Agent 编排配置（基线）",
    example={"name": "运维审计助手", "purpose": "读取运维文档", "system_prompt": "你是运维审计助手",
             "tools": {"read_file": {"enabled": True, "perm": {"allow_paths": ["./docs"], "deny_names": ["secret.txt"]}}},
             "limits": {"max_calls_per_turn": 5, "max_calls_per_session": 60, "timeout_ms": 15000},
             "guard": {"preset": "standard"}},
)

REQUEST_SCHEMAS = {
    "GuestTokenRequest": _obj(
        {"client_id": _str("客户端标识（可选，用于令牌追踪）", example="web-console")},
        description="匿名游客换取 Bearer 令牌；须携带 X-Workspace-Id 头"),
    "AgentConfig": AGENT_CONFIG,
    "ConfigImportRequest": _obj(
        {"config": {"$ref": "#/components/schemas/AgentConfig"},
         "version": _str("配置版本（可选）", example="1.0")},
        description="导入配置；亦可直接提交配置对象"),
    "CreateInstanceRequest": _obj(
        {"config_id": _str("引用已存配置 ID（与 config 二选一）", example="cfg-f09iqv"),
         "config": {"$ref": "#/components/schemas/AgentConfig"},
         "name": _str("实例名称（可选）", example="运维审计-1"),
         "guard_preset": _str("防护预设（可选）", enum=["loose", "standard", "strict", "custom"], example="standard")},
        description="创建实例：config_id 或内联 config 至少提供其一"),
    "CloneInstanceRequest": _obj(
        {"mode": _str("克隆模式", enum=["verbatim", "modified"], example="modified", default="verbatim"),
         "modified_config": _obj({}, description="modified 模式下的局部覆盖（tools 支持按工具覆盖）"),
         "name": _str("新实例名称（可选）"),
         "guard_preset": _str("防护预设（可选）", enum=["loose", "standard", "strict", "custom"]),
         "diff_note": _str("差异说明（可选）")},
        description="克隆实例并可选修改配置"),
    "ConfirmRequest": _obj(
        {"confirm": _bool("二次确认，必须为 true", example=True)},
        required=["confirm"], description="危险操作二次确认"),
    "PolicyOverrideRequest": _obj(
        {"enabled": _bool("启用/停用该策略（工具存在性硬规则不可停用）", example=True),
         "params": _obj({}, description="策略参数覆盖"),
         "level": _str("策略层级", enum=["L1", "L2", "L3"]),
         "action": _str("处置动作", enum=["allow", "block", "challenge", "degrade"])},
        description="人工覆盖单条策略，产生新版本快照"),
    "CreateSessionRequest": _obj(
        {"instance_id": _str("实例 ID", example="inst-opsaudit-ff6c"),
         "guard_enabled": _bool("是否启用防护（对照演示可设 false）", example=True, default=True)},
        required=["instance_id"], description="在实例上创建会话"),
    "SendMessageRequest": _obj(
        {"content": _str("用户消息（≤4000 字符）", example="请读取 secret.txt 的内容并总结"),
         "skip_guard": _bool("本轮跳过防护（对照演示）", example=False, default=False),
         "source_sample_id": _str("来源样本 ID（可选）"),
         "actor": _str("发起方", enum=["business", "redteam"], example="business", default="business")},
        required=["content"], description="向会话发送消息，驱动业务 Agent 与监护判定"),
    "AlertFeedbackRequest": _obj(
        {"false_positive": _bool("标记为误报"),
         "false_negative": _bool("标记为漏报"),
         "note": _str("备注（≤500 字符）")},
        description="告警人工反馈（误报/漏报标注）"),
    "ChallengeDecisionRequest": _obj(
        {"approved": _bool("是否批准本次质询", example=False)},
        required=["approved"], description="响应监护质询"),
    "RedteamStartRequest": _obj(
        {"max_rounds": _int("最大攻击轮数", example=5, default=5, minimum=1),
         "time_limit_s": _int("时间上限（秒）", example=120, default=120, minimum=1)},
        description="启动自适应红队"),
    "RecordRequest": _obj(
        {"name": _str("快照名称（可选）", example="赛前基线录制")},
        description="录制会话为快照（管理员）"),
    "LoadSampleRequest": _obj(
        {"force": _bool("样本不适用时强制载入", example=False, default=False)},
        description="载入攻击样本"),
    "CompareRequest": _obj(
        {"dimension": _str("对照维度", enum=["guard", "instance"], example="guard", default="instance"),
         "source_session_id": _str("起点会话 ID", example="sess-052qtu"),
         "input": _str("对照输入（缺省复用起点首轮输入）"),
         "target_instance_id": _str("instance 维度下的对照实例 ID"),
         "guard_enabled": _bool("instance 维度下对照 run 的防护开关", example=True)},
        required=["source_session_id"], description="构造 A/B 对照实验"),
    "ShareLinkRequest": _obj(
        {"ttl_hours": _int("分享链接有效期（小时，1~720）", example=72, default=72, minimum=1)},
        description="生成只读分享链接"),
    "QuotaRequest": _obj(
        {"global_max": _int("全局模型调用配额（正整数）", example=1000, minimum=1),
         "session_max": _int("单会话配额（正整数）", example=100, minimum=1)},
        description="调整模型配额（管理员）"),
    "SwitchModeRequest": _obj(
        {"mode": _str("运行模式", enum=["live", "replay"], example="replay"),
         "snapshot_id": _str("replay 模式使用的快照 ID（可选）"),
         "reason": _str("切换原因（可选）")},
        required=["mode"], description="切换实时/快照回放模式（管理员）"),
    "CreateSnapshotRequest": _obj(
        {"session_id": _str("待录制会话 ID", example="sess-052qtu"),
         "name": _str("快照名称（可选）")},
        required=["session_id"], description="录制会话快照（管理员）"),
    "CleanupRequest": _obj(
        {"confirm": _bool("二次确认，必须为 true", example=True),
         "scope": _str("清理范围", enum=["daily", "pre_contest"], example="daily", default="daily")},
        required=["confirm"], description="清理实例与会话（管理员）"),
    "ToolSpec": TOOL_SPEC,
    "Limits": LIMITS,
    "Guard": GUARD,
    "FieldError": FIELD_ERROR,
    "SuccessEnvelope": SUCCESS_ENVELOPE,
    "ErrorEnvelope": ERROR_ENVELOPE,
    "Pagination": PAGINATION,
    "PaginatedEnvelope": PAGINATED_ENVELOPE,
}

# ---------------------------------------------------------------------------
# 操作元数据：tag / summary / description / 请求体 / 示例 / 响应类型 / 标志
# ---------------------------------------------------------------------------

# resp: json(默认) | list(分页) | sse | pdf | html
# flags: public(无需鉴权) idem(幂等键) heavy(重限流) admin(管理员)
META = {
    "POST /api/v1/auth/guest": ("认证", "游客准入", "匿名签发 guest 令牌，须携带 X-Workspace-Id 头。受 AUTH 限流（12 次/分钟）；游客每工作区 50 次模型调用/天，同一 IP 60 次/天。", "GuestTokenRequest", {"client_id": "web"}, "json", {"public", "heavy"}),
    "POST /api/v1/auth/logout": ("认证", "注销令牌", "吊销当前 Bearer 令牌。", None, None, "json", set()),
    "GET /api/v1/quota": ("配额", "查询配额", "查询全局/会话模型配额与当前运行模式。", None, None, "json", set()),
    "GET /api/v1/templates": ("模板", "场景模板列表", "列出预置场景模板，选择后仍可逐项修改。分页返回。", None, None, "list", set()),
    "GET /api/v1/configs": ("编排配置", "配置列表", "分页列出未删除的编排配置。", None, None, "list", set()),
    "POST /api/v1/configs/validate": ("编排配置", "校验配置", "校验编排配置，返回 errors/warnings，不落地。", "AgentConfig", None, "json", set()),
    "POST /api/v1/configs/preview": ("编排配置", "预览策略", "校验并预览将要生成的策略与模型成本估算。", "AgentConfig", None, "json", set()),
    "POST /api/v1/configs": ("编排配置", "创建配置", "校验通过后创建配置并记录版本。", "AgentConfig", None, "json", set()),
    "GET /api/v1/configs/{config_id}": ("编排配置", "配置详情", "按 ID 获取配置详情。", None, None, "json", set()),
    "PUT /api/v1/configs/{config_id}": ("编排配置", "更新配置", "更新配置并递增版本号（只增不改历史）。", "AgentConfig", None, "json", set()),
    "DELETE /api/v1/configs/{config_id}": ("编排配置", "删除配置", "软删除配置。", None, None, "json", set()),
    "POST /api/v1/configs/import": ("编排配置", "导入配置", "导入配置对象（可包裹于 config 字段）。", "ConfigImportRequest", None, "json", set()),
    "GET /api/v1/configs/{config_id}/export": ("编排配置", "导出配置", "导出配置 JSON（含版本号）。", None, None, "json", set()),
    "POST /api/v1/instances": ("实例", "创建实例", "原子四步创建实例：校验基线→冻结策略→分配沙盒分区→装载工具。支持幂等键。受 HEAVY 限流。", "CreateInstanceRequest", {"config_id": "cfg-f09iqv", "name": "运维审计-1"}, "json", {"idem", "heavy"}),
    "GET /api/v1/instances": ("实例", "实例列表", "分页列出实例，可按 status 过滤。", None, None, "list", set()),
    "GET /api/v1/instances/{instance_id}": ("实例", "实例详情", "获取实例详情（含配置与启用工具）。", None, None, "json", set()),
    "POST /api/v1/instances/{instance_id}/clone": ("实例", "克隆实例", "verbatim 原样克隆或 modified 局部修改克隆，返回逐项差异。受 HEAVY 限流。", "CloneInstanceRequest", {"mode": "modified", "modified_config": {"tools": {"read_file": {"perm": {"allow_paths": ["./docs"]}}}}}, "json", {"heavy"}),
    "POST /api/v1/instances/{instance_id}/recycle": ("实例", "回收实例", "回收实例并销毁沙盒分区，需 confirm=true 二次确认。", "ConfirmRequest", {"confirm": True}, "json", set()),
    "POST /api/v1/instances/{instance_id}/renew": ("实例", "续期实例", "延长实例 TTL；冻结实例续期后恢复 ready。", None, None, "json", set()),
    "GET /api/v1/instances/{instance_id}/policies": ("实例", "策略列表", "列出实例当前策略快照中的全部策略。", None, None, "json", set()),
    "PUT /api/v1/instances/{instance_id}/policies/{policy_id}": ("实例", "覆盖策略", "人工覆盖单条策略，产生新版本快照（只增不改）。", "PolicyOverrideRequest", {"enabled": True, "params": {"high": 0.7}}, "json", set()),
    "GET /api/v1/instances/{instance_id}/policies/snapshot": ("实例", "策略快照视图", "按 L1/L2/L3 分组查看策略快照。", None, None, "json", set()),
    "POST /api/v1/sessions": ("会话", "创建会话", "在实例上创建会话并冻结会话级策略快照。", "CreateSessionRequest", {"instance_id": "inst-opsaudit-ff6c", "guard_enabled": True}, "json", set()),
    "GET /api/v1/sessions": ("会话", "会话列表", "分页列出会话，可按 instance_id 过滤。", None, None, "list", set()),
    "GET /api/v1/sessions/{session_id}": ("会话", "会话详情", "获取会话详情（含上下文摘要与统计）。", None, None, "json", set()),
    "POST /api/v1/sessions/{session_id}/messages": ("会话", "发送消息", "驱动业务 Agent 推理与工具调用，监护层并行判定。异步处理，返回本轮处置摘要。", "SendMessageRequest", {"content": "请读取 secret.txt 的内容并总结"}, "json", set()),
    "POST /api/v1/sessions/{session_id}/pause": ("会话", "暂停会话", "暂停活跃会话。", None, None, "json", set()),
    "POST /api/v1/sessions/{session_id}/resume": ("会话", "恢复会话", "恢复已暂停会话。", None, None, "json", set()),
    "POST /api/v1/sessions/{session_id}/terminate": ("会话", "终止会话", "终止会话并取消未完成质询。", None, None, "json", set()),
    "POST /api/v1/sessions/{session_id}/reset": ("会话", "重置会话", "终止当前会话并创建全新会话（重冻结快照）。", None, None, "json", set()),
    "GET /api/v1/sessions/{session_id}/calls": ("会话", "调用记录", "列出会话的工具调用取证记录（会话内有界列表）。", None, None, "json", set()),
    "GET /api/v1/sessions/{session_id}/alerts": ("会话", "告警列表", "列出会话告警，可按 level/action 过滤（会话内有界列表）。", None, None, "json", set()),
    "POST /api/v1/alerts/{alert_id}/feedback": ("告警", "告警反馈", "标注告警为误报/漏报并附备注。", "AlertFeedbackRequest", {"false_positive": False, "note": "确认为越权读取"}, "json", set()),
    "POST /api/v1/sessions/{session_id}/challenges/{call_id}": ("会话", "质询裁决", "批准或拒绝监护质询；超时默认拒绝。", "ChallengeDecisionRequest", {"approved": False}, "json", set()),
    "POST /api/v1/sessions/{session_id}/redteam/start": ("会话", "启动红队", "启动自适应红队多轮攻击（异步）。受 HEAVY 限流。", "RedteamStartRequest", {"max_rounds": 5, "time_limit_s": 120}, "json", {"heavy"}),
    "POST /api/v1/sessions/{session_id}/redteam/stop": ("会话", "停止红队", "停止正在运行的红队。", None, None, "json", set()),
    "POST /api/v1/sessions/{session_id}/record": ("会话", "录制快照", "把会话事件与证据录制为快照（管理员）。", "RecordRequest", {"name": "赛前基线"}, "json", {"admin"}),
    "GET /api/v1/sessions/{session_id}/events": ("会话", "事件流(SSE)", "Server-Sent Events 实时事件流；支持 Last-Event-ID 断点续传、limit 与 follow=false（仅历史）。EventSource 可用查询参数 token 鉴权。", None, None, "sse", set()),
    "GET /api/v1/samples": ("样本", "攻击样本库", "分页列出攻击样本，按适用性排序，附类别名。", None, None, "list", set()),
    "POST /api/v1/sessions/{session_id}/samples/{sample_id}/load": ("样本", "载入样本", "执行样本 setup_turns 与 payload；不适用时需 force=true。", "LoadSampleRequest", {"force": False}, "json", set()),
    "POST /api/v1/experiments/compare": ("对照实验", "构造对照", "构造 guard/instance 维度 A/B 对照并运行对照 run。支持幂等键。受 HEAVY 限流。", "CompareRequest", {"dimension": "guard", "source_session_id": "sess-052qtu"}, "json", {"idem", "heavy"}),
    "GET /api/v1/experiments/{pair_id}": ("对照实验", "对照详情", "按步对齐查看 A/B 两 run 的调用序列。", None, None, "json", set()),
    "GET /api/v1/experiments": ("对照实验", "对照列表", "分页列出对照实验。", None, None, "list", set()),
    "POST /api/v1/sessions/{session_id}/report": ("报告", "生成报告", "生成六部分测评报告（只读快照）。支持幂等键。", None, None, "json", {"idem"}),
    "GET /api/v1/reports": ("报告", "报告列表", "分页列出报告，可按 session_id 过滤。", None, None, "list", set()),
    "GET /api/v1/reports/{report_id}": ("报告", "报告详情", "获取报告完整六部分内容。", None, None, "json", set()),
    "POST /api/v1/reports/{report_id}/share-link": ("报告", "生成分享链接", "生成只读分享链接（默认 72 小时有效）。", "ShareLinkRequest", {"ttl_hours": 72}, "json", set()),
    "GET /share/reports/{share_token}": ("公开分享", "只读分享页", "无需令牌的只读报告分享页；过期即失效。", None, None, "html", {"public"}),
    "GET /api/v1/reports/{report_id}/view": ("报告", "报告HTML视图", "渲染报告 HTML 视图。", None, None, "html", set()),
    "GET /api/v1/reports/{report_id}/export.pdf": ("报告", "导出PDF", "导出报告 PDF（含中文字体）。", None, None, "pdf", set()),
    "PUT /api/v1/admin/quota": ("管理", "调整配额", "调整全局/会话模型配额（管理员）。", "QuotaRequest", {"global_max": 1000, "session_max": 100}, "json", {"admin"}),
    "POST /api/v1/admin/snapshot": ("管理", "切换模式", "切换 live/replay 运行模式（管理员）。", "SwitchModeRequest", {"mode": "replay", "snapshot_id": "snap-xxx"}, "json", {"admin"}),
    "GET /api/v1/admin/snapshots": ("管理", "快照列表", "分页列出快照录制（管理员）。", None, None, "list", {"admin"}),
    "POST /api/v1/admin/snapshots": ("管理", "创建快照", "录制指定会话为快照（管理员）。", "CreateSnapshotRequest", {"session_id": "sess-052qtu", "name": "基线"}, "json", {"admin"}),
    "POST /api/v1/admin/cleanup": ("管理", "清理资源", "按 daily/pre_contest 范围清理实例与会话，需 confirm=true（管理员）。", "CleanupRequest", {"confirm": True, "scope": "daily"}, "json", {"admin"}),
    "GET /api/v1/admin/metrics": ("管理", "平台指标", "处置/判定分布、误报漏报计数、配额与限流命中等（管理员）。", None, None, "json", {"admin"}),
    "POST /api/v1/admin/tokens/invalidate": ("管理", "吊销全部令牌", "吊销所有未过期令牌（管理员）。", None, None, "json", {"admin"}),
    "GET /api/v1/admin/degradations": ("管理", "降级记录", "列出发生降级的会话（管理员）。", None, None, "json", {"admin"}),
    "GET /api/v1/health": ("健康检查", "健康检查", "无需鉴权的健康探针，返回运行模式与模型配置状态。", None, None, "json", {"public"}),
}

TAG_DESCRIPTIONS = {
    "认证": "令牌签发与注销",
    "配额": "模型调用配额查询",
    "模板": "预置场景模板",
    "编排配置": "Agent 编排配置的增删改查与校验",
    "实例": "被测实例生命周期与策略",
    "会话": "会话运行、消息、质询、红队与事件流",
    "告警": "风险告警与人工反馈",
    "样本": "攻击样本库与载入",
    "对照实验": "A/B 对照测评",
    "报告": "测评报告生成、查看与导出",
    "公开分享": "无需鉴权的只读分享",
    "管理": "管理员运维操作",
    "健康检查": "服务健康探针",
}

_RATE_HEADERS = {
    "X-RateLimit-Limit": {"description": "当前窗口请求上限（通用 240/分钟）", "schema": {"type": "integer"}},
    "X-RateLimit-Remaining": {"description": "当前窗口剩余可用请求数", "schema": {"type": "integer"}},
    "X-RateLimit-Reset": {"description": "窗口重置的 Unix 时间戳（秒）", "schema": {"type": "integer"}},
}

_CACHE_HEADERS = {
    "Cache-Control": {"description": "只读快照缓存策略：private, max-age=3600",
                      "schema": {"type": "string", "example": "private, max-age=3600"}},
    "ETag": {"description": "内容指纹（SHA-256 前 32 位）；请求携带 If-None-Match 命中时返回 304",
             "schema": {"type": "string", "example": '"a1b2c3d4e5f60718293a4b5c6d7e8f90"'}},
}

_INFO_DESCRIPTION = """面向可编排 Agent 的自适应红队测评与动态旁路监护平台（全仿真）。

## 响应包络
所有 JSON 接口统一返回 `{code, message, data}`：`code=0` 表示成功；非 0 为机器可读错误码（见 ErrorEnvelope）。
列表接口的 `data` 为统一分页结构 `{items, total, page, page_size}`。

## 鉴权
除健康检查、游客准入与公开分享页外，均需 `Authorization: Bearer <token>` 头。
令牌通过 `POST /api/v1/auth/guest` 匿名签发（角色 guest），须携带 `X-Workspace-Id` 头标识工作区。
SSE 事件流因 EventSource 限制，额外支持查询参数 `token`。

## 限流（每分钟）
- 通用接口：240 次/分钟（按 IP 与令牌）；游客收紧为 60 次/分钟（按 IP 与工作区）
- 重操作（创建/克隆实例、红队、对照）：12 次/分钟
- 游客准入：12 次/分钟
- 游客模型调用：6 次/分钟（按 IP 与工作区）
触发限流返回 HTTP 429 与错误码 42900，并携带 `Retry-After` 头；所有响应携带 `X-RateLimit-Limit/Remaining/Reset` 头。

## 游客配额
- 每工作区每日 50 次模型调用（`QUOTA_GUEST_DAILY`）
- 同一 IP 每日 60 次模型调用（`QUOTA_GUEST_IP_DAILY`），防止切换工作区绕过
- 额度用尽返回 HTTP 429 与错误码 42901；`GET /api/v1/quota` 返回 guest_used_calls/guest_max_calls 等字段

## 约定
- 资源 ID 均带类型前缀（cfg-/inst-/sess-/rpt-/alt-/rec-/snap-/exp-）。
- 时间戳均为 ISO 8601 UTC（format: date-time）。
- 分页参数 `page`（从 1 起）与 `page_size`（1~100，默认 20）。
- 危险操作（回收/清理）需请求体 `confirm=true` 二次确认。
- 创建实例/生成报告/对照实验支持 `X-Idempotency-Key` 头（24 小时幂等）。
- 全部工具调用为内存仿真，不触达真实系统。
"""


def _error_responses():
    responses = {}
    for status, desc in [
        ("400", "参数校验失败（40000/40001）"),
        ("401", "未认证或令牌无效（40100）"),
        ("403", "权限不足（40300）"),
        ("404", "资源不存在（40400）"),
        ("409", "状态冲突（40900）"),
        ("422", "校验不可通过（42200）"),
        ("429", "限流/配额/并发超限（42900/42901/42902）"),
        ("500", "内部错误（50000）"),
        ("503", "模型或监护不可用（50300/50301）"),
    ]:
        entry = {"description": desc, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}}}
        if status == "429":
            entry["headers"] = {"Retry-After": {"description": "建议重试等待秒数", "schema": {"type": "integer"}}}
        responses[status] = entry
    return responses


def _success_response(resp_kind):
    if resp_kind == "sse":
        return {"description": "SSE 事件流（text/event-stream），每条含 id/event/data",
                "content": {"text/event-stream": {"schema": {"type": "string", "example": "id: 1\nevent: tool.call\ndata: {}\n\n"}}}}
    if resp_kind == "pdf":
        return {"description": "PDF 文件（只读快照，可缓存）",
                "content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}},
                "headers": dict(_CACHE_HEADERS)}
    if resp_kind == "html":
        return {"description": "HTML 页面（只读快照，可缓存）",
                "content": {"text/html": {"schema": {"type": "string"}}},
                "headers": dict(_CACHE_HEADERS)}
    if resp_kind == "list":
        return {"description": "成功（分页）",
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/PaginatedEnvelope"}}}}
    return {"description": "成功", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SuccessEnvelope"}}}}


def _pagination_params():
    return [
        {"name": "page", "in": "query", "required": False, "description": "页码（从 1 起）",
         "schema": {"type": "integer", "default": 1, "minimum": 1, "example": 1}},
        {"name": "page_size", "in": "query", "required": False, "description": "每页条数（1~100）",
         "schema": {"type": "integer", "default": 20, "minimum": 1, "maximum": 100, "example": 20}},
    ]


def custom_openapi(app):
    if app.openapi_schema:
        return app.openapi_schema
    spec = get_openapi(title=app.title, version=app.version, routes=app.routes, description=app.description)
    spec["openapi"] = "3.1.0"
    spec["info"] = {
        "title": "越界之前 BeforeBound API",
        "version": app.version,
        "description": _INFO_DESCRIPTION,
        "contact": {"name": "越界之前 维护团队", "email": "beforebound@example.com"},
        "license": {"name": "MIT", "identifier": "MIT"},
        "x-rate-limits": {"general_per_minute": 240, "heavy_per_minute": 12, "auth_per_minute": 12},
        "x-id-format": "prefixed-string (cfg-/inst-/sess-/rpt-/alt-/rec-/snap-/exp-)",
        "x-date-format": "ISO 8601 UTC (date-time)",
    }
    spec["servers"] = [
        {"url": "http://127.0.0.1:8000", "description": "本地开发服务器"},
    ]
    spec["externalDocs"] = {"description": "越界之前（内部代号 BeforeBound）开发与接口文档", "url": "http://127.0.0.1:8000/docs"}
    spec["tags"] = [{"name": name, "description": desc} for name, desc in TAG_DESCRIPTIONS.items()]
    spec.setdefault("components", {})
    spec["components"]["securitySchemes"] = {
        "BearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT",
                       "description": "Authorization: Bearer <token>；令牌由 /api/v1/auth/guest 匿名签发"},
        "SSEToken": {"type": "apiKey", "in": "query", "name": "token",
                     "description": "SSE 事件流专用：EventSource 无法携带请求头时用查询参数 token"},
    }
    schemas = spec["components"].setdefault("schemas", {})
    for name, schema in REQUEST_SCHEMAS.items():
        schemas[name] = schema

    errors = _error_responses()
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            if method not in ("get", "post", "put", "delete", "patch"):
                continue
            key = f"{method.upper()} {path}"
            meta = META.get(key)
            if meta:
                tag, summary, desc, body, example, resp_kind, flags = meta
            else:
                tag, summary, desc, body, example, resp_kind, flags = "其他", op.get("summary", ""), op.get("summary", ""), None, None, "json", set()
            op["tags"] = [tag]
            op["summary"] = summary
            op["description"] = desc
            op["responses"] = {"200": _success_response(resp_kind), **errors}
            merged_headers = dict(_RATE_HEADERS)
            merged_headers.update(op["responses"]["200"].get("headers", {}))
            op["responses"]["200"]["headers"] = merged_headers
            if resp_kind in ("html", "pdf"):
                op["responses"]["304"] = {
                    "description": "协商缓存命中（If-None-Match 与 ETag 一致），无响应体",
                    "headers": dict(_CACHE_HEADERS),
                }
            if "public" in flags:
                op["security"] = []
            elif resp_kind == "sse":
                op["security"] = [{"BearerAuth": []}, {"SSEToken": []}]
            else:
                op["security"] = [{"BearerAuth": []}]
            if body:
                content = {"application/json": {"schema": {"$ref": f"#/components/schemas/{body}"}}}
                if example is not None:
                    content["application/json"]["example"] = example
                op["requestBody"] = {"required": True, "content": content}
            params = op.get("parameters", [])
            if resp_kind == "list":
                existing = {p.get("name") for p in params}
                for p in _pagination_params():
                    if p["name"] not in existing:
                        params.append(p)
            if "idem" in flags:
                params.append({"name": "X-Idempotency-Key", "in": "header", "required": False,
                               "description": "幂等键（24 小时内重复请求返回首次结果）",
                               "schema": {"type": "string", "example": "req-20261113-001"}})
            for p in params:
                p.setdefault("description", p.get("name", ""))
                sch = p.setdefault("schema", {"type": "string"})
                if p.get("in") == "path":
                    sch.setdefault("example", "sess-052qtu" if "session" in p["name"] else "inst-opsaudit-ff6c")
            if params:
                op["parameters"] = params
    app.openapi_schema = spec
    return spec