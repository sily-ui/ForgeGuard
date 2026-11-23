// 对应 internal/events.py：进程内总线 + session_events 表落库（冷启动/断点续传兜底）。
const HISTORY_LIMIT = 200;
const FULL_HISTORY_LIMIT = 2000;
const SUBSCRIBER_MAX = 500;

class Queue {
  constructor(max) { this.max = max; this.items = []; this.waiters = []; }
  push(item) {
    if (this.waiters.length) { this.waiters.shift()({ value: item, done: false }); return true; }
    if (this.items.length >= this.max) return false; // QueueFull：丢弃，同 Python
    this.items.push(item);
    return true;
  }
  next() {
    if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
    return new Promise((resolve) => { this.waiters.push(resolve); });
  }
  close() {
    while (this.waiters.length) this.waiters.shift()({ value: null, done: true });
    this.closed = true;
  }
}

class EventBus {
  constructor() {
    this.history = new Map();    // sid → array(≤2000, 展示缓存 200)
    this.counters = new Map();   // sid → seq
    this.subscribers = new Map();// sid → Set<Queue>
    this.store = null;
    this.persistQueues = new Map(); // sid → Promise 链，写库失败不影响推送
  }

  bindStore(store) { this.store = store; }

  async _initSeq(sessionId) {
    if (this.counters.has(sessionId)) return;
    let max = 0;
    if (this.store) {
      try {
        const rows = await this.store.rows('session_events', [['session_id', 'eq', sessionId]], { order: 'seq', desc: true, limit: 1 });
        if (rows.length) max = rows[0].seq;
      } catch { /* 表读失败时从 0 开始（仅影响 id 连续性） */ }
    }
    this.counters.set(sessionId, max);
    if (!this.history.has(sessionId)) this.history.set(sessionId, []);
  }

  async publish(sessionId, event, data) {
    await this._initSeq(sessionId);
    const seq = this.counters.get(sessionId) + 1;
    this.counters.set(sessionId, seq);
    const record = { id: seq, event, data };
    let hist = this.history.get(sessionId);
    if (!hist) { hist = []; this.history.set(sessionId, hist); }
    hist.push(record);
    if (hist.length > FULL_HISTORY_LIMIT) hist.splice(0, hist.length - FULL_HISTORY_LIMIT);
    const { runtime } = await import('./state.mjs');
    if (runtime.recording.has(sessionId)) runtime.recording.get(sessionId).push(record);
    for (const q of [...(this.subscribers.get(sessionId) ?? [])]) q.push(record);
    if (this.store) {
      const prev = this.persistQueues.get(sessionId) ?? Promise.resolve();
      this.persistQueues.set(sessionId, prev.then(async () => {
        // 平台不支持自增/UNIQUE 索引，事件行用「会话号:序号」拼主键顶替原 (session_id, seq) 唯一约束。
        try { await this.store.insert('session_events', { id: `${sessionId}:${seq}`, session_id: sessionId, seq, event, data, created_at: new Date().toISOString() }); }
        catch { /* 落库失败静默：SSE 实时性优先 */ }
      }));
    }
    return seq;
  }

  historySince(sessionId, lastEventId = 0) {
    return (this.history.get(sessionId) ?? []).filter((r) => r.id > lastEventId);
  }

  fullHistory(sessionId) {
    return [...(this.history.get(sessionId) ?? [])];
  }

  async loadHistoryFromStore(sessionId, lastEventId, limit = null) {
    if (!this.store) return [];
    let b = this.store.rows('session_events', [['session_id', 'eq', sessionId], ['seq', 'gt', lastEventId]], { order: 'seq', desc: false, limit: limit ?? 2000 });
    const rows = await b;
    return rows.map((r) => ({ id: r.seq, event: r.event, data: r.data }));
  }

  subscribe(sessionId) {
    const q = new Queue(SUBSCRIBER_MAX);
    if (!this.subscribers.has(sessionId)) this.subscribers.set(sessionId, new Set());
    this.subscribers.get(sessionId).add(q);
    return q;
  }

  unsubscribe(sessionId, q) {
    const subs = this.subscribers.get(sessionId);
    if (subs) { subs.delete(q); if (!subs.size) this.subscribers.delete(sessionId); }
  }

  clear(sessionId) {
    this.history.delete(sessionId);
    this.counters.delete(sessionId);
  }

  async flushPersist(sessionId) {
    await (this.persistQueues.get(sessionId) ?? Promise.resolve());
  }
}

export const eventBus = new EventBus();
export const HISTORY_LIMIT_CONST = HISTORY_LIMIT;

export async function publishThreadsafe(sessionId, event, data) {
  // Python 里同步端点经主循环投递；Deno 单事件循环直接 await（失败静默，事件仍落库）。
  try { await eventBus.publish(sessionId, event, data); } catch { /* ignore */ }
}
