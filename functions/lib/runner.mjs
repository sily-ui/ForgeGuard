// 对应 orchestration/runner.py：会话运行器（驱动业务循环、合并监护处置、落库取证、推送事件）。
import { ApiError, QuotaExhausted, iso, newId, parseIso, settings, utcnow } from './deps.mjs';
import { getMode, getModeMeta, currentSimulatedReason } from './quota.mjs';
import { eventBus, publishThreadsafe } from './events.mjs';
import { runtime, waitWithTimeout } from './state.mjs';
import { buildMirrorRequest } from './mirror.mjs';
import { RISK_ORDER, accumulate, overThreshold, runJudgement, SESSION_THRESHOLD } from './guard.mjs';
import { getSnapshot } from './snapshot.mjs';
import { invokeSandbox, newCallId, sandboxManager } from './sandbox.mjs';
import { builtinRecording } from '../data/builtin.mjs';
import { makeReasonContext, runBusinessTurn } from './agent.mjs';

export const CHALLENGE_TIMEOUT = 120;
// 仿真/演示链路无人值守裁决，质询短暂等待后保守拒绝，保证一键演示秒级完成。
export const SIM_CHALLENGE_TIMEOUT = 8;
export const REPLAY_EVENT_DELAY = 0.1;

function slicePy(text, end) {
  const chars = Array.from(String(text ?? ''));
  return chars.length > end ? chars.slice(0, end).join('') : chars.join('');
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getSession(store, sessionId) {
  return store.get('sessions', 'session_id', sessionId);
}

export async function getInstance(store, instanceId) {
  return store.get('instances', 'instance_id', instanceId);
}

export async function updateSession(store, sessionId, fields) {
  const rows = await store.update('sessions', fields, [['session_id', 'eq', sessionId]]);
  return rows?.[0] ?? null;
}

// 滑动 TTL：过期/冻结实例在被使用时自动续期复活，闲置实例仍会到期供回收。
export async function renewIfStale(store, instance) {
  const expires = parseIso(instance.expires_at);
  if (instance.status !== 'frozen' && !(expires && expires < utcnow())) return false;
  await store.update(
    'instances',
    {
      expires_at: iso(new Date(utcnow().getTime() + settings.instanceTtlMinutes * 60000)),
      status: 'ready',
    },
    [['instance_id', 'eq', instance.instance_id]],
  );
  return true;
}

export function paramsSummary(tool, params) {
  const summary = {};
  for (const key of ['path', 'endpoint', 'cmd', 'command', 'key', 'to', 'recipients', 'subject']) {
    if (key in params) {
      let value = params[key];
      if (typeof value === 'string' && value.length > 80) value = `${value.slice(0, 80)}…`;
      summary[key] = value;
    }
  }
  if ('content' in params) summary.content_length = String(params.content).length;
  if ('value' in params) summary.value = params.value;
  return Object.keys(summary).length ? summary : { params: slicePy(JSON.stringify(params), 80) };
}

function challengeKind(tool, params, decision) {
  const to = params.to;
  const joined = Array.isArray(to) ? to.join(',') : (to != null ? String(to) : '');
  const target =
    params.path || params.endpoint || joined || decision.boundary || 'intent';
  return `${tool}:${target}`;
}

function alertSeed(decision) {
  const action = decision.action;
  const risk = decision.risk ?? 'none';
  if (decision.kind === 'limit') return null;
  if (action === 'block') return 'high';
  if (action === 'challenge') return risk === 'high' ? 'high' : 'medium';
  if (action === 'degrade') return 'low';
  if (action === 'allow' && (risk === 'medium' || risk === 'high')) return 'medium';
  return null;
}

function riskLabel(decision) {
  if (decision.risk_label) return decision.risk_label;
  return { tool: '越界调用工具', object: '对象边界越权', param: '参数边界越权' }[decision.boundary] ?? '意图风险';
}

async function activeRecording(store, ctx) {
  const meta = await getModeMeta(store);
  const workspace = ctx?.workspace ?? 'default';
  if (meta.snapshot_id) {
    const row = await store.get('snapshot_recordings', 'snapshot_id', meta.snapshot_id);
    if (row) return { snapshot_id: row.snapshot_id, name: row.name, ...(row.events || {}) };
  }
  // 只回放本工作区录制的快照，避免跨工作区取数。
  const rows = await store.rows('snapshot_recordings', [['workspace_id', 'eq', workspace]], {
    order: 'created_at',
    desc: true,
    limit: 1,
  });
  if (rows.length) {
    const row = rows[0];
    return { snapshot_id: row.snapshot_id, name: row.name, ...(row.events || {}) };
  }
  return builtinRecording();
}

export async function replayForSession(store, ctx, sessionId, instance) {
  const recording = await activeRecording(store, ctx);
  const meta = await getModeMeta(store);
  await eventBus.publish(sessionId, 'session.status', {
    session_id: sessionId,
    status: 'active',
    mode: 'replay',
    reason: meta.reason || '快照回放模式',
    snapshot_id: recording.snapshot_id ?? null,
  });
  const idMap = {};
  const calls = recording.calls || [];
  const alerts = recording.alerts || [];
  for (const call of calls) {
    const fresh = newCallId();
    idMap[call.call_id] = fresh;
    await store.insert('call_records', {
      call_id: fresh,
      session_id: sessionId,
      instance_id: instance.instance_id,
      turn: call.turn ?? 1,
      tool: call.tool ?? '',
      params_raw: call.params_raw ?? {},
      params_summary: call.params_summary ?? {},
      judgement: call.judgement ?? {},
      hit_policy: call.hit_policy ?? null,
      sandbox_result: call.sandbox_result ?? null,
      duration_ms: call.duration_ms ?? 0,
      layers: call.layers ?? {},
      status_color: call.status_color ?? 'green',
      created_at: iso(utcnow()),
      source_sample_id: call.source_sample_id ?? null,
      actor: call.actor ?? 'business',
    });
  }
  for (const alert of alerts) {
    await store.insert('alerts', {
      alert_id: newId('alt'),
      session_id: sessionId,
      instance_id: instance.instance_id,
      call_id: idMap[alert.call_id] ?? null,
      turn: alert.turn ?? 1,
      level: alert.level ?? 'medium',
      label: alert.label ?? '',
      boundary: alert.boundary ?? null,
      action: alert.action ?? 'block',
      reason: alert.reason ?? '',
      hit_policies: alert.hit_policies ?? [],
      created_at: iso(utcnow()),
      session_level: alert.session_level ?? false,
    });
  }
  for (const record of recording.events || []) {
    const data = { ...(record.data || {}) };
    if (data.call_id in idMap) data.call_id = idMap[data.call_id];
    await eventBus.publish(sessionId, record.event, data);
    await sleep(REPLAY_EVENT_DELAY * 1000);
  }
  const blockCount = calls.filter(
    (c) => (c.judgement || {}).action === 'block' && (c.judgement || {}).kind !== 'limit',
  ).length;
  let maxRisk = 'none';
  for (const call of calls) {
    const risk = (call.judgement || {}).risk ?? 'none';
    if (RISK_ORDER[risk] > RISK_ORDER[maxRisk]) maxRisk = risk;
  }
  await updateSession(store, sessionId, {
    call_count: calls.length,
    block_count: blockCount,
    max_risk: maxRisk,
    mode: 'replay',
  });
  return {
    turn: 1,
    reply: '（快照回放）已按录制序列重演完整攻防回合。',
    actions: calls.map((c) => (c.judgement || {}).action ?? 'allow'),
    max_risk: maxRisk,
    call_ids: Object.values(idMap),
    mode: 'replay',
  };
}

async function persistCall(store, args) {
  await store.insert('call_records', {
    call_id: args.callId,
    session_id: args.sessionId,
    instance_id: args.instanceId,
    turn: args.turn,
    tool: args.tool,
    params_raw: args.params,
    params_summary: args.summary,
    judgement: args.decision,
    hit_policy: args.hitPolicy,
    sandbox_result: args.sandboxResult,
    duration_ms: Math.trunc(args.durationMs),
    layers: args.layers,
    status_color: args.color,
    created_at: iso(utcnow()),
    source_sample_id: args.sourceSampleId ?? null,
    actor: args.actor,
  });
}

async function persistAlert(store, alert) {
  await store.insert('alerts', {
    alert_id: alert.alert_id,
    session_id: alert.session_id,
    instance_id: alert.instance_id,
    call_id: alert.call_id ?? null,
    turn: alert.turn ?? 0,
    level: alert.level,
    label: alert.label ?? '',
    boundary: alert.boundary ?? null,
    action: alert.action,
    reason: alert.reason,
    hit_policies: alert.hit_policies ?? [],
    created_at: alert.created_at,
    session_level: alert.session_level ?? false,
  });
}

async function maybeSessionAlert(store, sessionId, instanceId, turn, score) {
  const existing = await store.count(
    'alerts',
    [
      ['session_id', 'eq', sessionId],
      ['session_level', 'is', true],
    ],
    'alert_id',
  );
  if (existing > 0) return;
  const alert = {
    alert_id: newId('alt'),
    session_id: sessionId,
    instance_id: instanceId,
    call_id: null,
    turn,
    level: 'medium',
    label: '跨轮上下文污染',
    boundary: null,
    action: 'allow',
    reason: `会话累计风险分 ${Number(score).toFixed(2)} 越过阈值 ${SESSION_THRESHOLD}，多轮渐进式污染迹象，本轮上下文已标记为可疑（不阻断正常调用）`,
    hit_policies: [],
    created_at: iso(utcnow()),
    session_level: true,
  };
  await persistAlert(store, alert);
  await publishThreadsafe(sessionId, 'alert.created', alert);
}

async function appendContext(store, sessionId, turn, content, actions) {
  const session = await getSession(store, sessionId);
  const line = `第${turn}轮：用户请求「${slicePy(content, 60)}」；处置=${actions.length ? actions.join('/') : '无工具调用'}`;
  const lines = String(session?.context_summary ?? '').split('\n');
  lines.push(line);
  await updateSession(store, sessionId, { context_summary: lines.slice(-3).join('\n') });
}

export async function processMessage(store, ctx, sessionId, content, opts = {}) {
  // 同会话消息串行化：用户消息与红队循环并发进入时，轮次与计数器读-改-写不丢失。
  const { skipGuard = false, sourceSampleId = null, actor = 'business' } = opts;
  return runtime.withSessionLock(sessionId, () =>
    _processMessage(store, ctx, sessionId, content, { skipGuard, sourceSampleId, actor }),
  );
}

async function _processMessage(store, ctx, sessionId, content, { skipGuard, sourceSampleId, actor }) {
  const session = await getSession(store, sessionId);
  if (session === null) throw new ApiError(40400, '会话不存在');
  if (session.status !== 'active') {
    throw new ApiError(40900, `会话当前状态为 ${session.status}，无法发送消息`);
  }
  const instance = await getInstance(store, session.instance_id);
  if (instance === null || instance.status === 'destroyed') {
    throw new ApiError(40900, '实例已销毁，无法继续会话');
  }
  await renewIfStale(store, instance);
  if ((await getMode(store)) === 'replay') {
    return replayForSession(store, ctx, sessionId, instance);
  }

  const snapshot = await getSnapshot(store, session.policy_snapshot_id);
  const config = instance.config_payload;
  const limits = config.limits;
  const turn = session.turn + 1;
  const guardEnabled = Boolean(session.guard_enabled) && !skipGuard;
  const skipTurns = [...(session.skip_guard_turns || [])];
  if (skipGuard && !skipTurns.includes(turn)) skipTurns.push(turn);
  await updateSession(store, sessionId, { turn, skip_guard_turns: skipTurns });

  let turnCalls = 0;
  const actions = [];
  const callIds = [];
  let maxRiskTurn = 'none';
  const sandboxKey = instance.sandbox_key;

  const executeTool = async function executeTool(call) {
    const tool = String(call.tool ?? '');
    const params = { ...(call.params || {}) };
    const callId = newCallId();
    callIds.push(callId);
    const current = await getSession(store, sessionId);
    const summary = paramsSummary(tool, params);
    const started = performance.now();

    const overLimit =
      turnCalls >= limits.max_calls_per_turn || current.call_count >= limits.max_calls_per_session;
    if (overLimit) {
      const reason =
        turnCalls >= limits.max_calls_per_turn
          ? `超出编排限额：单轮调用已达 ${limits.max_calls_per_turn} 次上限`
          : `超出编排限额：会话累计调用已达 ${limits.max_calls_per_session} 次上限`;
      const decision = {
        risk: 'none',
        is_violation: false,
        boundary: null,
        action: 'block',
        hit_policies: [],
        reason,
        judged_by: 'L1',
        kind: 'limit',
      };
      await eventBus.publish(sessionId, 'tool.call', {
        call_id: callId, turn, tool, params_summary: summary, actor,
      });
      await eventBus.publish(sessionId, 'guard.judgement', { call_id: callId, tool, ...decision });
      await persistCall(store, {
        callId, sessionId, instanceId: instance.instance_id, turn, tool, params, summary,
        decision, hitPolicy: null,
        sandboxResult: { ok: false, data: { refused: true, reason }, simulated: true },
        durationMs: round2(performance.now() - started), layers: {}, color: 'gray',
        sourceSampleId, actor,
      });
      await updateSession(store, sessionId, {
        call_count: current.call_count + 1,
        limit_block_count: current.limit_block_count + 1,
      });
      await eventBus.publish(sessionId, 'chain.update', {
        call_id: callId, turn, tool, status_color: 'gray', action: 'block', kind: 'limit', duration_ms: 0,
      });
      actions.push('limit_block');
      return JSON.stringify({ tool, ok: false, action: 'block', reason });
    }

    turnCalls += 1;
    await eventBus.publish(sessionId, 'tool.call', {
      call_id: callId, turn, tool, params_summary: summary, actor,
    });
    const mirror = buildMirrorRequest(
      sessionId, turn, content, current.context_summary, tool, params, snapshot.baseline_summary ?? '',
    );
    const partition = sandboxManager.get(sandboxKey);
    const judgeContext = {
      turn_calls: turnCalls - 1,
      session_calls: current.call_count,
      existing_files: partition ? Object.keys(partition.files) : [],
    };
    const judgeResult = await runJudgement(mirror, snapshot, judgeContext, {
      guardEnabled,
      sessionId,
      store,
      auth: ctx,
      noteDegradation: (sid, reason) => runtime.noteDegradation(store, sid, reason),
    });
    const decision = { ...judgeResult.final_decision };
    let challengeApproved = null;
    if (decision.action === 'challenge') {
      const kind = challengeKind(tool, params, decision);
      const remembered = runtime.recalledChallenge(sessionId, kind);
      if (remembered !== null) {
        challengeApproved = remembered;
        decision.reason += '（同类质询已记忆此前选择）';
      } else {
        // Python 是「先发事件再登记」（裁决必经 HTTP 往返，不会抢先）；Deno 侧订阅者可能在
        // 同一微任务队列里立即 resolve，故先登记再广播，避免质询无人认领而误判超时。
        const deferred = runtime.registerChallenge(callId, sessionId);
        await eventBus.publish(sessionId, 'guard.judgement', {
          call_id: callId, tool, challenge_pending: true, ...decision,
        });
        let timedOut = false;
        const waitS = currentSimulatedReason() ? SIM_CHALLENGE_TIMEOUT : CHALLENGE_TIMEOUT;
        try {
          challengeApproved = await waitWithTimeout(deferred.promise, waitS);
        } catch {
          runtime.cancelChallenge(callId);
          challengeApproved = false;
          timedOut = true;
          decision.reason += '（质询超时，默认拒绝）';
        }
        // 超时拒绝不写入记忆：一次无人响应不应让同类调用在整个会话内永久被拒。
        if (!timedOut) runtime.rememberChallenge(sessionId, kind, challengeApproved);
      }
      decision.action = challengeApproved ? 'allow' : 'block';
      decision.challenge_approved = challengeApproved;
    }

    await eventBus.publish(sessionId, 'guard.judgement', { call_id: callId, tool, ...decision });

    const perm = (config.tools || {})[tool]?.perm || {};
    const sandboxDecision = { ...decision, mask_fields: perm.mask_fields || [], overwrite_allowed: Boolean(perm.overwrite) };
    const sandboxResult = invokeSandbox({
      instance_id: instance.instance_id,
      sandbox_key: sandboxKey,
      tool,
      params,
      policy_decision: sandboxDecision,
    });

    let color;
    if (decision.kind === 'limit') color = 'gray';
    else if (decision.action === 'block') color = 'red';
    else if (decision.action === 'degrade') color = 'yellow';
    else if (decision.challenge_approved !== undefined && decision.challenge_approved !== null) color = 'orange';
    else color = 'green';
    const durationMs = round2(performance.now() - started);
    const hitPolicy = decision.hit_policies.length ? decision.hit_policies[0] : null;
    await persistCall(store, {
      callId, sessionId, instanceId: instance.instance_id, turn, tool, params, summary,
      decision, hitPolicy, sandboxResult, durationMs,
      layers: { layers: judgeResult.layers, timings: judgeResult.timings },
      color, sourceSampleId, actor,
    });

    const alertLevel = alertSeed(decision);
    if (alertLevel) {
      const alert = {
        alert_id: newId('alt'),
        session_id: sessionId,
        instance_id: instance.instance_id,
        call_id: callId,
        turn,
        level: alertLevel,
        label: riskLabel(decision),
        boundary: decision.boundary ?? null,
        action: decision.action,
        reason: decision.reason,
        hit_policies: decision.hit_policies,
        created_at: iso(utcnow()),
        session_level: false,
      };
      await persistAlert(store, alert);
      await eventBus.publish(sessionId, 'alert.created', alert);
    }

    const fresh = await getSession(store, sessionId);
    const newScore = accumulate(fresh.risk_score, fresh.last_risk_turn, turn, decision.risk);
    const counters = {
      call_count: fresh.call_count + 1,
      risk_score: newScore,
      last_risk_turn: turn,
    };
    if (decision.action === 'block') counters.block_count = fresh.block_count + 1;
    else if (decision.action === 'degrade') counters.degrade_count = fresh.degrade_count + 1;
    else if (decision.action === 'allow') counters.allow_count = fresh.allow_count + 1;
    if (challengeApproved !== null) counters.challenge_count = fresh.challenge_count + 1;
    if (RISK_ORDER[decision.risk] > RISK_ORDER[fresh.max_risk]) counters.max_risk = decision.risk;
    await updateSession(store, sessionId, counters);

    if (overThreshold(newScore)) await maybeSessionAlert(store, sessionId, instance.instance_id, turn, newScore);

    if (RISK_ORDER[decision.risk] > RISK_ORDER[maxRiskTurn]) maxRiskTurn = decision.risk;
    actions.push(decision.action);
    await eventBus.publish(sessionId, 'chain.update', {
      call_id: callId, turn, tool, status_color: color, action: decision.action, risk: decision.risk,
      duration_ms: durationMs, judged_by: decision.judged_by,
    });
    return slicePy(
      JSON.stringify({
        tool,
        ok: sandboxResult.ok,
        action: decision.action,
        reason: decision.reason,
        data: sandboxResult.data ?? null,
      }),
      1500,
    );
  };

  const messageId = newId('msg');
  const publishDelta = async (delta) => {
    await eventBus.publish(sessionId, 'agent.delta', {
      message_id: messageId, role: 'assistant', delta, turn, actor,
    });
  };

  const reasonCtx = makeReasonContext({
    store,
    auth: ctx,
    sessionId,
    systemPrompt: config.system_prompt,
    maxCalls: limits.max_calls_per_turn,
    executeTool,
    tools: config.tools,
    onDelta: publishDelta,
  });
  const messages = [];
  if (session.context_summary) {
    messages.push({ role: 'user', content: `[此前对话摘要] ${session.context_summary}` });
  }
  messages.push({ role: 'user', content });
  await eventBus.publish(sessionId, 'agent.message.start', {
    message_id: messageId, role: 'assistant', turn, actor,
  });
  let finalState;
  try {
    finalState = await runBusinessTurn(reasonCtx, messages);
  } catch (exc) {
    if (exc instanceof QuotaExhausted) {
      await eventBus.publish(sessionId, 'agent.message', {
        message_id: messageId, role: 'assistant',
        content: '（本回合模型配额耗尽，自动切换快照回放）', turn, actor,
      });
      await eventBus.publish(sessionId, 'session.status', {
        session_id: sessionId, status: 'active', mode: 'replay',
        reason: '模型配额耗尽，自动切换快照回放',
      });
      return replayForSession(store, ctx, sessionId, instance);
    }
    // 收尾流式占位气泡，避免前端停留在“正在响应”
    await eventBus.publish(sessionId, 'agent.message', {
      message_id: messageId, role: 'assistant',
      content: `（本轮处理失败：${exc?.constructor?.name ?? 'Error'}，请重试）`, turn, actor,
    });
    throw exc;
  }

  let reply = finalState.reply ?? '';
  if (reasonCtx.simulatedFallback) {
    const forced = currentSimulatedReason();
    reply += forced ? `\n（${forced}）` : '\n（注：本轮模型接口不可达，使用离线仿真推理，已留痕）';
  }
  await eventBus.publish(sessionId, 'agent.message', {
    message_id: messageId, role: 'assistant', content: reply, turn, actor,
  });
  await appendContext(store, sessionId, turn, content, actions);
  await store.insert('turns', {
    // 平台不支持自增主键，轮次行用「会话号:轮次」拼主键。
    id: `${sessionId}:${turn}`,
    session_id: sessionId,
    turn,
    user_input: slicePy(content, 2000),
    reply,
    actor,
    source_sample_id: sourceSampleId ?? null,
    created_at: iso(utcnow()),
  });
  const inst = await getInstance(store, instance.instance_id);
  if (inst) {
    const stats = { ...(inst.stats || {}) };
    stats.call_count = (stats.call_count || 0) + callIds.length;
    await store.update(
      'instances',
      { last_active_at: iso(utcnow()), stats },
      [['instance_id', 'eq', instance.instance_id]],
    );
  }
  return {
    turn,
    reply,
    actions,
    max_risk: maxRiskTurn,
    call_ids: callIds,
    message_id: messageId,
  };
}

export async function recordSession(store, sessionId, name, workspaceId = 'default') {
  // 把会话完整事件序列与证据录制为快照（只增不改）。
  await eventBus.flushPersist(sessionId);
  const events = eventBus.fullHistory(sessionId);
  const callRows = await store.rows('call_records', [['session_id', 'eq', sessionId]], { order: 'created_at', desc: false });
  const alertRows = await store.rows('alerts', [['session_id', 'eq', sessionId]], { order: 'created_at', desc: false });
  const callDicts = callRows.map((c) => ({
    call_id: c.call_id, turn: c.turn, tool: c.tool, params_raw: c.params_raw,
    params_summary: c.params_summary, judgement: c.judgement, hit_policy: c.hit_policy,
    sandbox_result: c.sandbox_result, duration_ms: c.duration_ms, layers: c.layers,
    status_color: c.status_color, source_sample_id: c.source_sample_id ?? null, actor: c.actor,
  }));
  const alertDicts = alertRows.map((a) => ({
    call_id: a.call_id ?? null, turn: a.turn, level: a.level, label: a.label,
    boundary: a.boundary ?? null, action: a.action, reason: a.reason,
    hit_policies: a.hit_policies, session_level: a.session_level,
  }));
  const snapshotId = newId('snap');
  await store.insert('snapshot_recordings', {
    snapshot_id: snapshotId,
    name,
    session_id: sessionId,
    workspace_id: workspaceId,
    events: { events, calls: callDicts, alerts: alertDicts },
    created_at: iso(utcnow()),
  });
  return snapshotId;
}
