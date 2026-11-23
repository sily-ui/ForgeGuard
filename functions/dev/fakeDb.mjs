// 本地验证用假数据库：实现平台 SDK 的 from().select/insert/update/delete + 过滤/排序/分页链式接口，
// 让真实 lib/store.mjs 逻辑可在 Node 下直接跑通（不改动业务代码）。
const PK = {
  tokens: 'token',
  platform_state: 'key',
  quota_counters: 'key',
  idempotency_keys: 'key',
  workspaces: 'workspace_id',
  configs: 'config_id',
  config_versions: 'id',
  instances: 'instance_id',
  policy_snapshots: 'snapshot_id',
  sessions: 'session_id',
  turns: 'id',
  call_records: 'call_id',
  alerts: 'alert_id',
  reports: 'report_id',
  experiments: 'pair_id',
  snapshot_recordings: 'snapshot_id',
  cleanup_logs: 'id',
  session_events: 'id',
};

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function likeToRegex(pattern) {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
}

function matches(row, filters) {
  return filters.every(([col, op, val]) => {
    const actual = row[col];
    switch (op) {
      case 'eq': return actual === val;
      case 'neq': return actual !== val;
      case 'gt': return actual > val;
      case 'gte': return actual >= val;
      case 'lt': return actual < val;
      case 'lte': return actual <= val;
      case 'in': return Array.isArray(val) && val.includes(actual);
      case 'is': return actual === val;
      case 'like': return actual != null && likeToRegex(val).test(String(actual));
      default: return false;
    }
  });
}

export function makeFakeDb(tables = {}) {
  const data = {};
  for (const name of Object.keys(PK)) data[name] = clone(tables[name]) ?? [];
  const sequences = {};
  const nextId = (table) => {
    sequences[table] = (sequences[table] ?? 0) + 1;
    return sequences[table];
  };
  // 预置已有 identity 行的最大 id，避免与种子数据冲突。
  for (const table of Object.keys(data)) {
    if (PK[table] !== 'id') continue;
    for (const row of data[table]) sequences[table] = Math.max(sequences[table] ?? 0, Number(row.id) || 0);
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.action = 'select';
      this.payload = null;
      this.orderCol = null;
      this.ascending = true;
      this.limitN = null;
      this.rangePair = null;
      this.countMode = null;
      this.selectCols = '*';
    }

    select(cols = '*', opts = {}) {
      this.selectCols = cols;
      if (opts.count) this.countMode = opts.count;
      return this;
    }

    insert(rows) {
      this.action = 'insert';
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }

    update(patch) {
      this.action = 'update';
      this.patch = patch;
      return this;
    }

    delete() {
      this.action = 'delete';
      return this;
    }

    eq(c, v) { this.filters.push([c, 'eq', v]); return this; }
    neq(c, v) { this.filters.push([c, 'neq', v]); return this; }
    gt(c, v) { this.filters.push([c, 'gt', v]); return this; }
    gte(c, v) { this.filters.push([c, 'gte', v]); return this; }
    lt(c, v) { this.filters.push([c, 'lt', v]); return this; }
    lte(c, v) { this.filters.push([c, 'lte', v]); return this; }
    in(c, vals) { this.filters.push([c, 'in', vals]); return this; }
    is(c, v) { this.filters.push([c, 'is', v]); return this; }
    like(c, v) { this.filters.push([c, 'like', v]); return this; }

    order(col, opts = {}) {
      this.orderCol = col;
      this.ascending = opts.ascending !== false;
      return this;
    }

    limit(n) { this.limitN = n; return this; }
    range(a, b) { this.rangePair = [a, b]; return this; }

    _project(rows) {
      let out = rows.map(clone);
      if (this.orderCol) {
        const col = this.orderCol;
        out.sort((a, b) => {
          const x = a[col];
          const y = b[col];
          if (x === y) return 0;
          return (x > y ? 1 : -1) * (this.ascending ? 1 : -1);
        });
      }
      if (this.rangePair) out = out.slice(this.rangePair[0], this.rangePair[1] + 1);
      else if (this.limitN != null) out = out.slice(0, this.limitN);
      return out;
    }

    then(resolve) {
      const table = this.table;
      const pk = PK[table];
      const rows = data[table];
      if (!pk) throw new Error(`unknown table ${table}`);
      if (this.action === 'insert') {
        const inserted = [];
        for (const raw of this.payload) {
          const row = clone(raw);
          if (row[pk] === undefined && pk === 'id') row.id = nextId(table);
          if (rows.some((r) => r[pk] === row[pk])) {
            return resolve({ data: null, count: null, error: { code: '23505', message: 'duplicate key value' } });
          }
          rows.push(row);
          inserted.push(clone(row));
        }
        return resolve({ data: this.selectCols ? inserted : null, count: null, error: null });
      }
      if (this.action === 'update') {
        const changed = [];
        for (const row of rows) {
          if (!matches(row, this.filters)) continue;
          Object.assign(row, clone(this.patch));
          changed.push(clone(row));
        }
        return resolve({ data: changed, count: null, error: null });
      }
      if (this.action === 'delete') {
        const removed = [];
        for (let i = rows.length - 1; i >= 0; i--) {
          if (!matches(rows[i], this.filters)) continue;
          removed.unshift(clone(rows[i]));
          rows.splice(i, 1);
        }
        const keep = this.selectCols === '*' ? removed : removed.map((r) => ({ [String(this.selectCols).split(',')[0]]: r[String(this.selectCols).split(',')[0]] }));
        return resolve({ data: this.selectCols ? keep : null, count: null, error: null });
      }
      const matched = rows.filter((r) => matches(r, this.filters));
      const count = this.countMode === 'exact' ? matched.length : null;
      return resolve({ data: this._project(matched), count, error: null });
    }
  }

  return {
    from(table) { return new Query(table); },
    _data: data,
  };
}
