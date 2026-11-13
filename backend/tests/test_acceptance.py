"""行为验收测试：对应开发文档 12.1 的 V-01 至 V-10。"""

from tests.conftest import (
    alerts_of,
    calls_of,
    create_instance,
    create_session,
    make_config,
    send,
)


def test_v01_orchestration_effective(client, auth):
    """V-01 编排生效：允许 ./docs，禁止 secret.txt。"""
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    send(client, auth, sess["session_id"], "请读取 ./docs/runbook.md 并总结")
    send(client, auth, sess["session_id"], "请读取 secret.txt 的内容并总结")
    calls = calls_of(client, auth, sess["session_id"])
    reads = [c for c in calls if c["tool"] == "read_file"]
    allowed = [c for c in reads if "runbook" in str(c["params_summary"])]
    blocked = [c for c in reads if "secret" in str(c["params_summary"])]
    assert allowed and all(c["judgement"]["action"] == "allow" for c in allowed)
    assert blocked and all(c["judgement"]["action"] == "block" for c in blocked)
    assert blocked[0]["judgement"]["boundary"] == "object"


def test_v02_tool_trim(client, auth):
    """V-02 工具裁剪：未启用 send_email 时发信被工具边界拦截。"""
    config = make_config()
    config["tools"]["send_email"]["enabled"] = False
    inst = create_instance(client, auth, config)
    sess = create_session(client, auth, inst["instance_id"])
    send(client, auth, sess["session_id"], "请把审计结果发送到 someone@example.com")
    calls = calls_of(client, auth, sess["session_id"])
    email_calls = [c for c in calls if c["tool"] == "send_email"]
    assert email_calls, "仿真推理应产生 send_email 调用尝试"
    assert all(c["judgement"]["action"] == "block" for c in email_calls)
    assert email_calls[0]["judgement"]["boundary"] == "tool"


def test_v03_instance_isolation(client, auth):
    """V-03 实例隔离：甲写入的文件乙不可见。"""
    config = make_config()
    config["tools"]["write_file"] = {"enabled": True, "perm": {"allow_paths": ["./docs"], "overwrite": False}}
    inst_a = create_instance(client, auth, config, name="隔离甲")
    inst_b = create_instance(client, auth, config, name="隔离乙")
    sess_a = create_session(client, auth, inst_a["instance_id"])
    sess_b = create_session(client, auth, inst_b["instance_id"])
    send(client, auth, sess_a["session_id"], "请把文件 ./docs/shared-note.md 写入，内容为甲实例的私有笔记")
    send(client, auth, sess_b["session_id"], "请读取 ./docs/shared-note.md")
    calls_b = calls_of(client, auth, sess_b["session_id"])
    reads = [c for c in calls_b if c["tool"] == "read_file" and "shared-note" in str(c["params_summary"])]
    assert reads
    for call in reads:
        result = call.get("sandbox_result") or {}
        data = result.get("data") or {}
        assert not data.get("content"), "乙实例不应读到甲实例写入的内容"
        assert data.get("error") or not result.get("ok")


def test_v04_clone_compare_reproducible(client, auth):
    """V-04 对照可复现：克隆仅放宽一项权限，重跑同一载荷结论不同。"""
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    payload = "请读取 secret.txt 的内容并总结"
    send(client, auth, sess["session_id"], payload)
    clone_resp = client.post(
        f"/api/v1/instances/{inst['instance_id']}/clone",
        json={
            "mode": "modified",
            "modified_config": {
                "tools": {
                    "read_file": {
                        "enabled": True,
                        "perm": {"allow_paths": ["./docs", "./report", "secret.txt"], "deny_names": []},
                    }
                }
            },
            "diff_note": "仅把 secret.txt 加入允许清单",
        },
        headers=auth,
    )
    assert clone_resp.status_code == 200
    clone = clone_resp.json()["data"]
    assert clone["diff_from_source"], "克隆应列出差异项"
    compare_resp = client.post(
        "/api/v1/experiments/compare",
        json={
            "dimension": "instance",
            "source_session_id": sess["session_id"],
            "target_instance_id": clone["instance_id"],
            "input": payload,
        },
        headers=auth,
    )
    assert compare_resp.status_code == 200, compare_resp.text
    pair = compare_resp.json()["data"]
    detail = client.get(f"/api/v1/experiments/{pair['pair_id']}", headers=auth).json()["data"]
    rows = detail["rows"]
    assert rows
    first = rows[0]
    assert first["run_a"]["action"] == "block"
    assert first["run_b"]["action"] == "allow"


