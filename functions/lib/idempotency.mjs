// 对应 core/idempotency.py：idempotency_keys 表，24h TTL 惰性清理。
const TTL_SECONDS = 24 * 3600;

function scoped(key, workspace) { return `${workspace || 'default'}:${key}`; }

export async function getCached(store, key, endpoint, workspace = 'default') {
  if (!key) return null;
  const row = await store.get('idempotency_keys', 'key', scoped(key, workspace));
  if (!row) return null;
  if (row.endpoint !== endpoint || Date.now() / 1000 - row.created_ts > TTL_SECONDS) return null;
  return row.response;
}

export async function storeResult(store, key, endpoint, response, workspace = 'default') {
  if (!key) return;
  const scopedKey = scoped(key, workspace);
  const row = await store.get('idempotency_keys', 'key', scopedKey);
  if (row != null) {
    if (Date.now() / 1000 - row.created_ts <= TTL_SECONDS) return;
    await store.update('idempotency_keys', { endpoint, response, created_ts: Math.trunc(Date.now() / 1000) }, [['key', 'eq', scopedKey]]);
  } else {
    await store.insert('idempotency_keys', { key: scopedKey, endpoint, response, created_ts: Math.trunc(Date.now() / 1000) });
  }
  // created_ts 落 bigint，过滤值同样取整，避免带小数的参数被平台按 int8 解析。
  const expired = await store.rows('idempotency_keys', [['created_ts', 'lt', Math.trunc(Date.now() / 1000 - TTL_SECONDS)]], { limit: 200 });
  for (const item of expired) await store.remove('idempotency_keys', [['key', 'eq', item.key]]);
}
