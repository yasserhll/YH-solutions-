import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, Pencil, Trash2, Wallet, Settings2, Download } from 'lucide-react';
import { api, apiErrorMessage, downloadFile } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useAuth } from '../contexts/AuthContext';
import { useSites } from '../hooks/useReferenceData';
import type { CashAccount, CashSiteBalance, CashTransaction, CashTransactionType, Paginated } from '../types';
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

  // SuperAdmin gets the master caisse + every site's balance; a responsable
  // gets only their own site's derived balance — shaped server-side, the
  // master balance never reaches a responsable's response at all. The role
  // is part of the query key so switching accounts never reads a
  // differently-shaped response left in cache under the same key.
  const accountQuery = useQuery({
    queryKey: ['cash-account', user?.id],
    queryFn: () => api.get<CashAccount | CashSiteBalance>('/cash-account').then((r) => r.data),
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

  const account = isSuperAdmin ? (accountQuery.data as CashAccount | undefined) : undefined;
  const siteBalance = !isSuperAdmin ? (accountQuery.data as CashSiteBalance | undefined) : undefined;

  const amountTone: Record<CashTransactionType, string> = {
    expense: 'text-red-600 dark:text-red-400',
    entry: 'text-emerald-600 dark:text-emerald-400',
    transfer: 'text-blue-600 dark:text-blue-400',
  };

  const columns: Column<CashTransaction>[] = [
    { header: 'Date', accessor: (t) => new Date(t.date).toLocaleDateString('fr-FR') },
    { header: 'Bénéficiaire', accessor: (t) => t.beneficiary ?? '—' },
    ...(isSuperAdmin ? [{ header: 'Site', accessor: (t: CashTransaction) => t.site?.name ?? '—' } as Column<CashTransaction>] : []),
    { header: 'Description', accessor: (t) => t.description ?? '—' },
    { header: 'Type', accessor: (t) => <StatusBadge status={t.type} /> },
    {
      header: 'Montant',
      accessor: (t) => <span className={amountTone[t.type]}>{money(t.amount)}</span>,
    },
    isSuperAdmin
      ? {
          // The real global caisse balance — never reduced by a transfer.
          header: 'Reste global',
          accessor: (t: CashTransaction) => (
            <span className={clsx('font-medium', Number(t.running_balance ?? 0) < 0 && 'text-red-600 dark:text-red-400')}>
              {money(t.running_balance ?? 0)}
            </span>
          ),
        }
      : {
          // A responsable's own site's remaining spending limit.
          header: 'Solde site',
          accessor: (t: CashTransaction) =>
            t.site_running_balance != null ? (
              <span className={clsx('font-medium', Number(t.site_running_balance) < 0 && 'text-red-600 dark:text-red-400')}>
                {money(t.site_running_balance)}
              </span>
            ) : (
              '—'
            ),
        },
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
        description={
          isSuperAdmin
            ? 'Caisse commune, transferts vers les sites et solde de chaque site'
            : 'Déclarer vos achats dans la limite du solde transféré à votre site'
        }
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
            label="Solde caisse global actuel"
            value={money(account.summary.current_balance)}
            icon={Wallet}
            tone={account.summary.current_balance < 0 ? 'red' : 'green'}
          />
          {account.summary.sites.map((s) => (
            <KpiCard key={s.site_id} label={`Solde ${s.site_name}`} value={money(s.balance)} icon={Wallet} tone={s.balance < 0 ? 'red' : 'teal'} />
          ))}
        </div>
      )}

      {!isSuperAdmin && siteBalance && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Solde de mon site"
            value={money(siteBalance.site_balance)}
            icon={Wallet}
            tone={siteBalance.site_balance <= 0 ? 'red' : 'green'}
          />
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
            <option value="transfer">Transfert vers un site</option>
          </SelectField>
        ) : (
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            Vous déclarez un achat (dépense) pour votre site, dans la limite du solde qui lui a été transféré par le
            SuperAdmin.
          </p>
        )}
        {isSuperAdmin && form.type === 'transfer' && (
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            Ce montant ne réduit pas le solde de la caisse globale — il définit (ou augmente) le plafond de dépense
            autorisé pour le site sélectionné.
          </p>
        )}
        {isSuperAdmin && (form.type === 'expense' || form.type === 'transfer') && (
          <SelectField
            label={form.type === 'transfer' ? 'Site destinataire' : 'Site'}
            required
            value={form.site_id}
            onChange={(e) => setForm({ ...form, site_id: e.target.value })}
          >
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
          Un transfert vers un site ne réduit jamais ce solde global — il ne fait que définir le plafond de dépense
          d'un site. Seule une dépense réelle réduit le solde global, et n'est jamais bloquée par manque de solde (il
          peut devenir négatif jusqu'à la prochaine recharge). En revanche, une dépense est bloquée si elle dépasse le
          plafond restant du site qui la déclare.
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
