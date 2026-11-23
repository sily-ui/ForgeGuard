// 对应 internal/llm/proxy.py：OpenAI 兼容接口封装，主备档位、配额计数、超时与降级。
// 密钥仅来自平台 Secret（Deno.env），不入日志；未配置模型或强制仿真时走离线仿真分支。
import { simulatedChat } from './simulated.mjs';
import { checkGuestCallRate, consumeModelQuota, currentSimulatedReason } from './quota.mjs';
import { ModelUnavailable, settings } from './deps.mjs';

const DEFAULT_TIMEOUT_MS = { business: 30000, guardian: 30000, redteam: 30000 };

function usageOf(messages, content) {
  const prompt = messages.reduce((sum, m) => sum + String(m?.content ?? '').length, 0);
  return { prompt_tokens: Math.floor(prompt / 4), completion_tokens: Math.floor(content.length / 4) };
}

function providerChain(role) {
  const chain = [{
    label: 'primary',
    baseUrl: settings.modelBaseUrl,
    apiKey: settings.modelApiKey,
    model: role === 'guardian' ? settings.guardianModelName : settings.modelName,
  }];
  if (settings.fallbackConfigured) {
    chain.push({
      label: 'fallback',
      baseUrl: settings.fallbackModelBaseUrl,
      apiKey: settings.fallbackModelApiKey,
      model: settings.fallbackModelName,
    });
  }
  return chain;
}

function requestBody(provider, messages, maxTokens, temperature, responseFormat, stream = false) {
  const body = { model: provider.model, messages, max_tokens: maxTokens, temperature };
  if (responseFormat) body.response_format = responseFormat;
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

// 上游失败摘要：只取状态码与错误码，不保留响应原文（网关可能回显请求凭据）。
async function failureReason(resp) {
  let code = '';
  try {
    const error = (await resp.json())?.error ?? {};
    code = String(error.code || error.type || '');
  } catch { /* ignore */ }
  return `HTTP ${resp.status}` + (code ? ` code=${code}` : '');
}

function simulatedResult(messages, content) {
  return { content, usage: usageOf(messages, content), simulated: true };
}

/**
 * 一次性调用。opts: { store, sessionId, responseFormat, maxTokens, temperature, timeout(ms), billed }
 * ctx 为 AuthContext（游客限流与配额归属）；store 用于真实调用的配额扣减。
 */
export async function llmChat(role, messages, ctx = null, opts = {}) {
  const { store = null, sessionId = null, responseFormat = null, maxTokens = 900, temperature = 0.2, timeout = null, billed = false } = opts;
  checkGuestCallRate(ctx);
  const forced = currentSimulatedReason();
  if (!settings.modelConfigured || forced) {
    return simulatedResult(messages, simulatedChat(role, messages));
  }
  if (!billed) await consumeModelQuota(store, ctx, sessionId);
  const effectiveTimeout = timeout || DEFAULT_TIMEOUT_MS[role] || 10000;
  const failures = [];
  for (const provider of providerChain(role)) {
    let payload;
    try {
      const resp = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify(requestBody(provider, messages, maxTokens, temperature, responseFormat)),
        signal: AbortSignal.timeout(effectiveTimeout),
      });
      if (!resp.ok) {
        failures.push(`${provider.label}:${provider.model} ${await failureReason(resp)}`);
        continue;
      }
      payload = await resp.json();
    } catch (err) {
      failures.push(`${provider.label}:${provider.model} ${err?.name || 'FetchError'}`);
      continue;
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (!String(content ?? '').trim()) {
      failures.push(`${provider.label}:${provider.model} 返回空内容`);
      continue;
    }
    const usage = payload.usage ?? {};
    return {
      content,
      usage: { prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? 0 },
      simulated: false,
      provider: provider.label,
      model: provider.model,
    };
  }
  throw new ModelUnavailable(`所有模型档位均不可用：${failures.join('；')}`);
}

/**
 * 流式调用：逐块产出 ['delta', str]，最后产出 ['end', 汇总帧]。
 * 上游不支持流式或中途断流时抛 ModelUnavailable，由调用方决定回退策略。
 */
export async function* llmChatStream(role, messages, ctx = null, opts = {}) {
  const { store = null, sessionId = null, responseFormat = null, maxTokens = 900, temperature = 0.2, timeout = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  checkGuestCallRate(ctx);
  const forced = currentSimulatedReason();
  if (!settings.modelConfigured || forced) {
    const content = simulatedChat(role, messages);
    const step = Math.max(8, Math.floor(content.length / 24));
    for (let i = 0; i < content.length; i += step) {
      yield ['delta', content.slice(i, i + step)];
      await sleep(20);
    }
    yield ['end', simulatedResult(messages, content)];
    return;
  }
  await consumeModelQuota(store, ctx, sessionId);
  const effectiveTimeout = timeout || DEFAULT_TIMEOUT_MS[role] || 10000;
  const failures = [];
  for (const provider of providerChain(role)) {
    const parts = [];
    let usage = {};
    try {
      const resp = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify(requestBody(provider, messages, maxTokens, temperature, responseFormat, true)),
        signal: AbortSignal.timeout(effectiveTimeout),
      });
      if (!resp.ok) {
        failures.push(`${provider.label}:${provider.model} ${await failureReason(resp)}`);
        continue;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') { buf = ''; break; }
          let chunk;
          try { chunk = JSON.parse(raw); } catch { continue; }
          if (chunk.usage) usage = chunk.usage;
          const choices = chunk.choices ?? [];
          if (!choices.length) continue;
          let delta = choices[0]?.delta?.content;
          if (!delta) delta = choices[0]?.message?.content;
          if (delta) {
            parts.push(delta);
            yield ['delta', delta];
          }
        }
      }
    } catch (err) {
      const reason = err?.name || 'FetchError';
      if (parts.length) {
        // 已向下游吐出增量，切档会重复输出，只能整体交由调用方降级。
        throw new ModelUnavailable(`模型流式调用中断：${reason}`);
      }
      failures.push(`${provider.label}:${provider.model} ${reason}`);
      continue;
    }
    const content = parts.join('');
    if (!content) {
      failures.push(`${provider.label}:${provider.model} 流式返回为空`);
      continue;
    }
    yield ['end', {
      content,
      usage: { prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? Math.floor(content.length / 4) },
      simulated: false,
      provider: provider.label,
      model: provider.model,
    }];
    return;
  }
  throw new ModelUnavailable(`所有模型档位均不可用：${failures.join('；')}`);
}