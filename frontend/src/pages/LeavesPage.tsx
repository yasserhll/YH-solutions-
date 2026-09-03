import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Plane } from 'lucide-react';
import clsx from 'clsx';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useUrlTab } from '../hooks/useUrlTab';
import type { Employee, Leave, LeaveRequest, LeaveRequestStatus, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { TextAreaField, TextField } from '../components/ui/Field';
import { EmployeeSelect } from '../components/ui/EmployeeSelect';

const tabs = ['Demandes', 'Congés en cours'] as const;

export default function LeavesPage() {
  const [tab, setTab] = useUrlTab(tabs, 'Demandes');
  const [page, setPage] = useState(1);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [extendingLeave, setExtendingLeave] = useState<Leave | null>(null);
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();

  const requestsQuery = useQuery({
    queryKey: ['leave-requests', siteParams, page],
    queryFn: () => api.get<Paginated<LeaveRequest>>('/leave-requests', { params: { ...siteParams, page } }).then((r) => r.data),
    enabled: tab === 'Demandes',
  });

  const leavesQuery = useQuery({
    queryKey: ['leaves', siteParams, page],
    queryFn: () => api.get<Paginated<Leave>>('/leaves', { params: { ...siteParams, page } }).then((r) => r.data),
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
        <Button size="sm" variant="secondary" onClick={() => setExtendingLeave(l)}>
          <Plane size={14} /> Prolonger
        </Button>
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

      {showRequestForm && <LeaveRequestFormModal onClose={() => setShowRequestForm(false)} />}
      {showLeaveForm && <LeaveFormModal onClose={() => setShowLeaveForm(false)} />}
      {extendingLeave && <ExtendLeaveModal leave={extendingLeave} onClose={() => setExtendingLeave(null)} />}
    </div>
  );
}

function LeaveRequestFormModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    request_date: new Date().toISOString().slice(0, 10),
    desired_start_date: '',
    duration_days: 1,
    reason: '',
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/leave-requests', { ...form, employee_id: employee?.id }),
    onSuccess: () => {
      toast.success('Demande enregistrée.');
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Nouvelle demande de congé">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
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
          <Button type="submit" disabled={!employee || mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LeaveFormModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    start_date: new Date().toISOString().slice(0, 10),
    duration_days: 1,
    reason: '',
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/leaves', { ...form, employee_id: employee?.id }),
    onSuccess: () => {
      toast.success('Congé déclaré.');
      queryClient.invalidateQueries({ queryKey: ['leaves'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Déclarer un départ en congé">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
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
          <Button type="submit" disabled={!employee || mutation.isPending}>
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
