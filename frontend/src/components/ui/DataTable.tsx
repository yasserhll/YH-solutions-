import type { ReactNode } from 'react';
import { EmptyState, LoadingState } from './States';

export interface Column<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  isLoading?: boolean;
  keyFn: (row: T) => string | number;
  emptyMessage?: string;
}

export function DataTable<T>({ columns, rows, isLoading, keyFn, emptyMessage }: DataTableProps<T>) {
  if (isLoading) return <LoadingState />;
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
            {columns.map((col, i) => (
              <th key={i} className={'px-4 py-3 font-medium ' + (col.className ?? '')}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row) => (
            <tr key={keyFn(row)} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
              {columns.map((col, i) => (
                <td key={i} className={'px-4 py-3 text-slate-700 dark:text-slate-300 ' + (col.className ?? '')}>
                  {col.accessor(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
