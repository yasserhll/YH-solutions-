import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
  }

  async function logout() {
    try {
      await api.post('/logout');
    } finally {
      localStorage.removeItem('token');
      setUser(null);
    }
  }

  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
