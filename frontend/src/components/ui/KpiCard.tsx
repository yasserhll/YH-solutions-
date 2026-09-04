import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'teal';
  to?: string;
}

const tones: Record<NonNullable<KpiCardProps['tone']>, string> = {
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  green: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  red: 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  purple: 'bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400',
  teal: 'bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400',
};

export function KpiCard({ label, value, icon: Icon, tone = 'slate', to }: KpiCardProps) {
  const content = (
    <>
      <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
        <Icon size={20} />
      </div>
      <div>
        <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </>
  );

  const className = clsx(
    'flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900',
    to && 'transition-colors hover:border-slate-300 hover:shadow-sm dark:hover:border-slate-700'
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
