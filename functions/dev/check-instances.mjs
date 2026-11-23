// instances 模块本地验证：假数据库 + 真实路由模块，逐路由核对移植语义。
// 运行：node functions/dev/check-instances.mjs
process.env.INSTANCE_MAX = '3';
process.env.INSTANCE_TTL_MINUTES = '60';

const { makeFakeDb } = await import('./fakeDb.mjs');
const { makeStore } = await import('../lib/store.mjs');
const { normalizeConfig } = await import('../lib/policies.mjs');
const { getTemplate } = await import('../data/templates.mjs');
const { ApiError, ROLE_LEVELS, iso, utcnow, parseIso } = await import('../lib/deps.mjs');
const { sandboxManager } = await import('../lib/sandbox.mjs');
const instanceRoutes = (await import('../routes/instances.mjs')).default;

const db = makeFakeDb();
const store = makeStore(db);
const routes = instanceRoutes({ store }).map((r) => ({
  ...r,
  segs: r.path.split('/'),
  keys: r.path.split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1)),
}));

const WORKSPACE = 'ws-check';
const auth = {
  token: 'tk-check',
  role: 'demo',
  client_id: 'check',
  ip: '127.0.0.1',
  workspace: WORKSPACE,
  require(min) {
    if (ROLE_LEVELS[this.role] < ROLE_LEVELS[min]) throw new ApiError(40300, '权限不足');
  },
};

