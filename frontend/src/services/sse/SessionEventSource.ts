import { fetchEventSource } from '@microsoft/fetch-event-source';
import type { SseEventType, SseRecord } from '@/types/api';

export type SseHandler = (record: SseRecord) => void;

interface Options {
  sessionId: string;
  token: string;
  onEvent: SseHandler;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

// 单会话 SSE 通道：断点续传（Last-Event-ID）、按事件 ID 去重、自动重连。
export class SessionEventSource {
  private controller: AbortController | null = null;
  private lastId = 0;
  private seen = new Set<number>();
  private stopped = false;
  private opts: Options;

  constructor(opts: Options) {
    this.opts = opts;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  private connect() {
    if (this.stopped) return;
    this.controller = new AbortController();
    const { sessionId, token } = this.opts;
    const params = new URLSearchParams({ token });
    if (this.lastId > 0) params.set('last_event_id', String(this.lastId));
    const url = `/api/v1/sessions/${sessionId}/events?${params.toString()}`;

    fetchEventSource(url, {
      signal: this.controller.signal,
      openWhenHidden: true,
      onopen: async (response) => {
        if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
          this.opts.onOpen?.();
          return;
        }
        if (response.status === 401 || response.status === 403) {
          this.stopped = true;
          this.opts.onError?.(new Error('SSE 认证失效'));
          throw new FatalError('auth');
        }
        throw new Error(`SSE 连接失败: ${response.status}`);
      },
      onmessage: (msg) => {
        if (!msg.event || !msg.data) return;
        const id = msg.id ? parseInt(msg.id, 10) : NaN;
        if (!Number.isNaN(id)) {
          if (this.seen.has(id)) return;
          this.seen.add(id);
          if (this.seen.size > 1000) {
            const arr = Array.from(this.seen).sort((a, b) => a - b);
            this.seen = new Set(arr.slice(-500));
          }
          this.lastId = Math.max(this.lastId, id);
        }
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(msg.data);
        } catch {
          return;
        }
        this.opts.onEvent({ id: Number.isNaN(id) ? this.lastId : id, event: msg.event as SseEventType, data });
      },
      onerror: (err) => {
        if (err instanceof FatalError) {
          throw err;
        }
        this.opts.onError?.(err);
        // 返回重试间隔（毫秒），库会自动重连并带上 Last-Event-ID。
        return 2000;
      },
      onclose: () => {
        this.opts.onClose?.();
      },
    }).catch((err) => {
      if (!this.stopped && !(err instanceof FatalError)) {
        this.opts.onError?.(err);
      }
    });
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
  }
}

class FatalError extends Error {}