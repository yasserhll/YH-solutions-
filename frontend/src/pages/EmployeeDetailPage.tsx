import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api/client';
import type { Employee } from '../types';
import { LoadingState } from '../components/ui/States';
import { StatusBadge } from '../components/ui/StatusBadge';
import clsx from 'clsx';

const tabs = ['Informations', 'Pointage', 'Congés', 'Sanctions', 'Affectations'] as const;
type Tab = (typeof tabs)[number];

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>('Informations');

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get<Employee>(`/employees/${id}`).then((r) => r.data),
  });

  if (isLoading || !employee) return <LoadingState rows={8} />;

  return (
    <div>
      <Link
        to="/personnel"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      >
        <ArrowLeft size={15} /> Retour au personnel
      </Link>

      <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{employee.full_name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {employee.site?.name} · {employee.department?.name ?? '—'} · {employee.position?.name ?? '—'}
          </p>
        </div>
        <StatusBadge status={employee.status} />
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'border-b-2 px-4 py-2 text-sm font-medium',
              tab === t
                ? 'border-slate-900 text-slate-900 dark:border-white dark:text-slate-100'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Informations' && <InfoTab employee={employee} />}
      {tab === 'Pointage' && <AttendanceTab employee={employee} />}
      {tab === 'Congés' && <LeavesTab employee={employee} />}
      {tab === 'Sanctions' && <SanctionsTab employee={employee} />}
      {tab === 'Affectations' && <AssignmentsTab employee={employee} />}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 py-2 text-sm last:border-0">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}

function InfoTab({ employee }: { employee: Employee }) {
  return (
    <div className="max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <InfoRow label="Nom complet" value={employee.full_name} />
      <InfoRow label="Site" value={employee.site?.name ?? '—'} />
      <InfoRow label="Département" value={employee.department?.name ?? '—'} />
      <InfoRow label="Fonction" value={employee.position?.name ?? '—'} />
      <InfoRow label="Établissement" value={employee.establishment ?? '—'} />
      <InfoRow label="Date d'entrée" value={employee.entry_date ? new Date(employee.entry_date).toLocaleDateString('fr-FR') : '—'} />
      <InfoRow label="Téléphone" value={employee.phone ?? '—'} />
      {employee.status === 'sorti' && (
        <InfoRow label="Date de sortie" value={employee.exit_date ? new Date(employee.exit_date).toLocaleDateString('fr-FR') : '—'} />
      )}
    </div>
  );
}

function AttendanceTab({ employee }: { employee: Employee }) {
  const rows = employee.attendances ?? [];
  if (rows.length === 0) return <p className="text-sm text-slate-400 dark:text-slate-500">Aucun pointage enregistré.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Statut</th>
            <th className="px-4 py-3 font-medium">Cause</th>
            <th className="px-4 py-3 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-2.5">{new Date(a.date).toLocaleDateString('fr-FR')}</td>
              <td className="px-4 py-2.5">
                <StatusBadge status={a.status} />
              </td>
              <td className="px-4 py-2.5">{a.absence_cause ? <StatusBadge status={a.absence_cause} /> : '—'}</td>
              <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{a.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeavesTab({ employee }: { employee: Employee }) {
  const requests = employee.leave_requests ?? [];
  const leaves = employee.leaves ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Demandes de congé</h3>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Aucune demande.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <th className="px-4 py-3 font-medium">Demande le</th>
                  <th className="px-4 py-3 font-medium">Début souhaité</th>
                  <th className="px-4 py-3 font-medium">Durée</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5">{new Date(r.request_date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-2.5">{new Date(r.desired_start_date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-2.5">{r.duration_days} j</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Congés pris & prolongations</h3>
        {leaves.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Aucun congé pris.</p>
        ) : (
          <div className="space-y-3">
            {leaves.map((l) => (
              <div key={l.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {new Date(l.start_date).toLocaleDateString('fr-FR')} → {new Date(l.end_date).toLocaleDateString('fr-FR')} (
                    {l.duration_days} j)
                  </span>
                  <StatusBadge status={l.status} />
                </div>
                {l.extensions && l.extensions.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-slate-100 dark:border-slate-800 pt-2 text-xs text-slate-500 dark:text-slate-400">
                    {l.extensions.map((ext) => (
                      <div key={ext.id}>
                        Prolongation de {ext.extra_days} j — {ext.reason} (nouvelle fin :{' '}
                        {new Date(ext.new_end_date).toLocaleDateString('fr-FR')})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SanctionsTab({ employee }: { employee: Employee }) {
  const warnings = employee.disciplinary_warnings ?? [];
  const suspensions = employee.suspensions ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Avertissements</h3>
        {warnings.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Aucun avertissement.</p>
        ) : (
          <div className="space-y-2">
            {warnings.map((w) => (
              <div key={w.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm">
                <div className="font-medium">
                  {new Date(w.date).toLocaleDateString('fr-FR')} — {w.reason}
                </div>
                {w.description && <p className="mt-1 text-slate-500 dark:text-slate-400">{w.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Mises à pied</h3>
        {suspensions.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Aucune mise à pied.</p>
        ) : (
          <div className="space-y-2">
            {suspensions.map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm">
                <div className="font-medium">
                  {new Date(s.start_date).toLocaleDateString('fr-FR')} → {new Date(s.end_date).toLocaleDateString('fr-FR')} (
                  {s.duration_days} j) — {s.reason}
                </div>
                {s.description && <p className="mt-1 text-slate-500 dark:text-slate-400">{s.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssignmentsTab({ employee }: { employee: Employee }) {
  const rows = employee.assignments ?? [];
  if (rows.length === 0) return <p className="text-sm text-slate-400 dark:text-slate-500">Aucune affectation.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <th className="px-4 py-3 font-medium">Début</th>
            <th className="px-4 py-3 font-medium">Fin</th>
            <th className="px-4 py-3 font-medium">Département</th>
            <th className="px-4 py-3 font-medium">Fonction</th>
            <th className="px-4 py-3 font-medium">Actuelle</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-2.5">{new Date(a.start_date).toLocaleDateString('fr-FR')}</td>
              <td className="px-4 py-2.5">{a.end_date ? new Date(a.end_date).toLocaleDateString('fr-FR') : '—'}</td>
              <td className="px-4 py-2.5">{a.department?.name ?? '—'}</td>
              <td className="px-4 py-2.5">{a.position?.name ?? '—'}</td>
              <td className="px-4 py-2.5">{a.is_current ? <StatusBadge status="actif" /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
