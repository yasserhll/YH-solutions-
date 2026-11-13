import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  FileText,
  Gauge,
  Keyboard,
  Loader2,
  Paperclip,
  Pencil,
  QrCode,
  Search,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useAuth } from '../contexts/AuthContext';
import type { BonAttachment, BonTank, BonVehicle, FuelBon, FuelBonPage } from '../types';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, LoadingState } from '../components/ui/States';
import { QrScanner } from '../components/QrScanner';

/*
 * "Bons carburant" — built for a pompiste with only a phone:
 *   1. choose the citerne once (remembered on the phone);
 *   2. two big buttons: Scanner le QR / Saisie manuelle;
 *   3. a full-screen form with big fields, in the order the paper bon is
 *      filled; date, heure, société… are pre-filled and tucked away.
 * A responsable / SuperAdmin also gets the citerne's full history (table).
 */

const numFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : numFmt.format(v));
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
const plateKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s-]/g, '');
const parcOf = (v: BonVehicle) => v.fleet_code ?? v.code;
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
    /* private mode: nothing to remember */
  }
};

/** The companies printed on the paper bon (TRANSWIN / LAHLAL / LEL / AUTRES …). */
const COMPANIES = ['TRANSWIN', 'LAHLAL', 'LEL'] as const;

/** 1er shift by day, 2ème shift by night (a bon at 04:29 is the night shift's driver). */
const shiftOf = (time: string) => {
  const h = Number(time.slice(0, 2));
  return Number.isNaN(h) ? 1 : h >= 6 && h < 18 ? 1 : 2;
};

/** The vehicle a scanned QR points to: the Matériel labels hold "Code parc : …" / "Immatriculation : …"; a bare code or plate works too. */
function matchQr(text: string, vehicles: BonVehicle[]): { vehicle: BonVehicle | null; parc: string | null } {
  const line = (re: RegExp) =>
    text
      .split(/\r?\n/)
      .map((l) => l.match(re)?.[1]?.trim())
      .find(Boolean) ?? null;
  const parc = line(/^code parc\s*:\s*(.+)$/i);
  const plate = line(/^immatriculation\s*:\s*(.+)$/i);
  const raw = text.trim().toUpperCase();
  const vehicle =
    (parc && vehicles.find((v) => v.site_id !== null && parcOf(v).toUpperCase() === parc.toUpperCase())) ||
    (parc && vehicles.find((v) => parcOf(v).toUpperCase() === parc.toUpperCase())) ||
    (plate && plate !== '-' && vehicles.find((v) => plateKey(v.matricule) === plateKey(plate))) ||
    vehicles.find((v) => [v.code, v.fleet_code ?? '', v.matricule ?? ''].some((c) => c && plateKey(c) === plateKey(raw))) ||
    null;
  return { vehicle, parc: parc ?? (raw.length <= 30 && !raw.includes('\n') ? raw : null) };
}

