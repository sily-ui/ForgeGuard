import { create } from 'zustand';
import { authApi } from '@/services/api/resources';
import { setAuthToken, setUnauthorizedHandler } from '@/services/api/client';
import { clientId } from '@/utils/format';
import type { Mode, Role } from '@/types/api';

interface AuthState {
  token: string | null;
  role: Role | null;
  mode: Mode;
  expiresAt: number | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  error: string | null;
  enter: () => Promise<boolean>;
  logout: () => Promise<void>;
  clear: () => void;
  setMode: (mode: Mode) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  role: null,
  mode: 'live',
  expiresAt: null,
  status: 'idle',
  error: null,
  enter: async () => {
    set({ status: 'loading', error: null });
    try {
      const data = await authApi.guest(clientId());
      setAuthToken(data.token);
      set({
        token: data.token,
        role: data.role,
        mode: data.mode,
        expiresAt: Date.now() + data.expires_in * 1000,
        status: 'authenticated',
        error: null,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '游客准入失败';
      setAuthToken(null);
      set({ status: 'error', error: message, token: null, role: null });
      return false;
    }
  },
  logout: async () => {
    try {
      if (get().token) await authApi.logout();
    } catch {
      // 令牌可能已失效，忽略远端撤销错误。
    }
    get().clear();
  },
  clear: () => {
    setAuthToken(null);
    set({ token: null, role: null, expiresAt: null, status: 'idle', error: null });
  },
  setMode: (mode) => set({ mode }),
}));

setUnauthorizedHandler(() => {
  useAuthStore.getState().clear();
});