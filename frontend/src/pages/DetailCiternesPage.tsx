import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight, Container, Download, Gauge, Loader2, Paperclip, ReceiptText, Search, Truck, X } from 'lucide-react';
import { api, apiErrorMessage, downloadFile } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useIsPhone } from '../hooks/useIsPhone';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { Pagination } from '../components/ui/Pagination';
import { EmptyState, LoadingState } from '../components/ui/States';

/*
 * "Détail citernes": each citerne line by line, laid out exactly like its
 * Excel sheet (Date | ENTREE Qte, Fournisseur | SORTIES N° de bon … Remarque
 * | SERIE DEPART | SERIE FIN), with the export that rebuilds that sheet.
 * Lines come from the same data as the Global: imports, bons typed by the
 * pompistes (tag "Bon") and lines added by hand.
 */

interface DetailTank {
  id: number;
  name: string;
  site: { id: number; name: string } | null;
  litres_in: number;
  litres_out: number;
  entries: number;
  exits: number;
  bons: number;
  date_from: string | null;
  date_to: string | null;
  last_serie: number | null;
}

interface DetailLine {
  id: number;
  entry_id?: number;
  date: string;
  time: string | null;
  entry_qty: number | null;
  supplier: string | null;
  bon_number: string | null;
  code: string | null;
  matricule: string | null;
  odometer: number | null;
  exit_qty: number | null;
  remark: string | null;
  serie_start: number | null;
  serie_end: number | null;
  origin: 'import' | 'manual' | 'bon';
  attachments_count: number;
}

interface DetailPage {
  data: DetailLine[];
  current_page: number;
  last_page: number;
  total: number;
  totals: { litres_in: number; litres_out: number; entries: number; exits: number };
}

