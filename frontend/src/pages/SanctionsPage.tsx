import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useUrlTab } from '../hooks/useUrlTab';
import type { DisciplinaryWarning, Employee, Paginated, Suspension } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TextAreaField, TextField } from '../components/ui/Field';
import { EmployeeSelect } from '../components/ui/EmployeeSelect';

const tabs = ['Avertissements', 'Mises à pied'] as const;

export default function SanctionsPage() {
  const [tab, setTab] = useUrlTab(tabs, 'Avertissements');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<{ type: 'warning' | 'suspension'; id: number } | null>(null);
  const [editing, setEditing] = useState<
    { type: 'warning'; record: DisciplinaryWarning } | { type: 'suspension'; record: Suspension } | null
  >(null);
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();

  const warningsQuery = useQuery({
    queryKey: ['disciplinary-warnings', siteParams, page, search],
    queryFn: () =>
      api
        .get<Paginated<DisciplinaryWarning>>('/disciplinary-warnings', { params: { ...siteParams, page, search: search || undefined } })
        .then((r) => r.data),
    enabled: tab === 'Avertissements',
  });

  const suspensionsQuery = useQuery({
    queryKey: ['suspensions', siteParams, page, search],
    queryFn: () =>
      api.get<Paginated<Suspension>>('/suspensions', { params: { ...siteParams, page, search: search || undefined } }).then((r) => r.data),
    enabled: tab === 'Mises à pied',
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      deleting?.type === 'warning' ? api.delete(`/disciplinary-warnings/${deleting.id}`) : api.delete(`/suspensions/${deleting?.id}`),
    onSuccess: () => {
      toast.success('Supprimé.');
      queryClient.invalidateQueries({ queryKey: ['disciplinary-warnings'] });
      queryClient.invalidateQueries({ queryKey: ['suspensions'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const warningColumns: Column<DisciplinaryWarning>[] = [
    { header: 'Date', accessor: (w) => new Date(w.date).toLocaleDateString('fr-FR') },
    { header: 'Employé', accessor: (w) => w.employee?.full_name },
    { header: 'Site', accessor: (w) => w.site?.name },
    { header: 'Motif', accessor: (w) => w.reason },
    { header: 'Description', accessor: (w) => w.description ?? '—' },
    {
      header: 'Actions',
      accessor: (w) => (
        <div className="flex gap-1">
          <button
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title="Modifier"
            onClick={() => setEditing({ type: 'warning', record: w })}
          >
            <Pencil size={16} />
          </button>
          <button
            className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15"
            title="Supprimer"
            onClick={() => setDeleting({ type: 'warning', id: w.id })}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const suspensionColumns: Column<Suspension>[] = [
    { header: 'Date', accessor: (s) => new Date(s.date).toLocaleDateString('fr-FR') },
    { header: 'Employé', accessor: (s) => s.employee?.full_name },
    { header: 'Site', accessor: (s) => s.site?.name },
    { header: 'Motif', accessor: (s) => s.reason },
    { header: 'Durée', accessor: (s) => `${s.duration_days} j` },
    { header: 'Fin', accessor: (s) => new Date(s.end_date).toLocaleDateString('fr-FR') },
    {
      header: 'Actions',
      accessor: (s) => (
        <div className="flex gap-1">
          <button
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title="Modifier"
            onClick={() => setEditing({ type: 'suspension', record: s })}
          >
            <Pencil size={16} />
          </button>
          <button
            className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15"
            title="Supprimer"
            onClick={() => setDeleting({ type: 'suspension', id: s.id })}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sanctions disciplinaires"
        description="Avertissements et mises à pied"
        actions={
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} /> {tab === 'Avertissements' ? 'Nouvel avertissement' : 'Nouvelle mise à pied'}
          </Button>
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

      <div className="mb-4 w-full sm:w-64">
        <SearchInput placeholder="Rechercher par nom..." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
      </div>

      {tab === 'Avertissements' ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <DataTable
            columns={warningColumns}
            rows={warningsQuery.data?.data ?? []}
            isLoading={warningsQuery.isLoading}
            keyFn={(w) => w.id}
          />
          {warningsQuery.data && (
            <Pagination
              page={warningsQuery.data.current_page}
              lastPage={warningsQuery.data.last_page}
              total={warningsQuery.data.total}
              onPageChange={setPage}
            />
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <DataTable
            columns={suspensionColumns}
            rows={suspensionsQuery.data?.data ?? []}
            isLoading={suspensionsQuery.isLoading}
            keyFn={(s) => s.id}
          />
          {suspensionsQuery.data && (
            <Pagination
              page={suspensionsQuery.data.current_page}
              lastPage={suspensionsQuery.data.last_page}
              total={suspensionsQuery.data.total}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      {showForm && <SanctionFormModal type={tab === 'Avertissements' ? 'warning' : 'suspension'} onClose={() => setShowForm(false)} />}
      {editing && <SanctionFormModal type={editing.type} record={editing.record} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer"
        message="Voulez-vous vraiment supprimer cette sanction ?"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate()}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function SanctionFormModal({
  type,
  record,
  onClose,
}: {
  type: 'warning' | 'suspension';
  /** The sanction being edited; omitted when creating a new one. */
  record?: DisciplinaryWarning | Suspension;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!record;
  const suspension = type === 'suspension' ? (record as Suspension | undefined) : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const [employee, setEmployee] = useState<Employee | null>(record?.employee ?? null);
  const [form, setForm] = useState({
    date: record?.date.slice(0, 10) ?? today,
    reason: record?.reason ?? '',
    description: record?.description ?? '',
    duration_days: String(suspension?.duration_days ?? 1),
    start_date: suspension?.start_date.slice(0, 10) ?? today,
  });
  // On edit the employee stays the one already on file (the server keeps it too).
  const employeeId = record?.employee_id ?? employee?.id;

  const mutation = useMutation({
    mutationFn: async (): Promise<unknown> => {
      if (type === 'warning') {
        const payload = { employee_id: employeeId, date: form.date, reason: form.reason, description: form.description };
        return record ? api.put(`/disciplinary-warnings/${record.id}`, payload) : api.post('/disciplinary-warnings', payload);
      }
      const payload = { ...form, duration_days: Number(form.duration_days), employee_id: employeeId };
      return record ? api.put(`/suspensions/${record.id}`, payload) : api.post('/suspensions', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Sanction modifiée.' : 'Sanction enregistrée.');
      queryClient.invalidateQueries({ queryKey: ['disciplinary-warnings'] });
      queryClient.invalidateQueries({ queryKey: ['suspensions'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={
        type === 'warning'
          ? isEdit
            ? "Modifier l'avertissement"
            : 'Nouvel avertissement'
          : isEdit
            ? 'Modifier la mise à pied'
            : 'Nouvelle mise à pied'
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        {record ? (
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Employé</p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200">
              {record.employee?.full_name ?? '—'}
            </p>
          </div>
        ) : (
          <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
        )}
        <TextField label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <TextField label="Motif" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <TextAreaField
          label="Description / détail"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        {type === 'suspension' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Date de début"
              type="date"
              required
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
            <TextField
              label="Durée (jours)"
              type="text"
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              title="Nombre de jours (1 ou plus)"
              required
              value={form.duration_days}
              onChange={(e) => setForm({ ...form, duration_days: e.target.value.replace(/\D/g, '') })}
            />
            <p className="text-xs text-slate-400 sm:col-span-2 dark:text-slate-500">
              Les dimanches et les jours fériés ne sont pas comptés : la date de fin est repoussée d'autant.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={!employeeId || mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
