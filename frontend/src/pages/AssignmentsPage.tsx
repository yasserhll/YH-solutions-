import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useDepartments, usePositions } from '../hooks/useReferenceData';
import type { Assignment, Employee, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextField } from '../components/ui/Field';
import { EmployeeSelect } from '../components/ui/EmployeeSelect';

export default function AssignmentsPage() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [deleting, setDeleting] = useState<Assignment | null>(null);
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['assignments', siteParams, page],
    queryFn: () => api.get<Paginated<Assignment>>('/assignments', { params: { ...siteParams, page } }).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/assignments/${id}`),
    onSuccess: () => {
      toast.success('Affectation supprimée.');
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: Column<Assignment>[] = [
    { header: 'Employé', accessor: (a) => a.employee?.full_name },
    { header: 'Site', accessor: (a) => a.site?.name },
    { header: 'Département', accessor: (a) => a.department?.name ?? '—' },
    { header: 'Fonction', accessor: (a) => a.position?.name ?? '—' },
    { header: 'Début', accessor: (a) => new Date(a.start_date).toLocaleDateString('fr-FR') },
    { header: 'Fin', accessor: (a) => (a.end_date ? new Date(a.end_date).toLocaleDateString('fr-FR') : '—') },
    { header: 'Statut', accessor: (a) => (a.is_current ? <StatusBadge status="actif" /> : <StatusBadge status="sorti" />) },
    {
      header: 'Actions',
      accessor: (a) => (
        <div className="flex items-center gap-1">
          <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setEditing(a)}>
            <Pencil size={16} />
          </button>
          <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeleting(a)}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Affectations"
        description="Site, département et fonction de chaque employé"
        actions={
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} /> Nouvelle affectation
          </Button>
        }
      />

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <DataTable columns={columns} rows={data?.data ?? []} isLoading={isLoading} keyFn={(a) => a.id} />
        {data && <Pagination page={data.current_page} lastPage={data.last_page} total={data.total} onPageChange={setPage} />}
      </div>

      {(showForm || editing) && (
        <AssignmentFormModal assignment={editing} onClose={() => (setShowForm(false), setEditing(null))} />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer l'affectation"
        message="Voulez-vous vraiment supprimer cette affectation ?"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function AssignmentFormModal({ assignment, onClose }: { assignment: Assignment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();
  const [employee, setEmployee] = useState<Employee | null>(assignment?.employee ?? null);
  const [form, setForm] = useState({
    department_id: assignment?.department_id ?? '',
    position_id: assignment?.position_id ?? '',
    start_date: assignment?.start_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    notes: assignment?.notes ?? '',
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<unknown> => {
      if (assignment) {
        return api.put(`/assignments/${assignment.id}`, form);
      }
      return api.post('/assignments', { ...form, employee_id: employee?.id });
    },
    onSuccess: () => {
      toast.success(assignment ? 'Affectation mise à jour.' : 'Affectation enregistrée.');
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={assignment ? "Modifier l'affectation" : 'Nouvelle affectation'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        {assignment ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {assignment.employee?.full_name}
          </div>
        ) : (
          <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
        )}
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Département" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">—</option>
            {departments?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Fonction" value={form.position_id} onChange={(e) => setForm({ ...form, position_id: e.target.value })}>
            <option value="">—</option>
            {positions?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField
          label="Date d'effet"
          type="date"
          required
          value={form.start_date}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={(!assignment && !employee) || mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
