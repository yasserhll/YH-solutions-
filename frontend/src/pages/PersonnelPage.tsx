import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useAuth } from '../contexts/AuthContext';
import { useDepartments, usePositions, useSites } from '../hooks/useReferenceData';
import type { Employee, EmployeeStatus, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextField } from '../components/ui/Field';

export default function PersonnelPage() {
  const { user } = useAuth();
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Employee | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', siteParams, search, status, page],
    queryFn: () => api.get<Paginated<Employee>>('/employees', { params: { ...siteParams, search, status, page } }).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/employees/${id}`),
    onSuccess: () => {
      toast.success('Employé supprimé.');
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: Column<Employee>[] = [
    {
      header: 'Nom complet',
      accessor: (e) => (
        <Link to={`/personnel/${e.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
          {e.full_name}
        </Link>
      ),
    },
    { header: 'Site', accessor: (e) => e.site?.name },
    { header: 'Département', accessor: (e) => e.department?.name ?? '—' },
    { header: 'Fonction', accessor: (e) => e.position?.name ?? '—' },
    { header: "Date d'entrée", accessor: (e) => (e.entry_date ? new Date(e.entry_date).toLocaleDateString('fr-FR') : '—') },
    { header: 'Statut', accessor: (e) => <StatusBadge status={e.status} /> },
    {
      header: 'Actions',
      accessor: (e) => (
        <div className="flex items-center gap-1">
          <Link
            to={`/personnel/${e.id}`}
            className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Eye size={16} />
          </Link>
          <button
            className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setEditing(e)}
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

  return (
    <div>
      <PageHeader
        title="Personnel"
        description="Gestion des employés"
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} /> Ajouter un employé
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SearchInput placeholder="Rechercher un employé..." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <select
          value={status}
          onChange={(e) => (setStatus(e.target.value), setPage(1))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">Tous les statuts</option>
          <option value="actif">Actif</option>
          <option value="sorti">Sorti</option>
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <DataTable columns={columns} rows={data?.data ?? []} isLoading={isLoading} keyFn={(e) => e.id} />
        {data && <Pagination page={data.current_page} lastPage={data.last_page} total={data.total} onPageChange={setPage} />}
      </div>

      {editing !== undefined && (
        <EmployeeFormModal employee={editing} isSuperAdmin={user?.role === 'superadmin'} onClose={() => setEditing(undefined)} />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer l'employé"
        message={`Voulez-vous vraiment supprimer ${deleting?.full_name} ? Cette action est irréversible.`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function EmployeeFormModal({ employee, isSuperAdmin, onClose }: { employee: Employee | null; isSuperAdmin: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: sites } = useSites();
  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();

  const [form, setForm] = useState({
    full_name: employee?.full_name ?? '',
    site_id: employee?.site_id ?? '',
    department_id: employee?.department_id ?? '',
    position_id: employee?.position_id ?? '',
    establishment: employee?.establishment ?? '',
    entry_date: employee?.entry_date?.slice(0, 10) ?? '',
    phone: employee?.phone ?? '',
    status: employee?.status ?? 'actif',
  });

  const mutation = useMutation({
    mutationFn: () => (employee ? api.put(`/employees/${employee.id}`, form) : api.post('/employees', form)),
    onSuccess: () => {
      toast.success(employee ? 'Employé mis à jour.' : 'Employé créé.');
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={employee ? "Modifier l'employé" : 'Ajouter un employé'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <TextField label="Nom complet" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        {isSuperAdmin && (
          <SelectField label="Site" required value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
            <option value="">Sélectionner...</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
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
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Date d'entrée"
            type="date"
            value={form.entry_date}
            onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
          />
          <TextField label="Téléphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <TextField label="Établissement" value={form.establishment} onChange={(e) => setForm({ ...form, establishment: e.target.value })} />
        {employee && (
          <SelectField label="Statut" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EmployeeStatus })}>
            <option value="actif">Actif</option>
            <option value="sorti">Sorti</option>
          </SelectField>
        )}
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
