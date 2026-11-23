import { api } from './client';
import { idempotencyKey } from '@/utils/format';
import type {
  AgentConfig,
  Alert,
  AuthToken,
  CallRecord,
  CompareResult,
  ConfigPreview,
  Experiment,
  Instance,
  InstanceCreated,
  InstanceSuggestions,
  ItemsResult,
  MessageResult,
  Paginated,
  Policy,
  PolicySnapshot,
  QuotaStatus,
  Report,
  ReportCreated,
  Sample,
  SampleLoadResult,
  Session,
  SessionCreated,
  ShareLink,
  Template,
  TurnMessage,
  ValidationResult,
} from '@/types/api';

// 会话单轮为同步长任务：真实模型推理（每层最长 30s）+ 质询审批等待（最长 120s），
// 载入样本还会串行执行 setup + payload 两轮，故放宽客户端超时，避免误报发送失败。
const TURN_TIMEOUT_MS = 600000;

export const authApi = {
  guest: (clientId: string) => api.post<AuthToken>('/auth/guest', { client_id: clientId }),
  logout: () => api.post<{ revoked: boolean }>('/auth/logout'),
  quota: (sessionId?: string) => api.get<QuotaStatus>('/quota', sessionId ? { session_id: sessionId } : undefined),
};

export const configApi = {
  validate: (config: unknown) => api.post<ValidationResult>('/configs/validate', config),
  preview: (config: unknown) => api.post<ConfigPreview>('/configs/preview', config),
  suggestPrompt: (name: string, purpose: string) =>
    api.post<{ system_prompt: string; simulated: boolean }>('/configs/suggest-prompt', { name, purpose }, { timeout: 60000 }),
  create: (config: unknown) => api.post<{ config_id: string; version: string }>('/configs', config),
};

export const templateApi = {
  list: (page = 1, pageSize = 50) => api.get<Paginated<Template>>('/templates', { page, page_size: pageSize }),
};

export const instanceApi = {
  list: (status?: string, page = 1, pageSize = 100) =>
    api.get<Paginated<Instance>>('/instances', { status, page, page_size: pageSize }),
  get: (id: string) => api.get<Instance>(`/instances/${id}`),
  suggestions: (id: string) => api.get<InstanceSuggestions>(`/instances/${id}/suggestions`),
  create: (payload: { config_id?: string; config?: AgentConfig; name?: string; guard_preset?: string }) =>
    api.post<InstanceCreated>('/instances', payload, { headers: { 'X-Idempotency-Key': idempotencyKey('inst') } }),
  clone: (
    id: string,
    payload: { mode?: 'verbatim' | 'modified'; modified_config?: Record<string, unknown>; name?: string; guard_preset?: string; diff_note?: string }
  ) => api.post<InstanceCreated>(`/instances/${id}/clone`, payload),
  recycle: (id: string) => api.post<{ instance_id: string; status: string }>(`/instances/${id}/recycle`, { confirm: true }),
  renew: (id: string) => api.post<{ instance_id: string; expires_at: string }>(`/instances/${id}/renew`),
  policies: (id: string) => api.get<ItemsResult<Policy>>(`/instances/${id}/policies`),
  policySnapshot: (id: string) => api.get<PolicySnapshot>(`/instances/${id}/policies/snapshot`),
  overridePolicy: (id: string, policyId: string, payload: Record<string, unknown>) =>
    api.put<{ instance_id: string; policy_snapshot_id: string; policy_id: string }>(`/instances/${id}/policies/${policyId}`, payload),
};

