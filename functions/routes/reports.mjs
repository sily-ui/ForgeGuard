// backend-ref/app/api/v1/reports.py 的 ESM 移植（export.pdf 按裁剪方案整体不移植，PDF 由前端排版）。
import { ApiError, iso, paginate, parseIso, parsePagination, slicePage, utcnow } from '../lib/deps.mjs';
import { getCached, storeResult } from '../lib/idempotency.mjs';
import { cachedAsset } from '../lib/http.mjs';
import { getMode, getModeMeta } from '../lib/quota.mjs';
import { getSnapshot } from '../lib/snapshot.mjs';
import { buildReportContent, renderHtml } from '../lib/report.mjs';

const SHARE_TTL_HOURS = 72;

// 对应 secrets.token_urlsafe(24)：24 字节 → 32 位 base64url（无填充）。
function shareToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

// 对应 _report_row：跨工作区一律按「报告不存在」处理，避免枚举。
async function reportRow(store, reportId, workspace) {
  const row = await store.get('reports', 'report_id', reportId);
  if (row === null || row.workspace_id !== workspace) throw new ApiError(40400, '报告不存在');
  return row;
}

// 对应 _report_view：列表 with_content=False 时不含 content 字段。
function reportView(row, withContent = true) {
  const data = {
    report_id: row.report_id,
    session_id: row.session_id,
    policy_snapshot_id: row.policy_snapshot_id,
    config_version: row.config_version,
    status: row.status,
    summary: row.summary,
    created_at: row.created_at,
    share_expires_at: row.share_expires_at ?? null,
  };
  if (withContent) data.content = row.content;
  return data;
}

// 对应 builder.build_report 的取数半边：会话/实例/轮次/调用/告警/快照 + 模式，交给纯函数拼 content。
async function buildReport(store, sessionRow) {
  if (!sessionRow) return [null, '会话不存在'];
  const instance = await store.get('instances', 'instance_id', sessionRow.instance_id);
  if (!instance) return [null, '实例不存在'];
  const sessionId = sessionRow.session_id;
  const [turns, calls, alerts] = await Promise.all([
    store.rows('turns', [['session_id', 'eq', sessionId]], { order: 'turn' }),
    store.rows('call_records', [['session_id', 'eq', sessionId]], { order: 'created_at' }),
    store.rows('alerts', [['session_id', 'eq', sessionId]], { order: 'created_at' }),
  ]);
  const snapshot = await getSnapshot(store, sessionRow.policy_snapshot_id);
  const [mode, modeMeta] = await Promise.all([getMode(store), getModeMeta(store)]);
  return buildReportContent({ session: sessionRow, instance, snapshot, turns, calls, alerts, mode, modeMeta });
}

function htmlAsset(req, row) {
  const report = { report_id: row.report_id, created_at: row.created_at, content: row.content };
  return cachedAsset({
    request: req.request,
    content: renderHtml(report),
    mediaType: 'text/html; charset=utf-8',
    version: `${report.report_id}:${report.created_at}`,
  });
}

export default function (services) {
  void services;
  return [
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/report',
      handler: async (req) => {
        const sessionId = req.params.session_id;
        const session = await req.store.get('sessions', 'session_id', sessionId);
        if (session === null || session.workspace_id !== req.auth.workspace) {
          throw new ApiError(40400, '会话不存在');
        }
        const idemKey = req.header('x-idempotency-key');
        const endpoint = `report:${sessionId}`;
        const cached = await getCached(req.store, idemKey, endpoint, req.auth.workspace);
        if (cached !== null && cached !== undefined) return cached;
        const [result, error] = await buildReport(req.store, session);
        if (error) throw new ApiError(40400, error);
        await req.store.insert('reports', {
          report_id: result.report_id,
          workspace_id: result.workspace_id,
          session_id: result.session_id,
          policy_snapshot_id: result.policy_snapshot_id,
          config_version: result.config_version,
          content: result.content,
          summary: result.summary,
          status: result.status,
          share_token: null,
          share_expires_at: null,
          created_at: result.created_at,
        });
        const response = {
          code: 0,
          message: 'ok',
          data: {
            report_id: result.report_id,
            status: result.status,
            summary: result.summary,
            created_at: result.created_at,
          },
        };
        await storeResult(req.store, idemKey, endpoint, response, req.auth.workspace);
        return response;
      },
    },
    {
      method: 'GET',
      path: '/api/v1/reports',
      handler: async (req) => {
        const [page, pageSize] = parsePagination(req.query.page, req.query.page_size);
        const sessionId = req.query.session_id;
        const filters = [['workspace_id', 'eq', req.auth.workspace]];
        if (sessionId) filters.push(['session_id', 'eq', sessionId]);
        const rows = await req.store.rows('reports', filters, { order: 'created_at', desc: true });
        const items = rows.map((r) => reportView(r, false));
        return {
          code: 0,
          message: 'ok',
          data: paginate(slicePage(items, page, pageSize), page, pageSize, items.length),
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/reports/:report_id',
      handler: async (req) => {
        const row = await reportRow(req.store, req.params.report_id, req.auth.workspace);
        return { code: 0, message: 'ok', data: reportView(row) };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/reports/:report_id/share-link',
      handler: async (req) => {
        await reportRow(req.store, req.params.report_id, req.auth.workspace);
        const token = shareToken();
        const raw = req.data.ttl_hours;
        const hours = raw === undefined || raw === null || !Number.isFinite(Number(raw))
          ? SHARE_TTL_HOURS
          : Math.trunc(Number(raw));
        const ttl = Math.max(1, Math.min(hours, 24 * 30));
        const expires = iso(new Date(utcnow().getTime() + ttl * 3600 * 1000));
        await req.store.update(
          'reports',
          { share_token: token, share_expires_at: expires },
          [['report_id', 'eq', req.params.report_id]],
        );
        return {
          code: 0,
          message: 'ok',
          data: {
            report_id: req.params.report_id,
            // 移植差异：Sites 下分享页挂在函数前缀上，故 share_url 需带 siteBase，
            // 前端仍以 `${window.location.origin}${share_url}` 拼接。
            share_url: `${req.siteBase}/share/reports/${token}`,
            share_token: token,
            expires_at: expires,
            read_only: true,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/reports/:report_id/view',
      handler: async (req) => {
        const row = await reportRow(req.store, req.params.report_id, req.auth.workspace);
        return htmlAsset(req, row);
      },
    },
    {
      // 对应 public_router：根路径挂载、不鉴权，过期即失效。
      method: 'GET',
      path: '/share/reports/:share_token',
      auth: 'none',
      handler: async (req) => {
        const row = await req.store.first('reports', [['share_token', 'eq', req.params.share_token]]);
        if (row === null) throw new ApiError(40400, '分享链接不存在');
        const expires = parseIso(row.share_expires_at);
        if (expires === null || expires.getTime() < utcnow().getTime()) {
          throw new ApiError(40100, '分享链接已过期');
        }
        return htmlAsset(req, row);
      },
    },
  ];
}
