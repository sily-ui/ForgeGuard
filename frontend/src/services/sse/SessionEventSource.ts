import { fetchEventSource } from '@microsoft/fetch-event-source';
import { API_BASE } from '@/services/api/client';
import type { SseEventType, SseRecord } from '@/types/api';
import { getWorkspaceId } from '@/utils/workspace';

export type SseHandler = (record: SseRecord) => void;

interface Options {
  sessionId: string;
  token: string;
  onEvent: SseHandler;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

// 单会话 SSE 通道：断点续传（Last-Event-ID）、按事件 ID 去重、指数退避自动重连。
const MAX_RETRIES = 10;
const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

export class SessionEventSource {
  private controller: AbortController | null = null;
  private lastId = 0;
  private seen = new Set<number>();
  private stopped = false;
  private retries = 0;
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
    const params = new URLSearchParams();
    if (this.lastId > 0) params.set('last_event_id', String(this.lastId));
    const qs = params.toString();
    const url = `${API_BASE}/sessions/${sessionId}/events${qs ? `?${qs}` : ''}`;

    fetchEventSource(url, {
      signal: this.controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'X-BeforeBound-Token': token, 'X-Workspace-Id': getWorkspaceId() },
      openWhenHidden: true,
      onopen: async (response) => {
        if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
          this.retries = 0;
          this.opts.onOpen?.();
          return;
        }
        if (response.status === 401 || response.status === 403) {
          this.stopped = true;
          this.opts.onError?.(new Error('SSE 认证失效'));
          throw new FatalError('auth');
        }
        // 会话已删除/不存在：重连无意义，直接终止。
        if (response.status === 404 || response.status === 410) {
          this.stopped = true;
          this.opts.onError?.(new Error('会话不存在或已删除'));
          throw new FatalError('gone');
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
        this.retries += 1;
        if (this.retries > MAX_RETRIES) {
          this.stopped = true;
          this.opts.onError?.(new Error('SSE 重连次数已达上限，请刷新页面'));
          throw new FatalError('retries-exhausted');
        }
        // 指数退避 + 抖动，封顶 30s；返回重试间隔（毫秒），库自动带 Last-Event-ID 重连。
        const backoff = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (this.retries - 1));
        return backoff + Math.random() * 500;
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