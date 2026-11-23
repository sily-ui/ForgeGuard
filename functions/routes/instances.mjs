// 对应 api/v1/instances.py：实例创建（原子四步）/查询/推荐/克隆/回收/续期 + 策略快照路由。
import {
  ApiError, ok, paginate, parsePagination, slicePage,
  iso, utcnow, parseIso, newInstanceId, settings,
} from '../lib/deps.mjs';
import {
  validateConfig, normalizeConfig, enabledTools, snapshotView, diffConfigs, mergeModifiedConfig,
  PRESET_NAMES, pyBool, pyStr,
} from '../lib/policies.mjs';
import { freezeSnapshot, getSnapshot, applyPolicyOverride } from '../lib/snapshot.mjs';
import { sandboxManager } from '../lib/sandbox.mjs';
import { fingerprint, generateSuggestions } from '../lib/suggestions.mjs';
import { getCached, storeResult } from '../lib/idempotency.mjs';
import { heavyCheck } from '../lib/middleware.mjs';
import { runtime } from '../lib/state.mjs';

const ALIVE_STATUSES = ['creating', 'pending', 'ready', 'frozen'];

async function instanceRow(store, instanceId, workspace) {
  const row = await store.get('instances', 'instance_id', instanceId);
  if (row === null || row.workspace_id !== workspace) throw new ApiError(40400, '实例不存在');
  return row;
}

function instanceView(row, withConfig = false) {
  const data = {
    instance_id: row.instance_id,
    name: row.name,
    status: row.status,
    source_config_id: row.source_config_id,
    clone_source_id: row.clone_source_id,
    sandbox_key: row.sandbox_key,
    policy_snapshot_id: row.policy_snapshot_id,
    guard: { preset: row.guard_preset, enabled: row.status !== 'destroyed' },
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_active_at: row.last_active_at,
    stats: row.stats || {},
    enabled_tools: enabledTools(row.config_payload),
  };
  if (row.clone_source_id) data.diff_from_source = row.diff_from_source || [];
  if (withConfig) data.config = row.config_payload;
  return data;
}

// 原子四步：校验基线 → 冻结策略 → 分配分区 → 装载工具。
async function createInstance(req, config, sourceConfigId, name, guardPreset, cloneSourceId = null, diff = null) {
  const result = validateConfig(config);
  if (!result.valid) {
    throw new ApiError(
      42200,
      '编排配置无法通过校验',
      result.errors.map((e) => ({ field: e.field, error: e.message })),
    );
  }
  const norm = normalizeConfig(config);
  // Python：guard_preset or config["guard"]["preset"]
  norm.guard.preset = pyBool(guardPreset) ? guardPreset : norm.guard.preset;
  const workspace = req.auth.workspace;
  // 上限按工作区计数，且先检查再冻结快照/分区，避免被拒时留下孤儿资源。
  const alive = await req.store.count(
    'instances',
    [['status', 'in', ALIVE_STATUSES], ['workspace_id', 'eq', workspace]],
    'instance_id',
  );
  if (alive >= settings.instanceMax) {
    throw new ApiError(42902, `本工作区存活实例数已达上限 ${settings.instanceMax}`);
  }
  const instanceId = newInstanceId(pyBool(name) ? name : norm.name);
  const sandboxKey = `sbx:${instanceId}`;
  const now = utcnow();
  const snapshotId = await freezeSnapshot(req.store, instanceId, norm, null, '1.0', 'pol');
  sandboxManager.create(sandboxKey);
  await req.store.insert('instances', {
    instance_id: instanceId,
    workspace_id: workspace,
    name: pyBool(name) ? name : norm.name,
    source_config_id: sourceConfigId,
    clone_source_id: cloneSourceId,
    diff_from_source: diff || [],
    status: 'ready',
    sandbox_key: sandboxKey,
    policy_snapshot_id: snapshotId,
    config_payload: norm,
    guard_preset: norm.guard.preset,
    created_at: iso(now),
    expires_at: iso(new Date(now.getTime() + settings.instanceTtlMinutes * 60000)),
    last_active_at: iso(now),
    stats: { call_count: 0, risk_score: 0.0 },
  });
  return {
    instance_id: instanceId,
    status: 'ready',
    sandbox_key: sandboxKey,
    policy_snapshot_id: snapshotId,
    created_at: iso(now),
  };
}

