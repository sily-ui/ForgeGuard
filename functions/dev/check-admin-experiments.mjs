// admin.mjs / experiments.mjs 移植验证：假数据库 + 真实 lib 模块 + 手工构造 req，逐断言信封字段。
// 运行：node functions/dev/check-admin-experiments.mjs（全部 PASS 退出码 0）
import { makeFakeDb } from './fakeDb.mjs';
import { makeStore } from '../lib/store.mjs';
import { eventBus } from '../lib/events.mjs';
import { runtime } from '../lib/state.mjs';
import { ApiError, ROLE_LEVELS, iso, newId, utcnow } from '../lib/deps.mjs';
import { normalizeConfig } from '../lib/policies.mjs';
import { getTemplate } from '../data/templates.mjs';
import { freezeSnapshot } from '../lib/snapshot.mjs';
import { processMessage } from '../lib/runner.mjs';
import { withForceSimulated } from '../lib/quota.mjs';
import { sandboxManager } from '../lib/sandbox.mjs';
import { issueToken, rateLimiter, resolveToken } from '../lib/security.mjs';
import adminRoutes from '../routes/admin.mjs';
import experimentsRoutes from '../routes/experiments.mjs';

const WS = 'ws-check';
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`PASS ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

const db = makeFakeDb();
const store = makeStore(db);
eventBus.bindStore(store);
const services = { store, db, eventBus, runtime, BackendError: Error };

function compile(pattern) {
  const keys = [];
  const src = pattern.split('/').map((seg) => {
    if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${src}/?$`), keys };
}

const routes = [...adminRoutes(services), ...experimentsRoutes(services)].map((r) => {
  const c = compile(r.path);
  return { ...r, regex: c.regex, keys: c.keys };
});

