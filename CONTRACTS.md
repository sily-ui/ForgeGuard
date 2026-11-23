# BeforeBound → Deno Function 移植契约（所有模块必须遵守）

目标：把 backend/app（FastAPI+SQLAlchemy+langgraph+reportlab+redis）移植为 Qoder Sites Edge Function。
运行时：Deno（`functions/index.ts` 用 `Deno.serve`），浏览器经 `/functions/v1/app/<路径>` 访问。
数据层：Sites 平台 database（Supabase 风格 SDK，schema `app`，表名同 SQLAlchemy `__tablename__`）。

## 已确认裁剪方案
- 真实 LLM：已接回。`functions/lib/llm.mjs` 对应 internal/llm/proxy.py（OpenAI 兼容 chat/completions、主模型→备用档位、30s 超时、真实调用才扣配额、流式增量）。凭据走平台 Secret：仅 MODEL_API_KEY 与 FALLBACK_MODEL_API_KEY 由站点 Settings 录入；MODEL_BASE_URL/MODEL_NAME/GUARDIAN_MODEL_NAME/FALLBACK_MODEL_BASE_URL/FALLBACK_MODEL_NAME 在 `deps.mjs` 内置与本机 .env 一致的默认值（可被同名环境变量覆盖）；缺失或强制仿真时沿用确定性仿真（`simulated.mjs`，simulated=true 恒不扣费）。
- reportlab PDF → 不实现 `/reports/{id}/export.pdf`：该路由整体不移植（访问即 40400 信封），PDF 由前端浏览器排版生成（已确认方案B）。`/reports/{id}/view` 与 `/share/reports/{token}` 的 HTML 保留（report.mjs 的 renderHtml）。
- redis → 移除。限流=进程内存滑动窗口（与 Python 内存回退一致）；幂等/配额/事件走 database 表；质询/任务/沙盒分区=进程内存 Map（单实例假设，重启丢失可接受，演示平台）。

## 目录（全部在 functions/ 内，相对导入必须带扩展名）
```
functions/index.ts            入口（_qoder/backend.mjs 注入；勿打包 dev/fixture）
functions/app.mjs             路由分发 + 中间件（限流头、envelope 错误边界）
functions/lib/deps.mjs        ApiError、错误码→HTTP、ok()/paginate()、iso/utcnow、new_id/rand_suffix/instance_prefix
functions/lib/store.mjs       表访问（见下）
functions/lib/security.mjs    tokens 签发/校验、AuthContext、RateLimiter（内存）、roles
functions/lib/quota.mjs       quota_counters/platform_state 模式与配额（CAS 语义）
functions/lib/idempotency.mjs idempotency_keys 表
functions/lib/events.mjs      EventBus（内存 per-session deque+subscribers；同时写 session_events 表供跨进程/重启续读）
functions/lib/state.mjs       质询 Future Map、红队任务 Map、session 互斥锁 Map、challenge_memory、degradations
functions/lib/simulated.mjs   业务/监护/红队仿真（LLM 替代）
functions/lib/guard.mjs       L1/L2/L3 + resolve_action + risk accumulate（judge 流水线）
functions/lib/mirror.mjs      build_mirror_request
functions/lib/policies.mjs    normalize/validate config + generate_policies + apply_overrides + baseline_summary + index_rules + preset_params + diff_configs
functions/lib/snapshot.mjs    freeze_snapshot/get_snapshot/apply_policy_override/snapshot_view（用 store）
functions/lib/sandbox.mjs     presets+Partition+Manager+tools+invoke+new_call_id+mask_fields
functions/lib/agent.mjs       ReasonContext + build_business_graph 等价循环（reason→execute_tool→...）
functions/lib/runner.mjs      process_message / replay_for_session / record_session / renew_if_stable
functions/lib/redteam.mjs     run_redteam 循环
functions/lib/suggestions.mjs 推荐生成（缓存 platform_state suggestions:{iid}）
functions/lib/report.mjs      builder(六部分 content)+hardening+rootcause+render_html
functions/data/samples.mjs    SAMPLES + CATEGORY_NAMES + get_sample + sample_view + applicable
functions/data/templates.mjs  TEMPLATES
functions/data/builtin.mjs    builtin_recording()
functions/routes/{auth,templates,configs,instances,sessions,samples,experiments,reports,admin}.mjs
```

