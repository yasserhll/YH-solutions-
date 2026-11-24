import { Fragment, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Upload } from 'lucide-react';
import clsx from 'clsx';
import { api, uploadErrorMessage } from '../api/client';
import type { Paginated, Site } from '../types';
import { useSelectableSites } from '../hooks/useReferenceData';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Pagination } from '../components/ui/Pagination';
import { EmptyState, LoadingState } from '../components/ui/States';

interface HistoryRow {
  id: number;
  full_name: string;
  matricule: string | null;
  status: 'actif' | 'sorti';
  entry_date: string | null;
  site: Pick<Site, 'id' | 'name'> | null;
  position: { id: number; name: string } | null;
  months_since_entry: number;
  right_days: number;
  history_days: number;
  app_days: number;
  taken_days: number;
  remaining_days: number;
  months: { month: string; days: number; source: 'historique' | 'app' }[];
}

interface ImportResult {
  site: string;
  lines: number;
  matched: number;
  created: number;
  filled: number;
  updated: number;
  unchanged: number;
  months: number;
  days: number;
  new_people: string[];
  warnings: string[];
}

const MONTH_LABELS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const selectClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

/**
 * Congés → "Historique & soldes": the old "ETAT DE CONGE" workbooks (days
 * taken per month) + the congés declared in the app, with each employee's
 * right (months since embauche × 1.5) and what remains.
 */
