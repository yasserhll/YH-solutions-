import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { Attendance, CashTransaction, DisciplinaryWarning, Entry, Exit, LeaveRequest, Paginated, Suspension } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable, type Column } from '../components/ui/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';

const tabs = ['Pointage', 'Congés', 'Sanctions', 'Entrées / Sorties', 'Caisse'] as const;

export default function ReportsPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Pointage');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const siteParams = useSiteParams();
  const period = { date_from: dateFrom || undefined, date_to: dateTo || undefined };

  const attendanceQuery = useQuery({
    queryKey: ['report-attendance', siteParams, period],
    queryFn: () => api.get<Paginated<Attendance>>('/reports/attendance', { params: { ...siteParams, ...period } }).then((r) => r.data),
    enabled: tab === 'Pointage',
  });

  const leavesQuery = useQuery({
    queryKey: ['report-leaves', siteParams, period],
    queryFn: () => api.get<Paginated<LeaveRequest>>('/reports/leaves', { params: { ...siteParams, ...period } }).then((r) => r.data),
    enabled: tab === 'Congés',
  });

  const sanctionsQuery = useQuery({
    queryKey: ['report-sanctions', siteParams, period],
    queryFn: () =>
      api
        .get<Array<(DisciplinaryWarning | Suspension) & { type: string }>>('/reports/sanctions', { params: { ...siteParams, ...period } })
        .then((r) => r.data),
    enabled: tab === 'Sanctions',
  });

  const movementsQuery = useQuery({
    queryKey: ['report-movements', siteParams, period],
    queryFn: () =>
      api.get<{ entries: Entry[]; exits: Exit[] }>('/reports/movements', { params: { ...siteParams, ...period } }).then((r) => r.data),
    enabled: tab === 'Entrées / Sorties',
  });

  const cashQuery = useQuery({
    queryKey: ['report-cash', siteParams, period],
    queryFn: () => api.get<Paginated<CashTransaction>>('/reports/cash', { params: { ...siteParams, ...period } }).then((r) => r.data),
    enabled: tab === 'Caisse',
  });

  const attendanceColumns: Column<Attendance>[] = [
    { header: 'Date', accessor: (a) => new Date(a.date).toLocaleDateString('fr-FR') },
    { header: 'Employé', accessor: (a) => a.employee?.full_name },
    { header: 'Site', accessor: (a) => a.site?.name },
    { header: 'Statut', accessor: (a) => <StatusBadge status={a.status} /> },
    { header: 'Cause', accessor: (a) => (a.absence_cause ? <StatusBadge status={a.absence_cause} /> : '—') },
  ];

  const leaveColumns: Column<LeaveRequest>[] = [
    { header: 'Demandé le', accessor: (r) => new Date(r.request_date).toLocaleDateString('fr-FR') },
    { header: 'Employé', accessor: (r) => r.employee?.full_name },
    { header: 'Site', accessor: (r) => r.site?.name },
    { header: 'Durée', accessor: (r) => `${r.duration_days} j` },
    { header: 'Statut', accessor: (r) => <StatusBadge status={r.status} /> },
  ];

  const sanctionColumns: Column<(DisciplinaryWarning | Suspension) & { type: string }>[] = [
    { header: 'Date', accessor: (s) => new Date(s.date).toLocaleDateString('fr-FR') },
    { header: 'Employé', accessor: (s) => s.employee?.full_name },
    { header: 'Site', accessor: (s) => s.site?.name },
    { header: 'Type', accessor: (s) => <StatusBadge status={s.type} /> },
    { header: 'Motif', accessor: (s) => s.reason },
  ];

  const entryColumns: Column<Entry>[] = [
    { header: "Date d'entrée", accessor: (e) => new Date(e.entry_date).toLocaleDateString('fr-FR') },
    { header: 'Nom complet', accessor: (e) => e.full_name },
    { header: 'Site', accessor: (e) => e.site?.name },
    { header: 'Département', accessor: (e) => e.department?.name ?? '—' },
  ];

  const exitColumns: Column<Exit>[] = [
    { header: 'Date de sortie', accessor: (e) => new Date(e.exit_date).toLocaleDateString('fr-FR') },
    { header: 'Nom complet', accessor: (e) => e.full_name },
    { header: 'Site', accessor: (e) => e.site?.name },
    { header: 'Département', accessor: (e) => e.department?.name ?? '—' },
  ];

  const cashColumns: Column<CashTransaction>[] = [
    { header: 'Date', accessor: (t) => new Date(t.date).toLocaleDateString('fr-FR') },
    { header: 'Bénéficiaire', accessor: (t) => t.beneficiary ?? '—' },
    { header: 'Site', accessor: (t) => t.site?.name ?? '—' },
    { header: 'Montant', accessor: (t) => `${t.amount} DH` },
  ];

  return (
    <div>
      <PageHeader title="Rapports" description="Filtrer et consulter l'historique par module" />

      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium',
              tab === t
                ? 'border-slate-900 text-slate-900 dark:border-white dark:text-slate-100'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <span className="text-sm text-slate-400 dark:text-slate-500">à</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {tab === 'Pointage' && (
          <DataTable
            columns={attendanceColumns}
            rows={attendanceQuery.data?.data ?? []}
            isLoading={attendanceQuery.isLoading}
            keyFn={(a) => a.id}
          />
        )}
        {tab === 'Congés' && (
          <DataTable columns={leaveColumns} rows={leavesQuery.data?.data ?? []} isLoading={leavesQuery.isLoading} keyFn={(r) => r.id} />
        )}
        {tab === 'Sanctions' && (
          <DataTable
            columns={sanctionColumns}
            rows={sanctionsQuery.data ?? []}
            isLoading={sanctionsQuery.isLoading}
            keyFn={(s) => `${s.type}-${s.id}`}
          />
        )}
        {tab === 'Entrées / Sorties' && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <div className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Entrées</h3>
              <DataTable
                columns={entryColumns}
                rows={movementsQuery.data?.entries ?? []}
                isLoading={movementsQuery.isLoading}
                keyFn={(e) => e.id}
              />
            </div>
            <div className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Sorties</h3>
              <DataTable
                columns={exitColumns}
                rows={movementsQuery.data?.exits ?? []}
                isLoading={movementsQuery.isLoading}
                keyFn={(e) => e.id}
              />
            </div>
          </div>
        )}
        {tab === 'Caisse' && (
          <DataTable columns={cashColumns} rows={cashQuery.data?.data ?? []} isLoading={cashQuery.isLoading} keyFn={(t) => t.id} />
        )}
      </div>
    </div>
  );
}
