import { useEffect, useState } from 'react';

const KEY = 'superpool-theme';

/** Tema e çelur/errët; ruhet në shfletues dhe ndjek sistemin kur nuk është zgjedhur. */
export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0f1a' : '#0369a1');
  }, [theme]);
  const toggle = () => setTheme((t) => {
    const next = t === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* shfletues pa localStorage */ }
    return next;
  });
  return [theme, toggle];
}
