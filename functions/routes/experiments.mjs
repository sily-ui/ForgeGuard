// 对应 backend-ref/app/api/v1/experiments.py：3 条对照实验路由逐字移植。
// 仿真链路无真实模型：process_message 由 lib/runner.mjs 的确定性编排替代 langgraph。
import { ApiError, iso, newId, ok, paginate, parsePagination, slicePage, utcnow } from '../lib/deps.mjs';
import { diffConfigs, pyBool, pyStr } from '../lib/policies.mjs';
import { freezeSnapshot } from '../lib/snapshot.mjs';
import { processMessage } from '../lib/runner.mjs';
import { heavyCheck } from '../lib/middleware.mjs';
import { getCached, storeResult } from '../lib/idempotency.mjs';

function hasOwn(obj, key) {
  return obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key);
}

// 同 _new_session_for：在目标实例上冻结一份新策略快照并落一个全默认值的活动会话。
async function newSessionFor(store, instance, guardEnabled, workspace = 'default') {
  const sessionId = newId('sess');
  const snapshotId = await freezeSnapshot(store, instance.instance_id, instance.config_payload, sessionId, '1.0', 'pol');
  const now = iso(utcnow());
  await store.insert('sessions', {
    session_id: sessionId,
    workspace_id: workspace,
    instance_id: instance.instance_id,
    status: 'active',
    turn: 0,
    context_summary: '',
    call_count: 0,
    risk_score: 0.0,
    last_risk_turn: 0,
    guard_enabled: guardEnabled,
    skip_guard_turns: [],
    policy_snapshot_id: snapshotId,
    created_at: now,
    terminated_at: null,
    max_risk: 'none',
    block_count: 0,
    challenge_count: 0,
    limit_block_count: 0,
    degrade_count: 0,
    allow_count: 0,
    mode: 'live',
    degradations: [],
  });
  return sessionId;
}

// 同 _calls_of：按时间序取调用记录并摊平 judgement 三键（缺失为 null）。
async function callsOf(store, sessionId) {
  const rows = await store.rows('call_records', [['session_id', 'eq', sessionId]], { order: 'created_at', desc: false });
  return rows.map((c) => {
    const judgement = c.judgement ?? {};
    return {
      call_id: c.call_id,
      turn: c.turn,
      tool: c.tool,
      params_summary: c.params_summary,
      action: judgement.action ?? null,
      risk: judgement.risk ?? null,
      reason: judgement.reason ?? null,
      status_color: c.status_color,
      duration_ms: c.duration_ms,
    };
  });
}

