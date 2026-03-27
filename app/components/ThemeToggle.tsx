'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from '@/app/components/ThemeProvider';

/**
 * Light / dark toggle. Requires ThemeProvider (root layout).
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!ready}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brand-border bg-brand-surface text-brand-primary transition-colors hover:bg-brand-surface-muted focus:outline-none focus:ring-2 focus:ring-brand-border-focus focus:ring-offset-2 focus:ring-offset-[var(--background)] disabled:opacity-50"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {!ready ? (
        <span className="h-4 w-4 animate-pulse rounded bg-brand-surface-muted" aria-hidden />
      ) : isDark ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
