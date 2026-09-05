import clsx from 'clsx';

const palettes: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400',
};

const map: Record<string, { label: string; color: keyof typeof palettes }> = {
  present: { label: 'Présent', color: 'green' },
  absent: { label: 'Absent', color: 'red' },
  maladie: { label: 'Maladie', color: 'amber' },
  autorisee: { label: 'Autorisée', color: 'blue' },
  non_autorisee: { label: 'Non autorisée', color: 'red' },
  justifie: { label: 'Justifié', color: 'teal' },
  conge: { label: 'Congé', color: 'purple' },
  en_attente: { label: 'En attente', color: 'amber' },
  acceptee: { label: 'Acceptée', color: 'green' },
  refusee: { label: 'Refusée', color: 'red' },
  annulee: { label: 'Annulée', color: 'gray' },
  en_cours: { label: 'En cours', color: 'blue' },
  termine: { label: 'Terminé', color: 'gray' },
  actif: { label: 'Actif', color: 'green' },
  sorti: { label: 'Sorti', color: 'gray' },
  avertissement: { label: 'Avertissement', color: 'amber' },
  mise_a_pied: { label: 'Mise à pied', color: 'red' },
  expense: { label: 'Dépense', color: 'red' },
  entry: { label: 'Entrée', color: 'green' },
  transfer: { label: 'Transfert', color: 'blue' },
};

export function StatusBadge({ status }: { status: string }) {
  const config = map[status] ?? { label: status, color: 'gray' as const };
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', palettes[config.color])}>
      {config.label}
    </span>
  );
}
