import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useUrlTab } from '../hooks/useUrlTab';
import type { DisciplinaryWarning, Employee, Paginated, Suspension } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
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
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<{ type: 'warning' | 'suspension'; id: number } | null>(null);
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();

  const warningsQuery = useQuery({
    queryKey: ['disciplinary-warnings', siteParams, page],
    queryFn: () =>
      api.get<Paginated<DisciplinaryWarning>>('/disciplinary-warnings', { params: { ...siteParams, page } }).then((r) => r.data),
    enabled: tab === 'Avertissements',
  });

  const suspensionsQuery = useQuery({
    queryKey: ['suspensions', siteParams, page],
    queryFn: () => api.get<Paginated<Suspension>>('/suspensions', { params: { ...siteParams, page } }).then((r) => r.data),
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
        <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeleting({ type: 'warning', id: w.id })}>
          <Trash2 size={16} />
        </button>
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
        <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeleting({ type: 'suspension', id: s.id })}>
          <Trash2 size={16} />
        </button>
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

      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => (setTab(t), setPage(1))}
            className={clsx(
              'border-b-2 px-4 py-2 text-sm font-medium',
              tab === t
                ? 'border-slate-900 text-slate-900 dark:border-white dark:text-slate-100'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >
            {t}
          </button>
        ))}
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

function SanctionFormModal({ type, onClose }: { type: 'warning' | 'suspension'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    reason: '',
    description: '',
    duration_days: 1,
    start_date: new Date().toISOString().slice(0, 10),
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<unknown> => {
      if (type === 'warning') {
        return api.post('/disciplinary-warnings', {
          employee_id: employee?.id,
          date: form.date,
          reason: form.reason,
          description: form.description,
        });
      }
      return api.post('/suspensions', { ...form, employee_id: employee?.id });
    },
    onSuccess: () => {
      toast.success('Sanction enregistrée.');
      queryClient.invalidateQueries({ queryKey: ['disciplinary-warnings'] });
      queryClient.invalidateQueries({ queryKey: ['suspensions'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={type === 'warning' ? 'Nouvel avertissement' : 'Nouvelle mise à pied'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
        <TextField label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <TextField label="Motif" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <TextAreaField
          label="Description / détail"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        {type === 'suspension' && (
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Date de début"
              type="date"
              required
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
            <TextField
              label="Durée (jours)"
              type="number"
              min={1}
              required
              value={form.duration_days}
              onChange={(e) => setForm({ ...form, duration_days: Number(e.target.value) })}
            />
          </div>
        )}
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
