// 对应 backend-ref/app/api/v1/admin.py：8 条管理员路由逐字移植。
// Redis 已按 CONTRACTS 裁剪：限流命中读进程内存 rateLimiter.hitLog，模式/配额读 platform_state + quota_counters。
import { ApiError, iso, newId, ok, paginate, parsePagination, slicePage, utcnow } from '../lib/deps.mjs';
import { adjust as quotaAdjust, setMode, status as quotaStatus } from '../lib/quota.mjs';
import { rateLimiter, revokeAllTokens } from '../lib/security.mjs';
import { runtime } from '../lib/state.mjs';
import { pruneCache } from '../lib/suggestions.mjs';
import { sandboxManager } from '../lib/sandbox.mjs';
import { recordSession } from '../lib/runner.mjs';
import { builtinRecording } from '../data/builtin.mjs';
import { heavyCheck } from '../lib/middleware.mjs';

function admin(req) {
  // 同 _admin：get_auth + ctx.require('admin')，鉴权与通用限流已由 app.mjs 分发层完成。
  req.auth.require('admin');
}

async function seedBuiltinSnapshot(store) {
  // CONTRACTS 要求内置演示快照 seed 进 snapshot_recordings；Sites 无常驻 lifespan 钩子，
  // 改在管理员读取/切换时惰性 create-if-absent（回放兜底逻辑本身不依赖该表）。
  const rec = builtinRecording();
  await store.insertIfAbsent('snapshot_recordings', {
    snapshot_id: rec.snapshot_id,
    name: rec.name,
    session_id: null,
    workspace_id: 'default',
    events: { events: rec.events, calls: rec.calls, alerts: rec.alerts },
    created_at: iso(utcnow()),
  });
}

function positiveIntOrNull(payload, field) {
  const value = payload[field];
  if (value === undefined || value === null) return null;
  return Number.isInteger(value) && value >= 1 ? value : undefined;
}

async function adjustQuota(req) {
  admin(req);
  const globalMax = positiveIntOrNull(req.data, 'global_max');
  const sessionMax = positiveIntOrNull(req.data, 'session_max');
  if (globalMax === undefined) throw new ApiError(40000, 'global_max 须为正整数');
  if (sessionMax === undefined) throw new ApiError(40000, 'session_max 须为正整数');
  await quotaAdjust(req.store, globalMax, sessionMax);
  return ok(await quotaStatus(req.store, req.auth));
}

async function switchMode(req) {
  admin(req);
  const mode = req.data.mode;
  if (mode !== 'live' && mode !== 'replay') throw new ApiError(40000, 'mode 仅支持 live 或 replay');
  const snapshotId = req.data.snapshot_id ?? null;
  if (mode === 'replay' && snapshotId) {
    await seedBuiltinSnapshot(req.store);
    const row = await req.store.get('snapshot_recordings', 'snapshot_id', snapshotId);
    if (row === null || row === undefined) throw new ApiError(40400, '快照不存在');
  }
  const reason = req.data.reason
    || (mode === 'replay' ? '管理员切换快照回放' : '管理员恢复实时模式');
  await setMode(req.store, mode, reason, req.data.snapshot_id ?? null);
  return ok({ mode, reason, snapshot_id: req.data.snapshot_id ?? null });
}

async function listSnapshots(req) {
  admin(req);
  const [page, pageSize] = parsePagination(req.query.page, req.query.page_size);
  await seedBuiltinSnapshot(req.store);
  const rows = await req.store.rows('snapshot_recordings', [], { order: 'created_at', desc: true });
  const items = rows.map((r) => ({
    snapshot_id: r.snapshot_id,
    name: r.name,
    session_id: r.session_id ?? null,
    event_count: (r.events?.events ?? []).length,
    call_count: (r.events?.calls ?? []).length,
    created_at: r.created_at,
  }));
  // Python 先全量取行再 len(items) 作 total，移植同序：total=len(items) 而非 SQL count。
  return ok(paginate(slicePage(items, page, pageSize), page, pageSize, items.length));
}

