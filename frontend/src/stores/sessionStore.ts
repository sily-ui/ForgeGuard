import { create } from 'zustand';
import type {
  AgentDeltaEvent,
  AgentMessageEvent,
  Alert,
  CallRecord,
  ChainUpdateEvent,
  GuardJudgementEvent,
  Judgement,
  Mode,
  RiskLevel,
  Session,
  SessionStatus,
  SseRecord,
  StatusColor,
  ToolCallEvent,
  TurnMessage,
} from '@/types/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turn?: number;
  actor?: string;
  source_sample_id?: string | null;
  created_at: string;
  pending?: boolean;
}

export interface LiveCall {
  call_id: string;
  turn: number;
  tool: string;
  params_summary: Record<string, unknown>;
  actor: string;
  judgement?: Judgement;
  status_color: StatusColor;
  action?: string;
  risk?: RiskLevel;
  duration_ms?: number;
  judged_by?: string;
  challenge_pending?: boolean;
  challenge_approved?: boolean;
  resolved: boolean;
  created_at: string;
  source_sample_id?: string | null;
}

export interface RedteamStep {
  id: string;
  round?: number;
  status?: string;
  payload?: string;
  result?: string;
  created_at: string;
}

export type Connection = 'connecting' | 'open' | 'closed' | 'error';

interface SessionState {
  sessionId: string | null;
  session: Session | null;
  messages: ChatMessage[];
  calls: Record<string, LiveCall>;
  callOrder: string[];
  alerts: Alert[];
  challenges: Record<string, GuardJudgementEvent>;
  redteamSteps: RedteamStep[];
  redteamRunning: boolean;
  connection: Connection;
  sending: boolean;
  selectedCallId: string | null;
  mode: Mode;
  lastActivity: { tool?: string; action?: string; at: number } | null;

  reset: (sessionId: string) => void;
  hydrate: (session: Session, calls: CallRecord[], alerts: Alert[], turns?: TurnMessage[]) => void;
  setSession: (session: Session) => void;
  patchSession: (patch: Partial<Session>) => void;
  setConnection: (c: Connection) => void;
  setSending: (v: boolean) => void;
  setSelectedCall: (id: string | null) => void;
  addUserMessage: (content: string, actor?: string, sampleId?: string | null) => string;
  addSystemMessage: (content: string) => void;
  upsertAssistantMessage: (id: string, content: string, turn: number, actor?: string) => void;
  startAssistantMessage: (id: string, turn: number, actor?: string) => void;
  appendAssistantDelta: (id: string, delta: string, turn: number, actor?: string) => void;
  applyEvent: (record: SseRecord) => void;
  resolveChallengeLocal: (callId: string, approved: boolean) => void;
  setRedteamRunning: (v: boolean) => void;
  updateAlert: (alert: Alert) => void;
}

function callFromRecord(c: CallRecord): LiveCall {
  return {
    call_id: c.call_id,
    turn: c.turn,
    tool: c.tool,
    params_summary: c.params_summary,
    actor: c.actor,
    judgement: c.judgement,
    status_color: c.status_color,
    action: c.judgement?.action,
    risk: c.judgement?.risk,
    duration_ms: c.duration_ms,
    judged_by: c.judgement?.judged_by,
    challenge_approved: c.judgement?.challenge_approved,
    resolved: true,
    created_at: c.created_at,
    source_sample_id: c.source_sample_id,
  };
}

