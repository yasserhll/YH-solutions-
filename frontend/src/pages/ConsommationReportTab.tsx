import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Droplets,
  Hammer,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Truck,
  Upload,
  Users,
  CalendarDays,
  AlertCircle,
  CircleSlash,
  Sparkles,
} from 'lucide-react';
import { api, apiErrorMessage, downloadFile, uploadErrorMessage } from '../api/client';
import { useFuelSite } from '../hooks/useFuelSite';
import type { FuelAssignment, FuelDailyReport, FuelReportVehicle } from '../types';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SearchInput } from '../components/ui/SearchInput';
import { EmptyState, LoadingState } from '../components/ui/States';
import { SelectField, TextField } from '../components/ui/Field';

// Consommation > Rapport: the daily "CONSOMMATION JOURNALIERE DE GASOIL"
// (camions D… + engins E… only), ALWAYS generated from the Global (the same
// fuel_movements rows, Global hand-corrections included) — the user's
// RAPPORT GSL file was only a model of the layout, never imported. Only
// drivers and activité are typed here. Plus the site's
// affectation (drivers per vehicle), imported from Excel or typed.

const intFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';
const inputClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400';
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => toIso(new Date());
const shiftDay = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIso(d);
};
const frDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
const longDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const ACTIVITIES = ['STERILE', 'PHOSPHATE', 'STERILE/PHOSPHATE', 'PHOSPHATE/STERILE', 'DECHARGE/STERILE', 'ARROSAGE'];

const VIEWS = ['Rapport du jour', 'Affectation'] as const;
type View = (typeof VIEWS)[number];

