import { create } from 'zustand';
import { authApi } from '@/services/api/resources';
import { useAuthStore } from '@/stores/authStore';
import type { QuotaStatus } from '@/types/api';

interface QuotaState {
  quota: QuotaStatus | null;
  loading: boolean;
  error: string | null;
  refresh: (sessionId?: string) => Promise<void>;
}

// 并发 refresh 按发起序号取最新结果，避免慢响应覆盖新配额。
let refreshSeq = 0;

export const useQuotaStore = create<QuotaState>((set) => ({
  quota: null,
  loading: false,
  error: null,
  refresh: async (sessionId) => {
    const seq = ++refreshSeq;
    set({ loading: true, error: null });
    try {
      const quota = await authApi.quota(sessionId);
      if (seq !== refreshSeq) return;
      useAuthStore.getState().setMode(quota.mode);
      set({ quota, loading: false });
    } catch (e) {
      if (seq !== refreshSeq) return;
      set({ loading: false, error: e instanceof Error ? e.message : '配额加载失败' });
    }
  },
}));