// SSE 重放会重发已水合回合的 agent 事件；按 turn+actor 认领历史消息并改用 SSE id，避免重复气泡。
function adoptHydrated(messages: ChatMessage[], id: string, turn: number, actor?: string): ChatMessage[] | null {
  const idx = messages.findIndex(
    (m) => m.id === `hist-a-${turn}` && (actor == null || m.actor === actor),
  );
  if (idx < 0) return null;
  const next = [...messages];
  next[idx] = { ...next[idx], id };
  return next;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  session: null,
  messages: [],
  calls: {},
  callOrder: [],
  alerts: [],
  challenges: {},
  redteamSteps: [],
  redteamRunning: false,
  connection: 'connecting',
  sending: false,
  selectedCallId: null,
  mode: 'live',
  lastActivity: null,

  reset: (sessionId) =>
    set({
      sessionId,
      session: null,
      messages: [],
      calls: {},
      callOrder: [],
      alerts: [],
      challenges: {},
      redteamSteps: [],
      redteamRunning: false,
      connection: 'connecting',
      sending: false,
      selectedCallId: null,
      mode: 'live',
      lastActivity: null,
    }),

  hydrate: (session, calls, alerts, turns = []) => {
    const map: Record<string, LiveCall> = {};
    const order: string[] = [];
    for (const c of calls) {
      map[c.call_id] = callFromRecord(c);
      order.push(c.call_id);
    }
    // 从 Turn 表重建历史对话，刷新/重进会话不再丢失聊天记录。
    const messages: ChatMessage[] = [];
    for (const t of turns) {
      if (t.user_input) {
        messages.push({
          id: `hist-u-${t.turn}`,
          role: 'user',
          content: t.user_input,
          turn: t.turn,
          actor: t.actor,
          source_sample_id: t.source_sample_id,
          created_at: t.created_at,
        });
      }
      if (t.reply) {
        messages.push({
          id: `hist-a-${t.turn}`,
          role: 'assistant',
          content: t.reply,
          turn: t.turn,
          actor: t.actor,
          created_at: t.created_at,
        });
      }
    }
    set({
      session,
      messages,
      calls: map,
      callOrder: order,
      alerts,
      mode: session.mode,
    });
  },

  setSession: (session) => set({ session, mode: session.mode }),
  patchSession: (patch) =>
    set((s) => ({ session: s.session ? { ...s.session, ...patch } : s.session })),
  setConnection: (connection) => set({ connection }),
  setSending: (sending) => set({ sending }),
  setSelectedCall: (selectedCallId) => set({ selectedCallId }),

  addUserMessage: (content, actor = 'business', sampleId = null) => {
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const msg: ChatMessage = {
      id,
      role: 'user',
      content,
      actor,
      source_sample_id: sampleId,
      created_at: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, msg] }));
    return id;
  },

  addSystemMessage: (content) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'system', content, created_at: new Date().toISOString() },
      ],
    })),

  upsertAssistantMessage: (id, content, turn, actor) =>
    set((s) => {
      const exists = s.messages.some((m) => m.id === id);
      if (exists) {
        return { messages: s.messages.map((m) => (m.id === id ? { ...m, content, pending: false } : m)) };
      }
      const adopted = adoptHydrated(s.messages, id, turn, actor);
      if (adopted) {
        return { messages: adopted.map((m) => (m.id === id ? { ...m, content, pending: false } : m)) };
      }
      return {
        messages: [
          ...s.messages,
          { id, role: 'assistant', content, turn, actor, created_at: new Date().toISOString() },
        ],
      };
    }),

  startAssistantMessage: (id, turn, actor) =>
    set((s) => {
      if (s.messages.some((m) => m.id === id)) return s;
      const adopted = adoptHydrated(s.messages, id, turn, actor);
      if (adopted) {
        return { messages: adopted.map((m) => (m.id === id ? { ...m, content: '', pending: true } : m)) };
      }
      return {
        messages: [
          ...s.messages,
          { id, role: 'assistant', content: '', turn, actor, created_at: new Date().toISOString(), pending: true },
        ],
      };
    }),

  appendAssistantDelta: (id, delta, turn, actor) =>
    set((s) => {
      if (s.messages.some((m) => m.id === id)) {
        return {
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, content: m.content + delta, pending: true } : m,
          ),
        };
      }
      const adopted = adoptHydrated(s.messages, id, turn, actor);
      if (adopted) {
        return { messages: adopted.map((m) => (m.id === id ? { ...m, content: delta, pending: true } : m)) };
      }
      return {
        messages: [
          ...s.messages,
          { id, role: 'assistant', content: delta, turn, actor, created_at: new Date().toISOString(), pending: true },
        ],
      };
    }),

  applyEvent: (record) => {
    const { event, data } = record;
    const state = get();
    switch (event) {
      case 'agent.message.start': {
        const d = data as unknown as AgentDeltaEvent;
        get().startAssistantMessage(d.message_id, d.turn, d.actor);
        break;
      }
      case 'agent.delta': {
        const d = data as unknown as AgentDeltaEvent;
        get().appendAssistantDelta(d.message_id, d.delta, d.turn, d.actor);
        break;
      }
      case 'agent.message': {
        const d = data as unknown as AgentMessageEvent;
        get().upsertAssistantMessage(d.message_id, d.content, d.turn, d.actor);
        set({ sending: false });
        break;
      }
      case 'tool.call': {
        const d = data as unknown as ToolCallEvent;
        if (state.calls[d.call_id]) break;
        const call: LiveCall = {
          call_id: d.call_id,
          turn: d.turn,
          tool: d.tool,
          params_summary: d.params_summary,
          actor: d.actor,
          status_color: 'gray',
          resolved: false,
          created_at: new Date().toISOString(),
        };
        set((s) => ({
          calls: { ...s.calls, [d.call_id]: call },
          callOrder: [...s.callOrder, d.call_id],
          lastActivity: { tool: d.tool, at: Date.now() },
        }));
        break;
      }
      case 'guard.judgement': {
        const d = data as unknown as GuardJudgementEvent;
        const existing = state.calls[d.call_id];
        const { call_id, tool, challenge_pending, ...judgement } = d;
        const merged: LiveCall = {
          ...(existing || {
            call_id,
            turn: 0,
            tool,
            params_summary: {},
            actor: 'business',
            status_color: 'gray' as StatusColor,
            resolved: false,
            created_at: new Date().toISOString(),
          }),
          judgement: judgement as Judgement,
          challenge_pending: !!challenge_pending,
        };
        const challenges = { ...state.challenges };
        if (challenge_pending) {
          challenges[call_id] = d;
        } else {
          delete challenges[call_id];
          merged.resolved = true;
          merged.action = judgement.action;
          merged.risk = judgement.risk;
          merged.judged_by = judgement.judged_by;
          merged.challenge_approved = judgement.challenge_approved;
        }
        set((s) => ({
          calls: { ...s.calls, [call_id]: merged },
          callOrder: s.callOrder.includes(call_id) ? s.callOrder : [...s.callOrder, call_id],
          challenges,
          lastActivity: { tool, action: challenge_pending ? 'challenge' : judgement.action, at: Date.now() },
        }));
        break;
      }
      case 'chain.update': {
        const d = data as unknown as ChainUpdateEvent;
        const existing = state.calls[d.call_id];
        if (!existing) break;
        const merged: LiveCall = {
          ...existing,
          status_color: d.status_color,
          action: d.action,
          risk: d.risk ?? existing.risk,
          duration_ms: d.duration_ms,
          judged_by: d.judged_by ?? existing.judged_by,
          resolved: true,
          challenge_pending: false,
        };
        const challenges = { ...state.challenges };
        delete challenges[d.call_id];
        set((s) => ({
          calls: { ...s.calls, [d.call_id]: merged },
          challenges,
          lastActivity: { tool: d.tool, action: d.action, at: Date.now() },
        }));
        break;
      }
      case 'alert.created': {
        const d = data as unknown as Alert;
        if (state.alerts.some((a) => a.alert_id === d.alert_id)) break;
        set((s) => ({ alerts: [...s.alerts, d] }));
        break;
      }
      case 'session.status': {
        const d = data as unknown as { status: SessionStatus; mode?: Mode; reason?: string };
        get().patchSession({ status: d.status, ...(d.mode ? { mode: d.mode } : {}) });
        if (d.mode) set({ mode: d.mode });
        if (d.reason) get().addSystemMessage(d.reason);
        break;
      }
      case 'redteam.step': {
        const d = data as Record<string, unknown>;
        const step: RedteamStep = {
          id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          round: d.round as number | undefined,
          status: d.status as string | undefined,
          payload: d.payload as string | undefined,
          result: d.result as string | undefined,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ redteamSteps: [...s.redteamSteps, step], redteamRunning: d.status !== 'finished' && d.status !== 'stopped' }));
        break;
      }
    }
  },

  resolveChallengeLocal: (callId, approved) =>
    set((s) => {
      const challenges = { ...s.challenges };
      delete challenges[callId];
      const existing = s.calls[callId];
      const calls = existing
        ? {
            ...s.calls,
            [callId]: {
              ...existing,
              challenge_pending: false,
              challenge_approved: approved,
              action: approved ? 'allow' : 'block',
              status_color: (approved ? 'orange' : 'red') as StatusColor,
            },
          }
        : s.calls;
      return { challenges, calls };
    }),

  setRedteamRunning: (redteamRunning) => set({ redteamRunning }),

  updateAlert: (alert) =>
    set((s) => ({ alerts: s.alerts.map((a) => (a.alert_id === alert.alert_id ? alert : a)) })),
}));