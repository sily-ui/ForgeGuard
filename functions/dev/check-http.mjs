// 经 app.mjs 全链路集成检查：假数据库 + 真实路由模块，按浏览器实际请求形状走一遍 Sites 前缀剥取、
// 鉴权、限流头、SSE、报告 HTML 与分享页。运行：node functions/dev/check-http.mjs
import { makeFakeDb } from './fakeDb.mjs';
import { application } from '../app.mjs';
import { withForceSimulated } from '../lib/quota.mjs';

class BackendError extends Error {}

const db = makeFakeDb();
const handle = application({ db, BackendError });

const WORKSPACE = 'ws-check-http';
const BASE = 'https://demo.qoder.site/functions/v1/app';

let token = '';

async function call(method, path, { body, auth = true, workspace = WORKSPACE, headers = {}, sseToken = false } = {}) {
  const h = { ...headers };
  if (workspace) h['X-Workspace-Id'] = workspace;
  if (auth && token) h.Authorization = `Bearer ${token}`;
  if (auth && token && sseToken) {
    h.Authorization = undefined;
    delete h.Authorization;
  }
  const url = `${BASE}${path}` + (sseToken && token ? `${path.includes('?') ? '&' : '?'}token=${token}` : '');
  const request = new Request(url, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (sseToken && token) request.headers.set('token', token);
  const response = await handle({ request, requestId: `req-${Math.random().toString(36).slice(2, 8)}` });
  const type = response.headers.get('content-type') || '';
  let payload = null;
  if (type.includes('application/json')) payload = await response.json();
  else if (type.includes('text/')) payload = await response.text();
  return { status: response.status, headers: response.headers, type, payload };
}

let failures = 0;
function check(name, condition, extra = '') {
  if (condition) {
    console.log(`ok   ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

// 1. 健康检查（无令牌）
const health = await call('GET', '/api/v1/health', { auth: false, workspace: null });
check('health 200 + simulation', health.status === 200 && health.payload?.data?.simulation === true,
  `db=${health.payload?.data?.db_backend} state=${health.payload?.data?.state_backend}`);
check('health 带限流头', health.headers.get('x-ratelimit-limit') === '240'
  && health.headers.get('x-ratelimit-remaining') !== null
  && Boolean(health.headers.get('x-ratelimit-reset')));
check('health 带安全头', health.headers.get('x-content-type-options') === 'nosniff'
  && health.headers.get('x-frame-options') === 'DENY');

// 2. 未授权访问
const denied = await call('GET', '/api/v1/templates', { auth: false });
check('缺 Bearer → 401/40100', denied.status === 401 && denied.payload?.code === 40100, denied.payload?.message);

// 3. 游客签发
const noWs = await call('POST', '/api/v1/auth/guest', { auth: false, workspace: null, body: {} });
check('缺工作区 → 40000 + field_errors', noWs.status === 400 && noWs.payload?.code === 40000
  && noWs.payload?.field_errors?.[0]?.field === 'X-Workspace-Id');
const guest = await call('POST', '/api/v1/auth/guest', { auth: false, body: { client_id: 'check' } });
token = guest.payload?.data?.token ?? '';
check('游客令牌签发', guest.status === 200 && Boolean(token) && guest.payload?.data?.role === 'guest',
  `mode=${guest.payload?.data?.mode} daily=${guest.payload?.data?.daily_max_calls}`);
const badWs = await call('GET', '/api/v1/templates', { workspace: 'different-workspace' });
check('改头越权 → 403/40300', badWs.status === 403 && badWs.payload?.code === 40300, badWs.payload?.detail);

// 4. 模板与工作区信息
const templates = await call('GET', '/api/v1/templates');
check('模板列表', templates.status === 200 && Array.isArray(templates.payload?.data?.items)
  && templates.payload.data.items.length > 0, `total=${templates.payload?.data?.total}`);
const wsInfo = await call('GET', '/api/v1/auth/workspace');
check('工作区信息', wsInfo.payload?.data?.workspace_id === WORKSPACE && wsInfo.payload?.data?.is_default === false,
  JSON.stringify(wsInfo.payload?.data ?? null));

// 5. 配置 → 实例 → 会话
// 对应 Python create_config(payload: dict = Body(...))：请求体就是 AgentConfig 本身。
const template = templates.payload.data.items[0];
const created = await call('POST', '/api/v1/configs', { body: template.config });
check('创建配置', created.status === 200 && Boolean(created.payload?.data?.config_id),
  created.payload?.detail ?? created.payload?.message);
const instanceRes = await call('POST', '/api/v1/instances', { body: { config_id: created.payload?.data?.config_id } });
const instanceId = instanceRes.payload?.data?.instance_id;
check('创建实例', Boolean(instanceId) && instanceRes.payload?.data?.status === 'ready',
  instanceRes.payload?.detail ?? instanceRes.payload?.message);
const sessionRes = await call('POST', '/api/v1/sessions', { body: { instance_id: instanceId } });
const sessionId = sessionRes.payload?.data?.session_id;
check('创建会话', Boolean(sessionId), sessionRes.payload?.detail ?? sessionRes.payload?.message);

// 6. 一轮业务对话（仿真链路，质询 8s 上限）
const turn = await withForceSimulated('集成检查：快速仿真链路', () =>
  call('POST', `/api/v1/sessions/${sessionId}/messages`, { body: { content: '请读取 ./docs/runbook.md 并总结' } }));
check('对话放行', turn.status === 200 && Array.isArray(turn.payload?.data?.actions)
  && turn.payload.data.actions.every((a) => a === 'allow'),
  `actions=${JSON.stringify(turn.payload?.data?.actions ?? null)}`);
check('回复非空', Boolean(turn.payload?.data?.reply));

// 7. 调用记录 / 事件历史 / SSE 帧
const callsRes = await call('GET', `/api/v1/sessions/${sessionId}/calls`);
check('调用记录', callsRes.payload?.data?.total >= 1, `total=${callsRes.payload?.data?.total}`);
const events = await call('GET', `/api/v1/sessions/${sessionId}/events?follow=false`);
// 若返回的不是 event-stream，说明被信封化了，把 JSON 原样打印便于定位。
const sseFrames = (res) => {
  if (typeof res.payload !== 'string') {
    console.log(`     非 SSE 响应：status=${res.status} type=${res.type} body=${JSON.stringify(res.payload)}`);
    return [];
  }
  return res.payload.split('\n\n').filter((f) => f.startsWith('id: '));
};
const frames = sseFrames(events);
check('SSE 历史帧', events.status === 200 && events.type.includes('text/event-stream') && frames.length > 0,
  `frames=${frames.length}`);
const sseQuery = await call('GET', `/api/v1/sessions/${sessionId}/events?follow=false`, { sseToken: true });
check('SSE 支持 ?token=', sseQuery.status === 200, `frames=${sseFrames(sseQuery).length}`);
const resume = await call('GET', `/api/v1/sessions/${sessionId}/events?follow=false&last_event_id=1`);
check('SSE Last-Event-ID 续读', resume.status === 200
  && sseFrames(resume).length === frames.length - 1,
  `frames=${sseFrames(resume).length}`);

// 8. 报告与分享页
const reportRes = await call('POST', `/api/v1/sessions/${sessionId}/report`);
const reportId = reportRes.payload?.data?.report_id;
check('生成报告', Boolean(reportId), reportRes.payload?.detail ?? reportRes.payload?.message);
const listRes = await call('GET', '/api/v1/reports');
check('报告列表无 content', listRes.payload?.data?.items?.[0]?.content === undefined
  && listRes.payload?.data?.total >= 1);
const oneRes = await call('GET', `/api/v1/reports/${reportId}`);
check('报告详情含六部分', Boolean(oneRes.payload?.data?.content?.part1_overview)
  && Array.isArray(oneRes.payload?.data?.content?.part3_attack_sequence));
const viewRes = await call('GET', `/api/v1/reports/${reportId}/view`);
check('报告 HTML + ETag', viewRes.status === 200 && viewRes.type.includes('text/html')
  && Boolean(viewRes.headers.get('etag')));
const view304 = await call('GET', `/api/v1/reports/${reportId}/view`, { headers: { 'If-None-Match': viewRes.headers.get('etag') || '' } });
check('报告 ETag 协商 → 304', view304.status === 304);
const shareRes = await call('POST', `/api/v1/reports/${reportId}/share-link`, { body: { ttl_hours: 72 } });
const shareUrl = shareRes.payload?.data?.share_url;
check('分享链接带函数前缀', typeof shareUrl === 'string' && shareUrl.startsWith('/functions/v1/app/share/reports/'), shareUrl);
const shareGet = await call('GET', shareUrl.replace('/functions/v1/app', ''), { auth: false, workspace: null });
check('分享页免鉴权可读', shareGet.status === 200 && shareGet.type.includes('text/html')
  && (shareGet.payload || '').includes('越界'), `bytes=${(shareGet.payload || '').length}`);
const expiredShare = await call('GET', '/share/reports/not-a-token', { auth: false, workspace: null });
check('无效分享 → 40400', expiredShare.status === 404 && expiredShare.payload?.code === 40400);

// 9. 已按方案移除的服务端 PDF
const pdf = await call('GET', `/api/v1/reports/${reportId}/export.pdf`);
check('export.pdf 已移除 → 40400', pdf.status === 404 && pdf.payload?.code === 40400);

// 10. 未知路径与非法工作区
check('未知路径 → 40400', (await call('GET', '/api/v1/nope')).payload?.code === 40400);
// 已绑定工作区的令牌只比一致性（Python _apply_workspace：不一致一律 40300，不做格式校验）；
// 格式校验发生在未绑定令牌的匿名路径上。
const boundBadWs = await call('GET', '/api/v1/templates', { workspace: 'x' });
check('改头（非法格式）仍按不一致 → 40300', boundBadWs.status === 403 && boundBadWs.payload?.code === 40300);
const badWsHeader = await call('POST', '/api/v1/auth/guest', { auth: false, workspace: 'x', body: {} });
check('非法工作区 → 40000', badWsHeader.status === 400 && badWsHeader.payload?.code === 40000);

// 11. 登出后令牌失效
const logout = await call('POST', '/api/v1/auth/logout', { body: {} });
check('登出', logout.payload?.data?.revoked === true);
check('登出后 401', (await call('GET', '/api/v1/templates')).status === 401);

console.log(failures ? `\nFAILURES=${failures}` : '\nALL HTTP INTEGRATION CASES PASSED');
process.exit(failures ? 1 : 0);
