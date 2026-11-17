import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeftRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  Container,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { api, apiErrorMessage, downloadFile, uploadErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useAuth } from '../contexts/AuthContext';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, LoadingState } from '../components/ui/States';
import { Big, Sheet, bigInput, compress, smallInput } from './BonsPage';

interface DeliveryTank {
  id: number;
  name: string;
  site: { id: number; name: string };
  last_date: string | null;
  deliveries: number;
}

interface FuelDelivery {
  id: number;
  site_id: number;
  fuel_tank_id: number | null;
  tank_label: string | null;
  kind: 'fixe' | 'mobile';
  date: string;
  time: string | null;
  quantity: number;
  unit_price?: number | null;
  amount?: number | null;
  supplier: string | null;
  order_number: string | null;
  delivery_note: string | null;
  invoice_number?: string | null;
  invoice_received?: boolean;
  gauge_before_cm: number | null;
  gauge_before_l: number | null;
  gauge_after_cm: number | null;
  gauge_after_l: number | null;
  received_litres: number | null;
  serie: number | null;
  truck: string | null;
  driver_name: string | null;
  pompiste_name: string | null;
  remark: string | null;
  origin: 'app' | 'import';
  created_by: number | null;
  attachments_count: number;
  invoice_attachments_count: number;
  tank?: { id: number; name: string } | null;
  site?: { id: number; name: string } | null;
  creator?: { id: number; name: string } | null;
}

interface Totals {
  count: number;
  litres: number;
  amount?: number;
  pmp?: number | null;
  missing_price?: number;
}

interface DeliveryPage {
  data: FuelDelivery[];
  current_page: number;
  last_page: number;
  total: number;
  totals: Totals;
}

interface Agg {
  count: number;
  litres: number;
  amount: number;
  pmp: number | null;
}

interface Summary {
  year: number;
  total: Agg;
  months: (Agg & { month: number })[];
  suppliers: (Agg & { supplier: string })[];
  sites: { site_id: number; site_name: string; months: Record<string, Agg>; total: Agg }[];
}

interface Attachment {
  id: number;
  kind: 'bl' | 'facture';
  original_name: string;
  mime: string;
}

const numFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const moneyFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const priceFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : numFmt.format(v));
const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${moneyFmt.format(v)} DH`);
const price = (v: number | null | undefined) => (v === null || v === undefined ? '—' : priceFmt.format(v));
const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nowHhmm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const str = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));
const clean = (v: string) => v.replace(',', '.').replace(/\s/g, '');
const num = (v: string) => (clean(v) === '' || Number.isNaN(Number(clean(v))) ? null : Number(clean(v)));
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// Same remembered citerne as Bons carburant: the pompiste picks it once.
const STORAGE_KEY = 'bons-citerne';
const remembered = () => {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
};
const remember = (id: number | null) => {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
};

type FormOpen = { delivery: FuelDelivery | null };

export default function EntreesCarburantPage() {
  const { user } = useAuth();
  return user?.role === 'pompiste' ? <PompisteView /> : <ManagerView />;
}

function useTanks() {
  const siteParams = useSiteParams();
  return useQuery({
    queryKey: ['entrees', 'tanks', siteParams],
    queryFn: () => api.get<{ tanks: DeliveryTank[]; suppliers: string[] }>('/entrees/tanks', { params: siteParams }).then((r) => r.data),
  });
}

/* ------------------------------------------------------------------ */
/* Pompiste: pick the citerne, one big button, the latest deliveries   */
/* ------------------------------------------------------------------ */

function PompisteView() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useTanks();
  const tanks = data?.tanks ?? [];
  const [tankId, setTankId] = useState<number | null>(remembered());
  const [choosing, setChoosing] = useState(false);
  const [form, setForm] = useState<FormOpen | null>(null);
  const [deleting, setDeleting] = useState<FuelDelivery | null>(null);
  const [viewing, setViewing] = useState<FuelDelivery | null>(null);

  const tank = tanks.find((t) => t.id === tankId) ?? (tanks.length === 1 ? tanks[0] : null);
  const listParams = { fuel_tank_id: tank?.id, per_page: 30 };
  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ['entrees', 'list', listParams],
    queryFn: () => api.get<DeliveryPage>('/entrees', { params: listParams }).then((r) => r.data),
    enabled: !!tank,
  });

  const remove = useMutation({
    mutationFn: (d: FuelDelivery) => api.delete(`/entrees/${d.id}`),
    onSuccess: () => {
      toast.success('Livraison supprimée');
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['entrees'] });
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (isLoading) return <LoadingState />;
  if (!tanks.length) return <EmptyState message="Aucune citerne sur votre site." />;

  if (!tank || choosing)
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Entrées carburant</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">Touchez la citerne qui reçoit le gasoil.</p>
        </div>
        <div className="space-y-3">
          {tanks.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                remember(t.id);
                setTankId(t.id);
                setChoosing(false);
              }}
              className="flex w-full items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left active:scale-[0.99] active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400">
                <Container size={28} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold text-slate-900 dark:text-slate-100">{t.name}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">
                  {t.site.name} · dernière livraison {fmtDate(t.last_date)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  const deliveries = list?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3 rounded-2xl bg-slate-900 p-4 text-white dark:bg-slate-800">
        <Container size={30} className="shrink-0 text-sky-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{tank.name}</div>
          <div className="text-sm text-slate-300">{tank.site.name} · entrées de gasoil</div>
        </div>
        {tanks.length > 1 && (
          <button onClick={() => setChoosing(true)} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium active:bg-white/20">
            <ArrowLeftRight size={16} /> Changer
          </button>
        )}
      </div>

      <button
        onClick={() => setForm({ delivery: null })}
        className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-600/20 active:scale-[0.98] active:bg-sky-700"
      >
        <Truck size={40} />
        <span className="text-lg font-bold">Nouvelle livraison</span>
        <span className="text-sm text-sky-100">Le camion-citerne est arrivé : saisissez son bon de livraison</span>
      </button>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Dernières livraisons
          {list && <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">{list.totals.count} · {fmt(list.totals.litres)} L</span>}
        </h2>
        {listLoading ? (
          <LoadingState />
        ) : deliveries.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-500 dark:border-slate-800 dark:text-slate-400">Aucune livraison saisie sur cette citerne.</div>
        ) : (
          <div className="grid gap-3">
            {deliveries.map((d) => (
              <DeliveryCard
                key={d.id}
                delivery={d}
                editable={d.origin === 'app' && d.created_by === user?.id}
                onEdit={() => setForm({ delivery: d })}
                onDelete={() => setDeleting(d)}
                onPhotos={() => setViewing(d)}
              />
            ))}
          </div>
        )}
      </section>

      {form && (
        <DeliveryForm key={form.delivery?.id ?? 'new'} tanks={tanks} suppliers={data?.suppliers ?? []} fixedTank={tank} delivery={form.delivery} canPrice={false} onClose={() => setForm(null)} />
      )}
      {viewing && <PhotosModal delivery={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Supprimer cette livraison ?"
        message={`La livraison de ${fmt(deleting?.quantity)} L (${deleting?.supplier ?? ''}, BL ${deleting?.delivery_note ?? '—'}) et ses photos seront supprimées.`}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
        isLoading={remove.isPending}
      />
    </div>
  );
}

function DeliveryCard({ delivery: d, editable, onEdit, onDelete, onPhotos }: { delivery: FuelDelivery; editable: boolean; onEdit: () => void; onDelete: () => void; onPhotos: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-sky-600 px-2 py-0.5 text-sm font-bold text-white">{d.supplier ?? '—'}</span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {fmtDate(d.date)} {hhmm(d.time)}
            </span>
          </div>
          <div className="mt-1 space-y-0.5 font-mono text-sm text-slate-500 dark:text-slate-400">
            {d.delivery_note && <div>BL {d.delivery_note}</div>}
            {d.order_number && <div>Commande {d.order_number}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmt(d.quantity)}</div>
          <div className="text-xs text-slate-400">litres</div>
        </div>
      </div>
      {d.received_litres !== null && (
        <div className={clsx('mt-2 text-sm', Math.abs(d.received_litres - d.quantity) > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400')}>
          Jauge : {fmt(d.gauge_before_l)} → {fmt(d.gauge_after_l)} L · reçu {fmt(d.received_litres)} L ({d.received_litres - d.quantity >= 0 ? '+' : ''}
          {fmt(Math.round((d.received_litres - d.quantity) * 100) / 100)} L)
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        {d.origin === 'app' ? (
          <button onClick={onPhotos} disabled={!d.attachments_count} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-sky-600 active:bg-sky-50 disabled:text-slate-400 dark:text-sky-400">
            <Paperclip size={16} /> {d.attachments_count} photo{d.attachments_count > 1 ? 's' : ''}
          </button>
        ) : (
          <span className="px-2 text-sm text-slate-400">Fichier inventaire</span>
        )}
        <span className="flex-1" />
        {editable && (
          <>
            <button onClick={onEdit} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800">
              <Pencil size={15} /> Modifier
            </button>
            <button onClick={onDelete} className="rounded-lg p-2 text-red-600 active:bg-red-50 dark:text-red-400" aria-label="Supprimer">
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Responsable / SuperAdmin: every delivery with its price, and the PMP */
/* ------------------------------------------------------------------ */

function ManagerView() {
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();
  const { data: tankData } = useTanks();
  const tanks = tankData?.tanks ?? [];
  const suppliers = tankData?.suppliers ?? [];
  const [tab, setTab] = useState<'livraisons' | 'prix'>('livraisons');
  const [search, setSearch] = useState('');
  const [tankId, setTankId] = useState('');
  const [supplier, setSupplier] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormOpen | null>(null);
  const [deleting, setDeleting] = useState<FuelDelivery | null>(null);
  const [viewing, setViewing] = useState<FuelDelivery | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filters = {
    ...siteParams,
    search: search || undefined,
    fuel_tank_id: tankId || undefined,
    supplier: supplier || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    price: missing ? 'missing' : undefined,
  };
  const { data: list, isLoading } = useQuery({
    queryKey: ['entrees', 'list', filters, page],
    queryFn: () => api.get<DeliveryPage>('/entrees', { params: { ...filters, page, per_page: 50 } }).then((r) => r.data),
  });
  const reset = () => setPage(1);

  const remove = useMutation({
    mutationFn: (d: FuelDelivery) => api.delete(`/entrees/${d.id}`),
    onSuccess: () => {
      toast.success('Livraison supprimée');
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['entrees'] });
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const importFile = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api.post<ImportResult>('/entrees/import', body, { timeout: 300_000 }).then((r) => r.data);
    },
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['entrees'] });
    },
    onError: (e, file) => toast.error(uploadErrorMessage(e, file), { duration: 8000 }),
  });

  const exportExcel = () =>
    downloadFile('/entrees/export', filters, 'entrees-carburant.xlsx').catch((e) => toast.error(apiErrorMessage(e, "L'export a échoué.")));

  const t = list?.totals;
  const columns: Column<FuelDelivery>[] = [
    {
      header: 'Date',
      accessor: (d) => (
        <span className="whitespace-nowrap">
          {fmtDate(d.date)} <span className="text-xs text-slate-400">{hhmm(d.time)}</span>
        </span>
      ),
    },
    {
      header: 'Citerne',
      accessor: (d) => (
        <div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{d.tank?.name ?? d.tank_label ?? '—'}</div>
          <div className="text-xs text-slate-400">
            {d.site?.name}
            {d.kind === 'mobile' && ' · mobile'}
          </div>
        </div>
      ),
    },
    { header: 'Fournisseur', accessor: (d) => d.supplier ?? '—' },
    { header: 'Quantité (L)', className: 'text-right tabular-nums', accessor: (d) => <span className="font-semibold">{fmt(d.quantity)}</span> },
    {
      header: 'PU (DH/L)',
      className: 'text-right tabular-nums',
      accessor: (d) => (d.unit_price == null ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">à saisir</span> : price(d.unit_price)),
    },
    { header: 'Montant HT', className: 'text-right tabular-nums whitespace-nowrap', accessor: (d) => money(d.amount) },
    {
      header: 'Commande / BL',
      accessor: (d) => (
        <div className="font-mono text-xs">
          <div>{d.order_number ?? '—'}</div>
          {d.delivery_note && <div className="text-slate-400">BL {d.delivery_note}</div>}
        </div>
      ),
    },
    {
      header: 'Facture',
      accessor: (d) => (
        <span className="font-mono text-xs">
          {d.invoice_number ?? '—'}
          {d.invoice_received && <CheckCircle2 size={13} className="ml-1 inline text-emerald-500" />}
          {d.invoice_attachments_count > 0 && (
            <button onClick={() => setViewing(d)} title="Voir la facture" className="ml-1 inline-flex align-middle text-sky-600 dark:text-sky-400">
              <FileText size={13} />
            </button>
          )}
        </span>
      ),
    },
    {
      header: 'Jauge',
      className: 'text-right tabular-nums',
      accessor: (d) =>
        d.received_litres === null ? (
          '—'
        ) : (
          <span className={clsx(Math.abs(d.received_litres - d.quantity) > 1 && 'font-semibold text-amber-600 dark:text-amber-400')}>{fmt(d.received_litres)}</span>
        ),
    },
    {
      header: 'Source',
      accessor: (d) => (
        <div className="text-xs">
          <div className="text-slate-400">{d.origin === 'app' ? 'Pompiste' : 'Inventaire'}</div>
          {d.attachments_count > 0 && (
            <button onClick={() => setViewing(d)} className="flex items-center gap-1 font-medium text-sky-600 dark:text-sky-400">
              <Paperclip size={13} /> {d.attachments_count} pièce{d.attachments_count > 1 ? 's' : ''}
            </button>
          )}
        </div>
      ),
    },
    {
      header: '',
      accessor: (d) => (
        <div className="flex justify-end gap-1">
          <button onClick={() => setForm({ delivery: d })} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200" title="Modifier / saisir le prix">
            <Pencil size={15} />
          </button>
          <button onClick={() => setDeleting(d)} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="Supprimer">
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  const input = 'h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Entrées carburant</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Livraisons de gasoil dans les citernes, quantités et prix (PMP).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={importFile.isPending} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            {importFile.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Importer l'inventaire
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => (e.target.files?.[0] && importFile.mutate(e.target.files[0]), (e.target.value = ''))} />
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            <Download size={16} /> Export Excel
          </button>
          <button onClick={() => setForm({ delivery: null })} className="flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">
            <Plus size={16} /> Nouvelle livraison
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(
          [
            ['livraisons', 'Livraisons'],
            ['prix', 'Prix & PMP'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold',
              tab === key ? 'border-sky-600 text-sky-700 dark:text-sky-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'prix' ? (
        <PricesTab filters={{ ...siteParams, fuel_tank_id: tankId || undefined, supplier: supplier || undefined }} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Livraisons" value={fmt(t?.count)} />
            <Stat label="Litres livrés" value={`${fmt(t?.litres)} L`} />
            <Stat label="Montant HT" value={money(t?.amount)} />
            <Stat
              label="PMP (prix moyen pondéré)"
              value={t?.pmp ? `${price(t.pmp)} DH/L` : '—'}
              note={t?.missing_price ? (
                <button onClick={() => (setMissing(true), reset())} className="text-amber-600 hover:underline dark:text-amber-400">
                  {t.missing_price} sans prix
                </button>
              ) : undefined}
            />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <SearchInput value={search} onChange={(e) => (setSearch(e.target.value), reset())} placeholder="N° commande, BL, facture, fournisseur…" />
            </div>
            <select className={input} value={tankId} onChange={(e) => (setTankId(e.target.value), reset())}>
              <option value="">Toutes les citernes</option>
              {tanks.map((tk) => (
                <option key={tk.id} value={tk.id}>
                  {tk.name} ({tk.site.name})
                </option>
              ))}
            </select>
            <select className={input} value={supplier} onChange={(e) => (setSupplier(e.target.value), reset())}>
              <option value="">Tous les fournisseurs</option>
              {suppliers.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <label className="text-xs text-slate-500">
              Du
              <input type="date" className={clsx(input, 'block')} value={dateFrom} onChange={(e) => (setDateFrom(e.target.value), reset())} />
            </label>
            <label className="text-xs text-slate-500">
              Au
              <input type="date" className={clsx(input, 'block')} value={dateTo} onChange={(e) => (setDateTo(e.target.value), reset())} />
            </label>
            <button
              onClick={() => (setMissing((m) => !m), reset())}
              className={clsx('h-10 rounded-lg px-3 text-sm font-semibold ring-1', missing ? 'bg-amber-500 text-white ring-amber-500' : 'bg-white text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600')}
            >
              Sans prix
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <DataTable columns={columns} rows={list?.data ?? []} isLoading={isLoading} keyFn={(d) => d.id} emptyMessage="Aucune livraison. Importez l'INVENTAIRE ou saisissez une livraison." />
            {list && list.last_page > 1 && (
              <div className="border-t border-slate-100 p-3 dark:border-slate-800">
                <Pagination page={list.current_page} lastPage={list.last_page} total={list.total} onPageChange={setPage} />
              </div>
            )}
          </div>
        </>
      )}

      {form && (
        <DeliveryForm key={form.delivery?.id ?? 'new'} tanks={tanks} suppliers={suppliers} fixedTank={null} delivery={form.delivery} canPrice onClose={() => setForm(null)} />
      )}
      {viewing && <PhotosModal delivery={viewing} onClose={() => setViewing(null)} />}
      {importResult && <ImportResultModal result={importResult} onClose={() => setImportResult(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Supprimer cette livraison ?"
        message={
          deleting?.origin === 'import'
            ? `La ligne de l'inventaire (${fmt(deleting?.quantity)} L du ${fmtDate(deleting?.date)}) sera supprimée. Elle reviendra si vous ré-importez le même fichier.`
            : `La livraison de ${fmt(deleting?.quantity)} L (${deleting?.supplier ?? ''}) et ses photos seront supprimées, ainsi que son entrée dans la citerne.`
        }
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
        isLoading={remove.isPending}
      />
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
      {note && <div className="mt-1 text-xs">{note}</div>}
    </div>
  );
}

