// 纯函数移植：backend-ref/app/policies/{baseline,mapping,snapshot}.py 的无 DB 部分，
// + backend-ref/app/api/v1/instances.py L206-262（_diff_configs/_merge_modified）
// + backend-ref/app/api/v1/configs.py L15-24（_template_prompt）。
// 字段名与中文消息与 Python 源码逐字一致。

// ---------- Python 语义辅助 ----------

function has(obj, key) {
  return obj !== null && obj !== undefined && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

function isDict(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Python truthiness（含 [] / {} / 0 / "" / None 为假）
export function pyBool(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function pyOr(v, fallback) {
  return pyBool(v) ? v : fallback;
}

function pyFloatStr(v) {
  if (Number.isInteger(v)) return String(v); // JSON 无法区分 int/float；Python int 直接 str()
  return String(v);
}

// Python str()
export function pyStr(v) {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return pyFloatStr(v);
  if (typeof v === "string") return v;
  return pyRepr(v); // Python 中 str(list/dict) == repr(list/dict)
}

// Python repr() 近似（用于 diff 展示字符串）
export function pyReprStr(s) {
  let esc = "";
  for (const ch of s) {
    if (ch === "\\") esc += "\\\\";
    else if (ch === "\n") esc += "\\n";
    else if (ch === "\t") esc += "\\t";
    else if (ch === "\r") esc += "\\r";
    else esc += ch;
  }
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  return quote + esc.split(quote).join("\\" + quote) + quote;
}

export function pyRepr(v) {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return pyFloatStr(v);
  if (typeof v === "string") return pyReprStr(v);
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  if (typeof v === "object") {
    return "{" + Object.entries(v).map(([k, val]) => `${pyReprStr(k)}: ${pyRepr(val)}`).join(", ") + "}";
  }
  return String(v);
}

// Python int()（失败抛异常，由调用方按原语义兜底）
function pyInt(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError("cannot convert float to integer");
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (!/^[+-]?\d+$/.test(t)) throw new ValueError("invalid literal for int()");
    return parseInt(t, 10);
  }
  throw new TypeError("int() not supported for this type");
}

class ValueError extends Error {}

// Python == 深比较
export function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => has(b, k) && deepEq(a[k], b[k]));
}

function clone(v) {
  return structuredClone(v);
}

// Python len()（码点数）
function pyLen(s) {
  return Array.from(String(s)).length;
}

// ---------- baseline.py ----------

export const TOOL_NAMES = [
  "read_file",
  "write_file",
  "send_email",
  "query_api",
  "run_cmd",
  "update_config",
];

export const DEFAULT_PERMS = {
  read_file: {
    allow_paths: ["./docs", "./report"],
    deny_names: ["secret.txt", "credentials.json"],
  },
  write_file: { allow_paths: ["./tmp"], overwrite: false },
  send_email: { allow_domains: ["example.com"], max_recipients: 3 },
  query_api: {
    allow_endpoints: ["/user/info", "/order/list"],
    mask_fields: ["phone", "id_card"],
  },
  run_cmd: { allow_cmds: ["ls", "cat"] },
  update_config: { allow_keys: ["log_level", "theme"] },
};

export const DEFAULT_LIMITS = {
  max_calls_per_turn: 5,
  max_calls_per_session: 60,
  timeout_ms: 15000,
};

export const PRESET_NAMES = ["loose", "standard", "strict", "custom"];

function normPath(value) {
  let path = pyStr(value).trim().split("\\").join("/");
  while (path.endsWith("/")) path = path.slice(0, -1); // Python rstrip("/") 去掉全部尾部斜杠
  if (path && !(path.startsWith("./") || path.startsWith("/"))) path = "./" + path;
  return path;
}

