import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : '—';
}

export function formatShort(iso?: string | null): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.format('MM-DD HH:mm') : '—';
}

export function fromNow(iso?: string | null): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.fromNow() : '—';
}

export function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function percent(used: number, max: number): number {
  if (!max) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

export function truncate(text: string, len = 80): string {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '…' : text;
}

export function paramsSummaryText(summary: Record<string, unknown>): string {
  const entries = Object.entries(summary || {});
  if (!entries.length) return '—';
  return entries
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('  ');
}

let memoryClientId: string | null = null;
export function clientId(): string {
  // 隐私模式等存储被禁用的场景回退内存 ID，保证游客准入不中断。
  try {
    const existing = sessionStorage.getItem('fg_client_id');
    if (existing) return existing;
  } catch {
    /* storage unavailable */
  }
  if (!memoryClientId) {
    const rand =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    memoryClientId = `web-${rand}`;
    try {
      sessionStorage.setItem('fg_client_id', memoryClientId);
    } catch {
      /* storage unavailable */
    }
  }
  return memoryClientId;
}

export function idempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}