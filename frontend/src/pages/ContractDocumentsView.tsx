import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { AlertTriangle, CalendarClock, CircleHelp, Pencil, ShieldCheck } from 'lucide-react';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { EmployeeDocument, EmployeeDocumentSummary, IdDocumentKind, IdDocumentState, Paginated } from '../types';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { KpiCard } from '../components/ui/KpiCard';
import { SelectField, TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

const DAY = 86400000;
const fmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '—');

const stateMeta: Record<IdDocumentState, { label: string; className: string }> = {
  valide: { label: 'Valide', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  bientot: { label: 'Expire bientôt', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  expire: { label: 'Expirée', className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
  manquante: { label: 'Date non saisie', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};

/** Same look as ContractProgress: the bar fills over the document's validity, orange near the end, red once expired. */
function DocumentProgress({ d, alertDays, validityYears }: { d: EmployeeDocument; alertDays: number; validityYears: number }) {
  const track = 'flex h-2 w-full min-w-[140px] overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700';
  const label = 'w-36 shrink-0 text-right text-xs';

  if (d.days_left === null) {
    return (
      <div className="flex items-center gap-3">
        <div className={clsx(track, 'border border-dashed border-slate-300 bg-transparent dark:border-slate-600')} />
        <span className={clsx(label, 'text-slate-400 dark:text-slate-500')}>date non saisie</span>
      </div>
    );
  }
  if (d.days_left < 0) {
    return (
      <div className="flex items-center gap-3">
        <div className={track}>
          <div className="h-full w-full rounded-full bg-red-500" />
        </div>
        <span className={clsx(label, 'font-medium text-red-500 dark:text-red-400')}>expirée depuis {-d.days_left} j</span>
      </div>
    );
  }

  const total = Math.round((validityYears * 365.25 * DAY) / DAY);
  const elapsed = Math.min(100, Math.max(2, ((total - d.days_left) / total) * 100));
  const soon = d.days_left <= alertDays;
  return (
    <div className="flex items-center gap-3" title={`Validité estimée : ${validityYears} ans`}>
      <div className={track}>
        <div className={clsx('h-full rounded-full', soon ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${elapsed}%` }} />
      </div>
      <span className={clsx(label, soon ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400')}>
        {d.days_left === 0 ? "expire aujourd'hui" : `${d.days_left} j restant${d.days_left > 1 ? 's' : ''}`}
      </span>
    </div>
  );
}

export function ContractDocumentsView({ doc }: { doc: IdDocumentKind }) {
  const siteParams = useSiteParams();
  // ?state=a_traiter when opened from the notification bell.
  const [searchParams] = useSearchParams();
  const [state, setState] = useState(searchParams.get('state') ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EmployeeDocument | null>(null);
  const label = doc === 'cin' ? 'CIN' : 'Permis';

  const listQuery = useQuery({
    queryKey: ['employee-documents', 'list', doc, siteParams, state, search, page],
    queryFn: () =>
      api
        .get<Paginated<EmployeeDocument>>('/employee-documents', { params: { ...siteParams, doc, state: state || undefined, search: search || undefined, page } })
        .then((r) => r.data),
  });
  const summaryQuery = useQuery({
    queryKey: ['employee-documents', 'summary', doc, siteParams],
    queryFn: () => api.get<EmployeeDocumentSummary>('/employee-documents/summary', { params: { ...siteParams, doc } }).then((r) => r.data),
  });
  const s = summaryQuery.data;
  const alertDays = s?.alert_days ?? 30;
  const pick = (value: string) => (setState((v) => (v === value ? '' : value)), setPage(1));

  const columns: Column<EmployeeDocument>[] = [
    {
      header: 'Employé',
      accessor: (d) => (
        <div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{d.full_name}</div>
          <div className="text-xs text-slate-400 dark:text-slate-500">{d.position?.name ?? ''}</div>
        </div>
      ),
    },
    { header: 'Site', className: 'whitespace-nowrap', accessor: (d) => d.site?.name ?? '—' },
    { header: `Expiration ${label}`, className: 'whitespace-nowrap', accessor: (d) => fmt(d.expiry_date) },
    {
      header: 'Avancement',
      className: 'w-[34%] min-w-[280px]',
      accessor: (d) => <DocumentProgress d={d} alertDays={alertDays} validityYears={s?.validity_years ?? 10} />,
    },
    {
      header: 'Statut',
      className: 'whitespace-nowrap',
      accessor: (d) => (
        <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', stateMeta[d.state].className)}>
          {(d.state === 'bientot' || d.state === 'expire') && <AlertTriangle size={12} />}
          {stateMeta[d.state].label}
        </span>
      ),
    },
    {
      header: 'Actions',
      accessor: (d) => (
        <button
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          title={`Mettre à jour la date (${label} renouvelé${doc === 'cin' ? 'e' : ''})`}
          onClick={() => setEditing(d)}
        >
          <Pencil size={16} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button className={clsx('rounded-xl text-left', state === 'expire' && 'ring-2 ring-red-400')} onClick={() => pick('expire')}>
          <KpiCard label={doc === 'cin' ? 'CIN expirées' : 'Permis expirés'} value={s?.expire ?? '—'} icon={AlertTriangle} tone="red" />
        </button>
        <button className={clsx('rounded-xl text-left', state === 'bientot' && 'ring-2 ring-amber-400')} onClick={() => pick('bientot')}>
          <KpiCard label={`Expirent bientôt (≤ ${alertDays} j)`} value={s?.bientot ?? '—'} icon={CalendarClock} tone="amber" />
        </button>
        <button className={clsx('rounded-xl text-left', state === 'valide' && 'ring-2 ring-emerald-400')} onClick={() => pick('valide')}>
          <KpiCard label="Valides" value={s?.valide ?? '—'} icon={ShieldCheck} tone="green" />
        </button>
        <button className={clsx('rounded-xl text-left', state === 'manquante' && 'ring-2 ring-slate-400')} onClick={() => pick('manquante')}>
          <KpiCard label="Date non saisie" value={s?.manquante ?? '—'} icon={CircleHelp} tone="slate" />
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-64">
          <SearchInput placeholder="Rechercher par nom..." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <div className="w-full sm:w-72">
          <SelectField label="Afficher" value={state} onChange={(e) => (setState(e.target.value), setPage(1))}>
            <option value="">Tous</option>
            <option value="a_traiter">À traiter (expirées, bientôt, non saisies)</option>
            <option value="expire">Expirées</option>
            <option value="bientot">Expirent bientôt</option>
            <option value="valide">Valides</option>
            <option value="manquante">Date non saisie</option>
          </SelectField>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <DataTable
          columns={columns}
          rows={listQuery.data?.data ?? []}
          isLoading={listQuery.isLoading}
          keyFn={(d) => d.id}
          emptyMessage={doc === 'cin' ? 'Aucun employé actif.' : 'Aucun conducteur de camion. Cochez « Conducteur de camion » dans l’Entrée ou la fiche Personnel.'}
        />
        {listQuery.data && (
          <Pagination page={listQuery.data.current_page} lastPage={listQuery.data.last_page} total={listQuery.data.total} onPageChange={setPage} />
        )}
      </div>

      {editing && <DocumentFormModal doc={doc} employee={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DocumentFormModal({ doc, employee, onClose }: { doc: IdDocumentKind; employee: EmployeeDocument; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [cin, setCin] = useState(employee.cin_expiry_date ?? '');
  const [isDriver, setIsDriver] = useState(employee.is_driver || !!employee.license_expiry_date);
  const [license, setLicense] = useState(employee.license_expiry_date ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      api.put(
        `/employee-documents/${employee.id}`,
        doc === 'cin' ? { cin_expiry_date: cin || null } : { is_driver: isDriver, license_expiry_date: isDriver ? license || null : null },
        { params: { doc } },
      ),
    onSuccess: () => {
      toast.success('Date mise à jour.');
      queryClient.invalidateQueries({ queryKey: ['employee-documents'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={doc === 'cin' ? 'Date d’expiration de la CIN' : 'Date d’expiration du permis'} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="text-sm text-slate-600 dark:text-slate-300">{employee.full_name}</div>
        {doc === 'cin' ? (
          <TextField label="Date d'expiration CIN" type="date" value={cin} onChange={(e) => setCin(e.target.value)} />
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" checked={isDriver} onChange={(e) => setIsDriver(e.target.checked)} />
              Conducteur de camion
            </label>
            {isDriver ? (
              <TextField label="Date d'expiration du permis" type="date" value={license} onChange={(e) => setLicense(e.target.value)} />
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Décoché : la personne sort de la liste des permis.</p>
            )}
          </>
        )}
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
