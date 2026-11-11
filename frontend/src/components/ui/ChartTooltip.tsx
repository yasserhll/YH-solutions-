import type { ReactNode } from 'react';

interface TooltipEntry {
  name?: ReactNode;
  value?: number | string | ReadonlyArray<number | string>;
  color?: string;
  dataKey?: string | number | ((obj: unknown) => unknown);
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: ReactNode;
  /** Adds a "Total" line under the series (stacked bars). */
  showTotal?: boolean;
}

/**
 * Recharts tooltip card that follows the app's own look (light and dark):
 * pass it as `<Tooltip content={<ChartTooltip />} />` instead of the
 * default white box.
 */
export function ChartTooltip({ active, payload, label, showTotal }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);

  return (
    <div className="min-w-40 rounded-lg border border-slate-200 bg-white/95 px-3 py-2.5 text-sm shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
      {label !== undefined && label !== '' && (
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      )}
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className={Number(p.value) ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}>
              {String(p.value)}
            </span>
          </li>
        ))}
      </ul>
      {showTotal && payload.length > 1 && (
        <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-slate-100 pt-1.5 dark:border-slate-700">
          <span className="text-slate-500 dark:text-slate-400">Total</span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">{total}</span>
        </div>
      )}
    </div>
  );
}
