// 匿名工作区标识：首次访问时生成高熵随机 ID 存入 localStorage，
// 随请求头 X-Workspace-Id 发送，后端据此隔离各浏览器实例的数据。
const STORAGE_KEY = 'fg-workspace-id';
const WORKSPACE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getWorkspaceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && WORKSPACE_RE.test(existing)) return existing;
  } catch {
    // localStorage 不可用（隐私模式等）时退回临时 ID，刷新后数据不可见属预期。
  }
  const id = randomId();
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 忽略写入失败。
  }
  return id;
}

export function regenerateWorkspace(): string {
  const id = randomId();
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 忽略写入失败。
  }
  return id;
}

export function workspaceShort(id: string): string {
  return id.slice(0, 8);
}
