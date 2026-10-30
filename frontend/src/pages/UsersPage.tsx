import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '../api/client';
import { useSites } from '../hooks/useReferenceData';
import type { ModuleKey, Role, User } from '../types';
import { MODULES } from '../utils/modules';

/** GET /users/modules: each role's default sessions (User::ROLE_MODULES). */
type ModulesCatalog = { modules: ModuleKey[]; role_defaults: Partial<Record<Role, ModuleKey[]>> };

function useModulesCatalog() {
  return useQuery({
    queryKey: ['users', 'modules'],
    queryFn: () => api.get<ModulesCatalog>('/users/modules').then((r) => r.data),
    staleTime: Infinity,
  });
}

const sameModules = (a: ModuleKey[], b: ModuleKey[]) => a.length === b.length && a.every((m) => b.includes(m));

const roleLabels: Record<Role, string> = {
  superadmin: 'SuperAdmin',
  responsable: 'Responsable de site',
  hse: 'Animateur HSE',
  responsable_hse: 'Responsable HSE',
};
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
    { header: 'Rôle', accessor: (u) => roleLabels[u.role] },
    {
      header: 'Site(s)',
      accessor: (u) => {
        if (u.sites.length === 0) return '—';
        if (u.sites.length === 1) return u.sites[0].name;
        return u.sites.map((s) => s.name).join(', ');
      },
    },
    {
      header: 'Sessions',
      accessor: (u) =>
        u.role === 'superadmin' ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">Accès complet</span>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400" title={MODULES.filter((m) => u.allowed_modules.includes(m.key)).map((m) => m.label).join(', ')}>
            {u.allowed_modules.length} / {MODULES.length}
            {u.modules === null ? ' · par défaut' : ' · personnalisé'}
          </span>
        ),
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
        title="Utilisateurs"
        description="Comptes, sites assignés et sessions accessibles de chaque compte"
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
  const { data: catalog } = useModulesCatalog();
  const roleDefault = (role: Role): ModuleKey[] => catalog?.role_defaults[role] ?? [];
  // null = still following the role's default (a role change then switches
  // to the new role's default); a list = ticked by hand for this account.
  const [customModules, setCustomModules] = useState<ModuleKey[] | null>(user?.modules ?? null);
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    role: (user?.role ?? 'responsable') as Role,
    site_ids: user?.sites.map((s) => s.id) ?? ([] as number[]),
    is_active: user?.is_active ?? true,
  });
  const modules = customModules ?? roleDefault(form.role);

  function toggleModule(key: ModuleKey) {
    const next = modules.includes(key) ? modules.filter((m) => m !== key) : [...modules, key];
    setCustomModules(sameModules(next, roleDefault(form.role)) ? null : next);
  }

  function toggleSite(id: number) {
    setForm((f) => ({
      ...f,
      site_ids: f.site_ids.includes(id) ? f.site_ids.filter((x) => x !== id) : [...f.site_ids, id],
    }));
  }

  const mutation = useMutation({
    // A SuperAdmin has no assigned sites — send `site_ids: []` rather than
    // whatever was left checked from a previous role selection, so the
    // backend never has to guess whether an empty array here was
    // intentional.
    mutationFn: () => {
      // A list equal to the role's default is stored as null server-side
      // (UserController::normalizeModules), so the account keeps following it.
      const payload = {
        ...form,
        site_ids: form.role === 'superadmin' ? [] : form.site_ids,
        modules: form.role === 'superadmin' ? null : (customModules ?? roleDefault(form.role)),
      };
      return user ? api.put(`/users/${user.id}`, payload) : api.post('/users', payload);
    },
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
          <option value="hse">Animateur HSE</option>
          <option value="responsable_hse">Responsable HSE</option>
          <option value="superadmin">SuperAdmin</option>
        </SelectField>
        {form.role !== 'superadmin' && (
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Sites assignés {form.site_ids.length === 0 && <span className="text-red-500">(au moins un requis)</span>}
            </span>
            <div className="space-y-1.5 rounded-lg border border-slate-300 p-2.5 dark:border-slate-600">
              {sites?.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={form.site_ids.includes(s.id)} onChange={() => toggleSite(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Un compte avec plusieurs sites travaille sur tous ces sites à la fois (dépenses, tableaux de bord, rapports...) et choisit le site concerné à chaque enregistrement.
            </p>
          </div>
        )}
        {form.role === 'superadmin' ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            Un SuperAdmin a toujours accès à toutes les sessions.
          </p>
        ) : (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Sessions accessibles {modules.length === 0 && <span className="text-red-500">(aucune)</span>}
              </span>
              {customModules !== null && (
                <button type="button" onClick={() => setCustomModules(null)} className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400">
                  Rétablir les accès par défaut
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-1.5 rounded-lg border border-slate-300 p-2.5 sm:grid-cols-2 dark:border-slate-600">
              {MODULES.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={modules.includes(m.key)} onChange={() => toggleModule(m.key)} disabled={!catalog} />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {customModules === null
                ? `Accès par défaut du rôle « ${roleLabels[form.role]} ». Décochez une session pour la retirer, cochez-en une pour l'ouvrir à ce compte.`
                : 'Accès personnalisés pour ce compte. Les données restent limitées aux sites assignés.'}
            </p>
          </div>
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
