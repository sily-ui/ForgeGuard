// HTTP 层的两类非信封响应：SSE 流与 ETag 协商缓存资产（对应 FastAPI 的 StreamingResponse / Response）。
import { eventBus } from './events.mjs';

export function sseFrame(record) {
  return `id: ${record.id}\nevent: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`;
}

function nextWithTimeout(queue, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), ms); });
  return Promise.race([queue.next().then((r) => ({ timeout: false, ...r })), timeout]).finally(() => clearTimeout(timer));
}

export function sseResponse({ sessionId, lastId = 0, limit = null, follow = true, signal = null }) {
  const encoder = new TextEncoder();
  const queue = eventBus.subscribe(sessionId);
  let finished = false;
  const finish = (controller) => {
    if (finished) return;
    finished = true;
    eventBus.unsubscribe(sessionId, queue);
    try { controller.close(); } catch { /* 已关闭或客户端断开 */ }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (text) => { if (!finished) controller.enqueue(encoder.encode(text)); };
      const onAbort = () => finish(controller);
      if (signal) {
        if (signal.aborted) { finish(controller); return; }
        signal.addEventListener('abort', onAbort);
      }
      try {
        let sent = 0;
        for (const record of eventBus.historySince(sessionId, lastId)) {
          send(sseFrame(record));
          sent += 1;
          if (limit != null && sent >= limit) return;
        }
        if (!follow) return;
        while (!finished) {
          const result = await nextWithTimeout(queue, 15000);
          if (finished) return;
          if (result.timeout) {
            // 对应 Python 的 ": keepalive"：仅维持连接，不参与 id/event/data 解析。
            send(': keepalive\n\n');
            continue;
          }
          if (result.done) return;
          send(sseFrame(result.value));
          sent += 1;
          if (limit != null && sent >= limit) return;
        }
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        finish(controller);
      }
    },
    cancel() {
      finished = true;
      eventBus.unsubscribe(sessionId, queue);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

// 对应 reports.py 的 _cached_asset：以快照标识（而非字节）做 ETag，支持 If-None-Match。
export async function cachedAsset({ request, content, mediaType, version, extraHeaders = null }) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(version)));
  const etag = `"${hex([...new Uint8Array(digest)]).slice(0, 32)}"`;
  const headers = { 'cache-control': `private, max-age=${3600}`, etag, ...(extraHeaders || {}) };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(content, { status: 200, headers: { 'content-type': mediaType, ...headers } });
}