export function LeaveHistoryTab({ search, siteParams }: { search: string; siteParams: Record<string, unknown> }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [onlyHistory, setOnlyHistory] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);

  const query = useQuery({
    queryKey: ['leave-history', siteParams, page, search, status, onlyHistory],
    queryFn: () =>
      api
        .get<Paginated<HistoryRow>>('/leave-history', {
          params: {
            ...siteParams,
            page,
            search: search || undefined,
            status: status || undefined,
            source: onlyHistory ? 'historique' : undefined,
          },
        })
        .then((r) => r.data),
  });

  const rows = query.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className={selectClass}>
          <option value="">Tout le personnel</option>
          <option value="actif">Actifs</option>
          <option value="sorti">Anciens (sortis)</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={onlyHistory} onChange={(e) => (setOnlyHistory(e.target.checked), setPage(1))} />
          Avec historique importé
        </label>
        <div className="ml-auto">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload size={16} /> Importer un état de congé
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Droit = mois depuis l’embauche × 1,5 j (comme l’état de congé Excel). Pris = l’historique importé + les congés déclarés ici (un
        mois déjà donné par l’historique n’est pas compté deux fois).
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {query.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState title="Aucun employé" message="Importez l’état de congé d’un site pour voir son historique." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="w-8 px-3 py-3" />
                <th className="px-3 py-3">Employé</th>
                <th className="px-3 py-3">Site</th>
                <th className="px-3 py-3">Fonction</th>
                <th className="px-3 py-3">Embauche</th>
                <th className="px-3 py-3 text-right">Mois</th>
                <th className="px-3 py-3 text-right">Droit</th>
                <th className="px-3 py-3 text-right">Pris</th>
                <th className="px-3 py-3 text-right">Restant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                  >
                    <td className="px-3 py-2.5 text-slate-400">{open === r.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {r.full_name}
                        {r.status === 'sorti' && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            Ancien
                          </span>
                        )}
                      </div>
                      {r.matricule && <div className="text-xs text-slate-500 dark:text-slate-400">Mat. {r.matricule}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{r.site?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{r.position?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                      {r.entry_date ? new Date(r.entry_date).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.months_since_entry}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(r.right_days)} j</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt(r.taken_days)} j</td>
                    <td
                      className={clsx(
                        'px-3 py-2.5 text-right font-semibold tabular-nums',
                        r.remaining_days < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400',
                      )}
                    >
                      {fmt(r.remaining_days)} j
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={9} className="bg-slate-50/60 px-3 py-3 dark:bg-slate-800/30">
                        <MonthGrid row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {query.data && (
          <Pagination page={query.data.current_page} lastPage={query.data.last_page} total={query.data.total} onPageChange={setPage} />
        )}
      </div>

      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}

function MonthGrid({ row }: { row: HistoryRow }) {
  if (row.months.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Aucun jour de congé enregistré.</p>;
  }
  const byMonth = new Map(row.months.map((m) => [m.month, m]));
  const years = [...new Set(row.months.map((m) => Number(m.month.slice(0, 4))))].sort();

  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr className="text-slate-500 dark:text-slate-400">
            <th className="px-2 py-1 text-left">Année</th>
            {MONTH_LABELS.map((m) => (
              <th key={m} className="w-12 px-1 py-1 text-center font-medium">
                {m}
              </th>
            ))}
            <th className="px-2 py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            let total = 0;
            return (
              <tr key={year}>
                <td className="px-2 py-1 font-semibold text-slate-700 dark:text-slate-200">{year}</td>
                {MONTH_LABELS.map((_, i) => {
                  const cell = byMonth.get(`${year}-${String(i + 1).padStart(2, '0')}`);
                  total += cell?.days ?? 0;
                  return (
                    <td key={i} className="px-1 py-1 text-center">
                      {cell ? (
                        <span
                          className={clsx(
                            'inline-block min-w-8 rounded px-1.5 py-0.5 font-semibold tabular-nums',
                            cell.source === 'app'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
                          )}
                          title={cell.source === 'app' ? 'Congé déclaré dans l’application' : 'Historique (état de congé Excel)'}
                        >
                          {fmt(cell.days)}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmt(total)} j</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex gap-4 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-amber-200 dark:bg-amber-500/40" /> Historique Excel
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sky-200 dark:bg-sky-500/40" /> Déclaré dans l’application
        </span>
      </div>
    </div>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { sites, needsSiteSelect } = useSelectableSites();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [siteId, setSiteId] = useState('');
  const [newStatus, setNewStatus] = useState<'sorti' | 'actif'>('sorti');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function send() {
    if (!file) return;
    setSending(true);
    const form = new FormData();
    form.append('file', file);
    form.append('new_status', newStatus);
    if (siteId) form.append('site_id', siteId);
    try {
      const { data } = await api.post<ImportResult>('/leave-history/import', form);
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['leave-history'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    } catch (err) {
      toast.error(uploadErrorMessage(err, file), { duration: 8000 });
    } finally {
      setSending(false);
    }
  }

  if (result) {
    return (
      <Modal open onClose={onClose} title={`Historique importé — ${result.site}`}>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Personnes', result.lines],
              ['Déjà dans l’app', result.matched],
              ['Ajoutées', result.created],
              ['Jours de congé', fmt(result.days)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
                <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</div>
              </div>
            ))}
          </div>
          <p className="text-slate-600 dark:text-slate-300">
            {result.months} mois de congé enregistrés · {result.updated} historique(s) ajouté(s) ou modifié(s), {result.unchanged} déjà à
            jour{result.filled > 0 && ` · ${result.filled} fiche(s) complétée(s) (matricule, date d’embauche ou fonction manquants)`}.
          </p>
          {result.new_people.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-slate-800 dark:text-slate-200">Ajoutées au personnel ({result.new_people.length})</div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {result.new_people.join(' · ')}
              </div>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              {result.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Importer un état de congé">
      <div className="space-y-4 text-sm">
        <p className="text-slate-600 dark:text-slate-300">
          Le fichier Excel « ETAT DE CONGE » du site : une ligne par employé et les jours pris chaque mois. Les personnes déjà dans
          l’application reçoivent leur historique ; celles qui manquent sont ajoutées au personnel du site. Un nouvel import du même
          fichier remplace l’historique importé, sans doublon.
        </p>
        <input ref={fileInput} type="file" accept=".xlsx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"
        >
          <Upload size={20} />
          <span className="font-medium">{file ? file.name : 'Choisir le fichier .xlsx'}</span>
        </button>
        {needsSiteSelect && (
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Site</span>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={clsx(selectClass, 'w-full')}>
              <option value="">Reconnaître d’après le nom du fichier</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset>
          <legend className="mb-1 font-medium text-slate-700 dark:text-slate-300">Personnes absentes de l’application</legend>
          <label className="flex items-start gap-2 py-1 text-slate-600 dark:text-slate-300">
            <input type="radio" checked={newStatus === 'sorti'} onChange={() => setNewStatus('sorti')} className="mt-0.5" />
            <span>
              Les ajouter comme <b>anciens employés</b> (sortis) : visibles dans l’historique et le personnel, pas dans le pointage.
            </span>
          </label>
          <label className="flex items-start gap-2 py-1 text-slate-600 dark:text-slate-300">
            <input type="radio" checked={newStatus === 'actif'} onChange={() => setNewStatus('actif')} className="mt-0.5" />
            <span>
              Les ajouter comme <b>employés actifs</b> (ils travaillent encore sur le site).
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={send} disabled={!file || sending}>
            {sending ? 'Import…' : 'Importer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
