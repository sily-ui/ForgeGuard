"""水平扩展（路线 A）回归：共享库方言抽象 + 限流器内存回退。

Redis/PostgreSQL 真实路径需对应服务，单测覆盖默认 SQLite 与内存回退两条确定性路径。
"""

import pytest

from app.core.config import settings
from app.core.errors import ApiError
from app.core.security import rate_limiter
from app.models.db import get_engine


def test_database_url_defaults_to_sqlite():
    assert settings.database_url == ""
    assert get_engine().dialect.name == "sqlite"


def test_health_reports_storage_and_rate_limit_backends(client):
    data = client.get("/api/v1/health").json()["data"]
    assert data["db_backend"] == "sqlite"
    assert data["rate_limit_backend"] == "memory"


def test_rate_limiter_memory_fallback_enforces_limit():
    rate_limiter.bind_redis(None)
    key = "scaling-test-limit"
    rate_limiter._hits.pop(key, None)
    rate_limiter.check(key, limit=2, window_seconds=60)
    rate_limiter.check(key, limit=2, window_seconds=60)
    with pytest.raises(ApiError) as exc:
        rate_limiter.check(key, limit=2, window_seconds=60)
    assert exc.value.http_status == 429
    assert "Retry-After" in exc.value.headers


def test_rate_limiter_remaining_peek_does_not_consume():
    rate_limiter.bind_redis(None)
    key = "scaling-test-peek"
    rate_limiter._hits.pop(key, None)
    rate_limiter.check(key, limit=5, window_seconds=60)
    remaining, reset = rate_limiter.remaining(key, limit=5, window_seconds=60)
    assert remaining == 4
    assert reset > 0
    # peek 不消费：再次 peek 剩余数不变
    assert rate_limiter.remaining(key, limit=5, window_seconds=60)[0] == 4


def test_quota_consume_atomic_on_sqlite(client, auth):
    from app.core import quota
    from app.models import db as dbmod

    key = "scaling-quota-test"
    with dbmod.session_scope() as db:
        assert quota._consume(db, key, 1, 3) is True
        assert quota._consume(db, key, 1, 3) is True
        assert quota._consume(db, key, 1, 3) is True
        # 超过上限：条件自增不命中
        assert quota._consume(db, key, 1, 3) is False
    with dbmod.session_scope() as db:
        assert db.get(dbmod.QuotaCounter, key).used == 3


def _seed_suggestion_cache(iid):
    from app.models import db as dbmod

    with dbmod.session_scope() as db:
        db.add(
            dbmod.PlatformState(
                key=f"suggestions:{iid}",
                value={"fingerprint": "fp", "result": {"items": [], "simulated": False}},
            )
        )


def test_recycle_removes_suggestion_cache(client, auth):
    from app.models import db as dbmod

    from .conftest import create_instance

    iid = create_instance(client, auth, name="回收缓存")["instance_id"]
    _seed_suggestion_cache(iid)
    resp = client.post(f"/api/v1/instances/{iid}/recycle", json={"confirm": True}, headers=auth)
    assert resp.status_code == 200, resp.text
    with dbmod.session_scope() as db:
        assert db.get(dbmod.PlatformState, f"suggestions:{iid}") is None


def test_admin_cleanup_prunes_orphan_suggestion_cache(client, auth, admin_auth):
    from app.models import db as dbmod

    from .conftest import create_instance

    iid = create_instance(client, auth, name="孤儿缓存")["instance_id"]
    _seed_suggestion_cache(iid)
    _seed_suggestion_cache("nonexistent-instance")
    with dbmod.session_scope() as db:
        db.get(dbmod.Instance, iid).expires_at = "2000-01-01T00:00:00Z"
    resp = client.post(
        "/api/v1/admin/cleanup", json={"confirm": True, "scope": "daily"}, headers=admin_auth
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["counts"]["suggestion_caches"] >= 2
    with dbmod.session_scope() as db:
        assert db.get(dbmod.PlatformState, f"suggestions:{iid}") is None
        assert db.get(dbmod.PlatformState, "suggestions:nonexistent-instance") is None