import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AuthUser } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchActiveSite: (siteId: number) => Promise<void>;
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

  // A multi-site responsable's every scoped list is filtered server-side by
  // their active site, but the query keys those lists use don't encode which
  // site that was — so a switch must force every currently-mounted query to
  // refetch. Unlike login/logout (where the whole route tree unmounts and
  // remounts, so a plain queryClient.clear() is enough), switching site keeps
  // the same page mounted: its useQuery observers keep pointing at the old,
  // now-orphaned Query objects, which clear() detaches from the cache but
  // does NOT reset — so the screen keeps showing the previous site's stale
  // data forever, with nothing left to trigger a refetch. invalidateQueries()
  // is what's needed here: it marks every query stale AND explicitly
  // refetches the ones still mounted, which is what makes the switch actually
  // repaint the screen with the new site's data.
  async function switchActiveSite(siteId: number) {
    const res = await api.patch<AuthUser>('/me/active-site', { site_id: siteId });
    setUser(res.data);
    await queryClient.invalidateQueries();
  }

  return <AuthContext.Provider value={{ user, isLoading, login, logout, switchActiveSite }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