async function compare(req) {
  const ctx = req.auth;
  heavyCheck(req.request, req.siteContext, 'compare');
  const idemKey = req.header('X-Idempotency-Key');
  const cached = await getCached(req.store, idemKey, 'experiments.compare', ctx.workspace);
  if (cached !== null && cached !== undefined) return cached;
  const dimension = hasOwn(req.data, 'dimension') ? req.data.dimension : 'instance';
  if (dimension !== 'guard' && dimension !== 'instance') throw new ApiError(40000, 'dimension 仅支持 guard 或 instance');
  const sourceSessionId = req.data.source_session_id ?? null;
  // 同 str(payload.get("input", "")).strip()：键缺失取空串，null 走 str(None)="None"。
  let content = pyStr(hasOwn(req.data, 'input') ? req.data.input : '').trim();
  const source = sourceSessionId ? await req.store.get('sessions', 'session_id', sourceSessionId) : null;
  if (source === null || source === undefined || source.workspace_id !== ctx.workspace) {
    throw new ApiError(40400, '起点会话不存在');
  }
  if (!content) {
    const firstTurn = await req.store.first('turns', [['session_id', 'eq', sourceSessionId]], { order: 'turn', desc: false });
    if (firstTurn === null) throw new ApiError(40000, '缺少 input 且起点会话无历史输入可复用');
    content = firstTurn.user_input;
  }
  const sourceInstance = await req.store.get('instances', 'instance_id', source.instance_id);
  if (sourceInstance === null || sourceInstance === undefined || sourceInstance.workspace_id !== ctx.workspace) {
    throw new ApiError(40900, '起点实例已销毁，无法对照');
  }
  let targetInstance;
  let guardEnabled;
  let diffItems;
  if (dimension === 'guard') {
    targetInstance = sourceInstance;
    const srcGuard = pyBool(source.guard_enabled);
    guardEnabled = !srcGuard;
    diffItems = [{
      field: 'guard_enabled',
      // Python f-string 渲染布尔为 True/False，pyStr 保持逐字一致。
      change: `${pyStr(srcGuard)} → ${pyStr(guardEnabled)}`,
    }];
  } else {
    const targetInstanceId = req.data.target_instance_id ?? null;
    targetInstance = targetInstanceId ? await req.store.get('instances', 'instance_id', targetInstanceId) : null;
    if (targetInstance === null || targetInstance === undefined || targetInstance.workspace_id !== ctx.workspace) {
      throw new ApiError(40400, '对照实例不存在');
    }
    if (targetInstance.status === 'destroyed') throw new ApiError(40900, '对照实例已销毁');
    guardEnabled = hasOwn(req.data, 'guard_enabled') ? pyBool(req.data.guard_enabled) : true;
    diffItems = diffConfigs(sourceInstance.config_payload, targetInstance.config_payload);
  }
  const runBSessionId = await newSessionFor(req.store, targetInstance, guardEnabled, ctx.workspace);
  const resultB = await processMessage(req.store, ctx, runBSessionId, content);
  const pairId = newId('exp');
  const runA = { session_id: source.session_id, instance_id: source.instance_id };
  const runB = { session_id: runBSessionId, instance_id: targetInstance.instance_id };
  const now = iso(utcnow());
  await req.store.insert('experiments', {
    pair_id: pairId,
    workspace_id: ctx.workspace,
    dimension,
    source_session_id: sourceSessionId,
    run_a: runA,
    run_b: runB,
    input: content,
    diff_items: diffItems,
    status: 'ready',
    created_at: now,
  });
  const response = ok({
    pair_id: pairId,
    dimension,
    run_a: runA,
    run_b: runB,
    diff_items: diffItems,
    run_b_summary: {
      actions: hasOwn(resultB, 'actions') ? resultB.actions : [],
      max_risk: hasOwn(resultB, 'max_risk') ? resultB.max_risk : 'none',
    },
  });
  await storeResult(req.store, idemKey, 'experiments.compare', response, ctx.workspace);
  return response;
}

async function getExperiment(req) {
  const ctx = req.auth;
  const row = await req.store.get('experiments', 'pair_id', req.params.pair_id);
  if (row === null || row === undefined || row.workspace_id !== ctx.workspace) {
    throw new ApiError(40400, '对照实验不存在');
  }
  const callsA = await callsOf(req.store, row.run_a.session_id);
  const callsB = await callsOf(req.store, row.run_b.session_id);
  const experiment = {
    pair_id: row.pair_id,
    dimension: row.dimension,
    source_session_id: row.source_session_id,
    run_a: row.run_a,
    run_b: row.run_b,
    input: row.input,
    diff_items: row.diff_items,
    status: row.status,
    created_at: row.created_at,
  };
  const rows = [];
  for (let step = 1; step <= Math.max(callsA.length, callsB.length); step++) {
    let a = step <= callsA.length ? callsA[step - 1] : null;
    let b = step <= callsB.length ? callsB[step - 1] : null;
    // 同 Python：占位对象按步新建，避免 JSON 序列化共享引用。
    if (b === null) b = { note: '本次运行未发生该步' };
    if (a === null) a = { note: '本次运行未发生该步' };
    rows.push({ step, run_a: a, run_b: b });
  }
  experiment.rows = rows;
  return ok(experiment);
}

async function listExperiments(req) {
  const ctx = req.auth;
  const [page, pageSize] = parsePagination(req.query.page, req.query.page_size);
  const rows = await req.store.rows('experiments', [['workspace_id', 'eq', ctx.workspace]], { order: 'created_at', desc: true });
  const items = rows.map((r) => ({
    pair_id: r.pair_id,
    dimension: r.dimension,
    run_a: r.run_a,
    run_b: r.run_b,
    diff_count: (r.diff_items ?? []).length,
    status: r.status,
    created_at: r.created_at,
  }));
  // Python 先全量取行再 len(items) 作 total，移植同序：total=len(items) 而非 SQL count。
  return ok(paginate(slicePage(items, page, pageSize), page, pageSize, items.length));
}

export default function experimentsRoutes(_services) {
  // 工厂阶段不触碰 services：路由表在 app.mjs 构建期即定型。
  return [
    { method: 'POST', path: '/api/v1/experiments/compare', auth: 'required', handler: compare },
    { method: 'GET', path: '/api/v1/experiments/:pair_id', auth: 'required', handler: getExperiment },
    { method: 'GET', path: '/api/v1/experiments', auth: 'required', handler: listExperiments },
  ];
}
