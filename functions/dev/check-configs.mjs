// configs 模块本地验证：假数据库 + 真实 store/路由表，逐条走 create→get→update→validate→preview
// →suggest-prompt→import→export→list→delete。运行：node functions/dev/check-configs.mjs
import { makeFakeDb } from './fakeDb.mjs';
import { makeStore } from '../lib/store.mjs';
import { ApiError } from '../lib/deps.mjs';
import configsRoutes from '../routes/configs.mjs';

const WS = 'ws-check';
const TOKEN = 'fgw_checkcheckcheckcheckcheckcheck000000';

const db = makeFakeDb({
  workspaces: [{ workspace_id: WS, created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z' }],
  tokens: [{
    token: TOKEN, role: 'demo', client_id: 'check', workspace_id: WS,
    expires_at: 4102444800, revoked: false,
  }],
});
const store = makeStore(db);
const routes = configsRoutes({ store, db }).map((r) => {
  const keys = [];
  const src = r.path.split('/').map((seg) => {
    if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { ...r, regex: new RegExp(`^${src}/?$`), keys };
});

let failures = 0;
function report(name, pass, info) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`);
  if (!pass) failures += 1;
}

function authContext(workspace) {
  return {
    token: TOKEN, role: 'demo', client_id: 'check', ip: '127.0.0.1', workspace,
    require(min) { void min; },
  };
}

// 复刻 app.mjs 的 req 组装：匹配路径段 → 解析 JSON 体 → 交给 handler。
async function call(method, path, body = null, { workspace = WS } = {}) {
  const url = new URL(`http://localhost/functions/v1/app${path}`);
  const pathname = url.pathname.slice('/functions/v1/app'.length) || '/';
  let matched = null;
  let pathExists = false;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    pathExists = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    matched = { route: r, params };
    break;
  }
  if (!pathExists) throw new ApiError(40400, '接口不存在');
  if (!matched) throw new ApiError(40400, '接口方法不允许');
  const data = body === null || body === undefined ? {} : body;
  const req = {
    request: new Request(url.toString(), {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'x-workspace-id': workspace, 'content-type': 'application/json' },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(data),
    }),
    siteContext: {},
    method,
    path: pathname,
    siteBase: '/functions/v1/app',
    params: matched.params,
    query: Object.fromEntries(url.searchParams),
    queryAll: url.searchParams,
    data,
    body: data,
    auth: authContext(workspace),
    store,
    services: { store, db },
  };
  return matched.route.handler(req);
}

async function run(name, fn) {
  try {
    const info = await fn();
    report(name, true, info);
  } catch (err) {
    if (err instanceof ApiError) {
      report(name, false, `意外抛出 ${err.code} ${err.detail ?? ''} ${JSON.stringify(err.fieldErrors ?? null)}`);
    } else {
      report(name, false, `异常 ${err?.stack ?? err}`);
    }
  }
}

async function expectError(name, code, fn, extra) {
  let verdict = null;
  let info = '';
  try {
    await fn();
    verdict = false;
    info = '未抛错';
  } catch (err) {
    if (!(err instanceof ApiError)) {
      verdict = false;
      info = `非 ApiError：${err?.stack ?? err}`;
    } else {
      let detailOk = true;
      try {
        if (extra) extra(err);
      } catch (assertErr) {
        detailOk = false;
        info += `断言不符：${assertErr.message}；`;
      }
      verdict = err.code === code && detailOk;
      info += `${err.code} ${err.detail ?? ''}${err.fieldErrors ? ` field_errors=${JSON.stringify(err.fieldErrors)}` : ''}`;
    }
  }
  report(name, verdict, info);
}

const validConfig = () => ({
  name: '通用办公助手',
  purpose: '读取办公文档、撰写摘要并按需通知同事',
  system_prompt: '你是通用办公助手，只读取 ./docs 与 ./report，写入仅限 ./tmp。',
  tools: {
    read_file: { enabled: true, perm: { allow_paths: ['docs/'], deny_names: ['secret.txt'] } },
    send_email: { enabled: true, perm: { allow_domains: ['example.com'], max_recipients: 3 } },
  },
  limits: { max_calls_per_turn: 5, max_calls_per_session: 60, timeout_ms: 15000 },
  guard: { preset: 'standard' },
});

const versionsOf = (id) => store.rows('config_versions', [['config_id', 'eq', id]], { order: 'id', desc: false });
const expectDetail = (detail) => (err) => {
  if (err.detail !== detail) throw new Error(`detail 期望「${detail}」实际「${err.detail}」`);
};

let importedId = null;
let configId = null;

await run('create 合法配置', async () => {
  const r = await call('POST', '/api/v1/configs', validConfig());
  configId = r.data.config_id;
  const row = await store.get('configs', 'config_id', configId);
  const versions = await versionsOf(configId);
  const payloadKeys = Object.keys(row.payload).join(',');
  if (r.code !== 0 || row.version !== '1.0' || versions.length !== 1 || versions[0].version !== '1.0') {
    throw new Error(`信封或首版不符：${JSON.stringify(r.data)}`);
  }
  if (payloadKeys.includes('_unknown_tools')) throw new Error('落库 payload 残留 _unknown_tools');
  return `config_id=${configId} version=${r.data.version} payload_keys=${payloadKeys} versions=${versions.length}`;
});

await run('get 配置详情', async () => {
  const r = await call('GET', `/api/v1/configs/${configId}`);
  const d = r.data;
  if (d.config_id !== configId || d.version !== '1.0' || d.name !== '通用办公助手' || d.tools.read_file.perm.allow_paths[0] !== './docs') {
    throw new Error(`详情不符：${JSON.stringify(d).slice(0, 200)}`);
  }
  return `name=${d.name} allow_paths=${JSON.stringify(d.tools.read_file.perm.allow_paths)}`;
});

await run('update 版本 +0.1 并追加版本行', async () => {
  const next = validConfig();
  next.system_prompt = '更新后的系统提示词，仍只允许读取 ./docs。';
  const r = await call('PUT', `/api/v1/configs/${configId}`, next);
  const versions = await versionsOf(configId);
  const row = await store.get('configs', 'config_id', configId);
  if (r.data.version !== '1.1' || versions.length !== 2 || versions[1].version !== '1.1' || row.name !== next.name) {
    throw new Error(`版本推进不符：${r.data.version} / versions=${versions.length}`);
  }
  return `version=${r.data.version} versions=${versions.map((v) => v.version).join('>')}`;
});

await run('validate 非法配置（信封仍 code=0）', async () => {
  const bad = validConfig();
  bad.name = '';
  bad.system_prompt = '';
  const r = await call('POST', '/api/v1/configs/validate', bad);
  const fields = r.data.errors.map((e) => e.field).join(',');
  if (r.code !== 0 || r.data.valid !== false || fields !== 'name,system_prompt') {
    throw new Error(`结构不符：${JSON.stringify(r.data)}`);
  }
  return `valid=${r.data.valid} fields=${fields}`;
});

await expectError('create 非法配置 → 40000 + field_errors', 40000, async () => {
  const bad = validConfig();
  bad.name = '';
  bad.system_prompt = '';
  await call('POST', '/api/v1/configs', bad);
}, (err) => {
  if (err.detail !== '实例名称不能为空；系统提示词不能为空') throw new Error(`detail 不符：${err.detail}`);
  const fe = JSON.stringify(err.fieldErrors);
  if (fe !== '[{"field":"name","error":"实例名称不能为空"},{"field":"system_prompt","error":"系统提示词不能为空"}]') {
    throw new Error(`field_errors 不符：${fe}`);
  }
});

await expectError('update 冲突项 → 40001', 40001, async () => {
  const bad = validConfig();
  bad.limits = { max_calls_per_turn: 10, max_calls_per_session: 5, timeout_ms: 15000 };
  await call('PUT', `/api/v1/configs/${configId}`, bad);
}, (err) => {
  if (err.detail !== '会话调用上限不得小于单轮调用上限') throw new Error(`detail 不符：${err.detail}`);
});

await run('validate 合法配置（信封 data 原样）', async () => {
  const r = await call('POST', '/api/v1/configs/validate', validConfig());
  if (r.data.valid !== true || !Array.isArray(r.data.errors) || !Array.isArray(r.data.warnings)) {
    throw new Error(`结构不符：${JSON.stringify(r.data)}`);
  }
  return `valid=${r.data.valid} warnings=${r.data.warnings.length}`;
});

await run('preview 策略条目', async () => {
  const r = await call('POST', '/api/v1/configs/preview', validConfig());
  const p = r.data.policies;
  if (p[0].policy_id !== 'pol-preview-01' || r.data.llm_cost_estimate.l3 !== 1 || r.data.validation.valid !== true) {
    throw new Error(`预览不符：${JSON.stringify(p?.[0])}`);
  }
  return `policies=${p.length} first=${p[0].policy_id} cost=${JSON.stringify(r.data.llm_cost_estimate)}`;
});

await run('suggest-prompt 确定性回退', async () => {
  const r = await call('POST', '/api/v1/configs/suggest-prompt', { name: '运维审计助手', purpose: '读取周报' });
  if (r.data.simulated !== true || !r.data.system_prompt.startsWith('你是运维审计助手，职责：读取周报。')) {
    throw new Error(`提示词不符：${JSON.stringify(r.data)}`);
  }
  return `simulated=${r.data.simulated} len=${r.data.system_prompt.length}`;
});

await expectError('suggest-prompt 空入参 → 40000', 40000, async () => {
  await call('POST', '/api/v1/configs/suggest-prompt', { name: '  ', purpose: '' });
}, expectDetail('请先填写实例名称或声明用途'));

await run('import 保留外部 version', async () => {
  const payload = validConfig();
  payload.name = '导入的助手';
  payload.version = '2.0';
  const r = await call('POST', '/api/v1/configs/import', { config: payload });
  const row = await store.get('configs', 'config_id', r.data.config_id);
  const versions = await versionsOf(r.data.config_id);
  if (r.data.version !== '2.0' || row.version !== '2.0' || versions[0].version !== '2.0' || r.data.validation.valid !== true) {
    throw new Error(`导入不符：${JSON.stringify(r.data)}`);
  }
  importedId = r.data.config_id;
  return `config_id=${r.data.config_id} version=${r.data.version} validation.valid=${r.data.validation.valid}`;
});

await run('export 配置', async () => {
  const r = await call('GET', `/api/v1/configs/${configId}/export`);
  const row = await store.get('configs', 'config_id', configId);
  if (r.data.version !== row.version || r.data.name !== row.name || r.data._unknown_tools !== undefined) {
    throw new Error(`导出不符：${JSON.stringify(r.data).slice(0, 160)}`);
  }
  return `version=${r.data.version} keys=${Object.keys(r.data).join(',')}`;
});

await expectError('import 非法（config:null）→ 40000', 40000, async () => {
  await call('POST', '/api/v1/configs/import', { config: null });
});

await run('list 分页（page=2&page_size=2，created_at desc）', async () => {
  // 独立工作区播种 5 行，避免与上面 create/import 的行混在一起影响 total。
  for (let i = 1; i <= 5; i++) {
    const ts = `2026-02-0${i}T00:00:00Z`;
    await store.insert('configs', {
      config_id: `cfg-page${i}`, workspace_id: 'ws-page', name: `分页助手${i}`, version: '1.0',
      payload: { name: `分页助手${i}` }, created_at: ts, updated_at: ts, deleted: false,
    });
  }
  const r = await call('GET', '/api/v1/configs?page=2&page_size=2', null, { workspace: 'ws-page' });
  const ids = r.data.items.map((x) => x.config_id);
  if (r.data.total !== 5 || r.data.page !== 2 || r.data.page_size !== 2 || ids.join(',') !== 'cfg-page3,cfg-page2') {
    throw new Error(`分页不符：${JSON.stringify(r.data)}`);
  }
  return `total=${r.data.total} page=${r.data.page}/${r.data.page_size} items=${ids.join(',')}`;
});

await run('delete 软删除', async () => {
  const r = await call('DELETE', `/api/v1/configs/${configId}`);
  const row = await store.get('configs', 'config_id', configId);
  if (r.data.deleted !== true || row.deleted !== true || (await versionsOf(configId)).length !== 2) {
    throw new Error('删除后状态不符');
  }
  return `deleted=${r.data.deleted} 行仍在库=${row !== null} versions=${(await versionsOf(configId)).length}`;
});

await expectError('get 已删除配置 → 40400', 40400, async () => {
  await call('GET', `/api/v1/configs/${configId}`);
}, expectDetail('配置不存在'));

await expectError('跨工作区访问 → 40400', 40400, async () => {
  await call('GET', `/api/v1/configs/${importedId}`, null, { workspace: 'ws-other' });
});

await expectError('update 未知配置 → 40400', 40400, async () => {
  await call('PUT', '/api/v1/configs/cfg-missing000', validConfig());
});

if (failures > 0) {
  console.log(`\nconfigs 校验失败：${failures} 项`);
  process.exit(1);
}
console.log('\nconfigs 校验全部通过');
