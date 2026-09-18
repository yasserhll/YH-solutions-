import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UserX, Pencil, Download, CalendarOff, Trash2, X } from 'lucide-react';
import { api, apiErrorMessage, downloadFile } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { AbsenceCause, DailyAttendanceRow, DailyAttendanceSheet, Employee, Illness, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { LoadingState, EmptyState } from '../components/ui/States';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextAreaField, TextField } from '../components/ui/Field';
import { EmployeeSelect } from '../components/ui/EmployeeSelect';
import { DataTable, type Column } from '../components/ui/DataTable';

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
  const [cancelStcTarget, setCancelStcTarget] = useState<DailyAttendanceRow | null>(null);
  const [editingIllness, setEditingIllness] = useState<Illness | null>(null);
  const [deletingIllness, setDeletingIllness] = useState<Illness | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-daily', siteParams, date, search, statusFilter],
    queryFn: () =>
      api
        .get<DailyAttendanceSheet>('/attendance/daily', { params: { ...siteParams, date, search: search || undefined, status: statusFilter || undefined } })
        .then((r) => r.data),
  });

  const illnessesQuery = useQuery({
    queryKey: ['illnesses', siteParams],
    queryFn: () => api.get<Paginated<Illness>>('/illnesses', { params: { ...siteParams, per_page: 50 } }).then((r) => r.data),
  });

  const deleteIllnessMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/illnesses/${id}`),
    onSuccess: () => {
      toast.success('Période de maladie supprimée.');
      queryClient.invalidateQueries({ queryKey: ['illnesses'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      setDeletingIllness(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
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
  // Cancelling removes the record rather than flipping it, so the row falls
  // back to whatever this day's default is (see AttendanceController::daily).
  const defaultStatusLabel = dayType === 'normal' ? 'présent' : 'absent';

  const cancelAttendance = useMutation({
    mutationFn: (row: DailyAttendanceRow) => api.delete(`/attendance/${row.attendance_id}`),
    onSuccess: (_res, row) => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      // Cancelling an STC also brings the employee back from "sorti" and
      // deletes the Sortie it generated — both lists are stale now.
      if (row.absence_cause === 'stc') {
        queryClient.invalidateQueries({ queryKey: ['employees'] });
        queryClient.invalidateQueries({ queryKey: ['exits'] });
      }
      toast.success(`Pointage annulé — ${row.full_name} est de nouveau ${defaultStatusLabel} par défaut.`);
      setCancelStcTarget(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  // A plain absent/present correction is itself reversible in one click, so
  // it doesn't need a confirmation; an STC does, because cancelling it also
  // reverses the employee's departure.
  function requestCancel(row: DailyAttendanceRow) {
    if (row.absence_cause === 'stc') {
      setCancelStcTarget(row);
      return;
    }
    cancelAttendance.mutate(row);
  }

  const illnessColumns: Column<Illness>[] = [
    { header: 'Employé', accessor: (i) => i.employee?.full_name },
    { header: 'Site', accessor: (i) => i.site?.name },
    { header: 'Début', accessor: (i) => new Date(i.start_date).toLocaleDateString('fr-FR') },
    { header: 'Fin', accessor: (i) => new Date(i.end_date).toLocaleDateString('fr-FR') },
    { header: 'Description', accessor: (i) => i.description ?? '—' },
    {
      header: 'Actions',
      accessor: (i) => (
        <div className="flex items-center gap-1">
          <button
            className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setEditingIllness(i)}
          >
            <Pencil size={14} />
          </button>
          <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" onClick={() => setDeletingIllness(i)}>
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

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
                    <div className="flex items-center gap-1">
                      {row.status === 'present' ? (
                        <Button size="sm" variant="secondary" onClick={() => setAbsenceTarget(row)}>
                          <UserX size={14} /> Marquer absent
                        </Button>
                      ) : (
                        <>
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
                        </>
                      )}
                      {/* Only rows actually keyed in have something to cancel —
                          a row still on the day's default has no record yet. */}
                      {row.attendance_id !== null && (
                        <button
                          onClick={() => requestCancel(row)}
                          disabled={cancelAttendance.isPending}
                          className="rounded-md p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
                          aria-label="Annuler ce pointage"
                          title={`Annuler ce pointage — ${row.full_name} redeviendra ${defaultStatusLabel} par défaut`}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Périodes de maladie déclarées</h3>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <DataTable
            columns={illnessColumns}
            rows={illnessesQuery.data?.data ?? []}
            isLoading={illnessesQuery.isLoading}
            keyFn={(i) => i.id}
            emptyMessage="Aucune période de maladie déclarée."
          />
        </div>
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

      {editingIllness && <IllnessFormModal illness={editingIllness} onClose={() => setEditingIllness(null)} />}

      <ConfirmDialog
        open={!!deletingIllness}
        title="Supprimer cette période de maladie"
        message={`Voulez-vous vraiment supprimer cette période de maladie pour ${deletingIllness?.employee?.full_name} ? L'employé redeviendra disponible normalement pour ces dates.`}
        onCancel={() => setDeletingIllness(null)}
        onConfirm={() => deletingIllness && deleteIllnessMutation.mutate(deletingIllness.id)}
        isLoading={deleteIllnessMutation.isPending}
      />

      <ConfirmDialog
        open={!!cancelStcTarget}
        title="Annuler ce pointage STC"
        message={`${cancelStcTarget?.full_name} redeviendra ${defaultStatusLabel} par défaut et repassera en "actif" : la sortie générée par ce STC sera supprimée et son affectation réouverte.`}
        confirmLabel="Confirmer l'annulation"
        onCancel={() => setCancelStcTarget(null)}
        onConfirm={() => cancelStcTarget && cancelAttendance.mutate(cancelStcTarget)}
        isLoading={cancelAttendance.isPending}
      />

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
  // Only used when cause === 'maladie' — declaring a Maladie always covers a
  // date range (see Illness/AttendanceAutomation backend-side), defaulting
  // to just this one day but editable to cover more.
  const [illnessStart, setIllnessStart] = useState(date);
  const [illnessEnd, setIllnessEnd] = useState(date);

  const mutation = useMutation({
    mutationFn: async (): Promise<unknown> => {
      const targets = isBulk ? target : [target];

      if (cause === 'maladie') {
        return Promise.all(
          targets.map((t) =>
            api.post('/illnesses', {
              employee_id: t.employee_id,
              start_date: illnessStart,
              end_date: illnessEnd,
              description,
            }),
          ),
        );
      }

      if (isBulk) {
        return api.post('/attendance/bulk', {
          date,
          employee_ids: targets.map((t) => t.employee_id),
          status: 'absent',
          absence_cause: cause,
          description,
        });
      }
      return api.post('/attendance', {
        employee_id: targets[0].employee_id,
        date,
        status: 'absent',
        absence_cause: cause,
        description,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      if (cause === 'maladie') {
        queryClient.invalidateQueries({ queryKey: ['illnesses'] });
      }
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
        {cause === 'maladie' ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Date de début"
              type="date"
              required
              value={illnessStart}
              onChange={(e) => setIllnessStart(e.target.value)}
            />
            <TextField
              label="Date de fin"
              type="date"
              required
              min={illnessStart}
              value={illnessEnd}
              onChange={(e) => setIllnessEnd(e.target.value)}
            />
          </div>
        ) : (
          // Congé/Mise à pied normalement suivis depuis leurs propres pages
          // (Congés/Sanctions) — le pointage y sera automatiquement synchronisé
          // (voir la période active correspondante) ; ce choix ici ne couvre
          // que ce seul jour.
          (cause === 'conge' || cause === 'mise_a_pied') && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Normalement suivi depuis le module {cause === 'conge' ? 'Congés' : 'Sanctions'} (synchronisé automatiquement avec le
              pointage) — ce choix ici ne couvre que cette seule journée.
            </p>
          )
        )}
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

/**
 * Edits an already-declared Maladie PERIOD (start_date..end_date, inclusive)
 * — creating a new one happens inline from the "Marquer absent" modal (cause
 * = Maladie) instead of here; this modal is only reached via the pencil icon
 * on the "Périodes de maladie déclarées" list below the daily sheet.
 */
function IllnessFormModal({ illness, onClose }: { illness: Illness; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<Employee | null>(illness.employee ?? null);
  const [form, setForm] = useState({
    start_date: illness.start_date.slice(0, 10),
    end_date: illness.end_date.slice(0, 10),
    description: illness.description ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => api.put(`/illnesses/${illness.id}`, { ...form, employee_id: employee?.id }),
    onSuccess: () => {
      toast.success('Période de maladie mise à jour.');
      queryClient.invalidateQueries({ queryKey: ['illnesses'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-daily'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Modifier la période de maladie" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Date de début"
            type="date"
            required
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
          <TextField
            label="Date de fin"
            type="date"
            required
            min={form.start_date}
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
          />
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          L'employé sera automatiquement marqué "Absent - Maladie" pour chaque jour de cette période (bornes incluses), sans
          pointage manuel. Il redevient disponible normalement dès le lendemain de la date de fin.
        </p>
        <TextAreaField
          label="Description (optionnel)"
          placeholder="Ex : Arrêt maladie avec certificat médical."
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
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
