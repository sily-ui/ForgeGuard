"""L1 工具边界回归：工具专属规则不得跨工具误判。

复现并锁定缺陷：read_file 与 write_file 同时启用且允许路径不同时，
write_file 的 allow_paths（./tmp）不得拦截 read_file 对 ./report 的合法读取。
"""

from app.guard.l1 import evaluate
from app.policies.mapping import generate_policies
from tests.conftest import make_config


def _policies():
    config = make_config()
    config["tools"]["read_file"]["perm"]["allow_paths"] = ["./docs", "./report"]
    config["tools"]["write_file"] = {
        "enabled": True,
        "perm": {"allow_paths": ["./tmp"], "overwrite": False},
    }
    policies, _ = generate_policies(config)
    return policies


def test_read_allowed_path_not_blocked_by_write_rule():
    """read_file 读取 ./report 合法路径应放行，不被 write_file 的 ./tmp 规则误拦。"""
    rules = _policies()
    result = evaluate("read_file", {"path": "./report/weekly.md"}, rules)
    assert result["hit"] is False, result["rules"]


def test_read_docs_allowed():
    rules = _policies()
    assert evaluate("read_file", {"path": "./docs/runbook.md"}, rules)["hit"] is False


def test_read_outside_read_allow_blocked():
    """read_file 读取 ./tmp（仅 write 允许）应被 read_file 自身规则拦截。"""
    rules = _policies()
    result = evaluate("read_file", {"path": "./tmp/scratch.txt"}, rules)
    assert result["hit"] is True
    assert result["rules"][0]["action"] == "block"
    assert result["rules"][0]["source"] == "read_file.allow_paths"


def test_read_deny_name_blocked():
    rules = _policies()
    result = evaluate("read_file", {"path": "./docs/secret.txt"}, rules)
    assert result["hit"] is True
    assert any(r["source"] == "read_file.deny_names" for r in result["rules"])


def test_write_allowed_path_ok():
    rules = _policies()
    assert evaluate("write_file", {"path": "./tmp/out.txt"}, rules)["hit"] is False


def test_write_outside_write_allow_blocked():
    """write_file 写入 ./report（仅 read 允许）应被 write_file 自身规则拦截。"""
    rules = _policies()
    result = evaluate("write_file", {"path": "./report/weekly.md"}, rules)
    assert result["hit"] is True
    assert result["rules"][0]["source"] == "write_file.allow_paths"


def test_email_domain_scoped_to_send_email():
    """send_email 域名规则只作用于 send_email，不影响其它工具。"""
    rules = _policies()
    bad = evaluate("send_email", {"to": ["audit@external-example.com"]}, rules)
    assert bad["hit"] is True
    ok = evaluate("send_email", {"to": ["colleague@example.com"]}, rules)
    assert ok["hit"] is False


def test_legacy_snapshot_without_tool_param():
    """旧快照 params 无 tool 字段时，按 source 前缀推断工具归属仍正确。"""
    rules = _policies()
    for policy in rules:
        if policy["rule_type"] != "tool_existence":
            policy.get("params", {}).pop("tool", None)
    assert evaluate("read_file", {"path": "./report/weekly.md"}, rules)["hit"] is False
    assert evaluate("write_file", {"path": "./report/weekly.md"}, rules)["hit"] is True