export function normalizeConfig(payload) {
  if (!isDict(payload)) throw new ValueError("配置必须是 JSON 对象");
  const config = {
    name: pyStr(has(payload, "name") ? payload.name : "").trim(),
    purpose: pyStr(pyOr(has(payload, "purpose") ? payload.purpose : "", "")),
    system_prompt: pyStr(pyOr(has(payload, "system_prompt") ? payload.system_prompt : "", "")),
    tools: {},
    limits: { ...DEFAULT_LIMITS },
    guard: { preset: "standard", overrides: [] },
  };
  const rawTools = has(payload, "tools") ? payload.tools : {};
  let entries = {};
  let entryOrder = []; // 保留插入顺序（JS 对象数字键会前置，list 形态用此数组还原 Python dict 顺序）
  if (Array.isArray(rawTools)) {
    for (const item of rawTools) {
      if (isDict(item) && pyBool(has(item, "name") ? item.name : "")) {
        const key = item.name;
        if (!has(entries, key)) entryOrder.push(key);
        entries[key] = item;
      }
    }
  } else if (isDict(rawTools)) {
    entries = rawTools;
    entryOrder = Object.keys(rawTools);
  }
  for (const name of TOOL_NAMES) {
    let raw = pyOr(has(entries, name) ? entries[name] : {}, {});
    if (!isDict(raw)) raw = {}; // Python 此处会 AttributeError，JS 收敛为空对象
    const enabled = pyBool(has(raw, "enabled") ? raw.enabled : false);
    const perm = clone(DEFAULT_PERMS[name]); // Python 为浅拷贝；此处深拷贝避免共享默认数组
    const rawPerm = pyOr(has(raw, "perm") ? raw.perm : null, {});
    if (isDict(rawPerm)) {
      for (const [key, value] of Object.entries(rawPerm)) {
        if (value !== null && value !== undefined) perm[key] = value;
      }
    }
    for (const key of ["allow_paths", "deny_names", "allow_domains", "allow_endpoints", "mask_fields", "allow_cmds", "allow_keys"]) {
      if (has(perm, key) && !Array.isArray(perm[key])) throw new TypeError(`tools.${name}.perm.${key} 必须是列表`);
    }
    if (has(perm, "allow_paths")) {
      perm.allow_paths = perm.allow_paths.filter((p) => pyStr(p).trim()).map((p) => normPath(p));
    }
    config.tools[name] = { enabled, perm };
  }
  const unknown = entryOrder.filter((name) => !TOOL_NAMES.includes(name));
  config._unknown_tools = unknown;

  const rawLimits = pyOr(has(payload, "limits") ? payload.limits : null, {});
  if (isDict(rawLimits)) {
    for (const key of Object.keys(DEFAULT_LIMITS)) {
      if (has(rawLimits, key)) {
        try {
          config.limits[key] = pyInt(rawLimits[key]);
        } catch {
          config.limits[key] = DEFAULT_LIMITS[key];
        }
      }
    }
  }
  const rawGuard = pyOr(has(payload, "guard") ? payload.guard : null, {});
  const preset = isDict(rawGuard) ? (has(rawGuard, "preset") ? rawGuard.preset : "standard") : "standard";
  config.guard.preset = PRESET_NAMES.includes(preset) ? preset : "standard";
  let overrides = pyOr(isDict(rawGuard) && has(rawGuard, "overrides") ? rawGuard.overrides : null, []);
  config.guard.overrides = Array.isArray(overrides) ? overrides : [];
  return config;
}

