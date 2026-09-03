import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { api, apiErrorMessage } from '../api/client';
import { useDepartments, usePositions, useSites } from '../hooks/useReferenceData';
import type { Department, Position, Site } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { LoadingState, EmptyState } from '../components/ui/States';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

type Entity = Site | Department | Position;

function ReferenceListCard({
  title,
  queryKey,
  endpoint,
  items,
  isLoading,
}: {
  title: string;
  queryKey: string;
  endpoint: string;
  items: Entity[] | undefined;
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleting, setDeleting] = useState<Entity | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [queryKey] });

  const createMutation = useMutation({
    mutationFn: () => api.post(endpoint, { name: newName }),
    onSuccess: () => {
      toast.success('Ajouté.');
      invalidate();
      setNewName('');
      setCreating(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (id: number) => api.put(`${endpoint}/${id}`, { name: editingName }),
    onSuccess: () => {
      toast.success('Mis à jour.');
      invalidate();
      setEditingId(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`${endpoint}/${id}`),
    onSuccess: () => {
      toast.success('Supprimé.');
      invalidate();
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={14} /> Ajouter
        </Button>
      </div>

      {isLoading ? (
        <LoadingState rows={3} />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {creating && (
            <li className="flex items-center gap-2 px-4 py-2.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nom..."
                className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <button className="text-emerald-600 dark:text-emerald-400" onClick={() => createMutation.mutate()}>
                <Check size={16} />
              </button>
              <button className="text-slate-400 dark:text-slate-500" onClick={() => setCreating(false)}>
                <X size={16} />
              </button>
            </li>
          )}
          {(items ?? []).length === 0 && !creating && <EmptyState message="Aucun élément." />}
          {items?.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              {editingId === item.id ? (
                <>
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <button className="text-emerald-600 dark:text-emerald-400" onClick={() => updateMutation.mutate(item.id)}>
                      <Check size={16} />
                    </button>
                    <button className="text-slate-400 dark:text-slate-500" onClick={() => setEditingId(null)}>
                      <X size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-slate-700 dark:text-slate-300">{item.name}</span>
                  <div className="flex items-center gap-1">
                    <button
                      className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditingName(item.name);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeleting(item)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer"
        message={`Voulez-vous vraiment supprimer "${deleting?.name}" ?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

export default function SettingsPage() {
  const sites = useSites();
  const departments = useDepartments();
  const positions = usePositions();

  return (
    <div>
      <PageHeader title="Paramètres" description="Sites, départements et fonctions de référence" />
      <div className="grid gap-6 lg:grid-cols-3">
        <ReferenceListCard title="Sites" queryKey="sites" endpoint="/sites" items={sites.data} isLoading={sites.isLoading} />
        <ReferenceListCard
          title="Départements"
          queryKey="departments"
          endpoint="/departments"
          items={departments.data}
          isLoading={departments.isLoading}
        />
        <ReferenceListCard
          title="Fonctions"
          queryKey="positions"
          endpoint="/positions"
          items={positions.data}
          isLoading={positions.isLoading}
        />
      </div>
    </div>
  );
}
