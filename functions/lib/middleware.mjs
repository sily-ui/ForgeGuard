// 对应 api/deps.py 的请求前置：客户端标识、工作区解析/注册、Bearer 鉴权与限流次序。
// 独立成模块是为了让路由模块（如 auth/admin 的额外限流）能直接复用，避免与 app.mjs 形成循环引用。
import {
  ApiError, GENERAL_LIMIT, AUTH_LIMIT, HEAVY_LIMIT, GUEST_GENERAL_LIMIT, settings, iso, utcnow,
} from './deps.mjs';
import { rateLimiter, resolveToken } from './security.mjs';

export const WORKSPACE_HEADER = 'x-workspace-id';
export const DEFAULT_WORKSPACE = 'default';
export const WORKSPACE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

// 私有站点的平台网关会用自己的身份凭证处理 Authorization，业务不透明令牌改由
// 自定义头携带（X-Workspace-Id 已证明自定义头可透传网关）；Authorization 保留兼容本地直连。
export const TOKEN_HEADER = 'x-beforebound-token';

function bearerToken(request) {
  const direct = (request.headers.get(TOKEN_HEADER) || '').trim();
  if (direct) return direct;
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function tokenViaQuery(request) {
  try {
    return (new URL(request.url).searchParams.get('token') || '').trim();
  } catch {
    return '';
  }
}

// last_seen 写库节流：同一工作区 5 分钟内只回写一次，避免高频请求写放大。
const seenCache = new Map();
const SEEN_INTERVAL_MS = 300000;

// Function 恒在平台网关之后，直连地址是网关而非访客；客户端标识只能逐级取转发头。
export function clientIp(request, siteContext) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  for (const name of ['x-real-ip', 'cf-connecting-ip', 'x-nf-client-connection-ip']) {
    const value = request.headers.get(name);
    if (value) return value.trim();
  }
  const userId = siteContext?.user?.id;
  if (userId) return `u-${String(userId).slice(0, 32)}`;
  return 'unknown';
}

async function registerWorkspace(store, workspaceId) {
  const now = iso(utcnow());
  const row = await store.get('workspaces', 'workspace_id', workspaceId);
  if (row == null) {
    await store.insertIfAbsent('workspaces', { workspace_id: workspaceId, created_at: now, last_seen_at: now });
  } else {
    await store.update('workspaces', { last_seen_at: now }, [['workspace_id', 'eq', workspaceId]]);
  }
}

/** 匿名工作区标识：取自 X-Workspace-Id 头，缺失时回退到 default（兼容旧客户端）。 */
export async function resolveWorkspace(store, request) {
  const raw = (request.headers.get(WORKSPACE_HEADER) || '').trim();
  if (!raw) return DEFAULT_WORKSPACE;
  if (!WORKSPACE_RE.test(raw)) throw new ApiError(40000, '工作区标识格式非法');
  const now = Date.now();
  if (now - (seenCache.get(raw) ?? 0) > SEEN_INTERVAL_MS) {
    await registerWorkspace(store, raw);
    seenCache.set(raw, now);
  }
  return raw;
}

// 令牌已绑定工作区时强制一致，杜绝改头越权；未绑定的旧令牌沿用请求头。
async function applyWorkspace(store, auth, request) {
  const raw = (request.headers.get(WORKSPACE_HEADER) || '').trim();
  if (auth.workspace) {
    if (raw && raw !== auth.workspace) throw new ApiError(40300, '工作区与令牌绑定不一致');
    return auth.workspace;
  }
  auth.workspace = await resolveWorkspace(store, request);
  return auth.workspace;
}

function ipLimitOf(auth) {
  return auth.role === 'guest' ? GUEST_GENERAL_LIMIT : GENERAL_LIMIT;
}

function consumeCommon(auth) {
  rateLimiter.check(`ip:${auth.ip}`, ipLimitOf(auth));
  rateLimiter.check(`token:${auth.token}`, GENERAL_LIMIT);
}

export async function authenticate(store, request, siteContext) {
  const token = bearerToken(request);
  if (!token) {
    // 诊断：区分「头被网关吃掉」与「客户端没带」，便于线上定位。
    console.error(JSON.stringify({
      evt: 'auth_missing',
      method: request.method,
      has_auth_header: Boolean(request.headers.get('authorization')),
      has_token_header: Boolean(request.headers.get('x-beforebound-token')),
    }));
    throw new ApiError(40100, '缺少 Bearer 令牌');
  }
  const auth = await resolveToken(store, token);
  auth.ip = clientIp(request, siteContext);
  consumeCommon(auth);
  await applyWorkspace(store, auth, request);
  rateLimiter.check(`ws:${auth.workspace}`, ipLimitOf(auth));
  return auth;
}

export async function authenticateSse(store, request, siteContext) {
  // SSE 通道鉴权：优先自定义头/查询参数令牌（旧式 EventSource 客户端），Authorization 兼容本地直连。
  const token = bearerToken(request) || tokenViaQuery(request);
  const auth = await resolveToken(store, token);
  auth.ip = clientIp(request, siteContext);
  consumeCommon(auth);
  await applyWorkspace(store, auth, request);
  rateLimiter.check(`ws:${auth.workspace}`, ipLimitOf(auth));
  return auth;
}

/** 重活端点限流（模型生成、红队、导入导出等）。 */
export function heavyCheck(request, siteContext, kind) {
  rateLimiter.check(`heavy:${kind}:${clientIp(request, siteContext)}`, HEAVY_LIMIT);
}

/** 签发令牌端点限流，键与主链路分离，避免口令尝试挤占普通配额。 */
export function authLimitCheck(request, siteContext) {
  rateLimiter.check(`auth:${clientIp(request, siteContext)}`, AUTH_LIMIT);
}