## 依赖注入形态（本地可测）
`app.mjs` 导出 `application({ db, BackendError }) => handler`。
`index.ts`:
```ts
import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from './_qoder/backend.mjs';
import { application } from './app.mjs';
const handle = application({ db: createDatabaseClient(), BackendError });
Deno.serve(async (request) => {
  let context;
  try { context = createSiteContext(request); return await handle(context); }
  catch (error) { return errorResponse(error, context?.requestId); }
});
```
路由内所有数据库访问只经 `store.mjs`；store 以 `db.from(table)` 链式 SDK 实现：
select('a,b').eq/in/gte/lte/ilike/or/order(col,{ascending}).range(from,to).limit(n).single()/maybeSingle()、
insert(row|rows)、update(obj).eq(...)、delete().eq(...)、select('*', {count:'exact'})。
查询结果一律 `{data, error}`；error 存在时 throw 内部 `dbError`。禁止 `.rpc()`、裸 SQL、`upsert` 除非必要（用 CAS 替代读-改-写）。

## HTTP 契约（与现前端逐字段一致，勿改）
- 成功：`Response.json({code:0,message:'ok',data}, {status:200})`；分页 data={items,total,page,page_size}。
- 业务错误（lib/deps.mjs ApiError）：`{code,message(默认中文同 errors.py),data:null,detail?,field_errors?}`，HTTP 状态映射：
  40000→400 40001→400 40100→401 40300→403 40400→404 40900→409 42200→422 42900→429(+Retry-After) 42901→429 42902→429 50000→500 50300→503 50301→503。
- 路径：入口剥离 `/functions/v1/` + 函数段（`app` 或 `app-d[0-9a-f]{32}`）后得业务路径，如 `/api/v1/sessions`、`/share/reports/{token}`。
- 鉴权：业务不透明令牌由自定义头 `X-BeforeBound-Token` 携带（私有站点的平台网关会占用 Authorization 放自己的身份凭证；SSE 亦支持 `?token=`），Authorization: Bearer 保留兼容本地直连；`X-Workspace-Id` 正则 `^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$`，缺省 `default`。auth/guest 必须显式携带该头（否则 40000）。
- 每个响应加 `X-RateLimit-Limit/Remaining/Reset`（GENERAL 240/min 按 ip 或 token key）。
- 角色序：guest<judge<demo<admin；admin 路由 `ctx.require('admin')`。
- ADMIN_BOOTSTRAP_KEY：读 `Deno.env.get('ADMIN_BOOTSTRAP_KEY')`，默认空串＝管理员准入关闭（同 Python `config.py`），此时 `/auth/admin` 返回 40300；演示入口走 `/auth/guest`。

## 事件/SSE（sessions/{id}/events）
- 总线：内存 Map<session_id,{seq,history(deque≤2000),subscribers:Set<queue>}>；publish 同时 append 到 `session_events` 表（session_id,seq,event,data jsonb,created_at）。
- SSE：`text/event-stream`；帧 `id: {seq}\nevent: {name}\ndata: {json}\n\n`；Last-Event-ID/last_event_id 先补历史（内存缺失则读表），follow=false 仅历史；limit 截断；15s keepalive `: keepalive\n\n`；头 Cache-Control: no-cache。
- 事件名与 payload 字段必须与 backend internal/events 发布点一致：session.status, agent.message.start, agent.delta, agent.message, tool.call, guard.judgement, chain.update, alert.created, redteam.step。

## 数据表（schema app；json 列用 jsonb，其余 text/int/float/bool；时间戳沿用 ISO "…Z" 字符串）
tokens, platform_state, quota_counters, idempotency_keys, workspaces, configs, config_versions,
instances, policy_snapshots, sessions, turns, call_records, alerts, reports, experiments,
snapshot_recordings, cleanup_logs + 新增 session_events(seq bigint per session)。
主键同 db.py（token/key/config_id/instance_id/snapshot_id/session_id/turn id bigserial/call_id/alert_id/report_id/pair_id/snapshot_id(rec)/id serial/events jsonb）。
turns.id、config_versions.id、cleanup_logs.id 用 bigint generated always as identity。
samples/templates 不入库（内存常量）；builtin demo 快照 seed 进 snapshot_recordings（snapshot_id='snap-builtin-demo'）。

