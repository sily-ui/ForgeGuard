// 对应 backend-ref/app/api/v1/configs.py：10 条配置路由逐字移植。
// 侧效应次序与 Python 一致：configs 行 + 每次写操作补一行 config_versions；软删除置 deleted。
// configs.py 未调用 heavy_check / idempotency（那两个只在 instances/experiments/sessions 出现），故此处不加。
import { ApiError, ModelUnavailable, iso, newId, ok, paginate, parsePagination, settings, slicePage, utcnow } from '../lib/deps.mjs';
import {
  generatePolicies, llmCostEstimate, normalizeConfig, pyBool, pyStr, templatePrompt, validateConfig,
} from '../lib/policies.mjs';
import { llmChat } from '../lib/llm.mjs';
import { stripCodeFence } from '../lib/guard.mjs';

function isDict(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasOwn(obj, key) {
  return obj !== null && obj !== undefined && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

// 同 Python str(payload.get(k, "")).strip()：键缺失取空串，None 走 str(None)="None"。
function strStrip(value) {
  return pyStr(value === undefined ? '' : value).trim();
}

// 同 configs.py L72-77：conflict 命中即 40001，detail 用中文分号拼接。
function validationError(result) {
  const errors = result.errors ?? [];
  const hasConflict = errors.some((e) => e.code === 'conflict');
  throw new ApiError(
    hasConflict ? 40001 : 40000,
    errors.map((e) => e.message).join('；'),
    errors.map((e) => ({ field: e.field, error: e.message })),
  );
}

function checkValid(result) {
  if (!result.valid) validationError(result);
}

// normalize_config 后弹出内部键（同 config.pop("_unknown_tools", None)），落库前必须去掉。
function persistConfig(payload) {
  const config = normalizeConfig(payload);
  delete config._unknown_tools;
  return config;
}

// 对应 _get_config：不存在 / 已软删 / 跨工作区一律 40400。
async function getConfig(store, configId, workspace) {
  const row = await store.get('configs', 'config_id', configId);
  if (row === null || row === undefined || pyBool(row.deleted) || row.workspace_id !== workspace) {
    throw new ApiError(40400, '配置不存在');
  }
  return row;
}

async function insertVersion(store, configId, version, config, now) {
  // 平台迁移不支持自增主键，版本行用「配置号:版本号」拼主键。
  await store.insert('config_versions', {
    id: `${configId}:${version}`,
    config_id: configId,
    version,
    payload: config,
    created_at: now,
  });
}

// 同 f"{float(row.version) + 0.1:.1f}"，float() 抛 ValueError 时回退 "1.1"。
// 版本号一律由本模块写入（1.0 / +0.1），不会出现 Python 半偶入边的极端值。
function nextVersion(prev) {
  const text = pyStr(prev).trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return '1.1';
  const num = Number(text);
  if (!Number.isFinite(num)) return '1.1';
  return (num + 0.1).toFixed(1);
}

// 同 import 的 str(raw.get("version", "1.0"))：键存在但为 null 时得到 "None"。
function importVersion(raw) {
  return pyStr(hasOwn(raw, 'version') ? raw.version : '1.0');
}

async function suggestPrompt(req) {
  const name = strStrip(req.data.name);
  const purpose = strStrip(req.data.purpose);
  if (!name && !purpose) throw new ApiError(40000, '请先填写实例名称或声明用途');
  if (settings.modelConfigured) {
    const meta = [
      {
        role: 'system',
        content:
          '你是 Agent 系统提示词撰写专家。根据给定的【实例名称】与【声明用途】，' +
          '撰写一段中文系统提示词，用于定义该 Agent 的人设与授权边界。要求：\n' +
          '1. 明确角色与职责（贴合声明用途）；\n' +
          '2. 明确允许的动作（可访问的文档/接口范围）；\n' +
          '3. 明确禁止的动作：禁止读取凭证或敏感文件、禁止向外部域名发送邮件、禁止执行系统命令；\n' +
          '4. 要求对越权请求拒绝并说明原因；\n' +
          '5. 纯文本、不超过 200 字，语言精炼，不要输出 Markdown 代码块或任何解释。',
      },
      { role: 'user', content: `【实例名称】${name || '（未填写）'}\n【声明用途】${purpose || '（未填写）'}` },
    ];
    try {
      const result = await llmChat('business', meta, req.auth, { store: req.store, maxTokens: 1200, temperature: 0.4 });
      const text = stripCodeFence(result.content).trim();
      if (text) return ok({ system_prompt: text.slice(0, 200), simulated: false });
    } catch (err) {
      if (!(err instanceof ModelUnavailable)) throw err;
    }
  }
  return ok({ system_prompt: templatePrompt(name, purpose), simulated: true });
}

async function listConfigs(req) {
  const [page, pageSize] = parsePagination(req.query.page, req.query.page_size);
  // 原 ORM：deleted is false + workspace 过滤 + created_at desc；全量取回后再切片以复现 total=len(items)。
  const rows = await req.store.rows(
    'configs',
    [['deleted', 'is', false], ['workspace_id', 'eq', req.auth.workspace]],
    { order: 'created_at', desc: true },
  );
  const items = rows.map((r) => ({
    config_id: r.config_id,
    name: r.name,
    version: r.version,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return ok(paginate(slicePage(items, page, pageSize), page, pageSize, items.length));
}

async function validateRoute(req) {
  return ok(validateConfig(req.data));
}

async function previewRoute(req) {
  const result = validateConfig(req.data);
  // 与 Python 同：这里不复用校验结果、也不吞 normalize 异常（格式非法时原样 500）。
  const config = normalizeConfig(req.data);
  const [policies] = generatePolicies(config, null, null, { idPrefix: 'pol-preview' });
  return ok({
    policies,
    llm_cost_estimate: llmCostEstimate(config),
    validation: result,
  });
}

async function createConfig(req) {
  checkValid(validateConfig(req.data));
  const config = persistConfig(req.data);
  const configId = newId('cfg');
  const now = iso(utcnow());
  await req.store.insert('configs', {
    config_id: configId,
    workspace_id: req.auth.workspace,
    name: config.name,
    version: '1.0',
    payload: config,
    created_at: now,
    updated_at: now,
    deleted: false,
  });
  await insertVersion(req.store, configId, '1.0', config, now);
  return ok({ config_id: configId, version: '1.0' });
}

async function getConfigRoute(req) {
  const row = await getConfig(req.store, req.params.config_id, req.auth.workspace);
  const payload = isDict(row.payload) ? row.payload : {};
  return ok({
    config_id: row.config_id,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...payload,
  });
}

async function updateConfig(req) {
  const row = await getConfig(req.store, req.params.config_id, req.auth.workspace);
  checkValid(validateConfig(req.data));
  const config = persistConfig(req.data);
  const version = nextVersion(row.version);
  const now = iso(utcnow());
  await req.store.update(
    'configs',
    { payload: config, name: config.name, version, updated_at: now },
    [['config_id', 'eq', row.config_id]],
  );
  await insertVersion(req.store, row.config_id, version, config, now);
  return ok({ config_id: row.config_id, version });
}

async function deleteConfig(req) {
  const row = await getConfig(req.store, req.params.config_id, req.auth.workspace);
  await req.store.update(
    'configs',
    { deleted: true, updated_at: iso(utcnow()) },
    [['config_id', 'eq', row.config_id]],
  );
  return ok({ config_id: row.config_id, deleted: true });
}

async function importConfig(req) {
  // 同 payload.get("config", payload)：键存在即取该值（哪怕是 null），缺失才整体作为配置。
  const raw = hasOwn(req.data, 'config') ? req.data.config : req.data;
  const result = validateConfig(raw);
  checkValid(result);
  const config = persistConfig(raw);
  const configId = newId('cfg');
  const now = iso(utcnow());
  const version = importVersion(raw);
  await req.store.insert('configs', {
    config_id: configId,
    workspace_id: req.auth.workspace,
    name: config.name,
    version,
    payload: config,
    created_at: now,
    updated_at: now,
    deleted: false,
  });
  await insertVersion(req.store, configId, version, config, now);
  return ok({ config_id: configId, version, validation: result });
}

async function exportConfig(req) {
  const row = await getConfig(req.store, req.params.config_id, req.auth.workspace);
  const payload = { ...(isDict(row.payload) ? row.payload : {}) };
  payload.version = row.version;
  return ok(payload);
}

export default function configsRoutes(_services) {
  // 工厂阶段不触碰 services：路由表在 app.mjs 构建期即定型。
  return [
    { method: 'POST', path: '/api/v1/configs/suggest-prompt', auth: 'required', handler: suggestPrompt },
    { method: 'GET', path: '/api/v1/configs', auth: 'required', handler: listConfigs },
    { method: 'POST', path: '/api/v1/configs/validate', auth: 'required', handler: validateRoute },
    { method: 'POST', path: '/api/v1/configs/preview', auth: 'required', handler: previewRoute },
    { method: 'POST', path: '/api/v1/configs', auth: 'required', handler: createConfig },
    { method: 'GET', path: '/api/v1/configs/:config_id', auth: 'required', handler: getConfigRoute },
    { method: 'PUT', path: '/api/v1/configs/:config_id', auth: 'required', handler: updateConfig },
    { method: 'DELETE', path: '/api/v1/configs/:config_id', auth: 'required', handler: deleteConfig },
    { method: 'POST', path: '/api/v1/configs/import', auth: 'required', handler: importConfig },
    { method: 'GET', path: '/api/v1/configs/:config_id/export', auth: 'required', handler: exportConfig },
  ];
}