export default function ReportTab() {
  const { siteId, siteFilter, ready, sitePicker } = useFuelSite('Rapport du site :');
  const [view, setView] = useState<View>('Rapport du jour');
  const [date, setDate] = useState(''); // '' = the latest day with data (server decides)

  const { data: assignments } = useQuery({
    queryKey: ['fuel', 'assignments', siteFilter],
    queryFn: () => api.get<FuelAssignment[]>('/fuel/assignments', { params: siteFilter }).then((r) => r.data),
    enabled: ready,
  });

  return (
    <div className="space-y-5">
      {sitePicker}
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60 w-fit animate-fade-up">
        {VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={clsx(
              'flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              view === v ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            {v === 'Rapport du jour' ? <ClipboardList size={15} /> : <Users size={15} />}
            {v}
            {v === 'Affectation' && assignments && (
              <span className="rounded-full bg-slate-200 px-1.5 text-xs tabular-nums dark:bg-slate-600">{assignments.length}</span>
            )}
          </button>
        ))}
      </div>

      {!ready ? (
        <LoadingState rows={6} />
      ) : view === 'Rapport du jour' ? (
        <DailyReport key={siteId ?? 'own'} siteFilter={siteFilter} date={date} setDate={setDate} assignments={assignments ?? []} onOpenAssignments={() => setView('Affectation')} />
      ) : (
        <AssignmentsView key={siteId ?? 'own'} siteFilter={siteFilter} assignments={assignments} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- daily report

function DailyReport({
  siteFilter,
  date,
  setDate,
  assignments,
  onOpenAssignments,
}: {
  siteFilter: { site_id?: number };
  date: string;
  setDate: (d: string) => void;
  assignments: FuelAssignment[];
  onOpenAssignments: () => void;
}) {
  const [month, setMonth] = useState('');
  const [exporting, setExporting] = useState<'day' | 'month' | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['fuel', 'report', siteFilter, date],
    queryFn: () => api.get<FuelDailyReport>('/fuel/report', { params: { ...siteFilter, date: date || undefined } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const today = todayIso();
  const shownDate = data?.date ?? date;
  const exportMonth = month || shownDate.slice(0, 7);

  async function exportExcel(kind: 'day' | 'month') {
    setExporting(kind);
    try {
      await downloadFile('/fuel/report/export', { ...siteFilter, ...(kind === 'day' ? { date: shownDate } : { month: exportMonth }) }, 'rapport-gsl.xlsx');
    } catch (err) {
      toast.error(apiErrorMessage(err, "Échec de l'export."));
    } finally {
      setExporting(null);
    }
  }

  if (isLoading && !data) return <LoadingState rows={8} />;
  if (!data) return null;

  const drivers = [...new Set(assignments.flatMap((a) => [a.driver_1, a.driver_2]).filter(Boolean) as string[])].sort();
  const empty = data.camions.length + data.engins.length === 0;
  const notImportedYet = !!data.last_date && shownDate > data.last_date;

  return (
    <div className="space-y-5">
      {/* Toolbar: day navigation + exports */}
      <div className={clsx(card, 'flex flex-wrap items-center gap-3 p-3 animate-fade-up')}>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDate(shiftDay(shownDate, -1))}
            title="Jour précédent"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ChevronLeft size={18} />
          </button>
          <input type="date" value={shownDate} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputClass} aria-label="Jour du rapport" />
          <button
            onClick={() => setDate(shiftDay(shownDate, 1))}
            disabled={shownDate >= today}
            title="Jour suivant"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ChevronRight size={18} />
          </button>
          <span className="ml-2 hidden text-sm font-medium capitalize text-slate-700 md:inline dark:text-slate-300">{longDate(shownDate)}</span>
          {shownDate !== today && (
            <button onClick={() => setDate(today)} className="ml-2 rounded-full px-3 py-1 text-xs font-medium text-orange-600 ring-1 ring-orange-200 hover:bg-orange-50 dark:text-orange-400 dark:ring-orange-500/30 dark:hover:bg-orange-500/10">
              Aujourd'hui
            </button>
          )}
          {isFetching && <Loader2 size={15} className="ml-2 animate-spin text-slate-400" />}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => exportExcel('day')} disabled={!!exporting || empty}>
            {exporting === 'day' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Export du jour
          </Button>
          <div className="flex items-center gap-1 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
            <input type="month" value={exportMonth} onChange={(e) => setMonth(e.target.value)} className="rounded-l-lg bg-transparent px-2 py-1.5 text-sm focus:outline-none dark:text-slate-100" aria-label="Mois à exporter" />
            <Button onClick={() => exportExcel('month')} disabled={!!exporting}>
              {exporting === 'month' ? <Loader2 size={16} className="animate-spin" /> : <CalendarDays size={16} />}
              Export du mois
            </Button>
          </div>
        </div>
      </div>

      <p className="flex items-center gap-2 px-1 text-xs text-slate-500 animate-fade-up dark:text-slate-400">
        <Sparkles size={13} className="shrink-0 text-orange-500" />
        Généré automatiquement depuis le Global de ce site (camions D… et engins E…{data.assigned_only ? " présents dans l'affectation" : ''}) : litres, heures et %
        viennent du Global, et toute correction faite dans le Global s'applique ici. Seuls les chauffeurs et l'activité se saisissent dans le rapport.
      </p>

      {data.assignments_count === 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 animate-fade-up dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertCircle size={18} className="shrink-0" />
          <span className="flex-1">
            {data.assigned_only
              ? "Aucune affectation pour ce site : le rapport n'affiche que les camions et engins de l'affectation, importez-la pour le remplir."
              : 'Aucune affectation pour ce site : les chauffeurs ne peuvent pas être remplis automatiquement.'}
          </span>
          <Button size="sm" onClick={onOpenAssignments}>
            <Upload size={14} /> Importer l'affectation
          </Button>
        </div>
      )}

      {empty ? (
        <div className={card}>
          <EmptyState
            icon={ClipboardList}
            title={notImportedYet ? "Pas encore de données pour ce jour" : 'Aucun plein ce jour-là'}
            message={
              notImportedYet
                ? `Le dernier plein de camion ou d'engin dans le Global de ce site date du ${frDate(data.last_date!)}. Dès que les fichiers des citernes à jour seront réimportés (onglet « Citernes »), le rapport de ce jour se construira tout seul.`
                : "Aucun camion (D…) ni engin (E…) n'a été servi à cette date."
            }
          />
          {notImportedYet && (
            <div className="flex justify-center pb-6">
              <Button size="sm" variant="secondary" onClick={() => setDate(data.last_date!)}>
                Aller au {frDate(data.last_date!)}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiTile label="Total du jour" value={`${intFmt.format(data.totals.all)} L`} hint={`${data.camions.length + data.engins.length} véhicules servis`} icon={Droplets} gradient="from-orange-500 to-amber-500" />
            <KpiTile label="Camions" value={`${intFmt.format(data.totals.camions)} L`} hint={`${data.camions.length} camions`} icon={Truck} gradient="from-blue-500 to-indigo-500" />
            <KpiTile label="Engins" value={`${intFmt.format(data.totals.engins)} L`} hint={`${data.engins.length} engins`} icon={Hammer} gradient="from-purple-500 to-fuchsia-500" />
          </div>

          <datalist id="fuel-drivers">
            {drivers.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <datalist id="fuel-activities">
            {ACTIVITIES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>

          <ReportBlock title="Camions" peopleLabel="Chauffeurs" ratioLabel="%" icon={Truck} vehicles={data.camions} total={data.totals.camions} date={data.date} siteFilter={siteFilter} />
          <ReportBlock title="Engins" peopleLabel="Conducteurs" ratioLabel="L / h" icon={Hammer} vehicles={data.engins} total={data.totals.engins} date={data.date} siteFilter={siteFilter} />
        </>
      )}
    </div>
  );
}

function KpiTile({ label, value, hint, icon: Icon, gradient }: { label: string; value: string; hint: string; icon: typeof Truck; gradient: string }) {
  return (
    <div className={clsx(card, 'flex items-center gap-4 p-4 animate-fade-up')}>
      <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br text-white shadow', gradient)}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</div>
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{hint}</div>
      </div>
    </div>
  );
}

function ReportBlock({
  title,
  peopleLabel,
  ratioLabel,
  icon: Icon,
  vehicles,
  total,
  date,
  siteFilter,
}: {
  title: string;
  peopleLabel: string;
  ratioLabel: string;
  icon: typeof Truck;
  vehicles: FuelReportVehicle[];
  total: number;
  date: string;
  siteFilter: { site_id?: number };
}) {
  if (vehicles.length === 0) return null;

  return (
    <section className={clsx(card, 'overflow-hidden animate-fade-up')}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-900 px-5 py-3 text-white dark:border-slate-800 dark:bg-slate-950">
        <h3 className="flex items-center gap-2 font-semibold">
          <Icon size={17} className="text-orange-300" /> {title}
          <span className="rounded-full bg-white/15 px-2 text-xs tabular-nums">{vehicles.length}</span>
        </h3>
        <span className="rounded-lg bg-amber-400 px-3 py-1 text-sm font-bold tabular-nums text-slate-900">Total {intFmt.format(total)} L</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <th className="px-4 py-2.5 font-medium">{peopleLabel} — équipe 1</th>
              <th className="px-4 py-2.5 font-medium">Équipe 2</th>
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 text-right font-medium">Litrage</th>
              <th className="px-4 py-2.5 text-right font-medium">{ratioLabel}</th>
              <th className="px-4 py-2.5 text-right font-medium">Heure</th>
              <th className="px-4 py-2.5 font-medium">Activité</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {vehicles.map((v) => (
              <VehicleRow key={v.code} vehicle={v} date={date} siteFilter={siteFilter} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VehicleRow({ vehicle, date, siteFilter }: { vehicle: FuelReportVehicle; date: string; siteFilter: { site_id?: number } }) {
  const queryClient = useQueryClient();
  const values = { driver_1: vehicle.driver_1 ?? '', driver_2: vehicle.driver_2 ?? '', activity: vehicle.activity ?? '' };

  const mutation = useMutation({
    mutationFn: (changes: Partial<typeof values>) => api.put('/fuel/report/lines', { ...siteFilter, date, vehicle_code: vehicle.code, ...values, ...changes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fuel', 'report'] }),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const save = (field: keyof typeof values) => (value: string) => {
    if (value.trim().toUpperCase() !== values[field].trim().toUpperCase()) mutation.mutate({ [field]: value });
  };

  return (
    <tr className="align-top transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
      <td className="px-4 py-2">
        <InlineInput value={values.driver_1} onSave={save('driver_1')} list="fuel-drivers" placeholder="—" />
      </td>
      <td className="px-4 py-2">
        <InlineInput value={values.driver_2} onSave={save('driver_2')} list="fuel-drivers" placeholder="—" />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col items-start gap-1">
          <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white dark:bg-white dark:text-slate-900">{vehicle.label}</span>
          {!vehicle.assigned && <span className="text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">Sans affectation</span>}
          {vehicle.edited && <span className="text-[10px] font-semibold uppercase text-sky-600 dark:text-sky-400">Modifié ce jour</span>}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right">
        <Stack>
          {vehicle.refuels.map((r) => (
            <span key={r.id} className="font-semibold tabular-nums text-slate-900 dark:text-slate-100" title={`${r.time?.slice(0, 5) ?? ''} · ${r.tank}${r.remark ? ' · ' + r.remark : ''}`}>
              {intFmt.format(r.quantity)}
            </span>
          ))}
        </Stack>
      </td>
      <td className="px-4 py-2.5 text-right">
        <Stack>
          {vehicle.refuels.map((r) => (
            <span key={r.id} className={clsx('tabular-nums', r.ratio === null ? 'text-slate-300 dark:text-slate-600' : 'font-medium text-emerald-700 dark:text-emerald-400')}>
              {r.ratio === null ? '-' : pctFmt.format(r.ratio)}
            </span>
          ))}
        </Stack>
      </td>
      <td className="px-4 py-2.5 text-right">
        <Stack>
          {vehicle.refuels.map((r) =>
            r.no_counter ? (
              <span key={r.id} title="Pas de compteur relevé" className="inline-flex items-center justify-end gap-1 text-xs text-amber-600 dark:text-amber-400">
                <CircleSlash size={11} /> CP
              </span>
            ) : (
              <span key={r.id} className="tabular-nums text-slate-600 dark:text-slate-300">
                {r.hours === null ? '-' : `${intFmt.format(r.hours)}${r.unit === 'km' ? ' km' : ''}`}
              </span>
            ),
          )}
        </Stack>
      </td>
      <td className="px-4 py-2">
        <InlineInput value={values.activity} onSave={save('activity')} list="fuel-activities" placeholder="Activité…" />
      </td>
    </tr>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-end gap-1.5 py-0.5">{children}</div>;
}

/** Saves on blur / Enter; Escape reverts. Re-keyed by its value so a refetch resets it. */
function InlineInput({ value, onSave, list, placeholder }: { value: string; onSave: (v: string) => void; list?: string; placeholder?: string }) {
  return <InlineInputInner key={value} initial={value} onSave={onSave} list={list} placeholder={placeholder} />;
}

function InlineInputInner({ initial, onSave, list, placeholder }: { initial: string; onSave: (v: string) => void; list?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref}
      value={draft}
      list={list}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value.toUpperCase())}
      onBlur={() => onSave(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') ref.current?.blur();
        if (e.key === 'Escape') {
          setDraft(initial);
          setTimeout(() => ref.current?.blur());
        }
      }}
      className="w-full min-w-[150px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium text-slate-800 placeholder:text-slate-300 hover:border-slate-200 focus:border-orange-400 focus:bg-white focus:outline-none dark:text-slate-200 dark:placeholder:text-slate-600 dark:hover:border-slate-700 dark:focus:bg-slate-800"
    />
  );
}

// ---------------------------------------------------------------- affectation

function AssignmentsView({ siteFilter, assignments }: { siteFilter: { site_id?: number }; assignments: FuelAssignment[] | undefined }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FuelAssignment | 'new' | null>(null);
  const [deleting, setDeleting] = useState<FuelAssignment | null>(null);
  const [importing, setImporting] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (a: FuelAssignment) => api.delete(`/fuel/assignments/${a.id}`),
    onSuccess: () => {
      toast.success('Affectation supprimée.');
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  async function importFile(file: File) {
    setImporting(true);
    const form = new FormData();
    form.append('file', file);
    if (siteFilter.site_id) form.append('site_id', String(siteFilter.site_id));
    try {
      const { data } = await api.post<{ created: number; updated: number; total: number }>('/fuel/assignments/import', form);
      toast.success(`Affectation importée : ${data.created} ajoutée(s), ${data.updated} mise(s) à jour.`);
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    } catch (err) {
      toast.error(uploadErrorMessage(err, file), { duration: 8000 });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (!assignments) return <LoadingState rows={6} />;

  const q = search.trim().toUpperCase();
  const filtered = assignments.filter((a) => !q || [a.label, a.code, a.driver_1, a.driver_2, a.replacements].some((v) => v?.toUpperCase().includes(q)));
  const groups = (['camion', 'engin'] as const).map((category) => ({ category, rows: filtered.filter((a) => a.category === category) }));

  return (
    <div className="space-y-4">
      <div className={clsx(card, 'flex flex-wrap items-center gap-2 p-3 animate-fade-up')}>
        <div className="min-w-[220px] flex-1">
          <SearchInput placeholder="Code, chauffeur…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Importer Excel
        </Button>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} /> Ajouter
        </Button>
      </div>
      <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
        Importez la « liste d'affectation » telle quelle : chaque véhicule est mis à jour (ou ajouté) avec ses chauffeurs, sans jamais supprimer ce que vous avez saisi à la main. Un changement de chauffeur pour un seul jour se fait directement dans le rapport du jour.
      </p>

      {assignments.length === 0 ? (
        <div className={card}>
          <EmptyState icon={Users} title="Aucune affectation" message="Importez le fichier « AFFECTATION » du site ou ajoutez les véhicules un par un." />
        </div>
      ) : (
        groups.map(
          ({ category, rows }) =>
            rows.length > 0 && (
              <section key={category} className={clsx(card, 'overflow-hidden animate-fade-up')}>
                <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
                  {category === 'camion' ? <Truck size={17} className="text-blue-500" /> : <Hammer size={17} className="text-purple-500" />}
                  {category === 'camion' ? 'Camions' : 'Engins'}
                  <span className="rounded-full bg-slate-100 px-2 text-xs tabular-nums text-slate-500 dark:bg-slate-800">{rows.length}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                        <th className="px-4 py-2.5 font-medium">Code</th>
                        <th className="px-4 py-2.5 font-medium">Équipe 1</th>
                        <th className="px-4 py-2.5 font-medium">Équipe 2</th>
                        <th className="px-4 py-2.5 font-medium">Remplaçants</th>
                        <th className="px-4 py-2.5 font-medium">Activité par défaut</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {rows.map((a) => (
                        <tr key={a.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-2.5">
                            <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white dark:bg-white dark:text-slate-900">{a.label ?? a.code}</span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{a.driver_1 ?? <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{a.driver_2 ?? <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{a.replacements ?? ''}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{a.activity ?? ''}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right">
                            <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                              <button onClick={() => setEditing(a)} title="Modifier" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                                <Pencil size={15} />
                              </button>
                              <button onClick={() => setDeleting(a)} title="Supprimer" className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ),
        )
      )}

      {editing && <AssignmentFormModal assignment={editing === 'new' ? null : editing} siteFilter={siteFilter} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Supprimer l'affectation"
        message={`Supprimer l'affectation de ${deleting?.label ?? deleting?.code} ? Ses pleins restent dans le rapport, sans chauffeurs par défaut.`}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        onCancel={() => setDeleting(null)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function AssignmentFormModal({ assignment, siteFilter, onClose }: { assignment: FuelAssignment | null; siteFilter: { site_id?: number }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    label: assignment?.label ?? assignment?.code ?? '',
    category: assignment?.category ?? 'camion',
    driver_1: assignment?.driver_1 ?? '',
    driver_2: assignment?.driver_2 ?? '',
    replacements: assignment?.replacements ?? '',
    activity: assignment?.activity ?? '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () => (assignment ? api.put(`/fuel/assignments/${assignment.id}`, { ...siteFilter, ...form }) : api.post('/fuel/assignments', { ...siteFilter, ...form })),
    onSuccess: () => {
      toast.success(assignment ? 'Affectation modifiée.' : 'Affectation ajoutée.');
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={assignment ? `Modifier ${assignment.label ?? assignment.code}` : 'Nouvelle affectation'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Code (tel qu'écrit dans la liste)"
            value={form.label}
            onChange={(e) => {
              const label = e.target.value;
              // An engin code (E…) anywhere in the label makes it an engin, like "480-E49".
              setForm((f) => ({ ...f, label, category: /(^|[^A-Z0-9])E\d+/i.test(label) ? 'engin' : f.category }));
            }}
            required
            autoFocus
            placeholder="ex. D140, 480-E49"
          />
          <SelectField label="Catégorie" value={form.category} onChange={set('category')}>
            <option value="camion">Camion</option>
            <option value="engin">Engin</option>
          </SelectField>
          <TextField label="Équipe 1" value={form.driver_1} onChange={set('driver_1')} />
          <TextField label="Équipe 2" value={form.driver_2} onChange={set('driver_2')} />
          <TextField label="Remplaçants" value={form.replacements} onChange={set('replacements')} />
          <TextField label="Activité par défaut" value={form.activity} onChange={set('activity')} list="fuel-activity-defaults" placeholder="ex. STERILE" />
          <datalist id="fuel-activity-defaults">
            {ACTIVITIES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 size={15} className="animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