/** Phone photos are 3–6 MB: shrink to ~1600 px JPEG before sending (keeps the original if it can't be read). */
async function compress(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

type FormOpen = { bon: FuelBon | null; vehicle: BonVehicle | null; scannedCode?: string | null };

export default function BonsPage() {
  const siteParams = useSiteParams();
  const { user } = useAuth();
  const isPompiste = user?.role === 'pompiste';
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [day, setDay] = useState(todayIso());
  const [form, setForm] = useState<FormOpen | null>(null);
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState<FuelBon | null>(null);
  const [viewing, setViewing] = useState<FuelBon | null>(null);

  const { data: tanks, isLoading: tanksLoading } = useQuery({
    queryKey: ['bons', 'tanks', siteParams],
    queryFn: () => api.get<BonTank[]>('/bons/tanks', { params: siteParams }).then((r) => r.data),
  });

  const urlTank = Number(params.get('citerne')) || null;
  const tankId = urlTank ?? (tanks?.length === 1 ? tanks[0].id : remembered());
  const tank = tanks?.find((t) => t.id === tankId) ?? null;
  const chooseTank = (id: number | null) => {
    remember(id);
    setParams(id ? { citerne: String(id) } : { choisir: '1' });
  };
  const choosing = params.get('choisir') === '1' || !tank;

  const { data: vehicles = [] } = useQuery({
    queryKey: ['bons', 'vehicles', tank?.id],
    queryFn: () => api.get<BonVehicle[]>('/bons/vehicles', { params: { fuel_tank_id: tank!.id } }).then((r) => r.data),
    enabled: !!tank,
    staleTime: 5 * 60_000,
  });

  const dayParams = { fuel_tank_id: tank?.id, date_from: day, date_to: day, per_page: 200 };
  const { data: dayList, isLoading: dayLoading } = useQuery({
    queryKey: ['bons', 'list', dayParams],
    queryFn: () => api.get<FuelBonPage>('/bons', { params: dayParams }).then((r) => r.data),
    enabled: !!tank && !choosing,
  });

  const remove = useMutation({
    mutationFn: (bon: FuelBon) => api.delete(`/bons/${bon.id}`),
    onSuccess: () => {
      toast.success('Bon supprimé');
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['bons'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const canEdit = useCallback((bon: FuelBon) => bon.origin === 'bon' && (!isPompiste || bon.created_by === user?.id), [isPompiste, user?.id]);

  const onScan = useCallback(
    (text: string) => {
      setScanning(false);
      const { vehicle, parc } = matchQr(text, vehicles);
      if (vehicle) {
        toast.success(`Véhicule ${parcOf(vehicle)} reconnu`);
        setForm({ bon: null, vehicle });
      } else if (parc) {
        toast.error(`${parc} n'est pas dans le matériel : vérifiez le code.`);
        setForm({ bon: null, vehicle: null, scannedCode: parc });
      } else {
        toast.error("Ce QR code n'est pas celui d'un véhicule.");
      }
    },
    [vehicles],
  );

  if (tanksLoading) return <LoadingState />;
  if (!tanks?.length)
    return <EmptyState message="Aucune citerne sur votre site. Les citernes sont créées par l'import de leur fichier Excel (Consommation → Citernes)." />;

  // Step 1 — which citerne am I working on?
  if (choosing)
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Bons carburant</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">Touchez la citerne sur laquelle vous travaillez.</p>
        </div>
        <div className="space-y-3">
          {tanks.map((t) => (
            <button
              key={t.id}
              onClick={() => chooseTank(t.id)}
              className="flex w-full items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left active:scale-[0.99] active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400">
                <Container size={28} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold text-slate-900 dark:text-slate-100">{t.name}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">
                  {t.site.name} · série <span className="font-mono">{fmt(t.last_serie)}</span>
                </span>
              </span>
              <span className="text-right text-sm text-slate-500 dark:text-slate-400">
                <span className="block text-lg font-semibold text-slate-900 dark:text-slate-100">{t.today_count}</span>
                bon{t.today_count > 1 ? 's' : ''} auj.
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  const bons = dayList?.data ?? [];

  // Step 2 — scan or type, and today's bons of this citerne.
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3 rounded-2xl bg-slate-900 p-4 text-white dark:bg-slate-800">
        <Container size={30} className="shrink-0 text-orange-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{tank!.name}</div>
          <div className="text-sm text-slate-300">
            {tank!.site.name} · série actuelle <span className="font-mono font-semibold text-white">{fmt(dayList?.last_serie ?? tank!.last_serie)}</span>
          </div>
        </div>
        {tanks.length > 1 && (
          <button onClick={() => chooseTank(null)} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium active:bg-white/20">
            <ArrowLeftRight size={16} /> Changer
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-xl">
        <button
          onClick={() => setScanning(true)}
          className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/20 active:scale-[0.98] active:bg-orange-600"
        >
          <QrCode size={40} />
          <span className="text-lg font-bold">Scanner le QR</span>
        </button>
        <button
          onClick={() => setForm({ bon: null, vehicle: null })}
          className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-white text-slate-800 active:scale-[0.98] active:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <Keyboard size={40} />
          <span className="text-lg font-bold">Saisie manuelle</span>
        </button>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {day === todayIso() ? "Bons d'aujourd'hui" : `Bons du ${fmtDate(day)}`}
            {dayList && (
              <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                {dayList.totals.count} · {fmt(dayList.totals.litres)} L
              </span>
            )}
          </h2>
          <input
            type="date"
            value={day}
            max={todayIso()}
            onChange={(e) => setDay(e.target.value || todayIso())}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        {dayLoading ? (
          <LoadingState />
        ) : bons.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-500 dark:border-slate-800 dark:text-slate-400">Aucun bon pour ce jour.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {bons.map((b) => (
              <BonCard
                key={b.id}
                bon={b}
                editable={canEdit(b)}
                onEdit={() => setForm({ bon: b, vehicle: null })}
                onDelete={() => setDeleting(b)}
                onProofs={() => setViewing(b)}
              />
            ))}
          </div>
        )}
      </section>

      {!isPompiste && <HistoryTable tank={tank!} canEdit={canEdit} onEdit={(b) => setForm({ bon: b, vehicle: null })} onDelete={setDeleting} onProofs={setViewing} />}

      {form && (
        <BonForm
          key={form.bon?.id ?? 'new'}
          tank={tank!}
          vehicles={vehicles}
          bon={form.bon}
          initialVehicle={form.vehicle}
          scannedCode={form.scannedCode ?? null}
          onClose={() => setForm(null)}
        />
      )}
      <QrScanner open={scanning} onClose={() => setScanning(false)} onResult={onScan} />
      {viewing && <AttachmentsModal bon={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Supprimer ce bon ?"
        message={`Le bon n° ${deleting?.bon_number ?? ''} (${deleting?.fleet_code ?? deleting?.vehicle_code ?? ''}, ${fmt(deleting?.quantity)} L) et ses photos seront supprimés.`}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
        isLoading={remove.isPending}
      />
    </div>
  );
}

function BonCard({ bon, editable, onEdit, onDelete, onProofs }: { bon: FuelBon; editable: boolean; onEdit: () => void; onDelete: () => void; onProofs: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-sm font-bold text-white dark:bg-white dark:text-slate-900">{bon.fleet_code ?? bon.vehicle_code ?? '—'}</span>
            <span className="font-mono text-sm font-semibold text-red-600 dark:text-red-400">N° {bon.bon_number ?? '—'}</span>
          </div>
          <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
            {hhmm(bon.time) || '—'} · {bon.driver_name ?? 'conducteur non saisi'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmt(bon.quantity)}</div>
          <div className="text-xs text-slate-400">litres</div>
        </div>
      </div>
      <div className="mt-2 font-mono text-xs text-slate-400 dark:text-slate-500">
        {fmt(bon.serie_start)} → {fmt(bon.serie_end)}
        {bon.odometer !== null && <span> · compteur {fmt(bon.odometer)}</span>}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        {bon.origin === 'bon' ? (
          <button onClick={onProofs} disabled={!bon.attachments_count} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-sky-600 active:bg-sky-50 disabled:text-slate-400 dark:text-sky-400">
            <Paperclip size={16} /> {bon.attachments_count} photo{bon.attachments_count > 1 ? 's' : ''}
          </button>
        ) : (
          <span className="text-xs text-slate-400">Ligne du fichier Excel</span>
        )}
        <span className="flex-1" />
        {editable && (
          <>
            <button onClick={onEdit} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800">
              <Pencil size={15} /> Modifier
            </button>
            <button onClick={onDelete} title="Supprimer" className="rounded-lg p-2 text-slate-400 active:bg-red-50 active:text-red-600">
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** A responsable's view: every sortie of the citerne, laid out like its Excel sheet. */
function HistoryTable({
  tank,
  canEdit,
  onEdit,
  onDelete,
  onProofs,
}: {
  tank: BonTank;
  canEdit: (b: FuelBon) => boolean;
  onEdit: (b: FuelBon) => void;
  onDelete: (b: FuelBon) => void;
  onProofs: (b: FuelBon) => void;
}) {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bonsOnly, setBonsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const listParams = { fuel_tank_id: tank.id, search: search || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, bons_only: bonsOnly ? 1 : undefined, page };
  const { data: list, isLoading } = useQuery({
    queryKey: ['bons', 'list', listParams],
    queryFn: () => api.get<FuelBonPage>('/bons', { params: listParams }).then((r) => r.data),
  });

  const columns: Column<FuelBon>[] = [
    { header: 'Date', className: 'whitespace-nowrap', accessor: (b) => fmtDate(b.date) },
    { header: 'N° de bon', className: 'whitespace-nowrap', accessor: (b) => <span className="font-mono font-semibold text-red-600 dark:text-red-400">{b.bon_number ?? '—'}</span> },
    { header: 'Heure', accessor: (b) => hhmm(b.time) || '—' },
    {
      header: 'Code',
      className: 'whitespace-nowrap',
      accessor: (b) => <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white dark:bg-white dark:text-slate-900">{b.fleet_code ?? b.vehicle_code ?? '—'}</span>,
    },
    { header: 'Immatriculation', className: 'whitespace-nowrap font-mono text-xs', accessor: (b) => b.matricule ?? '—' },
    { header: 'Compteur', className: 'text-right tabular-nums', accessor: (b) => fmt(b.odometer) },
    { header: 'Qte (L)', className: 'text-right font-semibold tabular-nums', accessor: (b) => fmt(b.quantity) },
    { header: 'Série départ', className: 'text-right tabular-nums', accessor: (b) => fmt(b.serie_start) },
    { header: 'Série fin', className: 'text-right tabular-nums', accessor: (b) => fmt(b.serie_end) },
    { header: 'Conducteur', accessor: (b) => <span className="block max-w-[180px] truncate">{b.driver_name ?? '—'}</span> },
    { header: 'Remarque', accessor: (b) => <span className="line-clamp-2 max-w-[160px] text-xs">{b.remark ?? ''}</span> },
    {
      header: 'Saisie',
      accessor: (b) =>
        b.origin === 'bon' ? (
          <span className="whitespace-nowrap text-xs font-semibold text-orange-600 dark:text-orange-400">Bon · {b.pompiste_name ?? b.creator_name}</span>
        ) : (
          <span className="text-xs text-slate-400">{b.origin === 'import' ? 'Fichier Excel' : 'Global'}</span>
        ),
    },
    {
      header: '',
      className: 'text-right whitespace-nowrap',
      accessor: (b) => (
        <div className="flex items-center justify-end gap-1">
          {b.attachments_count > 0 && (
            <button onClick={() => onProofs(b)} title="Voir les photos" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10">
              <Paperclip size={14} /> {b.attachments_count}
            </button>
          )}
          {canEdit(b) && (
            <>
              <button onClick={() => onEdit(b)} title="Modifier" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <Pencil size={15} />
              </button>
              <button onClick={() => onDelete(b)} title="Supprimer" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400">
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];
  const resetPage = () => setPage(1);

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Historique de la citerne</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <SearchInput placeholder="N° de bon, code, immatriculation, conducteur…" value={search} onChange={(e) => (setSearch(e.target.value), resetPage())} />
          </div>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Du
            <input type="date" value={dateFrom} onChange={(e) => (setDateFrom(e.target.value), resetPage())} className="ml-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            au
            <input type="date" value={dateTo} onChange={(e) => (setDateTo(e.target.value), resetPage())} className="ml-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={bonsOnly} onChange={(e) => (setBonsOnly(e.target.checked), resetPage())} className="rounded border-slate-300" />
            Bons saisis seulement
          </label>
        </div>
        {list && (
          <div className="mt-3 flex flex-wrap gap-x-6 text-sm text-slate-500 dark:text-slate-400">
            <span>
              <b className="text-slate-900 dark:text-slate-100">{numFmt.format(list.totals.count)}</b> sorties
            </span>
            <span>
              <b className="text-slate-900 dark:text-slate-100">{fmt(list.totals.litres)}</b> L
            </span>
          </div>
        )}
      </div>
      <DataTable columns={columns} rows={list?.data ?? []} isLoading={isLoading} keyFn={(b) => b.id} emptyMessage="Aucune sortie pour ces filtres." />
      {list && (
        <div className="px-4 pb-4">
          <Pagination page={list.current_page} lastPage={list.last_page} total={list.total} onPageChange={setPage} />
        </div>
      )}
    </section>
  );
}

/** A proof file, fetched with the user's token (proofs are never public). */
function AttachmentThumb({ bonId, attachment, onRemove }: { bonId: number; attachment: BonAttachment; onRemove?: () => void }) {
  const { data: url, isLoading } = useQuery({
    queryKey: ['bons', 'file', attachment.id],
    queryFn: () => api.get<Blob>(`/bons/${bonId}/attachments/${attachment.id}`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data)),
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

function AttachmentsModal({ bon, onClose }: { bon: FuelBon; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['bons', 'attachments', bon.id],
    queryFn: () => api.get<BonAttachment[]>(`/bons/${bon.id}/attachments`).then((r) => r.data),
  });
  return (
    <Modal open onClose={onClose} title={`Photos du bon n° ${bon.bon_number ?? ''}`}>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        {bon.fleet_code ?? bon.vehicle_code} · {fmt(bon.quantity)} L · {fmtDate(bon.date)} {hhmm(bon.time)} — touchez une photo pour l'agrandir.
      </p>
      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="flex flex-wrap gap-3">
          {data?.map((a) => (
            <AttachmentThumb key={a.id} bonId={bon.id} attachment={a} />
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Full screen on a phone, a centred panel on a computer; the save button always visible at the bottom. */
function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[65] flex justify-center bg-slate-900/50 sm:items-center sm:p-4">
      <div className="flex h-full w-full flex-col bg-white shadow-xl dark:bg-slate-900 sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] dark:border-slate-800 sm:pt-3">
          <button onClick={onClose} className="-ml-1 rounded-lg p-2 text-slate-500 active:bg-slate-100 dark:active:bg-slate-800" aria-label="Fermer">
            <X size={22} />
          </button>
          <h2 className="flex-1 truncate text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        <div className="border-t border-slate-200 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 dark:border-slate-800">{footer}</div>
      </div>
    </div>
  );
}

const bigInput =
  'h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-xl font-semibold tabular-nums text-slate-900 focus:border-orange-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const smallInput =
  'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

function Big({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      {children}
      {hint}
    </label>
  );
}

interface FormState {
  bon_number: string;
  date: string;
  time: string;
  company: string;
  company_other: string;
  vehicle_code: string;
  odometer: string;
  serie_start: string;
  serie_end: string;
  quantity: string;
  driver_name: string;
  driver_cin: string;
  pompiste_name: string;
  remark: string;
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));
const clean = (v: string) => v.replace(',', '.').replace(/\s/g, '');
const num = (v: string) => (clean(v) === '' ? null : Number(clean(v)));

/**
 * The paper BON, in the order the pompiste fills it: véhicule (scanned or
 * picked), n° du bon, séries, litres (computed), compteur, conducteur, photo.
 * Date / heure / société / pompiste are pre-filled under "Autres informations".
 */
function BonForm({
  tank,
  vehicles,
  bon,
  initialVehicle,
  scannedCode,
  onClose,
}: {
  tank: BonTank;
  vehicles: BonVehicle[];
  bon: FuelBon | null;
  initialVehicle: BonVehicle | null;
  scannedCode: string | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const known = bon?.company && (COMPANIES as readonly string[]).includes(bon.company);
  const startTime = bon ? hhmm(bon.time) : nowHhmm();
  const firstDriver = (v: BonVehicle | null) => (v ? (shiftOf(startTime) === 1 ? (v.driver_1 ?? v.driver_2) : (v.driver_2 ?? v.driver_1)) : null);
  const [form, setForm] = useState<FormState>({
    bon_number: str(bon?.bon_number),
    date: bon?.date ?? todayIso(),
    time: startTime,
    company: bon ? (bon.company ? (known ? bon.company : 'AUTRES') : '') : 'TRANSWIN',
    company_other: bon?.company && !known ? bon.company : '',
    vehicle_code: bon ? str(bon.vehicle_code) : (initialVehicle?.code ?? scannedCode ?? ''),
    odometer: str(bon?.odometer),
    serie_start: bon ? str(bon.serie_start) : str(tank.last_serie),
    serie_end: str(bon?.serie_end),
    quantity: str(bon?.quantity),
    driver_name: bon ? str(bon.driver_name) : (firstDriver(initialVehicle) ?? ''),
    driver_cin: str(bon?.driver_cin),
    pompiste_name: bon?.pompiste_name ?? user?.name ?? '',
    remark: str(bon?.remark),
  });
  const [litresTouched, setLitresTouched] = useState(!!bon);
  const [vehicle, setVehicle] = useState<BonVehicle | null>(initialVehicle ?? (bon ? (vehicles.find((v) => v.code === bon.vehicle_code) ?? null) : null));
  const [outOfPark, setOutOfPark] = useState(!!scannedCode || (!!bon && !vehicles.some((v) => v.code === bon.vehicle_code)));
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [more, setMore] = useState(false);
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bonRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // A scanned / picked vehicle → straight to the n° du bon.
  useEffect(() => {
    if (!bon && vehicle) bonRef.current?.focus();
  }, [bon, vehicle]);

  const { data: existing = [] } = useQuery({
    queryKey: ['bons', 'attachments', bon?.id],
    queryFn: () => api.get<BonAttachment[]>(`/bons/${bon!.id}/attachments`).then((r) => r.data),
    enabled: !!bon,
  });

  const code = form.vehicle_code.trim();
  const { data: last } = useQuery({
    queryKey: ['bons', 'last', tank.id, code, bon?.id],
    queryFn: () =>
      api
        .get<{ date: string; time: string | null; odometer: number | null; quantity: number } | null>('/bons/last-refuel', {
          params: { fuel_tank_id: tank.id, vehicle_code: code, except: bon?.id },
        })
        .then((r) => r.data || null),
    enabled: code !== '',
  });

  // Litres = série fin − série départ, as on the pump, until typed by hand.
  const start = num(form.serie_start);
  const end = num(form.serie_end);
  const pumped = start !== null && end !== null && !Number.isNaN(start) && !Number.isNaN(end) ? Math.round((end - start) * 100) / 100 : null;
  useEffect(() => {
    if (!litresTouched && pumped !== null && pumped > 0) setForm((f) => ({ ...f, quantity: String(pumped) }));
  }, [pumped, litresTouched]);

  const quantity = num(form.quantity);
  const litresMismatch = pumped !== null && quantity !== null && Math.abs(pumped - quantity) > 0.5;
  const endBeforeStart = pumped !== null && pumped < 0;
  const serieGap = !bon && tank.last_serie !== null && start !== null && Math.abs(start - tank.last_serie) > 0.001;
  const odometer = num(form.odometer);
  const odometerBack = odometer !== null && last?.odometer != null && odometer < last.odometer;

  const pickVehicle = (v: BonVehicle) => {
    setVehicle(v);
    setOutOfPark(false);
    setVehicleSearch('');
    const driver = shiftOf(form.time) === 1 ? (v.driver_1 ?? v.driver_2) : (v.driver_2 ?? v.driver_1);
    setForm((f) => ({ ...f, vehicle_code: v.code, driver_name: driver ?? f.driver_name }));
  };

  const onScan = useCallback(
    (text: string) => {
      setScanning(false);
      const { vehicle: found, parc } = matchQr(text, vehicles);
      if (found) {
        toast.success(`Véhicule ${parcOf(found)} reconnu`);
        setVehicle(found);
        setOutOfPark(false);
        setForm((f) => ({ ...f, vehicle_code: found.code, driver_name: (shiftOf(f.time) === 1 ? (found.driver_1 ?? found.driver_2) : (found.driver_2 ?? found.driver_1)) ?? f.driver_name }));
      } else {
        toast.error(parc ? `${parc} n'est pas dans le matériel : vérifiez le code.` : "Ce QR code n'est pas celui d'un véhicule.");
        if (parc) {
          setVehicle(null);
          setOutOfPark(true);
          setForm((f) => ({ ...f, vehicle_code: parc }));
        }
      }
    },
    [vehicles],
  );

  const results = useMemo(() => {
    const q = plateKey(vehicleSearch);
    if (!q) return [];
    return vehicles.filter((v) => [parcOf(v), v.code, v.matricule ?? ''].some((s) => plateKey(s).includes(q))).slice(0, 8);
  }, [vehicleSearch, vehicles]);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const picked = await Promise.all(Array.from(list).map(compress));
    setFiles((f) => [...f, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10));
  };
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  const removeExisting = useMutation({
    mutationFn: (a: BonAttachment) => api.delete(`/bons/${bon!.id}/attachments/${a.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bons'] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const buildBody = () => {
    const body = new FormData();
    const company = form.company === 'AUTRES' ? form.company_other.trim() || 'AUTRES' : form.company;
    const fields: Record<string, string> = {
      fuel_tank_id: String(tank.id),
      bon_number: form.bon_number,
      date: form.date,
      time: form.time,
      company,
      vehicle_code: form.vehicle_code,
      odometer: clean(form.odometer),
      serie_start: clean(form.serie_start),
      serie_end: clean(form.serie_end),
      quantity: clean(form.quantity),
      driver_name: form.driver_name,
      driver_cin: form.company === 'TRANSWIN' ? '' : form.driver_cin,
      pompiste_name: form.pompiste_name,
      remark: form.remark,
    };
    Object.entries(fields).forEach(([k, v]) => body.append(k, v.trim()));
    files.forEach(({ file }) => body.append('attachments[]', file));
    return body;
  };

  const save = useMutation({
    mutationFn: () => api.post(bon ? `/bons/${bon.id}` : '/bons', buildBody()),
    onSuccess: () => {
      toast.success(bon ? 'Bon modifié' : 'Bon enregistré');
      queryClient.invalidateQueries({ queryKey: ['bons'] });
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Le bon n'a pas pu être enregistré."), { duration: 6000 }),
  });

  const proofCount = files.length + existing.length;
  const missing = [
    !form.vehicle_code.trim() && 'le véhicule',
    !form.bon_number.trim() && 'le n° du bon',
    (quantity === null || !(quantity > 0)) && 'les litres',
    proofCount === 0 && 'la photo du bon',
  ].filter(Boolean) as string[];

  const submit = () => {
    if (missing.length) return toast.error(`Il manque ${missing.join(', ')}.`);
    if (litresMismatch || endBeforeStart) return toast.error('Les litres ne correspondent pas aux séries.');
    if (!navigator.onLine) {
      // The PWA keeps the request and sends it when the network is back.
      api.post(bon ? `/bons/${bon.id}` : '/bons', buildBody()).catch(() => undefined);
      toast('Pas de réseau : le bon sera envoyé tout seul dès le retour du réseau. Vérifiez-le ensuite dans la liste.', { icon: '📶', duration: 7000 });
      onClose();
      return;
    }
    save.mutate();
  };

  const sectionTitle = 'mb-2 text-sm font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500';

  return (
    <>
      <Sheet
        title={bon ? `Modifier le bon n° ${bon.bon_number ?? ''}` : `Nouveau bon · ${tank.name}`}
        onClose={onClose}
        footer={
          <button
            onClick={submit}
            disabled={save.isPending}
            className={clsx(
              'flex h-14 w-full items-center justify-center gap-2 rounded-xl text-lg font-bold text-white active:scale-[0.99]',
              missing.length || litresMismatch || endBeforeStart ? 'bg-slate-400 dark:bg-slate-700' : 'bg-emerald-600 active:bg-emerald-700',
            )}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {bon ? 'Enregistrer' : 'Enregistrer le bon'}
          </button>
        }
      >
        <div className="space-y-6">
          {/* 1. Véhicule */}
          <section>
            <div className={sectionTitle}>1 · Véhicule</div>
            {vehicle ? (
              <div className="flex items-center gap-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10">
                <Truck size={30} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{parcOf(vehicle)}</div>
                  <div className="truncate font-mono text-sm text-slate-600 dark:text-slate-300">{vehicle.matricule}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {[vehicle.type, vehicle.site_name && vehicle.site_name !== tank.site.name ? `site ${vehicle.site_name}` : null].filter(Boolean).join(' · ')}
                    {vehicle.status !== 'en_service' && (
                      <span className="ml-1 font-semibold text-amber-600">({vehicle.status === 'en_panne' ? 'en panne' : vehicle.status === 'deplacement' ? 'en déplacement' : 'hors service'})</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setVehicle(null);
                    setForm((f) => ({ ...f, vehicle_code: '' }));
                  }}
                  className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 active:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600"
                >
                  Changer
                </button>
              </div>
            ) : outOfPark ? (
              <div className="space-y-2">
                <input className={bigInput} placeholder="Code ou matricule du véhicule" value={form.vehicle_code} onChange={set('vehicle_code')} autoCapitalize="characters" />
                <button type="button" onClick={() => setOutOfPark(false)} className="py-1 text-sm font-medium text-sky-600 dark:text-sky-400">
                  ← Chercher dans le matériel
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setScanning(true)}
                  className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-orange-500 text-lg font-bold text-white active:bg-orange-600"
                >
                  <QrCode size={28} /> Scanner le QR du véhicule
                </button>
                <div className="relative">
                  <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className={clsx(bigInput, 'pl-12 text-lg font-medium')}
                    placeholder="ou tapez le code : D265, E43…"
                    value={vehicleSearch}
                    onChange={(e) => setVehicleSearch(e.target.value)}
                    autoCapitalize="characters"
                  />
                </div>
                {results.length > 0 && (
                  <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                    {results.map((v) => (
                      <button key={v.id} type="button" onClick={() => pickVehicle(v)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-100 dark:active:bg-slate-800">
                        <span className="text-lg font-bold text-slate-900 dark:text-slate-100">{parcOf(v)}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">{v.matricule}</span>
                        <span className="text-xs text-slate-400">{v.site_name ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                {vehicleSearch && results.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Aucun véhicule trouvé.{' '}
                    <button
                      type="button"
                      className="font-semibold text-sky-600 dark:text-sky-400"
                      onClick={() => {
                        setOutOfPark(true);
                        setForm((f) => ({ ...f, vehicle_code: vehicleSearch.toUpperCase() }));
                      }}
                    >
                      Utiliser « {vehicleSearch.toUpperCase()} »
                    </button>
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 2. Bon et pompe */}
          <section className="space-y-4">
            <div className={sectionTitle}>2 · Le bon</div>
            <Big label="N° du bon">
              <input
                ref={bonRef}
                className={clsx(bigInput, 'font-mono tracking-widest text-red-600 dark:text-red-400')}
                inputMode="numeric"
                placeholder="0075951"
                value={form.bon_number}
                onChange={set('bon_number')}
              />
            </Big>
            <div className="grid grid-cols-2 gap-3">
              <Big label="Série départ">
                <input className={bigInput} inputMode="decimal" value={form.serie_start} onChange={set('serie_start')} />
              </Big>
              <Big label="Série fin">
                <input className={bigInput} inputMode="decimal" value={form.serie_end} onChange={set('serie_end')} />
              </Big>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Big label="Litres">
                <input
                  className={clsx(bigInput, litresMismatch && 'border-red-500 dark:border-red-500', pumped !== null && !litresMismatch && quantity !== null && 'border-emerald-500 dark:border-emerald-500')}
                  inputMode="decimal"
                  value={form.quantity}
                  onChange={(e) => {
                    setLitresTouched(true);
                    set('quantity')(e);
                  }}
                />
              </Big>
              <Big label="Compteur">
                <input className={clsx(bigInput, odometerBack && 'border-amber-500 dark:border-amber-500')} inputMode="decimal" value={form.odometer} onChange={set('odometer')} />
              </Big>
            </div>
            <div className="space-y-1.5 text-sm">
              {pumped !== null && !litresMismatch && !endBeforeStart && quantity !== null && (
                <p className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={16} /> Litres calculés : fin − départ = {fmt(pumped)} L
                </p>
              )}
              {(litresMismatch || endBeforeStart) && (
                <p className="flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400">
                  <AlertTriangle size={16} /> {endBeforeStart ? 'La série fin est plus petite que la série départ.' : `Les litres ne correspondent pas : fin − départ = ${fmt(pumped)} L.`}
                </p>
              )}
              {serieGap && (
                <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={16} /> La dernière série fin était {fmt(tank.last_serie)}.
                </p>
              )}
              {last && (
                <p className={clsx('flex items-center gap-1.5', odometerBack ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400')}>
                  <Gauge size={16} /> Dernier plein : compteur {fmt(last.odometer)} le {fmtDate(last.date)}
                  {odometerBack && ' (plus grand que le compteur saisi)'}
                </p>
              )}
            </div>
          </section>

          {/* 3. Conducteur */}
          <section>
            <div className={sectionTitle}>3 · Conducteur</div>
            {vehicle && (vehicle.driver_1 || vehicle.driver_2) && (
              <div className="mb-2 grid gap-2">
                {(
                  [
                    ['1er shift', vehicle.driver_1],
                    ['2ème shift', vehicle.driver_2],
                  ] as const
                )
                  .filter(([, name]) => name)
                  .map(([label, name]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, driver_name: name ?? '' }))}
                      className={clsx(
                        'flex items-center justify-between rounded-xl px-4 py-3 text-left ring-2',
                        form.driver_name === name ? 'bg-sky-600 text-white ring-sky-600' : 'bg-white text-slate-700 ring-slate-200 active:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
                      )}
                    >
                      <span className="font-semibold">{name}</span>
                      <span className="text-xs opacity-80">{label}</span>
                    </button>
                  ))}
              </div>
            )}
            <input className={smallInput} placeholder="Nom du conducteur" value={form.driver_name} onChange={set('driver_name')} />
          </section>

          {/* 4. Photo */}
          <section>
            <div className={sectionTitle}>4 · Photo du bon</div>
            {proofCount === 0 ? (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-orange-400 bg-orange-50 text-orange-700 active:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-300"
              >
                <Camera size={34} />
                <span className="text-lg font-bold">Prendre la photo du bon</span>
              </button>
            ) : (
              <div className="flex flex-wrap gap-3">
                {existing.map((a) => (
                  <AttachmentThumb key={a.id} bonId={bon!.id} attachment={a} onRemove={() => removeExisting.mutate(a)} />
                ))}
                {files.map((f, i) => (
                  <div key={f.url} className="relative">
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      {f.file.type.startsWith('image/') ? (
                        <img src={f.url} alt={f.file.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center gap-1 p-1 text-[10px] text-slate-500">
                          <FileText size={22} /> <span className="line-clamp-2 break-all">{f.file.name}</span>
                        </div>
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

          {/* Autres informations (pre-filled) */}
          <section className="rounded-2xl bg-slate-50 dark:bg-slate-800/50">
            <button type="button" onClick={() => setMore((m) => !m)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
              <span className="flex-1">
                <span className="block font-semibold text-slate-700 dark:text-slate-200">Autres informations</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">
                  {fmtDate(form.date)} · {form.time || '—'} · {form.company === 'AUTRES' ? form.company_other || 'Autres' : form.company || '—'} · {form.pompiste_name}
                </span>
              </span>
              <ChevronDown className={clsx('text-slate-400 transition-transform', more && 'rotate-180')} />
            </button>
            {more && (
              <div className="space-y-3 px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                    Date du bon
                    <input type="date" max={todayIso()} className={clsx(smallInput, 'mt-1')} value={form.date} onChange={set('date')} />
                  </label>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                    Heure du bon
                    <input type="time" className={clsx(smallInput, 'mt-1')} value={form.time} onChange={set('time')} />
                  </label>
                </div>
                <div>
                  <div className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-300">Société</div>
                  <div className="grid grid-cols-4 gap-2">
                    {[...COMPANIES, 'AUTRES'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, company: c }))}
                        className={clsx(
                          'rounded-lg py-2.5 text-sm font-bold ring-1',
                          form.company === c ? 'bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white' : 'bg-white text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600',
                        )}
                      >
                        {c === 'TRANSWIN' ? 'TRANSWIN' : c}
                      </button>
                    ))}
                  </div>
                  {form.company === 'AUTRES' && <input className={clsx(smallInput, 'mt-2')} placeholder="Nom de la société" value={form.company_other} onChange={set('company_other')} />}
                </div>
                {form.company !== 'TRANSWIN' && (
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                    CIN du conducteur (si autres)
                    <input className={clsx(smallInput, 'mt-1')} value={form.driver_cin} onChange={set('driver_cin')} autoCapitalize="characters" />
                  </label>
                )}
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Pompiste
                  <input className={clsx(smallInput, 'mt-1')} value={form.pompiste_name} onChange={set('pompiste_name')} />
                </label>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Remarque
                  <input className={clsx(smallInput, 'mt-1')} placeholder="ex. S.P" value={form.remark} onChange={set('remark')} />
                </label>
              </div>
            )}
          </section>
        </div>
      </Sheet>
      <QrScanner open={scanning} onClose={() => setScanning(false)} onResult={onScan} />
    </>
  );
}
