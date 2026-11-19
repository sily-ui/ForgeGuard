// 与后端 /api/v1 契约一一对应的类型定义。

export type Role = 'guest' | 'judge' | 'demo' | 'admin';
export type Mode = 'live' | 'replay';
export type GuardPreset = 'loose' | 'standard' | 'strict' | 'custom';
export type Action = 'allow' | 'block' | 'challenge' | 'degrade';
export type RiskLevel = 'none' | 'low' | 'medium' | 'high';
export type Boundary = 'tool' | 'object' | 'param' | null;
export type JudgedBy = 'L1' | 'L2' | 'L3' | 'skip' | 'fallback';
export type SessionStatus = 'active' | 'paused' | 'terminated';
export type InstanceStatus = 'creating' | 'pending_retry' | 'ready' | 'frozen' | 'destroyed';
export type ToolName = 'read_file' | 'write_file' | 'send_email' | 'query_api' | 'run_cmd' | 'update_config';

export interface Envelope<T> {
  code: number;
  message: string;
  data: T;
  detail?: string;
  field_errors?: FieldError[];
}

export interface FieldError {
  field: string;
  error: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ItemsResult<T> {
  items: T[];
  total: number;
}

// ---- Auth / Quota ----
export interface AuthToken {
  token: string;
  expires_in: number;
  mode: Mode;
  role: Role;
  workspace_id: string;
  daily_max_calls: number;
}

export interface QuotaStatus {
  session_used_calls: number;
  session_max_calls: number;
  global_used_calls: number;
  global_max_calls: number;
  mode: Mode;
  // 仅游客令牌返回：每工作区与每 IP 的当日模型调用额度
  guest_used_calls?: number;
  guest_max_calls?: number;
  guest_ip_used_calls?: number;
  guest_ip_max_calls?: number;
}

// ---- Config ----
export interface ToolPerm {
  allow_paths?: string[];
  deny_names?: string[];
  overwrite?: boolean;
  allow_domains?: string[];
  max_recipients?: number;
  allow_endpoints?: string[];
  mask_fields?: string[];
  allow_cmds?: string[];
  allow_keys?: string[];
  [key: string]: unknown;
}

export interface ToolSpec {
  enabled: boolean;
  perm: ToolPerm;
}

export interface Limits {
  max_calls_per_turn: number;
  max_calls_per_session: number;
  timeout_ms: number;
}

export interface GuardOverride {
  policy_id?: string;
  source?: string;
  action?: Action;
  enabled?: boolean;
  threshold?: Record<string, number>;
  note?: string;
}

export interface AgentConfig {
  name: string;
  purpose?: string;
  system_prompt: string;
  tools: Record<string, ToolSpec>;
  limits: Limits;
  guard: { preset: GuardPreset; overrides: GuardOverride[] };
  version?: string;
  _unknown_tools?: string[];
}

export interface ConfigListItem {
  config_id: string;
  name: string;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface ConfigDetail extends AgentConfig {
  config_id: string;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationWarning[];
}

export interface Policy {
  policy_id: string;
  level: 'L1' | 'L2' | 'L3';
  rule_type: string;
  condition: string;
  action: Action;
  source: string;
  origin: 'auto' | 'manual';
  enabled: boolean;
  params: Record<string, unknown>;
  override_note?: string;
}

export interface ConfigPreview {
  policies: Policy[];
  llm_cost_estimate: { l1: number; l2: number; l3: number };
  validation: ValidationResult;
}

// ---- Instance ----
export interface InstanceStats {
  call_count?: number;
  risk_score?: number;
  [key: string]: unknown;
}

export interface DiffItem {
  field: string;
  change: string;
}

export interface Instance {
  instance_id: string;
  name: string;
  status: InstanceStatus;
  source_config_id: string;
  clone_source_id: string | null;
  sandbox_key: string;
  policy_snapshot_id: string;
  guard: { preset: GuardPreset; enabled: boolean };
  created_at: string;
  expires_at: string;
  last_active_at: string;
  stats: InstanceStats;
  enabled_tools: string[];
  diff_from_source?: DiffItem[];
  config?: AgentConfig;
}

export interface InstanceCreated {
  instance_id: string;
  status: string;
  sandbox_key: string;
  policy_snapshot_id: string;
  created_at: string;
  config_version?: string;
  diff_from_source?: DiffItem[];
  diff_note?: string;
}

export interface PolicySnapshot {
  snapshot_id: string;
  version: number;
  config_version: string;
  baseline_summary: string;
  manual_override_count: number;
  levels: { L1: Policy[]; L2: Policy[]; L3: Policy[] };
  created_at: string;
}

// ---- Session ----
export interface Session {
  session_id: string;
  instance_id: string;
  instance_name: string;
  status: SessionStatus;
  turn: number;
  call_count: number;
  risk_score: number;
  guard_enabled: boolean;
  policy_snapshot_id: string;
  max_risk: RiskLevel;
  block_count: number;
  limit_block_count: number;
  challenge_count: number;
  degrade_count: number;
  allow_count: number;
  mode: Mode;
  degradations: string[];
  created_at: string;
  terminated_at: string | null;
  context_summary?: string;
  skip_guard_turns?: number[];
}

export interface SessionCreated {
  session_id: string;
  status: string;
  instance_id: string;
  policy_snapshot_id: string;
  created_at: string;
}

export interface HitPolicyRef {
  policy_id: string;
  source: string;
}

export interface Judgement {
  risk: RiskLevel;
  is_violation: boolean;
  boundary: Boundary;
  action: Action;
  hit_policies: HitPolicyRef[];
  reason: string;
  judged_by: JudgedBy;
  kind?: string;
  challenge_pending?: boolean;
  challenge_approved?: boolean;
  risk_label?: string;
  guard_unavailable?: boolean;
}

export interface JudgeLayers {
  layers: {
    l1: { hit?: boolean; rules?: unknown[]; skipped?: boolean };
    l2: { injection_prob?: number; highlight?: string[]; available?: boolean; short_circuit?: boolean; skipped?: boolean };
    l3: { raw_json?: Record<string, unknown> | null; valid?: boolean; available?: boolean; skipped?: boolean };
  };
  timings: { l1?: number; l2?: number; l3?: number };
}

export interface SandboxResult {
  ok: boolean;
  data?: Record<string, unknown>;
  simulated?: boolean;
  [key: string]: unknown;
}

export type StatusColor = 'green' | 'red' | 'yellow' | 'orange' | 'gray';

export interface CallRecord {
  call_id: string;
  session_id: string;
  turn: number;
  tool: string;
  params_summary: Record<string, unknown>;
  params_raw: Record<string, unknown>;
  judgement: Judgement;
  hit_policy: HitPolicyRef | null;
  sandbox_result: SandboxResult | null;
  duration_ms: number;
  layers: JudgeLayers;
  status_color: StatusColor;
  source_sample_id: string | null;
  actor: string;
  created_at: string;
}

export interface Alert {
  alert_id: string;
  session_id: string;
  instance_id: string;
  call_id: string | null;
  turn: number;
  level: RiskLevel;
  label: string;
  boundary: Boundary;
  action: Action;
  reason: string;
  hit_policies: HitPolicyRef[];
  false_positive: boolean;
  false_negative: boolean;
  note: string | null;
  session_level: boolean;
  created_at: string;
}

export interface MessageResult {
  message_id: string;
  accepted: boolean;
  status: string;
  turn: number;
  reply: string;
  actions: string[];
  max_risk: RiskLevel;
  call_ids: string[];
  mode?: Mode;
}

// ---- Samples ----
export interface Sample {
  sample_id: string;
  name: string;
  category: string;
  mechanism: string;
  payload_preview: string;
  expected_off: string;
  expected_on: string;
  applicable: boolean;
  reason?: string;
}

export interface SampleLoadResult {
  sample_id: string;
  setup_turns_executed: number;
  turn: number;
  reply: string;
  actions: string[];
  max_risk: RiskLevel;
  call_ids: string[];
  mode: Mode;
}

// ---- Experiments ----
export interface ExperimentRun {
  session_id: string;
  instance_id: string;
}

export interface ExperimentCall {
  call_id?: string;
  turn?: number;
  tool?: string;
  params_summary?: Record<string, unknown>;
  action?: Action;
  risk?: RiskLevel;
  reason?: string;
  status_color?: StatusColor;
  duration_ms?: number;
  note?: string;
}

export interface ExperimentRow {
  step: number;
  run_a: ExperimentCall;
  run_b: ExperimentCall;
}

export interface Experiment {
  pair_id: string;
  dimension: 'guard' | 'instance';
  source_session_id: string;
  run_a: ExperimentRun;
  run_b: ExperimentRun;
  input: string;
  diff_items: DiffItem[];
  status: string;
  created_at: string;
  rows: ExperimentRow[];
}

export interface ExperimentListItem {
  pair_id: string;
  dimension: 'guard' | 'instance';
  run_a: ExperimentRun;
  run_b: ExperimentRun;
  diff_count: number;
  status: string;
  created_at: string;
}

export interface CompareResult {
  pair_id: string;
  dimension: 'guard' | 'instance';
  run_a: ExperimentRun;
  run_b: ExperimentRun;
  diff_items: DiffItem[];
  run_b_summary: { actions: string[]; max_risk: RiskLevel };
}

// ---- Reports ----
export interface ReportSummary {
  instance_name: string;
  max_risk: RiskLevel;
  block_count: number;
  turns: number;
  conclusion: string;
}

export interface HardeningSuggestion {
  kind: 'immediate' | 'tooling' | 'tradeoff';
  category: string | null;
  category_name?: string;
  action: string;
  expected_effect: string;
  cost: string | null;
  alert_id: string | null;
}

export interface RiskAnalysisItem extends Alert {
  root_cause: string | null;
  root_causes: { category: string; name?: string; evidence?: Record<string, unknown> }[];
  evidence_insufficient: boolean;
}

export interface AttackTurn {
  turn: number;
  actor: string;
  source_sample_id: string | null;
  input: string;
  agent_reply: string;
  calls: {
    call_id: string;
    tool: string;
    params_summary: Record<string, unknown>;
    action: Action;
    risk: RiskLevel;
    reason: string;
    status_color: StatusColor;
    duration_ms: number;
  }[];
}

export interface ReportContent {
  report_version: string;
  part1_overview: {
    instance_name: string;
    purpose: string;
    session_id: string;
    tested_at: string;
    turns: number;
    call_count: number;
    block_count: number;
    challenge_count: number;
    limit_block_count: number;
    max_risk: RiskLevel;
    risk_score: number;
    guard_enabled: boolean;
    mode: Mode;
    conclusion: string;
  };
  part2_baseline: {
    config: AgentConfig;
    policy_snapshot_id: string;
    policy_snapshot_version: number | null;
    baseline_summary: string;
    policies: Policy[];
  };
  part3_attack_sequence: AttackTurn[];
  part4_risk_analysis: RiskAnalysisItem[];
  part5_hardening: HardeningSuggestion[];
  part6_limitations: string[];
  rootcause_summary: { category_counts: Record<string, number>; dominant: string | null };
  simulation_note: string;
}

export interface Report {
  report_id: string;
  session_id: string;
  policy_snapshot_id: string;
  config_version: string;
  status: string;
  summary: ReportSummary;
  created_at: string;
  share_expires_at: string | null;
  content?: ReportContent;
}

export interface ReportCreated {
  report_id: string;
  status: string;
  summary: ReportSummary;
  created_at: string;
}

export interface ShareLink {
  report_id: string;
  share_url: string;
  share_token: string;
  expires_at: string;
  read_only: boolean;
}

// ---- Templates ----
export interface Template {
  id: string;
  name: string;
  description: string;
  suggested_tools: string[];
  suggested_guard: GuardPreset;
  risk_note: string;
  config: AgentConfig;
}

// ---- SSE events ----
export type SseEventType =
  | 'agent.message'
  | 'agent.message.start'
  | 'agent.delta'
  | 'tool.call'
  | 'guard.judgement'
  | 'alert.created'
  | 'chain.update'
  | 'session.status'
  | 'redteam.step';

export interface SseRecord {
  id: number;
  event: SseEventType;
  data: Record<string, unknown>;
}

export interface AgentMessageEvent {
  message_id: string;
  role: string;
  content: string;
  turn: number;
  actor: string;
}

export interface AgentDeltaEvent {
  message_id: string;
  role: string;
  delta: string;
  turn: number;
  actor: string;
}

export interface ToolCallEvent {
  call_id: string;
  turn: number;
  tool: string;
  params_summary: Record<string, unknown>;
  actor: string;
}

export interface GuardJudgementEvent extends Judgement {
  call_id: string;
  tool: string;
}

export interface ChainUpdateEvent {
  call_id: string;
  turn: number;
  tool: string;
  status_color: StatusColor;
  action: Action;
  risk?: RiskLevel;
  kind?: string;
  duration_ms: number;
  judged_by?: JudgedBy;
}

export interface SessionStatusEvent {
  session_id: string;
  status: SessionStatus;
  mode?: Mode;
  reason?: string;
  snapshot_id?: string;
  terminated_at?: string;
}

export interface RedteamStepEvent {
  session_id?: string;
  round?: number;
  step?: number;
  status?: string;
  payload?: string;
  result?: string;
  [key: string]: unknown;
}