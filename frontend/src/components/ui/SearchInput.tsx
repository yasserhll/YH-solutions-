import { Search } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
      <input
        type="text"
        {...props}
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-400"
      />
    </div>
  );
}
