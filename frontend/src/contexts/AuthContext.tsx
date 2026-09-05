import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AuthUser } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setIsLoading(false);
      return;
    }
    api
      .get<AuthUser>('/me')
      .then((res) => setUser(res.data))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setIsLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post('/login', { email, password });
    // Some query keys (e.g. cash-account) return a different response shape
    // per role. Without clearing here, a page navigated to right after login
    // can still read a previous session's cached response under the same
    // key and crash on the shape mismatch, showing a blank page until a
    // manual refresh. Same class of bug as the /api/me HTTP-cache issue —
    // this is the in-memory React Query cache, a separate layer.
    queryClient.clear();
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
  }

  async function logout() {
    try {
      await api.post('/logout');
    } finally {
      localStorage.removeItem('token');
      setUser(null);
      queryClient.clear();
    }
  }

  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
