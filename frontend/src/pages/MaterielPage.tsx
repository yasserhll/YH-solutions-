import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import QRCode from 'qrcode';
import { Download, Hammer, Loader2, Pencil, Plus, Printer, QrCode, Trash2, Truck, Upload, Car } from 'lucide-react';
import { api, apiErrorMessage, uploadErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useSelectableSites } from '../hooks/useReferenceData';
import { useAuth } from '../contexts/AuthContext';
import type { Equipment, EquipmentPage, EquipmentStatus } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextField } from '../components/ui/Field';

const STATUS: Record<EquipmentStatus, { label: string; badge: string; dot: string }> = {
  en_service: { label: 'En service', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400', dot: 'bg-emerald-500' },
  en_panne: { label: 'En panne', badge: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400', dot: 'bg-red-500' },
  deplacement: { label: 'En déplacement', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400', dot: 'bg-amber-500' },
  hors_service: { label: 'Hors service', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', dot: 'bg-slate-400' },
};

const kindOf = (code: string) => (/^D\d+$/.test(code) ? 'camion' : /^E\d+$/.test(code) ? 'engin' : 'autre');
/** The code parc as written in the company's file. */
const parc = (v: Equipment) => v.fleet_code ?? v.code;

/** Everything about the vehicle, as plain text: any phone camera shows it, even offline. */
function qrText(v: Equipment) {
  return [
    'TRANSWIN MINING - MATÉRIEL',
    `Code parc : ${parc(v)}`,
    `Immatriculation : ${v.matricule ?? '-'}`,
    v.chassis_number ? `N° châssis : ${v.chassis_number}` : null,
    v.type ? `Type : ${v.type}` : null,
    `Site : ${v.site?.name ?? '-'}`,
    `Statut : ${STATUS[v.status]?.label ?? v.status}`,
    v.notes ? `Remarque : ${v.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const qrOptions = { errorCorrectionLevel: 'M' as const, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } };

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Opens a printable sheet of QR labels (one per vehicle) and the print dialog. */
async function printLabels(vehicles: Equipment[]) {
  const win = window.open('', '_blank');
  if (!win) {
    toast.error("Autorisez les fenêtres pop-up pour imprimer les étiquettes.");
    return;
  }
  win.document.write('<p style="font-family:sans-serif">Préparation des étiquettes…</p>');
  const labels = await Promise.all(
    vehicles.map(async (v) => {
      const svg = await QRCode.toString(qrText(v), { ...qrOptions, type: 'svg' });
      return `<div class="label">${svg}<div class="txt"><div class="code">${escapeHtml(parc(v))}</div><div>${escapeHtml(v.matricule ?? '')}</div><div class="muted">${escapeHtml(
        [v.type, v.site?.name].filter(Boolean).join(' · '),
      )}</div></div></div>`;
    }),
  );
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Étiquettes QR matériel</title><style>
    @page { margin: 10mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
    .label { border: 1px solid #cbd5e1; border-radius: 3mm; padding: 3mm; display: flex; gap: 3mm; align-items: center; break-inside: avoid; }
    .label svg { width: 28mm; height: 28mm; flex-shrink: 0; }
    .code { font-size: 15pt; font-weight: 700; }
    .txt { font-size: 9pt; line-height: 1.35; word-break: break-all; }
    .muted { color: #64748b; }
  </style></head><body><div class="grid">${labels.join('')}</div>
  <script>window.onload = () => { window.print(); };<\/script></body></html>`);
  win.document.close();
}

export default function MaterielPage() {
  const siteParams = useSiteParams();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'superadmin';
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [noSite, setNoSite] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Equipment | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Equipment | null>(null);
  const [qrFor, setQrFor] = useState<Equipment | null>(null);
  const [importing, setImporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [report, setReport] = useState<string[] | null>(null);

  const filters = {
    ...(noSite ? { site: 'none' } : siteParams),
    search: search || undefined,
    kind: kind || undefined,
    type: type || undefined,
    status: status || undefined,
  };
  const listQuery = useQuery({
    queryKey: ['materiel', filters, page],
    queryFn: () => api.get<EquipmentPage>('/materiel', { params: { ...filters, page } }).then((r) => r.data),
  });
  const data = listQuery.data;
  const change = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));

  const deleteMutation = useMutation({
    mutationFn: (v: Equipment) => api.delete(`/materiel/${v.id}`),
    onSuccess: () => {
      toast.success('Matériel supprimé.');
      queryClient.invalidateQueries({ queryKey: ['materiel'] });
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  async function importFile(file: File) {
    setImporting(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const { data: r } = await api.post<{ created: number; updated: number; total: number; skipped: string[]; other_sites: number }>('/materiel/import', form);
      toast.success(`${r.total} matériel(s) lus : ${r.created} ajouté(s), ${r.updated} mis à jour.`, { duration: 6000 });
      const lines = [...r.skipped];
      if (r.other_sites) lines.push(`${r.other_sites} ligne(s) d'autres sites ignorée(s) (hors de vos sites).`);
      if (lines.length) setReport(lines);
      queryClient.invalidateQueries({ queryKey: ['materiel'] });
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
    } catch (err) {
      toast.error(uploadErrorMessage(err, file), { duration: 8000 });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function printFiltered() {
    setPrinting(true);
    try {
      const { data: all } = await api.get<EquipmentPage>('/materiel', { params: { ...filters, per_page: 500 } });
      if (all.data.length === 0) toast.error('Aucun matériel à imprimer.');
      else await printLabels(all.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setPrinting(false);
    }
  }

  const columns: Column<Equipment>[] = [
    { header: 'Immatriculation', className: 'whitespace-nowrap', accessor: (v) => <span className="font-mono text-sm">{v.matricule ?? '—'}</span> },
    {
      header: 'Code parc',
      accessor: (v) => {
        const k = kindOf(v.code);
        const Icon = k === 'camion' ? Truck : k === 'engin' ? Hammer : Car;
        return (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <Icon size={15} className={k === 'camion' ? 'text-blue-500' : k === 'engin' ? 'text-purple-500' : 'text-slate-400'} />
            <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white dark:bg-white dark:text-slate-900">{parc(v)}</span>
          </span>
        );
      },
    },
    { header: 'N° de châssis', accessor: (v) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{v.chassis_number ?? '—'}</span> },
    { header: 'Type', className: 'whitespace-nowrap', accessor: (v) => v.type ?? '—' },
    { header: 'Site', className: 'whitespace-nowrap', accessor: (v) => v.site?.name ?? <span className="text-xs text-slate-400">Sans site</span> },
    {
      header: 'Statut',
      accessor: (v) => (
        <div>
          <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATUS[v.status]?.badge)}>
            <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS[v.status]?.dot)} />
            {STATUS[v.status]?.label ?? v.status}
          </span>
          {v.notes && <div className="mt-0.5 max-w-48 truncate text-xs text-slate-400 dark:text-slate-500" title={v.notes}>{v.notes}</div>}
        </div>
      ),
    },
    {
      header: 'Actions',
      accessor: (v) => (
        <div className="flex items-center gap-1">
          <button
            className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            title="Code QR"
            onClick={() => setQrFor(v)}
          >
            <QrCode size={16} />
          </button>
          {(v.site_id !== null || isSuperAdmin) && (
            <>
              <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" title="Modifier" onClick={() => setEditing(v)}>
                <Pencil size={16} />
              </button>
              <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15" title="Supprimer" onClick={() => setDeleting(v)}>
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const selectClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Matériel"
        description="Camions, engins et véhicules de chaque site, avec leur code QR"
        actions={
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing} title="Importer « Affectation de matériels » (.xlsx)">
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Importer
            </Button>
            <Button variant="secondary" onClick={printFiltered} disabled={printing} title="Imprimer les étiquettes QR de la liste affichée">
              {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />} Imprimer les QR
            </Button>
            <Button onClick={() => setEditing(null)}>
              <Plus size={16} /> Ajouter
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => change(setStatus)('')}
          className={clsx(
            'rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition-colors',
            status === '' ? 'bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
          )}
        >
          Tous <span className="ml-1 tabular-nums opacity-70">{data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : ''}</span>
        </button>
        {(Object.keys(STATUS) as EquipmentStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => change(setStatus)(status === s ? '' : s)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition-colors',
              status === s ? 'bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
            )}
          >
            <span className={clsx('h-2 w-2 rounded-full', STATUS[s].dot)} />
            {STATUS[s].label}
            <span className="tabular-nums opacity-70">{data?.counts[s] ?? ''}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-72">
          <SearchInput placeholder="Code, immatriculation, châssis, type…" value={search} onChange={(e) => change(setSearch)(e.target.value)} />
        </div>
        <select value={kind} onChange={(e) => change(setKind)(e.target.value)} className={selectClass}>
          <option value="">Camions, engins et autres</option>
          <option value="camion">Camions (D…)</option>
          <option value="engin">Engins (E…)</option>
          <option value="autre">Autres véhicules</option>
        </select>
        <select value={type} onChange={(e) => change(setType)(e.target.value)} className={selectClass}>
          <option value="">Tous les types</option>
          {data?.types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {isSuperAdmin && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={noSite} onChange={(e) => change(setNoSite)(e.target.checked)} />
            Sans site (anciens codes de la Matriculation)
          </label>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <DataTable
          columns={columns}
          rows={data?.data ?? []}
          isLoading={listQuery.isLoading}
          keyFn={(v) => v.id}
          emptyMessage="Aucun matériel. Importez le fichier « Affectation de matériels » ou ajoutez un véhicule."
        />
        {data && <Pagination page={data.current_page} lastPage={data.last_page} total={data.total} onPageChange={setPage} />}
      </div>

      {editing !== undefined && <EquipmentFormModal vehicle={editing} types={data?.types ?? []} onClose={() => setEditing(undefined)} />}
      {qrFor && <QrModal vehicle={qrFor} onClose={() => setQrFor(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le matériel"
        message={`${deleting ? parc(deleting) : ''} (${deleting?.matricule ?? ''}) sera supprimé de la liste. Ses pleins restent dans Consommation, mais sans immatriculation. Continuer ?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        isLoading={deleteMutation.isPending}
      />

      <Modal open={!!report} onClose={() => setReport(null)} title="Remarques sur l'import">
        <ul className="max-h-80 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-slate-700 dark:text-slate-300">
          {report?.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={() => setReport(null)}>
            Fermer
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function QrModal({ vehicle, onClose }: { vehicle: Equipment; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(qrText(vehicle), { ...qrOptions, width: 720 }).then(setDataUrl);
  }, [vehicle]);

  const rows: [string, string | null][] = [
    ['Immatriculation', vehicle.matricule],
    ['Code parc', parc(vehicle)],
    ['N° de châssis', vehicle.chassis_number],
    ['Type', vehicle.type],
    ['Site', vehicle.site?.name ?? null],
    ['Statut', STATUS[vehicle.status]?.label ?? vehicle.status],
    ['Remarque', vehicle.notes],
  ];

  return (
    <Modal open onClose={onClose} title={`Code QR — ${parc(vehicle)}`}>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700">
          {dataUrl ? <img src={dataUrl} alt={`QR ${parc(vehicle)}`} className="h-52 w-52" /> : <div className="flex h-52 w-52 items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>}
        </div>
        <dl className="w-full space-y-1.5 text-sm">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-slate-100 pb-1.5 dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="break-all text-right font-medium text-slate-900 dark:text-slate-100">{v}</dd>
              </div>
            ))}
          <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">Scanné avec un téléphone, le code affiche toutes ces informations, même sans connexion.</p>
        </dl>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => printLabels([vehicle])}>
          <Printer size={16} /> Imprimer l'étiquette
        </Button>
        {dataUrl && (
          <a
            href={dataUrl}
            download={`qr-${parc(vehicle).replace(/[^A-Za-z0-9-]+/g, '_')}.png`}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <Download size={16} /> Télécharger (PNG)
          </a>
        )}
      </div>
    </Modal>
  );
}

function EquipmentFormModal({ vehicle, types, onClose }: { vehicle: Equipment | null; types: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { sites, needsSiteSelect } = useSelectableSites();
  const [form, setForm] = useState({
    fleet_code: vehicle ? parc(vehicle) : '',
    matricule: vehicle?.matricule ?? '',
    chassis_number: vehicle?.chassis_number ?? '',
    type: vehicle?.type ?? '',
    site_id: vehicle?.site_id ? String(vehicle.site_id) : '',
    status: vehicle?.status ?? 'en_service',
    notes: vehicle?.notes ?? '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, site_id: form.site_id || undefined };
      return vehicle ? api.put(`/materiel/${vehicle.id}`, payload) : api.post('/materiel', payload);
    },
    onSuccess: () => {
      toast.success(vehicle ? 'Matériel modifié.' : 'Matériel ajouté.');
      queryClient.invalidateQueries({ queryKey: ['materiel'] });
      queryClient.invalidateQueries({ queryKey: ['fuel'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={vehicle ? `Modifier ${parc(vehicle)}` : 'Ajouter un matériel'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Immatriculation" required autoFocus placeholder="ex. 75682A55" value={form.matricule} onChange={set('matricule')} />
          <TextField label="Code parc" required placeholder="ex. D140, E49, TRSP03" value={form.fleet_code} onChange={set('fleet_code')} />
        </div>
        <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">Seuls le code parc et l'immatriculation sont obligatoires.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="N° de châssis" value={form.chassis_number} onChange={set('chassis_number')} />
          <TextField label="Type" placeholder="ex. 8*4 32T, PELLE 480" list="materiel-types" value={form.type} onChange={set('type')} />
          <datalist id="materiel-types">
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {needsSiteSelect && (
            <SelectField label="Site" required={!vehicle} value={form.site_id} onChange={set('site_id')}>
              <option value="">Sélectionner...</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField label="Statut" value={form.status} onChange={set('status')}>
            {(Object.keys(STATUS) as EquipmentStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="Remarque" value={form.notes} onChange={set('notes')} />
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
