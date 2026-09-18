import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useUrlTab } from '../hooks/useUrlTab';
import type { Employee, OvertimeEntry, OvertimeMonth, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TextAreaField, TextField } from '../components/ui/Field';
import { EmployeeSelect } from '../components/ui/EmployeeSelect';

const tabs = ['Déclarations', 'Résumé mensuel'] as const;

function hoursLabel(h: string | number) {
  const n = Number(h);
  return `${Number.isInteger(n) ? n : n.toFixed(2)} h`;
}

function monthLabel(month: string) {
  return new Date(month).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export default function OvertimePage() {
  const [tab, setTab] = useUrlTab(tabs, 'Déclarations');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // Empty = every month (most recent first). Picking one lets a
  // responsable/SuperAdmin browse a past month's history to verify
  // something, without it being mixed in with every other month.
  const [monthFilter, setMonthFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<OvertimeEntry | null>(null);
  const [deleting, setDeleting] = useState<OvertimeEntry | null>(null);
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();

  const entriesQuery = useQuery({
    queryKey: ['overtime-entries', siteParams, page, search, monthFilter],
    queryFn: () =>
      api
        .get<Paginated<OvertimeEntry>>('/overtime-entries', {
          params: { ...siteParams, page, search: search || undefined, month: monthFilter || undefined },
        })
        .then((r) => r.data),
    enabled: tab === 'Déclarations',
  });

  const monthsQuery = useQuery({
    queryKey: ['overtime-months', siteParams, page, search, monthFilter],
    queryFn: () =>
      api
        .get<Paginated<OvertimeMonth>>('/overtime-months', {
          params: { ...siteParams, page, search: search || undefined, month: monthFilter || undefined },
        })
        .then((r) => r.data),
    enabled: tab === 'Résumé mensuel',
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/overtime-entries/${id}`),
    onSuccess: () => {
      toast.success('Déclaration supprimée.');
      queryClient.invalidateQueries({ queryKey: ['overtime-entries'] });
      queryClient.invalidateQueries({ queryKey: ['overtime-months'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const entryColumns: Column<OvertimeEntry>[] = [
    { header: 'Date', accessor: (e) => new Date(e.date).toLocaleDateString('fr-FR') },
    { header: 'Employé', accessor: (e) => e.employee?.full_name },
    { header: 'Site', accessor: (e) => e.site?.name },
    { header: 'Heures', accessor: (e) => hoursLabel(e.hours) },
    { header: 'Remarque', accessor: (e) => e.remark ?? '—' },
    { header: 'Saisi par', accessor: (e) => e.creator?.name ?? '—' },
    {
      header: 'Actions',
      accessor: (e) => (
        <div className="flex items-center gap-1">
          <button
            className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setEditingEntry(e)}
          >
            <Pencil size={16} />
          </button>
          <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeleting(e)}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const monthColumns: Column<OvertimeMonth>[] = [
    { header: 'Mois', accessor: (m) => <span className="capitalize">{monthLabel(m.month)}</span> },
    { header: 'Employé', accessor: (m) => m.employee?.full_name },
    { header: 'Site', accessor: (m) => m.site?.name },
    { header: 'Reportées', accessor: (m) => hoursLabel(m.carried_hours) },
    { header: 'Nouvelles', accessor: (m) => hoursLabel(m.declared_hours) },
    { header: 'Total', accessor: (m) => hoursLabel(m.total_hours) },
    { header: 'Jours', accessor: (m) => <span className="font-semibold">{m.days_earned}</span> },
    { header: 'Reliquat', accessor: (m) => hoursLabel(m.remaining_hours) },
    // Automatic — paid the moment the calendar moves past that month (see
    // OvertimeMonth::isPaid() backend-side), so there's nothing to action here.
    { header: 'Statut', accessor: (m) => <StatusBadge status={m.is_paid ? 'paye' : 'a_payer'} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Heures supplémentaires"
        description="8 heures supplémentaires = 1 journée à payer — le reliquat est reporté automatiquement au mois suivant"
        actions={
          tab === 'Déclarations' && (
            <Button onClick={() => setShowForm(true)}>
              <Plus size={16} /> Déclarer des heures
            </Button>
          )
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => (setTab(t), setPage(1))}
            className={clsx(
              'shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium',
              tab === t
                ? 'border-slate-900 text-slate-900 dark:border-white dark:text-slate-100'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <SearchInput placeholder="Rechercher par nom..." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        {/* Browse a specific past month's history/résumé — empty = tous les mois. */}
        <input
          type="month"
          value={monthFilter}
          onChange={(e) => (setMonthFilter(e.target.value), setPage(1))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        {monthFilter && (
          <button
            type="button"
            onClick={() => setMonthFilter('')}
            className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Tous les mois
          </button>
        )}
      </div>

      {tab === 'Déclarations' ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <DataTable columns={entryColumns} rows={entriesQuery.data?.data ?? []} isLoading={entriesQuery.isLoading} keyFn={(e) => e.id} />
          {entriesQuery.data && (
            <Pagination
              page={entriesQuery.data.current_page}
              lastPage={entriesQuery.data.last_page}
              total={entriesQuery.data.total}
              onPageChange={setPage}
            />
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <DataTable columns={monthColumns} rows={monthsQuery.data?.data ?? []} isLoading={monthsQuery.isLoading} keyFn={(m) => m.id} />
          {monthsQuery.data && (
            <Pagination
              page={monthsQuery.data.current_page}
              lastPage={monthsQuery.data.last_page}
              total={monthsQuery.data.total}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      {(showForm || editingEntry) && (
        <OvertimeEntryFormModal entry={editingEntry} onClose={() => (setShowForm(false), setEditingEntry(null))} />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer la déclaration"
        message={`Voulez-vous vraiment supprimer cette déclaration de ${deleting?.hours ? hoursLabel(deleting.hours) : ''} pour ${deleting?.employee?.full_name} ? Le résumé mensuel sera recalculé.`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function OvertimeEntryFormModal({ entry, onClose }: { entry: OvertimeEntry | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<Employee | null>(entry?.employee ?? null);
  const [form, setForm] = useState({
    date: entry?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    hours: entry?.hours ?? '',
    remark: entry?.remark ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, employee_id: employee?.id };
      return entry ? api.put(`/overtime-entries/${entry.id}`, payload) : api.post('/overtime-entries', payload);
    },
    onSuccess: () => {
      toast.success(entry ? 'Déclaration mise à jour.' : 'Heures supplémentaires déclarées.');
      queryClient.invalidateQueries({ queryKey: ['overtime-entries'] });
      queryClient.invalidateQueries({ queryKey: ['overtime-months'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={entry ? 'Modifier la déclaration' : 'Déclarer des heures supplémentaires'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
        <TextField label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <TextField
          label="Heures supplémentaires"
          type="number"
          step="0.25"
          min={0.25}
          required
          value={form.hours}
          onChange={(e) => setForm({ ...form, hours: e.target.value })}
        />
        <TextAreaField
          label="Remarque (optionnel)"
          placeholder="Ex : chargement urgent de nuit."
          value={form.remark}
          onChange={(e) => setForm({ ...form, remark: e.target.value })}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={!employee || mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
