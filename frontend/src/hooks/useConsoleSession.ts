import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { sessionApi, instanceApi, sampleApi, reportApi } from '@/services/api/resources';
import { SessionEventSource } from '@/services/sse/SessionEventSource';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { useQuotaStore } from '@/stores/quotaStore';
import { ApiClientError } from '@/services/api/client';

// 控制台数据编排：REST 水合 + SSE 实时合并 + 全部会话动作。
export function useConsoleSession(sessionId: string) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const store = useSessionStore();
  const sseRef = useRef<SessionEventSource | null>(null);
  const refreshQuota = useQuotaStore((s) => s.refresh);

  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionApi.get(sessionId),
    enabled: !!token && !!sessionId,
  });

  const instanceQuery = useQuery({
    queryKey: ['instance', sessionQuery.data?.instance_id],
    queryFn: () => instanceApi.get(sessionQuery.data!.instance_id),
    enabled: !!sessionQuery.data?.instance_id,
  });

  // 水合 + SSE 生命周期
  useEffect(() => {
    if (!sessionId || !token) return;
    useSessionStore.getState().reset(sessionId);
    let cancelled = false;

    (async () => {
      try {
        // 与 sessionQuery / ConsolePage 共用 react-query 缓存键，同键并发请求自动去重。
        const [session, callsRes, alertsRes, messagesRes] = await Promise.all([
          queryClient.fetchQuery({ queryKey: ['session', sessionId], queryFn: () => sessionApi.get(sessionId) }),
          queryClient.fetchQuery({ queryKey: ['console-full-calls', sessionId], queryFn: () => sessionApi.calls(sessionId) }),
          sessionApi.alerts(sessionId),
          sessionApi.messages(sessionId),
        ]);
        if (cancelled) return;
        useSessionStore.getState().hydrate(session, callsRes.items, alertsRes.items, messagesRes.items);
        useSessionStore.getState().setConnection('connecting');
        refreshQuota(sessionId);

        const sse = new SessionEventSource({
          sessionId,
          token,
          onEvent: (record) => useSessionStore.getState().applyEvent(record),
          onOpen: () => useSessionStore.getState().setConnection('open'),
          onClose: () => useSessionStore.getState().setConnection('closed'),
          onError: () => useSessionStore.getState().setConnection('error'),
        });
        sseRef.current = sse;
        sse.start();
      } catch (err) {
        if (!cancelled) {
          useSessionStore.getState().setConnection('error');
          message.error(err instanceof ApiClientError ? err.message : '会话加载失败');
        }
      }
    })();

    return () => {
      cancelled = true;
      sseRef.current?.stop();
      sseRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  // 会话状态变化时刷新元数据；按 turn 单调性丢弃过期 REST 快照，避免覆盖 SSE 已推送的新状态。
  useEffect(() => {
    const data = sessionQuery.data;
    if (!data) return;
    const current = useSessionStore.getState().session;
    if (current && current.session_id === data.session_id && data.turn < current.turn) return;
    useSessionStore.getState().setSession(data);
  }, [sessionQuery.data]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    refreshQuota(sessionId);
  }, [queryClient, sessionId, refreshQuota]);

  const sendMutation = useMutation({
    mutationFn: (payload: { content: string; skip_guard?: boolean; source_sample_id?: string; actor?: string }) =>
      sessionApi.sendMessage(sessionId, payload),
    onMutate: (payload) => {
      useSessionStore.getState().setSending(true);
      useSessionStore.getState().addUserMessage(payload.content, payload.actor || 'business', payload.source_sample_id ?? null);
    },
    onSuccess: (data) => {
      useSessionStore.getState().upsertAssistantMessage(data.message_id, data.reply, data.turn, 'business');
      useSessionStore.getState().setSending(false);
      invalidate();
    },
    onError: (err) => {
      useSessionStore.getState().setSending(false);
      message.error(err instanceof ApiClientError ? err.message : '消息发送失败');
      invalidate();
    },
  });

  const loadSampleMutation = useMutation({
    mutationFn: ({ sampleId, force }: { sampleId: string; force?: boolean }) =>
      sampleApi.load(sessionId, sampleId, force),
    onSuccess: (data) => {
      message.success(`样本已载入，第 ${data.turn} 回合完成`);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['samples'] });
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 40900) {
        message.warning(err.message);
      } else {
        message.error(err instanceof ApiClientError ? err.message : '样本载入失败');
      }
    },
  });

  const challengeMutation = useMutation({
    mutationFn: ({ callId, approved }: { callId: string; approved: boolean }) =>
      sessionApi.challenge(sessionId, callId, approved),
    onSuccess: (data) => {
      useSessionStore.getState().resolveChallengeLocal(data.call_id, data.approved);
      message.success(data.approved ? '已批准本次调用' : '已拒绝本次调用');
      invalidate();
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '质询处理失败'),
  });

  const redteamStart = useMutation({
    mutationFn: (params: { maxRounds: number; timeLimitS: number }) =>
      sessionApi.startRedteam(sessionId, params.maxRounds, params.timeLimitS),
    onSuccess: () => {
      useSessionStore.getState().setRedteamRunning(true);
      useSessionStore.getState().addSystemMessage('红队自动攻击已启动');
      message.success('红队已启动');
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '红队启动失败'),
  });

  const redteamStop = useMutation({
    mutationFn: () => sessionApi.stopRedteam(sessionId),
    onSuccess: () => {
      useSessionStore.getState().setRedteamRunning(false);
      message.success('红队停止中');
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '红队停止失败'),
  });

  const pauseMutation = useMutation({
    mutationFn: () => sessionApi.pause(sessionId),
    onSuccess: () => { invalidate(); message.success('会话已暂停'); },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '暂停失败'),
  });
  const resumeMutation = useMutation({
    mutationFn: () => sessionApi.resume(sessionId),
    onSuccess: () => { invalidate(); message.success('会话已恢复'); },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '恢复失败'),
  });
  const terminateMutation = useMutation({
    mutationFn: () => sessionApi.terminate(sessionId),
    onSuccess: () => { invalidate(); message.success('会话已终止'); },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '终止失败'),
  });

  const reportMutation = useMutation({
    mutationFn: () => sessionApi.report(sessionId),
    onSuccess: (data) => {
      message.success('报告已生成');
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      navigate(`/reports/${data.report_id}`);
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '报告生成失败'),
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ alertId, payload }: { alertId: string; payload: { false_positive?: boolean; false_negative?: boolean; note?: string } }) =>
      sessionApi.alertFeedback(alertId, payload),
    onSuccess: (alert) => {
      useSessionStore.getState().updateAlert(alert);
      message.success('反馈已记录');
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '反馈失败'),
  });

  return {
    session: store.session ?? sessionQuery.data ?? null,
    instance: instanceQuery.data ?? null,
    loading: sessionQuery.isLoading,
    error: sessionQuery.error,
    send: sendMutation.mutate,
    sending: store.sending || sendMutation.isPending,
    loadSample: loadSampleMutation.mutate,
    loadingSample: loadSampleMutation.isPending,
    resolveChallenge: challengeMutation.mutate,
    startRedteam: redteamStart.mutate,
    stopRedteam: redteamStop.mutate,
    redteamPending: redteamStart.isPending,
    pause: pauseMutation.mutate,
    resume: resumeMutation.mutate,
    terminate: terminateMutation.mutate,
    generateReport: reportMutation.mutate,
    reporting: reportMutation.isPending,
    feedback: feedbackMutation.mutate,
    refresh: invalidate,
  };
}