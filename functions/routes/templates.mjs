// 对应 api/v1/templates.py：场景模板列表（内存常量，不入库）。
import { paginate, parsePagination, slicePage } from '../lib/deps.mjs';
import { TEMPLATES } from '../data/templates.mjs';

export default function (services) {
  return [
    {
      method: 'GET',
      path: '/api/v1/templates',
      handler: async (req) => {
        const [page, pageSize] = parsePagination(req.query.page, req.query.page_size);
        const items = TEMPLATES.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          suggested_tools: t.suggested_tools,
          suggested_guard: t.suggested_guard,
          risk_note: t.risk_note,
          config: t.config,
        }));
        return {
          code: 0,
          message: 'ok',
          data: paginate(slicePage(items, page, pageSize), page, pageSize, items.length),
        };
      },
    },
  ];
}