const STORAGE_KEY = 'detail-citerne';
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const n0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '' : nf.format(v));
const fmtDate = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${Number(day)}/${Number(m)}/${y}`;
};

function readStored(): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export default function DetailCiternesPage() {
  const siteParams = useSiteParams();
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'' | 'entry' | 'exit'>('');
  const [page, setPage] = useState<number | 'last'>('last');
  const [exporting, setExporting] = useState(false);

  const tanksQuery = useQuery({
    queryKey: ['citerne-detail-tanks', siteParams],
    queryFn: () => api.get<DetailTank[]>('/citernes/detail/tanks', { params: siteParams }).then((r) => r.data),
  });
  const tanks = useMemo(() => tanksQuery.data ?? [], [tanksQuery.data]);

  const wanted = Number(params.get('citerne')) || readStored();
  const tank = tanks.find((t) => t.id === wanted) ?? tanks[0] ?? null;

  useEffect(() => {
    if (!tank) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(tank.id));
    } catch {
      /* private mode */
    }
  }, [tank]);

  const pick = (id: number) => {
    setParams((p) => {
      p.set('citerne', String(id));
      return p;
    }, { replace: true });
    setPage('last');
  };

  const filters = { fuel_tank_id: tank?.id, date_from: dateFrom || undefined, date_to: dateTo || undefined, search: search || undefined, type: type || undefined };

  const linesQuery = useQuery({
    queryKey: ['citerne-detail', filters, page],
    queryFn: () => api.get<DetailPage>('/citernes/detail', { params: { ...filters, page, per_page: 100 } }).then((r) => r.data),
    enabled: !!tank && !phone,
    placeholderData: (prev) => prev,
  });
  const data = linesQuery.data;

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage('last');
  };

  const exportExcel = async () => {
    if (!tank) return;
    setExporting(true);
    try {
      await downloadFile('/citernes/detail/export', filters, `citerne-${tank.name}.xlsx`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "L'export a échoué."));
    } finally {
      setExporting(false);
    }
  };

  // Several sites in scope (SuperAdmin, multi-site responsable): group the pills by site.
  const bySite = useMemo(() => {
    const groups = new Map<string, DetailTank[]>();
    tanks.forEach((t) => groups.set(t.site?.name ?? '—', [...(groups.get(t.site?.name ?? '—') ?? []), t]));
    return [...groups.entries()];
  }, [tanks]);

  if (phone) return <PhoneDetail tanks={tanks} tank={tank} loading={tanksQuery.isLoading} onPick={pick} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Détail citernes"
        description="Chaque citerne ligne par ligne, comme son fichier Excel."
        actions={
          <Button onClick={exportExcel} disabled={!tank || exporting}>
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export Excel
          </Button>
        }
      />

      {tanksQuery.isLoading ? (
        <LoadingState />
      ) : tanks.length === 0 ? (
        <EmptyState message="Aucune citerne sur vos sites." />
      ) : (
        <>
          <div className="space-y-2">
            {bySite.map(([site, list]) => (
              <div key={site} className="flex flex-wrap items-center gap-2">
                {bySite.length > 1 && <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{site}</span>}
                {list.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => pick(t.id)}
                    className={clsx(
                      'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                      t.id === tank?.id
                        ? 'border-orange-500 bg-orange-500 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-orange-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-orange-500/50',
                    )}
                  >
                    <Container size={14} /> {t.name}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {tank && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Citerne" value={tank.name} sub={tank.site?.name} />
              <Stat label="Total entrées" value={`${nf.format(data?.totals.litres_in ?? tank.litres_in)} L`} sub={`${data?.totals.entries ?? tank.entries} livraison(s)`} tone="blue" />
              <Stat label="Total sorties" value={`${nf.format(data?.totals.litres_out ?? tank.litres_out)} L`} sub={`${data?.totals.exits ?? tank.exits} bon(s)`} tone="green" />
              <Stat label="Série actuelle" value={tank.last_serie === null ? '—' : nf.format(tank.last_serie)} sub={tank.bons ? `${tank.bons} bon(s) saisi(s) dans l'app` : undefined} />
              <Stat label="Période" value={tank.date_from ? `Du ${fmtDate(tank.date_from)}` : '—'} sub={tank.date_to ? `au ${fmtDate(tank.date_to)}` : undefined} className="col-span-2 lg:col-span-1" />
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <SearchInput placeholder="N° de bon, code, immatriculation, fournisseur…" value={search} onChange={(e) => resetPage(setSearch)(e.target.value)} />
            </div>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Du
              <input type="date" value={dateFrom} onChange={(e) => resetPage(setDateFrom)(e.target.value)} className={inputCls} />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Au
              <input type="date" value={dateTo} onChange={(e) => resetPage(setDateTo)(e.target.value)} className={inputCls} />
            </label>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm dark:border-slate-800 dark:bg-slate-900">
              {([['', 'Tout'], ['entry', 'Entrées'], ['exit', 'Sorties']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => resetPage(setType)(v)}
                  className={clsx('rounded-md px-3 py-1.5', type === v ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 dark:text-slate-400')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="relative overflow-x-auto">
              {linesQuery.isFetching && <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-orange-500" />}
              <table className="w-full min-w-[1180px] border-collapse text-[13px]" style={{ fontFamily: '"Century Gothic", "Avenir Next", system-ui, sans-serif' }}>
                <thead className="text-[12px] font-bold text-[#1F3864] dark:text-blue-200">
                  <tr>
                    <th className={th} />
                    <th className={clsx(th, blue)} colSpan={2}>ENTREE</th>
                    <th className={clsx(th, blue)} colSpan={7}>SORTIES</th>
                    <th className={clsx(th, blue)} rowSpan={2}>SERIE DEPART</th>
                    <th className={clsx(th, blue)} rowSpan={2}>SERIE FIN</th>
                  </tr>
                  <tr>
                    <th className={clsx(th, blue)}>Date</th>
                    {['Qte', 'Fournisseur', 'N° DE BON', 'Heure', 'Code', 'Immatriculation', 'Kilometrage', 'Qte', 'Remarque'].map((h, i) => (
                      <th key={i} className={clsx(th, green)}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-slate-800 dark:text-slate-200">
                  {data?.data.map((l) => (
                    <tr key={`${l.id}-${l.entry_id ?? ''}`} className={clsx('hover:bg-orange-50/60 dark:hover:bg-slate-800/60', l.entry_qty !== null && 'bg-sky-50/70 dark:bg-sky-500/5')}>
                      <td className={clsx(td, 'text-[#3A3838] dark:text-slate-300')}>{fmtDate(l.date)}</td>
                      <td className={clsx(td, 'text-left font-semibold text-sky-700 dark:text-sky-400')}>{fmt(l.entry_qty)}</td>
                      <td className={clsx(td, 'text-left')}>{l.supplier}</td>
                      <td className={td}>
                        <span className="inline-flex items-center gap-1">
                          {l.bon_number}
                          {l.origin === 'bon' && (
                            <span title={`Bon saisi dans l'app · ${l.attachments_count} photo(s)`} className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1 text-[10px] font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">
                              <ReceiptText size={10} /> Bon{l.attachments_count > 0 && <Paperclip size={9} />}
                            </span>
                          )}
                          {l.origin === 'manual' && <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">Manuel</span>}
                        </span>
                      </td>
                      <td className={clsx(td, 'tabular-nums')}>{l.time ?? ''}</td>
                      <td className={clsx(td, 'font-medium')}>{l.code}</td>
                      <td className={clsx(td, 'text-[#3A3838] dark:text-slate-300')}>{l.matricule}</td>
                      <td className={clsx(td, 'tabular-nums')}>{fmt(l.odometer)}</td>
                      <td className={clsx(td, 'font-semibold tabular-nums')}>{fmt(l.exit_qty)}</td>
                      <td className={clsx(td, 'max-w-[260px] truncate')} title={l.remark ?? undefined}>{l.remark}</td>
                      <td className={clsx(td, 'tabular-nums text-[#3A3838] dark:text-slate-300')}>{l.serie_start === null ? '' : n0.format(l.serie_start)}</td>
                      <td className={clsx(td, 'tabular-nums text-[#3A3838] dark:text-slate-300')}>{l.serie_end === null ? '' : n0.format(l.serie_end)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data && data.data.length === 0 && <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Aucune ligne pour ces filtres.</div>}
              {!data && linesQuery.isLoading && <LoadingState />}
            </div>
            {data && <Pagination page={data.current_page} lastPage={data.last_page} total={data.total} onPageChange={setPage} />}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Les lignes suivent l'ordre du fichier (jour par jour, série de la pompe). La dernière page s'ouvre en premier. L'export reprend les filtres affichés.
          </p>
        </>
      )}
    </div>
  );
}

const th = 'border border-slate-300 px-2 py-1.5 text-center align-middle dark:border-slate-700';
const blue = 'bg-[#DBE9F7] dark:bg-blue-500/15';
const green = 'bg-[#D9F2D0] dark:bg-emerald-500/15';
const td = 'whitespace-nowrap border border-slate-200 px-2 py-1 text-center dark:border-slate-800';
const inputCls =
  'mt-0.5 block rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';

function Stat({ label, value, sub, tone, className }: { label: string; value: string; sub?: string; tone?: 'blue' | 'green'; className?: string }) {
  return (
    <div className={clsx('rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900', className)}>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={clsx('mt-0.5 truncate text-lg font-bold', tone === 'blue' ? 'text-sky-700 dark:text-sky-400' : tone === 'green' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100')}>{value}</div>
      {sub && <div className="truncate text-xs text-slate-400 dark:text-slate-500">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Phone: one day at a time, each line as a big card, one big download.      */
/* ------------------------------------------------------------------------- */

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoDay(new Date());
const shiftDay = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + days));
};
const dayLabel = (iso: string) => {
  if (iso === todayIso()) return "Aujourd'hui";
  if (iso === shiftDay(todayIso(), -1)) return 'Hier';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

function PhoneDetail({
  tanks,
  tank,
  loading,
  onPick,
}: {
  tanks: DetailTank[];
  tank: DetailTank | null;
  loading: boolean;
  onPick: (id: number) => void;
}) {
  const [day, setDay] = useState(todayIso());
  const [type, setType] = useState<'' | 'entry' | 'exit'>('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  // Open each citerne on its last day with lines (often yesterday or today).
  const tankId = tank?.id;
  const lastDay = tank?.date_to ?? null;
  useEffect(() => {
    setDay(lastDay ?? todayIso());
    setSearch('');
  }, [tankId, lastDay]);

  const searching = search.trim() !== '';
  const params = {
    fuel_tank_id: tankId,
    type: type || undefined,
    ...(searching ? { search: search.trim(), page: 'last', per_page: 100 } : { date_from: day, date_to: day, page: 1, per_page: 500 }),
  };
  const query = useQuery({
    queryKey: ['citerne-detail-phone', params],
    queryFn: () => api.get<DetailPage>('/citernes/detail', { params }).then((r) => r.data),
    enabled: !!tankId,
    placeholderData: (prev) => prev,
  });
  // Newest first: what the pompiste just served is at the top.
  const lines = useMemo(() => [...(query.data?.data ?? [])].reverse(), [query.data]);
  const totals = query.data?.totals;

  const download = async () => {
    if (!tank) return;
    setExporting(true);
    try {
      await downloadFile('/citernes/detail/export', { fuel_tank_id: tank.id }, `citerne-${tank.name}.xlsx`);
      toast.success('Fichier Excel téléchargé.');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Le téléchargement a échoué.'));
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!tank) return <EmptyState message="Aucune citerne sur vos sites." />;

  return (
    <div className="-mx-1 space-y-4 pb-28">
      <h1 className="px-1 text-xl font-bold text-slate-900 dark:text-slate-100">Détail citerne</h1>

      {/* 1. Which citerne: big buttons, scroll sideways when there are many. */}
      {tanks.length > 1 && (
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
          {tanks.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className={clsx(
                'flex min-h-14 shrink-0 items-center gap-2 rounded-2xl border-2 px-4 text-left transition active:scale-95',
                t.id === tank.id
                  ? 'border-orange-500 bg-orange-500 text-white shadow-md shadow-orange-500/30'
                  : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
              )}
            >
              <Container size={20} />
              <span>
                <span className="block text-base font-bold leading-tight">{t.name}</span>
                <span className={clsx('block text-xs', t.id === tank.id ? 'text-orange-100' : 'text-slate-500 dark:text-slate-400')}>{t.site?.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 2. The citerne at a glance. */}
      <div className="rounded-2xl bg-slate-900 p-4 text-white shadow-lg dark:bg-slate-800">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Container size={16} /> {tank.name} · {tank.site?.name}
        </div>
        <div className="mt-2 text-xs uppercase tracking-wide text-slate-400">Série actuelle de la pompe</div>
        <div className="font-mono text-3xl font-bold tracking-tight">{tank.last_serie === null ? '—' : nf.format(tank.last_serie)}</div>
      </div>

      {/* 3. The day: big arrows, tap the date to pick another one. */}
      {!searching && (
        <div className="flex items-stretch gap-2">
          <button onClick={() => setDay(shiftDay(day, -1))} aria-label="Jour précédent" className={dayBtn}>
            <ChevronLeft size={28} />
          </button>
          <label className="relative flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
            <span className="flex items-center gap-1.5 text-lg font-bold capitalize text-slate-900 dark:text-slate-100">
              <CalendarDays size={18} className="text-orange-500" /> {dayLabel(day)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{fmtDate(day)} · toucher pour changer</span>
            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Choisir le jour" />
          </label>
          <button onClick={() => setDay(shiftDay(day, 1))} disabled={day >= todayIso()} aria-label="Jour suivant" className={clsx(dayBtn, 'disabled:opacity-30')}>
            <ChevronRight size={28} />
          </button>
        </div>
      )}

      {/* 4. Totals of the day (or of the search). */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Sorties</div>
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{nf.format(totals?.litres_out ?? 0)} L</div>
          <div className="text-xs text-emerald-700/80 dark:text-emerald-400/80">{totals?.exits ?? 0} bon(s)</div>
        </div>
        <div className="rounded-2xl border-2 border-sky-200 bg-sky-50 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
          <div className="text-sm font-medium text-sky-800 dark:text-sky-300">Livraisons</div>
          <div className="text-2xl font-bold text-sky-700 dark:text-sky-400">{nf.format(totals?.litres_in ?? 0)} L</div>
          <div className="text-xs text-sky-700/80 dark:text-sky-400/80">{totals?.entries ?? 0} livraison(s)</div>
        </div>
      </div>

      {/* 5. Show: all / sorties / livraisons, and a search. */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
        {([['', 'Tout'], ['exit', 'Sorties'], ['entry', 'Livraisons']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setType(v)}
            className={clsx('min-h-12 rounded-xl text-base font-semibold transition', type === v ? 'bg-orange-500 text-white shadow shadow-orange-500/30' : 'text-slate-600 dark:text-slate-300')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Chercher un code ou un n° de bon"
          className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-white pl-12 pr-12 text-base text-slate-900 outline-none focus:border-orange-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        {searching && (
          <button onClick={() => setSearch('')} aria-label="Effacer" className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 active:bg-slate-100 dark:active:bg-slate-800">
            <X size={20} />
          </button>
        )}
      </div>
      {searching && <p className="px-1 text-sm text-slate-500 dark:text-slate-400">Résultats sur tous les jours (les plus récents en haut).</p>}

      {/* 6. The lines. */}
      {query.isLoading ? (
        <LoadingState rows={4} />
      ) : lines.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center text-base text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {searching ? 'Rien trouvé.' : 'Rien ce jour-là.'}
          {!searching && tank.date_to && day !== tank.date_to && (
            <button onClick={() => setDay(tank.date_to!)} className="mt-3 block w-full rounded-xl bg-orange-500 py-3 font-semibold text-white active:bg-orange-600">
              Aller au dernier jour ({fmtDate(tank.date_to)})
            </button>
          )}
        </div>
      ) : (
        <ul className={clsx('space-y-2 transition-opacity', query.isFetching && 'opacity-60')}>
          {lines.map((l) => (
            <PhoneLine key={`${l.id}-${l.entry_id ?? ''}`} line={l} showDate={searching} />
          ))}
        </ul>
      )}

      {/* 7. One big download button, always at hand. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={download}
          disabled={exporting}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-bold text-white shadow-lg shadow-emerald-600/30 active:bg-emerald-700 disabled:opacity-70"
        >
          {exporting ? <Loader2 size={22} className="animate-spin" /> : <Download size={22} />} Télécharger le fichier Excel
        </button>
      </div>
    </div>
  );
}

const dayBtn =
  'flex w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-slate-700 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:active:bg-slate-800';

function PhoneLine({ line: l, showDate }: { line: DetailLine; showDate: boolean }) {
  const delivery = l.entry_qty !== null && (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-sky-100 px-3 py-2 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200">
      <span className="text-base font-semibold">Livraison{l.supplier ? ` · ${l.supplier}` : ''}</span>
      <span className="text-lg font-bold">+{nf.format(l.entry_qty)} L</span>
    </div>
  );

  return (
    <li className="rounded-2xl border-2 border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      {(showDate || l.time || l.origin !== 'import') && (
        <div className="mb-2 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>
            {showDate && <span className="font-semibold text-slate-700 dark:text-slate-300">{fmtDate(l.date)} · </span>}
            {l.time ? l.time.slice(0, 5) : ''}
          </span>
          {l.origin === 'bon' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">
              <ReceiptText size={12} /> Bon de l'app{l.attachments_count > 0 && <Paperclip size={11} />}
            </span>
          )}
          {l.origin === 'manual' && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">Ajouté à la main</span>
          )}
        </div>
      )}
      {delivery}
      {l.exit_qty !== null && (
        <div className={clsx(delivery && 'mt-2')}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400">
                <Truck size={20} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xl font-bold text-slate-900 dark:text-slate-100">{l.code ?? '—'}</span>
                {l.matricule && <span className="block truncate text-sm text-slate-500 dark:text-slate-400">{l.matricule}</span>}
              </span>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{nf.format(l.exit_qty)}</div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">litres</div>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <dt className="text-xs text-slate-500 dark:text-slate-400">N° du bon</dt>
              <dd className="font-semibold text-slate-900 dark:text-slate-100">{l.bon_number ?? '—'}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <dt className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Gauge size={12} /> Compteur
              </dt>
              <dd className="font-semibold text-slate-900 dark:text-slate-100">{l.odometer === null ? '—' : nf.format(l.odometer)}</dd>
            </div>
            <div className="col-span-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <dt className="text-xs text-slate-500 dark:text-slate-400">Série de la pompe</dt>
              <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {l.serie_start === null ? '—' : n0.format(l.serie_start)} → {l.serie_end === null ? '—' : n0.format(l.serie_end)}
              </dd>
            </div>
          </dl>
        </div>
      )}
      {l.remark && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{l.remark}</p>}
    </li>
  );
}
