<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Contrats → CIN / Permis: every active employee's CIN expiry date, and
 * every driver's permis expiry date, with the days left and an alert
 * state. The dates are typed with the Entrée (or in Personnel) and can be
 * corrected here when a document is renewed. Behind the `contrats`
 * session, scoped to the employee's CURRENT site like the contracts.
 */
class EmployeeDocumentController extends Controller
{
    use InteractsWithSites;

    /** Orange from this many days before the expiry. */
    public const ALERT_DAYS = 30;

    /** Assumed validity, only used to draw the progress bar (Moroccan CNIE and permis: 10 years). */
    public const VALIDITY_YEARS = ['cin' => 10, 'permis' => 10];

    public function index(Request $request)
    {
        $doc = $this->doc($request);
        $column = $this->column($doc);
        $query = $this->base($request, $doc);

        if ($search = trim((string) $request->query('search'))) {
            $query->where('full_name', 'like', "%{$search}%");
        }
        if ($state = $request->query('state')) {
            $this->whereState($query, $column, $state);
        }

        $page = $query->with(['site:id,name', 'position:id,name'])
            // Expired / soonest first, missing dates last.
            ->orderByRaw("{$column} IS NULL")->orderBy($column)->orderBy('full_name')
            ->paginate(min($request->integer('per_page', 15), 100));

        $page->getCollection()->transform(fn (Employee $e) => $this->shape($e, $column));

        return $page;
    }

    public function summary(Request $request)
    {
        $doc = $this->doc($request);
        $column = $this->column($doc);
        $today = now()->toDateString();
        $soon = now()->addDays(self::ALERT_DAYS)->toDateString();

        $row = $this->base($request, $doc)->selectRaw(
            "COUNT(*) AS total,
             SUM({$column} IS NULL) AS manquante,
             SUM({$column} < ?) AS expire,
             SUM({$column} >= ? AND {$column} <= ?) AS bientot,
             SUM({$column} > ?) AS valide",
            [$today, $today, $soon, $soon]
        )->first();

        return response()->json([
            'doc' => $doc,
            'alert_days' => self::ALERT_DAYS,
            'validity_years' => self::VALIDITY_YEARS[$doc],
            'total' => (int) $row->total,
            'expire' => (int) $row->expire,
            'bientot' => (int) $row->bientot,
            'valide' => (int) $row->valide,
            'manquante' => (int) $row->manquante,
        ]);
    }

    /** Renewed CIN / permis: correct the dates (and whether the person drives). */
    public function update(Request $request, Employee $employee)
    {
        $this->ensureSiteAccess($request, $employee->site_id);
        $data = $request->validate([
            'cin_expiry_date' => ['sometimes', 'nullable', 'date'],
            'is_driver' => ['sometimes', 'boolean'],
            'license_expiry_date' => ['sometimes', 'nullable', 'date'],
        ]);
        if (array_key_exists('is_driver', $data)) {
            // Unticked on purpose: a "Chauffeur…" fonction no longer brings the person back into the list.
            $data['driver_opt_out'] = ! $data['is_driver'];
            if (! $data['is_driver']) {
                $data['license_expiry_date'] = null;
            }
        }

        $old = $employee->only(array_keys($data));
        $employee->update($data);

        $parts = [];
        if (array_key_exists('cin_expiry_date', $data)) {
            $parts[] = 'CIN '.($employee->cin_expiry_date?->format('d/m/Y') ?? 'non renseignée');
        }
        if (array_key_exists('license_expiry_date', $data) || array_key_exists('is_driver', $data)) {
            $parts[] = $employee->is_driver ? 'permis '.($employee->license_expiry_date?->format('d/m/Y') ?? 'non renseigné') : 'non conducteur';
        }
        AuditLogger::log('employee.documents_updated', "Pièces de {$employee->full_name} : ".implode(', ', $parts), $employee->site_id, $employee, $old, $data);

        return response()->json($this->shape($employee->load(['site:id,name', 'position:id,name']), $this->column($request->query('doc') === 'permis' ? 'permis' : 'cin')));
    }

    private function doc(Request $request): string
    {
        return $request->query('doc') === 'permis' ? 'permis' : 'cin';
    }

    private function column(string $doc): string
    {
        return $doc === 'permis' ? 'license_expiry_date' : 'cin_expiry_date';
    }

    /**
     * Active employees of the user's sites; for the permis, only drivers:
     * "Conducteur de camion" ticked, a permis date typed, or a "Chauffeur…"
     * fonction (so the drivers already on file show up without re-editing
     * them). Unticking the box in the edit form removes a chauffeur from
     * this list (driver_opt_out).
     */
    private function base(Request $request, string $doc): Builder
    {
        $query = Employee::query()->where('status', 'actif');
        $this->scopeToSite($query, $request);
        if ($doc === 'permis') {
            $query->where(fn ($q) => $q->where('is_driver', true)
                ->orWhereNotNull('license_expiry_date')
                ->orWhere(fn ($q) => $q->where('driver_opt_out', false)
                    ->whereHas('position', fn ($p) => $p->where('name', 'like', '%chauffeur%'))));
        }

        return $query;
    }

    private function whereState(Builder $query, string $column, string $state): void
    {
        $today = now()->toDateString();
        $soon = now()->addDays(self::ALERT_DAYS)->toDateString();
        match ($state) {
            'manquante' => $query->whereNull($column),
            'expire' => $query->where($column, '<', $today),
            'bientot' => $query->whereBetween($column, [$today, $soon]),
            'a_traiter' => $query->where(fn ($q) => $q->whereNull($column)->orWhere($column, '<=', $soon)),
            // The bell: expired or expiring soon (a missing date is not an alert).
            'alerte' => $query->whereNotNull($column)->where($column, '<=', $soon),
            'valide' => $query->where($column, '>', $soon),
            default => null,
        };
    }

    private function shape(Employee $e, string $column): array
    {
        $date = $e->{$column};
        $daysLeft = $date ? (int) now()->startOfDay()->diffInDays($date->copy()->startOfDay(), false) : null;

        return [
            'id' => $e->id,
            'full_name' => $e->full_name,
            'matricule' => $e->matricule,
            'site' => $e->site,
            'position' => $e->position,
            'entry_date' => $e->entry_date?->toDateString(),
            'cin_expiry_date' => $e->cin_expiry_date?->toDateString(),
            'is_driver' => (bool) $e->is_driver || ($e->license_expiry_date !== null) || (! $e->driver_opt_out && stripos((string) $e->position?->name, 'chauffeur') !== false),
            'license_expiry_date' => $e->license_expiry_date?->toDateString(),
            'expiry_date' => $date?->toDateString(),
            'days_left' => $daysLeft,
            'state' => match (true) {
                $daysLeft === null => 'manquante',
                $daysLeft < 0 => 'expire',
                $daysLeft <= self::ALERT_DAYS => 'bientot',
                default => 'valide',
            },
        ];
    }
}
