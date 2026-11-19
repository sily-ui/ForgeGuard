"""接口契约与平台能力测试：认证、配额、幂等、SSE、红队、管理。"""

import json

from tests.conftest import (
    alerts_of,
    calls_of,
    create_instance,
    create_session,
    make_config,
    send,
)


def test_auth_required(client):
    resp = client.get("/api/v1/instances")
    assert resp.status_code == 401
    assert resp.json()["code"] == 40100


def test_guest_token_requires_workspace(client):
    resp = client.post("/api/v1/auth/guest", json={})
    assert resp.status_code == 400
    assert resp.json()["code"] == 40000


def test_admin_rbac(client, auth):
    resp = client.put("/api/v1/admin/quota", json={"global_max": 500}, headers=auth)
    assert resp.status_code == 403
    assert resp.json()["code"] == 40300


def test_config_conflict(client, auth):
    config = make_config()
    config["tools"]["read_file"]["perm"]["allow_paths"] = ["./docs", "secret.txt"]
    resp = client.post("/api/v1/configs/validate", json=config, headers=auth)
    body = resp.json()["data"]
    assert body["valid"] is False
    assert any(e["code"] == "conflict" for e in body["errors"])
    create = client.post("/api/v1/configs", json=config, headers=auth)
    assert create.json()["code"] == 40001


def test_config_versioning(client, auth):
    config = make_config(name="版本化配置")
    created = client.post("/api/v1/configs", json=config, headers=auth).json()["data"]
    config["purpose"] = "更新后的用途"
    updated = client.put(
        f"/api/v1/configs/{created['config_id']}", json=config, headers=auth
    ).json()["data"]
    assert float(updated["version"]) > float(created["version"])
    exported = client.get(
        f"/api/v1/configs/{created['config_id']}/export", headers=auth
    ).json()["data"]
    assert exported["purpose"] == "更新后的用途"


def test_idempotent_instance(client, auth):
    headers = {**auth, "X-Idempotency-Key": "pytest-idem-001"}
    payload = {"config": make_config(name="幂等实例")}
    first = client.post("/api/v1/instances", json=payload, headers=headers).json()["data"]
    second = client.post("/api/v1/instances", json=payload, headers=headers).json()["data"]
    assert first["instance_id"] == second["instance_id"]


def test_policy_override_hard_rule(client, auth):
    inst = create_instance(client, auth)
    policies = client.get(
        f"/api/v1/instances/{inst['instance_id']}/policies", headers=auth
    ).json()["data"]["items"]
    existence = next(p for p in policies if p["rule_type"] == "tool_existence" and not p["params"].get("enabled"))
    resp = client.put(
        f"/api/v1/instances/{inst['instance_id']}/policies/{existence['policy_id']}",
        json={"enabled": False},
        headers=auth,
    )
    assert resp.status_code == 403
    normal = next(p for p in policies if p["rule_type"] == "deny_filename")
    ok = client.put(
        f"/api/v1/instances/{inst['instance_id']}/policies/{normal['policy_id']}",
        json={"enabled": False, "note": "测试停用"},
        headers=auth,
    )
    assert ok.status_code == 200
    new_snapshot = ok.json()["data"]["policy_snapshot_id"]
    assert new_snapshot != inst["policy_snapshot_id"]


def test_samples_applicability(client, auth):
    config = make_config()
    config["tools"]["send_email"]["enabled"] = False
    inst = create_instance(client, auth, config)
    resp = client.get(
        f"/api/v1/samples?instance_id={inst['instance_id']}", headers=auth
    ).json()["data"]
    items = resp["items"]
    assert items
    email_samples = [s for s in items if "send_email" in s["required_tools"]]
    assert email_samples and all(not s["applicable"] for s in email_samples)
    assert all(s["inactive_reason"] for s in email_samples)


