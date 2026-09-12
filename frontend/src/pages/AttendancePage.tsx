import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UserX, Pencil, Download, CalendarOff, Trash2 } from 'lucide-react';
import { api, apiErrorMessage, downloadFile } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { AbsenceCause, DailyAttendanceRow, DailyAttendanceSheet } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { LoadingState, EmptyState } from '../components/ui/States';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextAreaField, TextField } from '../components/ui/Field';

const causeLabels: Record<AbsenceCause, string> = {
  maladie: 'Maladie',
  autorisee: 'Autorisée',
  non_autorisee: 'Non autorisée',
  conge: 'Congé',
  mise_a_pied: 'Mise à pied',
  stc: 'STC (départ définitif)',
};

export default function AttendancePage() {
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [absenceTarget, setAbsenceTarget] = useState<DailyAttendanceRow | DailyAttendanceRow[] | null>(null);
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [confirmRemoveHoliday, setConfirmRemoveHoliday] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-daily', siteParams, date, search, statusFilter],
    queryFn: () =>
      api
        .get<DailyAttendanceSheet>('/attendance/daily', { params: { ...siteParams, date, search: search || undefined, status: statusFilter || undefined } })
        .then((r) => r.data),
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      downloadFile('/reports/attendance/export', { ...siteParams, date_from: date, date_to: date, search: search || undefined, status: statusFilter || undefined }, 'pointage.xlsx'),
    onError: (err) => toast.error(apiErrorMessage(err, "Échec de l'export.")),
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

  const removeHoliday = useMutation({
    mutationFn: (holidayId: number) => api.delete(`/holidays/${holidayId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      toast.success('Jour férié retiré.');
      setConfirmRemoveHoliday(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const rows = data?.rows ?? [];
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const dayType = data?.day_type ?? 'normal';

  return (
    <div>
      <PageHeader title="Pointage" description="Pointage quotidien des présences et absences" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => (setDate(e.target.value), setSelected([]))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <div className="w-full sm:w-56">
            <SearchInput placeholder="Rechercher un employé..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="">Tous</option>
            <option value="present">Présents</option>
            <option value="absent">Absents</option>
          </select>
          <Button variant="secondary" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            <Download size={16} /> {exportMutation.isPending ? 'Export en cours...' : 'Export Excel'}
          </Button>
          {dayType !== 'holiday' && (
            <Button variant="secondary" onClick={() => setShowHolidayForm(true)}>
              <CalendarOff size={16} /> Déclarer jour férié
            </Button>
          )}
          {dayType === 'holiday' && (
            <Button variant="secondary" onClick={() => setConfirmRemoveHoliday(true)}>
              <Trash2 size={16} /> Retirer le jour férié
            </Button>
          )}
        </div>
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

      {dayType !== 'normal' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400">
          <CalendarOff size={16} className="shrink-0" />
          <span>
            {dayType === 'holiday'
              ? `Jour férié${data?.holiday_name ? ` (${data.holiday_name})` : ''} : tous les employés actifs sont considérés absents par défaut. Sélectionnez uniquement les personnes venues travailler pour les marquer présentes.`
              : 'Dimanche : tous les employés actifs sont considérés absents par défaut. Sélectionnez uniquement les personnes venues travailler pour les marquer présentes.'}
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState message="Aucun employé actif pour ce site." />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
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
          </div>
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

      {showHolidayForm && <HolidayFormModal date={date} onClose={() => setShowHolidayForm(false)} />}

      <ConfirmDialog
        open={confirmRemoveHoliday}
        title="Retirer le jour férié"
        message={`Voulez-vous vraiment retirer "${data?.holiday_name}" ? Les employés actifs redeviendront présents par défaut pour cette date.`}
        onCancel={() => setConfirmRemoveHoliday(false)}
        onConfirm={() => data?.holiday_id && removeHoliday.mutate(data.holiday_id)}
        isLoading={removeHoliday.isPending}
      />
    </div>
  );
}

function HolidayFormModal({ date, onClose }: { date: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/holidays', { date, name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      toast.success('Jour férié déclaré.');
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Déclarer un jour férié" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Le {new Date(date).toLocaleDateString('fr-FR')} sera marqué jour férié : tous les employés actifs seront considérés
          absents par défaut, seuls ceux marqués présents (venus travailler) apparaîtront comme tels.
        </p>
        <TextField label="Nom du jour férié" required placeholder="Ex : Aïd al-Fitr" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={!name || mutation.isPending}>
            Confirmer
          </Button>
        </div>
      </form>
    </Modal>
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
      if (cause === 'stc') {
        queryClient.invalidateQueries({ queryKey: ['employees'] });
        queryClient.invalidateQueries({ queryKey: ['exits'] });
      }
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
          <option value="conge">Congé</option>
          <option value="mise_a_pied">Mise à pied</option>
          <option value="stc">STC (départ définitif)</option>
        </SelectField>
        {cause === 'stc' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            La date sélectionnée sera enregistrée comme date de sortie. L'employé sera automatiquement marqué "Sorti" et
            n'apparaîtra plus dans le pointage à partir du jour suivant.
          </p>
        )}
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
