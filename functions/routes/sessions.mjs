// 对应 api/v1/sessions.py：会话生命周期、取证列表、质询裁决、红队开关、SSE 事件流。
// 编排与事件推送全部复用 lib/runner.mjs、lib/redteam.mjs、lib/events.mjs，本文件只做 HTTP 表面。
import { ApiError, iso, newId, ok, paginate, parsePagination, slicePage, utcnow } from '../lib/deps.mjs';
import { getMode } from '../lib/quota.mjs';
import { freezeSnapshot } from '../lib/snapshot.mjs';
import { eventBus, publishThreadsafe } from '../lib/events.mjs';
import { runtime } from '../lib/state.mjs';
import { heavyCheck } from '../lib/middleware.mjs';
import { sseResponse } from '../lib/http.mjs';
import { processMessage, recordSession, renewIfStale } from '../lib/runner.mjs';
import { startRedteam, stopRedteam } from '../lib/redteam.mjs';

// 与 lib/events.mjs 的环形缓冲上限一致（该常量未导出，此处按契约值本地声明）。
const FULL_HISTORY_LIMIT = 2000;

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// Python len() 计字符数，JS .length 计 UTF-16 单元；表情类消息需按码点计数才与 4000 上限一致。
function charLength(text) {
  return Array.from(String(text ?? '')).length;
}

async function sessionRow(store, sessionId, workspace = 'default') {
  const row = await store.get('sessions', 'session_id', sessionId);
  if (row === null || row.workspace_id !== workspace) throw new ApiError(40400, '会话不存在');
  return row;
}

async function sessionView(store, row, instanceName) {
  let name = instanceName;
  if (name == null) {
    const instance = await store.get('instances', 'instance_id', row.instance_id);
    name = instance ? instance.name : '';
  }
  // 字段顺序与 _session_view 逐字对齐（前端按序断言）。
  return {
    session_id: row.session_id,
    instance_id: row.instance_id,
    instance_name: name,
    status: row.status,
    turn: row.turn,
    call_count: row.call_count,
    risk_score: round2(row.risk_score),
    guard_enabled: row.guard_enabled,
    policy_snapshot_id: row.policy_snapshot_id,
    max_risk: row.max_risk,
    block_count: row.block_count,
    limit_block_count: row.limit_block_count,
    challenge_count: row.challenge_count,
    degrade_count: row.degrade_count,
    allow_count: row.allow_count,
    mode: row.mode,
    degradations: row.degradations || [],
    created_at: row.created_at,
    terminated_at: row.terminated_at,
  };
}

function callView(c) {
  return {
    call_id: c.call_id,
    session_id: c.session_id,
    turn: c.turn,
    tool: c.tool,
    params_summary: c.params_summary,
    params_raw: c.params_raw,
    judgement: c.judgement,
    hit_policy: c.hit_policy,
    sandbox_result: c.sandbox_result,
    duration_ms: c.duration_ms,
    layers: c.layers,
    status_color: c.status_color,
    source_sample_id: c.source_sample_id,
    actor: c.actor,
    created_at: c.created_at,
  };
}

function alertView(a) {
  return {
    alert_id: a.alert_id,
    session_id: a.session_id,
    instance_id: a.instance_id,
    call_id: a.call_id,
    turn: a.turn,
    level: a.level,
    label: a.label,
    boundary: a.boundary,
    action: a.action,
    reason: a.reason,
    hit_policies: a.hit_policies,
    false_positive: a.false_positive,
    false_negative: a.false_negative,
    note: a.note,
    session_level: a.session_level,
    created_at: a.created_at,
  };
}

// 新建/重置会话共用的行写入（列与 db.Session 全量对齐）。
async function insertSession(store, { sessionId, workspace, instance, snapshotId, guardEnabled, now }) {
  const mode = await getMode(store);
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
    mode,
    degradations: [],
  });
  return mode;
}

// Python 侧只有内存环形缓冲；Sites 冷启动后缓冲为空，断点为 0 时回读 session_events 表补历史。
async function primeHistory(sessionId, lastId) {
  if (lastId !== 0) return;
  if (eventBus.historySince(sessionId, 0).length > 0) return;
  await eventBus.flushPersist(sessionId);
  const rows = await eventBus.loadHistoryFromStore(sessionId, 0, null);
  if (!rows.length) return;
  const history = rows.slice(-FULL_HISTORY_LIMIT);
  eventBus.history.set(sessionId, history);
  eventBus.counters.set(sessionId, Number(history[history.length - 1].id) || 0);
}

