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

/** A real /me payload — not a Wi-Fi login page or a proxy error served as 200. */
function isAuthUser(data: unknown): data is AuthUser {
  const d = data as Partial<AuthUser> | null;
  return !!d && typeof d === 'object' && typeof d.id === 'number' && typeof d.role === 'string';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Offline-first, like an installed app: a session already opened on this
  // device starts AT ONCE from its saved identity — no waiting on the
  // server, no logout when there is no network (or the server / proxy
  // answers an error page). /me then refreshes it in the background; only
  // a real 401 ends the session (the axios interceptor drops the token).
  const [user, setUser] = useState<AuthUser | null>(() => {
    const token = localStorage.getItem('token');
    return token ? rememberedUser(token) : null;
  });
  const [isLoading, setIsLoading] = useState(() => !!localStorage.getItem('token') && user === null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setIsLoading(false);
      return;
    }
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const refresh = () =>
      api
        .get<AuthUser>('/me')
        .then((res) => {
          if (stopped) return;
          if (!isAuthUser(res.data)) throw new Error('not the API');
          setUser(res.data);
          rememberUser(token, res.data);
          setIsLoading(false);
        })
        .catch((error) => {
          if (stopped) return;
          if (error?.response?.status === 401) {
            setUser(null);
            setIsLoading(false);
            return;
          }
          // Server unreachable. With a saved identity the app already runs;
          // without one (first start of this version) keep the session and
          // try again — RequireAuth shows "connexion au serveur…", never
          // the login page.
          if (!rememberedUser(token)) retry = setTimeout(refresh, 5000);
        });

    refresh();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
    };
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
