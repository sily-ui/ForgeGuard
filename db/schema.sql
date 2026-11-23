-- BeforeBound 移植到 Qoder Sites 平台数据库（schema app）的表结构。
-- 与 backend/app/models/db.py 逐列对齐；时间戳沿用 Python 侧的 ISO 文本列，
-- 新增 session_events 承载 SSE 断点续传历史（Redis 已按方案移除）。
--
-- 受平台迁移 API 的受限 DDL 子集约束（见 .qoder/CONTRACTS.md）：
--   * 不支持 double precision 与 identity 列，故小数字段（risk_score）落 jsonb，
--     秒级时间戳（expires_at / created_ts）落 bigint 并由函数侧取整；
--   * 主键 id 一律由函数侧拼出（config_id:version、session_id:turn、session_id:seq），
--     既替代原自增主键，也顶掉了原来的 UNIQUE 索引；
--   * 整份脚本一次提交会被平台直接拒（sites_migration_rejected，无原因），
--     故按下面的四段分批 create → apply，每段 ≤13 条语句：
--       A tokens / platform_state / quota_counters / idempotency_keys / workspaces
--       B configs / config_versions / instances / policy_snapshots
--       C sessions / turns / call_records / alerts
--       D reports / experiments / snapshot_recordings / cleanup_logs / session_events
--     每段应用后 schemaRef 会前进，下一段必须先用 refresh=true 取新引用再建计划。

