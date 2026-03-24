'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolved: 'light' | 'dark';
  mounted: boolean;
  setTheme: (theme: Theme) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolved: 'dark',
  mounted: false,
  setTheme: () => {},
  cycle: () => {},
});

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return getSystemTheme();
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always start with 'system' for SSR consistency — hydrate from localStorage in useEffect
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('dark');
  const [mounted, setMounted] = useState(false);

  const applyTheme = useCallback((t: Theme) => {
    const r = resolveTheme(t);
    setResolved(r);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', r === 'dark');
    }
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem('vldr-theme', t);
    applyTheme(t);
  }, [applyTheme]);

  const cycle = useCallback(() => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  }, [theme, setTheme]);

  // Hydrate theme from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    const stored = (localStorage.getItem('vldr-theme') as Theme) ?? 'system';
    setThemeState(stored);
    applyTheme(stored);
    setMounted(true);
  }, [applyTheme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, mounted, setTheme, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
