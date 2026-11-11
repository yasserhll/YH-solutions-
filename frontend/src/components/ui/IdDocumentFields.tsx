import { TextField } from './Field';

export interface IdDocumentValues {
  cin_expiry_date: string;
  is_driver: boolean;
  license_expiry_date: string;
}

/** A Fonction like "Chauffeur De Camion" / "Chauffeur D'Arroseur" ticks "Conducteur de camion" by default. */
export function isDriverPosition(name: string | null | undefined): boolean {
  return !!name && /chauffeur/i.test(name);
}

/** Whether the "Conducteur de camion" box starts ticked for an existing employee (same rule as the Permis list). */
export function startsAsDriver(
  employee: { is_driver?: boolean; license_expiry_date?: string | null; driver_opt_out?: boolean } | null | undefined,
  positionName: string | null | undefined,
): boolean {
  if (!employee) return false;
  return !!employee.is_driver || !!employee.license_expiry_date || (!employee.driver_opt_out && isDriverPosition(positionName));
}

/**
 * CIN expiry date, "Conducteur de camion" and (only for a driver) permis
 * expiry date — shared by the Entrée and Personnel forms; followed in
 * Contrats → CIN / Permis.
 */
export function IdDocumentFields({ value, onChange }: { value: IdDocumentValues; onChange: (next: IdDocumentValues) => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Pièces d'identité</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label="Date d'expiration CIN"
          type="date"
          value={value.cin_expiry_date}
          onChange={(e) => onChange({ ...value, cin_expiry_date: e.target.value })}
        />
        {value.is_driver && (
          <TextField
            label="Date d'expiration du permis"
            type="date"
            value={value.license_expiry_date}
            onChange={(e) => onChange({ ...value, license_expiry_date: e.target.value })}
          />
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
          checked={value.is_driver}
          onChange={(e) => onChange({ ...value, is_driver: e.target.checked, license_expiry_date: e.target.checked ? value.license_expiry_date : '' })}
        />
        Conducteur de camion (permis de conduire)
      </label>
    </div>
  );
}
