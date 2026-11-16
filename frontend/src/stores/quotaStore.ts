import { create } from 'zustand';
import { authApi } from '@/services/api/resources';
import type { QuotaStatus } from '@/types/api';

interface QuotaState {
  quota: QuotaStatus | null;
  loading: boolean;
  error: string | null;
  refresh: (sessionId?: string) => Promise<void>;
}

export const useQuotaStore = create<QuotaState>((set) => ({
  quota: null,
  loading: false,
  error: null,
  refresh: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const quota = await authApi.quota(sessionId);
      set({ quota, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '配额加载失败' });
    }
  },
}));