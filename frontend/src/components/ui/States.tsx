import type { LucideIcon } from 'lucide-react';
import { Inbox, Loader2 } from 'lucide-react';

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  );
}

export function InlineSpinner() {
  return <Loader2 className="animate-spin" size={16} />;
}

export function EmptyState({
  title = 'Aucune donnée',
  message = "Il n'y a rien à afficher pour le moment.",
  icon: Icon = Inbox,
}: {
  title?: string;
  message?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <Icon size={22} />
      </div>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</p>
      <p className="text-sm text-slate-400 dark:text-slate-500">{message}</p>
    </div>
  );
}
