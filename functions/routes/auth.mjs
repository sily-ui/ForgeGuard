// 对应 api/v1/auth.py：游客/管理员准入、登出、配额查询、工作区信息。
import { ApiError, iso, settings, utcnow } from '../lib/deps.mjs';
import { issueToken, revokeToken } from '../lib/security.mjs';
import { DEFAULT_WORKSPACE, authLimitCheck, resolveWorkspace } from '../lib/middleware.mjs';
import { getMode, status as quotaStatus } from '../lib/quota.mjs';

// Python 用 secrets.compare_digest 防时序侧信道；Deno/Node 均无内置等价物，本地补齐。
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const xa = enc.encode(String(a));
  const xb = enc.encode(String(b));
  const len = Math.max(xa.length, xb.length);
  let diff = xa.length ^ xb.length;
  for (let i = 0; i < len; i++) diff |= (xa[i] ?? 0) ^ (xb[i] ?? 0);
  return diff === 0;
}

export default function (services) {
  return [
    {
      method: 'POST',
      path: '/api/v1/auth/guest',
      auth: 'none',
      handler: async (req) => {
        authLimitCheck(req.request, req.siteContext);
        const workspaceId = await resolveWorkspace(req.store, req.request);
        if (workspaceId === DEFAULT_WORKSPACE) {
          throw new ApiError(40000, '缺少工作区标识', [{ field: 'X-Workspace-Id', error: '必填' }]);
        }
        const clientId = String(req.data.client_id ?? '').slice(0, 64);
        const [token, expiresIn] = await issueToken(req.store, 'guest', clientId, workspaceId);
        return {
          code: 0,
          message: 'ok',
          data: {
            token,
            expires_in: expiresIn,
            mode: await getMode(req.store),
            role: 'guest',
            workspace_id: workspaceId,
            daily_max_calls: settings.quotaGuestDaily,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/auth/admin',
      auth: 'none',
      handler: async (req) => {
        authLimitCheck(req.request, req.siteContext);
        const configured = settings.adminBootstrapKey;
        const provided = String(req.data.bootstrap_key ?? '');
        if (!configured || !timingSafeEqual(configured, provided)) {
          throw new ApiError(40300, '管理员准入未开放或引导密钥错误');
        }
        const [token, expiresIn] = await issueToken(req.store, 'admin', 'bootstrap');
        return { code: 0, message: 'ok', data: { token, expires_in: expiresIn, role: 'admin' } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/auth/logout',
      handler: async (req) => {
        await revokeToken(req.store, req.auth.token);
        return { code: 0, message: 'ok', data: { revoked: true } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/quota',
      handler: async (req) => ({
        code: 0,
        message: 'ok',
        // Python quota.status() 内部取 current_auth()；此处显式传 req.auth 保持 guest 字段语义。
        data: await quotaStatus(req.store, req.auth, req.query.session_id ?? null),
      }),
    },
    {
      method: 'GET',
      path: '/api/v1/auth/workspace',
      handler: async (req) => {
        const workspaceId = req.auth.workspace;
        const aliveStatuses = ['creating', 'pending', 'ready', 'frozen'];
        const row = await req.store.get('workspaces', 'workspace_id', workspaceId);
        const aliveInstances = await req.store.count(
          'instances',
          [['workspace_id', 'eq', workspaceId], ['status', 'in', aliveStatuses]],
          'instance_id',
        );
        const configs = await req.store.count(
          'configs',
          [['workspace_id', 'eq', workspaceId], ['deleted', 'is', false]],
          'config_id',
        );
        return {
          code: 0,
          message: 'ok',
          data: {
            workspace_id: workspaceId,
            is_default: workspaceId === 'default',
            created_at: row ? row.created_at : null,
            alive_instances: aliveInstances,
            configs,
            server_time: iso(utcnow()),
          },
        };
      },
    },
  ];
}
