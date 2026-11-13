import type { Action, RiskLevel, StatusColor, ToolName } from '@/types/api';

export const TOOL_NAMES: ToolName[] = [
  'read_file',
  'write_file',
  'send_email',
  'query_api',
  'run_cmd',
  'update_config',
];

export const TOOL_META: Record<string, { label: string; desc: string; icon: string }> = {
  read_file: { label: '读取文件', desc: '按路径读取沙盒文件', icon: 'FileText' },
  write_file: { label: '写入文件', desc: '向沙盒写入/覆写文件', icon: 'FilePen' },
  send_email: { label: '发送邮件', desc: '向收件域名投递邮件', icon: 'Mail' },
  query_api: { label: '查询接口', desc: '调用业务接口并脱敏', icon: 'Globe' },
  run_cmd: { label: '执行命令', desc: '运行白名单仿真命令', icon: 'Terminal' },
  update_config: { label: '更新配置', desc: '修改允许的配置键', icon: 'Settings2' },
};

export const PRESET_META: Record<string, { label: string; desc: string }> = {
  loose: { label: '宽松', desc: '仅高危越权拦截，中等风险只记录不阻断' },
  standard: { label: '标准', desc: '越权一律阻断，可疑但未越权记录告警或质询' },
  strict: { label: '严格', desc: '任何越权迹象即阻断，并做跨轮一致性检查' },
  custom: { label: '自定义', desc: '在标准基础上叠加人工覆盖项' },
};

export const ACTION_META: Record<string, { label: string; verb: string }> = {
  allow: { label: 'ALLOW', verb: '放行' },
  block: { label: 'BLOCK', verb: '阻断' },
  challenge: { label: 'CHALLENGE', verb: '质询' },
  degrade: { label: 'DEGRADE', verb: '降级' },
  limit_block: { label: 'LIMIT', verb: '限额' },
  unknown: { label: 'UNKNOWN', verb: '未知' },
};

export const RISK_META: Record<string, { label: string }> = {
  none: { label: '无风险' },
  low: { label: '低' },
  medium: { label: '中' },
  high: { label: '高' },
  critical: { label: '严重' },
};

export const BOUNDARY_META: Record<string, string> = {
  tool: '工具边界',
  object: '对象边界',
  param: '参数边界',
};

export const CATEGORY_NAMES: Record<string, string> = {
  injection: '提示注入',
  jailbreak: '越狱诱导',
  privilege: '越权调用',
  exfiltration: '数据外泄',
  chain: '链式攻击',
  context: '上下文污染',
  resource: '资源滥用',
};

export const SESSION_STATUS_META: Record<string, { label: string }> = {
  active: { label: '进行中' },
  paused: { label: '已暂停' },
  terminated: { label: '已终止' },
};

export const INSTANCE_STATUS_META: Record<string, { label: string }> = {
  creating: { label: '创建中' },
  pending_retry: { label: '等待重试' },
  ready: { label: '就绪' },
  frozen: { label: '已冻结' },
  destroyed: { label: '已销毁' },
};

// 后端 status_color → 前端状态语义
export const STATUS_COLOR_MAP: Record<StatusColor, 'allow' | 'block' | 'observe' | 'disabled'> = {
  green: 'allow',
  red: 'block',
  yellow: 'observe',
  orange: 'observe',
  gray: 'disabled',
};

export function actionToStatus(action: string): 'allow' | 'block' | 'observe' | 'disabled' {
  if (action === 'allow') return 'allow';
  if (action === 'block' || action === 'limit_block') return 'block';
  if (action === 'challenge' || action === 'degrade') return 'observe';
  return 'disabled';
}

export function riskToStatus(risk: RiskLevel | string): 'allow' | 'block' | 'observe' | 'disabled' {
  if (risk === 'high' || risk === 'critical') return 'block';
  if (risk === 'medium') return 'observe';
  if (risk === 'low' || risk === 'none') return 'allow';
  return 'disabled';
}

export function riskScore(risk: RiskLevel | string): number {
  return { none: 0, low: 1, medium: 2, high: 3, critical: 4 }[risk as string] ?? 0;
}