CREATE TABLE app.tokens (
  token text PRIMARY KEY,
  role text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  workspace_id text NOT NULL DEFAULT '',
  expires_at bigint NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE app.platform_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE app.quota_counters (
  key text PRIMARY KEY,
  used integer NOT NULL DEFAULT 0,
  max_calls integer NOT NULL
);

CREATE TABLE app.idempotency_keys (
  key text PRIMARY KEY,
  endpoint text NOT NULL,
  response jsonb NOT NULL,
  created_ts bigint NOT NULL
);

CREATE TABLE app.workspaces (
  workspace_id text PRIMARY KEY,
  created_at text NOT NULL,
  last_seen_at text NOT NULL
);

CREATE TABLE app.configs (
  config_id text PRIMARY KEY,
  workspace_id text NOT NULL DEFAULT 'default',
  name text NOT NULL,
  version text NOT NULL DEFAULT '1.0',
  payload jsonb NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  deleted boolean NOT NULL DEFAULT false
);
CREATE INDEX configs_workspace_id_idx ON app.configs (workspace_id);

CREATE TABLE app.config_versions (
  id text PRIMARY KEY,
  config_id text NOT NULL,
  version text NOT NULL,
  payload jsonb NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX config_versions_config_id_idx ON app.config_versions (config_id);

CREATE TABLE app.instances (
  instance_id text PRIMARY KEY,
  workspace_id text NOT NULL DEFAULT 'default',
  name text NOT NULL,
  source_config_id text NOT NULL,
  clone_source_id text,
  diff_from_source jsonb NOT NULL,
  status text NOT NULL DEFAULT 'creating',
  sandbox_key text NOT NULL,
  policy_snapshot_id text NOT NULL,
  config_payload jsonb NOT NULL,
  guard_preset text NOT NULL DEFAULT 'standard',
  created_at text NOT NULL,
  expires_at text NOT NULL,
  last_active_at text NOT NULL,
  stats jsonb NOT NULL
);
CREATE INDEX instances_workspace_id_idx ON app.instances (workspace_id);

CREATE TABLE app.policy_snapshots (
  snapshot_id text PRIMARY KEY,
  instance_id text NOT NULL,
  session_id text,
  version integer NOT NULL DEFAULT 1,
  baseline_summary text NOT NULL,
  policies jsonb NOT NULL,
  overrides jsonb NOT NULL,
  config_version text NOT NULL DEFAULT '1.0',
  created_at text NOT NULL
);
CREATE INDEX policy_snapshots_instance_id_idx ON app.policy_snapshots (instance_id);

CREATE TABLE app.sessions (
  session_id text PRIMARY KEY,
  workspace_id text NOT NULL DEFAULT 'default',
  instance_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  turn integer NOT NULL DEFAULT 0,
  context_summary text NOT NULL DEFAULT '',
  call_count integer NOT NULL DEFAULT 0,
  risk_score jsonb NOT NULL,
  last_risk_turn integer NOT NULL DEFAULT 0,
  guard_enabled boolean NOT NULL DEFAULT true,
  skip_guard_turns jsonb NOT NULL,
  policy_snapshot_id text NOT NULL,
  created_at text NOT NULL,
  terminated_at text,
  max_risk text NOT NULL DEFAULT 'none',
  block_count integer NOT NULL DEFAULT 0,
  challenge_count integer NOT NULL DEFAULT 0,
  limit_block_count integer NOT NULL DEFAULT 0,
  degrade_count integer NOT NULL DEFAULT 0,
  allow_count integer NOT NULL DEFAULT 0,
  mode text NOT NULL DEFAULT 'live',
  degradations jsonb NOT NULL
);
CREATE INDEX sessions_workspace_id_idx ON app.sessions (workspace_id);
CREATE INDEX sessions_instance_id_idx ON app.sessions (instance_id);

CREATE TABLE app.turns (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  turn integer NOT NULL,
  user_input text NOT NULL DEFAULT '',
  reply text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT 'business',
  source_sample_id text,
  created_at text NOT NULL
);
CREATE INDEX turns_session_id_idx ON app.turns (session_id);

CREATE TABLE app.call_records (
  call_id text PRIMARY KEY,
  session_id text NOT NULL,
  instance_id text NOT NULL,
  turn integer NOT NULL,
  tool text NOT NULL,
  params_raw jsonb NOT NULL,
  params_summary jsonb NOT NULL,
  judgement jsonb NOT NULL,
  hit_policy jsonb,
  sandbox_result jsonb,
  duration_ms integer NOT NULL DEFAULT 0,
  layers jsonb NOT NULL,
  status_color text NOT NULL DEFAULT 'green',
  created_at text NOT NULL,
  source_sample_id text,
  actor text NOT NULL DEFAULT 'business'
);
CREATE INDEX call_records_session_id_idx ON app.call_records (session_id);
CREATE INDEX call_records_instance_id_idx ON app.call_records (instance_id);

CREATE TABLE app.alerts (
  alert_id text PRIMARY KEY,
  session_id text NOT NULL,
  instance_id text NOT NULL,
  call_id text,
  turn integer NOT NULL DEFAULT 0,
  level text NOT NULL,
  label text NOT NULL DEFAULT '',
  boundary text,
  action text NOT NULL,
  reason text NOT NULL,
  hit_policies jsonb NOT NULL,
  false_positive boolean,
  false_negative boolean,
  note text,
  created_at text NOT NULL,
  session_level boolean NOT NULL DEFAULT false
);
CREATE INDEX alerts_session_id_idx ON app.alerts (session_id);
CREATE INDEX alerts_instance_id_idx ON app.alerts (instance_id);

CREATE TABLE app.reports (
  report_id text PRIMARY KEY,
  workspace_id text NOT NULL DEFAULT 'default',
  session_id text NOT NULL,
  policy_snapshot_id text NOT NULL,
  config_version text NOT NULL DEFAULT '1.0',
  content jsonb NOT NULL,
  summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  share_token text,
  share_expires_at text,
  created_at text NOT NULL
);
CREATE INDEX reports_workspace_id_idx ON app.reports (workspace_id);
CREATE INDEX reports_session_id_idx ON app.reports (session_id);

CREATE TABLE app.experiments (
  pair_id text PRIMARY KEY,
  workspace_id text NOT NULL DEFAULT 'default',
  dimension text NOT NULL,
  source_session_id text NOT NULL,
  run_a jsonb NOT NULL,
  run_b jsonb NOT NULL,
  input text NOT NULL,
  diff_items jsonb NOT NULL,
  status text NOT NULL DEFAULT 'running',
  created_at text NOT NULL
);
CREATE INDEX experiments_workspace_id_idx ON app.experiments (workspace_id);

CREATE TABLE app.snapshot_recordings (
  snapshot_id text PRIMARY KEY,
  name text NOT NULL,
  session_id text,
  workspace_id text NOT NULL DEFAULT 'default',
  events jsonb NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE app.cleanup_logs (
  id text PRIMARY KEY,
  scope text NOT NULL,
  counts jsonb NOT NULL,
  operator text NOT NULL DEFAULT 'admin',
  created_at text NOT NULL
);

CREATE TABLE app.session_events (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  seq integer NOT NULL,
  event text NOT NULL,
  data jsonb NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX session_events_session_id_idx ON app.session_events (session_id);