function intParam(value, def) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export default function (services) {
  void services; // 工厂阶段不触碰 services，运行期一律经 req.store / req.services。
  return [
    {
      method: 'POST',
      path: '/api/v1/sessions',
      auth: 'required',
      handler: async (req) => {
        const store = req.store;
        const instanceId = req.data.instance_id;
        const instance = instanceId ? await store.get('instances', 'instance_id', instanceId) : null;
        if (instance === null || instance.workspace_id !== req.auth.workspace) {
          throw new ApiError(40400, '实例不存在');
        }
        if (instance.status === 'destroyed') throw new ApiError(40900, '实例已销毁，无法创建会话');
        await renewIfStale(store, instance);
        const sessionId = newId('sess');
        const snapshotId = await freezeSnapshot(
          store, instance.instance_id, instance.config_payload, sessionId, '1.0', 'pol',
        );
        // bool(payload.get("guard_enabled", True))：显式传 null/false 都按关闭处理。
        const guardEnabled = 'guard_enabled' in req.data ? Boolean(req.data.guard_enabled) : true;
        const now = iso(utcnow());
        const mode = await insertSession(store, {
          sessionId, workspace: req.auth.workspace, instance, snapshotId, guardEnabled, now,
        });
        await publishThreadsafe(sessionId, 'session.status', { session_id: sessionId, status: 'active', mode });
        return ok({
          session_id: sessionId,
          status: 'active',
          instance_id: instance.instance_id,
          policy_snapshot_id: snapshotId,
          created_at: now,
        });
      },
    },
    {
      method: 'GET',
      path: '/api/v1/sessions',
      auth: 'required',
      handler: async (req) => {
        const store = req.store;
        const [page, pageSize] = parsePagination(req.query.page, req.query.page_size);
        const filters = [['workspace_id', 'eq', req.auth.workspace]];
        if (req.query.instance_id) filters.push(['instance_id', 'eq', req.query.instance_id]);
        const rows = await store.rows('sessions', filters, { order: 'created_at', desc: true });
        const instanceIds = [...new Set(rows.map((r) => r.instance_id))];
        const names = {};
        if (instanceIds.length) {
          const instances = await store.rows('instances', [['instance_id', 'in', instanceIds]]);
          for (const i of instances) names[i.instance_id] = i.name;
        }
        const items = [];
        for (const row of rows) items.push(await sessionView(store, row, names[row.instance_id] ?? ''));
        return ok(paginate(slicePage(items, page, pageSize), page, pageSize, items.length));
      },
    },
    {
      method: 'GET',
      path: '/api/v1/sessions/:session_id',
      auth: 'required',
      handler: async (req) => {
        const row = await sessionRow(req.store, req.params.session_id, req.auth.workspace);
        const data = await sessionView(req.store, row);
        data.context_summary = row.context_summary;
        data.skip_guard_turns = row.skip_guard_turns || [];
        return ok(data);
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/messages',
      auth: 'required',
      handler: async (req) => {
        const content = String(req.data.content ?? '').trim();
        if (!content) throw new ApiError(40000, '消息内容不能为空');
        if (charLength(content) > 4000) throw new ApiError(40000, '消息长度超过 4000 字符上限');
        const actor = req.data.actor ?? 'business';
        if (actor !== 'business') throw new ApiError(40000, 'actor 仅支持 business，红队归属由系统内部标记');
        await sessionRow(req.store, req.params.session_id, req.auth.workspace);
        const result = await processMessage(req.store, req.auth, req.params.session_id, content, {
          skipGuard: Boolean(req.data.skip_guard ?? false),
          sourceSampleId: req.data.source_sample_id ?? null,
          actor,
        });
        return ok({
          message_id: result.message_id ?? newId('msg'),
          accepted: true,
          status: 'processing',
          ...result,
        });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/pause',
      auth: 'required',
      handler: async (req) => {
        const sessionId = req.params.session_id;
        const row = await sessionRow(req.store, sessionId, req.auth.workspace);
        if (row.status !== 'active') throw new ApiError(40900, `会话当前状态为 ${row.status}，无法暂停`);
        await req.store.update('sessions', { status: 'paused' }, [['session_id', 'eq', sessionId]]);
        await publishThreadsafe(sessionId, 'session.status', { session_id: sessionId, status: 'paused' });
        return ok({ session_id: sessionId, status: 'paused' });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/resume',
      auth: 'required',
      handler: async (req) => {
        const sessionId = req.params.session_id;
        const row = await sessionRow(req.store, sessionId, req.auth.workspace);
        if (row.status !== 'paused') throw new ApiError(40900, `会话当前状态为 ${row.status}，无法恢复`);
        await req.store.update('sessions', { status: 'active' }, [['session_id', 'eq', sessionId]]);
        await publishThreadsafe(sessionId, 'session.status', { session_id: sessionId, status: 'active' });
        return ok({ session_id: sessionId, status: 'active' });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/terminate',
      auth: 'required',
      handler: async (req) => {
        const sessionId = req.params.session_id;
        const row = await sessionRow(req.store, sessionId, req.auth.workspace);
        if (row.status === 'terminated') throw new ApiError(40900, '会话已终止');
        const now = iso(utcnow());
        await req.store.update(
          'sessions',
          { status: 'terminated', terminated_at: now },
          [['session_id', 'eq', sessionId]],
        );
        runtime.cancelSessionChallenges(sessionId);
        runtime.cancelTask(sessionId);
        await publishThreadsafe(sessionId, 'session.status', {
          session_id: sessionId, status: 'terminated', terminated_at: now,
        });
        return ok({ session_id: sessionId, status: 'terminated', terminated_at: now });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/reset',
      auth: 'required',
      handler: async (req) => {
        const store = req.store;
        const sessionId = req.params.session_id;
        const row = await sessionRow(store, sessionId, req.auth.workspace);
        const instance = await store.get('instances', 'instance_id', row.instance_id);
        if (instance === null || instance.status === 'destroyed') {
          throw new ApiError(40900, '实例已销毁，无法重置会话');
        }
        const now = iso(utcnow());
        await store.update(
          'sessions',
          { status: 'terminated', terminated_at: now },
          [['session_id', 'eq', sessionId]],
        );
        const newSessionId = newId('sess');
        const snapshotId = await freezeSnapshot(
          store, instance.instance_id, instance.config_payload, newSessionId, '1.0', 'pol',
        );
        await insertSession(store, {
          sessionId: newSessionId,
          workspace: req.auth.workspace,
          instance,
          snapshotId,
          guardEnabled: Boolean(row.guard_enabled),
          now,
        });
        return ok({
          previous_session_id: sessionId,
          session_id: newSessionId,
          status: 'active',
          policy_snapshot_id: snapshotId,
        });
      },
    },
    {
      method: 'GET',
      path: '/api/v1/sessions/:session_id/calls',
      auth: 'required',
      handler: async (req) => {
        await sessionRow(req.store, req.params.session_id, req.auth.workspace);
        const rows = await req.store.rows(
          'call_records',
          [['session_id', 'eq', req.params.session_id]],
          { order: 'created_at', desc: false },
        );
        const items = rows.map(callView);
        return ok({ items, total: items.length });
      },
    },
    {
      method: 'GET',
      path: '/api/v1/sessions/:session_id/messages',
      auth: 'required',
      handler: async (req) => {
        await sessionRow(req.store, req.params.session_id, req.auth.workspace);
        const rows = await req.store.rows(
          'turns',
          [['session_id', 'eq', req.params.session_id]],
          { order: 'turn', desc: false },
        );
        const items = rows.map((t) => ({
          turn: t.turn,
          user_input: t.user_input,
          reply: t.reply,
          actor: t.actor,
          source_sample_id: t.source_sample_id,
          created_at: t.created_at,
        }));
        return ok({ items, total: items.length });
      },
    },
    {
      method: 'GET',
      path: '/api/v1/sessions/:session_id/alerts',
      auth: 'required',
      handler: async (req) => {
        await sessionRow(req.store, req.params.session_id, req.auth.workspace);
        const filters = [['session_id', 'eq', req.params.session_id]];
        if (req.query.level) filters.push(['level', 'eq', req.query.level]);
        if (req.query.action) filters.push(['action', 'eq', req.query.action]);
        const rows = await req.store.rows('alerts', filters, { order: 'created_at', desc: false });
        const items = rows.map(alertView);
        return ok({ items, total: items.length });
      },
    },
    {
      // 该路由挂在 alerts 前缀下（Python 原文如此），非 sessions。
      method: 'POST',
      path: '/api/v1/alerts/:alert_id/feedback',
      auth: 'required',
      handler: async (req) => {
        const store = req.store;
        const alert = await store.get('alerts', 'alert_id', req.params.alert_id);
        if (alert === null) throw new ApiError(40400, '告警不存在');
        const session = await store.get('sessions', 'session_id', alert.session_id);
        if (session === null || session.workspace_id !== req.auth.workspace) {
          throw new ApiError(40400, '告警不存在');
        }
        const patch = {};
        if ('false_positive' in req.data) patch.false_positive = Boolean(req.data.false_positive);
        if ('false_negative' in req.data) patch.false_negative = Boolean(req.data.false_negative);
        if ('note' in req.data) patch.note = String(req.data.note).slice(0, 500);
        let row = alert;
        if (Object.keys(patch).length) {
          const rows = await store.update('alerts', patch, [['alert_id', 'eq', req.params.alert_id]]);
          row = rows?.[0] ?? alert;
        }
        return ok(alertView(row));
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/challenges/:call_id',
      auth: 'required',
      handler: async (req) => {
        const sessionId = req.params.session_id;
        await sessionRow(req.store, sessionId, req.auth.workspace);
        if (!('approved' in req.data)) throw new ApiError(40000, '缺少 approved 字段');
        const approved = Boolean(req.data.approved);
        const resolved = runtime.resolveChallenge(req.params.call_id, approved, sessionId);
        if (!resolved) throw new ApiError(40900, '该质询已超时或已被处理');
        return ok({ call_id: req.params.call_id, approved });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/redteam/start',
      auth: 'required',
      handler: async (req) => {
        const sessionId = req.params.session_id;
        heavyCheck(req.request, req.siteContext, 'redteam');
        const row = await sessionRow(req.store, sessionId, req.auth.workspace);
        if (row.status !== 'active') throw new ApiError(40900, '仅活跃会话可启动红队');
        if (runtime.redteamFlags.get(sessionId)) throw new ApiError(40900, '该会话红队已在运行');
        // Python 用 int()/float() 强转，非数值入参在此归为默认值（runRedteam 内部还会二次容错）。
        const maxRounds = intParam(req.data.max_rounds, 5);
        const timeLimitS = (() => {
          const n = Number(req.data.time_limit_s ?? 120);
          return Number.isFinite(n) ? n : 120;
        })();
        // 先同步置位再 fire-and-forget，返回值与 Python 完全一致（不 await 红队循环）。
        void startRedteam(req.store, req.auth, sessionId, maxRounds, timeLimitS);
        return ok({ session_id: sessionId, status: 'running', max_rounds: maxRounds });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/redteam/stop',
      auth: 'required',
      handler: async (req) => {
        const sessionId = req.params.session_id;
        await sessionRow(req.store, sessionId, req.auth.workspace);
        stopRedteam(sessionId);
        return ok({ session_id: sessionId, status: 'stopping' });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/record',
      auth: 'required',
      handler: async (req) => {
        req.auth.require('admin');
        const sessionId = req.params.session_id;
        await sessionRow(req.store, sessionId, req.auth.workspace);
        const name = req.data.name || `会话录制-${sessionId}`;
        const snapshotId = await recordSession(req.store, sessionId, name, req.auth.workspace);
        return ok({ snapshot_id: snapshotId, name });
      },
    },
    {
      method: 'GET',
      path: '/api/v1/sessions/:session_id/events',
      auth: 'sse',
      handler: async (req) => {
        const sessionId = req.params.session_id;
        await sessionRow(req.store, sessionId, req.auth.workspace);
        const rawLast = req.request.headers.get('last-event-id') || req.query.last_event_id || '0';
        // Python int() 严格解析：'1.5'/'abc' 一律回退 0，不能按 parseInt 截断。
        const lastId = /^[+-]?\d+$/.test(String(rawLast).trim()) ? Number(String(rawLast).trim()) : 0;
        const rawLimit = req.query.limit;
        const limit = rawLimit && /^[+-]?\d+$/.test(String(rawLimit).trim())
          ? Number(String(rawLimit).trim())
          : null;
        const follow = String(req.query.follow ?? 'true').toLowerCase() !== 'false';
        await primeHistory(sessionId, lastId);
        return sseResponse({ sessionId, lastId, limit, follow, signal: req.request.signal });
      },
    },
  ];
}
