// 平台 database（Supabase 风格 SDK）之上的薄表访问层。业务代码只经此处访问 DB。
import { ApiError } from './deps.mjs';

export class StoreError extends Error {
  constructor(code, message = 'database_error') { super(message); this.code = code; }
}

function fail(error) {
  // SDK 错误只保留安全码，不外泄 provider 原文。
  throw new StoreError(error?.code || 'db_error', error?.message || 'database_error');
}

function unwrap(result) {
  if (result.error) fail(result.error);
  return result.data;
}

// 平台 database SDK 的查询构造器是受限子集（线上实测只有 eq/order/limit/range 等方法，
// .in()/.neq()/.is() 等调用会抛 TypeError）。策略：eq 走查询构造；其余算子取回后在 JS 过滤。
// 业务表规模为演示量级（行数 ≤ 千），整表取回的代价可控。
const JS_OPS = new Set(['neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like']);

function splitFilters(filters) {
  const eqFilters = [];
  const jsFilters = [];
  for (const f of filters || []) {
    const op = f[1];
    if (op === 'eq') eqFilters.push(f);
    else if (JS_OPS.has(op)) jsFilters.push(f);
    else throw new StoreError('bad_filter', op);
  }
  return [eqFilters, jsFilters];
}

function likeMatch(actual, pattern) {
  if (actual == null) return false;
  const re = new RegExp(
    `^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('%', '.*').replaceAll('_', '.')}$`,
    's',
  );
  return re.test(String(actual));
}

function matchRow(row, [col, op, val]) {
  const actual = row[col];
  switch (op) {
    case 'neq': return actual !== val;
    case 'gt': return actual != null && actual > val;
    case 'gte': return actual != null && actual >= val;
    case 'lt': return actual != null && actual < val;
    case 'lte': return actual != null && actual <= val;
    case 'in': return Array.isArray(val) && val.includes(actual);
    case 'is': return actual === val;
    case 'like': return likeMatch(actual, val);
  }
  return false;
}

function applyFilters(builder, filters) {
  let b = builder;
  for (const [col, , val] of filters || []) b = b.eq(col, val);
  return b;
}

export function makeStore(db) {
  return {
    async get(table, pk, pkVal) {
      if (pkVal == null) return null;
      const data = unwrap(await db.from(table).select('*').eq(pk, pkVal).limit(1));
      return data?.[0] ?? null;
    },

    async rows(table, filters = [], { order = null, desc = false, limit = null, offset = null, rangeEnd = null } = {}) {
      const [eqFilters, jsFilters] = splitFilters(filters);
      let b = applyFilters(db.from(table).select('*'), eqFilters);
      if (order) b = b.order(order, { ascending: !desc });
      if (!jsFilters.length) {
        if (limit != null && rangeEnd == null) b = b.limit(limit);
        if (rangeEnd != null) b = b.range(offset ?? 0, rangeEnd);
        const data = unwrap(await b);
        return data ?? [];
      }
      // 含 JS 算子：先按 eq 过滤取回（已带排序），再过滤/分页。
      const fetched = unwrap(await b) ?? [];
      const matched = fetched.filter((row) => jsFilters.every((f) => matchRow(row, f)));
      if (rangeEnd != null) return matched.slice(offset ?? 0, rangeEnd + 1);
      if (limit != null) return matched.slice(offset ?? 0, (offset ?? 0) + limit);
      return offset ? matched.slice(offset) : matched;
    },

    async first(table, filters = [], opts = {}) {
      const rows = await this.rows(table, filters, { ...opts, limit: 1 });
      return rows[0] ?? null;
    },

    // 精确计数按平台规范用有界 GET：select(<主键列>, {count:'exact'}).limit(1)，总数取自 Content-Range。
    // 含 JS 算子的组合退化为「取回主键列后在 JS 过滤计数」。
    async count(table, filters = [], column = 'id') {
      const [eqFilters, jsFilters] = splitFilters(filters);
      if (jsFilters.length) {
        const data = unwrap(await applyFilters(db.from(table).select(column), eqFilters));
        return (data ?? []).filter((row) => jsFilters.every((f) => matchRow(row, f))).length;
      }
      const result = await applyFilters(db.from(table).select(column, { count: 'exact' }), eqFilters).limit(1);
      if (result.error) fail(result.error);
      if (!Number.isSafeInteger(result.count) || result.count < 0) throw new StoreError('count_unavailable');
      return result.count;
    },

    async insert(table, row) {
      const data = unwrap(await db.from(table).insert(row).select('*'));
      return data?.[0] ?? row;
    },

    async insertMany(table, rows) {
      const data = unwrap(await db.from(table).insert(rows).select('*'));
      return data ?? [];
    },

    async update(table, patch, filters = []) {
      const [eqFilters, jsFilters] = splitFilters(filters);
      if (!jsFilters.length) {
        const b = applyFilters(db.from(table).update(patch), eqFilters);
        const data = unwrap(await b.select('*'));
        return data ?? [];
      }
      // 非 eq 条件逐行评估：命中的行改为「eq 条件 + 旧值相等」的 CAS 更新，与整批更新语义一致。
      const candidates = await this.rows(table, eqFilters);
      const out = [];
      for (const row of candidates) {
        if (!jsFilters.every((f) => matchRow(row, f))) continue;
        const casFilters = [...eqFilters, ...jsFilters.map(([col]) => [col, 'eq', row[col]])];
        const data = unwrap(await applyFilters(db.from(table).update(patch), casFilters).select('*'));
        out.push(...(data ?? []));
      }
      return out;
    },

    // 条件更新（compare-and-set）：filters 必须含期望旧值；返回被改行，空数组=未命中。
    async cas(table, patch, filters) {
      return this.update(table, patch, filters);
    },

    async remove(table, filters = [], column = '*') {
      if (!filters.length) throw new StoreError('unsafe_delete');
      const [eqFilters, jsFilters] = splitFilters(filters);
      if (jsFilters.length) {
        // 平台 delete 只接受 eq 链：先按 eq 取出候选，命中后逐行删除。
        const candidates = await this.rows(table, eqFilters);
        let removed = 0;
        for (const row of candidates) {
          if (!jsFilters.every((f) => matchRow(row, f))) continue;
          const data = unwrap(await applyFilters(db.from(table).delete(), [
            ...eqFilters,
            ...jsFilters.map(([col]) => [col, 'eq', row[col]]),
          ]).select(column));
          removed += data?.length ?? 0;
        }
        return removed;
      }
      const data = unwrap(await applyFilters(db.from(table).delete(), eqFilters).select(column));
      return data?.length ?? 0;
    },

    async insertIfAbsent(table, row) {
      try {
        await this.insert(table, row);
        return true;
      } catch (err) {
        if (err instanceof StoreError && /23505|unique/i.test(String(err.code) + String(err.message))) return false;
        // 保守：非唯一冲突错误也视为失败回读
        if (err instanceof StoreError) return false;
        throw err;
      }
    },
  };
}

export function storeErrorToApi(err) {
  if (err instanceof ApiError) return err;
  return new ApiError(50000, null);
}
