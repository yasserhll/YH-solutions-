import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, BadgeCheck, CalendarClock, FileSignature, LogOut, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, apiErrorMessage } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { Contract, ContractState, ContractSummary, Employee, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/SearchInput';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { KpiCard } from '../components/ui/KpiCard';
import { SelectField, TextAreaField, TextField } from '../components/ui/Field';
import { EmployeeSelect } from '../components/ui/EmployeeSelect';
import { autoCdi, contractLabel } from '../utils/contracts';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayAfter = (d: string) => {
  const x = new Date(d.slice(0, 10) + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + 1);
  return iso(x);
};

const stateMeta: Record<ContractState, { label: string; className: string }> = {
  en_cours: { label: 'En cours', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
  bientot: { label: 'Presque terminé', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  termine: { label: 'Terminé', className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
  cdi: { label: 'CDI', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  sorti: { label: 'Sorti', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  renouvele: { label: 'Renouvelé', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  passe_cdi: { label: 'Passé en CDI', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  stc: { label: 'Sortie (STC)', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};

const filters = [
  { value: '', label: 'Contrats actuels' },
  { value: 'a_traiter', label: 'À traiter (presque terminés + terminés)' },
  { value: 'bientot', label: 'Presque terminés' },
  { value: 'termine', label: 'Terminés' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'cdi', label: 'CDI' },
  { value: 'historique', label: 'Historique (contrats clôturés)' },
];

const DAY = 86_400_000;
const utcDay = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z');

/**
 * One bar per contract: how much of it has elapsed. Green while more than
 * `alertDays` remain, orange in the last `alertDays`, and once the end date is
 * past the full contract stays green with the overdue days added in red
 * ("en retard de X j") — same reading as a deadline timeline.
 */
function ContractProgress({ c, alertDays }: { c: Contract; alertDays: number }) {
  const track = 'flex h-2 w-full min-w-[140px] overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700';

  if (c.type === 'cdi' && !c.outcome) {
    return (
      <div className="flex items-center gap-3">
        <div className={track}>
          <div className="h-full w-full rounded-full bg-emerald-500" />
        </div>
        <span className="w-32 shrink-0 text-right text-xs font-medium text-emerald-600 dark:text-emerald-400">CDI · sans fin</span>
      </div>
    );
  }
  if (c.days_left === null || !c.end_date) {
    // Closed contract (renouvelé / CDI / STC) or employee already gone: muted, full.
    return (
      <div className="flex items-center gap-3">
        <div className={track}>
          <div className="h-full w-full rounded-full bg-slate-400 dark:bg-slate-500" />
        </div>
        <span className="w-32 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500">clôturé</span>
      </div>
    );
  }

  const total = Math.max(1, Math.round((utcDay(c.end_date) - utcDay(c.start_date)) / DAY) + 1);
  const left = c.days_left;

  if (left < 0) {
    const late = -left;
    const green = (total / (total + late)) * 100;
    return (
      <div className="flex items-center gap-3">
        <div className={track}>
          <div className="h-full bg-emerald-500" style={{ width: `${green}%` }} />
          <div className="h-full bg-red-500" style={{ width: `${Math.max(3, 100 - green)}%` }} />
        </div>
        <span className="w-32 shrink-0 text-right text-xs font-medium text-red-500 dark:text-red-400">en retard de {late} j</span>
      </div>
    );
  }

  const elapsed = Math.min(100, Math.max(2, ((total - left) / total) * 100));
  const soon = left <= alertDays;
  return (
    <div className="flex items-center gap-3">
      <div className={track}>
        <div className={clsx('h-full rounded-full', soon ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${elapsed}%` }} />
      </div>
      <span
        className={clsx(
          'w-32 shrink-0 text-right text-xs',
          soon ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400',
        )}
      >
        {autoCdi(c)
          ? left === 0
            ? "CDI auto demain"
            : `CDI auto dans ${left} j`
          : left === 0
            ? "se termine aujourd'hui"
            : `dans ${left} j`}
      </span>
    </div>
  );
}

type Action = { kind: 'renew' | 'cdi' | 'stc'; contract: Contract };

export default function ContractsPage() {
  // ?state= lets the top-bar notification open the "À traiter" filter directly.
  const [searchParams] = useSearchParams();
  const [state, setState] = useState(searchParams.get('state') ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ contract?: Contract } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [deleting, setDeleting] = useState<Contract | null>(null);
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['contracts', siteParams, state, search, page],
    queryFn: () =>
      api
        .get<Paginated<Contract>>('/contracts', { params: { ...siteParams, state: state || undefined, search: search || undefined, page } })
        .then((r) => r.data),
  });

  const summaryQuery = useQuery({
    queryKey: ['contracts-summary', siteParams],
    queryFn: () => api.get<ContractSummary>('/contracts/summary', { params: siteParams }).then((r) => r.data),
  });
  const summary = summaryQuery.data;

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/contracts/${deleting?.id}`),
    onSuccess: () => {
      toast.success('Contrat supprimé.');
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contracts-summary'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const alertDays = summary?.alert_days ?? 10;
  const pick = (value: string) => (setState(value), setPage(1));
  const iconBtn = 'rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800';

  const columns: Column<Contract>[] = [
    {
      header: 'Employé',
      accessor: (c) => (
        <div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{c.employee?.full_name}</div>
          <div className="text-xs text-slate-400 dark:text-slate-500">{c.employee?.position?.name ?? ''}</div>
        </div>
      ),
    },
    { header: 'Site', accessor: (c) => c.employee?.site?.name ?? '—' },
    {
      header: 'Contrat',
      className: 'whitespace-nowrap',
      accessor: (c) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span
              className={clsx(
                'rounded-md px-1.5 py-0.5 text-xs font-semibold',
                c.type === 'cdi'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                  : c.cdd_number && c.cdd_number > 1
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
              )}
            >
              {contractLabel(c)}
            </span>
            {c.type === 'cdd' && <span className="text-xs text-slate-500 dark:text-slate-400">{c.duration_months} mois</span>}
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {c.end_date ? `${fmt(c.start_date)} → ${fmt(c.end_date)}` : `depuis le ${fmt(c.start_date)}`}
          </div>
        </div>
      ),
    },
    {
      header: 'Avancement',
      className: 'w-[32%] min-w-[260px]',
      accessor: (c) => <ContractProgress c={c} alertDays={alertDays} />,
    },
    {
      header: 'Statut',
      className: 'whitespace-nowrap',
      accessor: (c) => (
        <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', stateMeta[c.state].className)}>
          {(c.state === 'bientot' || c.state === 'termine') && <AlertTriangle size={12} />}
          {autoCdi(c) && c.state === 'bientot' ? 'CDI auto bientôt' : stateMeta[c.state].label}
          {c.outcome_date && ` le ${fmt(c.outcome_date)}`}
        </span>
      ),
    },
    {
      header: 'Actions',
      accessor: (c) => {
        const open = !c.outcome && c.state !== 'sorti';
        const openCdd = open && c.type === 'cdd';
        return (
          <div className="flex flex-nowrap gap-1">
            {openCdd && (
              <>
                <button className={clsx(iconBtn, 'text-blue-600 dark:text-blue-400')} title="Renouveler (nouveau CDD)" onClick={() => setAction({ kind: 'renew', contract: c })}>
                  <RefreshCw size={16} />
                </button>
                <button className={clsx(iconBtn, 'text-emerald-600 dark:text-emerald-400')} title="Passer en CDI" onClick={() => setAction({ kind: 'cdi', contract: c })}>
                  <BadgeCheck size={16} />
                </button>
              </>
            )}
            {open && (
              <button className={clsx(iconBtn, 'text-red-600 dark:text-red-400')} title="Sortie (STC)" onClick={() => setAction({ kind: 'stc', contract: c })}>
                <LogOut size={16} />
              </button>
            )}
            {!c.outcome && (
              <button className={clsx(iconBtn, 'text-slate-500 dark:text-slate-400')} title="Modifier" onClick={() => setForm({ contract: c })}>
                <Pencil size={16} />
              </button>
            )}
            {c.outcome !== 'stc' && (
              <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15" title="Supprimer" onClick={() => setDeleting(c)}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const toHandle = (summary?.bientot ?? 0) + (summary?.termine ?? 0);

  return (
    <div>
      <PageHeader
        title="Contrats"
        description="Chaque nouvelle entrée signe un CDD de 3 mois — à la fin : renouveler, passer en CDI ou sortie (STC)"
        actions={
          <Button onClick={() => setForm({})}>
            <Plus size={16} /> Nouveau contrat
          </Button>
        }
      />

      {toHandle > 0 && (
        <button
          onClick={() => pick('a_traiter')}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15"
        >
          <AlertTriangle size={18} className="shrink-0" />
          <span>
            {summary?.termine ? <strong className="text-red-600 dark:text-red-400">{summary.termine} contrat(s) terminé(s)</strong> : null}
            {summary?.termine && summary?.bientot ? ' et ' : null}
            {summary?.bientot ? <strong>{summary.bientot} contrat(s) se terminent dans moins de {alertDays} jours</strong> : null}
            {' — à renouveler, passer en CDI ou sortie (STC).'}
          </span>
        </button>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button className="text-left" onClick={() => pick('en_cours')}>
          <KpiCard label="En cours" value={summary?.en_cours ?? '—'} icon={FileSignature} tone="blue" />
        </button>
        <button className="text-left" onClick={() => pick('bientot')}>
          <KpiCard label={`Presque terminés (≤ ${alertDays} j)`} value={summary?.bientot ?? '—'} icon={CalendarClock} tone="amber" />
        </button>
        <button className="text-left" onClick={() => pick('termine')}>
          <KpiCard label="Terminés à traiter" value={summary?.termine ?? '—'} icon={AlertTriangle} tone="red" />
        </button>
        <button className="text-left" onClick={() => pick('cdi')}>
          <KpiCard label="CDI" value={summary?.cdi ?? '—'} icon={BadgeCheck} tone="green" />
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-64">
          <SearchInput placeholder="Rechercher par nom..." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <div className="w-full sm:w-80">
          <SelectField label="Afficher" value={state} onChange={(e) => pick(e.target.value)}>
            {filters.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <DataTable
          columns={columns}
          rows={listQuery.data?.data ?? []}
          isLoading={listQuery.isLoading}
          keyFn={(c) => c.id}
          emptyMessage="Aucun contrat."
        />
        {listQuery.data && (
          <Pagination page={listQuery.data.current_page} lastPage={listQuery.data.last_page} total={listQuery.data.total} onPageChange={setPage} />
        )}
      </div>

      {form && <ContractFormModal contract={form.contract} onClose={() => setForm(null)} />}
      {action && <ContractActionModal action={action} onClose={() => setAction(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le contrat"
        message={
          deleting?.outcome
            ? 'Supprimer ce contrat de l’historique ?'
            : 'Supprimer ce contrat ? S’il venait d’un renouvellement ou d’un passage en CDI, le contrat précédent redevient le contrat en cours.'
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate()}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function useContractSaved(onClose: () => void, message: string) {
  const queryClient = useQueryClient();
  return () => {
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
    queryClient.invalidateQueries({ queryKey: ['contracts-summary'] });
    onClose();
  };
}

/** Months field: plain numeric text (no spinner), can be cleared and retyped. */
function MonthsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextField
      label="Durée (mois)"
      type="text"
      inputMode="numeric"
      pattern="[1-9][0-9]*"
      title="Nombre de mois (1 ou plus)"
      required
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    />
  );
}

function ContractFormModal({ contract, onClose }: { contract?: Contract; onClose: () => void }) {
  const isEdit = !!contract;
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    type: contract?.type ?? 'cdd',
    start_date: contract?.start_date.slice(0, 10) ?? iso(new Date()),
    duration_months: String(contract?.duration_months ?? 3),
    notes: contract?.notes ?? '',
    auto_cdi: contract?.auto_cdi ?? true,
    cdd_number: String(contract?.cdd_number ?? 1),
  });
  // Only a 2nd (or later) CDD turns into a CDI by itself.
  const canAutoCdi = isEdit && form.type === 'cdd' && Number(form.cdd_number) >= 2;
  const rankOptions = Array.from({ length: Math.max(5, contract?.cdd_number ?? 0) }, (_, i) => i + 1);
  const saved = useContractSaved(onClose, isEdit ? 'Contrat modifié.' : 'Contrat enregistré.');

  const mutation = useMutation({
    mutationFn: (): Promise<unknown> => {
      const payload = {
        ...form,
        duration_months: form.type === 'cdd' ? Number(form.duration_months) : null,
        cdd_number: isEdit && form.type === 'cdd' ? Number(form.cdd_number) : null,
      };
      return isEdit ? api.put(`/contracts/${contract.id}`, payload) : api.post('/contracts', { ...payload, employee_id: employee?.id });
    },
    onSuccess: saved,
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Modifier le contrat' : 'Nouveau contrat'} size="sm">
      <form onSubmit={(e) => (e.preventDefault(), mutation.mutate())} className="space-y-4">
        {isEdit ? (
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{contract.employee?.full_name}</p>
        ) : (
          <EmployeeSelect value={employee?.id ?? null} onChange={setEmployee} />
        )}
        <SelectField label="Type de contrat" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'cdd' | 'cdi' })}>
          <option value="cdd">CDD</option>
          <option value="cdi">CDI</option>
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Date de début" type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          {form.type === 'cdd' && <MonthsField value={form.duration_months} onChange={(v) => setForm({ ...form, duration_months: v })} />}
        </div>
        {isEdit && form.type === 'cdd' && (
          <div>
            <SelectField label="Numéro du CDD" value={form.cdd_number} onChange={(e) => setForm({ ...form, cdd_number: e.target.value })}>
              {rankOptions.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1er CDD' : `${n}ème CDD`}
                </option>
              ))}
            </SelectField>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {Number(form.cdd_number) >= 2
                ? 'À partir du 2ème CDD, le passage en CDI est automatique à la fin (sauf si décoché ci-dessous).'
                : 'Au 1er CDD, la décision à la fin reste manuelle (Renouveler, CDI ou Sortie STC).'}
            </p>
          </div>
        )}
        {canAutoCdi && (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
            <input type="checkbox" className="mt-0.5" checked={form.auto_cdi} onChange={(e) => setForm({ ...form, auto_cdi: e.target.checked })} />
            <span>
              Passage automatique en CDI à la fin de ce contrat
              <span className="block text-xs text-slate-400 dark:text-slate-500">
                Décochez pour décider vous-même (Renouveler, CDI ou Sortie STC).
              </span>
            </span>
          </label>
        )}
        <TextAreaField label="Remarque" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={(!isEdit && !employee) || mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ContractActionModal({ action, onClose }: { action: Action; onClose: () => void }) {
  const { kind, contract } = action;
  const end = contract.end_date?.slice(0, 10) ?? null;
  const [startDate, setStartDate] = useState(end ? dayAfter(end) : iso(new Date()));
  const [months, setMonths] = useState('3');
  const [exitDate, setExitDate] = useState(end ?? iso(new Date()));
  const [reason, setReason] = useState('STC — fin de contrat');

  const titles = { renew: 'Renouveler le contrat', cdi: 'Passer en CDI', stc: 'Sortie (STC)' };
  const messages = { renew: 'Contrat renouvelé.', cdi: 'Employé passé en CDI.', stc: 'Sortie (STC) enregistrée.' };
  const queryClient = useQueryClient();
  const saved = useContractSaved(onClose, messages[kind]);

  const mutation = useMutation({
    mutationFn: (): Promise<unknown> => {
      if (kind === 'renew') return api.post(`/contracts/${contract.id}/renew`, { start_date: startDate, duration_months: Number(months) });
      if (kind === 'cdi') return api.post(`/contracts/${contract.id}/cdi`, { start_date: startDate });
      return api.post(`/contracts/${contract.id}/stc`, { exit_date: exitDate, reason });
    },
    onSuccess: () => {
      if (kind === 'stc') {
        queryClient.invalidateQueries({ queryKey: ['employees'] });
        queryClient.invalidateQueries({ queryKey: ['exits'] });
      }
      saved();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title={titles[kind]} size="sm">
      <form onSubmit={(e) => (e.preventDefault(), mutation.mutate())} className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-200">{contract.employee?.full_name}</span> —{' '}
          {contract.type === 'cdi' ? 'CDI' : `CDD du ${fmt(contract.start_date)} au ${fmt(contract.end_date)}`}
        </p>

        {kind === 'renew' && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Nouveau contrat à partir du" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <MonthsField value={months} onChange={setMonths} />
          </div>
        )}
        {kind === 'cdi' && (
          <TextField label="CDI à partir du" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        )}
        {kind === 'stc' && (
          <>
            <TextField label="Date de sortie" type="date" required value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
            <TextField label="Motif" value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              L'employé sera marqué « Sorti » et une sortie sera ajoutée dans Entrées / Sorties (annulable là-bas).
            </p>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant={kind === 'stc' ? 'danger' : 'primary'} disabled={mutation.isPending}>
            Confirmer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
