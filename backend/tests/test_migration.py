"""存量数据迁移脚本回归：以 SQLite→SQLite 演练验证复制/幂等/演练/清空逻辑。

真实 PostgreSQL 目标需对应服务，脚本按方言选择 upsert，此处覆盖确定性复制路径。
"""

from sqlalchemy import create_engine, select

from app.models import db as dbmod
from scripts.migrate_sqlite_to_pg import migrate


def _seed_source(url):
    engine = create_engine(url)
    dbmod.Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            dbmod.Instance.__table__.insert().values(
                instance_id="i1",
                workspace_id="default",
                name="论文助手",
                source_config_id="inline",
                sandbox_key="sbx:i1",
                policy_snapshot_id="pol1",
                config_payload={"name": "论文助手", "tools": {}},
                created_at="2026-01-01T00:00:00Z",
                expires_at="2026-01-01T01:00:00Z",
                last_active_at="2026-01-01T00:00:00Z",
                stats={"call_count": 0},
            )
        )
        conn.execute(dbmod.PlatformState.__table__.insert().values(key="mode", value="live"))
    engine.dispose()


def _rows(url, table):
    engine = create_engine(url)
    with engine.connect() as conn:
        rows = conn.execute(select(table)).fetchall()
    engine.dispose()
    return rows


def test_migrate_copies_rows_and_json(tmp_path):
    src = f"sqlite:///{tmp_path / 'src.db'}"
    dst = f"sqlite:///{tmp_path / 'dst.db'}"
    _seed_source(src)
    counts = migrate(src, dst)
    assert counts["instances"] == 1
    assert counts["platform_state"] == 1
    inst = _rows(dst, dbmod.Instance.__table__)[0]
    assert inst.name == "论文助手"
    assert inst.config_payload == {"name": "论文助手", "tools": {}}
    assert _rows(dst, dbmod.PlatformState.__table__)[0].value == "live"


def test_migrate_is_idempotent(tmp_path):
    src = f"sqlite:///{tmp_path / 'src.db'}"
    dst = f"sqlite:///{tmp_path / 'dst.db'}"
    _seed_source(src)
    migrate(src, dst)
    migrate(src, dst)
    assert len(_rows(dst, dbmod.Instance.__table__)) == 1
    assert len(_rows(dst, dbmod.PlatformState.__table__)) == 1


def test_migrate_dry_run_writes_nothing(tmp_path):
    src = f"sqlite:///{tmp_path / 'src.db'}"
    dst_path = tmp_path / "dst.db"
    dst = f"sqlite:///{dst_path}"
    _seed_source(src)
    counts = migrate(src, dst, dry_run=True)
    assert counts["instances"] == 1
    assert not dst_path.exists()


def test_migrate_truncate_replaces_target(tmp_path):
    src = f"sqlite:///{tmp_path / 'src.db'}"
    dst = f"sqlite:///{tmp_path / 'dst.db'}"
    _seed_source(src)
    migrate(src, dst)
    # 目标库多出一行，truncate 导入后应被清除再复制
    engine = create_engine(dst)
    with engine.begin() as conn:
        conn.execute(dbmod.PlatformState.__table__.insert().values(key="extra", value="x"))
    engine.dispose()
    migrate(src, dst, truncate=True)
    keys = {r.key for r in _rows(dst, dbmod.PlatformState.__table__)}
    assert keys == {"mode"}


def test_migrate_rejects_same_source_and_target(tmp_path):
    url = f"sqlite:///{tmp_path / 'same.db'}"
    _seed_source(url)
    try:
        migrate(url, url)
        assert False, "应拒绝源与目标相同"
    except ValueError:
        pass