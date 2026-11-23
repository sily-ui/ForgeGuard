// 对应 core/quota.py：platform_state 模式 + quota_counters 计数（CAS 替代原子 UPDATE）。
import { ApiError, QuotaExhausted, settings, utcnow } from './deps.mjs';
import { rateLimiter } from './security.mjs';
import { GUEST_CALL_LIMIT } from './deps.mjs';

export const MODE_LIVE = 'live';
export const MODE_REPLAY = 'replay';

const day = () => {
  const d = utcnow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function globalKey() { return `global:${day()}`; }
function guestKeys(ctx) {
  const d = day();
  return [`guest:ws:${ctx.workspace}:${d}`, `guest:ip:${ctx.ip}:${d}`];
}

export async function getMode(store) {
  const row = await store.get('platform_state', 'key', 'mode');
  return row ? row.value : MODE_LIVE;
}

export async function setMode(store, mode, reason = null, snapshotId = null) {
  const row = await store.get('platform_state', 'key', 'mode');
  if (row == null) await store.insert('platform_state', { key: 'mode', value: mode });
  else await store.update('platform_state', { value: mode }, [['key', 'eq', 'mode']]);
  const payload = { reason, snapshot_id: snapshotId, at: utcnow().toISOString() };
  const meta = await store.get('platform_state', 'key', 'mode_meta');
  if (meta == null) await store.insert('platform_state', { key: 'mode_meta', value: payload });
  else await store.update('platform_state', { value: payload }, [['key', 'eq', 'mode_meta']]);
}

export async function getModeMeta(store) {
  const row = await store.get('platform_state', 'key', 'mode_meta');
  return row?.value ?? {};
}

async function used(store, key) {
  const row = await store.get('quota_counters', 'key', key);
  return row ? row.used : 0;
}

// 原子语义：insert-if-absent + CAS 自增；重试窗口内并发安全，超额返回 false。
async function consume(store, key, amount, limit) {
  const absented = await store.insertIfAbsent('quota_counters', { key, used: 0, max_calls: limit });
  if (absented && amount === 0) return true;
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await store.get('quota_counters', 'key', key);
    if (!row) return false;
    if (row.used + amount > row.max_calls) return false;
    const updated = await store.cas('quota_counters', { used: row.used + amount }, [['key', 'eq', key], ['used', 'eq', row.used]]);
    if (updated.length === 1) return true;
  }
  return false;
}

async function refund(store, key, amount) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await store.get('quota_counters', 'key', key);
    if (!row) return;
    const updated = await store.cas('quota_counters', { used: Math.max(0, row.used - amount) }, [['key', 'eq', key], ['used', 'eq', row.used]]);
    if (updated.length === 1) return;
  }
}

export async function status(store, ctx, sessionId = null) {
  const sessionUsed = sessionId ? await used(store, `session:${sessionId}`) : 0;
  let sessionMax = settings.quotaSessionMax;
  if (sessionId) {
    const row = await store.get('quota_counters', 'key', `session:${sessionId}`);
    if (row) sessionMax = row.max_calls;
  }
  const globalRow = await store.get('quota_counters', 'key', globalKey());
  const data = {
    session_used_calls: sessionUsed,
    session_max_calls: sessionMax,
    global_used_calls: globalRow ? globalRow.used : 0,
    global_max_calls: globalRow ? globalRow.max_calls : settings.quotaGlobalDaily,
    mode: await getMode(store),
  };
  if (ctx && ctx.role === 'guest') {
    const [wsKey, ipKey] = guestKeys(ctx);
    data.guest_used_calls = await used(store, wsKey);
    data.guest_max_calls = settings.quotaGuestDaily;
    data.guest_ip_used_calls = await used(store, ipKey);
    data.guest_ip_max_calls = settings.quotaGuestIpDaily;
  }
  return data;
}

export function checkGuestCallRate(ctx) {
  if (ctx && ctx.role === 'guest') {
    rateLimiter.check(`call:ip:${ctx.ip}`, GUEST_CALL_LIMIT);
    rateLimiter.check(`call:ws:${ctx.workspace}`, GUEST_CALL_LIMIT);
  }
}

export async function consumeModelQuota(store, ctx, sessionId = null, amount = 1) {
  const guest = ctx && ctx.role === 'guest';
  const taken = [];
  let ok1 = true, ok2 = true, ok3 = true, ok4 = true;
  try {
    ok1 = await consume(store, globalKey(), amount, settings.quotaGlobalDaily);
    if (ok1) taken.push(globalKey());
    if (sessionId) {
      ok2 = await consume(store, `session:${sessionId}`, amount, settings.quotaSessionMax);
      if (ok2) taken.push(`session:${sessionId}`);
    }
    if (guest) {
      const [wsKey, ipKey] = guestKeys(ctx);
      ok3 = await consume(store, wsKey, amount, settings.quotaGuestDaily);
      if (ok3) taken.push(wsKey);
      ok4 = await consume(store, ipKey, amount, settings.quotaGuestIpDaily);
      if (ok4) taken.push(ipKey);
    }
    if (!(ok1 && ok2 && ok3 && ok4)) {
      let scope;
      if (!ok3) scope = `游客今日工作区额度（${settings.quotaGuestDaily} 次/天）`;
      else if (!ok4) scope = `当前网络今日游客额度（${settings.quotaGuestIpDaily} 次/天）`;
      else if (!ok1) scope = '全局';
      else scope = '会话';
      throw new QuotaExhausted(`${scope}模型调用额度用尽`);
    }
  } catch (err) {
    for (const key of taken) await refund(store, key, amount).catch(() => {});
    if (err instanceof QuotaExhausted) {
      if (settings.snapshotMode === 'auto' && !ok1) {
        await setMode(store, MODE_REPLAY, '全局模型配额耗尽，自动切换快照回放');
      }
      throw err;
    }
    throw err;
  }
}

export async function checkAndConsume(store, ctx, sessionId, amount = 1) {
  checkGuestCallRate(ctx);
  await consumeModelQuota(store, ctx, sessionId, amount);
}

export async function adjust(store, globalMax = null, sessionMax = null) {
  if (globalMax != null) {
    const row = await store.get('quota_counters', 'key', globalKey());
    if (row == null) await store.insert('quota_counters', { key: globalKey(), used: 0, max_calls: globalMax });
    else await store.update('quota_counters', { max_calls: globalMax }, [['key', 'eq', globalKey()]]);
  }
  if (sessionMax != null) {
    settings.quotaSessionMax = sessionMax;
    const rows = await store.rows('quota_counters', [['key', 'like', 'session:%']], { limit: 500 });
    for (const row of rows) await store.update('quota_counters', { max_calls: sessionMax }, [['key', 'eq', row.key]]);
  }
}

// 仿真链路的“强制仿真原因”（对应 proxy 的 _force_simulated ContextVar）。
let forceSimulatedReason = null;
export function setForceSimulated(reason) { const prev = forceSimulatedReason; forceSimulatedReason = reason; return prev; }
export function currentSimulatedReason() { return forceSimulatedReason; }
export async function withForceSimulated(reason, fn) {
  const prev = setForceSimulated(reason);
  try { return await fn(); } finally { setForceSimulated(prev); }
}
