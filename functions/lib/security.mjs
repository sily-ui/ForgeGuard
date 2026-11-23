// 对应 backend core/security.py：不透明令牌存表 + 进程内存滑动窗口限流（无 Redis）。
import {
  ApiError, ROLE_LEVELS, GENERAL_LIMIT, tokenUrlSafe, utcnow, settings, iso,
} from './deps.mjs';

export class AuthContext {
  constructor(token, role, clientId, ip = '', workspace = '') {
    this.token = token; this.role = role; this.client_id = clientId; this.ip = ip; this.workspace = workspace;
  }
  require(minRole) {
    if ((ROLE_LEVELS[this.role] ?? 0) < ROLE_LEVELS[minRole]) {
      throw new ApiError(40300, `该操作需要 ${minRole} 角色`);
    }
  }
}

export async function issueToken(store, role, clientId, workspaceId = '') {
  const token = tokenUrlSafe();
  const expiresAt = utcnow().getTime() / 1000 + settings.sessionTtl;
  await store.insert('tokens', {
    token,
    role,
    client_id: clientId || '',
    workspace_id: workspaceId || '',
    // 平台受限 DDL 不接受 double precision，令牌到期时间按整秒落 bigint。
    expires_at: Math.trunc(expiresAt),
    revoked: false,
  });
  return [token, settings.sessionTtl];
}

export async function resolveToken(store, token) {
  if (!token) throw new ApiError(40100, '缺少令牌');
  const record = await store.get('tokens', 'token', token);
  if (!record || record.revoked) {
    // 诊断：只记录原因与长度，不落令牌原文。
    console.error(JSON.stringify({ evt: 'auth_token_miss', token_len: token.length }));
    throw new ApiError(40100, '令牌无效');
  }
  if (record.expires_at < utcnow().getTime() / 1000) {
    console.error(JSON.stringify({ evt: 'auth_token_expired' }));
    throw new ApiError(40100, '令牌已过期');
  }
  return new AuthContext(record.token, record.role, record.client_id, '', record.workspace_id || '');
}

export async function revokeToken(store, token) {
  const record = await store.get('tokens', 'token', token);
  if (record) await store.update('tokens', { revoked: true }, [['token', 'eq', token]]);
}

export async function revokeAllTokens(store) {
  const count = await store.count('tokens', [['revoked', 'eq', false]], 'token');
  await store.update('tokens', { revoked: true }, [['revoked', 'eq', false]]);
  return count;
}

export class RateLimiter {
  constructor() {
    this.hits = new Map();
    this.hitLog = []; // 最多 2000 条，供 admin/metrics rate_limit_hits
    this.HIT_LOG_MAX = 2000;
  }

  _reject(key, limit, retryAfter) {
    this.hitLog.push({ key, limit, at: iso(utcnow()), retry_after: retryAfter });
    if (this.hitLog.length > this.HIT_LOG_MAX) this.hitLog.splice(0, this.hitLog.length - this.HIT_LOG_MAX);
    throw new ApiError(42900, `请求过于频繁，请 ${retryAfter} 秒后重试`, null, null, { 'Retry-After': String(retryAfter) });
  }

  check(key, limit, windowSeconds = 60) {
    const now = Date.now() / 1000;
    if (this.hits.size > 10000) {
      for (const [k, v] of this.hits) if (!v.length || v[v.length - 1] <= now - windowSeconds) this.hits.delete(k);
    }
    let bucket = this.hits.get(key);
    if (!bucket) { bucket = []; this.hits.set(key, bucket); }
    let start = 0;
    while (start < bucket.length && bucket[start] <= now - windowSeconds) start++;
    if (start > 0) bucket.splice(0, start);
    if (bucket.length >= limit) {
      const retryAfter = Math.trunc(bucket[0] + windowSeconds - now) + 1;
      this._reject(key, limit, retryAfter);
    }
    bucket.push(now);
  }

  remaining(key, limit, windowSeconds = 60) {
    const now = Date.now() / 1000;
    const bucket = this.hits.get(key);
    if (bucket) {
      let start = 0;
      while (start < bucket.length && bucket[start] <= now - windowSeconds) start++;
      if (start > 0) bucket.splice(0, start);
    }
    const used = bucket ? bucket.length : 0;
    const remaining = Math.max(0, limit - used);
    let reset;
    if (bucket && bucket.length) reset = Math.trunc(now + (bucket[0] + windowSeconds - now));
    else reset = Math.trunc(now) + windowSeconds;
    return [remaining, reset];
  }
}

export const rateLimiter = new RateLimiter();
export { GENERAL_LIMIT };
