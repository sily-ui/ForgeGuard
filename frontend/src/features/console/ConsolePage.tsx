import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Input, Modal, Segmented, Select, Spin, Tag, Tooltip } from 'antd';
import {
  ArrowLeft,
  Pause,
  Play,
  OctagonX,
  RotateCcw,
  FileBarChart,
  GitCompare,
  Wifi,
  WifiOff,
  Loader2,
  Swords,
  Boxes,
} from 'lucide-react';
import { useConsoleSession } from '@/hooks/useConsoleSession';
import { sessionApi, experimentApi, instanceApi } from '@/services/api/resources';
import { ApiClientError } from '@/services/api/client';
import { useSessionStore } from '@/stores/sessionStore';
import { TopStatusBar } from '@/components/layout/TopStatusBar';
import { Logo } from '@/components/common/Logo';
import { confirmAction } from '@/components/common/confirmAction';
import { ChatPanel } from './ChatPanel';
import { ChainPanel } from './ChainPanel';
import { JudgePanel } from './JudgePanel';
import type { TopologyState } from '@/components/visualization/TopologyGraph';
import type { CallRecord } from '@/types/api';
import { SESSION_STATUS_META } from '@/utils/constants';

export default function ConsolePage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const ctrl = useConsoleSession(sessionId);
  const { session, instance } = ctrl;

  const connection = useSessionStore((s) => s.connection);
  const lastActivity = useSessionStore((s) => s.lastActivity);
  const alerts = useSessionStore((s) => s.alerts);
  const callOrder = useSessionStore((s) => s.callOrder);
  const selectedCallId = useSessionStore((s) => s.selectedCallId);
  const setSelectedCall = useSessionStore((s) => s.setSelectedCall);

  const [activeTool, setActiveTool] = useState<string | undefined>();
  const [pulse, setPulse] = useState(0);
  const [compareOpen, setCompareOpen] = useState(false);

  // 完整调用取证（含分层 layers / 原始入参 / 沙盒结果），随活动刷新。
  const fullCallsQuery = useQuery({
    queryKey: ['console-full-calls', sessionId],
    queryFn: () => sessionApi.calls(sessionId),
    enabled: !!sessionId,
  });
  const fullCalls = useMemo(() => {
    const map: Record<string, CallRecord> = {};
    for (const c of fullCallsQuery.data?.items ?? []) map[c.call_id] = c;
    return map;
  }, [fullCallsQuery.data]);

  const refetchRef = useRef(fullCallsQuery.refetch);
  refetchRef.current = fullCallsQuery.refetch;
  useEffect(() => {
    if (lastActivity) {
      setActiveTool(lastActivity.tool);
      setPulse((p) => p + 1);
      refetchRef.current();
      const t = setTimeout(() => setActiveTool(undefined), 1700);
      return () => clearTimeout(t);
    }
  }, [lastActivity?.at]);
  useEffect(() => {
    if (selectedCallId) refetchRef.current();
  }, [selectedCallId]);

  const topology: TopologyState = useMemo(
    () => ({
      enabledTools: instance?.enabled_tools ?? [],
      activeTool,
      lastAction: lastActivity?.action,
      blockCount: session?.block_count ?? 0,
      alertCount: alerts.length,
      callCount: session?.call_count ?? callOrder.length,
      guardOn: session?.guard_enabled ?? true,
      pulse,
    }),
    [instance, activeTool, lastActivity, session, alerts.length, callOrder.length, pulse],
  );

  const resetMutation = useMutation({
    mutationFn: () => sessionApi.reset(sessionId),
    onSuccess: (data) => {
      message.success('会话已重置，进入新会话');
      navigate(`/console/${data.session_id}`, { replace: true });
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '重置失败'),
  });

  const status = session?.status ?? 'active';
  const terminated = status === 'terminated';

  const doTerminate = () =>
    confirmAction({
      title: '终止当前会话？',
      content: '终止后会话不可再发送消息，可生成报告或重置开启新会话。此操作不可撤销。',
      okText: '终止会话',
      onOk: () => ctrl.terminate(),
    });

  const doReset = () =>
    confirmAction({
      title: '重置会话？',
      content: '将基于当前实例与最新策略快照创建一个全新会话，当前会话保留为历史。',
      okText: '重置并进入新会话',
      danger: false,
      onOk: () => resetMutation.mutate(),
    });

  if (ctrl.loading && !session) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Logo size={48} />
        <Spin />
        <div style={{ color: 'var(--fg-text-3)', fontSize: 13 }}>正在接入攻防控制台…</div>
      </div>
    );
  }

  return (
    <>
      {/* 实验舱导航 */}
      <div className="fg-lab-nav" style={labNavStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Button size="small" icon={<ArrowLeft size={14} />} onClick={() => navigate('/instances')} style={{ flexShrink: 0 }}>
            实例管理
          </Button>
          <Logo size={24} />
          <span style={{ fontSize: 12.5, color: 'var(--fg-text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            攻防控制台 <span style={{ color: 'var(--fg-text-3)' }}>/</span>{' '}
            <b style={{ color: 'var(--fg-text-1)' }}>{session?.instance_name ?? '—'}</b>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConnectionBadge connection={connection} />
          <span data-tour="compare-btn" style={{ display: 'inline-flex' }}>
            <Button size="small" icon={<GitCompare size={14} />} onClick={() => setCompareOpen(true)} disabled={terminated}>
              对照实验
            </Button>
          </span>
        </div>
      </div>

      <TopStatusBar preset={instance?.guard.preset ?? 'standard'} guardDisabled />

      {/* 三栏主体 */}
      <div className="fg-console-grid" style={bodyStyle}>
        <ChatPanel
          sessionId={sessionId}
          instanceId={session?.instance_id}
          status={status}
          sending={ctrl.sending}
          loadingSample={ctrl.loadingSample}
          redteamPending={ctrl.redteamPending}
          onSend={ctrl.send}
          onLoadSample={ctrl.loadSample}
          onStartRedteam={ctrl.startRedteam}
          onStopRedteam={ctrl.stopRedteam}
        />
        <ChainPanel topology={topology} onSelectCall={setSelectedCall} />
        <JudgePanel fullCalls={fullCalls} onResolveChallenge={ctrl.resolveChallenge} onFeedback={ctrl.feedback} />
      </div>

      {/* 底部控制条 */}
      <div className="fg-lab-controlbar" style={controlBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Tag color={status === 'active' ? 'success' : status === 'paused' ? 'warning' : 'default'} style={{ margin: 0 }}>
            {SESSION_STATUS_META[status]?.label ?? status}
          </Tag>
          <span style={{ fontSize: 11.5, color: 'var(--fg-text-3)' }}>
            第 <b className="mono" style={{ color: 'var(--fg-text-2)' }}>{session?.turn ?? 0}</b> 回合 ·{' '}
            <b className="mono" style={{ color: 'var(--fg-text-2)' }}>{session?.call_count ?? 0}</b> 次调用
          </span>
          {session?.degradations && session.degradations.length > 0 && (
            <Tooltip title={session.degradations.join('；')}>
              <Tag color="warning" style={{ margin: 0 }}>降级 {session.degradations.length}</Tag>
            </Tooltip>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {status === 'active' && (
            <Button size="small" icon={<Pause size={14} />} onClick={() => ctrl.pause()}>
              暂停
            </Button>
          )}
          {status === 'paused' && (
            <Button size="small" type="primary" icon={<Play size={14} />} onClick={() => ctrl.resume()}>
              恢复
            </Button>
          )}
          <Button size="small" icon={<RotateCcw size={14} />} loading={resetMutation.isPending} onClick={doReset}>
            重置
          </Button>
          <Button size="small" danger icon={<OctagonX size={14} />} disabled={terminated} onClick={doTerminate}>
            终止
          </Button>
          <Button
            size="small"
            type="primary"
            icon={ctrl.reporting ? <Loader2 size={14} className="fg-spin" /> : <FileBarChart size={14} />}
            loading={ctrl.reporting}
            onClick={() => ctrl.generateReport()}
          >
            生成报告
          </Button>
        </div>
      </div>

      <CompareModal
        open={compareOpen}
        sessionId={sessionId}
        currentInstanceId={session?.instance_id}
        guardEnabled={session?.guard_enabled ?? true}
        onCancel={() => setCompareOpen(false)}
        onDone={(pairId) => {
          setCompareOpen(false);
          navigate(`/experiments/${pairId}`);
        }}
      />
    </>
  );
}

function ConnectionBadge({ connection }: { connection: string }) {
  const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    open: { label: '实时连接', color: 'var(--fg-allow-text)', icon: <Wifi size={12} /> },
    connecting: { label: '连接中', color: 'var(--fg-observe-text)', icon: <Loader2 size={12} className="fg-spin" /> },
    error: { label: '连接异常', color: 'var(--fg-block-text)', icon: <WifiOff size={12} /> },
    closed: { label: '已断开', color: 'var(--fg-text-3)', icon: <WifiOff size={12} /> },
  };
  const m = map[connection] ?? map.closed;
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: m.color, padding: '3px 9px', borderRadius: 20, background: 'var(--fg-bg-subtle)', border: '1px solid var(--fg-border)' }}>
      {m.icon}
      {m.label}
    </span>
  );
}

function CompareModal({
  open,
  sessionId,
  currentInstanceId,
  guardEnabled,
  onCancel,
  onDone,
}: {
  open: boolean;
  sessionId: string;
  currentInstanceId?: string;
  guardEnabled: boolean;
  onCancel: () => void;
  onDone: (pairId: string) => void;
}) {
  const { message } = App.useApp();
  const [dimension, setDimension] = useState<'guard' | 'instance'>('guard');
  const [targetId, setTargetId] = useState<string | undefined>();
  const [input, setInput] = useState('');

  const instancesQuery = useQuery({
    queryKey: ['instances-for-compare'],
    queryFn: () => instanceApi.list('ready', 1, 100),
    enabled: open && dimension === 'instance',
  });
  const targets = (instancesQuery.data?.items ?? []).filter((i) => i.instance_id !== currentInstanceId);

  const compareMutation = useMutation({
    mutationFn: () =>
      experimentApi.compare({
        dimension,
        source_session_id: sessionId,
        input: input.trim() || undefined,
        target_instance_id: dimension === 'instance' ? targetId : undefined,
      }),
    onSuccess: (data) => {
      message.success('对照实验已生成');
      onDone(data.pair_id);
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '对照实验失败'),
  });

  const canSubmit = dimension === 'guard' || !!targetId;

  return (
    <Modal
      open={open}
      title="发起对照实验"
      onCancel={onCancel}
      onOk={() => compareMutation.mutate()}
      confirmLoading={compareMutation.isPending}
      okText="生成对照"
      cancelText="取消"
      okButtonProps={{ disabled: !canSubmit }}
      width={520}
      centered
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
        <Segmented
          block
          value={dimension}
          onChange={(v) => setDimension(v as 'guard' | 'instance')}
          options={[
            { label: '防护对照', value: 'guard' },
            { label: '实例对照', value: 'instance' },
          ]}
        />
        {dimension === 'guard' ? (
          <div style={compareHintStyle}>
            <Swords size={15} style={{ color: 'var(--fg-observe)', flexShrink: 0, marginTop: 2 }} />
            <span>
              以当前会话为起点（A 组，防护<b>{guardEnabled ? '开启' : '关闭'}</b>），创建同实例的 B 组会话并
              <b>取消防护开关</b>（防护{guardEnabled ? '关闭' : '开启'}），重放同一输入，逐步对比判定差异。
            </span>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Boxes size={13} /> 选择对照实例（B 组）
            </div>
            <Select
              value={targetId}
              onChange={setTargetId}
              placeholder="选择一个就绪实例"
              style={{ width: '100%' }}
              loading={instancesQuery.isLoading}
              options={targets.map((i) => ({ value: i.instance_id, label: `${i.name}（${i.guard.preset}）` }))}
              notFoundContent={instancesQuery.isLoading ? <Spin size="small" /> : '无其他就绪实例，请先克隆或创建'}
            />
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>对照输入（可选）</div>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            placeholder="留空则复用起点会话的首轮输入"
            maxLength={500}
          />
        </div>
      </div>
    </Modal>
  );
}

const labNavStyle: React.CSSProperties = {
  height: 46,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 16px',
  borderBottom: '1px solid var(--fg-border)',
  background: 'var(--fg-bg-subtle)',
};
const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 30fr) minmax(360px, 42fr) minmax(280px, 28fr)',
  gap: 12,
  padding: 12,
  overflow: 'hidden',
};
const controlBarStyle: React.CSSProperties = {
  height: 54,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 16px',
  borderTop: '1px solid var(--fg-border)',
  background: 'var(--fg-bg-subtle)',
};
const compareHintStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  fontSize: 12.5,
  color: 'var(--fg-text-2)',
  lineHeight: 1.7,
  background: 'var(--fg-bg-subtle)',
  border: '1px solid var(--fg-border)',
  borderRadius: 9,
  padding: 12,
};