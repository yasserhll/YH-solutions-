import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Employee, Paginated } from '../../types';

interface EmployeeSelectProps {
  label?: string;
  value: number | null;
  onChange: (employee: Employee | null) => void;
  statusFilter?: 'actif' | 'sorti';
  error?: string;
}

export function EmployeeSelect({ label = 'Employé', value, onChange, statusFilter = 'actif', error }: EmployeeSelectProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', 'select', search, statusFilter],
    queryFn: () =>
      api.get<Paginated<Employee>>('/employees', { params: { search, status: statusFilter, per_page: 20 } }).then((r) => r.data.data),
  });

  const selectedLabel = useMemo(() => {
    if (!value || !data) return '';
    const emp = data.find((e) => e.id === value);
    return emp?.full_name ?? '';
  }, [value, data]);

  return (
    <div className="relative">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <input
        type="text"
        value={open ? search : selectedLabel}
        placeholder="Rechercher un employé..."
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400"
      />
      {error && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {isLoading && <div className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">Recherche...</div>}
          {!isLoading && data?.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">Aucun employé trouvé</div>
          )}
          {data?.map((emp) => (
            <button
              type="button"
              key={emp.id}
              onMouseDown={() => {
                onChange(emp);
                setSearch('');
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <span className="font-medium">{emp.full_name}</span>
              <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{emp.site?.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
