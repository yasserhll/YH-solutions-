<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\FuelAssignment;
use App\Models\FuelBonAttachment;
use App\Models\FuelMovement;
use App\Models\FuelTank;
use App\Models\FuelVehicle;
use App\Models\Site;
use App\Services\AuditLogger;
use App\Services\FuelConsumptionService;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * "Bons carburant" session: the pompiste picks a citerne of its site and
 * types each paper BON (n° bon, date / heure, société, séries départ / fin,
 * véhicule, compteur, litres, conducteur) with photos as proof.
 *
 * A bon IS a SORTIE line of that citerne (`fuel_movements`, origin = 'bon'),
 * exactly the line the citerne's Excel sheet would hold, so the Global, the
 * daily Rapport and the consumption chain use it with nothing else to do.
 * A re-import of the citerne's Excel never deletes a bon, and skips the
 * Excel line carrying the same n° de bon (FuelImportService).
 */
class FuelBonController extends Controller
{
    use InteractsWithSites;

    public function __construct(protected FuelConsumptionService $consumption) {}

    /** The citernes of the user's sites, with the pump index the next bon starts from. */
    public function tanks(Request $request)
    {
        $sites = $this->scopeToSite(Site::query()->select('id'), $request, 'id');
        $tanks = FuelTank::with('site:id,name')->whereIn('site_id', $sites)->orderBy('name')->get();
        $today = now()->toDateString();

        $stats = DB::table('fuel_movements')
            ->whereIn('fuel_tank_id', $tanks->pluck('id'))
            ->where('type', 'exit')
            ->groupBy('fuel_tank_id')
            ->get([
                'fuel_tank_id',
                DB::raw("SUM(origin = 'bon') as bons"),
                DB::raw("SUM(date = '{$today}') as today_count"),
                DB::raw("SUM(CASE WHEN date = '{$today}' THEN quantity ELSE 0 END) as today_litres"),
                DB::raw('MAX(date) as last_date'),
            ])->keyBy('fuel_tank_id');

        return response()->json($tanks->map(fn (FuelTank $tank) => [
            'id' => $tank->id,
            'name' => $tank->name,
            'site' => $tank->site,
            'last_serie' => $this->lastSerie($tank->id),
            ...$this->nextBon($tank->id),
            'bons' => (int) ($stats[$tank->id]->bons ?? 0),
            'today_count' => (int) ($stats[$tank->id]->today_count ?? 0),
            'today_litres' => round((float) ($stats[$tank->id]->today_litres ?? 0), 2),
            'last_date' => $stats[$tank->id]->last_date ?? null,
        ]));
    }

    /** The citerne's sorties, newest first, laid out like its Excel sheet. */
    public function index(Request $request)
    {
        $tank = $this->tank($request, $request->query('fuel_tank_id'));
        $query = FuelMovement::query()
            ->from('fuel_movements as m')
            ->leftJoin('fuel_vehicles as v', 'v.code', '=', 'm.vehicle_code')
            ->leftJoin('users as u', 'u.id', '=', 'm.created_by')
            ->where('m.fuel_tank_id', $tank->id)
            ->where('m.type', 'exit')
            ->when($request->query('date_from'), fn ($q, $d) => $q->where('m.date', '>=', $d))
            ->when($request->query('date_to'), fn ($q, $d) => $q->where('m.date', '<=', $d))
            ->when($request->boolean('bons_only'), fn ($q) => $q->where('m.origin', 'bon'))
            ->when($request->query('search'), function ($q, $search) {
                $like = '%'.trim($search).'%';
                $q->where(fn ($w) => $w->where('m.bon_number', 'like', $like)
                    ->orWhere('m.vehicle_code', 'like', $like)
                    ->orWhere('v.fleet_code', 'like', $like)
                    ->orWhere('v.matricule', 'like', $like)
                    ->orWhere('m.driver_name', 'like', $like));
            });

        $totals = (clone $query)->selectRaw('COUNT(*) as count, COALESCE(SUM(m.quantity), 0) as litres')->first();

        $page = $query
            ->select('m.*', 'v.matricule', 'v.fleet_code', 'v.type as vehicle_type', 'u.name as creator_name')
            ->selectRaw('(SELECT COUNT(*) FROM fuel_bon_attachments a WHERE a.fuel_movement_id = m.id) as attachments_count')
            ->orderByDesc('m.date')->orderByDesc('m.time')->orderByDesc('m.id')
            ->paginate(min((int) $request->query('per_page', 50), 200));

        return response()->json([
            ...$page->toArray(),
            'totals' => ['count' => (int) $totals->count, 'litres' => round((float) $totals->litres, 2)],
            'last_serie' => $this->lastSerie($tank->id),
        ]);
    }

