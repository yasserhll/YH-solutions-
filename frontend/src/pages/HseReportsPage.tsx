import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, FileText, FileSpreadsheet } from 'lucide-react';
import { api, apiErrorMessage, downloadFile } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useSelectableSites } from '../hooks/useReferenceData';
import { useAuth } from '../contexts/AuthContext';
import type { HseGeneralState, HseReport, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextAreaField, TextField } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/StatusBadge';

export default function HseReportsPage() {
  const { user } = useAuth();
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();
  const isHse = user?.role === 'hse';

  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<HseReport | null>(null);
  const [deleting, setDeleting] = useState<HseReport | null>(null);

  const reportsQuery = useQuery({
    queryKey: ['hse-reports', siteParams, page],
    queryFn: () => api.get<Paginated<HseReport>>('/hse-reports', { params: { ...siteParams, page } }).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/hse-reports/${id}`),
    onSuccess: () => {
      toast.success('Rapport supprimé.');
      queryClient.invalidateQueries({ queryKey: ['hse-reports'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  // hse only corrects/removes its own report; responsable_hse and SuperAdmin
  // — the controllers of this data — may act on any report in scope
  // (mirrored server-side in HseReportController::ensureCanAccessReport).
  function canEdit(report: HseReport) {
    return !isHse || report.created_by === user?.id;
  }

  // A printable/shareable version of the exact paper form — every row a
  // user can see is also exportable (same visibility rule as reading it),
  // so no extra permission check is needed here.
  function exportPdf(report: HseReport) {
    downloadFile(`/hse-reports/${report.id}/export-pdf`, {}, `rapport-hse-${report.id}.pdf`).catch(() =>
      toast.error("Échec de l'export PDF."),
    );
  }
  function exportExcel(report: HseReport) {
    downloadFile(`/hse-reports/${report.id}/export-excel`, {}, `rapport-hse-${report.id}.xlsx`).catch(() =>
      toast.error("Échec de l'export Excel."),
    );
  }

  const columns: Column<HseReport>[] = [
    { header: 'Date', accessor: (r) => new Date(r.report_date).toLocaleDateString('fr-FR') },
    { header: 'Site', accessor: (r) => r.site?.name ?? '—' },
    { header: 'Animateur HSE', accessor: (r) => r.creator?.name ?? '—' },
    { header: 'Nombre SPA', accessor: (r) => r.spa_count },
    { header: 'Participants', accessor: (r) => r.participants_count },
    { header: 'Situations dangereuses', accessor: (r) => r.dangerous_situations_count },
    { header: 'État général', accessor: (r) => <StatusBadge status={r.general_state} /> },
    {
      header: 'Actions',
      accessor: (r) => (
        <div className="flex items-center gap-1">
          <button
            className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Télécharger en PDF"
            onClick={() => exportPdf(r)}
          >
            <FileText size={16} />
          </button>
          <button
            className="rounded-md p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Télécharger en Excel"
            onClick={() => exportExcel(r)}
          >
            <FileSpreadsheet size={16} />
          </button>
          {canEdit(r) && (
            <>
              <button
                className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setEditing(r)}
              >
                <Pencil size={16} />
              </button>
              <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeleting(r)}>
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Rapports HSE"
        description={
          isHse
            ? 'Saisissez votre rapport journalier HSE'
            : 'Rapports journaliers HSE saisis par les animateurs de vos sites'
        }
        actions={
          (isHse || user?.role === 'superadmin') && (
            <Button onClick={() => setShowForm(true)}>
              <Plus size={16} /> Nouveau rapport
            </Button>
          )
        }
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <DataTable columns={columns} rows={reportsQuery.data?.data ?? []} isLoading={reportsQuery.isLoading} keyFn={(r) => r.id} />
        {reportsQuery.data && (
          <Pagination
            page={reportsQuery.data.current_page}
            lastPage={reportsQuery.data.last_page}
            total={reportsQuery.data.total}
            onPageChange={setPage}
          />
        )}
      </div>

      {(showForm || editing) && <HseReportFormModal report={editing} onClose={() => (setShowForm(false), setEditing(null))} />}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le rapport"
        message="Voulez-vous vraiment supprimer ce rapport journalier HSE ?"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function HseReportFormModal({ report, onClose }: { report: HseReport | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { sites, needsSiteSelect } = useSelectableSites();

  const [form, setForm] = useState({
    site_id: report?.site_id ?? '',
    report_date: report?.report_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    activities: report?.activities ?? '',
    spa_count: report?.spa_count ?? 0,
    topics_covered: report?.topics_covered ?? '',
    participants_count: report?.participants_count ?? 0,
    sanctions_count: report?.sanctions_count ?? 0,
    dangerous_situations_count: report?.dangerous_situations_count ?? 0,
    equipment_inspected: report?.equipment_inspected ?? '',
    general_state: (report?.general_state ?? 'conforme') as HseGeneralState,
    sor_notes: report?.sor_notes ?? '',
    corrective_actions: report?.corrective_actions ?? '',
    incidents_count: report?.incidents_count ?? 0,
    incidents_comment: report?.incidents_comment ?? '',
    accidents_count: report?.accidents_count ?? 0,
    accidents_comment: report?.accidents_comment ?? '',
    environmental_impact_count: report?.environmental_impact_count ?? 0,
    environmental_impact_comment: report?.environmental_impact_comment ?? '',
    shift_headcount: report?.shift_headcount ?? '',
    hours_worked: report?.hours_worked ?? '',
    sensitization_participation_rate: report?.sensitization_participation_rate ?? '',
    corrective_actions_closure_rate: report?.corrective_actions_closure_rate ?? '',
    non_conformities_count: report?.non_conformities_count ?? 0,
    inductions_count: report?.inductions_count ?? 0,
    audits_count: report?.audits_count ?? 0,
    evacuation_drills_count: report?.evacuation_drills_count ?? 0,
  });

  const mutation = useMutation({
    mutationFn: () => (report ? api.put(`/hse-reports/${report.id}`, form) : api.post('/hse-reports', form)),
    onSuccess: () => {
      toast.success(report ? 'Rapport mis à jour.' : 'Rapport enregistré.');
      queryClient.invalidateQueries({ queryKey: ['hse-reports'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <Modal open onClose={onClose} title={report ? 'Modifier le rapport HSE' : 'Nouveau rapport journalier HSE'} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-5"
      >
        <Section title="Informations générales">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Date"
              type="date"
              required
              value={form.report_date}
              onChange={(e) => set('report_date', e.target.value)}
            />
            {needsSiteSelect && !report && (
              <SelectField label="Projet/Site" required value={form.site_id} onChange={(e) => set('site_id', e.target.value)}>
                <option value="">Sélectionner...</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          <TextAreaField
            label="Activités réalisées"
            required
            value={form.activities}
            onChange={(e) => set('activities', e.target.value)}
          />
          <TextAreaField
            label="Sujet(s) abordé(s) (sensibilisations / formations / minute de sécurité)"
            value={form.topics_covered}
            onChange={(e) => set('topics_covered', e.target.value)}
          />
          <TextAreaField
            label="Équipements inspectés"
            value={form.equipment_inspected}
            onChange={(e) => set('equipment_inspected', e.target.value)}
          />
        </Section>

        <Section title="Chiffres du jour">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <TextField
              label="Nombre SPA"
              type="number"
              min={0}
              required
              value={form.spa_count}
              onChange={(e) => set('spa_count', Number(e.target.value))}
            />
            <TextField
              label="Participants"
              type="number"
              min={0}
              required
              value={form.participants_count}
              onChange={(e) => set('participants_count', Number(e.target.value))}
            />
            <TextField
              label="Sanctions"
              type="number"
              min={0}
              required
              value={form.sanctions_count}
              onChange={(e) => set('sanctions_count', Number(e.target.value))}
            />
            <TextField
              label="Situations dangereuses"
              type="number"
              min={0}
              required
              value={form.dangerous_situations_count}
              onChange={(e) => set('dangerous_situations_count', Number(e.target.value))}
            />
          </div>
          <SelectField
            label="État général"
            required
            value={form.general_state}
            onChange={(e) => set('general_state', e.target.value as HseGeneralState)}
          >
            <option value="conforme">Conforme</option>
            <option value="non_conforme">Non conforme</option>
          </SelectField>
        </Section>

        <Section title="SOR et actions">
          <TextAreaField
            label="SOR (minimum de 4 SORs à remonter)"
            value={form.sor_notes}
            onChange={(e) => set('sor_notes', e.target.value)}
          />
          <TextAreaField
            label="Actions préventives/correctives"
            value={form.corrective_actions}
            onChange={(e) => set('corrective_actions', e.target.value)}
          />
        </Section>

        <Section title="Indicateurs clés de performance (KPI)">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              label="Nbre d'incidents"
              type="number"
              min={0}
              required
              value={form.incidents_count}
              onChange={(e) => set('incidents_count', Number(e.target.value))}
            />
            <TextField
              label="Nbre d'accidents"
              type="number"
              min={0}
              required
              value={form.accidents_count}
              onChange={(e) => set('accidents_count', Number(e.target.value))}
            />
            <TextField
              label="Impact environnemental"
              type="number"
              min={0}
              required
              value={form.environmental_impact_count}
              onChange={(e) => set('environmental_impact_count', Number(e.target.value))}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              label="Commentaire incidents"
              value={form.incidents_comment}
              onChange={(e) => set('incidents_comment', e.target.value)}
            />
            <TextField
              label="Commentaire accidents"
              value={form.accidents_comment}
              onChange={(e) => set('accidents_comment', e.target.value)}
            />
            <TextField
              label="Commentaire impact environnemental"
              value={form.environmental_impact_comment}
              onChange={(e) => set('environmental_impact_comment', e.target.value)}
            />
          </div>
        </Section>

        <Section title="Effectifs et indicateurs complémentaires">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <TextField
              label="Effectifs de Shift"
              type="number"
              min={0}
              value={form.shift_headcount}
              onChange={(e) => set('shift_headcount', e.target.value)}
            />
            <TextField
              label="Heures travaillées"
              type="number"
              min={0}
              step="0.5"
              value={form.hours_worked}
              onChange={(e) => set('hours_worked', e.target.value)}
            />
            <TextField
              label="Taux participation Sensibilisations HSE (%)"
              type="number"
              min={0}
              max={100}
              value={form.sensitization_participation_rate}
              onChange={(e) => set('sensitization_participation_rate', e.target.value)}
            />
            <TextField
              label="Taux clôture actions correctives (%)"
              type="number"
              min={0}
              max={100}
              value={form.corrective_actions_closure_rate}
              onChange={(e) => set('corrective_actions_closure_rate', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <TextField
              label="Non-conformités"
              type="number"
              min={0}
              required
              value={form.non_conformities_count}
              onChange={(e) => set('non_conformities_count', Number(e.target.value))}
            />
            <TextField
              label="Inductions HSE"
              type="number"
              min={0}
              required
              value={form.inductions_count}
              onChange={(e) => set('inductions_count', Number(e.target.value))}
            />
            <TextField
              label="Visites inspections / Audits"
              type="number"
              min={0}
              required
              value={form.audits_count}
              onChange={(e) => set('audits_count', Number(e.target.value))}
            />
            <TextField
              label="Exercices d'évacuation d'urgence"
              type="number"
              min={0}
              required
              value={form.evacuation_drills_count}
              onChange={(e) => set('evacuation_drills_count', Number(e.target.value))}
            />
          </div>
        </Section>

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
