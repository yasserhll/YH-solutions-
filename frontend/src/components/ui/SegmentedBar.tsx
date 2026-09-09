import type { ChartSegment } from './DonutStat';

interface SegmentedBarProps {
  title: string;
  subtitle: string;
  segments: ChartSegment[];
}

export function SegmentedBar({ title, subtitle, segments }: SegmentedBarProps) {
  const data = segments.filter((s) => s.value > 0);
  const total = data.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
      <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>
      {total === 0 ? (
        <div className="flex h-16 items-center justify-center text-sm text-slate-400 dark:text-slate-500">Aucune donnée</div>
      ) : (
        <>
          <div className="mb-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {data.map((s) => (
              <div key={s.name} className="h-full" style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} />
            ))}
          </div>
          <ul className="space-y-2">
            {data.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="flex-1 text-slate-600 dark:text-slate-300">{s.name}</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{s.value}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