    /**
     * Every vehicle of the fleet for the vehicle picker / QR scan — the
     * citerne's own site first: a vehicle of another site (déplacement)
     * still refuels here (E43 of Mzinda at Louta). Each one comes with its
     * conducteurs of the 1st / 2nd shift from its site's affectation.
     */
    public function vehicles(Request $request)
    {
        $tank = $this->tank($request, $request->query('fuel_tank_id'));
        $drivers = FuelAssignment::get(['site_id', 'code', 'driver_1', 'driver_2'])
            ->keyBy(fn ($a) => $a->site_id.'|'.$a->code);
        $sites = Site::pluck('name', 'id');

        $vehicles = FuelVehicle::query()
            ->orderByRaw('site_id IS NULL')
            ->orderByRaw('site_id = ? DESC', [$tank->site_id])
            ->orderByRaw('sort_order IS NULL')->orderBy('sort_order')->orderBy('code')
            ->get(['id', 'code', 'fleet_code', 'matricule', 'type', 'status', 'site_id'])
            ->map(function (FuelVehicle $v) use ($drivers, $sites, $tank) {
                $a = $drivers[$v->site_id.'|'.$v->code] ?? $drivers[$tank->site_id.'|'.$v->code] ?? null;

                return [
                    ...$v->only(['id', 'code', 'fleet_code', 'matricule', 'type', 'status', 'site_id']),
                    'site_name' => $v->site_id ? ($sites[$v->site_id] ?? null) : null,
                    'driver_1' => $a?->driver_1,
                    'driver_2' => $a?->driver_2,
                ];
            });

        return response()->json($vehicles);
    }

    /** The vehicle's last refuel on this site (to check the compteur being typed). */
    public function lastRefuel(Request $request)
    {
        $tank = $this->tank($request, $request->query('fuel_tank_id'));
        $code = FuelVehicle::normalizeCode($request->query('vehicle_code'));
        $last = $code === null ? null : FuelMovement::where('site_id', $tank->site_id)
            ->where('type', 'exit')->where('vehicle_code', $code)
            ->when($request->query('except'), fn ($q, $id) => $q->where('id', '!=', $id))
            ->orderByDesc('date')->orderByDesc('time')->orderByDesc('id')
            ->first(['date', 'time', 'odometer', 'quantity', 'driver_name']);

        return response()->json($last);
    }

    public function store(Request $request)
    {
        $tank = $this->tank($request, $request->input('fuel_tank_id'));
        $data = $this->validated($request, $tank);
        $this->ensureNewBon($tank, $data['bon_number'], $data['date']);
        $request->validate(
            ['attachments' => ['required', 'array', 'min:1']],
            ['attachments.required' => 'Ajoutez au moins une photo du bon comme preuve.', 'attachments.min' => 'Ajoutez au moins une photo du bon comme preuve.'],
        );

        $user = $request->user();
        $bon = DB::transaction(function () use ($request, $tank, $data, $user) {
            $bon = FuelMovement::create($data + [
                'fuel_tank_id' => $tank->id,
                'site_id' => $tank->site_id,
                'type' => 'exit',
                'origin' => 'bon',
                'created_by' => $user->id,
                'created_at' => now(),
            ]);
            $this->storeFiles($request, $bon);

            return $bon;
        });

        $this->consumption->recalculate();
        AuditLogger::log('bon.created', "Bon n° {$bon->bon_number} : {$bon->vehicle_code}, {$this->litres($bon)} L le {$bon->date->format('d/m/Y')} ({$tank->name})", $tank->site_id, $bon);

        return response()->json($this->present($bon), 201);
    }

