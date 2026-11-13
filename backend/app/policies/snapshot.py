from ..core.ids import new_id
from ..core.security import iso, utcnow
from ..models import db as dbmod
from .baseline import normalize_config
from .mapping import apply_overrides, baseline_summary, generate_policies


def freeze_snapshot(instance_id, config, session_id=None, config_version="1.0", id_prefix="pol"):
    preset = config["guard"]["preset"]
    policies, _rejected = generate_policies(
        config, preset, config["guard"].get("overrides", []), id_prefix=id_prefix
    )
    summary = baseline_summary(config, preset)
    snapshot_id = new_id("polsnap")
    with dbmod.session_scope() as db:
        version = (
            db.query(dbmod.PolicySnapshot)
            .filter(dbmod.PolicySnapshot.instance_id == instance_id)
            .count()
            + 1
        )
        db.add(
            dbmod.PolicySnapshot(
                snapshot_id=snapshot_id,
                instance_id=instance_id,
                session_id=session_id,
                version=version,
                baseline_summary=summary,
                policies=policies,
                overrides=config["guard"].get("overrides", []),
                config_version=config_version,
                created_at=iso(utcnow()),
            )
        )
    return snapshot_id


def get_snapshot(snapshot_id):
    with dbmod.session_scope() as db:
        row = db.get(dbmod.PolicySnapshot, snapshot_id)
        if row is None:
            return None
        return {
            "snapshot_id": row.snapshot_id,
            "instance_id": row.instance_id,
            "session_id": row.session_id,
            "version": row.version,
            "baseline_summary": row.baseline_summary,
            "policies": row.policies,
            "overrides": row.overrides,
            "config_version": row.config_version,
            "created_at": row.created_at,
        }


def apply_policy_override(instance_id, current_snapshot_id, policy_id, override):
    """人工覆盖产生新版本快照（只增不改），返回新快照标识。"""
    snapshot = get_snapshot(current_snapshot_id)
    if snapshot is None:
        return None, "快照不存在"
    policies = [dict(p) for p in snapshot["policies"]]
    target = next((p for p in policies if p["policy_id"] == policy_id), None)
    if target is None:
        return None, "策略条目不存在"
    if target["rule_type"] == "tool_existence" and override.get("enabled") is False:
        return None, "工具存在性硬规则不允许停用"
    merged = dict(override)
    merged["policy_id"] = policy_id
    rejected = apply_overrides(policies, [merged])
    if rejected:
        return None, rejected[0]["reason"]
    overrides = list(snapshot["overrides"]) + [merged]
    new_snapshot_id = new_id("polsnap")
    with dbmod.session_scope() as db:
        version = (
            db.query(dbmod.PolicySnapshot)
            .filter(dbmod.PolicySnapshot.instance_id == instance_id)
            .count()
            + 1
        )
        db.add(
            dbmod.PolicySnapshot(
                snapshot_id=new_snapshot_id,
                instance_id=instance_id,
                session_id=None,
                version=version,
                baseline_summary=snapshot["baseline_summary"],
                policies=policies,
                overrides=overrides,
                config_version=snapshot["config_version"],
                created_at=iso(utcnow()),
            )
        )
        instance = db.get(dbmod.Instance, instance_id)
        if instance:
            instance.policy_snapshot_id = new_snapshot_id
    return new_snapshot_id, None


def index_rules(policies, tool_name):
    """按工具名索引规则，判定耗时与策略总量解耦。"""
    relevant = []
    for policy in policies:
        if not policy.get("enabled", True):
            continue
        level = policy.get("level")
        rule_type = policy.get("rule_type")
        params = policy.get("params", {})
        if level in ("L2", "L3"):
            relevant.append(policy)
        elif rule_type == "tool_existence":
            if params.get("tool") == tool_name:
                relevant.append(policy)
        elif rule_type in ("call_limit", "timeout"):
            relevant.append(policy)
        elif params.get("tool") == tool_name or rule_type in _TOOL_RULES.get(tool_name, set()):
            relevant.append(policy)
    return relevant


_TOOL_RULES = {
    "read_file": {"allow_path_prefix", "deny_filename", "path_traversal"},
    "write_file": {"allow_path_prefix", "path_traversal", "overwrite_check"},
    "send_email": {"allow_domain_suffix", "max_recipients"},
    "query_api": {"allow_endpoint", "mask_fields"},
    "run_cmd": {"allow_cmd"},
    "update_config": {"allow_key", "sensitive_key"},
}


def snapshot_view(snapshot):
    grouped = {"L1": [], "L2": [], "L3": []}
    for policy in snapshot["policies"]:
        grouped.setdefault(policy["level"], []).append(policy)
    return {
        "snapshot_id": snapshot["snapshot_id"],
        "version": snapshot["version"],
        "config_version": snapshot["config_version"],
        "baseline_summary": snapshot["baseline_summary"],
        "manual_override_count": sum(
            1 for p in snapshot["policies"] if p.get("origin") == "manual"
        ),
        "levels": grouped,
        "created_at": snapshot["created_at"],
    }