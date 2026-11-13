import { create } from 'zustand';

export type TourId =
  | 'workspace'
  | 'orchestration'
  | 'instances'
  | 'policies'
  | 'console'
  | 'experiment'
  | 'reports'
  | 'reportDetail'
  | 'admin';

const SEEN_KEY = 'fg_tour_seen_v1';

function loadSeen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveSeen(seen: Record<string, boolean>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // 隐私模式等场景下 localStorage 不可用，仅内存记忆。
  }
}

interface TourState {
  activeTour: TourId | null;
  current: number;
  seen: Record<string, boolean>;
  pending: TourId | null;
  start: (id: TourId) => void;
  close: () => void;
  setCurrent: (n: number) => void;
  requestTour: (id: TourId) => void;
  clearPending: () => void;
  resetSeen: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  activeTour: null,
  current: 0,
  seen: loadSeen(),
  pending: null,
  start: (id) => {
    const seen = { ...get().seen, [id]: true };
    saveSeen(seen);
    set({ activeTour: id, current: 0, seen, pending: null });
  },
  close: () => {
    set({ activeTour: null, current: 0 });
  },
  setCurrent: (n) => set({ current: n }),
  requestTour: (id) => set({ pending: id }),
  clearPending: () => set({ pending: null }),
  resetSeen: () => {
    try {
      localStorage.removeItem(SEEN_KEY);
    } catch {
      // ignore
    }
    set({ seen: {} });
  },
}));