    /** POST (multipart, so new photos can come with the correction). */
    public function update(Request $request, FuelMovement $fuelMovement)
    {
        $this->ensureCanEdit($request, $fuelMovement);
        $tank = $fuelMovement->tank;
        $data = $this->validated($request, $tank);
        $this->ensureNewBon($tank, $data['bon_number'], $data['date'], $fuelMovement->id);
        $old = $fuelMovement->only(array_keys($data));

        DB::transaction(function () use ($request, $fuelMovement, $data) {
            $fuelMovement->update($data);
            $this->storeFiles($request, $fuelMovement);
        });

        $this->consumption->recalculate();
        AuditLogger::log('bon.updated', "Bon n° {$fuelMovement->bon_number} ({$fuelMovement->vehicle_code}) du {$fuelMovement->date->format('d/m/Y')} modifié ({$tank->name})", $tank->site_id, $fuelMovement, $old, $data);

        return response()->json($this->present($fuelMovement->fresh()));
    }

    public function destroy(Request $request, FuelMovement $fuelMovement)
    {
        $this->ensureCanEdit($request, $fuelMovement);
        $paths = $fuelMovement->attachments()->pluck('path')->all();

        $fuelMovement->delete();
        Storage::disk('local')->delete($paths);

        $this->consumption->recalculate();
        AuditLogger::log('bon.deleted', "Bon n° {$fuelMovement->bon_number} ({$fuelMovement->vehicle_code}, {$this->litres($fuelMovement)} L) du {$fuelMovement->date->format('d/m/Y')} supprimé", $fuelMovement->site_id, $fuelMovement);

        return response()->noContent();
    }

    public function attachments(Request $request, FuelMovement $fuelMovement)
    {
        $this->ensureSiteAccess($request, $fuelMovement->site_id);

        return response()->json($fuelMovement->attachments()->orderBy('id')->get());
    }

    public function attachment(Request $request, FuelMovement $fuelMovement, FuelBonAttachment $attachment)
    {
        $this->ensureSiteAccess($request, $fuelMovement->site_id);
        abort_if($attachment->fuel_movement_id !== $fuelMovement->id, 404);
        abort_unless(Storage::disk('local')->exists($attachment->path), 404, 'Fichier introuvable.');

        return response()->file(Storage::disk('local')->path($attachment->path), [
            'Content-Type' => $attachment->mime,
            'Content-Disposition' => 'inline; filename="'.addslashes($attachment->original_name).'"',
        ]);
    }

    public function destroyAttachment(Request $request, FuelMovement $fuelMovement, FuelBonAttachment $attachment)
    {
        $this->ensureCanEdit($request, $fuelMovement);
        abort_if($attachment->fuel_movement_id !== $fuelMovement->id, 404);
        abort_if($fuelMovement->attachments()->count() <= 1, 422, 'Un bon garde au moins une preuve : ajoutez la nouvelle photo avant de retirer celle-ci.');

        Storage::disk('local')->delete($attachment->path);
        $attachment->delete();

        return response()->noContent();
    }

    protected function tank(Request $request, mixed $id): FuelTank
    {
        abort_if(! $id, 422, 'Choisissez une citerne.');
        $tank = FuelTank::findOrFail($id);
        $this->ensureSiteAccess($request, $tank->site_id);

        return $tank;
    }

    /** A pompiste corrects its own bons; a responsable / SuperAdmin any bon of its sites. */
    protected function ensureCanEdit(Request $request, FuelMovement $bon): void
    {
        $this->ensureSiteAccess($request, $bon->site_id);
        abort_if($bon->origin !== 'bon', 422, 'Cette ligne vient du fichier Excel de la citerne : elle se corrige depuis Consommation → Global.');
        $user = $request->user();
        abort_if($user->role === 'pompiste' && $bon->created_by !== $user->id, 403, 'Vous ne pouvez modifier que les bons que vous avez saisis.');
    }

