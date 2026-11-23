// 对应 policies/snapshot.py 中含 DB 的部分。
import { newId, iso, utcnow } from './deps.mjs';
import { generatePolicies, baselineSummary, mergePolicyOverride } from './policies.mjs';

export async function freezeSnapshot(store, instanceId, config, sessionId = null, configVersion = '1.0', idPrefix = 'pol') {
  const preset = config.guard.preset;
  const [policies] = generatePolicies(config, preset, config.guard.overrides ?? [], { idPrefix });
  const summary = baselineSummary(config, preset);
  const snapshotId = newId('polsnap');
  const existing = await store.count('policy_snapshots', [['instance_id', 'eq', instanceId]], 'snapshot_id');
  await store.insert('policy_snapshots', {
    snapshot_id: snapshotId,
    instance_id: instanceId,
    session_id: sessionId,
    version: existing + 1,
    baseline_summary: summary,
    policies,
    overrides: config.guard.overrides ?? [],
    config_version: configVersion,
    created_at: iso(utcnow()),
  });
  return snapshotId;
}

export async function getSnapshot(store, snapshotId) {
  const row = await store.get('policy_snapshots', 'snapshot_id', snapshotId);
  if (!row) return null;
  return {
    snapshot_id: row.snapshot_id,
    instance_id: row.instance_id,
    session_id: row.session_id,
    version: row.version,
    baseline_summary: row.baseline_summary,
    policies: row.policies ?? [],
    overrides: row.overrides ?? [],
    config_version: row.config_version,
    created_at: row.created_at,
  };
}

export async function applyPolicyOverride(store, instanceId, currentSnapshotId, policyId, override) {
  const snapshot = await getSnapshot(store, currentSnapshotId);
  if (!snapshot) return [null, '快照不存在'];
  const merged = { ...override, policy_id: policyId };
  const result = mergePolicyOverride(snapshot.policies, policyId, merged);
  if (result.error) return [null, result.error];
  const newSnapshotId = newId('polsnap');
  const existing = await store.count('policy_snapshots', [['instance_id', 'eq', instanceId]], 'snapshot_id');
  await store.insert('policy_snapshots', {
    snapshot_id: newSnapshotId,
    instance_id: instanceId,
    session_id: null,
    version: existing + 1,
    baseline_summary: snapshot.baseline_summary,
    policies: result.policies,
    overrides: [...snapshot.overrides, merged],
    config_version: snapshot.config_version,
    created_at: iso(utcnow()),
  });
  const instance = await store.get('instances', 'instance_id', instanceId);
  if (instance) await store.update('instances', { policy_snapshot_id: newSnapshotId }, [['instance_id', 'eq', instanceId]]);
  return [newSnapshotId, null];
}
