import type { AgentConfig, ToolName } from '@/types/api';
import { TOOL_NAMES } from './constants';

export function defaultConfig(): AgentConfig {
  return {
    name: '客服助手 Agent',
    purpose: '处理用户咨询、查询订单与文档检索',
    system_prompt:
      '你是一个企业内部客服助手。你可以帮助用户查询订单信息、检索公开文档。\n禁止读取任何凭证或敏感文件，禁止向外部域名发送邮件，禁止执行系统命令。',
    tools: {
      read_file: { enabled: true, perm: { allow_paths: ['./docs', './report'], deny_names: ['secret.txt', 'credentials.json'] } },
      write_file: { enabled: false, perm: { allow_paths: ['./tmp'], overwrite: false } },
      send_email: { enabled: true, perm: { allow_domains: ['example.com'], max_recipients: 3 } },
      query_api: { enabled: true, perm: { allow_endpoints: ['/user/info', '/order/list'], mask_fields: ['phone', 'id_card'] } },
      run_cmd: { enabled: false, perm: { allow_cmds: ['ls', 'cat'] } },
      update_config: { enabled: false, perm: { allow_keys: ['log_level', 'theme'] } },
    },
    limits: { max_calls_per_turn: 5, max_calls_per_session: 60, timeout_ms: 15000 },
    guard: { preset: 'standard', overrides: [] },
  };
}

export function configFromTemplate(config: AgentConfig): AgentConfig {
  const base = defaultConfig();
  const merged: AgentConfig = {
    ...base,
    ...config,
    tools: { ...base.tools },
    limits: { ...base.limits, ...(config.limits || {}) },
    guard: { preset: config.guard?.preset || 'standard', overrides: config.guard?.overrides || [] },
  };
  for (const name of TOOL_NAMES) {
    const incoming = config.tools?.[name];
    if (incoming) {
      merged.tools[name] = {
        enabled: !!incoming.enabled,
        perm: { ...base.tools[name].perm, ...(incoming.perm || {}) },
      };
    }
  }
  return merged;
}

export function enabledToolNames(config: AgentConfig): ToolName[] {
  return TOOL_NAMES.filter((t) => config.tools[t]?.enabled);
}