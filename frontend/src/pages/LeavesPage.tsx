import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Plane, Pencil, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useUrlTab } from '../hooks/useUrlTab';
import type { Employee, Leave, LeaveRequest, LeaveRequestStatus, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TextAreaField, TextField } from '../components/ui/Field';
import { EmployeeSelect } from '../components/ui/EmployeeSelect';

const tabs = ['Demandes', 'Congés en cours'] as const;

export default function LeavesPage() {
  const [tab, setTab] = useUrlTab(tabs, 'Demandes');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null);
  const [editingLeave, setEditingLeave] = useState<Leave | null>(null);
  const [deletingRequest, setDeletingRequest] = useState<LeaveRequest | null>(null);
  const [deletingLeave, setDeletingLeave] = useState<Leave | null>(null);
  const [extendingLeave, setExtendingLeave] = useState<Leave | null>(null);
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();

  const requestsQuery = useQuery({
    queryKey: ['leave-requests', siteParams, page, search],
    queryFn: () =>
      api.get<Paginated<LeaveRequest>>('/leave-requests', { params: { ...siteParams, page, search: search || undefined } }).then((r) => r.data),
    enabled: tab === 'Demandes',
  });

  const leavesQuery = useQuery({
    queryKey: ['leaves', siteParams, page, search],
    queryFn: () => api.get<Paginated<Leave>>('/leaves', { params: { ...siteParams, page, search: search || undefined } }).then((r) => r.data),
    enabled: tab === 'Congés en cours',
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: LeaveRequestStatus }) => api.patch(`/leave-requests/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      toast.success('Statut mis à jour.');
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteRequestMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/leave-requests/${id}`),
    onSuccess: () => {
      toast.success('Demande supprimée.');
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      setDeletingRequest(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteLeaveMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/leaves/${id}`),
    onSuccess: () => {
      toast.success('Congé supprimé.');
      queryClient.invalidateQueries({ queryKey: ['leaves'] });
      setDeletingLeave(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const requestColumns: Column<LeaveRequest>[] = [
    { header: 'Employé', accessor: (r) => r.employee?.full_name },
    { header: 'Site', accessor: (r) => r.site?.name },
    { header: 'Demandé le', accessor: (r) => new Date(r.request_date).toLocaleDateString('fr-FR') },
    { header: 'Début souhaité', accessor: (r) => new Date(r.desired_start_date).toLocaleDateString('fr-FR') },
    { header: 'Durée', accessor: (r) => `${r.duration_days} j` },
    { header: 'Motif', accessor: (r) => r.reason ?? '—' },
    {
      header: 'Statut',
      accessor: (r) =>
        r.status === 'en_attente' ? (
          <select
            value={r.status}
            onChange={(e) => statusMutation.mutate({ id: r.id, status: e.target.value as LeaveRequestStatus })}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="en_attente">En attente</option>
            <option value="acceptee">Acceptée</option>
            <option value="refusee">Refusée</option>
            <option value="annulee">Annulée</option>
          </select>
        ) : (
          <StatusBadge status={r.status} />
        ),
    },
    {
      header: 'Actions',
      accessor: (r) => (
        <div className="flex items-center gap-1">
          <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setEditingRequest(r)}>
            <Pencil size={16} />
          </button>
          <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeletingRequest(r)}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const leaveColumns: Column<Leave>[] = [
    { header: 'Employé', accessor: (l) => l.employee?.full_name },
    { header: 'Site', accessor: (l) => l.site?.name },
    { header: 'Début', accessor: (l) => new Date(l.start_date).toLocaleDateString('fr-FR') },
    { header: 'Durée', accessor: (l) => `${l.duration_days} j` },
    { header: 'Fin', accessor: (l) => new Date(l.end_date).toLocaleDateString('fr-FR') },
    { header: 'Statut', accessor: (l) => <StatusBadge status={l.status} /> },
    {
      header: 'Actions',
      accessor: (l) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => setExtendingLeave(l)}>
            <Plane size={14} /> Prolonger
          </Button>
          <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setEditingLeave(l)}>
            <Pencil size={16} />
          </button>
          <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeletingLeave(l)}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Congés"
        description="Demandes de congé et suivi des congés en cours"
        actions={
          tab === 'Demandes' ? (
            <Button onClick={() => setShowRequestForm(true)}>
              <Plus size={16} /> Nouvelle demande
            </Button>
          ) : (
            <Button onClick={() => setShowLeaveForm(true)}>
              <Plus size={16} /> Déclarer un départ en congé
            </Button>
          )
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

      <div className="mb-4 w-64">
        <SearchInput placeholder="Rechercher par nom..." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
      </div>

      {tab === 'Demandes' ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <DataTable
            columns={requestColumns}
            rows={requestsQuery.data?.data ?? []}
            isLoading={requestsQuery.isLoading}
            keyFn={(r) => r.id}
          />
          {requestsQuery.data && (
            <Pagination
              page={requestsQuery.data.current_page}
              lastPage={requestsQuery.data.last_page}
              total={requestsQuery.data.total}
              onPageChange={setPage}
            />
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <DataTable columns={leaveColumns} rows={leavesQuery.data?.data ?? []} isLoading={leavesQuery.isLoading} keyFn={(l) => l.id} />
          {leavesQuery.data && (
            <Pagination
              page={leavesQuery.data.current_page}
              lastPage={leavesQuery.data.last_page}
              total={leavesQuery.data.total}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      {(showRequestForm || editingRequest) && (
        <LeaveRequestFormModal request={editingRequest} onClose={() => (setShowRequestForm(false), setEditingRequest(null))} />
      )}
      {(showLeaveForm || editingLeave) && (
        <LeaveFormModal leave={editingLeave} onClose={() => (setShowLeaveForm(false), setEditingLeave(null))} />
      )}
      {extendingLeave && <ExtendLeaveModal leave={extendingLeave} onClose={() => setExtendingLeave(null)} />}

      <ConfirmDialog
        open={!!deletingRequest}
        title="Supprimer la demande"
        message="Voulez-vous vraiment supprimer cette demande de congé ?"
        onCancel={() => setDeletingRequest(null)}
        onConfirm={() => deletingRequest && deleteRequestMutation.mutate(deletingRequest.id)}
        isLoading={deleteRequestMutation.isPending}
      />
      <ConfirmDialog
        open={!!deletingLeave}
        title="Supprimer le congé"
        message="Voulez-vous vraiment supprimer ce congé ?"
        onCancel={() => setDeletingLeave(null)}
        onConfirm={() => deletingLeave && deleteLeaveMutation.mutate(deletingLeave.id)}
        isLoading={deleteLeaveMutation.isPending}
      />
    </div>
  );
}

function LeaveRequestFormModal({ request, onClose }: { request: LeaveRequest | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<Employee | null>(request?.employee ?? null);
  const [form, setForm] = useState({
    request_date: request?.request_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    desired_start_date: request?.desired_start_date?.slice(0, 10) ?? '',
    duration_days: request?.duration_days ?? 1,
    reason: request?.reason ?? '',
  });

  const mutation = useMutation({
    mutationFn: (): Promise<unknown> =>
      request
        ? api.put(`/leave-requests/${request.id}`, { ...form, employee_id: request.employee_id })
        : api.post('/leave-requests', { ...form, employee_id: employee?.id }),
    onSuccess: () => {
      toast.success(request ? 'Demande mise à jour.' : 'Demande enregistrée.');
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={request ? 'Modifier la demande de congé' : 'Nouvelle demande de congé'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        {request ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {request.employee?.full_name}
          </div>
        ) : (
          <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
        )}
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Date de demande"
            type="date"
            required
            value={form.request_date}
            onChange={(e) => setForm({ ...form, request_date: e.target.value })}
          />
          <TextField
            label="Date de congé souhaitée"
            type="date"
            required
            value={form.desired_start_date}
            onChange={(e) => setForm({ ...form, desired_start_date: e.target.value })}
          />
        </div>
        <TextField
          label="Durée demandée (jours)"
          type="number"
          min={1}
          required
          value={form.duration_days}
          onChange={(e) => setForm({ ...form, duration_days: Number(e.target.value) })}
        />
        <TextAreaField label="Motif / détail" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={(!request && !employee) || mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LeaveFormModal({ leave, onClose }: { leave: Leave | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<Employee | null>(leave?.employee ?? null);
  const [form, setForm] = useState({
    start_date: leave?.start_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    duration_days: leave?.duration_days ?? 1,
    reason: leave?.reason ?? '',
  });

  const mutation = useMutation({
    mutationFn: (): Promise<unknown> =>
      leave
        ? api.put(`/leaves/${leave.id}`, { ...form, employee_id: leave.employee_id })
        : api.post('/leaves', { ...form, employee_id: employee?.id }),
    onSuccess: () => {
      toast.success(leave ? 'Congé mis à jour.' : 'Congé déclaré.');
      queryClient.invalidateQueries({ queryKey: ['leaves'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={leave ? 'Modifier le congé' : 'Déclarer un départ en congé'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        {leave ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {leave.employee?.full_name}
          </div>
        ) : (
          <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
        )}
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
        <TextAreaField label="Motif" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={(!leave && !employee) || mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ExtendLeaveModal({ leave, onClose }: { leave: Leave; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [extraDays, setExtraDays] = useState(1);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/leaves/${leave.id}/extensions`, { extra_days: extraDays, reason }),
    onSuccess: () => {
      toast.success('Congé prolongé.');
      queryClient.invalidateQueries({ queryKey: ['leaves'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Prolonger le congé" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {leave.employee?.full_name} — fin actuelle : {new Date(leave.end_date).toLocaleDateString('fr-FR')}
        </p>
        <TextField
          label="Jours supplémentaires"
          type="number"
          min={1}
          required
          value={extraDays}
          onChange={(e) => setExtraDays(Number(e.target.value))}
        />
        <TextAreaField
          label="Motif de prolongation"
          placeholder="Ex : Problème familial"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Prolonger
          </Button>
        </div>
      </form>
    </Modal>
  );
}
