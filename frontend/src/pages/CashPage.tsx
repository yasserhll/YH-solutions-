import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, Pencil, Trash2, Wallet, TrendingUp, TrendingDown, Settings2, Download } from 'lucide-react';
import { api, apiErrorMessage, downloadFile } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useAuth } from '../contexts/AuthContext';
import { useSites } from '../hooks/useReferenceData';
import type { CashAccount, CashTransaction, CashTransactionType, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SelectField, TextField } from '../components/ui/Field';
import { KpiCard } from '../components/ui/KpiCard';
import { SearchInput } from '../components/ui/SearchInput';

function money(n: number | string) {
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + ' DH';
}

export default function CashPage() {
  const { user } = useAuth();
  const siteParams = useSiteParams();
  const isSuperAdmin = user?.role === 'superadmin';
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingTx, setEditingTx] = useState<CashTransaction | null>(null);
  const [deleting, setDeleting] = useState<CashTransaction | null>(null);
  const [editingAccount, setEditingAccount] = useState<CashAccount | null>(null);

  // Only the SuperAdmin sees the caisse's solde/reste — exactly like the
  // reference Excel, where only the "Admin" sheet carries a balance. A
  // responsable only ever declares purchases (see backend for enforcement).
  const accountQuery = useQuery({
    queryKey: ['cash-account'],
    queryFn: () => api.get<CashAccount>('/cash-account').then((r) => r.data),
    enabled: isSuperAdmin,
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      downloadFile(
        '/reports/cash/export',
        { ...siteParams, date_from: dateFrom || undefined, date_to: dateTo || undefined, beneficiary: beneficiary || undefined },
        'caisse.xlsx',
      ),
    onError: (err) => toast.error(apiErrorMessage(err, "Échec de l'export.")),
  });

  const transactionsQuery = useQuery({
    queryKey: ['cash-transactions', siteParams, page, dateFrom, dateTo, beneficiary, search],
    queryFn: () =>
      api
        .get<Paginated<CashTransaction>>('/cash-transactions', {
          params: {
            ...siteParams,
            page,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
            beneficiary: beneficiary || undefined,
            search: search || undefined,
          },
        })
        .then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/cash-transactions/${id}`),
    onSuccess: () => {
      toast.success('Opération supprimée.');
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-account'] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const account = accountQuery.data;

  const columns: Column<CashTransaction>[] = [
    { header: 'Date', accessor: (t) => new Date(t.date).toLocaleDateString('fr-FR') },
    { header: 'Bénéficiaire', accessor: (t) => t.beneficiary ?? '—' },
    ...(isSuperAdmin ? [{ header: 'Site', accessor: (t: CashTransaction) => t.site?.name ?? '—' } as Column<CashTransaction>] : []),
    { header: 'Description', accessor: (t) => t.description ?? '—' },
    { header: 'Type', accessor: (t) => <StatusBadge status={t.type} /> },
    {
      header: 'Montant',
      accessor: (t) => (
        <span className={t.type === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
          {money(t.amount)}
        </span>
      ),
    },
    ...(isSuperAdmin
      ? [
          {
            header: 'Reste',
            accessor: (t: CashTransaction) => (
              <span className={clsx('font-medium', Number(t.running_balance ?? 0) < 0 && 'text-red-600 dark:text-red-400')}>
                {money(t.running_balance ?? 0)}
              </span>
            ),
          } as Column<CashTransaction>,
        ]
      : []),
    ...(isSuperAdmin
      ? [
          {
            header: 'Actions',
            accessor: (t: CashTransaction) => (
              <div className="flex items-center gap-1">
                <button
                  className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setEditingTx(t)}
                >
                  <Pencil size={16} />
                </button>
                <button className="rounded-md p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDeleting(t)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ),
          } as Column<CashTransaction>,
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Caisse"
        description={isSuperAdmin ? 'Caisse commune — solde et recharges' : 'Déclarer vos achats — le solde est géré par le SuperAdmin'}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
              <Download size={16} /> {exportMutation.isPending ? 'Export en cours...' : 'Export Excel'}
            </Button>
            {isSuperAdmin && (
              <Button variant="secondary" onClick={() => account && setEditingAccount(account)} disabled={!account}>
                <Settings2 size={16} /> Réglages
              </Button>
            )}
            <Button onClick={() => setShowForm(true)}>
              <Plus size={16} /> {isSuperAdmin ? 'Nouvelle opération' : 'Déclarer un achat'}
            </Button>
          </div>
        }
      />

      {isSuperAdmin && account && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Solde actuel"
            value={money(account.summary.current_balance)}
            icon={Wallet}
            tone={account.summary.current_balance < 0 ? 'red' : 'green'}
          />
          <KpiCard label="Total entrées" value={money(account.summary.total_entries)} icon={TrendingUp} tone="blue" />
          <KpiCard label="Total dépenses" value={money(account.summary.total_expenses)} icon={TrendingDown} tone="red" />
          <KpiCard label="Opérations" value={account.summary.operations_count} icon={Wallet} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-56">
          <SearchInput
            placeholder="Rechercher une description..."
            value={search}
            onChange={(e) => (setSearch(e.target.value), setPage(1))}
          />
        </div>
        <input
          type="text"
          placeholder="Bénéficiaire"
          value={beneficiary}
          onChange={(e) => (setBeneficiary(e.target.value), setPage(1))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => (setDateFrom(e.target.value), setPage(1))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <span className="text-sm text-slate-400 dark:text-slate-500">à</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => (setDateTo(e.target.value), setPage(1))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <DataTable
          columns={columns}
          rows={transactionsQuery.data?.data ?? []}
          isLoading={transactionsQuery.isLoading}
          keyFn={(t) => t.id}
        />
        {transactionsQuery.data && (
          <Pagination
            page={transactionsQuery.data.current_page}
            lastPage={transactionsQuery.data.last_page}
            total={transactionsQuery.data.total}
            onPageChange={setPage}
          />
        )}
      </div>

      {(showForm || editingTx) && <TransactionFormModal transaction={editingTx} onClose={() => (setShowForm(false), setEditingTx(null))} />}

      {editingAccount && <AccountSettingsModal account={editingAccount} onClose={() => setEditingAccount(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer l'opération"
        message="Voulez-vous vraiment supprimer cette opération de caisse ? Le solde sera recalculé."
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function TransactionFormModal({ transaction, onClose }: { transaction: CashTransaction | null; onClose: () => void }) {
  const { user } = useAuth();
  const { data: sites } = useSites();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === 'superadmin';

  const [form, setForm] = useState({
    site_id: transaction?.site_id ?? '',
    type: transaction?.type ?? ('expense' as CashTransactionType),
    date: transaction?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    beneficiary: transaction?.beneficiary ?? '',
    description: transaction?.description ?? '',
    amount: transaction?.amount ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => (transaction ? api.put(`/cash-transactions/${transaction.id}`, form) : api.post('/cash-transactions', form)),
    onSuccess: () => {
      toast.success(isSuperAdmin ? 'Opération enregistrée.' : 'Achat déclaré.');
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-account'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={transaction ? "Modifier l'opération" : isSuperAdmin ? 'Nouvelle opération de caisse' : 'Déclarer un achat'}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        {isSuperAdmin ? (
          <SelectField
            label="Type"
            required
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as CashTransactionType })}
          >
            <option value="expense">Dépense (achat d'un site)</option>
            <option value="entry">Entrée / recharge (caisse commune)</option>
          </SelectField>
        ) : (
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            Vous déclarez un achat (dépense) pour votre site. Seul le SuperAdmin peut recharger la caisse.
          </p>
        )}
        {isSuperAdmin && form.type === 'expense' && (
          <SelectField label="Site" required value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
            <option value="">Sélectionner...</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        {form.type === 'expense' && (
          <TextField
            label="Bénéficiaire"
            required
            value={form.beneficiary}
            onChange={(e) => setForm({ ...form, beneficiary: e.target.value })}
          />
        )}
        <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <TextField
          label="Montant (DH)"
          type="number"
          step="0.01"
          min={0.01}
          required
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
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

function AccountSettingsModal({ account, onClose }: { account: CashAccount; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ initial_balance: account.initial_balance });

  const mutation = useMutation({
    mutationFn: () => api.put('/cash-account', form),
    onSuccess: () => {
      toast.success('Réglages mis à jour.');
      queryClient.invalidateQueries({ queryKey: ['cash-account'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Réglages de la caisse" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <TextField
          label="Solde initial (DH)"
          type="number"
          step="0.01"
          required
          value={form.initial_balance}
          onChange={(e) => setForm({ ...form, initial_balance: e.target.value })}
        />
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          Une dépense n'est jamais bloquée par manque de solde — le solde peut devenir négatif jusqu'à la prochaine
          recharge.
        </p>
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
