import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '../api/client';
import { useSites } from '../hooks/useReferenceData';
import type { Role, User } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextField } from '../components/ui/Field';

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<User | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users').then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success('Utilisateur supprimé.');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: Column<User>[] = [
    { header: 'Nom', accessor: (u) => u.name },
    { header: 'Email', accessor: (u) => u.email },
    { header: 'Rôle', accessor: (u) => (u.role === 'superadmin' ? 'SuperAdmin' : 'Responsable de site') },
    { header: 'Site', accessor: (u) => u.site?.name ?? '—' },
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
        title="Utilisateurs"
        description="Gestion des comptes SuperAdmin et responsables de site"
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} /> Ajouter un utilisateur
          </Button>
        }
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <DataTable columns={columns} rows={data ?? []} isLoading={isLoading} keyFn={(u) => u.id} />
      </div>

      {editing !== undefined && <UserFormModal user={editing} onClose={() => setEditing(undefined)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer l'utilisateur"
        message={`Voulez-vous vraiment supprimer ${deleting?.name} ?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function UserFormModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: sites } = useSites();
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    role: (user?.role ?? 'responsable') as Role,
    site_id: user?.site_id ?? '',
    is_active: user?.is_active ?? true,
  });

  const mutation = useMutation({
    mutationFn: () => (user ? api.put(`/users/${user.id}`, form) : api.post('/users', form)),
    onSuccess: () => {
      toast.success(user ? 'Utilisateur mis à jour.' : 'Utilisateur créé.');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={user ? "Modifier l'utilisateur" : 'Ajouter un utilisateur'}>
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
          label={user ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'}
          type="password"
          required={!user}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <SelectField label="Rôle" required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          <option value="responsable">Responsable de site</option>
          <option value="superadmin">SuperAdmin</option>
        </SelectField>
        {form.role === 'responsable' && (
          <SelectField label="Site" required value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
            <option value="">Sélectionner...</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        )}
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
