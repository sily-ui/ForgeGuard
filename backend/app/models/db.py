import os
from contextlib import contextmanager

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Float,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from ..core.config import settings


class Base(DeclarativeBase):
    pass


class Token(Base):
    __tablename__ = "tokens"
    token = Column(String, primary_key=True)
    role = Column(String, nullable=False)
    client_id = Column(String, default="")
    workspace_id = Column(String, default="")
    expires_at = Column(Float, nullable=False)
    revoked = Column(Boolean, default=False)


class PlatformState(Base):
    __tablename__ = "platform_state"
    key = Column(String, primary_key=True)
    value = Column(JSON, nullable=False)


class QuotaCounter(Base):
    __tablename__ = "quota_counters"
    key = Column(String, primary_key=True)
    used = Column(Integer, default=0)
    max_calls = Column(Integer, nullable=False)


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    key = Column(String, primary_key=True)
    endpoint = Column(String, nullable=False)
    response = Column(JSON, nullable=False)
    created_ts = Column(Float, nullable=False)


class Workspace(Base):
    """匿名工作区：无登录场景下，每个浏览器实例凭 workspace_id 隔离各自的数据。"""

    __tablename__ = "workspaces"
    workspace_id = Column(String, primary_key=True)
    created_at = Column(String, nullable=False)
    last_seen_at = Column(String, nullable=False)


class Config(Base):
    __tablename__ = "configs"
    config_id = Column(String, primary_key=True)
    workspace_id = Column(String, default="default", nullable=False, index=True)
    name = Column(String, nullable=False)
    version = Column(String, default="1.0")
    payload = Column(JSON, nullable=False)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)
    deleted = Column(Boolean, default=False)


class ConfigVersion(Base):
    __tablename__ = "config_versions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    config_id = Column(String, index=True, nullable=False)
    version = Column(String, nullable=False)
    payload = Column(JSON, nullable=False)
    created_at = Column(String, nullable=False)


class Instance(Base):
    __tablename__ = "instances"
    instance_id = Column(String, primary_key=True)
    workspace_id = Column(String, default="default", nullable=False, index=True)
    name = Column(String, nullable=False)
    source_config_id = Column(String, nullable=False)
    clone_source_id = Column(String, nullable=True)
    diff_from_source = Column(JSON, default=list)
    status = Column(String, default="creating")
    sandbox_key = Column(String, nullable=False)
    policy_snapshot_id = Column(String, nullable=False)
    config_payload = Column(JSON, nullable=False)
    guard_preset = Column(String, default="standard")
    created_at = Column(String, nullable=False)
    expires_at = Column(String, nullable=False)
    last_active_at = Column(String, nullable=False)
    stats = Column(JSON, default=dict)


class PolicySnapshot(Base):
    __tablename__ = "policy_snapshots"
    snapshot_id = Column(String, primary_key=True)
    instance_id = Column(String, index=True, nullable=False)
    session_id = Column(String, nullable=True)
    version = Column(Integer, default=1)
    baseline_summary = Column(Text, nullable=False)
    policies = Column(JSON, nullable=False)
    overrides = Column(JSON, default=list)
    config_version = Column(String, default="1.0")
    created_at = Column(String, nullable=False)


class Session(Base):
    __tablename__ = "sessions"
    session_id = Column(String, primary_key=True)
    workspace_id = Column(String, default="default", nullable=False, index=True)
    instance_id = Column(String, index=True, nullable=False)
    status = Column(String, default="active")
    turn = Column(Integer, default=0)
    context_summary = Column(Text, default="")
    call_count = Column(Integer, default=0)
    risk_score = Column(Float, default=0.0)
    last_risk_turn = Column(Integer, default=0)
    guard_enabled = Column(Boolean, default=True)
    skip_guard_turns = Column(JSON, default=list)
    policy_snapshot_id = Column(String, nullable=False)
    created_at = Column(String, nullable=False)
    terminated_at = Column(String, nullable=True)
    max_risk = Column(String, default="none")
    block_count = Column(Integer, default=0)
    challenge_count = Column(Integer, default=0)
    limit_block_count = Column(Integer, default=0)
    degrade_count = Column(Integer, default=0)
    allow_count = Column(Integer, default=0)
    mode = Column(String, default="live")
    degradations = Column(JSON, default=list)


class Turn(Base):
    __tablename__ = "turns"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, index=True, nullable=False)
    turn = Column(Integer, nullable=False)
    user_input = Column(Text, default="")
    reply = Column(Text, default="")
    actor = Column(String, default="business")
    source_sample_id = Column(String, nullable=True)
    created_at = Column(String, nullable=False)


