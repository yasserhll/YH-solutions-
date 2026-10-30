import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import {
  Fuel,
  Truck,
  Container,
  Hash,
  Download,
  Upload,
  FileSpreadsheet,
  Droplets,
  Gauge,
  Timer,
  ArrowDownToLine,
  AlertTriangle,
  HelpCircle,
  CircleSlash,
  CheckCircle2,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Eye,
  X,
  MapPin,
  CalendarRange,
  Sparkles,
  PenLine,
  Repeat,
  ClipboardList,
  History,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, apiErrorMessage, downloadFile, uploadErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useSelectableSites } from '../hooks/useReferenceData';
import { useUrlTab } from '../hooks/useUrlTab';
import { useFuelSite } from '../hooks/useFuelSite';
import ReportTab from './ConsommationReportTab';
import type {
  FuelBrand,
  FuelGlobalPage,
  FuelGlobalRow,
  FuelMovement,
  FuelTank,
  FuelTankImportSummary,
  FuelUnit,
  FuelVehicle,
  FuelVehiclesPage,
  Paginated,
} from '../types';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SearchInput } from '../components/ui/SearchInput';
import { Pagination } from '../components/ui/Pagination';
import { EmptyState, LoadingState } from '../components/ui/States';
import { SelectField, TextAreaField, TextField } from '../components/ui/Field';

// ---------------------------------------------------------------- helpers

const TABS = ['Global', 'Citernes', 'Matriculation', 'Rapport'] as const;
type Tab = (typeof TABS)[number];

const intFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

const litres = (n: number) => `${intFmt.format(n)} L`;
const frDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR') : '—');
const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
const pleins = (n: number) => `${intFmt.format(n)} plein${n > 1 ? 's' : ''}`;
const unitLabel = (u: FuelUnit) => (u === 'km' ? 'L/100km' : 'L/h');

const brandLabels: Record<FuelBrand, string> = { sinotruk: 'Sinotruk', man: 'MAN', renault: 'Renault' };
/** Same as FuelVehicle::BRAND_UNITS on the server. */
const brandUnits: Record<FuelBrand, FuelUnit> = { sinotruk: 'h', man: 'km', renault: 'km' };

const CHART_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#14b8a6', '#64748b'];

const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';
const inputClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400';

