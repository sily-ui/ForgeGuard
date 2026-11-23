// 匿名工作区标识：首次访问时生成高熵随机 ID 存入 localStorage，
// 随请求头 X-Workspace-Id 发送，后端据此隔离各浏览器实例的数据。
const STORAGE_KEY = 'bb-workspace-id';
// 旧品牌键（fg-workspace-id）仅供一次性迁移读取：命中后搬运到新键，保证已绑定的
// 工作区数据在更名后仍然可见；次年可移除。
const LEGACY_STORAGE_KEY = 'fg-workspace-id';
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
    const existing = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (existing && WORKSPACE_RE.test(existing)) {
      try {
        if (localStorage.getItem(STORAGE_KEY) !== existing) localStorage.setItem(STORAGE_KEY, existing);
      } catch {
        // 忽略写入失败。
      }
      return existing;
    }
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

// 案卷档号：由任意业务标识确定性派生，作为案卷的全局身份（BB-YYYY-NNNN）。
export function dossierFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `BB-2026-${(h & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

// 案卷档号：由工作区标识派生，作为本工作区案卷的全局身份。
export function dossierNo(wsId: string): string {
  return dossierFromId(wsId);
}