function dispatch(method, path, { data = {}, query = {}, headers = {} } = {}) {
  const url = new URL(`https://site.example/functions/v1/app${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const segments = url.pathname.replace('/functions/v1/app', '').split('/').filter(Boolean);
  let matched = null;
  let pathExists = false;
  for (const r of routes) {
    const rsegs = r.path.split('/').filter(Boolean);
    if (rsegs.length !== segments.length) continue;
    let okm = true;
    const params = {};
    rsegs.forEach((seg, i) => {
      if (!okm) return;
      if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(segments[i]);
      else if (seg !== segments[i]) okm = false;
    });
    if (!okm) continue;
    pathExists = true;
    if (r.method !== method) continue;
    matched = { route: r, params };
    break;
  }
  if (!matched) throw new ApiError(40400, pathExists ? '接口方法不允许' : '接口不存在');
  const request = new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer tk-check',
      'x-workspace-id': WORKSPACE,
      ...headers,
    },
    body: method === 'GET' ? undefined : JSON.stringify(data),
  });
  const req = {
    request,
    siteContext: {},
    method,
    path,
    siteBase: '/functions/v1/app',
    params: matched.params,
    query: Object.fromEntries(url.searchParams),
    queryAll: url.searchParams,
    data,
    body: data,
    auth,
    store,
    services: { store, db },
    header: (name) => request.headers.get(name.toLowerCase()),
  };
  return matched.route.handler(req);
}

let failures = 0;
function report(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const baseConfig = normalizeConfig(structuredClone(getTemplate('tmpl-office').config));
await store.insert('configs', {
  config_id: 'cfg-check-office',
  workspace_id: WORKSPACE,
  name: baseConfig.name,
  version: '2.1',
  payload: structuredClone(baseConfig),
  created_at: iso(utcnow()),
  updated_at: iso(utcnow()),
  deleted: false,
});

// 1) create：config_id 装载 → 冻结快照 + 分配分区 + 实例 ready；同幂等键回放同一响应
const idemHeaders = { 'x-idempotency-key': 'idem-create-1' };
const created = await dispatch('POST', '/api/v1/instances', {
  data: { config_id: 'cfg-check-office', guard_preset: 'strict' },
  headers: idemHeaders,
});
const replay = await dispatch('POST', '/api/v1/instances', {
  data: { config_id: 'cfg-check-office' },
  headers: idemHeaders,
});
const instA = created.data.instance_id;
const rowA = await store.get('instances', 'instance_id', instA);
const snapA1 = await store.get('policy_snapshots', 'snapshot_id', created.data.policy_snapshot_id);
report('create', created.code === 0 && created.data.status === 'ready'
  && created.data.config_version === '2.1'
  && rowA?.status === 'ready' && rowA?.guard_preset === 'strict'
  && rowA?.sandbox_key === `sbx:${instA}` && snapA1?.version === 1
  && sandboxManager.get(rowA?.sandbox_key) != null
  && replay.data?.instance_id === instA,
  `instance=${instA} snapshot=${created.data.policy_snapshot_id} 分区=${sandboxManager.keys().includes(rowA.sandbox_key)}`);

// 2) get：带 config 与 enabled_tools
const got = await dispatch('GET', `/api/v1/instances/${instA}`);
report('get', got.data?.instance_id === instA && got.data?.config?.name === baseConfig.name
  && JSON.stringify(got.data?.enabled_tools) === JSON.stringify(['read_file', 'write_file', 'send_email']));

// 3) list：两个实例、page_size=1 分页、total 为过滤后全量
await sleep(1100); // created_at 秒级精度，保证排序可断言
await dispatch('POST', '/api/v1/instances', {
  data: { config: { ...structuredClone(baseConfig), name: '办公助手副本B', version: '3.0' } },
});
const list = await dispatch('GET', '/api/v1/instances', { query: { page: 1, page_size: 1 } });
report('list', list.data?.total === 2 && list.data?.items?.length === 1
  && list.data?.page === 1 && list.data?.page_size === 1 && list.data.items[0].instance_id !== instA,
  `total=${list.data?.total} first=${list.data?.items?.[0]?.name}`);

// 4) suggestions：确定性模板路径
const sugg = await dispatch('GET', `/api/v1/instances/${instA}/suggestions`);
report('suggestions', Array.isArray(sugg.data?.items) && sugg.data.items.length >= 4
  && sugg.data.simulated === true, `items=${sugg.data?.items?.length}`);

// 5) clone：modified 局部覆盖 → diff_from_source 逐项差异 + 新实例挂 clone_source_id
const cloned = await dispatch('POST', `/api/v1/instances/${instA}/clone`, {
  data: {
    mode: 'modified',
    modified_config: { tools: { read_file: { perm: { allow_paths: ['./docs'], deny_names: ['secret.txt'] } } } },
    diff_note: '收窄读取范围',
  },
});
const instC = cloned.data?.instance_id;
const rowC = await store.get('instances', 'instance_id', instC);
report('clone', cloned.code === 0 && cloned.data.diff_from_source.length > 0
  && cloned.data.diff_note === '收窄读取范围' && rowC?.clone_source_id === instA
  && JSON.stringify(rowC?.diff_from_source) === JSON.stringify(cloned.data.diff_from_source)
  && cloned.data.diff_from_source.some((d) => d.field === 'tools.read_file.perm.allow_paths'),
  `diff=${cloned.data?.diff_from_source?.length} 项 instance=${instC}`);

// 6) policies：返回冻结快照全量策略
const pols = await dispatch('GET', `/api/v1/instances/${instA}/policies`);
const hardRule = pols.data.items.find((p) => p.rule_type === 'tool_existence');
const target = pols.data.items.find((p) => p.rule_type === 'threshold');
report('policies', pols.data?.total === pols.data?.items?.length && pols.data.total > 10
  && hardRule != null && target != null, `total=${pols.data?.total}`);

// 7) override：新版本快照只增不改，实例指针移动；硬规则停用被 40300 拒绝
let forbidden = null;
try {
  await dispatch('PUT', `/api/v1/instances/${instA}/policies/${hardRule.policy_id}`, { data: { enabled: false } });
} catch (err) { forbidden = err; }
const overridden = await dispatch('PUT', `/api/v1/instances/${instA}/policies/${target.policy_id}`, {
  data: { action: 'block', note: '演示：脱敏升级为阻断' },
});
const rowA2 = await store.get('instances', 'instance_id', instA);
const snapA2 = await store.get('policy_snapshots', 'snapshot_id', overridden.data?.policy_snapshot_id);
report('override', forbidden?.code === 40300 && overridden.code === 0
  && snapA2?.version === 2 && rowA2?.policy_snapshot_id === snapA2.snapshot_id
  && snapA2.policies.find((p) => p.policy_id === target.policy_id)?.action === 'block'
  && snapA2.overrides.length === 1 && (await store.get('policy_snapshots', 'snapshot_id', snapA1.snapshot_id)) != null,
  `v1=${snapA1.snapshot_id} v2=${snapA2?.snapshot_id}`);

// 8) policies/snapshot：视图含分层与人工覆盖计数
const view = await dispatch('GET', `/api/v1/instances/${instA}/policies/snapshot`);
report('snapshot-view', view.data?.snapshot_id === rowA2.policy_snapshot_id && view.data?.version === 2
  && view.data?.manual_override_count === 1 && ['L1', 'L2', 'L3'].every((l) => Array.isArray(view.data.levels[l]))
  && view.data.levels.L1.length > 0);

// 9) renew：过期时间按 TTL 顺延（未过期从原到期时间叠加）
const beforeExpiry = parseIso(rowA2.expires_at);
const renewed = await dispatch('POST', `/api/v1/instances/${instA}/renew`);
const rowA3 = await store.get('instances', 'instance_id', instA);
report('renew', renewed.data?.expires_at === rowA3?.expires_at
  && parseIso(renewed.data.expires_at) > new Date(beforeExpiry.getTime() + 59 * 60000),
  `${beforeExpiry.toISOString()} → ${renewed.data?.expires_at}`);

// 10) recycle：confirm 校验 → 实例 destroyed、会话终止、分区销毁
let noConfirm = null;
try {
  await dispatch('POST', `/api/v1/instances/${instA}/recycle`, { data: {} });
} catch (err) { noConfirm = err; }
await store.insert('sessions', {
  session_id: 'sess-check-1', workspace_id: WORKSPACE, instance_id: instA,
  status: 'active', created_at: iso(utcnow()), terminated_at: null,
});
const recycled = await dispatch('POST', `/api/v1/instances/${instA}/recycle`, { data: { confirm: true } });
const rowA4 = await store.get('instances', 'instance_id', instA);
const sessRow = await store.get('sessions', 'session_id', 'sess-check-1');
report('recycle', noConfirm?.code === 40000 && recycled.data?.status === 'destroyed'
  && rowA4?.status === 'destroyed' && sessRow?.status === 'terminated' && sessRow?.terminated_at != null
  && sandboxManager.get(rowA4.sandbox_key) == null,
  `分区残留=${sandboxManager.keys().includes(rowA4.sandbox_key)}`);

// 11) 并发上限：存活=B/C+新建 1 个（A 已销毁不计）→ 第 4 个存活位请求 42902 拒绝
await dispatch('POST', '/api/v1/instances', { data: { config: structuredClone(baseConfig), name: '占位实例D' } });
let capped = null;
try {
  await dispatch('POST', '/api/v1/instances', { data: { config: structuredClone(baseConfig), name: '超限实例E' } });
} catch (err) { capped = err; }
const alive = (await store.rows('instances', [['workspace_id', 'eq', WORKSPACE], ['status', 'in', ['creating', 'pending', 'ready', 'frozen']]])).length;
report('instance-cap', capped?.code === 42902 && capped?.detail === '本工作区存活实例数已达上限 3'
  && alive === 3 && (await store.get('instances', 'instance_id', 'x')) === null,
  `alive=${alive} code=${capped?.code}`);

console.log(failures === 0 ? '\nALL PASS (11 cases)' : `\n${failures} CASE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
