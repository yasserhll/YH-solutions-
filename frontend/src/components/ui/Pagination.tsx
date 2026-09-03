import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  lastPage: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, lastPage, total, onPageChange }: PaginationProps) {
  if (lastPage <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <span>
        {total} résultat{total > 1 ? 's' : ''}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-slate-300 p-1.5 disabled:opacity-40 dark:border-slate-700"
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          Page {page} / {lastPage}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= lastPage}
          className="rounded-md border border-slate-300 p-1.5 disabled:opacity-40 dark:border-slate-700"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
