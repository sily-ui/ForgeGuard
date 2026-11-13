import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Empty, Input, InputNumber, Select, Spin, Switch, Tag, Tooltip } from 'antd';
import {
  Send,
  Bot,
  User,
  Swords,
  FlaskConical,
  Play,
  Square,
  ShieldOff,
  Loader2,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';
import { sampleApi } from '@/services/api/resources';
import { useSessionStore } from '@/stores/sessionStore';
import { CATEGORY_NAMES } from '@/utils/constants';
import { formatShort, truncate } from '@/utils/format';
import type { Sample, SessionStatus } from '@/types/api';

type Tab = 'chat' | 'samples' | 'redteam';

interface Props {
  sessionId: string;
  instanceId?: string;
  status: SessionStatus;
  sending: boolean;
  loadingSample: boolean;
  redteamPending: boolean;
  onSend: (payload: { content: string; skip_guard?: boolean; actor?: string }) => void;
  onLoadSample: (args: { sampleId: string; force?: boolean }) => void;
  onStartRedteam: (args: { maxRounds: number; timeLimitS: number }) => void;
  onStopRedteam: () => void;
}

export function ChatPanel({
  sessionId,
  instanceId,
  status,
  sending,
  loadingSample,
  redteamPending,
  onSend,
  onLoadSample,
  onStartRedteam,
  onStopRedteam,
}: Props) {
  const [tab, setTab] = useState<Tab>('chat');
  const redteamRunning = useSessionStore((s) => s.redteamRunning);
  const challengeCount = useSessionStore((s) => Object.keys(s.challenges).length);
  const terminated = status === 'terminated';

  return (
    <div data-tour="chat-panel" style={colStyle}>
      <div style={tabStripStyle}>
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={<Bot size={14} />} label="对话" />
        <TabButton active={tab === 'samples'} onClick={() => setTab('samples')} icon={<FlaskConical size={14} />} label="样本库" />
        <TabButton
          active={tab === 'redteam'}
          onClick={() => setTab('redteam')}
          icon={<Swords size={14} />}
          label="红队"
          dot={redteamRunning}
        />
        {challengeCount > 0 && (
          <Tooltip title={`${challengeCount} 个调用等待质询裁决，请在右侧「质询」处理`}>
            <span style={pendingPillStyle}>
              <ShieldOff size={11} /> {challengeCount}
            </span>
          </Tooltip>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'chat' && <ChatTab sending={sending} terminated={terminated} onSend={onSend} />}
        {tab === 'samples' && (
          <SamplesTab instanceId={instanceId} loading={loadingSample} terminated={terminated} onLoad={onLoadSample} />
        )}
        {tab === 'redteam' && (
          <RedteamTab
            running={redteamRunning}
            pending={redteamPending}
            terminated={terminated}
            onStart={onStartRedteam}
            onStop={onStopRedteam}
          />
        )}
      </div>
      <div style={colFooterStyle}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--fg-text-3)' }}>
          {sessionId}
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-text-3)' }}>内存仿真 · 不触及真实系统</span>
      </div>
    </div>
  );
}

