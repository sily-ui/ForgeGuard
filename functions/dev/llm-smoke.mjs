// 真实模型连通性冒烟（仅本机开发用）：从本机 backend/.env 加载 MODEL_* 到进程环境，
// 经 llm.mjs 走一次真实调用，只输出元数据（档位/模型名/令牌数/长度），绝不输出密钥或内容正文。
// 运行：node functions/dev/llm-smoke.mjs
import { readFileSync } from 'node:fs';

const ENV_PATH = 'D:/Python练习/ForgeGuard/backend/.env';
const ALLOWED = [/^MODEL_API_KEY$/, /^MODEL_BASE_URL$/, /^MODEL_NAME$/, /^GUARDIAN_MODEL_NAME$/,
  /^FALLBACK_MODEL_API_KEY$/, /^FALLBACK_MODEL_BASE_URL$/, /^FALLBACK_MODEL_NAME$/];

for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const idx = trimmed.indexOf('=');
  const key = trimmed.slice(0, idx).trim();
  if (!ALLOWED.some((re) => re.test(key))) continue;
  if (!(key in process.env)) process.env[key] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
}

// 环境就绪后再动态导入（deps.mjs 在导入时快照 env）。
const { makeFakeDb } = await import('./fakeDb.mjs');
const { makeStore } = await import('../lib/store.mjs');
const { llmChat } = await import('../lib/llm.mjs');
const { settings, ModelUnavailable } = await import('../lib/deps.mjs');

if (!settings.modelConfigured) {
  console.log('SKIP: 本机 .env 未配置模型三件套');
  process.exit(0);
}
const store = makeStore(makeFakeDb());

try {
  const r = await llmChat('business', [
    { role: 'system', content: '只输出 JSON：{"reply":"你好","tool_calls":[]}' },
    { role: 'user', content: '打个招呼' },
  ], null, { store, responseFormat: { type: 'json_object' } });
  console.log(JSON.stringify({
    status: 'ok', provider: r.provider ?? '(sim)', model: r.model ?? '(sim)', simulated: r.simulated,
    prompt_tokens: r.usage.prompt_tokens, completion_tokens: r.usage.completion_tokens,
    content_bytes: String(r.content).length,
  }));
} catch (err) {
  console.log(JSON.stringify({ status: 'fail', kind: err instanceof ModelUnavailable ? 'ModelUnavailable' : String(err?.name) }));
  process.exitCode = 1;
}
