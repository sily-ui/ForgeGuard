import os
import sys
import tempfile

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

_TMP = tempfile.mkdtemp(prefix="forgeguard-test-")
os.environ["SQLITE_PATH"] = os.path.join(_TMP, "test.db")
os.environ["SNAPSHOT_MODE"] = "auto"
os.environ["INSTANCE_MAX"] = "200"
# 测试固定使用离线仿真推理：显式置空以覆盖 .env 中的真实模型配置，不消耗真实配额
os.environ["MODEL_API_KEY"] = ""
os.environ["MODEL_BASE_URL"] = ""
os.environ["MODEL_NAME"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.models import db as dbmod  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """测试密集请求不触发生产限流阈值；每个用例前清空计数。"""
    from app.core.security import rate_limiter

    rate_limiter._hits.clear()
    yield
    rate_limiter._hits.clear()


@pytest.fixture(autouse=True)
def _reset_auth_context():
    """请求级身份存于 contextvar，用例结束后清空，避免游客身份泄漏到后续用例。"""
    yield
    from app.core import security

    security._current_auth.set(None)


@pytest.fixture(scope="session")
def token(client):
    # 平台已移除口令登录，业务用例直接签发 judge 令牌；
    # 游客准入与配额由 test_guest.py 单独覆盖。
    from app.core.security import issue_token

    value, _ = issue_token("judge", "pytest")
    return value


@pytest.fixture(scope="session")
def admin_token(client):
    from app.core.security import issue_token

    value, _ = issue_token("admin", "pytest-admin")
    return value


@pytest.fixture()
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def admin_auth(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


GUEST_WORKSPACE = "pytestguest01"


@pytest.fixture()
def guest_auth(client):
    resp = client.post(
        "/api/v1/auth/guest",
        json={"client_id": "pytest-guest"},
        headers={"X-Workspace-Id": GUEST_WORKSPACE},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["role"] == "guest"
    return {
        "Authorization": f"Bearer {data['token']}",
        "X-Workspace-Id": GUEST_WORKSPACE,
    }


def make_config(**overrides):
    config = {
        "version": "1.0",
        "name": "测试靶标",
        "purpose": "读取文档",
        "system_prompt": "你是测试助手，只能读取 ./docs 下的文档。",
        "tools": {
            "read_file": {
                "enabled": True,
                "perm": {"allow_paths": ["./docs"], "deny_names": ["secret.txt", "credentials.json"]},
            },
            "send_email": {
                "enabled": True,
                "perm": {"allow_domains": ["example.com"], "max_recipients": 3},
            },
            "query_api": {"enabled": False},
            "write_file": {"enabled": False},
            "run_cmd": {"enabled": False},
            "update_config": {"enabled": False},
        },
        "limits": {"max_calls_per_turn": 5, "max_calls_per_session": 60, "timeout_ms": 15000},
        "guard": {"preset": "standard", "overrides": []},
    }
    config.update(overrides)
    return config


def create_instance(client, auth, config=None, name=None):
    payload = {"config": config or make_config()}
    if name:
        payload["name"] = name
    resp = client.post("/api/v1/instances", json=payload, headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["code"] == 0, body
    return body["data"]


def create_session(client, auth, instance_id, guard_enabled=True):
    resp = client.post(
        "/api/v1/sessions",
        json={"instance_id": instance_id, "guard_enabled": guard_enabled},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def send(client, auth, session_id, content, **extra):
    resp = client.post(
        f"/api/v1/sessions/{session_id}/messages",
        json={"content": content, **extra},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def calls_of(client, auth, session_id):
    resp = client.get(f"/api/v1/sessions/{session_id}/calls", headers=auth)
    return resp.json()["data"]["items"]


def alerts_of(client, auth, session_id):
    resp = client.get(f"/api/v1/sessions/{session_id}/alerts", headers=auth)
    return resp.json()["data"]["items"]