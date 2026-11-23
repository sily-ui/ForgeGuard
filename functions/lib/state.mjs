// 对应 core/state.py（Redis 部分按已确认方案移除）：质询/任务/锁/录制/降级留痕。
import { iso, utcnow } from './deps.mjs';

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.settled = false;
    const origResolve = this.resolve, origReject = this.reject;
    this.resolve = (v) => { this.settled = true; origResolve(v); };
    this.reject = (e) => { this.settled = true; origReject(e); };
    this.promise.catch(() => {});
  }
}

class Runtime {
  constructor() {
    this.challenges = new Map();      // call_id → Deferred
    this.challengeSessions = new Map();// call_id → session_id
    this.challengeMemory = new Map();  // session_id → Map(kind → approved)
    this.tasks = new Map();            // session_id → {stopped}
    this.sessionLocks = new Map();
    this.redteamFlags = new Map();
    this.recording = new Map();
    this.degradations = new Map();
    this.stateBackend = 'memory';
    this.redisReachable = false;
  }

  async noteDegradation(store, sessionId, reason) {
    if (!sessionId) return;
    let items = this.degradations.get(sessionId);
    if (!items) { items = []; this.degradations.set(sessionId, items); }
    if (!items.includes(reason)) items.push(reason);
    const row = await store.get('sessions', 'session_id', sessionId);
    if (row) {
      const existing = Array.isArray(row.degradations) ? [...row.degradations] : [];
      if (!existing.includes(reason)) {
        existing.push(reason);
        await store.update('sessions', { degradations: existing }, [['session_id', 'eq', sessionId]]);
      }
    }
  }

  popDegradations(sessionId) {
    const v = this.degradations.get(sessionId) ?? [];
    this.degradations.delete(sessionId);
    return v;
  }

  rememberChallenge(sessionId, kind, approved) {
    if (!this.challengeMemory.has(sessionId)) this.challengeMemory.set(sessionId, new Map());
    this.challengeMemory.get(sessionId).set(kind, approved);
  }

  recalledChallenge(sessionId, kind) {
    return this.challengeMemory.get(sessionId)?.get(kind) ?? null;
  }

  registerChallenge(callId, sessionId = null) {
    const d = new Deferred();
    this.challenges.set(callId, d);
    if (sessionId) this.challengeSessions.set(callId, sessionId);
    return d;
  }

  resolveChallenge(callId, approved, sessionId = null) {
    if (sessionId != null && this.challengeSessions.get(callId) !== sessionId) return false;
    const d = this.challenges.get(callId);
    this.challengeSessions.delete(callId);
    this.challenges.delete(callId);
    if (!d || d.settled) return false;
    d.resolve(approved);
    return true;
  }

  cancelChallenge(callId) {
    const d = this.challenges.get(callId);
    this.challengeSessions.delete(callId);
    this.challenges.delete(callId);
    if (d && !d.settled) d.reject(new Error('cancelled'));
  }

  cancelSessionChallenges(sessionId) {
    for (const [callId, sid] of [...this.challengeSessions.entries()]) {
      if (sid === sessionId) this.cancelChallenge(callId);
    }
  }

  // 会话级互斥：保证同会话 process_message 串行。
  async withSessionLock(sessionId, fn) {
    const prev = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    this.sessionLocks.set(sessionId, prev.then(() => gate));
    await prev;
    try { return await fn(); } finally { release(); }
  }

  cancelTask(sessionId) {
    const task = this.tasks.get(sessionId);
    if (task) task.stopped = true;
  }
}

export const runtime = new Runtime();

export async function waitWithTimeout(promise, seconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_res, rej) => { timer = setTimeout(() => rej(new Error('timeout')), seconds * 1000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export { iso, utcnow };