    /** The same paper bon can't be typed twice on one citerne (nor re-typed over an imported line). */
    /**
     * The n° the next bon most likely carries: the paper bons are numbered in
     * sequence, so it is the highest n° among the citerne's latest sorties
     * + 1, written like them (leading zeros kept: 0075951 → 0075952), and
     * never one already used on the citerne in the last BON_WINDOW_DAYS (carnets are reused). Only a suggestion: the
     * pompiste can type another n° (a new carnet, a skipped bon).
     *
     * @return array{last_bon: ?string, next_bon: ?string}
     */
    protected function nextBon(int $tankId): array
    {
        $recent = DB::table('fuel_movements')
            ->where('fuel_tank_id', $tankId)->where('type', 'exit')->whereNotNull('bon_number')
            ->orderByDesc('date')->orderByDesc('serie_end')->orderByDesc('id')
            ->limit(30)->pluck('bon_number')
            ->map(fn ($n) => trim((string) $n))
            ->filter(fn ($n) => preg_match('/^\d{1,15}$/', $n));
        if ($recent->isEmpty()) {
            return ['last_bon' => null, 'next_bon' => null];
        }

        $last = $recent->sortByDesc(fn ($n) => (int) $n)->first();
        $width = strlen($last);
        $used = DB::table('fuel_movements')
            ->where('fuel_tank_id', $tankId)->where('type', 'exit')->whereNotNull('bon_number')
            ->where('date', '>=', now()->subDays(self::BON_WINDOW_DAYS)->toDateString())
            ->whereRaw("TRIM(LEADING '0' FROM REPLACE(bon_number, ' ', '')) BETWEEN ? AND ?", [(string) ((int) $last + 1), (string) ((int) $last + 50)])
            ->pluck('bon_number')->map(fn ($n) => (int) $n)->flip();
        $next = (int) $last + 1;
        while (isset($used[$next]) && $next < (int) $last + 50) {
            $next++;
        }

        return ['last_bon' => $last, 'next_bon' => str_pad((string) $next, $width, '0', STR_PAD_LEFT)];
    }

    /**
     * The carnets are reused: the same n° comes back months later on the same
     * citerne (85751A55: bons 1905-1911 in March and again in October). So a
     * n° only counts as a duplicate within BON_WINDOW_DAYS of the bon's date.
     */
    public const BON_WINDOW_DAYS = 60;

