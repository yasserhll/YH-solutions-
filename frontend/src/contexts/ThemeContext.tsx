import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Re-applied on every render of a theme change (not just mount) so it never
  // drifts from state — the inline script in index.html only handles the
  // very first paint, before React has hydrated.
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore — worst case the preference just isn't persisted.
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
