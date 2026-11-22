"""安全与并发回归测试：对应生产审计发现的 C-1/H-1~H-5/M-1/M-8 等缺陷。

约定与其余用例一致：同步函数内 asyncio.run 驱动协程，不依赖真实网关。
"""

import asyncio

from app.core.security import iso, utcnow
from app.core.state import runtime
from app.models import db as dbmod
from app.sandbox.invoke import invoke
from app.sandbox.partition import sandbox_manager

from .conftest import create_instance, create_session, make_config, send


# ---- C-1 令牌与工作区绑定 ----

def test_guest_token_rejects_foreign_workspace_header(client, guest_auth):
    headers = {**guest_auth, "X-Workspace-Id": "attackerws99"}
    resp = client.get("/api/v1/auth/workspace", headers=headers)
    assert resp.status_code == 403, resp.text


def test_guest_token_without_header_uses_bound_workspace(client, guest_auth):
    headers = {"Authorization": guest_auth["Authorization"]}
    resp = client.get("/api/v1/auth/workspace", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["workspace_id"] == "pytestguest01"


# ---- H-1 幂等缓存跨工作区泄漏 ----

def test_idempotency_key_scoped_by_workspace(client, auth, guest_auth):
    key = "regress-idem-cross-ws"
    first = client.post(
        "/api/v1/instances",
        json={"config": make_config(name="幂等甲")},
        headers={**auth, "X-Idempotency-Key": key},
    )
    assert first.status_code == 200, first.text
    second = client.post(
        "/api/v1/instances",
        json={"config": make_config(name="幂等乙")},
        headers={**guest_auth, "X-Idempotency-Key": key},
    )
    assert second.status_code == 200, second.text
    assert second.json()["data"]["instance_id"] != first.json()["data"]["instance_id"]


# ---- H-2 脱敏掩码不可被工具入参覆盖 ----

def test_query_api_mask_ignores_params_override():
    sandbox_manager.create("sbx:regress-mask")
    try:
        partition = sandbox_manager.get("sbx:regress-mask")
        partition.api_data["/user/info"] = {"phone": "13800000000", "name": "张三"}
        result = invoke(
            {
                "instance_id": "regress-mask",
                "sandbox_key": "sbx:regress-mask",
                "tool": "query_api",
                "params": {"endpoint": "/user/info", "_mask_fields": []},
                "policy_decision": {"action": "allow", "mask_fields": ["phone"]},
            }
        )
        assert result["ok"]
        assert "*" in result["data"]["data"]["phone"]
    finally:
        sandbox_manager.destroy("sbx:regress-mask")


# ---- H-3 终止会话只取消本会话质询 ----

def test_cancel_session_challenges_isolated():
    async def scenario():
        runtime.register_challenge("rec-own", session_id="sess-own")
        runtime.register_challenge("rec-other", session_id="sess-other")
        runtime.cancel_session_challenges("sess-own")
        assert "rec-own" not in runtime.challenges
        assert runtime.resolve_challenge("rec-other", True) is True

    asyncio.run(scenario())


# ---- M-1 质询决策校验 call_id 归属 ----

def test_challenge_decision_rejects_foreign_call(client, auth):
    inst = create_instance(client, auth, name="质询归属")
    sess_a = create_session(client, auth, inst["instance_id"])
    sess_b = create_session(client, auth, inst["instance_id"])

    async def register():
        runtime.register_challenge("rec-foreign", session_id=sess_b["session_id"])

    asyncio.run(register())
    try:
        resp = client.post(
            f"/api/v1/sessions/{sess_a['session_id']}/challenges/rec-foreign",
            json={"approved": True},
            headers=auth,
        )
        assert resp.status_code == 409, resp.text
        assert "rec-foreign" in runtime.challenges
    finally:
        runtime.cancel_challenge("rec-foreign")


# ---- H-5 红队异常后标志复位 ----

def test_redteam_flag_reset_on_exception(client, auth, monkeypatch):
    from app.orchestration import redteam as redteam_mod

    inst = create_instance(client, auth, name="红队异常")
    sess = create_session(client, auth, inst["instance_id"])
    sid = sess["session_id"]

    async def boom(*args, **kwargs):
        raise RuntimeError("模拟内部异常")

    monkeypatch.setattr(redteam_mod, "process_message", boom)
    try:
        asyncio.run(redteam_mod.run_redteam(sid, max_rounds=2, time_limit_s=10))
    except RuntimeError:
        pass
    assert not runtime.redteam_flags.get(sid)


# ---- H-4 同会话并发消息计数不丢失 ----

def test_concurrent_messages_keep_counters(client, auth):
    inst = create_instance(client, auth, name="并发计数")
    sess = create_session(client, auth, inst["instance_id"])
    sid = sess["session_id"]
    from app.orchestration.runner import process_message

    async def scenario():
        await asyncio.gather(
            *(process_message(sid, "请读取 ./docs/runbook.md 并总结") for _ in range(4))
        )

    asyncio.run(scenario())
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Session, sid)
        calls = (
            db.query(dbmod.CallRecord).filter(dbmod.CallRecord.session_id == sid).count()
        )
        turns = db.query(dbmod.Turn).filter(dbmod.Turn.session_id == sid).count()
        assert row.turn == turns == 4
        assert row.call_count == calls