class CallRecord(Base):
    __tablename__ = "call_records"
    call_id = Column(String, primary_key=True)
    session_id = Column(String, index=True, nullable=False)
    instance_id = Column(String, index=True, nullable=False)
    turn = Column(Integer, nullable=False)
    tool = Column(String, nullable=False)
    params_raw = Column(JSON, default=dict)
    params_summary = Column(JSON, default=dict)
    judgement = Column(JSON, default=dict)
    hit_policy = Column(JSON, nullable=True)
    sandbox_result = Column(JSON, nullable=True)
    duration_ms = Column(Integer, default=0)
    layers = Column(JSON, default=dict)
    status_color = Column(String, default="green")
    created_at = Column(String, nullable=False)
    source_sample_id = Column(String, nullable=True)
    actor = Column(String, default="business")


class Alert(Base):
    __tablename__ = "alerts"
    alert_id = Column(String, primary_key=True)
    session_id = Column(String, index=True, nullable=False)
    instance_id = Column(String, index=True, nullable=False)
    call_id = Column(String, nullable=True)
    turn = Column(Integer, default=0)
    level = Column(String, nullable=False)
    label = Column(String, default="")
    boundary = Column(String, nullable=True)
    action = Column(String, nullable=False)
    reason = Column(String, nullable=False)
    hit_policies = Column(JSON, default=list)
    false_positive = Column(Boolean, nullable=True)
    false_negative = Column(Boolean, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(String, nullable=False)
    session_level = Column(Boolean, default=False)


class Report(Base):
    __tablename__ = "reports"
    report_id = Column(String, primary_key=True)
    workspace_id = Column(String, default="default", nullable=False, index=True)
    session_id = Column(String, index=True, nullable=False)
    policy_snapshot_id = Column(String, nullable=False)
    config_version = Column(String, default="1.0")
    content = Column(JSON, nullable=False)
    summary = Column(JSON, default=dict)
    status = Column(String, default="ready")
    share_token = Column(String, nullable=True)
    share_expires_at = Column(String, nullable=True)
    created_at = Column(String, nullable=False)


class Experiment(Base):
    __tablename__ = "experiments"
    pair_id = Column(String, primary_key=True)
    workspace_id = Column(String, default="default", nullable=False, index=True)
    dimension = Column(String, nullable=False)
    source_session_id = Column(String, nullable=False)
    run_a = Column(JSON, nullable=False)
    run_b = Column(JSON, nullable=False)
    input = Column(Text, nullable=False)
    diff_items = Column(JSON, default=list)
    status = Column(String, default="running")
    created_at = Column(String, nullable=False)


class SnapshotRecording(Base):
    __tablename__ = "snapshot_recordings"
    snapshot_id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    session_id = Column(String, nullable=True)
    workspace_id = Column(String, default="default", nullable=False)
    events = Column(JSON, nullable=False)
    created_at = Column(String, nullable=False)


class CleanupLog(Base):
    __tablename__ = "cleanup_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    scope = Column(String, nullable=False)
    counts = Column(JSON, default=dict)
    operator = Column(String, default="admin")
    created_at = Column(String, nullable=False)


_engine = None
_SessionFactory = None


def get_engine():
    global _engine, _SessionFactory
    if _engine is None:
        path = settings.sqlite_path
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{path}",
            connect_args={"check_same_thread": False},
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
        )
        with _engine.connect() as conn:
            from sqlalchemy import text

            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.commit()
        _SessionFactory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def init_db():
    engine = get_engine()
    Base.metadata.create_all(engine)
    _migrate_workspace_columns(engine)
    _migrate_extra_columns(engine)


_WORKSPACE_TABLES = ("configs", "instances", "sessions", "reports", "experiments")

# 存量库补列：(表, 列, DDL 类型与默认值)
_EXTRA_COLUMNS = (
    ("tokens", "workspace_id", "VARCHAR NOT NULL DEFAULT ''"),
    ("snapshot_recordings", "workspace_id", "VARCHAR NOT NULL DEFAULT 'default'"),
)


def _migrate_extra_columns(engine):
    from sqlalchemy import text

    with engine.connect() as conn:
        for table, column, ddl in _EXTRA_COLUMNS:
            columns = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if not columns or column in columns:
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
        conn.commit()


def _migrate_workspace_columns(engine):
    """为存量 SQLite 库补充 workspace_id 列（create_all 不会修改已存在的表）。"""
    from sqlalchemy import text

    with engine.connect() as conn:
        for table in _WORKSPACE_TABLES:
            columns = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if not columns or "workspace_id" in columns:
                continue
            conn.execute(
                text(f"ALTER TABLE {table} ADD COLUMN workspace_id VARCHAR NOT NULL DEFAULT 'default'")
            )
            conn.execute(
                text(f"CREATE INDEX IF NOT EXISTS ix_{table}_workspace_id ON {table} (workspace_id)")
            )
        conn.commit()


@contextmanager
def session_scope():
    if _SessionFactory is None:
        get_engine()
    session = _SessionFactory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_engine():
    global _engine, _SessionFactory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionFactory = None