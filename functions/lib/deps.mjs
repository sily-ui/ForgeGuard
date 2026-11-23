// 与 backend/app/core/{errors,security,response,config}.py、api/v1/__init__ 前的 ids.py 对齐的基础层。

export const CODE_MESSAGES = {
  0: "ok",
  40000: "参数校验失败",
  40001: "配置冲突",
  40100: "未认证",
  40300: "权限不足",
  40400: "资源不存在",
  40900: "状态冲突",
  42200: "校验不可通过",
  42900: "限流",
  42901: "配额耗尽",
  42902: "并发实例超限",
  50000: "内部错误",
  50300: "模型接口不可用",
  50301: "监护不可用",
};

const HTTP_STATUS = {
  40000: 400, 40001: 400, 40100: 401, 40300: 403, 40400: 404, 40900: 409,
  42200: 422, 42900: 429, 42901: 429, 42902: 429, 50000: 500, 50300: 503, 50301: 503,
};

export class ApiError extends Error {
  constructor(code, detail = null, fieldErrors = null, message = null, headers = null) {
    super(message || CODE_MESSAGES[code] || "未知错误");
    this.code = code;
    this.detail = detail;
    this.fieldErrors = fieldErrors;
    this.headers = headers || {};
  }
  get httpStatus() { return HTTP_STATUS[this.code] || 500; }
  toBody() {
    const body = { code: this.code, message: this.message, data: null };
    if (this.detail != null) body.detail = this.detail;
    if (this.fieldErrors) body.field_errors = this.fieldErrors;
    return body;
  }
}

export class QuotaExhausted extends ApiError {
  constructor(detail = null) { super(42901, detail || "模型调用额度用尽，已切换快照模式"); }
}

export class ModelUnavailable extends ApiError {
  constructor(detail = null) { super(50300, detail || "外部 LLM 服务不可达"); }
}

export function ok(data = null, message = "ok") { return { code: 0, message, data }; }

export function envelopeJson(data, status = 200, headers = null) {
  return new Response(JSON.stringify(ok(data)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...(headers || {}) },
  });
}

export function errorResponse(err) {
  const body = err instanceof ApiError ? err.toBody() : { code: 50000, message: CODE_MESSAGES[50000], data: null };
  const status = err instanceof ApiError ? err.httpStatus : 500;
  const headers = err instanceof ApiError ? err.headers : {};
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function paginate(items, page, pageSize, total = null) {
  return { items, total: total != null ? total : items.length, page, page_size: pageSize };
}

export function parsePagination(page = 1, pageSize = 20) {
  let p = Math.max(1, parseInt(page, 10) || 1);
  let s = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
  if (!Number.isFinite(p)) p = 1;
  if (!Number.isFinite(s)) s = 20;
  return [p, s];
}

export function slicePage(items, page, pageSize) {
  return items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
}

export function utcnow() { return new Date(); }

export function iso(dt) {
  return new Date(dt).toISOString().slice(0, 19) + "Z";
}

export function parseIso(value) {
  if (!value) return null;
  const d = new Date(String(value).replace("Z", "+00:00"));
  return Number.isNaN(d.getTime()) ? null : d;
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randSuffix(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newId(prefix) { return `${prefix}-${randSuffix()}`; }

const PREFIX_HINTS = [
  ["运维", "opsaudit"], ["办公", "office"], ["客服", "support"], ["数据", "data"],
  ["ops", "opsaudit"], ["office", "office"], ["support", "support"],
];

export function instancePrefix(name) {
  const lowered = String(name || "").toLowerCase();
  for (const [hint, slug] of PREFIX_HINTS) if (lowered.includes(hint)) return slug;
  const ascii = lowered.replace(/[^a-z0-9]+/g, "");
  return ascii.slice(0, 12) || "agent";
}

export function newInstanceId(name) { return `inst-${instancePrefix(name)}-${randSuffix(4)}`; }

export function tokenUrlSafe() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function env(name, def = "") {
  try {
    if (typeof Deno !== "undefined" && Deno.env) return Deno.env.get(name) ?? def;
  } catch { /* ignore */ }
  try { return process.env[name] ?? def; } catch { return def; }
}

export const settings = {
  quotaGlobalDaily: parseInt(env("QUOTA_GLOBAL_DAILY", "1000"), 10),
  quotaSessionMax: parseInt(env("QUOTA_SESSION_MAX", "60"), 10),
  quotaGuestDaily: parseInt(env("QUOTA_GUEST_DAILY", "50"), 10),
  quotaGuestIpDaily: parseInt(env("QUOTA_GUEST_IP_DAILY", "60"), 10),
  instanceMax: parseInt(env("INSTANCE_MAX", "16"), 10),
  sessionTtl: parseInt(env("SESSION_TTL", "14400"), 10),
  snapshotMode: env("SNAPSHOT_MODE", "auto"),
  instanceTtlMinutes: parseInt(env("INSTANCE_TTL_MINUTES", "60"), 10),
  adminBootstrapKey: env("ADMIN_BOOTSTRAP_KEY", ""),
  modelApiKey: env("MODEL_API_KEY", ""),
  // 非敏感的基础设施默认值与本机 .env 对齐；平台仅需注入两把 API Key，其余可用环境变量覆盖。
  modelBaseUrl: env("MODEL_BASE_URL", "https://maas-api.cn-huabei-1.xf-yun.com/v2").replace(/\/+$/, ""),
  modelName: env("MODEL_NAME", "spark-x2.6"),
  guardianModelName: env("GUARDIAN_MODEL_NAME", "") || env("MODEL_NAME", "spark-x2.6"),
  fallbackModelApiKey: env("FALLBACK_MODEL_API_KEY", ""),
  fallbackModelBaseUrl: env("FALLBACK_MODEL_BASE_URL", "https://maas-api.unisound.com/v1").replace(/\/+$/, ""),
  fallbackModelName: env("FALLBACK_MODEL_NAME", "u2-flash"),
  get modelConfigured() { return Boolean(this.modelBaseUrl && this.modelApiKey && this.modelName); },
  get fallbackConfigured() { return Boolean(this.fallbackModelBaseUrl && this.fallbackModelApiKey && this.fallbackModelName); },
};

export const ROLE_LEVELS = { guest: 0, judge: 1, demo: 2, admin: 3 };

export const GENERAL_LIMIT = 240;
export const HEAVY_LIMIT = 12;
export const AUTH_LIMIT = 12;
export const GUEST_GENERAL_LIMIT = 60;
export const GUEST_CALL_LIMIT = 6;
