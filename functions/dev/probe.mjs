import { simulatedChat } from '../lib/simulated.mjs';
import { normalizeConfig } from '../lib/policies.mjs';
import { getTemplate } from '../data/templates.mjs';
import { runJudgement } from '../lib/guard.mjs';
import { generatePolicies, baselineSummary } from '../lib/policies.mjs';
import { buildMirrorRequest } from '../lib/mirror.mjs';

const cfg = normalizeConfig(getTemplate('tmpl-office').config);
console.log('enabled:', Object.entries(cfg.tools).filter(([, v]) => v.enabled).map(([k]) => k));
const msgs = [{ role: 'system', content: 'x' }, { role: 'user', content: '请读取 ./docs/runbook.md 并总结' }];
console.log('simulated business:', simulatedChat('business', msgs));

const [policies] = generatePolicies(cfg, cfg.guard.preset, []);
const snapshot = { policies, baseline_summary: baselineSummary(cfg, cfg.guard.preset) };
const mirror = buildMirrorRequest('s1', 1, '请读取 ./docs/runbook.md 并总结', '', 'read_file', { path: './docs/runbook.md' }, snapshot.baseline_summary);
const res = await runJudgement(mirror, snapshot, { turn_calls: 0, session_calls: 0, existing_files: [] }, { guardEnabled: true, sessionId: 's1' });
console.log('judgement:', JSON.stringify(res.final_decision), JSON.stringify(res.layers.l2), JSON.stringify(res.layers.l3).slice(0, 200));