## 编排语义（runner 移植要点）
- process_message 全程持 `state.sessionLock(session_id)`（进程内 Promise 链互斥）。
- mode=replay 时走 replay_for_session（_active_recording：mode_meta.snapshot_id → 本工作区最新 → builtin）。
- 限额 decision kind=limit → gray；block=red；degrade=yellow；challenge 裁决后=orange；否则 green。
- 质询：simulated 恒 SIM_CHALLENGE_TIMEOUT=8s 超时保守拒绝；resolve POST /sessions/{id}/challenges/{call_id} 唤醒内存 Promise。
- risk accumulate/衰减/阈值 6.0、session_level 告警每会话一次。
- reply 追加仿真留痕后缀逻辑同 runner L531-538。
- call_records/judgement 等 JSON 字段名与 Python dict 完全一致（前端逐字段消费）。

## 路由模块契约（functions/routes/*.mjs，app.mjs 已按此实现分发）
每个模块 `export default function (services) { return [routeObj, ...]; }`，`services = { store, db, eventBus, runtime, BackendError }`。
routeObj：
```js
{
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: '/api/v1/sessions/:session_id/messages',  // 原始 FastAPI 路径；参数段用 :name；分享页写 '/share/reports/:share_token'
  auth: 'required' | 'none' | 'sse',              // 默认 required；'none' 不鉴权（auth/guest、auth/admin）；'sse' 走 get_sse_auth
  handler: async (req) => envelope | Response,
}
```
`req`：`{ request, siteContext, method, path, siteBase, params, query, queryAll, data, body, auth, store, services, header(name) }`
- `data`/`body`：已解析的 JSON 对象（GET/DELETE 为 `{}`；空体为 `{}`；非法 JSON 由 app.mjs 抛 40000）。`query` 取首值，重复参数用 `queryAll.getAll(name)`。
- `auth`：`AuthContext`（`{ token, role, client_id, ip, workspace, require(minRole) }`）；`auth` 为 `'none'` 时是 `null`。
- 返回值：直接返回 Python 那样的完整信封对象 `{code:0,message:'ok',data}` → app.mjs 以 200 + json 发出；需要自定义状态/二进制/流时返回 `Response`（原样透传，app.mjs 只补公共头）。
- 抛错：`throw new ApiError(code, detail, fieldErrors, message, headers)`；HTTP 状态与信封由 app.mjs 统一映射。
- 站点前缀：构造给浏览器的 URL（如 share_url）用 `${req.siteBase}/share/reports/${token}`，`siteBase` 形如 `/functions/v1/app`。
- 公共响应头（限流三元组、X-Frame-Options 等）由 app.mjs 补齐，路由内不要重复设置；仅 `Retry-After` 之类的 ApiError.headers 例外。
- 需要额外限流时用 `lib/middleware.mjs` 的 `heavyCheck(req.request, req.siteContext, kind)` / `authLimitCheck(...)`（对应 Python `heavy_check` / `rate_limiter.check('auth:'+ip, AUTH_LIMIT)`）；工作区解析用 `resolveWorkspace(req.store, req.request)`。
- SSE 用 `lib/http.mjs` 的 `sseResponse({ sessionId, lastId, limit, follow, signal: req.request.signal })`；HTML/PDF 类资产缓存用 `cachedAsset({ request, content, mediaType, version, extraHeaders })`。

## 编码约定
- 纯 ESM、无第三方 import（Deno 内置 + 相对文件）；不 import `_qoder/*`（仅 index.ts）。
- 不写注释以外的中文 UI 文案改动；字符串消息与 Python 原消息逐字一致（前端断言/展示依赖）。
- 每文件顶部不加 license；保持紧凑风格。