# ---- M-8 非法 perm 类型返回 422 而非 500 ----

def test_invalid_perm_type_returns_422(client, auth):
    config = make_config()
    config["tools"]["read_file"]["perm"]["allow_paths"] = 123
    resp = client.post("/api/v1/instances", json={"config": config}, headers=auth)
    assert resp.status_code == 422, resp.text


# ---- L-2 guard_preset 枚举校验 ----

def test_invalid_guard_preset_rejected(client, auth):
    resp = client.post(
        "/api/v1/instances",
        json={"config": make_config(), "guard_preset": "ultra"},
        headers=auth,
    )
    assert resp.status_code in (400, 422), resp.text


# ---- L-1 actor 不可由客户端伪造 ----

def test_client_cannot_spoof_redteam_actor(client, auth):
    inst = create_instance(client, auth, name="actor伪造")
    sess = create_session(client, auth, inst["instance_id"])
    resp = client.post(
        f"/api/v1/sessions/{sess['session_id']}/messages",
        json={"content": "读 ./docs/runbook.md", "actor": "redteam"},
        headers=auth,
    )
    assert resp.status_code == 400, resp.text


# ---- H-7 管理员引导准入 ----

def test_admin_bootstrap_requires_key(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "admin_bootstrap_key", "regress-bootstrap-key", raising=False)
    wrong = client.post("/api/v1/auth/admin", json={"bootstrap_key": "wrong"})
    assert wrong.status_code == 403, wrong.text
    ok = client.post("/api/v1/auth/admin", json={"bootstrap_key": "regress-bootstrap-key"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["data"]["role"] == "admin"


def test_admin_bootstrap_disabled_by_default(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "admin_bootstrap_key", "", raising=False)
    resp = client.post("/api/v1/auth/admin", json={"bootstrap_key": "anything"})
    assert resp.status_code == 403, resp.text


# ---- M-5 过期实例滑动 TTL：使用时自动续期复活 ----

def test_expired_instance_auto_renews_on_session_create(client, auth):
    inst = create_instance(client, auth, name="过期续期")
    with dbmod.session_scope() as db:
        db.get(dbmod.Instance, inst["instance_id"]).expires_at = "2000-01-01T00:00:00Z"
    resp = client.post(
        "/api/v1/sessions",
        json={"instance_id": inst["instance_id"]},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Instance, inst["instance_id"])
        assert row.status == "ready"
        assert row.expires_at > iso(utcnow())


def test_frozen_instance_auto_renews_on_message(client, auth):
    inst = create_instance(client, auth, name="冻结续期")
    sess = create_session(client, auth, inst["instance_id"])
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Instance, inst["instance_id"])
        row.status = "frozen"
        row.expires_at = "2000-01-01T00:00:00Z"
    send(client, auth, sess["session_id"], "你好")
    with dbmod.session_scope() as db:
        row = db.get(dbmod.Instance, inst["instance_id"])
        assert row.status == "ready"
        assert row.expires_at > iso(utcnow())


# ---- 聊天历史水合：GET messages 端点 + 工作区隔离 ----

def test_session_messages_history_and_workspace_isolation(client, auth, guest_auth):
    inst = create_instance(client, auth, name="历史消息")
    sess = create_session(client, auth, inst["instance_id"])
    sid = sess["session_id"]
    send(client, auth, sid, "你好，请读取 ./docs/runbook.md 并总结")
    resp = client.get(f"/api/v1/sessions/{sid}/messages", headers=auth)
    assert resp.status_code == 200, resp.text
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["turn"] == 1
    assert items[0]["user_input"] == "你好，请读取 ./docs/runbook.md 并总结"
    assert items[0]["reply"]
    foreign = client.get(f"/api/v1/sessions/{sid}/messages", headers=guest_auth)
    assert foreign.status_code == 404, foreign.text


# ---- 演示快速链路：仿真模式质询等待缩短，不再拖满 120s ----

def test_fast_demo_challenge_timeout_shortened(client, auth):
    import time

    config = make_config()
    config["tools"]["write_file"] = {"enabled": True, "perm": {"allow_paths": ["./tmp"], "overwrite": True}}
    config["tools"]["read_file"]["perm"]["allow_paths"] = ["./docs", "./report"]
    inst = create_instance(client, auth, config=config, name="演示质询")
    sess = create_session(client, auth, inst["instance_id"])
    start = time.monotonic()
    resp = client.post(
        f"/api/v1/sessions/{sess['session_id']}/samples/smpl-chain-02/load",
        json={"force": True, "fast": True},
        headers=auth,
    )
    elapsed = time.monotonic() - start
    assert resp.status_code == 200, resp.text
    assert elapsed < 30, f"快速链路耗时 {elapsed:.1f}s，质询等待未缩短"


# ---- 场景化推荐指令：贴合实例用途，不再出现无关业务 ----

def _suggestions(client, auth, instance_id):
    resp = client.get(f"/api/v1/instances/{instance_id}/suggestions", headers=auth)
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def test_suggestions_fallback_is_purpose_aware(client, auth):
    config = make_config(name="论文助手", purpose="检索与总结学术论文")
    inst = create_instance(client, auth, config=config, name="论文助手")
    data = _suggestions(client, auth, inst["instance_id"])
    assert data["simulated"] is True
    assert data["items"]
    texts = " ".join(it["text"] for it in data["items"])
    assert "论文助手" in texts
    assert "订单" not in texts and "C-1072" not in texts


def test_suggestions_only_reference_enabled_tools(client, auth):
    inst = create_instance(client, auth, name="工具约束")
    enabled = set(inst.get("enabled_tools") or ["read_file", "send_email"])
    data = _suggestions(client, auth, inst["instance_id"])
    for it in data["items"]:
        assert it["tool"] is None or it["tool"] in enabled


def test_suggestions_cache_is_stable(client, auth):
    inst = create_instance(client, auth, name="缓存一致")
    first = _suggestions(client, auth, inst["instance_id"])
    second = _suggestions(client, auth, inst["instance_id"])
    assert first["items"] == second["items"]


def test_suggestions_cross_workspace_rejected(client, auth, guest_auth):
    inst = create_instance(client, auth, name="跨工作区")
    resp = client.get(
        f"/api/v1/instances/{inst['instance_id']}/suggestions", headers=guest_auth
    )
    assert resp.status_code == 404, resp.text