export default function instancesRoutes(_services) {
  return [
    {
      method: 'POST',
      path: '/api/v1/instances',
      handler: async (req) => {
        heavyCheck(req.request, req.siteContext, 'instance');
        const idemKey = req.header('x-idempotency-key');
        const cached = await getCached(req.store, idemKey, 'instances', req.auth.workspace);
        if (cached !== null) return cached;
        const payload = req.data;
        const configId = payload.config_id;
        let config;
        let configVersion;
        if (pyBool(configId)) {
          const cfg = await req.store.get('configs', 'config_id', configId);
          if (cfg === null || pyBool(cfg.deleted) || cfg.workspace_id !== req.auth.workspace) {
            throw new ApiError(40400, '配置不存在');
          }
          config = structuredClone(cfg.payload);
          configVersion = cfg.version;
        } else if (pyBool(payload.config)) {
          config = structuredClone(payload.config);
          // Python：str(config.get("version", "1.0"))——键存在但为 null 时得 'None'
          configVersion = pyStr('version' in payload.config ? payload.config.version : '1.0');
        } else {
          throw new ApiError(40000, '缺少 config_id 或 config');
        }
        const guardPreset = payload.guard_preset;
        if (pyBool(guardPreset) && !PRESET_NAMES.includes(guardPreset)) {
          throw new ApiError(40000, `guard_preset 仅支持 ${PRESET_NAMES.join('/')}`);
        }
        const data = await createInstance(
          req, config, configId || 'inline', payload.name ?? null, guardPreset ?? null,
        );
        data.config_version = configVersion;
        const response = ok(data);
        await storeResult(req.store, idemKey, 'instances', response, req.auth.workspace);
        return response;
      },
    },
    {
      method: 'GET',
      path: '/api/v1/instances',
      handler: async (req) => {
        const [page, pageSize] = parsePagination(req.query.page ?? 1, req.query.page_size ?? 20);
        const filters = [['workspace_id', 'eq', req.auth.workspace]];
        if (pyBool(req.query.status)) filters.push(['status', 'eq', req.query.status]);
        const rows = await req.store.rows('instances', filters, { order: 'created_at', desc: true });
        const items = rows.map((r) => instanceView(r));
        return ok(paginate(slicePage(items, page, pageSize), page, pageSize, items.length));
      },
    },
    {
      method: 'GET',
      path: '/api/v1/instances/:instance_id',
      handler: async (req) => {
        const row = await instanceRow(req.store, req.params.instance_id, req.auth.workspace);
        return ok(instanceView(row, true));
      },
    },
    {
      method: 'GET',
      path: '/api/v1/instances/:instance_id/suggestions',
      handler: async (req) => {
        const instanceId = req.params.instance_id;
        const row = await instanceRow(req.store, instanceId, req.auth.workspace);
        const config = row.config_payload;
        const fp = await fingerprint(config);
        const cacheKey = `suggestions:${instanceId}`;
        const cached = await req.store.get('platform_state', 'key', cacheKey);
        if (cached !== null && (cached.value || {}).fingerprint === fp) {
          return ok(cached.value.result);
        }
        const result = await generateSuggestions(config, { store: req.store, auth: req.auth });
        // 仅缓存模型成功生成的结果；仿真回退不固化。
        if (!result.simulated) {
          const entry = await req.store.get('platform_state', 'key', cacheKey);
          const value = { fingerprint: fp, result };
          if (entry === null) await req.store.insert('platform_state', { key: cacheKey, value });
          else await req.store.update('platform_state', { value }, [['key', 'eq', cacheKey]]);
        }
        return ok(result);
      },
    },
    {
      method: 'POST',
      path: '/api/v1/instances/:instance_id/clone',
      handler: async (req) => {
        heavyCheck(req.request, req.siteContext, 'instance');
        const instanceId = req.params.instance_id;
        const row = await instanceRow(req.store, instanceId, req.auth.workspace);
        if (row.status === 'destroyed') throw new ApiError(40900, '已销毁实例不可克隆');
        const payload = req.data;
        const mode = payload.mode !== undefined ? payload.mode : 'verbatim';
        let config = structuredClone(row.config_payload);
        if (mode === 'modified') {
          config = mergeModifiedConfig(config, payload.modified_config);
          const result = validateConfig(config);
          if (!result.valid) {
            throw new ApiError(
              42200,
              '克隆配置无法通过校验',
              result.errors.map((e) => ({ field: e.field, error: e.message })),
            );
          }
        }
        const diff = diffConfigs(row.config_payload, config);
        const name = payload.name || `${row.name}-克隆`;
        const data = await createInstance(
          req,
          config,
          row.source_config_id,
          name,
          payload.guard_preset || row.guard_preset,
          instanceId,
          diff,
        );
        data.diff_from_source = diff;
        data.diff_note = payload.diff_note !== undefined ? payload.diff_note : '';
        return ok(data);
      },
    },
    {
      method: 'POST',
      path: '/api/v1/instances/:instance_id/recycle',
      handler: async (req) => {
        const instanceId = req.params.instance_id;
        const row = await instanceRow(req.store, instanceId, req.auth.workspace);
        const payload = req.data;
        if (!pyBool(payload.confirm)) {
          throw new ApiError(40000, '回收需二次确认：请求体携带 confirm=true');
        }
        if (row.status === 'destroyed') throw new ApiError(40900, '实例已销毁');
        const sessionRows = await req.store.rows('sessions', [['instance_id', 'eq', instanceId]]);
        const sessionIds = sessionRows.map((s) => s.session_id);
        await req.store.update('instances', { status: 'destroyed' }, [['instance_id', 'eq', instanceId]]);
        await req.store.remove('platform_state', [['key', 'eq', `suggestions:${instanceId}`]], 'key');
        await req.store.update(
          'sessions',
          { status: 'terminated', terminated_at: iso(utcnow()) },
          [['instance_id', 'eq', instanceId]],
        );
        // 回收即终止运行态：取消红队任务与待决质询，避免协程继续消耗配额。
        for (const sid of sessionIds) {
          runtime.cancelTask(sid);
          runtime.cancelSessionChallenges(sid);
        }
        sandboxManager.destroy(row.sandbox_key);
        return ok({ instance_id: instanceId, status: 'destroyed' });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/instances/:instance_id/renew',
      handler: async (req) => {
        const instanceId = req.params.instance_id;
        const row = await instanceRow(req.store, instanceId, req.auth.workspace);
        if (row.status === 'destroyed') throw new ApiError(40900, '已销毁实例不可续期');
        let base = parseIso(row.expires_at);
        // Python：解析失败回落 utcnow；已过期从当前时间起算
        if (base === null) base = utcnow();
        else if (base < utcnow()) base = utcnow();
        const newExpiry = iso(new Date(base.getTime() + settings.instanceTtlMinutes * 60000));
        const patch = { expires_at: newExpiry };
        if (row.status === 'frozen') patch.status = 'ready';
        await req.store.update('instances', patch, [['instance_id', 'eq', instanceId]]);
        return ok({ instance_id: instanceId, expires_at: newExpiry });
      },
    },
    {
      method: 'GET',
      path: '/api/v1/instances/:instance_id/policies',
      handler: async (req) => {
        const row = await instanceRow(req.store, req.params.instance_id, req.auth.workspace);
        const snapshot = await getSnapshot(req.store, row.policy_snapshot_id);
        const items = snapshot ? snapshot.policies : [];
        return ok({ items, total: items.length });
      },
    },
    // PUT /policies/snapshot 不加静态路由：与 Python 一致落到 :policy_id 分支返回 40400 策略条目不存在。
    {
      method: 'PUT',
      path: '/api/v1/instances/:instance_id/policies/:policy_id',
      handler: async (req) => {
        const instanceId = req.params.instance_id;
        const policyId = req.params.policy_id;
        const row = await instanceRow(req.store, instanceId, req.auth.workspace);
        if (row.status === 'destroyed') throw new ApiError(40900, '已销毁实例不可修改策略');
        const snapshot = await getSnapshot(req.store, row.policy_snapshot_id);
        const target = (snapshot ? snapshot.policies : []).find((p) => p.policy_id === policyId) ?? null;
        if (target === null) throw new ApiError(40400, '策略条目不存在');
        if (target.rule_type === 'tool_existence' && req.data.enabled === false) {
          throw new ApiError(40300, '工具存在性硬规则不允许停用');
        }
        const [newSnapshotId, error] = await applyPolicyOverride(
          req.store, instanceId, row.policy_snapshot_id, policyId, req.data,
        );
        if (error) throw new ApiError(40000, error);
        return ok({
          instance_id: instanceId,
          policy_snapshot_id: newSnapshotId,
          policy_id: policyId,
        });
      },
    },
    {
      method: 'GET',
      path: '/api/v1/instances/:instance_id/policies/snapshot',
      handler: async (req) => {
        const row = await instanceRow(req.store, req.params.instance_id, req.auth.workspace);
        const snapshot = await getSnapshot(req.store, row.policy_snapshot_id);
        if (snapshot === null) throw new ApiError(40400, '策略快照不存在');
        return ok(snapshotView(snapshot));
      },
    },
  ];
}
