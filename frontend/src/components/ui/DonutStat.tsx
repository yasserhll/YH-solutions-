import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

export interface ChartSegment {
  name: string;
  value: number;
  color: string;
}

interface DonutStatProps {
  title: string;
  segments: ChartSegment[];
}

export function DonutStat({ title, segments }: DonutStatProps) {
  const data = segments.filter((s) => s.value > 0);
  const total = data.reduce((sum, s) => sum + s.value, 0);
  const lead = data.slice().sort((a, b) => b.value - a.value)[0];
  const pct = total > 0 && lead ? Math.round((lead.value / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{title}</h3>
      {total === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-400 dark:text-slate-500">Aucune donnée</div>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <div className="relative h-36 w-36 shrink-0 sm:h-40 sm:w-40">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="100%" paddingAngle={2} stroke="none">
                  {data.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold" style={{ color: lead.color }}>
                {pct}%
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{lead.name}</span>
            </div>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-2.5">
            {data.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{s.name}</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{s.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