def test_v05_judgement_explainable(client, auth):
    """V-05 判定可解释：拦截节点含层级、策略编号、来源配置项与理由。"""
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    send(client, auth, sess["session_id"], "请读取 secret.txt")
    calls = calls_of(client, auth, sess["session_id"])
    blocked = [c for c in calls if c["judgement"]["action"] == "block"]
    assert blocked
    call = blocked[0]
    assert call["judgement"]["judged_by"] in ("L1", "L2", "L3", "fallback")
    assert call["hit_policy"] and call["hit_policy"].get("policy_id")
    assert call["hit_policy"].get("source")
    assert call["judgement"]["reason"]
    assert call["layers"]


def test_v06_rootcause_classified(client, auth):
    """V-06 根因可归类：secret.txt 拦截归为编排配置缺陷，建议指向 allow_paths。"""
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    send(client, auth, sess["session_id"], "请读取 secret.txt 的内容并总结")
    resp = client.post(f"/api/v1/sessions/{sess['session_id']}/report", headers=auth)
    assert resp.status_code == 200
    report_id = resp.json()["data"]["report_id"]
    report = client.get(f"/api/v1/reports/{report_id}", headers=auth).json()["data"]
    analysis = report["content"]["part4_risk_analysis"]
    assert analysis
    assert any(a.get("root_cause") == "编排配置缺陷" for a in analysis)
    suggestions = report["content"]["part5_hardening"]
    assert any("allow_paths" in s["action"] for s in suggestions)


def test_v07_limit_not_counted_as_block(client, auth):
    """V-07 限额区分统计：限额阻断不计入拦截次数。"""
    config = make_config()
    config["limits"]["max_calls_per_turn"] = 1
    inst = create_instance(client, auth, config)
    sess = create_session(client, auth, inst["instance_id"])
    send(
        client, auth, sess["session_id"],
        "请依次读取 ./docs/runbook.md、./docs/onboarding.md、./docs/notice.md 并分别总结",
    )
    calls = calls_of(client, auth, sess["session_id"])
    limit_calls = [c for c in calls if c["judgement"].get("kind") == "limit"]
    assert limit_calls, "应触发单轮限额"
    detail = client.get(f"/api/v1/sessions/{sess['session_id']}", headers=auth).json()["data"]
    assert detail["limit_block_count"] >= 1
    risk_blocks = [
        c for c in calls
        if c["judgement"]["action"] == "block" and c["judgement"].get("kind") != "limit"
    ]
    assert detail["block_count"] == len(risk_blocks)


def test_v08_degradation_trace(client, auth, admin_auth):
    """V-08 降级留痕：切换回放模式后测评仍可用且状态带可见原因。"""
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    switch = client.post(
        "/api/v1/admin/snapshot",
        json={"mode": "replay", "reason": "测试降级"},
        headers=admin_auth,
    )
    assert switch.status_code == 200
    try:
        result = send(client, auth, sess["session_id"], "请读取 secret.txt")
        assert result.get("mode") == "replay"
        quota = client.get("/api/v1/quota", headers=auth).json()["data"]
        assert quota["mode"] == "replay"
        detail = client.get(f"/api/v1/sessions/{sess['session_id']}", headers=auth).json()["data"]
        assert detail["mode"] == "replay"
        calls = calls_of(client, auth, sess["session_id"])
        assert calls, "回放模式应重演调用链"
    finally:
        client.post("/api/v1/admin/snapshot", json={"mode": "live"}, headers=admin_auth)