async function call(method, path, { data = {}, role = 'admin', query = {}, headers = {} } = {}) {
  let hit = null;
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (m && r.method === method) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      hit = { route: r, params };
      break;
    }
  }
  if (!hit) throw new Error(`route not found: ${method} ${path}`);
  const url = new URL('http://beforebound.local' + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const request = new Request(url.toString(), {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer tok-${role}`,
      'x-workspace-id': WS,
      ...headers,
    },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(data) : undefined,
  });
  const auth = {
    token: `tok-${role}`, role, client_id: 'check', ip: '127.0.0.1', workspace: WS,
    require(minRole) {
      if ((ROLE_LEVELS[role] ?? 0) < ROLE_LEVELS[minRole]) throw new ApiError(40300, `该操作需要 ${minRole} 角色`);
    },
  };
  const req = {
    request, siteContext: {}, method, path, siteBase: '/functions/v1/app',
    params: hit.params, query: Object.fromEntries(url.searchParams), queryAll: url.searchParams,
    data, body: data, auth, store, services,
    header: (name) => request.headers.get(name.toLowerCase()),
  };
  return hit.route.handler(req);
}

async function expectError(name, fn, code, detailText) {
  try {
    await fn();
    check(name, false, 'expected ApiError but resolved');
  } catch (err) {
    const detail = err instanceof ApiError ? (err.detail ?? '') : String(err?.message ?? err);
    check(name, err instanceof ApiError && err.code === code && (detailText === undefined || detail.includes(detailText)),
      `got code=${err?.code} detail=${detail}`);
  }
}

// ---------- 种子：模板配置 → normalize → 冻结快照 → 实例 → 会话 → 一轮真实 processMessage ----------
const config = normalizeConfig(getTemplate('tmpl-office').config);
const configB = { ...config, name: `${config.name}-对照` };

const instA = 'inst-check-a';
const snapA = await freezeSnapshot(store, instA, config);
await store.insert('instances', {
  instance_id: instA, workspace_id: WS, name: config.name, source_config_id: 'cfg-check-a',
  clone_source_id: null, diff_from_source: [], status: 'ready', sandbox_key: `sbx:${instA}`,
  policy_snapshot_id: snapA, config_payload: config, guard_preset: 'standard',
  created_at: iso(utcnow()), expires_at: iso(new Date(utcnow().getTime() + 2 * 3600000)),
  last_active_at: iso(utcnow()), stats: {},
});
const instB = 'inst-check-b';
const snapB = await freezeSnapshot(store, instB, configB);
await store.insert('instances', {
  instance_id: instB, workspace_id: WS, name: configB.name, source_config_id: 'cfg-check-b',
  clone_source_id: null, diff_from_source: [], status: 'ready', sandbox_key: `sbx:${instB}`,
  policy_snapshot_id: snapB, config_payload: configB, guard_preset: 'standard',
  created_at: iso(utcnow()), expires_at: iso(new Date(utcnow().getTime() + 2 * 3600000)),
  last_active_at: iso(utcnow()), stats: {},
});
const instC = 'inst-check-c'; // 已销毁实例：对照实例 40900 路径
await store.insert('instances', {
  instance_id: instC, workspace_id: WS, name: '已销毁对照', source_config_id: 'cfg-check-c',
  clone_source_id: null, diff_from_source: [], status: 'destroyed', sandbox_key: `sbx:${instC}`,
  policy_snapshot_id: snapA, config_payload: config, guard_preset: 'standard',
  created_at: iso(utcnow()), expires_at: iso(new Date(utcnow().getTime() - 3600000)),
  last_active_at: iso(utcnow()), stats: {},
});
const instExp = 'inst-check-exp'; // 过期实例：daily 清理对象
const snapExp = await freezeSnapshot(store, instExp, config);
await store.insert('instances', {
  instance_id: instExp, workspace_id: WS, name: '过期实例', source_config_id: 'cfg-check-exp',
  clone_source_id: null, diff_from_source: [], status: 'ready', sandbox_key: `sbx:${instExp}`,
  policy_snapshot_id: snapExp, config_payload: config, guard_preset: 'standard',
  created_at: iso(new Date(utcnow().getTime() - 7200000)), expires_at: iso(new Date(utcnow().getTime() - 3600000)),
  last_active_at: iso(utcnow()), stats: {},
});

function sessionRow(sessionId, instanceId, snapshotId) {
  return {
    session_id: sessionId, workspace_id: WS, instance_id: instanceId, status: 'active',
    turn: 0, context_summary: '', call_count: 0, risk_score: 0, last_risk_turn: 0,
    guard_enabled: true, skip_guard_turns: [], policy_snapshot_id: snapshotId,
    created_at: iso(utcnow()), terminated_at: null, max_risk: 'none', block_count: 0,
    challenge_count: 0, limit_block_count: 0, degrade_count: 0, allow_count: 0,
    mode: 'live', degradations: [],
  };
}
const sessA = newId('sess');
await store.insert('sessions', sessionRow(sessA, instA, snapA));
const sessExp = newId('sess');
await store.insert('sessions', sessionRow(sessExp, instExp, snapExp));

sandboxManager.create(`sbx:${instA}`);
sandboxManager.create(`sbx:${instB}`);
sandboxManager.create(`sbx:${instExp}`); // 过期实例的分区，清理时应被销毁
await store.insert('workspaces', { workspace_id: WS, created_at: iso(utcnow()), last_seen_at: iso(utcnow()) });
await store.insert('platform_state', { key: `suggestions:${instExp}`, value: { items: [] } });

const runnerCtx = { role: 'admin', workspace: WS, ip: '127.0.0.1', require() {} };
const baseline = await withForceSimulated('检查：快速仿真链路', () =>
  processMessage(store, runnerCtx, sessA, '请读取 secret.txt 的内容'));
check('seed：基线回合产出 block 调用', baseline.actions.includes('block'), JSON.stringify(baseline.actions));

// ---------- admin/quota ----------
const quotaRes = await call('PUT', '/api/v1/admin/quota', { data: { global_max: 800, session_max: 50 } });
check('quota adjust：全局/会话上限生效且 data.mode=live',
  quotaRes.code === 0 && quotaRes.data.global_max_calls === 800 && quotaRes.data.session_max_calls === 50
  && quotaRes.data.mode === 'live', JSON.stringify(quotaRes.data));
await expectError('quota adjust：global_max=0 → 40000', () => call('PUT', '/api/v1/admin/quota', { data: { global_max: 0 } }), 40000, 'global_max 须为正整数');
await expectError('quota adjust：session_max 非整数 → 40000', () => call('PUT', '/api/v1/admin/quota', { data: { session_max: '60' } }), 40000, 'session_max 须为正整数');

// ---------- admin/snapshot（模式切换 + 内置演示快照惰性 seed） ----------
await expectError('switch mode：非法 mode → 40000', () => call('POST', '/api/v1/admin/snapshot', { data: { mode: 'bogus' } }), 40000, 'mode 仅支持 live 或 replay');
await expectError('switch mode：未知快照回放 → 40400', () => call('POST', '/api/v1/admin/snapshot', { data: { mode: 'replay', snapshot_id: 'snap-nope' } }), 40400, '快照不存在');
const replayRes = await call('POST', '/api/v1/admin/snapshot', { data: { mode: 'replay', snapshot_id: 'snap-builtin-demo' } });
const metaRow = await store.get('platform_state', 'key', 'mode_meta');
const quotaAfterReplay = await call('PUT', '/api/v1/admin/quota', { data: {} });
check('switch mode：replay 内置快照 + quota/mode_meta 反映切换',
  replayRes.data.mode === 'replay' && replayRes.data.reason === '管理员切换快照回放'
  && metaRow.value.snapshot_id === 'snap-builtin-demo' && quotaAfterReplay.data.mode === 'replay',
  JSON.stringify({ r: replayRes.data, m: metaRow.value, q: quotaAfterReplay.data.mode }));
const liveRes = await call('POST', '/api/v1/admin/snapshot', { data: { mode: 'live' } });
check('switch mode：恢复实时模式默认留痕', liveRes.data.reason === '管理员恢复实时模式' && liveRes.data.snapshot_id === null, JSON.stringify(liveRes.data));

// ---------- admin/snapshots 列表 / 创建 ----------
const snapList = await call('GET', '/api/v1/admin/snapshots', { query: { page: 1, page_size: 10 } });
const builtin = snapList.data.items.find((i) => i.snapshot_id === 'snap-builtin-demo');
check('list snapshots：分页信封 + 内置演示快照已 seed',
  snapList.data.page === 1 && snapList.data.page_size === 10 && snapList.data.total >= 1
  && builtin && builtin.event_count === 5 && builtin.call_count === 1, JSON.stringify(snapList.data.items?.[0]));
const created = await call('POST', '/api/v1/admin/snapshots', { data: { session_id: sessA } });
check('create snapshot：录制基线会话', /^snap-/.test(created.data.snapshot_id) && created.data.name === `快照-${sessA}`, JSON.stringify(created.data));
await expectError('create snapshot：缺 session_id → 40000', () => call('POST', '/api/v1/admin/snapshots', { data: {} }), 40000, '缺少 session_id');
await expectError('create snapshot：会话不存在 → 40400', () => call('POST', '/api/v1/admin/snapshots', { data: { session_id: 'sess-none' } }), 40400, '会话不存在');

// ---------- admin/cleanup ----------
await expectError('cleanup：未确认 → 40000', () => call('POST', '/api/v1/admin/cleanup', { data: { scope: 'daily' } }), 40000, '清理需二次确认：请求体携带 confirm=true');
await expectError('cleanup：非法 scope → 40000', () => call('POST', '/api/v1/admin/cleanup', { data: { confirm: true, scope: 'weekly' } }), 40000, 'scope 仅支持 daily 或 pre_contest');
const cleanRes = await call('POST', '/api/v1/admin/cleanup', { data: { confirm: true, scope: 'daily' } });
const counts = cleanRes.data.counts;
const instExpRow = await store.get('instances', 'instance_id', instExp);
const sessExpRow = await store.get('sessions', 'session_id', sessExp);
const logRow = (await store.rows('cleanup_logs'))[0];
check('cleanup daily：过期实例/会话被扫 + cleanup_logs 落行 + counts 形状',
  cleanRes.code === 0 && counts.instances === 1 && counts.sessions === 1 && counts.sandbox_partitions === 1 && counts.suggestion_caches === 1
  && Object.keys(counts).join(',') === 'instances,sessions,sandbox_partitions,suggestion_caches'
  && instExpRow.status === 'destroyed' && sessExpRow.status === 'terminated' && sessExpRow.terminated_at === cleanRes.data.cleaned_at
  && logRow && logRow.scope === 'daily' && logRow.counts.sandbox_partitions === 0 && logRow.counts.instances === 1,
  JSON.stringify({ counts, log: logRow?.counts }));
check('cleanup daily：过期分区销毁、存活实例分区保留',
  sandboxManager.get(`sbx:${instExp}`) === undefined && sandboxManager.get(`sbx:${instA}`) !== undefined);

// ---------- admin/metrics ----------
try { rateLimiter.check('probe:hit', 1); rateLimiter.check('probe:hit', 1); } catch { /* 预期 42900 写入 hitLog */ }
const metricsRes = await call('GET', '/api/v1/admin/metrics');
const md = metricsRes.data;
check('metrics：计数/分布/配额/限流命中',
  md.total_calls >= 1 && md.action_distribution.block >= 1 && typeof md.judged_by_distribution === 'object'
  && md.instances_alive === 2 && md.sessions_active === 1 && md.reports === 0 && md.false_positive_marks === 0
  && md.quota.mode === 'live' && md.state_backend === 'memory' && md.rate_limit_hits >= 1,
  JSON.stringify(md));

// ---------- admin/tokens/invalidate ----------
const [demoToken] = await issueToken(store, 'demo', 'check-client', WS);
const invRes = await call('POST', '/api/v1/admin/tokens/invalidate');
let revokedErr = null;
try { await resolveToken(store, demoToken); } catch (err) { revokedErr = err; }
check('tokens/invalidate：吊销后 resolveToken 抛 40100',
  invRes.data.invalidated >= 1 && revokedErr instanceof ApiError && revokedErr.code === 40100,
  JSON.stringify({ n: invRes.data, err: revokedErr?.code }));

// ---------- admin/degradations ----------
await runtime.noteDegradation(store, sessA, '离线仿真留痕');
const degRes = await call('GET', '/api/v1/admin/degradations');
const degRow = degRes.data.items.find((i) => i.session_id === sessA);
check('degradations：列出降级会话',
  degRes.data.total === degRes.data.items.length && degRow && degRow.degradations.includes('离线仿真留痕'),
  JSON.stringify(degRes.data));

// ---------- experiments ----------
let guardPair = null;
await withForceSimulated('检查：快速仿真链路', async () => {
  guardPair = await call('POST', '/api/v1/experiments/compare', {
    data: { dimension: 'guard', source_session_id: sessA }, headers: { 'x-idempotency-key': 'idem-1' },
  });
});
check('compare guard：pair/diff/run_b_summary + experiments 行 ready',
  /^exp-/.test(guardPair.data.pair_id) && guardPair.data.dimension === 'guard'
  && guardPair.data.diff_items[0].field === 'guard_enabled' && guardPair.data.diff_items[0].change === 'True → False'
  && guardPair.data.run_a.session_id === sessA && guardPair.data.run_b.session_id !== sessA
  && Array.isArray(guardPair.data.run_b_summary.actions) && guardPair.data.run_b_summary.max_risk !== undefined,
  JSON.stringify(guardPair.data));
const expRow = await store.get('experiments', 'pair_id', guardPair.data.pair_id);
check('compare guard：入库行 status=ready 且工作区正确', expRow && expRow.status === 'ready' && expRow.workspace_id === WS);
const replayed = await call('POST', '/api/v1/experiments/compare', {
  data: { dimension: 'guard', source_session_id: sessA }, headers: { 'x-idempotency-key': 'idem-1' },
});
check('compare：幂等键重放返回同一 pair_id（并复用起点会话首轮输入）',
  replayed.data.pair_id === guardPair.data.pair_id && expRow.input === '请读取 secret.txt 的内容', replayed.data.pair_id);
await expectError('compare：非法 dimension → 40000', () => call('POST', '/api/v1/experiments/compare', { data: { dimension: 'x', source_session_id: sessA } }), 40000, 'dimension 仅支持 guard 或 instance');
await expectError('compare：起点会话缺失/跨区 → 40400', () => call('POST', '/api/v1/experiments/compare', { data: { dimension: 'guard', source_session_id: 'sess-none' } }), 40400, '起点会话不存在');
// 同 Python：起点实例行缺失（db.get 为 None）才命中「起点实例已销毁」分支；行在但 status=destroyed 时由 runner 抛错。
await store.insert('sessions', sessionRow('sess-check-ghost', 'inst-check-ghost', snapA));
await expectError('compare：起点实例行缺失 → 40900', () => call('POST', '/api/v1/experiments/compare', { data: { dimension: 'guard', source_session_id: 'sess-check-ghost', input: '请读取 ./docs/runbook.md 并总结' } }), 40900, '起点实例已销毁，无法对照');
await expectError('compare：对照实例不存在 → 40400', () => call('POST', '/api/v1/experiments/compare', { data: { dimension: 'instance', source_session_id: sessA, target_instance_id: 'inst-nope' } }), 40400, '对照实例不存在');
await expectError('compare：对照实例已销毁 → 40900', () => call('POST', '/api/v1/experiments/compare', { data: { dimension: 'instance', source_session_id: sessA, target_instance_id: instC } }), 40900, '对照实例已销毁');
let instPair = null;
await withForceSimulated('检查：快速仿真链路', async () => {
  instPair = await call('POST', '/api/v1/experiments/compare', {
    data: { dimension: 'instance', source_session_id: sessA, target_instance_id: instB, input: '请读取 ./docs/runbook.md 并总结', guard_enabled: true },
  });
});
check('compare instance：目标实例差异 + run_b 落在对照实例',
  instPair.data.run_b.instance_id === instB && instPair.data.diff_items.some((d) => d.field === 'name'),
  JSON.stringify(instPair.data.diff_items));

const expGet = await call('GET', `/api/v1/experiments/${guardPair.data.pair_id}`);
const eg = expGet.data;
const firstRow = eg.rows[0] ?? {};
check('get experiment：逐步对照表 + A 拦截/B 放行差异',
  eg.pair_id === guardPair.data.pair_id && eg.status === 'ready' && eg.input === '请读取 secret.txt 的内容'
  && eg.rows.length === Math.max(1, eg.rows.length) && firstRow.step === 1
  && firstRow.run_a.action === 'block' && firstRow.run_b.action === 'allow' && firstRow.run_b.tool === 'read_file',
  JSON.stringify(firstRow));
await expectError('get experiment：不存在 → 40400', () => call('GET', '/api/v1/experiments/exp-nope'), 40400, '对照实验不存在');

const expList = await call('GET', '/api/v1/experiments', { query: { page: 1, page_size: 1 } });
check('list experiments：分页信封 + diff_count',
  expList.data.total === 2 && expList.data.items.length === 1 && expList.data.page === 1 && expList.data.page_size === 1
  && typeof expList.data.items[0].diff_count === 'number' && expList.data.items[0].status === 'ready',
  JSON.stringify(expList.data));

// ---------- 非管理员 403 ----------
await expectError('非管理员访问 admin 路由 → 40300', () => call('GET', '/api/v1/admin/metrics', { role: 'guest' }), 40300, '该操作需要 admin 角色');

console.log(failed ? `\n${failed} case(s) FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