async function createSnapshot(req) {
  admin(req);
  const sessionId = req.data.session_id;
  if (!sessionId) throw new ApiError(40000, '缺少 session_id');
  const session = await req.store.get('sessions', 'session_id', sessionId);
  if (session === null || session === undefined) throw new ApiError(40400, '会话不存在');
  const name = req.data.name || `快照-${sessionId}`;
  // 同 Python record_session(session_id, name)：工作区不随请求变化，恒默认。
  const snapshotId = await recordSession(req.store, sessionId, name);
  return ok({ snapshot_id: snapshotId, name });
}

async function cleanup(req) {
  admin(req);
  // 移植按任务契约对清理动作附加 HEAVY 限流（backend-ref 的 cleanup 未调用 heavy_check）。
  heavyCheck(req.request, req.siteContext, 'cleanup');
  if (!req.data.confirm) throw new ApiError(40000, '清理需二次确认：请求体携带 confirm=true');
  const scope = req.data.scope === undefined ? 'daily' : req.data.scope;
  if (scope !== 'daily' && scope !== 'pre_contest') throw new ApiError(40000, 'scope 仅支持 daily 或 pre_contest');
  const now = iso(utcnow());
  const counts = { instances: 0, sessions: 0, sandbox_partitions: 0, suggestion_caches: 0 };
  let instances;
  if (scope === 'daily') {
    instances = await req.store.rows('instances', [
      ['status', 'in', ['ready', 'frozen', 'pending']],
      ['expires_at', 'lt', now],
    ]);
  } else {
    instances = await req.store.rows('instances', [['status', 'neq', 'destroyed']]);
  }
  const terminatedIds = [];
  for (const instance of instances) {
    await req.store.update('instances', { status: 'destroyed' }, [['instance_id', 'eq', instance.instance_id]]);
    counts.instances += 1;
    const swept = await req.store.update(
      'sessions',
      { status: 'terminated', terminated_at: now },
      [['instance_id', 'eq', instance.instance_id], ['status', 'neq', 'terminated']],
    );
    counts.sessions += swept.length;
    for (const s of swept) terminatedIds.push(s.session_id);
  }
  if (scope === 'pre_contest') {
    const rest = await req.store.update(
      'sessions',
      { status: 'terminated', terminated_at: now },
      [['status', 'neq', 'terminated']],
    );
    counts.sessions += rest.length;
    for (const s of rest) terminatedIds.push(s.session_id);
  }
  counts.suggestion_caches = await pruneCache(req.store);
  // Python 在 with 块退出（提交）时 counts 尚未计入随后的沙盒销毁数，日志行按插入时刻快照存储。
  await req.store.insert('cleanup_logs', {
    // 平台不支持自增主键，清理日志由函数侧发号。
    id: newId('cln'),
    scope,
    counts: { ...counts },
    operator: 'admin',
    created_at: now,
  });
  if (scope === 'pre_contest') {
    // 移植补充：Sites 侧 SSE 历史落 session_events 表（Python 为进程内存总线），赛前清理须一并抹除。
    for (const sessionId of terminatedIds) {
      await req.store.remove('session_events', [['session_id', 'eq', sessionId]], 'id');
      runtime.degradations.delete(sessionId);
    }
    // 工作区表只保留仍被业务数据引用的行（Python 无对应删除，匿名工作区在 Sites 侧会长期累积）。
    const workspaces = await req.store.rows('workspaces');
    for (const ws of workspaces) {
      let referenced = 0;
      for (const [table, pk] of [
        ['configs', 'config_id'], ['instances', 'instance_id'], ['sessions', 'session_id'],
        ['reports', 'report_id'], ['experiments', 'pair_id'],
      ]) {
        referenced += await req.store.count(table, [['workspace_id', 'eq', ws.workspace_id]], pk);
        if (referenced > 0) break;
      }
      if (referenced === 0) await req.store.remove('workspaces', [['workspace_id', 'eq', ws.workspace_id]], 'workspace_id');
    }
  }
  const alive = new Set((await req.store.rows('instances', [
    ['status', 'in', ['creating', 'pending', 'ready', 'frozen']],
  ])).map((r) => r.instance_id));
  for (const key of sandboxManager.keys()) {
    // 同 Python key.replace("sbx:", "")：替换所有出现位置。
    if (scope === 'pre_contest' || !alive.has(key.replaceAll('sbx:', ''))) {
      sandboxManager.destroy(key);
      counts.sandbox_partitions += 1;
    }
  }
  return ok({ scope, counts, cleaned_at: now });
}

