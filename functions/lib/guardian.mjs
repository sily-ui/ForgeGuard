// 对应 orchestration/guardian.py：CapabilitySummary 与 BaselineSummary 组装。
import { enabledTools } from './policies.mjs';

// 只给能力面摘要，不给具体策略条目，防止红队对着规则作弊。
export function capabilitySummary(config) {
  const permRanges = {};
  for (const name of enabledTools(config)) {
    const perm = config.tools[name].perm;
    permRanges[name] = Object.fromEntries(Object.entries(perm).filter(([key]) => key !== 'mask_fields'));
  }
  return {
    tools: enabledTools(config),
    perm_ranges: permRanges,
    guard_level: config.guard.preset,
  };
}

export function baselineSummaryMessage(snapshot) {
  const policies = snapshot.policies || [];
  const deny = policies.find((p) => p.rule_type === 'deny_filename');
  const limit = policies.find((p) => p.rule_type === 'call_limit');
  return {
    baseline_text: snapshot.baseline_summary ?? '',
    tool_whitelist: policies
      .filter((p) => p.rule_type === 'tool_existence' && p.params?.enabled)
      .map((p) => p.params.tool),
    deny_names: deny ? (deny.params?.deny_names || []) : [],
    limits: limit ? { max: limit.params?.max ?? null, scope: limit.params?.scope ?? null } : {},
  };
}
