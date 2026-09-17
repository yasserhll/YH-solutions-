import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { User } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TextField } from '../components/ui/Field';

/**
 * A responsable_hse's own scoped user management — only ever touches `hse`
 * accounts on their own assigned sites (enforced server-side in
 * HseUserController), unlike the full /utilisateurs page which stays
 * SuperAdmin-only and can manage any role on any site.
 */
export default function HseUsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<User | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hse-users'],
    queryFn: () => api.get<User[]>('/hse-users').then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/hse-users/${id}`),
    onSuccess: () => {
      toast.success('Compte supprimé.');
      queryClient.invalidateQueries({ queryKey: ['hse-users'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: Column<User>[] = [
    { header: 'Nom', accessor: (u) => u.name },
    { header: 'Email', accessor: (u) => u.email },
    {
      header: 'Site(s)',
      accessor: (u) => (u.sites.length ? u.sites.map((s) => s.name).join(', ') : '—'),
    },
    { header: 'Statut', accessor: (u) => <StatusBadge status={u.is_active ? 'actif' : 'sorti'} /> },
    {
      header: 'Actions',
      accessor: (u) => (
        <div className="flex items-center gap-1">
          <button
            className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setEditing(u)}
          >
            <Pencil size={16} />
          </button>
          <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeleting(u)}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Comptes animateurs HSE"
        description="Créez et gérez les comptes des animateurs HSE de vos sites"
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} /> Ajouter un animateur
          </Button>
        }
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <DataTable columns={columns} rows={data ?? []} isLoading={isLoading} keyFn={(u) => u.id} />
      </div>

      {editing !== undefined && (
        <HseUserFormModal hseUser={editing} mySites={user?.sites ?? []} onClose={() => setEditing(undefined)} />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le compte"
        message={`Voulez-vous vraiment supprimer le compte de ${deleting?.name} ?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function HseUserFormModal({
  hseUser,
  mySites,
  onClose,
}: {
  hseUser: User | null;
  mySites: User['sites'];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: hseUser?.name ?? '',
    email: hseUser?.email ?? '',
    password: '',
    site_ids: hseUser?.sites.map((s) => s.id) ?? ([] as number[]),
    is_active: hseUser?.is_active ?? true,
  });

  function toggleSite(id: number) {
    setForm((f) => ({
      ...f,
      site_ids: f.site_ids.includes(id) ? f.site_ids.filter((x) => x !== id) : [...f.site_ids, id],
    }));
  }

  const mutation = useMutation({
    mutationFn: () => (hseUser ? api.put(`/hse-users/${hseUser.id}`, form) : api.post('/hse-users', form)),
    onSuccess: () => {
      toast.success(hseUser ? 'Compte mis à jour.' : 'Compte créé.');
      queryClient.invalidateQueries({ queryKey: ['hse-users'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={hseUser ? "Modifier l'animateur" : 'Ajouter un animateur HSE'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <TextField label="Nom" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <TextField
          label={hseUser ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'}
          type="password"
          required={!hseUser}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Site(s) assigné(s) {form.site_ids.length === 0 && <span className="text-red-500">(au moins un requis)</span>}
          </span>
          <div className="space-y-1.5 rounded-lg border border-slate-300 p-2.5 dark:border-slate-600">
            {mySites.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.site_ids.includes(s.id)} onChange={() => toggleSite(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Compte actif
        </label>
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