export const sessionApi = {
  list: (instanceId?: string, page = 1, pageSize = 100) =>
    api.get<Paginated<Session>>('/sessions', { instance_id: instanceId, page, page_size: pageSize }),
  get: (id: string) => api.get<Session>(`/sessions/${id}`),
  create: (instanceId: string, guardEnabled = true) =>
    api.post<SessionCreated>('/sessions', { instance_id: instanceId, guard_enabled: guardEnabled }),
  sendMessage: (id: string, payload: { content: string; skip_guard?: boolean; source_sample_id?: string; actor?: string }) =>
    // 单轮同步等待真实模型推理与质询审批（最长 120s），远超默认 60s，需放宽客户端超时。
    api.post<MessageResult>(`/sessions/${id}/messages`, payload, { timeout: TURN_TIMEOUT_MS }),
  pause: (id: string) => api.post<{ session_id: string; status: string }>(`/sessions/${id}/pause`),
  resume: (id: string) => api.post<{ session_id: string; status: string }>(`/sessions/${id}/resume`),
  terminate: (id: string) => api.post<{ session_id: string; status: string; terminated_at: string }>(`/sessions/${id}/terminate`),
  reset: (id: string) =>
    api.post<{ previous_session_id: string; session_id: string; status: string; policy_snapshot_id: string }>(`/sessions/${id}/reset`),
  calls: (id: string) => api.get<ItemsResult<CallRecord>>(`/sessions/${id}/calls`),
  messages: (id: string) => api.get<ItemsResult<TurnMessage>>(`/sessions/${id}/messages`),
  alerts: (id: string, level?: string, action?: string) =>
    api.get<ItemsResult<Alert>>(`/sessions/${id}/alerts`, { level, action }),
  alertFeedback: (alertId: string, payload: { false_positive?: boolean; false_negative?: boolean; note?: string }) =>
    api.post<Alert>(`/alerts/${alertId}/feedback`, payload),
  challenge: (sessionId: string, callId: string, approved: boolean) =>
    api.post<{ call_id: string; approved: boolean }>(`/sessions/${sessionId}/challenges/${callId}`, { approved }),
  startRedteam: (id: string, maxRounds = 5, timeLimitS = 120) =>
    api.post<{ session_id: string; status: string; max_rounds: number }>(`/sessions/${id}/redteam/start`, {
      max_rounds: maxRounds,
      time_limit_s: timeLimitS,
    }),
  stopRedteam: (id: string) => api.post<{ session_id: string; status: string }>(`/sessions/${id}/redteam/stop`),
  report: (id: string) =>
    api.post<ReportCreated>(`/sessions/${id}/report`, undefined, { headers: { 'X-Idempotency-Key': idempotencyKey('rpt') } }),
};

export const sampleApi = {
  list: (instanceId?: string, category?: string, page = 1, pageSize = 100) =>
    api.get<Paginated<Sample> & { categories: Record<string, string> }>('/samples', {
      instance_id: instanceId,
      category,
      page,
      page_size: pageSize,
    }),
  load: (sessionId: string, sampleId: string, force = false, fast = false) =>
    api.post<SampleLoadResult>(`/sessions/${sessionId}/samples/${sampleId}/load`, { force, fast }, { timeout: TURN_TIMEOUT_MS }),
};

export const experimentApi = {
  compare: (payload: {
    dimension: 'guard' | 'instance';
    source_session_id: string;
    input?: string;
    target_instance_id?: string;
    guard_enabled?: boolean;
  }) => api.post<CompareResult>('/experiments/compare', payload, { headers: { 'X-Idempotency-Key': idempotencyKey('exp') }, timeout: TURN_TIMEOUT_MS }),
  get: (pairId: string) => api.get<Experiment>(`/experiments/${pairId}`),
};

export const reportApi = {
  list: (sessionId?: string, page = 1, pageSize = 100) =>
    api.get<Paginated<Report>>('/reports', { session_id: sessionId, page, page_size: pageSize }),
  get: (id: string) => api.get<Report>(`/reports/${id}`),
  shareLink: (id: string, ttlHours = 72) => api.post<ShareLink>(`/reports/${id}/share-link`, { ttl_hours: ttlHours }),
  // PDF 改由浏览器端排版生成（见 @/services/report/exportPdf），后端不再提供 /export.pdf。
};