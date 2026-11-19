"""游客匿名准入：令牌签发、角色边界、每日配额与调用限流。"""

import pytest

from app.core import quota
from app.core.config import settings
from app.core.errors import ApiError, QuotaExhausted
from app.core.security import AuthContext, bind_auth
from tests.conftest import create_instance, create_session


def _guest_ctx(workspace, ip):
    ctx = AuthContext("pytest-guest-token", "guest", "pytest", ip=ip)
    ctx.workspace = workspace
    bind_auth(ctx)
    return ctx


def test_guest_token_fields(client):
    resp = client.post(
        "/api/v1/auth/guest",
        json={"client_id": "web"},
        headers={"X-Workspace-Id": "pytestguest02"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["role"] == "guest"
    assert data["workspace_id"] == "pytestguest02"
    assert data["daily_max_calls"] == settings.quota_guest_daily
    assert data["token"] and data["expires_in"] > 0


def test_guest_token_rejects_bad_workspace(client):
    resp = client.post("/api/v1/auth/guest", json={}, headers={"X-Workspace-Id": "bad"})
    assert resp.status_code == 400
    assert resp.json()["code"] == 40000


def test_guest_quota_status(client, guest_auth):
    data = client.get("/api/v1/quota", headers=guest_auth).json()["data"]
    assert data["guest_max_calls"] == settings.quota_guest_daily
    assert data["guest_ip_max_calls"] == settings.quota_guest_ip_daily
    assert data["guest_used_calls"] >= 0


def test_guest_cannot_admin(client, guest_auth):
    resp = client.put("/api/v1/admin/quota", json={"global_max": 500}, headers=guest_auth)
    assert resp.status_code == 403
    assert resp.json()["code"] == 40300


def test_guest_message_flow(client, guest_auth):
    inst = create_instance(client, guest_auth)
    sess = create_session(client, guest_auth, inst["instance_id"])
    resp = client.post(
        f"/api/v1/sessions/{sess['session_id']}/messages",
        json={"content": "你好，请介绍你的工作原则"},
        headers=guest_auth,
    )
    assert resp.status_code == 200, resp.text
    data = client.get("/api/v1/quota", headers=guest_auth).json()["data"]
    assert data["guest_used_calls"] >= 1


def test_guest_workspace_daily_cap(monkeypatch):
    monkeypatch.setattr(settings, "quota_guest_daily", 2)
    monkeypatch.setattr(quota, "GUEST_CALL_LIMIT", 100)
    _guest_ctx("pytestcapws01", "203.0.113.11")
    quota.check_and_consume("sess-cap-ws")
    quota.check_and_consume("sess-cap-ws")
    with pytest.raises(QuotaExhausted) as exc:
        quota.check_and_consume("sess-cap-ws")
    assert "工作区" in exc.value.detail
    # 失败的一次须整体回滚，不得留下部分扣减
    assert quota.status()["guest_used_calls"] == 2


def test_guest_ip_daily_cap(monkeypatch):
    monkeypatch.setattr(settings, "quota_guest_ip_daily", 1)
    monkeypatch.setattr(quota, "GUEST_CALL_LIMIT", 100)
    _guest_ctx("pytestcapip01", "203.0.113.12")
    quota.check_and_consume("sess-cap-ip")
    with pytest.raises(QuotaExhausted) as exc:
        quota.check_and_consume("sess-cap-ip")
    assert "网络" in exc.value.detail


def test_guest_call_rate_limit(monkeypatch):
    monkeypatch.setattr(quota, "GUEST_CALL_LIMIT", 2)
    _guest_ctx("pytestcaprate1", "203.0.113.13")
    quota.check_and_consume("sess-rate")
    quota.check_and_consume("sess-rate")
    with pytest.raises(ApiError) as exc:
        quota.check_and_consume("sess-rate")
    assert exc.value.code == 42900