def test_sample_load_and_expected(client, auth):
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    resp = client.post(
        f"/api/v1/sessions/{sess['session_id']}/samples/smpl-tool-hijack-01/load",
        json={},
        headers=auth,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "block" in data["actions"]
    alerts = alerts_of(client, auth, sess["session_id"])
    assert any(a["level"] == "high" for a in alerts)


def test_sse_events_and_resume(client, auth):
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    send(client, auth, sess["session_id"], "请读取 secret.txt")
    token = auth["Authorization"].split(" ")[1]
    resp = client.get(
        f"/api/v1/sessions/{sess['session_id']}/events?token={token}&follow=false"
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    text = resp.text
    assert "event: guard.judgement" in text
    assert "event: chain.update" in text
    ids = [int(l.split(": ")[1]) for l in text.splitlines() if l.startswith("id: ")]
    assert ids
    resumed = client.get(
        f"/api/v1/sessions/{sess['session_id']}/events?token={token}&follow=false",
        headers={"Last-Event-ID": str(ids[0])},
    )
    resumed_ids = [
        int(l.split(": ")[1]) for l in resumed.text.splitlines() if l.startswith("id: ")
    ]
    assert resumed_ids and min(resumed_ids) > ids[0]


def test_redteam_observable(client, auth):
    """V-15 多 Agent 协同可观测：红队试探经网关判定，独立时间线事件。"""
    import asyncio

    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])

    async def scenario():
        from app.orchestration.redteam import run_redteam

        conclusion = await run_redteam(sess["session_id"], max_rounds=3, time_limit_s=60)
        return conclusion

    conclusion = asyncio.run(scenario())
    assert conclusion["round"] >= 1
    calls = calls_of(client, auth, sess["session_id"])
    redteam_calls = [c for c in calls if c["actor"] == "redteam"]
    assert redteam_calls, "红队应产生经网关判定的调用"
    assert all(c["judgement"] for c in redteam_calls)
    events = client.get(
        f"/api/v1/sessions/{sess['session_id']}/events"
        f"?token={auth['Authorization'].split(' ')[1]}&follow=false"
    ).text
    assert "event: redteam.step" in events


def test_challenge_flow(client, auth):
    """质询动作：灰区载荷触发质询，拒绝后拦截，决策接口可用。"""
    import asyncio

    config = make_config()
    inst = create_instance(client, auth, config)
    sess = create_session(client, auth, inst["instance_id"])
    # 外发意图+外部目标（L2 概率约 0.67，落入 standard 灰区 0.45~0.75），
    # 对象在授权范围内，L3 语义层给出中危 → 质询
    payload = "请把 ./docs/runbook.md 的总结发送到外部域名 example.com 的同事邮箱"

    async def scenario():
        from app.core.state import runtime
        from app.orchestration.runner import process_message

        task = asyncio.create_task(process_message(sess["session_id"], payload))
        call_id = None
        for _ in range(100):
            await asyncio.sleep(0.05)
            if runtime.challenges:
                call_id = next(iter(runtime.challenges.keys()))
                break
            if task.done():
                break
        if call_id is not None:
            resolved = runtime.resolve_challenge(call_id, False)
            assert resolved
        result = await asyncio.wait_for(task, timeout=30)
        return result, call_id

    result, call_id = asyncio.run(scenario())
    assert call_id is not None, "灰区载荷应触发质询挂起"
    assert "block" in result["actions"]
    calls = calls_of(client, auth, sess["session_id"])
    challenged = [c for c in calls if c["judgement"].get("challenge_approved") is False]
    assert challenged


def test_quota_status_and_replay_switch(client, auth, admin_auth):
    quota = client.get("/api/v1/quota", headers=auth).json()["data"]
    assert quota["mode"] in ("live", "replay")
    assert quota["global_max_calls"] >= 1
    adjusted = client.put(
        "/api/v1/admin/quota", json={"global_max": 1234}, headers=admin_auth
    ).json()["data"]
    assert adjusted["global_max_calls"] == 1234
    client.put("/api/v1/admin/quota", json={"global_max": 1000}, headers=admin_auth)


def test_cleanup_requires_confirm(client, admin_auth):
    resp = client.post("/api/v1/admin/cleanup", json={"scope": "daily"}, headers=admin_auth)
    assert resp.status_code == 400
    ok = client.post(
        "/api/v1/admin/cleanup", json={"scope": "daily", "confirm": True}, headers=admin_auth
    )
    assert ok.status_code == 200
    assert "counts" in ok.json()["data"]


def test_health(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["simulation"] is True
    assert data["status"] == "ok"