import { create } from 'zustand';

export type Space = 'light' | 'lab';

interface UiState {
  space: Space;
  setSpace: (space: Space) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  space: 'light',
  setSpace: (space) => {
    document.documentElement.setAttribute('data-theme', space === 'lab' ? 'lab' : 'light');
    set({ space });
  },
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

// 路由 → 视觉空间：攻防控制台与对照实验进入深色实验舱，其余为浅色工作台。
export function spaceForPath(path: string): Space {
  if (/^\/console\//.test(path) || /^\/experiments\//.test(path)) return 'lab';
  return 'light';
}