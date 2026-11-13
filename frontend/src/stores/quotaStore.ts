import { create } from 'zustand';
import { authApi } from '@/services/api/resources';
import type { QuotaStatus } from '@/types/api';

interface QuotaState {
  quota: QuotaStatus | null;
  loading: boolean;
  refresh: (sessionId?: string) => Promise<void>;
}

export const useQuotaStore = create<QuotaState>((set) => ({
  quota: null,
  loading: false,
  refresh: async (sessionId) => {
    set({ loading: true });
    try {
      const quota = await authApi.quota(sessionId);
      set({ quota, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));