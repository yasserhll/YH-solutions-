import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
