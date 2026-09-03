import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const COMBINING_MARKS = new RegExp('[̀-ͯ]', 'g');

function slugify(label: string) {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Tab state that's also readable/writable via `?tab=<slug>` in the URL, so
 * other pages (the Dashboard KPI cards) can deep-link straight into a tab
 * instead of just the page.
 */
export function useUrlTab<T extends string>(tabs: readonly T[], defaultTab: T) {
  const [searchParams, setSearchParams] = useSearchParams();
  const bySlug = Object.fromEntries(tabs.map((t) => [slugify(t), t])) as Record<string, T>;
  const [tab, setTabState] = useState<T>(() => bySlug[searchParams.get('tab') ?? ''] ?? defaultTab);

  function setTab(next: T) {
    setTabState(next);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('tab', slugify(next));
        return params;
      },
      { replace: true }
    );
  }

  return [tab, setTab] as const;
}