function ChatTab({
  sending,
  terminated,
  onSend,
}: {
  sending: boolean;
  terminated: boolean;
  onSend: Props['onSend'];
}) {
  const messages = useSessionStore((s) => s.messages);
  const [content, setContent] = useState('');
  const [actor, setActor] = useState('business');
  const [skipGuard, setSkipGuard] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const submit = () => {
    const text = content.trim();
    if (!text || sending || terminated) return;
    onSend({ content: text, actor, skip_guard: skipGuard });
    setContent('');
  };

  return (
    <>
      <div ref={scrollRef} style={scrollAreaStyle}>
        {messages.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--fg-text-3)' }}>
            <Bot size={28} strokeWidth={1.4} style={{ opacity: 0.5, marginBottom: 10 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-text-2)' }}>开始一轮攻防对话</div>
            <div style={{ fontSize: 11.5, lineHeight: 1.7, marginTop: 6 }}>
              以业务用户或红队身份发送消息，
              <br />
              或从「样本库」载入预置攻击载荷。
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px 6px' }}>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {sending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg-text-3)', fontSize: 12, padding: '2px 4px' }}>
                <Loader2 size={13} className="fg-spin" /> Agent 正在响应…
              </div>
            )}
          </div>
        )}
      </div>
      <div style={composerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Select
            size="small"
            value={actor}
            onChange={setActor}
            style={{ width: 120 }}
            options={[
              { value: 'business', label: '业务用户' },
              { value: 'redteam', label: '红队攻击者' },
            ]}
          />
          <Tooltip title="本轮跳过旁路监护（对照演示），该轮结果不代表防护能力">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: skipGuard ? 'var(--fg-observe-text)' : 'var(--fg-text-3)' }}>
              <Switch size="small" checked={skipGuard} onChange={setSkipGuard} />
              跳过防护
            </span>
          </Tooltip>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Input.TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={terminated ? '会话已终止' : '输入消息，Enter 发送 / Shift+Enter 换行'}
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={terminated}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            style={{ flex: 1, resize: 'none' }}
          />
          <Button
            type="primary"
            icon={sending ? <Loader2 size={15} className="fg-spin" /> : <Send size={15} />}
            onClick={submit}
            disabled={!content.trim() || sending || terminated}
            style={{ height: 34 }}
          />
        </div>
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: ReturnType<typeof useSessionStore.getState>['messages'][number] }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--fg-text-3)',
            background: 'var(--fg-bg-subtle)',
            border: '1px solid var(--fg-border)',
            borderRadius: 20,
            padding: '3px 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Info size={11} /> {message.content}
        </span>
      </div>
    );
  }
  const redteam = message.actor === 'redteam';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--fg-text-3)' }}>
        {isUser ? (redteam ? <Swords size={11} /> : <User size={11} />) : <Bot size={11} />}
        {isUser ? (redteam ? '红队' : '业务用户') : 'Agent'}
        {message.turn != null && <span className="mono">· T{message.turn}</span>}
        {message.source_sample_id && (
          <Tag style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }} color="warning">
            样本
          </Tag>
        )}
      </span>
      <div
        style={{
          maxWidth: '92%',
          padding: '9px 12px',
          borderRadius: 12,
          fontSize: 12.5,
          lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: isUser ? (redteam ? 'rgba(232,180,90,0.14)' : 'var(--fg-brand-primary)') : 'var(--fg-bg-card)',
          color: isUser && !redteam ? '#fff' : 'var(--fg-text-1)',
          border: isUser ? 'none' : '1px solid var(--fg-border)',
          borderTopRightRadius: isUser ? 3 : 12,
          borderTopLeftRadius: isUser ? 12 : 3,
        }}
      >
        {message.content}
      </div>
    </div>
  );
}