function PricesTab({ filters }: { filters: Record<string, unknown> }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading } = useQuery({
    queryKey: ['entrees', 'summary', filters, year],
    queryFn: () => api.get<Summary>('/entrees/summary', { params: { ...filters, year } }).then((r) => r.data),
  });
  if (isLoading || !data) return <LoadingState />;
  const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400';
  const td = 'px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {[0, 1, 2].map((i) => {
            const y = new Date().getFullYear() - i;
            return <option key={y}>{y}</option>;
          })}
        </select>
        <span className="text-sm text-slate-500 dark:text-slate-400">PMP = montant HT ÷ litres achetés (lignes avec un prix).</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Livraisons ${year}`} value={fmt(data.total.count)} />
        <Stat label="Litres achetés" value={`${fmt(data.total.litres)} L`} />
        <Stat label="Montant HT" value={money(data.total.amount)} />
        <Stat label="PMP de l'année" value={data.total.pmp ? `${price(data.total.pmp)} DH/L` : '—'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">Par mois</div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Mois</th>
                <th className={clsx(th, 'text-right')}>Litres</th>
                <th className={clsx(th, 'text-right')}>Montant HT</th>
                <th className={clsx(th, 'text-right')}>PMP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.months.map((m) => (
                <tr key={m.month} className={clsx(m.count === 0 && 'opacity-40')}>
                  <td className={td}>{MONTHS[m.month - 1]}</td>
                  <td className={clsx(td, 'text-right')}>{fmt(m.litres)}</td>
                  <td className={clsx(td, 'text-right')}>{money(m.amount)}</td>
                  <td className={clsx(td, 'text-right font-semibold')}>{price(m.pmp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">Par fournisseur</div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Fournisseur</th>
                <th className={clsx(th, 'text-right')}>Livraisons</th>
                <th className={clsx(th, 'text-right')}>Litres</th>
                <th className={clsx(th, 'text-right')}>Montant HT</th>
                <th className={clsx(th, 'text-right')}>PMP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.suppliers.map((s) => (
                <tr key={s.supplier}>
                  <td className={clsx(td, 'font-medium')}>{s.supplier}</td>
                  <td className={clsx(td, 'text-right')}>{s.count}</td>
                  <td className={clsx(td, 'text-right')}>{fmt(s.litres)}</td>
                  <td className={clsx(td, 'text-right')}>{money(s.amount)}</td>
                  <td className={clsx(td, 'text-right font-semibold')}>{price(s.pmp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.sites.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">PMP par site et par mois (DH/L)</div>
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr>
                <th className={th}>Site</th>
                {MONTHS.map((m) => (
                  <th key={m} className={clsx(th, 'text-right')}>
                    {m.slice(0, 4)}.
                  </th>
                ))}
                <th className={clsx(th, 'text-right')}>Année</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.sites.map((s) => (
                <tr key={s.site_id}>
                  <td className={clsx(td, 'font-medium')}>{s.site_name}</td>
                  {MONTHS.map((_, i) => (
                    <td key={i} className={clsx(td, 'text-right')}>
                      {price(s.months[String(i + 1)]?.pmp ?? null)}
                    </td>
                  ))}
                  <td className={clsx(td, 'text-right font-semibold')}>{price(s.total.pmp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ImportResult {
  lines: number;
  created: number;
  updated: number;
  unchanged: number;
  matched_app: number;
  not_in_app: Record<string, number>;
  other_sites: Record<string, number>;
  sheets: { name: string; lines: number }[];
}

function ImportResultModal({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const outside = Object.entries(result.not_in_app);
  const others = Object.entries(result.other_sites);
  return (
    <Modal open onClose={onClose} title="Inventaire importé">
      <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
          <FileSpreadsheet size={18} /> {result.lines} lignes lues ({result.sheets.map((s) => `${s.name} : ${s.lines}`).join(', ')})
        </div>
        <ul className="list-inside list-disc space-y-1">
          <li>{result.created} livraison(s) ajoutée(s)</li>
          <li>{result.updated} mise(s) à jour, {result.unchanged} inchangée(s)</li>
          <li>{result.matched_app} livraison(s) saisie(s) par le pompiste ont reçu leur prix</li>
        </ul>
        {outside.length > 0 && (
          <p className="text-slate-500 dark:text-slate-400">
            Ignorées (citernes hors des sites de l'application) : {outside.map(([k, v]) => `${k} (${v})`).join(', ')}.
          </p>
        )}
        {others.length > 0 && <p className="text-amber-600 dark:text-amber-400">Hors de vos sites : {others.map(([k, v]) => `${k} (${v})`).join(', ')}.</p>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

function Thumb({ deliveryId, attachment, onRemove }: { deliveryId: number; attachment: Attachment; onRemove?: () => void }) {
  const { data: url, isLoading } = useQuery({
    queryKey: ['entrees', 'file', attachment.id],
    queryFn: () => api.get<Blob>(`/entrees/${deliveryId}/attachments/${attachment.id}`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data)),
    staleTime: Infinity,
  });
  const isImage = attachment.mime.startsWith('image/');
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => url && window.open(url, '_blank')}
        title={attachment.original_name}
        className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
      >
        {isLoading ? (
          <Loader2 size={18} className="animate-spin text-slate-400" />
        ) : isImage && url ? (
          <img src={url} alt={attachment.original_name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 p-1 text-[10px] text-slate-500">
            <FileText size={22} /> <span className="line-clamp-2 break-all">{attachment.original_name}</span>
          </div>
        )}
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} title="Retirer cette photo" className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white shadow">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function PhotosModal({ delivery, onClose }: { delivery: FuelDelivery; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['entrees', 'attachments', delivery.id],
    queryFn: () => api.get<Attachment[]>(`/entrees/${delivery.id}/attachments`).then((r) => r.data),
  });
  return (
    <Modal open onClose={onClose} title={`Pièces de la livraison ${delivery.delivery_note ?? delivery.order_number ?? ''}`}>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        {delivery.supplier} · {fmt(delivery.quantity)} L · {fmtDate(delivery.date)} — touchez un fichier pour l'ouvrir.
      </p>
      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="space-y-4">
          {(
            [
              ['bl', 'Bon de livraison'],
              ['facture', 'Facture'],
            ] as const
          ).map(([kind, label]) => {
            const files = data?.filter((a) => a.kind === kind) ?? [];
            if (!files.length) return null;
            return (
              <div key={kind}>
                <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</div>
                <div className="flex flex-wrap gap-3">
                  {files.map((a) => (
                    <Thumb key={a.id} deliveryId={delivery.id} attachment={a} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* The form: the supplier's BON DE LIVRAISON, in its own order          */
/* ------------------------------------------------------------------ */

interface FormState {
  fuel_tank_id: string;
  supplier: string;
  supplier_other: string;
  delivery_note: string;
  order_number: string;
  quantity: string;
  date: string;
  time: string;
  gauge_before_cm: string;
  gauge_before_l: string;
  gauge_after_cm: string;
  gauge_after_l: string;
  serie: string;
  truck: string;
  driver_name: string;
  pompiste_name: string;
  remark: string;
  unit_price: string;
  amount: string;
  invoice_number: string;
  invoice_received: boolean;
}

const MAIN_SUPPLIERS = ['AFRIQUIA', 'PETROM', 'VIVO ENERGY', 'LINK ENERGY', 'ANH', 'TRANSMEL'];

function DeliveryForm({
  tanks,
  suppliers,
  fixedTank,
  delivery,
  canPrice,
  onClose,
}: {
  tanks: DeliveryTank[];
  suppliers: string[];
  fixedTank: DeliveryTank | null;
  delivery: FuelDelivery | null;
  canPrice: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const choices = [...MAIN_SUPPLIERS, ...suppliers.filter((s) => !MAIN_SUPPLIERS.includes(s))].slice(0, 8);
  const known = !delivery?.supplier || choices.includes(delivery.supplier);
  const imported = delivery?.origin === 'import';
  const [form, setForm] = useState<FormState>({
    fuel_tank_id: str(delivery?.fuel_tank_id ?? fixedTank?.id ?? (tanks.length === 1 ? tanks[0].id : '')),
    supplier: delivery ? (known ? str(delivery.supplier) : 'AUTRE') : '',
    supplier_other: delivery && !known ? str(delivery.supplier) : '',
    delivery_note: str(delivery?.delivery_note),
    order_number: str(delivery?.order_number),
    quantity: str(delivery?.quantity),
    date: delivery?.date ?? todayIso(),
    time: delivery ? hhmm(delivery.time) : nowHhmm(),
    gauge_before_cm: str(delivery?.gauge_before_cm),
    gauge_before_l: str(delivery?.gauge_before_l),
    gauge_after_cm: str(delivery?.gauge_after_cm),
    gauge_after_l: str(delivery?.gauge_after_l),
    serie: str(delivery?.serie),
    truck: str(delivery?.truck),
    driver_name: str(delivery?.driver_name),
    pompiste_name: delivery?.pompiste_name ?? user?.name ?? '',
    remark: str(delivery?.remark),
    unit_price: str(delivery?.unit_price),
    amount: str(delivery?.amount),
    invoice_number: str(delivery?.invoice_number),
    invoice_received: !!delivery?.invoice_received,
  });
  const [amountTyped, setAmountTyped] = useState(!!delivery?.amount && !!delivery?.unit_price && Math.abs((delivery.unit_price ?? 0) * delivery.quantity - (delivery.amount ?? 0)) > 0.05);
  const [more, setMore] = useState(!!delivery && !!(delivery.truck || delivery.driver_name || delivery.remark));
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const { data: existing = [] } = useQuery({
    queryKey: ['entrees', 'attachments', delivery?.id],
    queryFn: () => api.get<Attachment[]>(`/entrees/${delivery!.id}/attachments`).then((r) => r.data),
    enabled: !!delivery,
  });
  const blExisting = existing.filter((a) => a.kind === 'bl');
  const invoiceExisting = existing.filter((a) => a.kind === 'facture');
  const [invoiceFiles, setInvoiceFiles] = useState<{ file: File; url: string }[]>([]);
  const invoiceRef = useRef<HTMLInputElement>(null);

  const filesRef = useRef([...files, ...invoiceFiles]);
  filesRef.current = [...files, ...invoiceFiles];
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);
  const addFiles = async (list: FileList | null, target: 'bl' | 'facture' = 'bl') => {
    if (!list) return;
    const picked = await Promise.all(Array.from(list).map(compress));
    const add = (f: { file: File; url: string }[]) => [...f, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10);
    if (target === 'facture') setInvoiceFiles(add);
    else setFiles(add);
  };
  const removeExisting = useMutation({
    mutationFn: (a: Attachment) => api.delete(`/entrees/${delivery!.id}/attachments/${a.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['entrees'] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const quantity = num(form.quantity);
  const before = num(form.gauge_before_l);
  const after = num(form.gauge_after_l);
  const received = before !== null && after !== null ? Math.round((after - before) * 100) / 100 : null;
  const gap = received !== null && quantity !== null ? Math.round((received - quantity) * 100) / 100 : null;
  const unitPrice = num(form.unit_price);
  const computedAmount = unitPrice !== null && quantity !== null ? Math.round(unitPrice * quantity * 100) / 100 : null;
  const supplierValue = form.supplier === 'AUTRE' ? form.supplier_other.trim() : form.supplier;
  const tank = tanks.find((t) => String(t.id) === form.fuel_tank_id) ?? fixedTank;

  const buildBody = () => {
    const body = new FormData();
    const fields: Record<string, string> = {
      fuel_tank_id: form.fuel_tank_id,
      supplier: supplierValue,
      delivery_note: form.delivery_note,
      order_number: form.order_number,
      quantity: clean(form.quantity),
      date: form.date,
      time: form.time,
      gauge_before_cm: clean(form.gauge_before_cm),
      gauge_before_l: clean(form.gauge_before_l),
      gauge_after_cm: clean(form.gauge_after_cm),
      gauge_after_l: clean(form.gauge_after_l),
      serie: clean(form.serie),
      truck: form.truck,
      driver_name: form.driver_name,
      pompiste_name: form.pompiste_name,
      remark: form.remark,
    };
    if (canPrice) {
      fields.unit_price = clean(form.unit_price);
      fields.amount = amountTyped ? clean(form.amount) : '';
      fields.invoice_number = form.invoice_number;
      fields.invoice_received = form.invoice_received ? '1' : '0';
    }
    Object.entries(fields).forEach(([k, v]) => body.append(k, v.trim()));
    files.forEach(({ file }) => body.append('attachments[]', file));
    if (canPrice) invoiceFiles.forEach(({ file }) => body.append('invoice_attachments[]', file));
    return body;
  };

  const save = useMutation({
    mutationFn: () => api.post(delivery ? `/entrees/${delivery.id}` : '/entrees', buildBody()),
    onSuccess: () => {
      toast.success(delivery ? 'Livraison modifiée' : 'Livraison enregistrée');
      queryClient.invalidateQueries({ queryKey: ['entrees'] });
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "La livraison n'a pas pu être enregistrée."), { duration: 6000 }),
  });

  const proofCount = files.length + blExisting.length;
  const invoiceCount = invoiceFiles.length + invoiceExisting.length;
  // The pompiste always shows the BL photo; a responsable the BL or the invoice; an inventory line needs none.
  const proofMissing = !imported && proofCount === 0 && (!canPrice || invoiceCount === 0);
  const missing = [
    !imported && !form.fuel_tank_id && 'la citerne',
    !supplierValue && 'le fournisseur',
    (quantity === null || !(quantity > 0)) && 'la quantité',
    proofMissing && (canPrice ? 'la photo du bon de livraison ou la facture' : 'la photo du bon de livraison'),
  ].filter(Boolean) as string[];

  const submit = () => {
    if (missing.length) return toast.error(`Il manque ${missing.join(', ')}.`);
    if (!navigator.onLine) {
      api.post(delivery ? `/entrees/${delivery.id}` : '/entrees', buildBody()).catch(() => undefined);
      toast('Pas de réseau : la livraison sera envoyée toute seule dès le retour du réseau.', { icon: '📶', duration: 7000 });
      onClose();
      return;
    }
    save.mutate();
  };

  const sectionTitle = 'mb-2 text-sm font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500';
  let step = 0;
  const next = () => ++step;

  return (
    <Sheet
      title={delivery ? `Modifier la livraison du ${fmtDate(delivery.date)}` : `Nouvelle livraison${tank ? ` · ${tank.name}` : ''}`}
      onClose={onClose}
      footer={
        <button
          onClick={submit}
          disabled={save.isPending}
          className={clsx('flex h-14 w-full items-center justify-center gap-2 rounded-xl text-lg font-bold text-white active:scale-[0.99]', missing.length ? 'bg-slate-400 dark:bg-slate-700' : 'bg-emerald-600 active:bg-emerald-700')}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
          {delivery ? 'Enregistrer' : 'Enregistrer la livraison'}
        </button>
      }
    >
      <div className="space-y-6">
        {!fixedTank && !imported && (
          <section>
            <div className={sectionTitle}>{next()} · Citerne</div>
            <select className={bigInput} value={form.fuel_tank_id} onChange={set('fuel_tank_id')}>
              <option value="">Choisir la citerne…</option>
              {tanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.site.name})
                </option>
              ))}
            </select>
          </section>
        )}
        {imported && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            Ligne de l'inventaire : <b>{delivery?.tank?.name ?? delivery?.tank_label}</b> ({delivery?.site?.name}). Elle sera remise à jour par le prochain import du même fichier.
          </div>
        )}

        <section>
          <div className={sectionTitle}>{next()} · Fournisseur</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[...choices, 'AUTRE'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm((f) => ({ ...f, supplier: s }))}
                className={clsx(
                  'rounded-xl py-3 text-sm font-bold ring-2',
                  form.supplier === s ? 'bg-sky-600 text-white ring-sky-600' : 'bg-white text-slate-700 ring-slate-200 active:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
                )}
              >
                {s === 'AUTRE' ? 'Autre' : s}
              </button>
            ))}
          </div>
          {form.supplier === 'AUTRE' && <input className={clsx(smallInput, 'mt-2')} placeholder="Nom du fournisseur" value={form.supplier_other} onChange={set('supplier_other')} autoCapitalize="characters" />}
        </section>

        <section className="space-y-4">
          <div className={sectionTitle}>{next()} · Le bon de livraison</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Big label="N° du bon de livraison (BL)">
              <input className={clsx(bigInput, 'font-mono tracking-wider')} placeholder="BL11642898" value={form.delivery_note} onChange={set('delivery_note')} autoCapitalize="characters" />
            </Big>
            <Big label="N° de commande">
              <input className={clsx(bigInput, 'font-mono tracking-wider')} placeholder="P14495" value={form.order_number} onChange={set('order_number')} autoCapitalize="characters" />
            </Big>
          </div>
          <Big label="Quantité livrée (litres)">
            <input className={clsx(bigInput, 'text-2xl')} inputMode="decimal" placeholder="30000" value={form.quantity} onChange={set('quantity')} />
          </Big>
        </section>

        <section className="space-y-3">
          <div className={sectionTitle}>{next()} · Jauge de la citerne (dépotage)</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="font-semibold text-slate-700 dark:text-slate-200">Avant</div>
              <input className={smallInput} inputMode="decimal" placeholder="cm" value={form.gauge_before_cm} onChange={set('gauge_before_cm')} />
              <input className={smallInput} inputMode="decimal" placeholder="litres" value={form.gauge_before_l} onChange={set('gauge_before_l')} />
            </div>
            <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="font-semibold text-slate-700 dark:text-slate-200">Après</div>
              <input className={smallInput} inputMode="decimal" placeholder="cm" value={form.gauge_after_cm} onChange={set('gauge_after_cm')} />
              <input className={smallInput} inputMode="decimal" placeholder="litres" value={form.gauge_after_l} onChange={set('gauge_after_l')} />
            </div>
          </div>
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Série dépotage
            <input className={clsx(smallInput, 'mt-1')} inputMode="decimal" value={form.serie} onChange={set('serie')} />
          </label>
          {received !== null && (
            <p className={clsx('flex items-center gap-1.5 text-sm font-medium', gap !== null && Math.abs(gap) > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
              {gap !== null && Math.abs(gap) > 1 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
              Reçu à la jauge : {fmt(received)} L{gap !== null && ` (${gap >= 0 ? '+' : ''}${fmt(gap)} L par rapport au BL)`}
            </p>
          )}
        </section>

        {(!imported || canPrice) && (
          <section>
            <div className={sectionTitle}>{next()} · Photo du bon de livraison</div>
            {proofCount === 0 ? (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sky-400 bg-sky-50 text-sky-700 active:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300"
              >
                <Camera size={34} />
                <span className="text-lg font-bold">Prendre la photo du BL</span>
              </button>
            ) : (
              <div className="flex flex-wrap gap-3">
                {blExisting.map((a) => (
                  <Thumb key={a.id} deliveryId={delivery!.id} attachment={a} onRemove={() => removeExisting.mutate(a)} />
                ))}
                {files.map((f, i) => (
                  <div key={f.url} className="relative">
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      {f.file.type.startsWith('image/') ? (
                        <img src={f.url} alt={f.file.name} className="h-full w-full object-cover" />
                      ) : (
                        <FileText size={22} className="text-slate-400" />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(f.url);
                        setFiles((list) => list.filter((_, j) => j !== i));
                      }}
                      className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white shadow"
                      title="Retirer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-xs font-semibold text-slate-500 active:bg-slate-50 dark:border-slate-600 dark:text-slate-400"
                >
                  <Camera size={24} /> Autre photo
                </button>
              </div>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 flex items-center gap-1.5 py-1 text-sm font-medium text-sky-600 dark:text-sky-400">
              <Upload size={15} /> Choisir dans la galerie / un fichier
            </button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (void addFiles(e.target.files), (e.target.value = ''))} />
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => (void addFiles(e.target.files), (e.target.value = ''))} />
          </section>
        )}

        {canPrice && (
          <section className="space-y-3 rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
            <div className="text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Prix (responsable)</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                PU (DH / litre)
                <input className={clsx(smallInput, 'mt-1')} inputMode="decimal" placeholder="15,31" value={form.unit_price} onChange={set('unit_price')} />
              </label>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                Montant HT (DH)
                <input
                  className={clsx(smallInput, 'mt-1')}
                  inputMode="decimal"
                  value={amountTyped ? form.amount : computedAmount !== null ? String(computedAmount) : ''}
                  placeholder="quantité × PU"
                  onChange={(e) => {
                    setAmountTyped(e.target.value !== '');
                    setForm((f) => ({ ...f, amount: e.target.value }));
                  }}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 items-end gap-3">
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                N° de facture
                <input className={clsx(smallInput, 'mt-1')} value={form.invoice_number} onChange={set('invoice_number')} />
              </label>
              <label className="flex h-11 items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                <input type="checkbox" className="h-5 w-5" checked={form.invoice_received} onChange={(e) => setForm((f) => ({ ...f, invoice_received: e.target.checked }))} />
                Facture reçue
              </label>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">Facture (photo ou PDF)</div>
              <div className="flex flex-wrap gap-3">
                {invoiceExisting.map((a) => (
                  <Thumb key={a.id} deliveryId={delivery!.id} attachment={a} onRemove={() => removeExisting.mutate(a)} />
                ))}
                {invoiceFiles.map((f, i) => (
                  <div key={f.url} className="relative">
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                      {f.file.type.startsWith('image/') ? <img src={f.url} alt={f.file.name} className="h-full w-full object-cover" /> : <FileText size={22} className="text-slate-400" />}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(f.url);
                        setInvoiceFiles((list) => list.filter((_, j) => j !== i));
                      }}
                      className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white shadow"
                      title="Retirer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => invoiceRef.current?.click()}
                  className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-amber-300 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-400 dark:hover:bg-amber-500/10"
                >
                  <FileText size={24} /> {invoiceCount ? 'Autre page' : 'Ajouter la facture'}
                </button>
              </div>
              <input ref={invoiceRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => (void addFiles(e.target.files, 'facture'), (e.target.value = ''))} />
            </div>
          </section>
        )}

        <section className="rounded-2xl bg-slate-50 dark:bg-slate-800/50">
          <button type="button" onClick={() => setMore((m) => !m)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
            <span className="flex-1">
              <span className="block font-semibold text-slate-700 dark:text-slate-200">Autres informations</span>
              <span className="block text-sm text-slate-500 dark:text-slate-400">
                {fmtDate(form.date)} · {form.time || '—'} · {form.pompiste_name}
              </span>
            </span>
            <ChevronDown className={clsx('text-slate-400 transition-transform', more && 'rotate-180')} />
          </button>
          {more && (
            <div className="space-y-3 px-4 pb-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Date de livraison
                  <input type="date" max={todayIso()} className={clsx(smallInput, 'mt-1')} value={form.date} onChange={set('date')} />
                </label>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Heure
                  <input type="time" className={clsx(smallInput, 'mt-1')} value={form.time} onChange={set('time')} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Camion-citerne
                  <input className={clsx(smallInput, 'mt-1')} placeholder="8828-B-7" value={form.truck} onChange={set('truck')} autoCapitalize="characters" />
                </label>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Chauffeur
                  <input className={clsx(smallInput, 'mt-1')} value={form.driver_name} onChange={set('driver_name')} />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                Pompiste
                <input className={clsx(smallInput, 'mt-1')} value={form.pompiste_name} onChange={set('pompiste_name')} />
              </label>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                Remarque
                <input className={clsx(smallInput, 'mt-1')} value={form.remark} onChange={set('remark')} />
              </label>
            </div>
          )}
        </section>
      </div>
    </Sheet>
  );
}
