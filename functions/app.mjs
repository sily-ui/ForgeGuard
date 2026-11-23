// 对应 backend/app/main.py 的路由挂载与响应中间件：剥 Sites 前缀 → 匹配原始路径 → 鉴权限流 → 信封响应。
import { ApiError, GENERAL_LIMIT, errorResponse, settings } from './lib/deps.mjs';
import { getMode } from './lib/quota.mjs';
import { makeStore } from './lib/store.mjs';
import { rateLimiter } from './lib/security.mjs';
import { authenticate, authenticateSse, clientIp } from './lib/middleware.mjs';
import { eventBus } from './lib/events.mjs';
import { runtime } from './lib/state.mjs';
import { pruneCache } from './lib/suggestions.mjs';

import authRoutes from './routes/auth.mjs';
import templatesRoutes from './routes/templates.mjs';
import configsRoutes from './routes/configs.mjs';
import instancesRoutes from './routes/instances.mjs';
import sessionsRoutes from './routes/sessions.mjs';
import samplesRoutes from './routes/samples.mjs';
import experimentsRoutes from './routes/experiments.mjs';
import reportsRoutes from './routes/reports.mjs';
import adminRoutes from './routes/admin.mjs';

function compile(pattern) {
  const keys = [];
  const src = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${src}/?$`) , keys };
}

function healthRoute(services) {
  // 对应 main.py 的 @app.get("/api/v1/health")：运行态如实上报（模式取库、模型配置取 env）。
  const compiled = compile('/api/v1/health');
  return {
    method: 'GET',
    path: '/api/v1/health',
    authMode: 'none',
    regex: compiled.regex,
    keys: [],
    handler: async (req) => ({
      code: 0,
      message: 'ok',
      data: {
        status: 'ok',
        mode: await getMode(req.store ?? services.store),
        model_configured: settings.modelConfigured,
        state_backend: runtime.stateBackend,
        db_backend: 'sites-database',
        rate_limit_backend: 'memory',
        simulation: true,
        guest_daily_quota: settings.quotaGuestDaily,
      },
    }),
  };
}

function buildTable(services) {
  const modules = [
    authRoutes, templatesRoutes, configsRoutes, instancesRoutes,
    sessionsRoutes, samplesRoutes, experimentsRoutes, reportsRoutes, adminRoutes,
  ];
  const routes = [healthRoute(services)];
  for (const mod of modules) {
    for (const r of mod(services)) {
      const path = r.path.startsWith('/') ? r.path : `/${r.path}`;
      const compiled = compile(path);
      routes.push({ ...r, path, regex: compiled.regex, keys: compiled.keys, authMode: r.auth ?? 'required' });
    }
  }
  return routes;
}

function matchRoute(routes, method, pathname) {
  let pathExists = false;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    pathExists = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => {
      try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; }
    });
    return [r, params];
  }
  if (pathExists) throw new ApiError(40400, '接口方法不允许');
  throw new ApiError(40400, '接口不存在');
}

async function readBody(request, method) {
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return {};
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(40000, '请求参数不符合接口契约', [{ field: 'body', error: '期望 JSON 对象' }]);
    }
    return parsed;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(40000, '请求参数不符合接口契约', [{ field: 'body', error: 'JSON 解析失败' }]);
  }
}

// 对应 main.py 的 security_headers + rate_limit_headers：Sites 侧只能在建响应时一次性补齐。
function withCommonHeaders(response, request, siteContext) {
  const headers = new Headers(response.headers);
  const [remaining, reset] = rateLimiter.remaining(`ip:${clientIp(request, siteContext)}`, GENERAL_LIMIT);
  headers.set('x-ratelimit-limit', String(GENERAL_LIMIT));
  headers.set('x-ratelimit-remaining', String(remaining));
  headers.set('x-ratelimit-reset', String(reset));
  const defaults = [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['permissions-policy', 'geolocation=(), microphone=(), camera=()'],
    ['content-security-policy', "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"],
  ];
  for (const [name, value] of defaults) if (!headers.has(name)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

export function application({ db, BackendError }) {
  const store = makeStore(db);
  eventBus.bindStore(store);
  const services = { store, db, BackendError, eventBus, runtime };
  const routes = buildTable(services);
  // 对应 lifespan 启动收口：清理孤儿推荐缓存。不阻塞首个请求，失败静默。
  void pruneCache(store).catch(() => {});

  return async function handle(ctx) {
    const request = ctx.request;
    const url = new URL(request.url);
    // Gateway 保留后缀但把 app 换成部署的物理 Function 名，故站点前缀需从请求路径原样取回。
    const match = url.pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(?=\/|$)/);
    const siteBase = match ? match[0] : '';
    const pathname = siteBase ? url.pathname.slice(siteBase.length) || '/' : url.pathname;
    const method = request.method.toUpperCase();

    let response;
    try {
      const [route, params] = matchRoute(routes, method, pathname);
      const auth = route.authMode === 'none'
        ? null
        : route.authMode === 'sse'
          ? await authenticateSse(store, request, ctx)
          : await authenticate(store, request, ctx);
      const data = await readBody(request, method);
      const queryAll = url.searchParams;
      const req = {
        request,
        siteContext: ctx,
        method,
        path: pathname,
        siteBase,
        params,
        auth,
        store,
        services,
        query: Object.fromEntries(queryAll),
        queryAll,
        data,
        body: data,
        header: (name) => request.headers.get(name.toLowerCase()),
      };
      const result = await route.handler(req);
      if (result instanceof Response) response = result;
      else if (result == null) response = new Response(null, { status: 204 });
      else response = new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        response = errorResponse(err);
      } else {
        const hint = err && (err.code || err.message) ? `${err.code ?? ''} ${err.message ?? ''}`.trim() : '';
        response = errorResponse(new ApiError(50000, hint || null));
      }
    }
    return withCommonHeaders(response, request, ctx);
  };
}