function SamplesTab({
  instanceId,
  loading,
  terminated,
  onLoad,
}: {
  instanceId?: string;
  loading: boolean;
  terminated: boolean;
  onLoad: Props['onLoadSample'];
}) {
  const { message } = App.useApp();
  const samplesQuery = useQuery({
    queryKey: ['samples', instanceId],
    queryFn: () => sampleApi.list(instanceId, undefined, 1, 100),
    enabled: !!instanceId,
  });
  const [openCat, setOpenCat] = useState<string | null>(null);
  const items = samplesQuery.data?.items ?? [];
  const grouped = useMemo(() => {
    const g: Record<string, Sample[]> = {};
    for (const s of items) (g[s.category] ||= []).push(s);
    return g;
  }, [items]);

  if (samplesQuery.isLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={scrollAreaStyle}>
      <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--fg-text-3)', lineHeight: 1.6, borderBottom: '1px solid var(--fg-border)' }}>
        预置攻击样本库 · 共 {items.length} 条。载入将自动执行铺垫轮次与攻击载荷，实时观察监护判定。
      </div>
      {Object.keys(grouped).length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无样本" style={{ marginTop: 40 }} />
      ) : (
        Object.entries(grouped).map(([cat, list]) => {
          const open = openCat === cat || openCat === null;
          return (
            <div key={cat}>
              <button
                onClick={() => setOpenCat(openCat === cat ? '__none__' : cat)}
                style={catHeaderStyle}
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {CATEGORY_NAMES[cat] ?? cat}
                <span className="mono" style={{ marginLeft: 'auto', color: 'var(--fg-text-3)' }}>{list.length}</span>
              </button>
              {open &&
                list.map((s) => (
                  <SampleCard key={s.sample_id} sample={s} loading={loading} terminated={terminated} onLoad={onLoad} onWarn={(m) => message.warning(m)} />
                ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function SampleCard({
  sample,
  loading,
  terminated,
  onLoad,
  onWarn,
}: {
  sample: Sample;
  loading: boolean;
  terminated: boolean;
  onLoad: Props['onLoadSample'];
  onWarn: (m: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--fg-border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-text-1)' }}>{sample.name}</span>
            {!sample.applicable && (
              <Tooltip title={sample.reason || '当前实例未启用相关工具，样本不适用'}>
                <Tag color="default" style={{ margin: 0, fontSize: 9.5, lineHeight: '15px', padding: '0 5px' }}>不适用</Tag>
              </Tooltip>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-text-3)', marginTop: 2 }}>{sample.mechanism}</div>
        </div>
        <Button
          size="small"
          type={sample.applicable ? 'primary' : 'default'}
          disabled={terminated || loading}
          onClick={() => {
            if (!sample.applicable) onWarn('该样本不适用，已强制载入用于演示');
            onLoad({ sampleId: sample.sample_id, force: !sample.applicable });
          }}
        >
          {sample.applicable ? '载入' : '强制'}
        </Button>
      </div>
      <button onClick={() => setExpanded((e) => !e)} style={linkBtnStyle}>
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} 载荷预览
      </button>
      {expanded && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <pre className="mono" style={payloadPreStyle}>{sample.payload_preview}</pre>
          <div style={{ display: 'flex', gap: 10, fontSize: 10.5 }}>
            <span style={{ color: 'var(--fg-block-text)' }}>关防护：{truncate(sample.expected_off, 40)}</span>
            <span style={{ color: 'var(--fg-allow-text)' }}>开防护：{truncate(sample.expected_on, 40)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RedteamTab({
  running,
  pending,
  terminated,
  onStart,
  onStop,
}: {
  running: boolean;
  pending: boolean;
  terminated: boolean;
  onStart: Props['onStartRedteam'];
  onStop: () => void;
}) {
  const steps = useSessionStore((s) => s.redteamSteps);
  const [maxRounds, setMaxRounds] = useState(5);
  const [timeLimit, setTimeLimit] = useState(120);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps]);

  return (
    <>
      <div style={{ padding: 14, borderBottom: '1px solid var(--fg-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11.5, color: 'var(--fg-text-2)', lineHeight: 1.6 }}>
          红队自动攻击：模型驱动的多轮渐进式注入，自动尝试越权并记录每步结果。
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={fieldLabelStyle}>最大轮次</div>
            <InputNumber min={1} max={20} value={maxRounds} onChange={(v) => setMaxRounds(v ?? 5)} style={{ width: '100%' }} disabled={running} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={fieldLabelStyle}>时限（秒）</div>
            <InputNumber min={30} max={600} step={30} value={timeLimit} onChange={(v) => setTimeLimit(v ?? 120)} style={{ width: '100%' }} disabled={running} />
          </div>
        </div>
        {running ? (
          <Button danger block icon={<Square size={14} />} onClick={onStop}>
            停止红队
          </Button>
        ) : (
          <Button
            type="primary"
            block
            icon={pending ? <Loader2 size={14} className="fg-spin" /> : <Play size={14} />}
            disabled={terminated || pending}
            onClick={() => onStart({ maxRounds, timeLimitS: timeLimit })}
          >
            启动红队自动攻击
          </Button>
        )}
        {running && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-observe-text)' }}>
            <span className="fg-breathe" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--fg-observe)' }} />
            红队进行中…
          </div>
        )}
      </div>
      <div ref={scrollRef} style={scrollAreaStyle}>
        {steps.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--fg-text-3)', fontSize: 12 }}>
            <Swords size={24} strokeWidth={1.4} style={{ opacity: 0.5, marginBottom: 8 }} />
            <div>启动后，红队每一步将在此实时显示</div>
          </div>
        ) : (
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {steps.map((s) => (
              <div key={s.id} style={stepCardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-lab-accent)' }}>
                    {s.round != null ? `ROUND ${s.round}` : 'STEP'}
                  </span>
                  {s.status && <Tag style={{ margin: 0, fontSize: 9.5, lineHeight: '15px', padding: '0 5px' }}>{s.status}</Tag>}
                  <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--fg-text-3)' }}>{formatShort(s.created_at)}</span>
                </div>
                {s.payload && <div style={{ fontSize: 11.5, color: 'var(--fg-text-2)', lineHeight: 1.55, wordBreak: 'break-word' }}>{truncate(s.payload, 160)}</div>}
                {s.result && <div style={{ fontSize: 11, color: 'var(--fg-text-3)', marginTop: 3, lineHeight: 1.5 }}>→ {truncate(s.result, 120)}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function TabButton({ active, onClick, icon, label, dot }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; dot?: boolean }) {
  return (
    <button onClick={onClick} style={{ ...tabBtnStyle, color: active ? 'var(--fg-lab-accent)' : 'var(--fg-text-2)', borderBottomColor: active ? 'var(--fg-lab-accent)' : 'transparent' }}>
      {icon}
      {label}
      {dot && <span className="fg-breathe" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--fg-observe)' }} />}
    </button>
  );
}

const colStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  background: 'var(--fg-bg-card)',
  border: '1px solid var(--fg-border)',
  borderRadius: 14,
  overflow: 'hidden',
};
const tabStripStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '0 8px',
  borderBottom: '1px solid var(--fg-border)',
  background: 'var(--fg-bg-subtle)',
  flexShrink: 0,
};
const tabBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '11px 12px',
  background: 'none',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  fontSize: 12.5,
  fontWeight: 600,
  transition: 'all 140ms ease',
};
const pendingPillStyle: React.CSSProperties = {
  marginLeft: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10.5,
  fontWeight: 700,
  color: 'var(--fg-observe-text)',
  background: 'var(--fg-observe-bg)',
  border: '1px solid var(--fg-observe)33',
  borderRadius: 20,
  padding: '2px 8px',
};
const scrollAreaStyle: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto' };
const composerStyle: React.CSSProperties = { padding: 12, borderTop: '1px solid var(--fg-border)', background: 'var(--fg-bg-subtle)', flexShrink: 0 };
const colFooterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  borderTop: '1px solid var(--fg-border)',
  flexShrink: 0,
};
const catHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '8px 14px',
  background: 'var(--fg-bg-subtle)',
  border: 'none',
  borderBottom: '1px solid var(--fg-border)',
  cursor: 'pointer',
  fontSize: 11.5,
  fontWeight: 700,
  color: 'var(--fg-text-2)',
  position: 'sticky',
  top: 0,
};
const linkBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  marginTop: 6,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 10.5,
  color: 'var(--fg-text-3)',
  padding: 0,
};
const payloadPreStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  background: 'var(--fg-bg-page)',
  border: '1px solid var(--fg-border)',
  borderRadius: 7,
  fontSize: 10.5,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: 'var(--fg-text-2)',
  maxHeight: 120,
  overflowY: 'auto',
};
const fieldLabelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--fg-text-3)', marginBottom: 5 };
const stepCardStyle: React.CSSProperties = {
  padding: '9px 11px',
  background: 'var(--fg-bg-subtle)',
  border: '1px solid var(--fg-border)',
  borderRadius: 9,
};