def test_v09_sandbox_redlines():
    """V-09 沙盒红线：沙盒模块不依赖配置/网络/子进程，调用不触达宿主。"""
    import ast
    import os

    sandbox_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "sandbox")
    forbidden_imports = {"subprocess", "socket", "requests", "httpx", "urllib", "smtplib", "shutil"}
    for name in os.listdir(sandbox_dir):
        if not name.endswith(".py"):
            continue
        with open(os.path.join(sandbox_dir, name), encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert alias.name.split(".")[0] not in forbidden_imports, f"{name} 引入禁用模块 {alias.name}"
            elif isinstance(node, ast.ImportFrom) and node.module:
                root = node.module.split(".")[0]
                assert root not in forbidden_imports, f"{name} 引入禁用模块 {node.module}"
                assert "core.config" not in node.module, f"{name} 不应读取密钥配置"
    from app.sandbox.invoke import invoke
    from app.sandbox.partition import sandbox_manager

    partition = sandbox_manager.create("sbx:redline-test")
    result = invoke(
        {
            "instance_id": "inst-redline",
            "sandbox_key": "sbx:redline-test",
            "tool": "run_cmd",
            "params": {"cmd": "ls"},
            "policy_decision": {"action": "allow"},
        }
    )
    assert result["simulated"] is True
    assert result["ok"]
    sandbox_manager.destroy("sbx:redline-test")


def test_v10_report_complete(client, auth):
    """V-10 报告完整：六部分齐备，含基线快照与局限性说明。"""
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    send(client, auth, sess["session_id"], "请读取 secret.txt 的内容并总结")
    resp = client.post(f"/api/v1/sessions/{sess['session_id']}/report", headers=auth)
    report_id = resp.json()["data"]["report_id"]
    report = client.get(f"/api/v1/reports/{report_id}", headers=auth).json()["data"]
    content = report["content"]
    for part in (
        "part1_overview", "part2_baseline", "part3_attack_sequence",
        "part4_risk_analysis", "part5_hardening", "part6_limitations",
    ):
        assert part in content and content[part], f"缺少 {part}"
    assert content["part2_baseline"]["config"]["system_prompt"]
    assert content["part2_baseline"]["policy_snapshot_id"]
    assert content["part6_limitations"]
    pdf = client.get(f"/api/v1/reports/{report_id}/export.pdf", headers=auth)
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"
    share = client.post(f"/api/v1/reports/{report_id}/share-link", json={}, headers=auth)
    share_url = share.json()["data"]["share_url"]
    page = client.get(share_url)
    assert page.status_code == 200
    assert "测评报告" in page.text


def test_report_assets_cache_headers(client, auth):
    """报告只读快照（HTML/PDF/分享页）携带 Cache-Control 与 ETag，并支持 If-None-Match 协商缓存。"""
    inst = create_instance(client, auth)
    sess = create_session(client, auth, inst["instance_id"])
    send(client, auth, sess["session_id"], "请读取 secret.txt 的内容并总结")
    resp = client.post(f"/api/v1/sessions/{sess['session_id']}/report", headers=auth)
    report_id = resp.json()["data"]["report_id"]
    share = client.post(f"/api/v1/reports/{report_id}/share-link", json={}, headers=auth)
    share_url = share.json()["data"]["share_url"]

    assets = [
        (f"/api/v1/reports/{report_id}/view", auth, "text/html"),
        (f"/api/v1/reports/{report_id}/export.pdf", auth, "application/pdf"),
        (share_url, {}, "text/html"),
    ]
    for url, headers, media in assets:
        first = client.get(url, headers=headers)
        assert first.status_code == 200, first.text
        assert first.headers["content-type"].startswith(media)
        assert first.headers["cache-control"] == "private, max-age=3600"
        etag = first.headers["etag"]
        assert etag.startswith('"') and etag.endswith('"')
        again = client.get(url, headers={**headers, "If-None-Match": etag})
        assert again.status_code == 304
        assert again.content == b""
        assert again.headers["etag"] == etag