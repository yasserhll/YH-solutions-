import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { disablePushOnThisDevice } from '../hooks/usePushNotifications';
import { askServiceWorker } from '../utils/connectivity';
import type { AuthUser } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The signed-in identity, kept for opening the app offline. Stored with its
// token so a copy can never be used for another session.
const USER_KEY = 'me-offline';

function rememberUser(token: string, user: AuthUser) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify({ token, user }));
  } catch {
    /* storage unavailable */
  }
}

function rememberedUser(token: string): AuthUser | null {
  try {
    const saved = JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as { token: string; user: AuthUser } | null;
    return saved && saved.token === token ? saved.user : null;
  } catch {
    return null;
  }
}

function forgetUser() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

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
      .then((res) => {
        setUser(res.data);
        rememberUser(token, res.data);
      })
      .catch((error) => {
        // Opening the app without network must NOT log out (it used to: the
        // token was dropped on any /me failure, so the offline mode was
        // unusable). Only a real 401 ends the session — the axios
        // interceptor removes the token then. No answer at all: this
        // session's last known identity, saved on this device.
        if (error?.response) return;
        const saved = rememberedUser(token);
        if (saved) setUser(saved);
      })
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
    rememberUser(res.data.token, res.data.user);
    setUser(res.data.user);
  }

  async function logout() {
    try {
      // This device must stop receiving the account's notifications.
      await disablePushOnThisDevice().catch(() => undefined);
      await api.post('/logout');
    } finally {
      localStorage.removeItem('token');
      forgetUser();
      // This account's offline copies leave the device too.
      askServiceWorker('clear-api-cache');
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