/** Typing in a search box shouldn't fire one request per keystroke. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function relativeTime(iso: string | null) {
  if (!iso) return 'jamais';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------- page

export default function ConsommationPage() {
  const [tab, setTab] = useUrlTab(TABS, 'Global');
  // Lets "Code inconnu" anywhere jump straight to a pre-filled Matriculation form.
  const [prefillCode, setPrefillCode] = useState<string | null>(null);

  function addMatricule(code: string) {
    setPrefillCode(code);
    setTab('Matriculation');
  }

  const tabIcons: Record<Tab, LucideIcon> = { Global: Sparkles, Citernes: Container, Matriculation: Hash, Rapport: ClipboardList };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-800 to-orange-900 p-6 text-white shadow-lg animate-fade-up dark:from-slate-950 dark:via-slate-900 dark:to-orange-950">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-orange-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <Fuel size={24} className="text-orange-300" />
            </div>
            <div>
              <h1 className="text-xl font-semibold sm:text-2xl">Consommation carburant</h1>
              <p className="text-sm text-slate-300">Importez vos fichiers Excel — le global se construit tout seul, sans aucune saisie.</p>
            </div>
          </div>
          <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-white/10 p-1 ring-1 ring-white/15 backdrop-blur sm:w-auto">
            {TABS.map((t) => {
              const Icon = tabIcons[t];
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all sm:flex-none',
                    tab === t ? 'bg-white text-slate-900 shadow' : 'text-slate-200 hover:bg-white/10',
                  )}
                >
                  <Icon size={16} />
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {tab === 'Global' && <GlobalTab onAddMatricule={addMatricule} />}
      {tab === 'Citernes' && <TanksTab onAddMatricule={addMatricule} />}
      {tab === 'Matriculation' && <VehiclesTab prefillCode={prefillCode} onPrefillConsumed={() => setPrefillCode(null)} />}
      {tab === 'Rapport' && <ReportTab />}
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  gradient,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  gradient: string;
  delay?: number;
}) {
  return (
    <div className={clsx(card, 'group relative overflow-hidden p-4 animate-fade-up transition-shadow hover:shadow-md')} style={{ animationDelay: `${delay}ms` }}>
      <div className={clsx('pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-15 blur-xl transition-opacity group-hover:opacity-25', gradient)} />
      <div className="flex items-start gap-3">
        <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm', gradient)}>
          <Icon size={19} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
          <div className="truncate text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
          {hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, actions, children, className }: { title: string; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx(card, 'animate-fade-up', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
          {Icon && <Icon size={16} className="text-orange-500" />}
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

function CodeChip({ code }: { code: string | null }) {
  if (!code) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  return <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{code}</span>;
}

function ChartTooltip({ active, payload, label, suffix = ' L', labelFormatter }: { active?: boolean; payload?: { value: number; name?: string }[]; label?: string; suffix?: string; labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mb-0.5 font-medium text-slate-500 dark:text-slate-400">{labelFormatter && label ? labelFormatter(label) : label}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {intFmt.format(payload[0].value)}
        {suffix}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Global

type Anomaly = '' | 'negative' | 'no_counter' | 'unknown' | 'transfer';
type Granularity = 'jour' | 'semaine' | 'mois';

function bucketKey(date: string, g: Granularity) {
  if (g === 'mois') return date.slice(0, 7);
  if (g === 'semaine') {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return d.toISOString().slice(0, 10);
  }
  return date;
}

function bucketLabel(key: string, g: Granularity) {
  if (g === 'mois') return new Date(key + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  if (g === 'semaine') return 'Sem. ' + shortDate(key);
  return shortDate(key);
}

function GlobalTab({ onAddMatricule }: { onAddMatricule: (code: string) => void }) {
  const { siteId, siteFilter, ready, sitePicker } = useFuelSite('Global du site :');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tankId, setTankId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [anomaly, setAnomaly] = useState<Anomaly>('');
  const [page, setPage] = useState(1);
  const [granularity, setGranularity] = useState<Granularity>('jour');
  const [exporting, setExporting] = useState(false);
  const [editingRow, setEditingRow] = useState<FuelGlobalRow | 'new' | null>(null);
  const [deletingRow, setDeletingRow] = useState<FuelGlobalRow | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (row: FuelGlobalRow) => api.delete(`/fuel/movements/${row.id}`),
    onSuccess: () => {
      toast.success('Ligne supprimée du global.');
      setDeletingRow(null);
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  useEffect(() => setPage(1), [dateFrom, dateTo, tankId, search, anomaly, siteId]);
  useEffect(() => setTankId(''), [siteId]);

  const filters = { ...siteFilter, date_from: dateFrom || undefined, date_to: dateTo || undefined, tank_id: tankId || undefined };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['fuel', 'global', filters, search, anomaly, page],
    queryFn: () =>
      api.get<FuelGlobalPage>('/fuel/global', { params: { ...filters, search: search || undefined, anomaly: anomaly || undefined, page } }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: ready,
  });

  const { data: tanks } = useQuery({
    queryKey: ['fuel', 'tanks', siteFilter],
    queryFn: () => api.get<FuelTank[]>('/fuel/tanks', { params: siteFilter }).then((r) => r.data),
    enabled: ready,
  });

  const summary = data?.summary;

  const series = useMemo(() => {
    if (!summary) return [];
    const map = new Map<string, number>();
    for (const d of summary.daily) {
      const key = bucketKey(d.date, granularity);
      map.set(key, (map.get(key) ?? 0) + d.litres);
    }
    return [...map.entries()].map(([key, value]) => ({ key, label: bucketLabel(key, granularity), litres: Math.round(value) }));
  }, [summary, granularity]);

  async function exportExcel() {
    setExporting(true);
    try {
      await downloadFile('/fuel/global/export', { ...filters, search: search || undefined, anomaly: anomaly || undefined }, 'global.xlsx');
    } catch (err) {
      toast.error(apiErrorMessage(err, "Échec de l'export."));
    } finally {
      setExporting(false);
    }
  }

  if (!ready || (isLoading && !data)) return <LoadingState rows={8} />;

  if (summary && summary.refuels === 0 && summary.transfers.count === 0 && !dateFrom && !dateTo && !tankId) {
    return (
      <div className="space-y-4">
        {sitePicker}
        <div className={card}>
          <EmptyState
            icon={FileSpreadsheet}
            title={`Aucune donnée pour ${data?.site?.name ?? 'ce site'}`}
            message="Importez les fichiers des citernes de ce site dans l'onglet « Citernes » : le global se construit automatiquement."
          />
        </div>
      </div>
    );
  }

  const anomalyChips: { key: Anomaly; label: string; count: number; icon: LucideIcon; tone: string }[] = summary
    ? [
        { key: 'negative', label: 'Compteur incohérent', count: summary.anomalies.negative, icon: AlertTriangle, tone: 'text-red-600 bg-red-50 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30' },
        { key: 'no_counter', label: 'Sans compteur', count: summary.anomalies.no_counter, icon: CircleSlash, tone: 'text-amber-600 bg-amber-50 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/30' },
        { key: 'unknown', label: 'Code sans matricule', count: summary.anomalies.unknown, icon: HelpCircle, tone: 'text-purple-600 bg-purple-50 ring-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:ring-purple-500/30' },
        { key: 'transfer', label: 'Transferts entre citernes', count: summary.transfers.count, icon: Repeat, tone: 'text-blue-600 bg-blue-50 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/30' },
      ]
    : [];

  return (
    <div className="space-y-6">
      {sitePicker}

      {/* Filters */}
      <div className={clsx(card, 'flex flex-wrap items-center gap-2 p-3 animate-fade-up')}>
        <div className="flex items-center gap-2">
          <CalendarRange size={16} className="text-slate-400" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} aria-label="Du" />
          <span className="text-sm text-slate-400">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} aria-label="Au" />
        </div>
        <select value={tankId} onChange={(e) => setTankId(e.target.value)} className={inputClass}>
          <option value="">Toutes les citernes{data?.site ? ` de ${data.site.name}` : ''}</option>
          {tanks?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="min-w-[200px] flex-1">
          <SearchInput placeholder="Code, matricule, remarque…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        {(dateFrom || dateTo || tankId || searchInput || anomaly) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
              setTankId('');
              setSearchInput('');
              setAnomaly('');
            }}
          >
            <X size={14} /> Réinitialiser
          </Button>
        )}
        <Button variant="secondary" onClick={exportExcel} disabled={exporting}>
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Export Excel
        </Button>
      </div>

      {summary && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Litres distribués"
              value={compactFmt.format(summary.litres_out) + ' L'}
              hint={`${pleins(summary.refuels)} · du ${frDate(summary.date_from)} au ${frDate(summary.date_to)}`}
              icon={Droplets}
              gradient="bg-linear-to-br from-orange-500 to-amber-500"
            />
            <StatCard label="Véhicules & engins" value={intFmt.format(summary.vehicles)} hint="servis sur la période" icon={Truck} gradient="bg-linear-to-br from-blue-500 to-indigo-500" delay={60} />
            <StatCard
              label="Moy. camions"
              value={summary.avg_l_100km !== null ? decFmt.format(summary.avg_l_100km) : '—'}
              hint="L / 100 km (parcours mesurés)"
              icon={Gauge}
              gradient="bg-linear-to-br from-emerald-500 to-teal-500"
              delay={120}
            />
            <StatCard
              label="Moy. engins"
              value={summary.avg_l_h !== null ? decFmt.format(summary.avg_l_h) : '—'}
              hint="L / heure moteur"
              icon={Timer}
              gradient="bg-linear-to-br from-purple-500 to-fuchsia-500"
              delay={180}
            />
            <StatCard
              label="Entrées citernes"
              value={compactFmt.format(summary.litres_in) + ' L'}
              hint={`${compactFmt.format(summary.transfers.litres)} L transférés entre citernes`}
              icon={ArrowDownToLine}
              gradient="bg-linear-to-br from-slate-600 to-slate-800"
              delay={240}
            />
          </div>

          {/* Anomalies */}
          <div className="flex flex-wrap gap-2 animate-fade-up">
            {anomalyChips.map((chip) => (
              <button
                key={chip.key}
                onClick={() => setAnomaly(anomaly === chip.key ? '' : chip.key)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-all',
                  chip.tone,
                  anomaly === chip.key ? 'scale-[1.03] shadow-md ring-2' : 'opacity-90 hover:opacity-100',
                )}
              >
                <chip.icon size={13} />
                {chip.label}
                <span className="rounded-full bg-white/70 px-1.5 tabular-nums dark:bg-black/20">{intFmt.format(chip.count)}</span>
              </button>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel
              title="Litres distribués"
              icon={Droplets}
              className="xl:col-span-2"
              actions={
                <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
                  {(['jour', 'semaine', 'mois'] as Granularity[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={clsx(
                        'rounded-md px-2.5 py-1 font-medium capitalize transition-colors',
                        granularity === g ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400',
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="h-72 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fuelArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-800" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => compactFmt.format(v)} width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="litres" stroke="#f97316" strokeWidth={2.5} fill="url(#fuelArea)" animationDuration={700} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Répartition par citerne" icon={Container}>
              <div className="flex h-72 flex-col p-3">
                <div className="min-h-0 flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={summary.by_tank} dataKey="litres" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={2} stroke="none" animationDuration={700}>
                        {summary.by_tank.map((t, i) => (
                          <Cell key={t.id} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1">
                  {summary.by_tank.map((t, i) => (
                    <div key={t.id} className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{t.name}</span>
                      <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{compactFmt.format(t.litres)} L</span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          <Panel title="Top 10 consommateurs" icon={Truck}>
            <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.top_vehicles} layout="vertical" margin={{ left: 10, right: 16 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="code" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={70} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                    <Bar dataKey="litres" radius={[0, 6, 6, 0]} animationDuration={700}>
                      {summary.top_vehicles.map((v, i) => (
                        <Cell key={v.code} fill={i === 0 ? '#f97316' : i < 3 ? '#fb923c' : '#fdba74'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {summary.top_vehicles.map((v, i) => (
                  <button
                    key={v.code}
                    onClick={() => setSearchInput(v.code)}
                    className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    title="Filtrer le tableau sur ce code"
                  >
                    <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold', i < 3 ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800')}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CodeChip code={v.code} />
                        <span className="truncate text-sm text-slate-700 dark:text-slate-300">{v.matricule ?? <span className="italic text-slate-400">sans matricule</span>}</span>
                      </div>
                      <div className="text-xs text-slate-400">{pleins(v.refuels)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{litres(v.litres)}</div>
                      {v.avg_consumption !== null && (
                        <div className="text-xs tabular-nums text-slate-400">
                          {decFmt.format(v.avg_consumption)} {unitLabel(v.unit)}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        </>
      )}

      {/* Table */}
      <Panel
        title={`Global ${data?.site?.name ?? ''} — détail des sorties`}
        icon={FileSpreadsheet}
        actions={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs text-slate-400">
              {isFetching && <Loader2 size={13} className="animate-spin" />}
              {data ? `${intFmt.format(data.total)} lignes` : ''}
            </span>
            <Button size="sm" onClick={() => setEditingRow('new')} disabled={!tanks?.length}>
              <Plus size={15} /> Ajouter une sortie
            </Button>
          </div>
        }
      >
        <GlobalTable rows={data?.data ?? []} onAddMatricule={onAddMatricule} onEdit={setEditingRow} onDelete={setDeletingRow} />
        {data && <Pagination page={data.current_page} lastPage={data.last_page} total={data.total} onPageChange={setPage} />}
      </Panel>

      {editingRow && tanks && (
        <MovementFormModal row={editingRow === 'new' ? null : editingRow} tanks={tanks} defaultTankId={tankId} truckUnit={data?.site?.truck_unit ?? 'km'} onClose={() => setEditingRow(null)} />
      )}
      <ConfirmDialog
        open={!!deletingRow}
        title="Supprimer la ligne"
        message={
          deletingRow
            ? `Supprimer le plein de ${deletingRow.code} (${litres(deletingRow.quantity)}) du ${frDate(deletingRow.date)} ?` +
              (deletingRow.origin === 'import'
                ? " Il ne reviendra pas si vous réimportez le fichier Excel de la citerne (sauf si la ligne y est modifiée)."
                : '')
            : ''
        }
        onConfirm={() => deletingRow && deleteMutation.mutate(deletingRow)}
        onCancel={() => setDeletingRow(null)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function ConsumptionPill({ row }: { row: FuelGlobalRow }) {
  if (row.is_transfer)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
        <Repeat size={11} /> Transfert
      </span>
    );
  if (row.consumption === null) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  return (
    <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
      {decFmt.format(row.consumption)} <span className="font-normal opacity-70">{unitLabel(row.unit)}</span>
    </span>
  );
}

function OriginBadge({ row }: { row: FuelGlobalRow }) {
  if (row.origin === 'manual')
    return (
      <span title="Ajoutée à la main depuis le global" className="inline-flex items-center gap-0.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
        <PenLine size={9} /> Manuel
      </span>
    );
  if (row.edited)
    return (
      <span title="Ligne importée, corrigée à la main" className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
        <History size={9} /> Modifié
      </span>
    );
  return null;
}

function GlobalTable({
  rows,
  onAddMatricule,
  onEdit,
  onDelete,
}: {
  rows: FuelGlobalRow[];
  onAddMatricule: (code: string) => void;
  onEdit: (row: FuelGlobalRow) => void;
  onDelete: (row: FuelGlobalRow) => void;
}) {
  if (rows.length === 0) return <EmptyState message="Aucune sortie ne correspond à ces filtres." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Code</th>
            <th className="px-4 py-3 font-medium">Immatriculation</th>
            <th className="px-4 py-3 text-right font-medium">Compteur début → fin</th>
            <th className="px-4 py-3 text-right font-medium">Parcours</th>
            <th className="px-4 py-3 text-right font-medium">Litres</th>
            <th className="px-4 py-3 font-medium">Consommation</th>
            <th className="px-4 py-3 font-medium">Affectation</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => {
            const negative = r.distance !== null && r.distance < 0;
            return (
              <tr key={r.id} className={clsx('group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50', negative && 'bg-red-50/60 dark:bg-red-500/5')}>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <div className="font-medium text-slate-800 dark:text-slate-200">{frDate(r.date)}</div>
                  <div className="text-xs text-slate-400">{r.time?.slice(0, 5) ?? ''}</div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    <CodeChip code={r.code} />
                    <OriginBadge row={r} />
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {r.matricule ? (
                    <span className="text-slate-700 dark:text-slate-300">{r.matricule}</span>
                  ) : r.code ? (
                    <button
                      onClick={() => onAddMatricule(r.code!)}
                      className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-600 hover:bg-purple-100 dark:bg-purple-500/10 dark:text-purple-400"
                    >
                      <Plus size={11} /> Ajouter le matricule
                    </button>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">
                  {r.odometer === null ? (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <CircleSlash size={12} /> non saisi
                    </span>
                  ) : (
                    <>
                      {r.previous_odometer !== null ? decFmt.format(r.previous_odometer) : '—'} <span className="text-slate-300">→</span>{' '}
                      <span className="text-slate-800 dark:text-slate-200">{decFmt.format(r.odometer)}</span>
                    </>
                  )}
                </td>
                <td className={clsx('whitespace-nowrap px-4 py-2.5 text-right tabular-nums', negative ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300')}>
                  {r.distance !== null ? (
                    <span className="inline-flex items-center gap-1">
                      {negative && <AlertTriangle size={12} />}
                      {decFmt.format(r.distance)} <span className="text-xs font-normal text-slate-400">{r.unit}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">{intFmt.format(r.quantity)}</td>
                <td className="px-4 py-2.5">
                  <ConsumptionPill row={r} />
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-slate-700 dark:text-slate-300">{r.tank}</div>
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <MapPin size={10} />
                    {r.site}
                    {r.remark && <span className="ml-1 truncate italic">· {r.remark}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                    <button onClick={() => onEdit(r)} title="Modifier" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => onDelete(r)} title="Supprimer" className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Add / correct a SORTIE straight from the Global. Compteur début, Parcours
 * and Consommation are never typed: the server recalculates the chain. The
 * correction survives a re-import of the citerne's Excel file.
 */
function MovementFormModal({ row, tanks, defaultTankId, truckUnit, onClose }: { row: FuelGlobalRow | null; tanks: FuelTank[]; defaultTankId: string; truckUnit: FuelUnit; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fuel_tank_id: String(row?.fuel_tank_id ?? (defaultTankId || tanks[0]?.id || '')),
    date: row?.date ?? today,
    time: row?.time?.slice(0, 5) ?? '',
    vehicle_code: row?.code ?? '',
    odometer: row?.odometer != null ? String(row.odometer) : '',
    quantity: row ? String(row.quantity) : '',
    remark: row?.remark ?? '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const code = form.vehicle_code.trim().toUpperCase();
  // Same rule as FuelVehicle::unitFor() on the server (a D camion follows its site).
  const unit: FuelUnit = row && row.code === code ? row.unit : (/^\d+$/.test(code) ? 'km' : code.startsWith('D') ? truckUnit : 'h');
  const tankLocked = row?.origin === 'import';

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        vehicle_code: code,
        time: form.time || null,
        odometer: form.odometer === '' ? null : Number(form.odometer.replace(',', '.')),
        quantity: Number(form.quantity.replace(',', '.')),
        remark: form.remark.trim() || null,
      };
      return row ? api.put(`/fuel/movements/${row.id}`, payload) : api.post('/fuel/movements', payload);
    },
    onSuccess: () => {
      toast.success(row ? 'Ligne modifiée — consommations recalculées.' : 'Sortie ajoutée au global.');
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={row ? `Modifier le plein ${row.code ?? ''} du ${frDate(row.date)}` : 'Ajouter une sortie au global'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField label="Citerne" value={form.fuel_tank_id} onChange={set('fuel_tank_id')} required disabled={tankLocked}>
            {tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <TextField label="Date" type="date" value={form.date} onChange={set('date')} required max={today} />
          <TextField label="Heure" type="time" value={form.time} onChange={set('time')} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField
            label="Code véhicule"
            value={form.vehicle_code}
            onChange={(e) => setForm((f) => ({ ...f, vehicle_code: e.target.value.toUpperCase() }))}
            required
            autoFocus={!row}
            placeholder="ex. D244, E81, 85751"
          />
          <TextField
            label={`Compteur fin (${unit === 'km' ? 'km' : 'heures'})`}
            inputMode="decimal"
            value={form.odometer}
            onChange={set('odometer')}
            placeholder="vide si non relevé"
          />
          <TextField label="Litres" inputMode="decimal" value={form.quantity} onChange={set('quantity')} required placeholder="ex. 220" />
        </div>
        <TextAreaField label="Remarque" value={form.remark} onChange={set('remark')} rows={2} maxLength={255} />
        <div className="flex gap-2 rounded-xl bg-sky-50 p-3 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
          <Sparkles size={14} className="mt-0.5 shrink-0" />
          <span>
            Compteur début, parcours et consommation se recalculent automatiquement. Cette correction est conservée même si vous réimportez le
            fichier Excel de la citerne.
          </span>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 size={15} className="animate-spin" />}
            {row ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Citernes

type UploadItem = {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
  progress: number;
  result?: FuelTankImportSummary[];
  error?: string;
};

function TanksTab({ onAddMatricule }: { onAddMatricule: (code: string) => void }) {
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();
  const { sites, needsSiteSelect } = useSelectableSites();
  const [siteId, setSiteId] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [viewTank, setViewTank] = useState<FuelTank | null>(null);
  const [deleteTank, setDeleteTank] = useState<FuelTank | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = uploads.some((u) => u.status === 'uploading' || u.status === 'processing' || u.status === 'pending');

  const { data: tanks, isLoading, isError, refetch } = useQuery({
    queryKey: ['fuel', 'tanks', siteParams],
    queryFn: () => api.get<FuelTank[]>('/fuel/tanks', { params: siteParams }).then((r) => r.data),
  });

  // Pre-select the site the user is currently filtering on, if any.
  useEffect(() => {
    if (!siteId && siteParams.site_id) setSiteId(String(siteParams.site_id));
  }, [siteParams.site_id, siteId]);

  const deleteMutation = useMutation({
    mutationFn: (tank: FuelTank) => api.delete(`/fuel/tanks/${tank.id}`),
    onSuccess: () => {
      toast.success('Citerne supprimée.');
      setDeleteTank(null);
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  function patch(id: string, changes: Partial<UploadItem>) {
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = [...fileList].filter((f) => f.name.toLowerCase().endsWith('.xlsx'));
    if (files.length === 0) {
      toast.error('Seuls les fichiers Excel (.xlsx) sont acceptés.');
      return;
    }
    if (needsSiteSelect && !siteId) {
      toast.error("Choisissez d'abord le site des citernes.");
      return;
    }
    const items: UploadItem[] = files.map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file, status: 'pending', progress: 0 }));
    setUploads((list) => [...items, ...list]);

    // One at a time: each import recomputes the whole global, so running
    // them in parallel would only make them wait on each other.
    for (const item of items) {
      patch(item.id, { status: 'uploading' });
      const form = new FormData();
      form.append('file', item.file);
      if (needsSiteSelect) form.append('site_id', siteId);
      try {
        const { data } = await api.post<{ tanks: FuelTankImportSummary[] }>('/fuel/tanks/import', form, {
          onUploadProgress: (e) => {
            const progress = e.total ? Math.round((e.loaded / e.total) * 100) : 50;
            patch(item.id, { progress, status: progress >= 100 ? 'processing' : 'uploading' });
          },
        });
        patch(item.id, { status: 'done', progress: 100, result: data.tanks });
        toast.success(`${item.file.name} importé`);
      } catch (err) {
        patch(item.id, { status: 'error', error: uploadErrorMessage(err, item.file) });
      }
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    }
  }

  return (
    <div className="space-y-6">
      {/* Dropzone */}
      <div className={clsx(card, 'p-5 animate-fade-up')}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <Upload size={16} className="text-orange-500" /> Importer / mettre à jour des citernes
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Déposez vos fichiers Excel tels quels (ex. « Citerne louta 1.xlsx », « mobile 1.xlsx »). Chaque feuille devient une citerne ; réimporter un fichier met à jour ses données.
            </p>
          </div>
          {needsSiteSelect && (
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={clsx(inputClass, !siteId && 'ring-2 ring-orange-400/60')}>
              <option value="">— Site des citernes —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={clsx(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-all',
            dragging
              ? 'scale-[1.01] border-orange-400 bg-orange-50 dark:bg-orange-500/10'
              : 'border-slate-200 hover:border-orange-300 hover:bg-orange-50/40 dark:border-slate-700 dark:hover:border-orange-500/50 dark:hover:bg-orange-500/5',
          )}
        >
          <div className={clsx('flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-orange-500 to-amber-500 text-white shadow-lg transition-transform', dragging && 'scale-110 rotate-3')}>
            {busy ? <Loader2 size={26} className="animate-spin" /> : <FileSpreadsheet size={26} />}
          </div>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{dragging ? 'Relâchez pour importer' : 'Glissez vos fichiers .xlsx ici ou cliquez pour parcourir'}</div>
          <div className="text-xs text-slate-400">Plusieurs fichiers à la fois · jusqu'à 40 Mo chacun</div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {uploads.length > 0 && (
          <div className="mt-4 space-y-2">
            {uploads.map((u) => (
              <UploadRow key={u.id} item={u} onAddMatricule={onAddMatricule} onDismiss={() => setUploads((l) => l.filter((x) => x.id !== u.id))} />
            ))}
          </div>
        )}
      </div>

      {/* Tank cards */}
      {isLoading ? (
        <LoadingState rows={4} />
      ) : isError ? (
        <div className={clsx(card, 'flex flex-col items-center gap-3 p-8 text-center')}>
          <AlertTriangle size={28} className="text-red-500" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            La liste des citernes n'a pas pu être chargée depuis le serveur. Lancez « php artisan consommation:diagnostic » sur le serveur et regardez
            storage/logs/laravel.log.
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Réessayer
          </Button>
        </div>
      ) : !tanks?.length ? (
        <div className={card}>
          <EmptyState icon={Container} title="Aucune citerne" message="Importez un premier fichier ci-dessus pour créer vos citernes." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tanks.map((tank, i) => (
            <TankCard key={tank.id} tank={tank} index={i} onView={() => setViewTank(tank)} onDelete={() => setDeleteTank(tank)} />
          ))}
        </div>
      )}

      <TankMovementsModal tank={viewTank} onClose={() => setViewTank(null)} />
      <ConfirmDialog
        open={!!deleteTank}
        title="Supprimer la citerne"
        message={`Supprimer « ${deleteTank?.name} » et toutes ses lignes importées ? Le global sera recalculé. Vous pourrez la réimporter à tout moment.`}
        onConfirm={() => deleteTank && deleteMutation.mutate(deleteTank)}
        onCancel={() => setDeleteTank(null)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function UploadRow({ item, onAddMatricule, onDismiss }: { item: UploadItem; onAddMatricule: (code: string) => void; onDismiss: () => void }) {
  const statusText = {
    pending: 'En attente…',
    uploading: `Envoi… ${item.progress}%`,
    processing: 'Analyse et calcul du global…',
    done: 'Importé',
    error: 'Erreur',
  }[item.status];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 animate-fade-up dark:border-slate-800 dark:bg-slate-800/40">
      <div className="flex items-center gap-3 px-4 py-3">
        {item.status === 'done' ? (
          <CheckCircle2 size={20} className="shrink-0 text-emerald-500" />
        ) : item.status === 'error' ? (
          <AlertTriangle size={20} className="shrink-0 text-red-500" />
        ) : (
          <Loader2 size={20} className="shrink-0 animate-spin text-orange-500" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{item.file.name}</div>
          <div className={clsx('text-xs', item.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400')}>{item.error ?? statusText}</div>
        </div>
        {(item.status === 'done' || item.status === 'error') && (
          <button onClick={onDismiss} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Fermer">
            <X size={15} />
          </button>
        )}
      </div>
      {item.status !== 'done' && item.status !== 'error' && (
        <div className="h-1 bg-slate-200 dark:bg-slate-700">
          <div
            className={clsx('h-full bg-linear-to-r from-orange-500 to-amber-400 transition-all duration-300', item.status === 'processing' && 'animate-pulse')}
            style={{ width: `${item.status === 'processing' ? 100 : item.progress}%` }}
          />
        </div>
      )}
      {item.result?.map((s) => (
        <div key={s.tank_id} className="border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200">{s.tank}</span>
            <span className={clsx('rounded-full px-2 py-0.5 font-medium', s.created ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400')}>
              {s.created ? 'Nouvelle citerne' : `Mise à jour (${intFmt.format(s.previous_rows)} → ${intFmt.format(s.rows)} lignes)`}
            </span>
            <span className="text-slate-400">
              {frDate(s.date_from)} → {frDate(s.date_to)}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-600 dark:text-slate-300">
            <span>
              <b className="tabular-nums">{intFmt.format(s.exits)}</b> sorties · {litres(s.litres_out)}
            </span>
            <span>
              <b className="tabular-nums">{intFmt.format(s.entries)}</b> entrées · {litres(s.litres_in)}
            </span>
            {s.skipped > 0 && <span className="text-amber-600 dark:text-amber-400">{s.skipped} ligne(s) ignorée(s) : date illisible</span>}
            {s.kept_edits > 0 && <span className="text-sky-600 dark:text-sky-400">{s.kept_edits} correction(s) du global conservée(s)</span>}
          </div>
          {s.unknown_codes.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-purple-600 dark:text-purple-400">Codes sans matricule :</span>
              {s.unknown_codes.slice(0, 12).map((code) => (
                <button key={code} onClick={() => onAddMatricule(code)} className="rounded-md bg-purple-50 px-1.5 py-0.5 font-mono text-purple-700 hover:bg-purple-100 dark:bg-purple-500/10 dark:text-purple-300">
                  {code}
                </button>
              ))}
              {s.unknown_codes.length > 12 && <span className="text-slate-400">+{s.unknown_codes.length - 12}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TankCard({ tank, index, onView, onDelete }: { tank: FuelTank; index: number; onView: () => void; onDelete: () => void }) {
  const isMobile = /^\d/.test(tank.name);
  const gradientId = `spark-${tank.id}`;
  return (
    <div className={clsx(card, 'group flex flex-col overflow-hidden animate-fade-up transition-all hover:-translate-y-0.5 hover:shadow-lg')} style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex items-start gap-3 p-4">
        <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm', isMobile ? 'bg-linear-to-br from-blue-500 to-indigo-500' : 'bg-linear-to-br from-orange-500 to-amber-500')}>
          {isMobile ? <Truck size={20} /> : <Container size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{tank.name}</div>
          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <MapPin size={11} /> {tank.site.name} · {isMobile ? 'Citerne mobile' : 'Citerne fixe'}
          </div>
          {(tank.line_sites ?? []).length > 0 && (
            <div
              className="mt-1 inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-500/10 dark:text-red-400"
              title="La citerne et ses lignes ne sont pas rattachées au même site. Sur le serveur : php artisan consommation:diagnostic --reparer-sites"
            >
              <AlertTriangle size={11} /> Lignes rattachées à {tank.line_sites.map((s) => s.name).join(', ')}
            </div>
          )}
        </div>
        <div className="flex gap-1 opacity-60 transition-opacity group-hover:opacity-100">
          <button onClick={onView} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Voir les lignes">
            <Eye size={16} />
          </button>
          <button onClick={onDelete} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title="Supprimer">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="h-16 px-1">
        {tank.spark.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tank.spark}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isMobile ? '#6366f1' : '#f97316'} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={isMobile ? '#6366f1' : '#f97316'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip content={<ChartTooltip labelFormatter={shortDate} />} />
              <XAxis dataKey="date" hide />
              <Area type="monotone" dataKey="litres" stroke={isMobile ? '#6366f1' : '#f97316'} strokeWidth={2} fill={`url(#${gradientId})`} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-300 dark:text-slate-600">Pas d'activité récente</div>
        )}
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 text-center dark:divide-slate-800 dark:border-slate-800">
        <div className="px-2 py-3">
          <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{compactFmt.format(tank.litres_out)} L</div>
          <div className="text-[11px] text-slate-400">{intFmt.format(tank.exits)} sorties</div>
        </div>
        <div className="px-2 py-3">
          <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{compactFmt.format(tank.litres_in)} L</div>
          <div className="text-[11px] text-slate-400">{intFmt.format(tank.entries)} entrées</div>
        </div>
        <div className="px-2 py-3">
          <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{intFmt.format(tank.vehicles)}</div>
          <div className="text-[11px] text-slate-400">véhicules</div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 bg-slate-50 px-4 py-2 text-[11px] text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
        <span className="truncate" title={tank.last_import_file ?? ''}>
          <FileSpreadsheet size={11} className="mr-1 inline" />
          {tank.last_import_file ?? '—'}
        </span>
        <span className="shrink-0">MAJ {relativeTime(tank.last_imported_at)}</span>
      </div>
    </div>
  );
}

function TankMovementsModal({ tank, onClose }: { tank: FuelTank | null; onClose: () => void }) {
  const [type, setType] = useState<'' | 'entry' | 'exit'>('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [type, search, tank?.id]);

  const { data, isFetching } = useQuery({
    queryKey: ['fuel', 'movements', tank?.id, type, search, page],
    queryFn: () =>
      api
        .get<Paginated<FuelMovement>>('/fuel/movements', { params: { tank_id: tank!.id, type: type || undefined, search: search || undefined, page } })
        .then((r) => r.data),
    enabled: !!tank,
    placeholderData: keepPreviousData,
  });

  return (
    <Modal open={!!tank} onClose={onClose} title={`Citerne ${tank?.name ?? ''} — lignes importées`} size="lg">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
          {(
            [
              ['', 'Tout'],
              ['exit', 'Sorties'],
              ['entry', 'Entrées'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setType(value)}
              className={clsx('rounded-md px-3 py-1 font-medium', type === value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1">
          <SearchInput placeholder="Code, matricule, n° de bon, fournisseur…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        {isFetching && <Loader2 size={16} className="animate-spin text-slate-400" />}
      </div>
      {!data ? (
        <LoadingState />
      ) : data.data.length === 0 ? (
        <EmptyState message="Aucune ligne." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">N° bon</th>
                <th className="px-3 py-2 font-medium">Code / Fournisseur</th>
                <th className="px-3 py-2 text-right font-medium">Kilométrage</th>
                <th className="px-3 py-2 text-right font-medium">Qté</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.data.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700 dark:text-slate-300">
                    {frDate(m.date)} <span className="text-xs text-slate-400">{m.time?.slice(0, 5)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', m.type === 'entry' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400')}>
                      {m.type === 'entry' ? 'Entrée' : 'Sortie'}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{m.bon_number ?? '—'}</td>
                  <td className="px-3 py-2">
                    {m.type === 'entry' ? (
                      <span className="text-slate-700 dark:text-slate-300">{m.supplier ?? '—'}</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <CodeChip code={m.vehicle_code} />
                        <span className="text-xs text-slate-500">{m.matricule}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{m.odometer !== null ? decFmt.format(m.odometer) : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">{intFmt.format(m.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={data.current_page} lastPage={data.last_page} total={data.total} onPageChange={setPage} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Matriculation

function VehiclesTab({ prefillCode, onPrefillConsumed }: { prefillCode: string | null; onPrefillConsumed: () => void }) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<FuelVehicle | { code: string } | null>(null);
  const [deleting, setDeleting] = useState<FuelVehicle | null>(null);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPage(1), [search]);

  useEffect(() => {
    if (prefillCode) {
      setEditing({ code: prefillCode });
      onPrefillConsumed();
    }
  }, [prefillCode, onPrefillConsumed]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['fuel', 'vehicles', search, page],
    queryFn: () => api.get<FuelVehiclesPage>('/fuel/vehicles', { params: { search: search || undefined, page } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const deleteMutation = useMutation({
    mutationFn: (v: FuelVehicle) => api.delete(`/fuel/vehicles/${v.id}`),
    onSuccess: () => {
      toast.success('Matricule supprimé.');
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  async function importFile(file: File) {
    setImporting(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const { data: r } = await api.post<{ created: number; updated: number; total: number }>('/fuel/vehicles/import', form);
      toast.success(`${r.total} matricules lus : ${r.created} ajoutés, ${r.updated} mis à jour.`, { duration: 5000 });
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    } catch (err) {
      toast.error(uploadErrorMessage(err, file), { duration: 8000 });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {data && data.unknown_codes.length > 0 && (
        <div className="rounded-2xl border border-purple-200 bg-linear-to-br from-purple-50 to-white p-4 animate-fade-up dark:border-purple-500/30 dark:from-purple-500/10 dark:to-slate-900">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-purple-800 dark:text-purple-300">
            <HelpCircle size={16} />
            {data.unknown_codes.length} code(s) utilisés à la pompe sans matricule
          </div>
          <p className="mb-3 text-xs text-purple-700/80 dark:text-purple-300/70">Cliquez sur un code pour lui attribuer un matricule — le global se met à jour instantanément.</p>
          <div className="flex flex-wrap gap-1.5">
            {data.unknown_codes.map((u) => (
              <button
                key={u.code}
                onClick={() => setEditing({ code: u.code })}
                className="group flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-xs shadow-sm ring-1 ring-purple-200 transition-all hover:-translate-y-0.5 hover:shadow dark:bg-slate-800 dark:ring-purple-500/30"
              >
                <span className="font-mono font-semibold text-purple-700 dark:text-purple-300">{u.code}</span>
                <span className="text-slate-400">{pleins(u.refuels)}</span>
                <Plus size={12} className="text-purple-500 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      )}

      <Panel
        title={`Matriculation${data ? ` · ${intFmt.format(data.total_vehicles)} véhicules` : ''}`}
        icon={Hash}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isFetching && <Loader2 size={14} className="animate-spin text-slate-400" />}
            <div className="w-56">
              <SearchInput placeholder="Code, matricule, type…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Importer Excel
            </Button>
            <Button size="sm" onClick={() => setEditing({ code: '' })}>
              <Plus size={14} /> Ajouter
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile(f);
                e.target.value = '';
              }}
            />
          </div>
        }
      >
        {isLoading ? (
          <LoadingState />
        ) : !data?.data.length ? (
          <EmptyState icon={Hash} title="Aucun matricule" message={search ? 'Aucun résultat pour cette recherche.' : 'Importez « matriculation.xlsx » ou ajoutez un véhicule manuellement.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="px-5 py-3 font-medium">Code</th>
                  <th className="px-5 py-3 font-medium">Matricule / désignation</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Marque</th>
                  <th className="px-5 py-3 font-medium">Compteur</th>
                  <th className="w-24 px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((v) => (
                  <tr key={v.id} className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-5 py-2.5">
                      <CodeChip code={v.code} />
                    </td>
                    <td className="px-5 py-2.5 font-medium text-slate-800 dark:text-slate-200">{v.matricule ?? '—'}</td>
                    <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400">{v.type ?? '—'}</td>
                    <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400">{v.brand ? brandLabels[v.brand] : '—'}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                      {v.unit || v.brand ? ((v.unit ?? brandUnits[v.brand!]) === 'km' ? 'Kilométrique' : 'Horaire') : /^\d+$/.test(v.code) ? 'Kilométrique' : v.code.startsWith('D') ? 'Selon le site' : 'Horaire'}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1 opacity-50 transition-opacity group-hover:opacity-100">
                        <button onClick={() => setEditing(v)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Modifier">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => setDeleting(v)} className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title="Supprimer">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.current_page} lastPage={data.last_page} total={data.total} onPageChange={setPage} />}
      </Panel>

      {editing && <VehicleFormModal vehicle={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le matricule"
        message={`Supprimer le code ${deleting?.code} ? Ses pleins resteront dans le global, sans immatriculation.`}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        onCancel={() => setDeleting(null)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function VehicleFormModal({ vehicle, onClose }: { vehicle: FuelVehicle | { code: string }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const existing = 'id' in vehicle ? vehicle : null;
  const [form, setForm] = useState({ code: vehicle.code, matricule: existing?.matricule ?? '', type: existing?.type ?? '', brand: existing?.brand ?? '', unit: existing?.unit ?? '' });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, brand: form.brand || null, unit: form.unit || null };
      return existing ? api.put(`/fuel/vehicles/${existing.id}`, payload) : api.post('/fuel/vehicles', payload);
    },
    onSuccess: () => {
      toast.success(existing ? 'Matricule modifié.' : 'Matricule ajouté.');
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={existing ? `Modifier ${existing.code}` : 'Nouveau matricule'} size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <TextField label="Code (saisi à la pompe)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required autoFocus={!form.code} placeholder="ex. E81, 85751" />
        <TextField label="Matricule / désignation" value={form.matricule} onChange={(e) => setForm({ ...form, matricule: e.target.value })} required autoFocus={!!form.code} placeholder="ex. 85751A55, PELLE 153" />
        <SelectField label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="">—</option>
          <option value="Camion">Camion</option>
          <option value="Engin">Engin</option>
          <option value="Véhicule léger">Véhicule léger</option>
          <option value="Groupe électrogène">Groupe électrogène</option>
          <option value="Citerne">Citerne (transfert)</option>
        </SelectField>
        <SelectField label="Marque (camions)" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value as FuelBrand | '' })}>
          <option value="">Par défaut du site (Louta : Sinotruk, autres sites : MAN)</option>
          <option value="sinotruk">Sinotruk — heures (L/h)</option>
          <option value="man">MAN — km (L/100 km)</option>
          <option value="renault">Renault — km (L/100 km)</option>
        </SelectField>
        <SelectField label="Compteur" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as FuelUnit | '' })}>
          <option value="">Automatique (selon la marque)</option>
          <option value="h">Heures (L/h)</option>
          <option value="km">Kilomètres (L/100 km)</option>
        </SelectField>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Un camion Sinotruk se calcule à l'heure (litres / heures), un MAN ou Renault au kilomètre (litres / km × 100). Les engins E… sont toujours à l'heure. Sans marque, un camion D… prend la marque par défaut de son site : Sinotruk à Louta, MAN sur les autres sites. La marque se modifie aussi depuis Rapport → Affectation. « Compteur » force une exception (ex. camion d'arrosage au km). Le type « Citerne » marque ses pleins comme des transferts.
        </p>
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