async function metrics(req) {
  admin(req);
  const totalCalls = await req.store.count('call_records', [], 'call_id');
  const totalAlerts = await req.store.count('alerts', [], 'alert_id');
  const falsePositive = await req.store.count('alerts', [['false_positive', 'is', true]], 'alert_id');
  const falseNegative = await req.store.count('alerts', [['false_negative', 'is', true]], 'alert_id');
  const callRows = await req.store.rows('call_records');
  const instancesAlive = await req.store.count('instances', [
    ['status', 'in', ['creating', 'pending', 'ready', 'frozen']],
  ], 'instance_id');
  const sessionsActive = await req.store.count('sessions', [['status', 'eq', 'active']], 'session_id');
  const reports = await req.store.count('reports', [], 'report_id');
  const actionDist = {};
  const judgedByDist = {};
  for (const row of callRows) {
    const judgement = row.judgement ?? {};
    const action = judgement.action ?? 'unknown';
    actionDist[action] = (actionDist[action] ?? 0) + 1;
    const judgedBy = judgement.judged_by ?? 'unknown';
    judgedByDist[judgedBy] = (judgedByDist[judgedBy] ?? 0) + 1;
  }
  return ok({
    total_calls: totalCalls,
    total_alerts: totalAlerts,
    false_positive_marks: falsePositive,
    false_negative_marks: falseNegative,
    action_distribution: actionDist,
    judged_by_distribution: judgedByDist,
    instances_alive: instancesAlive,
    sessions_active: sessionsActive,
    reports,
    quota: await quotaStatus(req.store, req.auth),
    // Python 该项反映 Redis 接入结果；Sites 裁剪 Redis 后恒为进程内存（runtime.stateBackend）。
    state_backend: runtime.stateBackend,
    // Python 限流命中在 Redis 可达时跨副本计数；移植恒取进程内存 hitLog 长度。
    rate_limit_hits: rateLimiter.hitLog.length,
  });
}

async function invalidateTokens(req) {
  admin(req);
  const count = await revokeAllTokens(req.store);
  return ok({ invalidated: count });
}

async function degradations(req) {
  admin(req);
  // 原查询 degradations isnot(None) 后再按真值过滤；store 无 neq-null 算子，取回后在 JS 里筛。
  const rows = await req.store.rows('sessions');
  const items = rows
    .filter((r) => Array.isArray(r.degradations) ? r.degradations.length > 0 : Boolean(r.degradations))
    .map((r) => ({ session_id: r.session_id, degradations: r.degradations }));
  return ok({ items, total: items.length });
}

export default function adminRoutes(_services) {
  // 工厂阶段不触碰 services：路由表在 app.mjs 构建期即定型。
  return [
    { method: 'PUT', path: '/api/v1/admin/quota', auth: 'required', handler: adjustQuota },
    { method: 'POST', path: '/api/v1/admin/snapshot', auth: 'required', handler: switchMode },
    { method: 'GET', path: '/api/v1/admin/snapshots', auth: 'required', handler: listSnapshots },
    { method: 'POST', path: '/api/v1/admin/snapshots', auth: 'required', handler: createSnapshot },
    { method: 'POST', path: '/api/v1/admin/cleanup', auth: 'required', handler: cleanup },
    { method: 'GET', path: '/api/v1/admin/metrics', auth: 'required', handler: metrics },
    { method: 'POST', path: '/api/v1/admin/tokens/invalidate', auth: 'required', handler: invalidateTokens },
    { method: 'GET', path: '/api/v1/admin/degradations', auth: 'required', handler: degradations },
  ];
}
