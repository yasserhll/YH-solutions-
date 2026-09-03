import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useUrlTab } from '../hooks/useUrlTab';
import { useDepartments, usePositions } from '../hooks/useReferenceData';
import type { Employee, Entry, Exit, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextField } from '../components/ui/Field';
import { EmployeeSelect } from '../components/ui/EmployeeSelect';

const tabs = ['Entrées', 'Sorties'] as const;

export default function MovementsPage() {
  const [tab, setTab] = useUrlTab(tabs, 'Entrées');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [editingExit, setEditingExit] = useState<Exit | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<Entry | null>(null);
  const [deletingExit, setDeletingExit] = useState<Exit | null>(null);
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();

  const entriesQuery = useQuery({
    queryKey: ['entries', siteParams, page],
    queryFn: () => api.get<Paginated<Entry>>('/entries', { params: { ...siteParams, page } }).then((r) => r.data),
    enabled: tab === 'Entrées',
  });

  const exitsQuery = useQuery({
    queryKey: ['exits', siteParams, page],
    queryFn: () => api.get<Paginated<Exit>>('/exits', { params: { ...siteParams, page } }).then((r) => r.data),
    enabled: tab === 'Sorties',
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/entries/${id}`),
    onSuccess: () => {
      toast.success('Entrée supprimée.');
      queryClient.invalidateQueries({ queryKey: ['entries'] });
      setDeletingEntry(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteExitMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/exits/${id}`),
    onSuccess: () => {
      toast.success('Sortie supprimée — le personnel concerné redevient actif.');
      queryClient.invalidateQueries({ queryKey: ['exits'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setDeletingExit(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const entryColumns: Column<Entry>[] = [
    { header: "Date d'entrée", accessor: (e) => new Date(e.entry_date).toLocaleDateString('fr-FR') },
    { header: 'Nom complet', accessor: (e) => e.full_name },
    { header: 'Fonction', accessor: (e) => e.position?.name ?? '—' },
    { header: 'Département', accessor: (e) => e.department?.name ?? '—' },
    { header: 'Site', accessor: (e) => e.site?.name },
    {
      header: 'Actions',
      accessor: (e) => (
        <div className="flex items-center gap-1">
          <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setEditingEntry(e)}>
            <Pencil size={16} />
          </button>
          <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeletingEntry(e)}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const exitColumns: Column<Exit>[] = [
    { header: 'Date de sortie', accessor: (e) => new Date(e.exit_date).toLocaleDateString('fr-FR') },
    { header: 'Nom complet', accessor: (e) => e.full_name },
    { header: 'Fonction', accessor: (e) => e.position?.name ?? '—' },
    { header: "Date d'entrée", accessor: (e) => (e.entry_date ? new Date(e.entry_date).toLocaleDateString('fr-FR') : '—') },
    { header: 'Site', accessor: (e) => e.site?.name },
    { header: 'Motif', accessor: (e) => e.reason ?? '—' },
    {
      header: 'Actions',
      accessor: (e) => (
        <div className="flex items-center gap-1">
          <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setEditingExit(e)}>
            <Pencil size={16} />
          </button>
          <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeletingExit(e)}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Entrées / Sorties"
        description="Mouvements du personnel"
        actions={
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} /> {tab === 'Entrées' ? 'Nouvelle entrée' : 'Nouvelle sortie'}
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

      {tab === 'Entrées' ? (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
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
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DataTable columns={exitColumns} rows={exitsQuery.data?.data ?? []} isLoading={exitsQuery.isLoading} keyFn={(e) => e.id} />
          {exitsQuery.data && (
            <Pagination
              page={exitsQuery.data.current_page}
              lastPage={exitsQuery.data.last_page}
              total={exitsQuery.data.total}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      {(showForm && tab === 'Entrées') || editingEntry ? (
        <EntryFormModal entry={editingEntry} onClose={() => (setShowForm(false), setEditingEntry(null))} />
      ) : null}
      {(showForm && tab === 'Sorties') || editingExit ? (
        <ExitFormModal exit={editingExit} onClose={() => (setShowForm(false), setEditingExit(null))} />
      ) : null}

      <ConfirmDialog
        open={!!deletingEntry}
        title="Supprimer l'entrée"
        message="Voulez-vous vraiment supprimer cet enregistrement d'entrée ?"
        onCancel={() => setDeletingEntry(null)}
        onConfirm={() => deletingEntry && deleteEntryMutation.mutate(deletingEntry.id)}
        isLoading={deleteEntryMutation.isPending}
      />
      <ConfirmDialog
        open={!!deletingExit}
        title="Supprimer la sortie"
        message="Voulez-vous vraiment annuler cette sortie ? L'employé concerné redeviendra actif."
        onCancel={() => setDeletingExit(null)}
        onConfirm={() => deletingExit && deleteExitMutation.mutate(deletingExit.id)}
        isLoading={deleteExitMutation.isPending}
      />
    </div>
  );
}

function EntryFormModal({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();
  const [form, setForm] = useState({
    full_name: entry?.full_name ?? '',
    department_id: entry?.department_id ?? '',
    position_id: entry?.position_id ?? '',
    establishment: entry?.establishment ?? '',
    entry_date: entry?.entry_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  });

  const mutation = useMutation({
    mutationFn: () => (entry ? api.put(`/entries/${entry.id}`, form) : api.post('/entries', form)),
    onSuccess: () => {
      toast.success(entry ? 'Entrée mise à jour.' : "Entrée enregistrée — le personnel et l'affectation ont été créés.");
      queryClient.invalidateQueries({ queryKey: ['entries'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={entry ? "Modifier l'entrée" : 'Nouvelle entrée'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <TextField label="Nom complet" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Fonction" value={form.position_id} onChange={(e) => setForm({ ...form, position_id: e.target.value })}>
            <option value="">—</option>
            {positions?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Département" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">—</option>
            {departments?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="Établissement" value={form.establishment} onChange={(e) => setForm({ ...form, establishment: e.target.value })} />
        <TextField
          label="Date d'entrée"
          type="date"
          required
          value={form.entry_date}
          onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ExitFormModal({ exit, onClose }: { exit: Exit | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [manualMode, setManualMode] = useState(!!exit);
  const [form, setForm] = useState({
    full_name: exit?.full_name ?? '',
    entry_date: exit?.entry_date?.slice(0, 10) ?? '',
    exit_date: exit?.exit_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    reason: exit?.reason ?? '',
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<unknown> => {
      if (exit) {
        return api.put(`/exits/${exit.id}`, form);
      }
      return api.post(
        '/exits',
        manualMode ? { ...form } : { employee_id: employee?.id, exit_date: form.exit_date, reason: form.reason },
      );
    },
    onSuccess: () => {
      toast.success(exit ? 'Sortie mise à jour.' : 'Sortie enregistrée.');
      queryClient.invalidateQueries({ queryKey: ['exits'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={exit ? 'Modifier la sortie' : 'Nouvelle sortie'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        {exit ? (
          <>
            <TextField
              label="Nom complet"
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <TextField
              label="Date d'entrée"
              type="date"
              value={form.entry_date}
              onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
            />
          </>
        ) : !manualMode ? (
          <>
            <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
            {employee && (
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                Fonction : {employee.position?.name ?? '—'} · Site : {employee.site?.name} · Entrée :{' '}
                {employee.entry_date ? new Date(employee.entry_date).toLocaleDateString('fr-FR') : '—'}
              </div>
            )}
            <button type="button" onClick={() => setManualMode(true)} className="text-xs text-slate-500 underline dark:text-slate-400">
              L'employé n'existe pas dans la base ? Saisie manuelle
            </button>
          </>
        ) : (
          <>
            <TextField
              label="Nom complet"
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <TextField
              label="Date d'entrée"
              type="date"
              value={form.entry_date}
              onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
            />
            <button type="button" onClick={() => setManualMode(false)} className="text-xs text-slate-500 underline dark:text-slate-400">
              Revenir à la sélection d'un employé existant
            </button>
          </>
        )}
        <TextField
          label="Date de sortie"
          type="date"
          required
          value={form.exit_date}
          onChange={(e) => setForm({ ...form, exit_date: e.target.value })}
        />
        <TextField label="Motif" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={(!exit && !manualMode && !employee) || mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