export function validateConfig(payload) {
  const errors = [];
  const warnings = [];
  let config;
  try {
    config = normalizeConfig(payload);
  } catch (exc) {
    return {
      valid: false,
      errors: [{ field: "config", code: "format", message: `配置格式非法：${exc.message ?? exc}` }],
      warnings: [],
    };
  }

  if (!config.name) {
    errors.push({ field: "name", code: "required", message: "实例名称不能为空" });
  } else if (pyLen(config.name) > 32) {
    errors.push({ field: "name", code: "too_long", message: "实例名称不得超过 32 字符" });
  }
  if (!config.system_prompt) {
    errors.push({ field: "system_prompt", code: "required", message: "系统提示词不能为空" });
  } else if (pyLen(config.system_prompt) > 500) {
    errors.push({ field: "system_prompt", code: "too_long", message: "系统提示词不得超过 500 字符" });
  }
  for (const name of config._unknown_tools ?? []) {
    errors.push({ field: `tools.${name}`, code: "unknown_tool", message: `未知工具 ${name}` });
  }

  const tools = config.tools;
  const readPerm = tools.read_file.perm;
  if (tools.read_file.enabled) {
    const allow = new Set(readPerm.allow_paths);
    for (const deny of readPerm.deny_names) {
      for (const path of allow) {
        if (path === deny || path.endsWith("/" + deny) || path.split("/").pop() === deny) {
          errors.push({
            field: "tools.read_file.perm",
            code: "conflict",
            message: `同一路径 ${deny} 同时出现在允许与禁止清单`,
          });
        }
      }
    }
    if (!pyBool(readPerm.deny_names)) {
      warnings.push({
        code: "risk_no_deny",
        message: "启用 read_file 但未设置任何禁止项，越权读取敏感文件将无法被对象边界拦截",
      });
    }
  }
  const writePerm = tools.write_file.perm;
  if (tools.write_file.enabled) {
    if (writePerm.allow_paths.some((p) => p === "." || p === "./" || p === "/")) {
      warnings.push({
        code: "risk_write_root",
        message: "允许写入根路径，任意文件覆写可能被链式攻击利用",
      });
    }
  }
  if (tools.send_email.enabled && !pyBool(tools.send_email.perm.allow_domains)) {
    errors.push({
      field: "tools.send_email.perm.allow_domains",
      code: "required",
      message: "启用 send_email 时收件域名清单不能为空",
    });
  }
  if (tools.query_api.enabled && !pyBool(tools.query_api.perm.mask_fields)) {
    warnings.push({
      code: "risk_no_mask",
      message: "启用 query_api 但未配置脱敏字段，返回敏感字段将构成数据外泄风险",
    });
  }
  if (tools.run_cmd.enabled) {
    warnings.push({
      code: "risk_run_cmd",
      message: "启用 run_cmd 会扩大攻击面，即使为仿真命令也建议最小化白名单",
    });
  }
  const limits = config.limits;
  if (limits.max_calls_per_session < limits.max_calls_per_turn) {
    errors.push({
      field: "limits.max_calls_per_session",
      code: "conflict",
      message: "会话调用上限不得小于单轮调用上限",
    });
  }
  if (!(1 <= limits.max_calls_per_turn && limits.max_calls_per_turn <= 20)) {
    errors.push({ field: "limits.max_calls_per_turn", code: "range", message: "单轮调用上限应在 1~20 之间" });
  }
  if (!(1 <= limits.max_calls_per_session && limits.max_calls_per_session <= 500)) {
    errors.push({ field: "limits.max_calls_per_session", code: "range", message: "会话调用上限应在 1~500 之间" });
  }
  if (!(1000 <= limits.timeout_ms && limits.timeout_ms <= 60000)) {
    errors.push({ field: "limits.timeout_ms", code: "range", message: "单次超时应在 1000~60000 毫秒之间" });
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function parseBaseline(config) {
  const toolFacet = {};
  const permFacet = {};
  for (const [name, item] of Object.entries(config.tools)) {
    if (item.enabled) {
      toolFacet[name] = item.perm;
      permFacet[name] = clone(item.perm);
    }
  }
  return {
    tools: toolFacet,
    permissions: permFacet,
    limits: { ...config.limits },
    preset: config.guard.preset,
  };
}

export function enabledTools(config) {
  return Object.entries(config.tools).filter(([, item]) => item.enabled).map(([name]) => name);
}

// ---------- mapping.py ----------

export const PRESETS = {
  loose: {
    l2_high: 0.9,
    l2_gray_low: 0.6,
    block_medium: false,
    challenge_enabled: false,
    always_l3: false,
    note: "仅高危越权拦截，中等风险只记录不阻断",
  },
  standard: {
    l2_high: 0.75,
    l2_gray_low: 0.45,
    block_medium: false,
    challenge_enabled: true,
    always_l3: false,
    note: "越权一律阻断，可疑但未越权记录告警或质询",
  },
  strict: {
    l2_high: 0.6,
    l2_gray_low: 0.3,
    block_medium: true,
    challenge_enabled: true,
    always_l3: true,
    note: "任何越权迹象即阻断，并做跨轮一致性检查",
  },
};

export const SENSITIVE_CONFIG_KEYS = [
  "admin_password",
  "api_key",
  "secret_key",
  "db_password",
  "guard_preset",
  "allow_paths",
];

export function presetParams(preset) {
  return { ...(PRESETS[preset] ?? PRESETS.standard) };
}

function policyEntry(seq, level, ruleType, condition, action, source, params, idPrefix = "pol") {
  return {
    policy_id: `${idPrefix}-${String(seq).padStart(2, "0")}`,
    level,
    rule_type: ruleType,
    condition,
    action,
    source,
    origin: "auto",
    enabled: true,
    params,
  };
}

function joinList(list) {
  return list.map((v) => pyStr(v)).join(", ");
}

function joinOrEmpty(list) {
  return joinList(list) || "（空）";
}

export function generatePolicies(config, preset = null, overrides = null, { idPrefix = "pol" } = {}) {
  preset = pyOr(preset, config.guard.preset);
  const params = presetParams(preset);
  const policies = [];
  let seq = 0;

  const add = (level, ruleType, condition, action, source, ruleParams) => {
    seq += 1;
    policies.push(policyEntry(seq, level, ruleType, condition, action, source, ruleParams, idPrefix));
  };

  for (const name of TOOL_NAMES) {
    const enabled = config.tools[name].enabled;
    const condition = enabled
      ? `${name} 已启用，允许在权限范围内调用`
      : `${name} 未启用，任何调用均为越界调用工具`;
    add("L1", "tool_existence", condition, "block", `tools.${name}.enabled`, { tool: name, enabled });
  }

  const tools = config.tools;
  if (tools.read_file.enabled) {
    const perm = tools.read_file.perm;
    add(
      "L1",
      "allow_path_prefix",
      `read_file.path 不以 ${joinOrEmpty(perm.allow_paths)} 开头`,
      "block",
      "read_file.allow_paths",
      { allow_paths: perm.allow_paths },
    );
    add(
      "L1",
      "deny_filename",
      `read_file.path 命中 ${joinOrEmpty(perm.deny_names)}`,
      "block",
      "read_file.deny_names",
      { deny_names: perm.deny_names },
    );
    add("L1", "path_traversal", "read_file.path 含路径穿越片段（.. 或绝对路径）", "block", "read_file.perm", {});
  }
  if (tools.write_file.enabled) {
    const perm = tools.write_file.perm;
    add(
      "L1",
      "allow_path_prefix",
      `write_file.path 不以 ${joinOrEmpty(perm.allow_paths)} 开头`,
      "block",
      "write_file.allow_paths",
      { allow_paths: perm.allow_paths },
    );
    add("L1", "path_traversal", "write_file.path 含路径穿越片段（.. 或绝对路径）", "block", "write_file.perm", {});
    add(
      "L1",
      "overwrite_check",
      "write_file 目标已存在且未授权覆盖",
      "block",
      "write_file.overwrite",
      { overwrite: perm.overwrite },
    );
  }
  if (tools.send_email.enabled) {
    const perm = tools.send_email.perm;
    add(
      "L1",
      "allow_domain_suffix",
      `send_email 收件域名不在 ${joinList(perm.allow_domains)} 内`,
      "block",
      "send_email.allow_domains",
      { allow_domains: perm.allow_domains },
    );
    add(
      "L1",
      "max_recipients",
      `send_email 收件人数超过 ${pyStr(perm.max_recipients)}`,
      "block",
      "send_email.max_recipients",
      { max_recipients: perm.max_recipients },
    );
  }
  if (tools.query_api.enabled) {
    const perm = tools.query_api.perm;
    add(
      "L1",
      "allow_endpoint",
      `query_api.endpoint 不在 ${joinOrEmpty(perm.allow_endpoints)} 内`,
      "block",
      "query_api.allow_endpoints",
      { allow_endpoints: perm.allow_endpoints },
    );
    add(
      "L1",
      "mask_fields",
      `query_api 返回须对 ${joinOrEmpty(perm.mask_fields)} 脱敏`,
      "degrade",
      "query_api.mask_fields",
      { mask_fields: perm.mask_fields },
    );
  }
  if (tools.run_cmd.enabled) {
    const perm = tools.run_cmd.perm;
    add(
      "L1",
      "allow_cmd",
      `run_cmd.cmd 不在 ${joinOrEmpty(perm.allow_cmds)} 内`,
      "block",
      "run_cmd.allow_cmds",
      { allow_cmds: perm.allow_cmds },
    );
  }
  if (tools.update_config.enabled) {
    const perm = tools.update_config.perm;
    add(
      "L1",
      "allow_key",
      `update_config.key 不在 ${joinOrEmpty(perm.allow_keys)} 内`,
      "block",
      "update_config.allow_keys",
      { allow_keys: perm.allow_keys },
    );
    add(
      "L1",
      "sensitive_key",
      `update_config.key 命中敏感键 ${joinList(SENSITIVE_CONFIG_KEYS)}`,
      "block",
      "update_config.sensitive",
      { sensitive_keys: SENSITIVE_CONFIG_KEYS },
    );
  }

  const limits = config.limits;
  add(
    "L1",
    "call_limit",
    `单轮工具调用超过 ${pyStr(limits.max_calls_per_turn)} 次`,
    "block",
    "limits.max_calls_per_turn",
    { scope: "turn", max: limits.max_calls_per_turn },
  );
  add(
    "L1",
    "call_limit",
    `会话累计调用超过 ${pyStr(limits.max_calls_per_session)} 次`,
    "block",
    "limits.max_calls_per_session",
    { scope: "session", max: limits.max_calls_per_session },
  );
  add(
    "L1",
    "timeout",
    `单次调用超过 ${pyStr(limits.timeout_ms)} 毫秒`,
    "block",
    "limits.timeout_ms",
    { timeout_ms: limits.timeout_ms },
  );
  add(
    "L2",
    "threshold",
    `注入概率 ≥ ${pyStr(params.l2_high)} 判高危短路，≥ ${pyStr(params.l2_gray_low)} 进灰区`,
    "challenge",
    "guard.preset",
    { high: params.l2_high, gray_low: params.l2_gray_low },
  );
  add(
    "L3",
    "prompt_rule",
    "语义判定须对照基线摘要，输出固定 JSON 结论",
    "challenge",
    "guard.preset",
    { preset },
  );

  const rejected = applyOverrides(policies, pyOr(overrides, []));
  return [policies, rejected];
}

export function applyOverrides(policies, overrides) {
  const rejected = [];
  const byId = {};
  for (const p of policies) byId[p.policy_id] = p; // 重复 id 后者覆盖，同 Python dict 推导
  const bySource = {};
  for (const p of policies) {
    (bySource[p.source] ??= []).push(p);
  }
  for (const ov of overrides) {
    if (!isDict(ov)) continue;
    let targets = [];
    if (pyOr(has(ov, "policy_id") ? ov.policy_id : null, null) && has(byId, ov.policy_id)) {
      targets = [byId[ov.policy_id]];
    } else if (pyOr(has(ov, "source") ? ov.source : null, null)) {
      targets = bySource[ov.source] ?? [];
    }
    for (const policy of targets) {
      if (policy.rule_type === "tool_existence" && ov.enabled === false) {
        rejected.push({ policy_id: policy.policy_id, reason: "工具存在性硬规则不允许停用" });
        continue;
      }
      if (has(ov, "action") && ["allow", "block", "challenge", "degrade"].includes(ov.action)) {
        policy.action = ov.action;
      }
      if (has(ov, "enabled")) policy.enabled = pyBool(ov.enabled);
      if (isDict(ov.threshold)) {
        if (!has(policy, "params")) policy.params = {};
        Object.assign(policy.params, ov.threshold);
      }
      policy.origin = "manual";
      if (pyOr(has(ov, "note") ? ov.note : null, null)) policy.override_note = ov.note;
    }
  }
  return rejected;
}

export function baselineSummary(config, preset = null) {
  preset = pyOr(preset, config.guard.preset);
  const params = presetParams(preset);
  const lines = [
    `Agent 名称：${config.name}`,
    `声明用途：${pyStr(pyOr(config.purpose, "未标注用途的自定义 Agent"))}`,
    `系统提示词：${config.system_prompt}`,
    `防护档位：${preset}（${params.note}）`,
  ];
  const enabled = enabledTools(config);
  lines.push("启用工具：" + (enabled.length > 0 ? joinList(enabled) : "无"));
  for (const name of enabled) {
    const perm = config.tools[name].perm;
    const parts = [];
    for (const [key, value] of Object.entries(perm)) {
      if (Array.isArray(value)) parts.push(`${key}=[${joinList(value)}]`);
      else parts.push(`${key}=${pyStr(value)}`);
    }
    lines.push(`  ${name} 授权：${parts.join("；")}`);
  }
  const disabled = TOOL_NAMES.filter((n) => !enabled.includes(n));
  if (disabled.length > 0) {
    lines.push("未启用工具（任何调用均为越界）：" + joinList(disabled));
  }
  const limits = config.limits;
  lines.push(
    `调用约束：单轮 ≤ ${pyStr(limits.max_calls_per_turn)} 次，` +
      `会话 ≤ ${pyStr(limits.max_calls_per_session)} 次，` +
      `单次超时 ${pyStr(limits.timeout_ms)}ms`,
  );
  const guardOverrides = has(config.guard, "overrides") ? config.guard.overrides : [];
  const manual = Array.isArray(guardOverrides) ? guardOverrides.filter(isDict) : [];
  if (manual.length > 0) {
    lines.push(`人工覆盖项：${manual.length} 项（详见策略条目 origin=manual）`);
  }
  return lines.join("\n");
}

export function llmCostEstimate(_config) {
  return { l1: 0, l2: 0, l3: 1 };
}

// ---------- snapshot.py（仅纯函数部分） ----------

export const _TOOL_RULES = {
  read_file: new Set(["allow_path_prefix", "deny_filename", "path_traversal"]),
  write_file: new Set(["allow_path_prefix", "path_traversal", "overwrite_check"]),
  send_email: new Set(["allow_domain_suffix", "max_recipients"]),
  query_api: new Set(["allow_endpoint", "mask_fields"]),
  run_cmd: new Set(["allow_cmd"]),
  update_config: new Set(["allow_key", "sensitive_key"]),
};

export function indexRules(policies, toolName) {
  const relevant = [];
  for (const policy of policies) {
    if (!pyBool(has(policy, "enabled") ? policy.enabled : true)) continue;
    const level = has(policy, "level") ? policy.level : null;
    const ruleType = has(policy, "rule_type") ? policy.rule_type : null;
    const params = policy.params ?? {};
    if (level === "L2" || level === "L3") {
      relevant.push(policy);
    } else if (ruleType === "tool_existence") {
      if (params.tool === toolName) relevant.push(policy);
    } else if (ruleType === "call_limit" || ruleType === "timeout") {
      relevant.push(policy);
    } else if (params.tool === toolName || (_TOOL_RULES[toolName]?.has(ruleType) ?? false)) {
      relevant.push(policy);
    }
  }
  return relevant;
}

export function snapshotView(snapshot) {
  const grouped = { L1: [], L2: [], L3: [] };
  for (const policy of snapshot.policies) {
    (grouped[policy.level] ??= []).push(policy);
  }
  return {
    snapshot_id: snapshot.snapshot_id,
    version: snapshot.version,
    config_version: snapshot.config_version,
    baseline_summary: snapshot.baseline_summary,
    manual_override_count: snapshot.policies.filter((p) => p.origin === "manual").length,
    levels: grouped,
    created_at: snapshot.created_at,
  };
}

// freeze/apply_policy_override 的纯合并部分（不含 DB 写入/版本计数）：
// 返回 { error, policies, mergedOverride }；error 非空时 policies/mergedOverride 为 null。
export function mergePolicyOverride(snapshotPolicies, policyId, override) {
  const policies = snapshotPolicies.map((p) => ({ ...p })); // 同 Python dict(p) 浅拷贝
  const target = policies.find((p) => p.policy_id === policyId);
  if (!target) return { error: "策略条目不存在", policies: null, mergedOverride: null };
  if (target.rule_type === "tool_existence" && (has(override, "enabled") ? override.enabled : undefined) === false) {
    return { error: "工具存在性硬规则不允许停用", policies: null, mergedOverride: null };
  }
  const merged = { ...override, policy_id: policyId };
  const rejected = applyOverrides(policies, [merged]);
  if (rejected.length > 0) return { error: rejected[0].reason, policies: null, mergedOverride: null };
  return { error: null, policies, mergedOverride: merged };
}

// ---------- api/v1/instances.py L206-262 ----------

export function diffConfigs(source, target) {
  const diffs = [];
  for (const field of ["name", "purpose", "system_prompt"]) {
    const sv = has(source, field) ? source[field] : null;
    const tv = has(target, field) ? target[field] : null;
    if (!deepEq(sv, tv)) {
      diffs.push({ field, change: `${pyRepr(sv)} → ${pyRepr(tv)}` });
    }
  }
  const sTools = source.tools ?? {};
  const tTools = target.tools ?? {};
  const toolNames = [...new Set([...Object.keys(sTools), ...Object.keys(tTools)])].sort();
  for (const tool of toolNames) {
    const s = has(sTools, tool) ? sTools[tool] : null;
    const t = has(tTools, tool) ? tTools[tool] : null;
    if (s === null || s === undefined) {
      diffs.push({ field: `tools.${tool}`, change: "新增工具" });
      continue;
    }
    if (t === null || t === undefined) {
      diffs.push({ field: `tools.${tool}`, change: "移除工具" });
      continue;
    }
    const sObj = isDict(s) ? s : {};
    const tObj = isDict(t) ? t : {};
    const sEn = has(sObj, "enabled") ? sObj.enabled : null;
    const tEn = has(tObj, "enabled") ? tObj.enabled : null;
    if (pyBool(sEn) !== pyBool(tEn)) {
      diffs.push({ field: `tools.${tool}.enabled`, change: `${pyStr(sEn)} → ${pyStr(tEn)}` });
    }
    const sPerm = sObj.perm ?? {};
    const tPerm = tObj.perm ?? {};
    const permKeys = [...new Set([...Object.keys(sPerm), ...Object.keys(tPerm)])].sort();
    for (const key of permKeys) {
      const sv = has(sPerm, key) ? sPerm[key] : null;
      const tv = has(tPerm, key) ? tPerm[key] : null;
      if (!deepEq(sv, tv)) {
        diffs.push({ field: `tools.${tool}.perm.${key}`, change: `${pyRepr(sv)} → ${pyRepr(tv)}` });
      }
    }
  }
  const sLimits = has(source, "limits") ? source.limits : null;
  const tLimits = has(target, "limits") ? target.limits : null;
  if (!deepEq(sLimits, tLimits)) {
    diffs.push({ field: "limits", change: `${pyRepr(sLimits)} → ${pyRepr(tLimits)}` });
  }
  const sPreset = (source.guard ?? {}).preset ?? null;
  const tPreset = (target.guard ?? {}).preset ?? null;
  if (sPreset !== tPreset) {
    diffs.push({ field: "guard.preset", change: `${pyStr(sPreset)} → ${pyStr(tPreset)}` });
  }
  return diffs;
}

export function mergeModifiedConfig(baseConfig, modifiedPartial) {
  const merged = clone(baseConfig ?? {}); // Python copy.deepcopy(base)
  if (!pyBool(modifiedPartial)) return merged; // if not modified: return
  for (const [key, value] of Object.entries(modifiedPartial)) {
    if (key === "tools" && isDict(value)) {
      if (merged.tools == null) merged.tools = {}; // Python 缺 tools 会 KeyError，JS 收敛为空对象
      for (const [tool, spec] of Object.entries(value)) {
        let current = merged.tools[tool];
        if (current === undefined) {
          current = { enabled: false, perm: {} };
          merged.tools[tool] = current;
        }
        if (isDict(spec)) {
          if (has(spec, "enabled")) current.enabled = spec.enabled;
          if (has(spec, "perm")) current.perm = spec.perm;
        }
      }
    } else {
      merged[key] = clone(value); // copy.deepcopy(value)
    }
  }
  return merged;
}

// ---------- api/v1/configs.py L15-24 ----------

export function templatePrompt(name, purpose) {
  const role = pyOr(name, "企业内部助手");
  const duty = Array.from(pyStr(pyOr(purpose, "协助用户完成授权的内部事务"))).slice(0, 60).join("");
  return (
    `你是${pyStr(role)}，职责：${duty}。` +
    "仅访问与职责相关的公开文档与内部接口，敏感字段脱敏后展示。" +
    "禁止读取凭证或敏感文件、向外域发送邮件、执行系统命令。" +
    "越权请求须拒绝并说明原因。"
  );
}
