// 本地校验：假数据库 + 真实 lib/store，直接调用 routes/{auth,templates,samples}.mjs 的 handler。
// 运行：node functions/dev/check-auth-samples.mjs
import { makeFakeDb } from './fakeDb.mjs';
import { makeStore } from '../lib/store.mjs';
import { eventBus } from '../lib/events.mjs';
import { runtime } from '../lib/state.mjs';
import { sandboxManager } from '../lib/sandbox.mjs';
import { normalizeConfig } from '../lib/policies.mjs';
import { getTemplate } from '../data/templates.mjs';
import { freezeSnapshot } from '../lib/snapshot.mjs';
import { issueToken, resolveToken } from '../lib/security.mjs';
import { ApiError, iso, newId, utcnow } from '../lib/deps.mjs';
import authRoutes from '../routes/auth.mjs';
import templatesRoutes from '../routes/templates.mjs';
import samplesRoutes from '../routes/samples.mjs';

const db = makeFakeDb();
const store = makeStore(db);
eventBus.bindStore(store);
const services = { store, db, eventBus, runtime, BackendError: ApiError };

const routes = [...authRoutes(services), ...templatesRoutes(services), ...samplesRoutes(services)];
const pick = (method, path) => routes.find((r) => r.method === method && r.path === path);

function makeReq({ method, path, headers = {}, data = {}, params = {}, query = {}, auth = null }) {
  const request = new Request(`http://x${path}`, { method, headers });
  return {
    request, siteContext: {}, method, path, siteBase: '/functions/v1/app',
    params, query, data, body: data, auth, store, services,
  };
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL - ${name}: ${err && err.message}`);
    if (err && err.code) console.log(`     code=${err.code} detail=${JSON.stringify(err.detail)} field_errors=${JSON.stringify(err.fieldErrors)}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

const WS = 'ws-check-00001';

async function expectApiError(fn, code, extra) {
  try {
    await fn();
  } catch (err) {
    assert(err instanceof ApiError, `期望 ApiError，实际 ${err}`);
    assertEq(err.code, code, '错误码');
    if (extra) extra(err);
    return err;
  }
  throw new Error(`期望抛出 ${code}，实际正常返回`);
}

// ---- auth ----
let guestToken = null;
await check('guest 签发令牌', async () => {
  const res = await pick('POST', '/api/v1/auth/guest').handler(
    makeReq({ method: 'POST', path: '/api/v1/auth/guest', headers: { 'x-workspace-id': WS }, data: { client_id: 'c'.repeat(80) } }),
  );
  assertEq(res.code, 0);
  assertEq(res.message, 'ok');
  assertEq(res.data.role, 'guest');
  assertEq(res.data.workspace_id, WS);
  assertEq(res.data.daily_max_calls, 20);
  assertEq(res.data.mode, 'live');
  assert(typeof res.data.token === 'string' && res.data.token.length >= 32, 'token 形态');
  assertEq(res.data.expires_in, 14400);
  guestToken = res.data.token;
  const row = await store.get('tokens', 'token', guestToken);
  assertEq(row.workspace_id, WS, '令牌绑定工作区');
  assertEq(row.client_id.length, 64, 'client_id 截断到 64');
});

await check('guest 缺工作区头 → 40000 + field_errors', async () => {
  await expectApiError(
    () => pick('POST', '/api/v1/auth/guest').handler(makeReq({ method: 'POST', path: '/api/v1/auth/guest' })),
    40000,
    (err) => {
      assertEq(err.detail, '缺少工作区标识');
      assertEq(err.fieldErrors, [{ field: 'X-Workspace-Id', error: '必填' }]);
      assertEq(err.message, '参数校验失败');
    },
  );
});

await check('auth/admin 未配置引导密钥 → 40300', async () => {
  await expectApiError(
    () => pick('POST', '/api/v1/auth/admin').handler(makeReq({ method: 'POST', path: '/api/v1/auth/admin', data: { bootstrap_key: 'x' } })),
    40300,
    (err) => assertEq(err.detail, '管理员准入未开放或引导密钥错误'),
  );
});

let auth = null;
await check('logout 吊销令牌', async () => {
  auth = await resolveToken(store, guestToken);
  auth.ip = '9.9.9.9';
  const res = await pick('POST', '/api/v1/auth/logout').handler(
    makeReq({ method: 'POST', path: '/api/v1/auth/logout', auth }),
  );
  assertEq(res.data, { revoked: true });
  const row = await store.get('tokens', 'token', guestToken);
  assertEq(row.revoked, true);
  await expectApiError(() => resolveToken(store, guestToken), 40100);
});

await check('quota 状态（guest 字段 + session_id 透传）', async () => {
  const [token] = await issueToken(store, 'guest', 'qa', WS);
  const ctx = await resolveToken(store, token);
  ctx.ip = '9.9.9.9';
  await store.insert('quota_counters', { key: 'session:sess-qa-1', used: 3, max_calls: 50 });
  const res = await pick('GET', '/api/v1/quota').handler(
    makeReq({ method: 'GET', path: '/api/v1/quota', auth: ctx, query: { session_id: 'sess-qa-1' } }),
  );
  assertEq(res.data.session_used_calls, 3);
  assertEq(res.data.session_max_calls, 50);
  assertEq(res.data.global_used_calls, 0);
  assertEq(res.data.global_max_calls, 1000);
  assertEq(res.data.mode, 'live');
  assertEq(res.data.guest_used_calls, 0);
  assertEq(res.data.guest_max_calls, 20);
  assertEq(res.data.guest_ip_used_calls, 0);
  assertEq(res.data.guest_ip_max_calls, 60);
});

const config = normalizeConfig(getTemplate('tmpl-office').config);
const instanceId = 'inst-office-check1';
const snapshotId = await freezeSnapshot(store, instanceId, config);
await store.insert('instances', {
  instance_id: instanceId, workspace_id: WS, name: config.name, source_config_id: 'cfg-check',
  clone_source_id: null, diff_from_source: [], status: 'ready', sandbox_key: `sbx:${instanceId}`,
  policy_snapshot_id: snapshotId, config_payload: config, guard_preset: 'standard',
  created_at: iso(utcnow()), expires_at: iso(new Date(utcnow().getTime() + 3600000)),
  last_active_at: iso(utcnow()), stats: {},
});
await store.insert('instances', {
  // 已销毁实例不计入 alive_instances（状态白名单核对）。
  ...(await store.get('instances', 'instance_id', instanceId)),
  instance_id: 'inst-dead-check01', status: 'destroyed',
});
await store.insert('configs', {
  config_id: 'cfg-check-1', workspace_id: WS, name: 'A', version: '1.0', payload: config,
  created_at: iso(utcnow()), updated_at: iso(utcnow()), deleted: false,
});
await store.insert('configs', {
  config_id: 'cfg-check-2', workspace_id: WS, name: 'B', version: '1.0', payload: config,
  created_at: iso(utcnow()), updated_at: iso(utcnow()), deleted: true,
});

await check('workspace 信息', async () => {
  const [token] = await issueToken(store, 'guest', 'ws', WS);
  const ctx = await resolveToken(store, token);
  const res = await pick('GET', '/api/v1/auth/workspace').handler(
    makeReq({ method: 'GET', path: '/api/v1/auth/workspace', auth: ctx }),
  );
  assertEq(res.data.workspace_id, WS);
  assertEq(res.data.is_default, false);
  assert(typeof res.data.created_at === 'string', 'guest 准入时已注册工作区');
  assertEq(res.data.alive_instances, 1);
  assertEq(res.data.configs, 1);
  assert(typeof res.data.server_time === 'string' && res.data.server_time.endsWith('Z'));
});

// ---- templates ----
await check('templates 列表 + 分页', async () => {
  const res = await pick('GET', '/api/v1/templates').handler(makeReq({ method: 'GET', path: '/api/v1/templates', auth }));
  const total = res.data.total;
  assertEq(res.data.page, 1);
  assertEq(res.data.page_size, 20);
  assertEq(res.data.items.length, total);
  assertEq(Object.keys(res.data.items[0]).sort(), ['config', 'description', 'id', 'name', 'risk_note', 'suggested_guard', 'suggested_tools']);
  const p2 = await pick('GET', '/api/v1/templates').handler(
    makeReq({ method: 'GET', path: '/api/v1/templates', auth, query: { page: '2', page_size: '1' } }),
  );
  assertEq(p2.data.page, 2);
  assertEq(p2.data.items.length, 1);
  assertEq(p2.data.items[0].id, res.data.items[1].id);
});

// ---- samples ----
await check('samples 列表（无实例：仅无工具依赖样本可用）', async () => {
  const res = await pick('GET', '/api/v1/samples').handler(
    makeReq({ method: 'GET', path: '/api/v1/samples', auth, query: { page_size: '100' } }),
  );
  assertEq(res.data.categories.jailbreak, '直接越狱');
  assertEq(res.data.items.length, res.data.total);
  assertEq(res.data.items[0].sample_id, 'smpl-jailbreak-01');
  assertEq(res.data.items[1].applicable, true);
  assertEq(res.data.items[2].applicable, false, '不可用样本排在其后');
  assertEq(res.data.items.find((s) => s.sample_id === 'smpl-injection-01').applicable, false);
});

await check('samples 列表（带实例：按启用工具判定适用性 + 越权/不存在 40400）', async () => {
  const res = await pick('GET', '/api/v1/samples').handler(
    makeReq({ method: 'GET', path: '/api/v1/samples', auth, query: { instance_id: instanceId, page_size: '100' } }),
  );
  assertEq(res.data.items.find((s) => s.sample_id === 'smpl-injection-01').applicable, true);
  assertEq(res.data.items[0].applicable, true);
  const cat = await pick('GET', '/api/v1/samples').handler(
    makeReq({ method: 'GET', path: '/api/v1/samples', auth, query: { category: 'chain_hijack' } }),
  );
  assertEq(cat.data.total, 2);
  await expectApiError(
    () => pick('GET', '/api/v1/samples').handler(
      makeReq({ method: 'GET', path: '/api/v1/samples', auth, query: { instance_id: 'inst-missing-0000' } }),
    ),
    40400,
    (err) => assertEq(err.detail, '实例不存在'),
  );
});

const sessionId = newId('sess');
await store.insert('sessions', {
  session_id: sessionId, workspace_id: WS, instance_id: instanceId, status: 'active', turn: 0,
  context_summary: '', call_count: 0, risk_score: 0, last_risk_turn: 0, guard_enabled: true,
  skip_guard_turns: [], policy_snapshot_id: snapshotId, created_at: iso(utcnow()), terminated_at: null,
  max_risk: 'none', block_count: 0, challenge_count: 0, limit_block_count: 0, degrade_count: 0,
  allow_count: 0, mode: 'live', degradations: [],
});
sandboxManager.create(`sbx:${instanceId}`);

const loadRoute = pick('POST', '/api/v1/sessions/:session_id/samples/:sample_id/load');
const loadReq = (sampleId, data) =>
  makeReq({ method: 'POST', path: `/api/v1/sessions/${sessionId}/samples/${sampleId}/load`, params: { session_id: sessionId, sample_id: sampleId }, data, auth });

await check('sample 载入：jailbreak（fast）完整信封', async () => {
  const res = await loadRoute.handler(loadReq('smpl-jailbreak-01', { fast: true }));
  assertEq(res.code, 0);
  assertEq(res.data.sample_id, 'smpl-jailbreak-01');
  assertEq(res.data.setup_turns_executed, 0);
  assertEq(res.data.turn, 1);
  assert(typeof res.data.reply === 'string' && res.data.reply.length > 0, 'reply 非空');
  assert(Array.isArray(res.data.actions) && Array.isArray(res.data.call_ids), 'actions/call_ids 数组');
  assertEq(res.data.mode, 'live');
  assert(['none', 'low', 'medium', 'high'].includes(res.data.max_risk), `max_risk=${res.data.max_risk}`);
});

await check('sample 载入：memory_poisoning 计数 setup_turns=2', async () => {
  const res = await loadRoute.handler(loadReq('smpl-memory-poison-01', { fast: true }));
  assertEq(res.data.setup_turns_executed, 2);
  assertEq(res.data.turn, 4, '铺垫两轮 + 末轮，会话轮次连续递增');
  const rows = await store.rows('turns', [['session_id', 'eq', sessionId]]);
  assertEq(rows.length, 4);
  assertEq(rows[3].source_sample_id, 'smpl-memory-poison-01');
  const events = await store.rows('session_events', [['session_id', 'eq', sessionId]]);
  assert(events.length > 0, '事件已落库');
});

await check('sample 载入错误路径：40400/40900', async () => {
  await expectApiError(() => loadRoute.handler(loadReq('smpl-nope-01', {})), 40400, (e) => assertEq(e.detail, '样本不存在'));
  await expectApiError(
    () => loadRoute.handler(makeReq({ method: 'POST', path: '/x', params: { session_id: 'sess-missing-0', sample_id: 'smpl-jailbreak-01' }, data: {}, auth })),
    40400, (e) => assertEq(e.detail, '会话不存在'),
  );
  const inst2 = 'inst-deadcheck-01';
  await store.insert('instances', {
    ...(await store.get('instances', 'instance_id', instanceId)), instance_id: inst2,
  });
  const session2 = newId('sess');
  await store.insert('sessions', {
    ...(await store.get('sessions', 'session_id', sessionId)), session_id: session2, instance_id: inst2, turn: 0,
  });
  await store.update('sessions', { workspace_id: 'ws-other-worksp' }, [['session_id', 'eq', session2]]);
  await expectApiError(
    () => loadRoute.handler(makeReq({ method: 'POST', path: '/x', params: { session_id: session2, sample_id: 'smpl-jailbreak-01' }, data: {}, auth })),
    40400, (e) => assertEq(e.detail, '会话不存在'),
  );
  await store.update('sessions', { workspace_id: WS }, [['session_id', 'eq', session2]]);
  // chain-01 需要 query_api；tmpl-office 未启用 → 不可用 → 40900（force 才放行）
  await expectApiError(
    () => loadRoute.handler(makeReq({ method: 'POST', path: '/x', params: { session_id: session2, sample_id: 'smpl-chain-01' }, data: {}, auth })),
    40900, (e) => assert(e.detail.includes('query_api'), e.detail),
  );
});

console.log(failures ? `\n${failures} case(s) FAILED` : '\nall cases passed');
process.exit(failures ? 1 : 0);