    protected function ensureNewBon(FuelTank $tank, string $number, string $date, ?int $exceptId = null): void
    {
        $normalized = FuelMovement::normalizeBon($number);
        $day = \Illuminate\Support\Carbon::parse($date);
        $existing = FuelMovement::where('fuel_tank_id', $tank->id)
            ->where('type', 'exit')
            ->whereNotNull('bon_number')
            ->whereBetween('date', [$day->copy()->subDays(self::BON_WINDOW_DAYS)->toDateString(), $day->copy()->addDays(self::BON_WINDOW_DAYS)->toDateString()])
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))
            ->whereRaw("TRIM(LEADING '0' FROM REPLACE(UPPER(bon_number), ' ', '')) = ?", [$normalized])
            ->first(['date', 'vehicle_code', 'origin']);

        abort_if($existing !== null, 422, "Le bon n° {$number} est déjà enregistré sur {$tank->name} ("
            .($existing?->vehicle_code ?? '-').' le '.$existing?->date->format('d/m/Y')
            .($existing?->origin === 'import' ? ', fichier Excel' : '').').');
    }

    protected function validated(Request $request, FuelTank $tank): array
    {
        $request->merge([
            'vehicle_code' => FuelVehicle::normalizeCode($request->input('vehicle_code')),
            'bon_number' => trim((string) $request->input('bon_number')),
        ]);
        $nullable = fn ($v) => $v === '' || $v === 'null' ? null : $v;
        foreach (['time', 'company', 'odometer', 'serie_start', 'serie_end', 'driver_name', 'driver_cin', 'pompiste_name', 'remark'] as $key) {
            if ($request->has($key)) {
                $request->merge([$key => $nullable($request->input($key))]);
            }
        }

        $data = $request->validate([
            'bon_number' => ['required', 'string', 'max:60'],
            'date' => ['required', 'date', 'before_or_equal:'.now()->addDay()->toDateString()],
            'time' => ['nullable', 'date_format:H:i'],
            'company' => ['nullable', 'string', 'max:120'],
            'vehicle_code' => ['required', 'string', 'max:60'],
            'odometer' => ['nullable', 'numeric', 'min:0'],
            'serie_start' => ['nullable', 'numeric', 'min:0'],
            'serie_end' => ['nullable', 'numeric', 'min:0'],
            'quantity' => ['required', 'numeric', 'gt:0', 'max:100000'],
            'driver_name' => ['nullable', 'string', 'max:120'],
            'driver_cin' => ['nullable', 'string', 'max:30'],
            'pompiste_name' => ['nullable', 'string', 'max:120'],
            'remark' => ['nullable', 'string', 'max:255'],
            'attachments' => ['sometimes', 'array', 'max:10'],
            'attachments.*' => ['file', 'mimes:jpg,jpeg,png,webp,heic,heif,pdf', 'max:10240'],
        ], [
            'bon_number.required' => 'Le n° du bon est obligatoire.',
            'vehicle_code.required' => 'Choisissez ou scannez le véhicule.',
            'quantity.required' => 'Les litres sont obligatoires.',
            'quantity.gt' => 'Les litres doivent être supérieurs à 0.',
            'date.before_or_equal' => 'La date du bon ne peut pas être dans le futur.',
            'attachments.*.mimes' => 'Les preuves doivent être des photos (JPG, PNG, WEBP, HEIC) ou des PDF.',
            'attachments.*.max' => 'Chaque preuve doit faire moins de 10 Mo.',
            'attachments.*.uploaded' => 'Une preuve n\'a pas pu être envoyée (fichier trop lourd pour le serveur).',
        ]);
        unset($data['attachments']);

        if (isset($data['serie_start'], $data['serie_end'])) {
            abort_if($data['serie_end'] < $data['serie_start'], 422, 'La série fin doit être supérieure ou égale à la série de départ.');
            $pumped = round($data['serie_end'] - $data['serie_start'], 2);
            abort_if(abs($pumped - $data['quantity']) > 0.5, 422, "Les litres ({$this->number($data['quantity'])} L) ne correspondent pas aux séries : fin − départ = {$this->number($pumped)} L.");
        }

        $data['time'] = isset($data['time']) ? $data['time'].':00' : null;
        $data['pompiste_name'] ??= $request->user()->name;
        $data['remark'] ??= null;
        $data['company'] = isset($data['company']) ? mb_strtoupper(trim($data['company'])) : null;

        return $data;
    }

    protected function storeFiles(Request $request, FuelMovement $bon): void
    {
        $files = $request->file('attachments', []);
        foreach (is_array($files) ? $files : [$files] as $file) {
            if (! $file instanceof UploadedFile) {
                continue;
            }
            $path = $file->store('bons/'.$bon->site_id.'/'.$bon->date->format('Y-m'), 'local');
            abort_if($path === false, 500, 'La preuve n\'a pas pu être enregistrée sur le serveur.');
            $bon->attachments()->create([
                'path' => $path,
                'original_name' => mb_substr($file->getClientOriginalName() ?: 'preuve', 0, 250),
                'mime' => $file->getMimeType() ?: 'application/octet-stream',
                'size' => $file->getSize(),
                'uploaded_by' => $request->user()->id,
            ]);
        }
    }

    protected function present(FuelMovement $bon): array
    {
        $bon->loadCount('attachments');

        return $bon->toArray();
    }

    protected function lastSerie(int $tankId): ?float
    {
        $value = DB::table('fuel_movements')
            ->where('fuel_tank_id', $tankId)
            ->whereNotNull('serie_end')
            // By date then pump index: a re-import gives the Excel lines higher ids than the bons typed before it.
            ->orderByDesc('date')->orderByDesc('serie_end')
            ->value('serie_end');

        return $value === null ? null : (float) $value;
    }

    protected function litres(FuelMovement $bon): string
    {
        return $this->number($bon->quantity);
    }

    protected function number(float $value): string
    {
        return rtrim(rtrim(number_format($value, 2, ',', ' '), '0'), ',');
    }
}
