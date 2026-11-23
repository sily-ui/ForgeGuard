// 对应 api/v1/samples.py：样本目录 + 一键载入（走 runner 完整链路）。
import { ApiError, paginate, parsePagination, slicePage } from '../lib/deps.mjs';
import { SAMPLES, CATEGORY_NAMES, applicability, getSample, sampleView } from '../data/samples.mjs';
import { enabledTools } from '../lib/policies.mjs';
import { processMessage } from '../lib/runner.mjs';
import { withForceSimulated } from '../lib/quota.mjs';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export default function (services) {
  return [
    {
      method: 'GET',
      path: '/api/v1/samples',
      handler: async (req) => {
        const [page, pageSize] = parsePagination(req.query.page, req.query.page_size);
        let tools = [];
        const instanceId = req.query.instance_id;
        if (instanceId) {
          const instance = await req.store.get('instances', 'instance_id', instanceId);
          if (instance === null || instance.workspace_id !== req.auth.workspace) {
            throw new ApiError(40400, '实例不存在');
          }
          tools = enabledTools(instance.config_payload);
        }
        const items = [];
        for (const sample of SAMPLES) {
          if (req.query.category && sample.category !== req.query.category) continue;
          items.push(sampleView(sample, tools));
        }
        // Python key=(not applicable, category, sample_id)：可用样本置顶，其余按类别再按 id。
        items.sort(
          (a, b) =>
            Number(!a.applicable) - Number(!b.applicable) ||
            cmp(a.category, b.category) ||
            cmp(a.sample_id, b.sample_id),
        );
        return {
          code: 0,
          message: 'ok',
          data: {
            ...paginate(slicePage(items, page, pageSize), page, pageSize, items.length),
            categories: CATEGORY_NAMES,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:session_id/samples/:sample_id/load',
      handler: async (req) => {
        const { session_id: sessionId, sample_id: sampleId } = req.params;
        const sample = getSample(sampleId);
        if (sample === null) throw new ApiError(40400, '样本不存在');
        const session = await req.store.get('sessions', 'session_id', sessionId);
        if (session === null || session.workspace_id !== req.auth.workspace) {
          throw new ApiError(40400, '会话不存在');
        }
        const instance = await req.store.get('instances', 'instance_id', session.instance_id);
        if (instance === null) throw new ApiError(40400, '实例不存在');
        const tools = enabledTools(instance.config_payload);
        const [applicable, reason] = applicability(sample, tools);
        if (!applicable && !req.data.force) throw new ApiError(40900, reason);
        // fast：一键演示的快速链路——整条调用链走离线仿真，秒级完成、答辩可控、不耗配额。
        const fast = Boolean(req.data.fast);
        const runTurns = async () => {
          const results = [];
          for (const setup of sample.setup_turns ?? []) {
            results.push(await processMessage(req.store, req.auth, sessionId, setup, { sourceSampleId: sampleId }));
          }
          results.push(await processMessage(req.store, req.auth, sessionId, sample.payload, { sourceSampleId: sampleId }));
          return results;
        };
        const results = fast
          ? await withForceSimulated('演示链路：快速仿真模式', runTurns)
          : await runTurns();
        const final = results[results.length - 1];
        return {
          code: 0,
          message: 'ok',
          data: {
            sample_id: sampleId,
            setup_turns_executed: results.length - 1,
            turn: final.turn,
            reply: final.reply,
            actions: final.actions ?? [],
            max_risk: final.max_risk ?? 'none',
            call_ids: final.call_ids ?? [],
            mode: final.mode ?? 'live',
          },
        };
      },
    },
  ];
}
