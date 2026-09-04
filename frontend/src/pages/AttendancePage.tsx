import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UserX, Pencil } from 'lucide-react';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { AbsenceCause, DailyAttendanceRow } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { LoadingState, EmptyState } from '../components/ui/States';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { SelectField, TextAreaField } from '../components/ui/Field';

const causeLabels: Record<AbsenceCause, string> = {
  maladie: 'Maladie',
  autorisee: 'Autorisée',
  non_autorisee: 'Non autorisée',
  justifie: 'Justifié',
  conge: 'Congé',
};

export default function AttendancePage() {
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<number[]>([]);
  const [absenceTarget, setAbsenceTarget] = useState<DailyAttendanceRow | DailyAttendanceRow[] | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-daily', siteParams, date],
    queryFn: () => api.get<DailyAttendanceRow[]>('/attendance/daily', { params: { ...siteParams, date } }).then((r) => r.data),
  });

  const markPresent = useMutation({
    mutationFn: (employeeId: number) => api.post('/attendance', { employee_id: employeeId, date, status: 'present' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      toast.success('Marqué présent.');
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const bulkPresent = useMutation({
    mutationFn: () => api.post('/attendance/bulk', { date, employee_ids: selected, status: 'present' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      toast.success('Statut mis à jour.');
      setSelected([]);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const rows = data ?? [];
  const allSelected = rows.length > 0 && selected.length === rows.length;

  return (
    <div>
      <PageHeader title="Pointage" description="Pointage quotidien des présences et absences" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <input
          type="date"
          value={date}
          onChange={(e) => (setDate(e.target.value), setSelected([]))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        {selected.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">{selected.length} sélectionné(s)</span>
            <Button size="sm" variant="secondary" onClick={() => bulkPresent.mutate()}>
              Marquer présents
            </Button>
            <Button size="sm" variant="danger" onClick={() => setAbsenceTarget(rows.filter((r) => selected.includes(r.employee_id)))}>
              Marquer absents
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState message="Aucun employé actif pour ce site." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.employee_id) : [])}
                  />
                </th>
                <th className="px-4 py-3 font-medium">Nom complet</th>
                <th className="px-4 py-3 font-medium">Site</th>
                <th className="px-4 py-3 font-medium">Présence</th>
                <th className="px-4 py-3 font-medium">Cause</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => (
                <tr key={row.employee_id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.employee_id)}
                      onChange={(e) =>
                        setSelected((prev) => (e.target.checked ? [...prev, row.employee_id] : prev.filter((id) => id !== row.employee_id)))
                      }
                    />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{row.full_name}</td>
                  <td className="px-4 py-2.5">{row.site}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2.5">{row.absence_cause ? causeLabels[row.absence_cause] : '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{row.description ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {row.status === 'present' ? (
                      <Button size="sm" variant="secondary" onClick={() => setAbsenceTarget(row)}>
                        <UserX size={14} /> Marquer absent
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="secondary" onClick={() => markPresent.mutate(row.employee_id)}>
                          Marquer présent
                        </Button>
                        {/* Correcting the cause (e.g. "non autorisée" → "maladie"
                            once a medical justification arrives) shouldn't
                            require marking present then absent again. */}
                        <button
                          onClick={() => setAbsenceTarget(row)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                          aria-label="Modifier la cause de l'absence"
                          title="Modifier la cause de l'absence"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {absenceTarget && (
        <AbsenceModal
          date={date}
          target={absenceTarget}
          onClose={() => setAbsenceTarget(null)}
          onSaved={() => {
            setAbsenceTarget(null);
            setSelected([]);
          }}
        />
      )}
    </div>
  );
}

function AbsenceModal({
  date,
  target,
  onClose,
  onSaved,
}: {
  date: string;
  target: DailyAttendanceRow | DailyAttendanceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const isBulk = Array.isArray(target);
  // Editing an already-absent row (e.g. correcting "non autorisée" to
  // "maladie" once a medical note arrives) pre-fills the current values
  // instead of resetting to the defaults.
  const isCorrection = !isBulk && target.status === 'absent';
  const [cause, setCause] = useState<AbsenceCause>(isCorrection && target.absence_cause ? target.absence_cause : 'maladie');
  const [description, setDescription] = useState(isCorrection ? (target.description ?? '') : '');

  const mutation = useMutation({
    mutationFn: async (): Promise<unknown> => {
      if (isBulk) {
        return api.post('/attendance/bulk', {
          date,
          employee_ids: target.map((t) => t.employee_id),
          status: 'absent',
          absence_cause: cause,
          description,
        });
      }
      return api.post('/attendance', {
        employee_id: target.employee_id,
        date,
        status: 'absent',
        absence_cause: cause,
        description,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      toast.success(isCorrection ? 'Absence mise à jour.' : 'Absence enregistrée.');
      onSaved();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={isCorrection ? "Modifier l'absence" : 'Marquer absent'} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isBulk ? `${target.length} employé(s) sélectionné(s)` : target.full_name}
        </p>
        <SelectField label="Cause d'absence" required value={cause} onChange={(e) => setCause(e.target.value as AbsenceCause)}>
          <option value="maladie">Maladie</option>
          <option value="autorisee">Autorisée</option>
          <option value="non_autorisee">Non autorisée</option>
          <option value="justifie">Justifié</option>
          <option value="conge">Congé</option>
        </SelectField>
        <TextAreaField
          label="Description / détail"
          placeholder="Ex : Absence pour rendez-vous médical."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="danger" disabled={mutation.isPending}>
            {isCorrection ? 'Enregistrer' : "Confirmer l'absence"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
