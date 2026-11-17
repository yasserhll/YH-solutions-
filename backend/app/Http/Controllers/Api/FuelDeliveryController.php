<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Concerns\ReceivesExcelUpload;
use App\Http\Controllers\Controller;
use App\Models\FuelDeliveryAttachment;
use App\Models\FuelDelivery;
use App\Models\FuelMovement;
use App\Models\FuelTank;
use App\Models\Site;
use App\Services\AuditLogger;
use App\Services\ExcelExportService;
use App\Services\FuelInventoryImportService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * "Entrées carburant": the deliveries of gasoil into the citernes, with
 * their prices.
 *
 * - The pompiste types the supplier's BON DE LIVRAISON (n° BL, n° de
 *   commande, fournisseur, quantité, jauge before / after, photo). It
 *   becomes the ENTREE line of the citerne (`fuel_movements`, origin
 *   'livraison'), so Détail citernes shows it with nothing else to do.
 * - The responsable / SuperAdmin completes the price (PU, montant HT,
 *   facture) or imports it from the INVENTAIRE workbook, and follows the
 *   litres bought, the amounts and the PMP (prix moyen pondéré).
 * - A pompiste never sees a price (stripped here, not only in the UI).
 */
class FuelDeliveryController extends Controller
{
    use InteractsWithSites;
    use ReceivesExcelUpload;

    /** The same BL / commande twice on a citerne is refused within this many days. */
    public const WINDOW_DAYS = 60;

    /** The citernes the user can deliver into, and the suppliers seen so far. */
    public function tanks(Request $request)
    {
        $sites = $this->scopeToSite(Site::query()->select('id'), $request, 'id');
        $tanks = FuelTank::with('site:id,name')->whereIn('site_id', $sites)->orderBy('site_id')->orderBy('name')->get();
        $last = FuelDelivery::whereIn('fuel_tank_id', $tanks->pluck('id'))
            ->groupBy('fuel_tank_id')->get(['fuel_tank_id', DB::raw('MAX(date) as last_date'), DB::raw('COUNT(*) as deliveries')])
            ->keyBy('fuel_tank_id');

        $suppliers = collect(FuelDelivery::SUPPLIERS)
            ->merge(FuelDelivery::whereNotNull('supplier')->distinct()->pluck('supplier'))
            ->unique()->values();

        return response()->json([
            'tanks' => $tanks->map(fn (FuelTank $t) => [
                'id' => $t->id,
                'name' => $t->name,
                'site' => $t->site,
                'last_date' => $last[$t->id]->last_date ?? null,
                'deliveries' => (int) ($last[$t->id]->deliveries ?? 0),
            ]),
            'suppliers' => $suppliers,
        ]);
    }

    public function index(Request $request)
    {
        $query = $this->filtered($request);
        $totals = $this->totals(clone $query);

        $page = $query->with(['tank:id,name', 'site:id,name', 'creator:id,name'])
            ->withCount(['attachments', 'attachments as invoice_attachments_count' => fn ($q) => $q->where('kind', 'facture')])
            ->orderByDesc('date')->orderByDesc('time')->orderByDesc('id')
            ->paginate(min(max((int) $request->query('per_page', 50), 10), 200));

        $page->getCollection()->transform(fn (FuelDelivery $d) => $this->present($request, $d));

        return response()->json([...$page->toArray(), 'totals' => $this->hidePrices($request, $totals)]);
    }

    /** Litres / montant / PMP per month, per fournisseur and per site, for one year. */
    public function summary(Request $request)
    {
        $this->ensureCanSeePrices($request);
        $year = (int) $request->query('year', now()->year);
        $base = fn () => $this->filtered($request)->whereYear('date', $year);
        $agg = 'COUNT(*) as count, SUM(quantity) as litres, SUM(amount) as amount, SUM(CASE WHEN unit_price IS NOT NULL THEN quantity ELSE 0 END) as priced_litres';
        $shape = fn ($r) => [
            'count' => (int) $r->count,
            'litres' => round((float) $r->litres, 2),
            'amount' => round((float) $r->amount, 2),
            'pmp' => (float) $r->priced_litres > 0 ? round((float) $r->amount / (float) $r->priced_litres, 4) : null,
        ];

        $months = $base()->selectRaw('MONTH(date) as month, '.$agg)->groupByRaw('MONTH(date)')->get()->keyBy('month');
        $suppliers = $base()->selectRaw("COALESCE(supplier, '—') as supplier, ".$agg)->groupByRaw("COALESCE(supplier, '—')")->orderByDesc('litres')->get();
        $sites = $base()->selectRaw('site_id, MONTH(date) as month, '.$agg)->groupBy('site_id')->groupByRaw('MONTH(date)')->get();
        $siteNames = Site::pluck('name', 'id');

        return response()->json([
            'year' => $year,
            'total' => $shape($base()->selectRaw($agg)->toBase()->first()),
            'months' => collect(range(1, 12))->map(fn ($m) => ['month' => $m] + (isset($months[$m]) ? $shape($months[$m]) : ['count' => 0, 'litres' => 0, 'amount' => 0, 'pmp' => null])),
            'suppliers' => $suppliers->map(fn ($r) => ['supplier' => $r->supplier] + $shape($r)),
            'sites' => $sites->groupBy('site_id')->map(fn ($rows, $siteId) => [
                'site_id' => (int) $siteId,
                'site_name' => $siteNames[$siteId] ?? '—',
                'months' => $rows->mapWithKeys(fn ($r) => [(int) $r->month => $shape($r)]),
                'total' => $shape((object) [
                    'count' => $rows->sum('count'),
                    'litres' => $rows->sum('litres'),
                    'amount' => $rows->sum('amount'),
                    'priced_litres' => $rows->sum('priced_litres'),
                ]),
            ])->values(),
        ]);
    }

    public function store(Request $request)
    {
        $tank = $this->tank($request, $request->input('fuel_tank_id'));
        $data = $this->validated($request);
        $this->ensureNew($tank, $data);
        // A proof is required: the BL photo (pompiste), or the BL / the invoice (responsable).
        $proof = $this->canSeePrices($request) ? 'required_without:invoice_attachments' : 'required';
        $request->validate(
            ['attachments' => [$proof, 'array', 'min:1']],
            ['attachments.required' => 'Ajoutez la photo du bon de livraison.', 'attachments.required_without' => 'Ajoutez la photo du bon de livraison ou la facture.', 'attachments.min' => 'Ajoutez la photo du bon de livraison.'],
        );

        $user = $request->user();
        $delivery = DB::transaction(function () use ($request, $tank, $data, $user) {
            $delivery = FuelDelivery::create($data + [
                'site_id' => $tank->site_id,
                'fuel_tank_id' => $tank->id,
                'tank_label' => $tank->name,
                'kind' => 'fixe',
                'origin' => 'app',
                'created_by' => $user->id,
            ]);
            $this->syncMovement($delivery);
            $this->storeFiles($request, $delivery);

            return $delivery;
        });

        AuditLogger::log('livraison.created', "Livraison {$this->number($delivery->quantity)} L ({$delivery->supplier}, BL {$delivery->delivery_note}) le {$delivery->date->format('d/m/Y')} sur {$tank->name}", $tank->site_id, $delivery);

        return response()->json($this->present($request, $delivery->fresh(['tank:id,name', 'site:id,name'])), 201);
    }

    /** POST (multipart): new photos can come with the correction. */
    public function update(Request $request, FuelDelivery $delivery)
    {
        $this->ensureCanEdit($request, $delivery);
        $data = $this->validated($request);
        if ($delivery->origin === 'app' && $request->filled('fuel_tank_id') && (int) $request->input('fuel_tank_id') !== $delivery->fuel_tank_id) {
            $tank = $this->tank($request, $request->input('fuel_tank_id'));
            $data += ['fuel_tank_id' => $tank->id, 'site_id' => $tank->site_id, 'tank_label' => $tank->name];
        }
        if ($delivery->tank) {
            $this->ensureNew($delivery->tank, $data, $delivery->id);
        }
        $old = $delivery->only(array_keys($data));

        DB::transaction(function () use ($request, $delivery, $data) {
            $delivery->update($data);
            $this->syncMovement($delivery);
            $this->storeFiles($request, $delivery);
        });

        AuditLogger::log('livraison.updated', "Livraison du {$delivery->date->format('d/m/Y')} ({$this->number($delivery->quantity)} L, {$delivery->supplier}) modifiée", $delivery->site_id, $delivery, $old, $data);

        return response()->json($this->present($request, $delivery->fresh(['tank:id,name', 'site:id,name'])));
    }

    public function destroy(Request $request, FuelDelivery $delivery)
    {
        $this->ensureCanEdit($request, $delivery);
        $movement = $delivery->movement;
        $paths = $delivery->attachments()->pluck('path')->all();

        DB::transaction(function () use ($delivery, $movement) {
            $delivery->delete();
            $movement?->delete();
        });
        Storage::disk('local')->delete($paths);

        AuditLogger::log('livraison.deleted', "Livraison du {$delivery->date->format('d/m/Y')} ({$this->number($delivery->quantity)} L, {$delivery->supplier}) supprimée", $delivery->site_id, $delivery);

        return response()->noContent();
    }

    public function attachments(Request $request, FuelDelivery $delivery)
    {
        $this->ensureSiteAccess($request, $delivery->site_id);

        // The invoice shows the price: never to a pompiste.
        return response()->json($delivery->attachments()
            ->when(! $this->canSeePrices($request), fn ($q) => $q->where('kind', 'bl'))
            ->orderBy('kind')->orderBy('id')->get());
    }

    public function attachment(Request $request, FuelDelivery $delivery, FuelDeliveryAttachment $attachment)
    {
        $this->ensureSiteAccess($request, $delivery->site_id);
        abort_if($attachment->fuel_delivery_id !== $delivery->id, 404);
        abort_if($attachment->kind === 'facture' && ! $this->canSeePrices($request), 403, 'Les factures sont réservées aux responsables.');
        abort_unless(Storage::disk('local')->exists($attachment->path), 404, 'Fichier introuvable.');

        return response()->file(Storage::disk('local')->path($attachment->path), [
            'Content-Type' => $attachment->mime,
            'Content-Disposition' => 'inline; filename="'.addslashes($attachment->original_name).'"',
        ]);
    }

    public function destroyAttachment(Request $request, FuelDelivery $delivery, FuelDeliveryAttachment $attachment)
    {
        $this->ensureCanEdit($request, $delivery);
        abort_if($attachment->fuel_delivery_id !== $delivery->id, 404);
        abort_if($attachment->kind === 'facture' && ! $this->canSeePrices($request), 403);
        abort_if($attachment->kind === 'bl' && $delivery->origin === 'app' && $delivery->attachments()->where('kind', 'bl')->count() <= 1, 422, 'Une livraison garde au moins une photo du bon de livraison : ajoutez la nouvelle avant de retirer celle-ci.');

        Storage::disk('local')->delete($attachment->path);
        $attachment->delete();

        return response()->noContent();
    }

    public function import(Request $request, FuelInventoryImportService $importer)
    {
        $this->ensureCanSeePrices($request);
        $file = $this->excelUpload($request);
        $result = $importer->import($file->getRealPath(), $file->getClientOriginalName(), $request->user());

        AuditLogger::log('livraison.imported', "Inventaire importé depuis {$file->getClientOriginalName()} ({$result['created']} ajoutée(s), {$result['updated']} mise(s) à jour, {$result['matched_app']} prix ajouté(s) aux saisies)", $request->user()->sites()->count() === 1 ? $request->user()->sites()->value('sites.id') : null, new FuelDelivery());

        return response()->json($result);
    }

    /** The deliveries as the INVENTAIRE "Citernes Fixes" sheet (+ the app's own fields), and the PMP per site and month. */
    public function export(Request $request, ExcelExportService $excel)
    {
        $this->ensureCanSeePrices($request);
        $rows = $this->filtered($request)->with(['tank:id,name', 'site:id,name'])->orderBy('date')->orderBy('time')->orderBy('id')->get();
        $months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

        $lines = $rows->map(fn (FuelDelivery $d) => [
            $months[$d->date->month - 1],
            $d->date->format('d/m/Y'),
            $d->quantity,
            $d->unit_price,
            $d->amount,
            $d->supplier,
            $d->tank?->name ?? $d->tank_label,
            $d->site?->name,
            $d->kind === 'mobile' ? 'Mobile' : 'Fixe',
            $d->invoice_number,
            $d->order_number,
            $d->delivery_note,
            $d->invoice_received ? 'OK' : '',
            $d->gauge_before_l,
            $d->gauge_after_l,
            $d->origin === 'app' ? 'Saisie pompiste' : 'Inventaire',
            $d->remark,
        ]);

        $pmp = $rows->groupBy(fn ($d) => $d->site?->name ?? '—')->map(function ($list, $site) use ($months) {
            $line = [$site];
            foreach (range(1, 12) as $m) {
                $priced = $list->filter(fn ($d) => $d->date->month === $m && $d->unit_price !== null);
                $litres = $priced->sum('quantity');
                $line[] = $litres > 0 ? round($priced->sum('amount') / $litres, 4) : null;
            }
            $all = $list->filter(fn ($d) => $d->unit_price !== null);
            $line[] = $all->sum('quantity') > 0 ? round($all->sum('amount') / $all->sum('quantity'), 4) : null;

            return $line;
        })->values();

        $suffix = $request->query('date_from') || $request->query('date_to') ? '-'.($request->query('date_from') ?: 'debut').'-'.($request->query('date_to') ?: 'fin') : '';

        return $excel->streamSheets("entrees-carburant{$suffix}.xlsx", [
            [
                'title' => 'Entrées',
                'headers' => ['Mois', 'Date', 'Quantité (L)', 'PU (DH/L)', 'Montant HT (DH)', 'Fournisseur', 'Citerne', 'Site', 'Type', 'N° de facture', 'Bon de commande', 'N° BL', 'Facture reçue', 'Jauge avant (L)', 'Jauge après (L)', 'Source', 'Remarque'],
                'rows' => $lines,
                'highlight' => fn ($row) => $row[3] === null,
            ],
            [
                'title' => 'PMP',
                'headers' => ['Site', ...array_map('ucfirst', $months), 'Moyenne'],
                'rows' => $pmp,
            ],
        ]);
    }

    // ------------------------------------------------------------------

    protected function filtered(Request $request): Builder
    {
        $query = $this->scopeToSite(FuelDelivery::query(), $request);

        return $query
            ->when($request->query('fuel_tank_id'), fn ($q, $id) => $q->where('fuel_tank_id', $id))
            ->when($request->query('date_from'), fn ($q, $d) => $q->where('date', '>=', $d))
            ->when($request->query('date_to'), fn ($q, $d) => $q->where('date', '<=', $d))
            ->when($request->query('supplier'), fn ($q, $s) => $q->where('supplier', $s))
            ->when(in_array($request->query('origin'), ['app', 'import'], true), fn ($q) => $q->where('origin', $request->query('origin')))
            ->when($request->query('price') === 'missing', fn ($q) => $q->whereNull('unit_price'))
            ->when($request->query('search'), function ($q, $search) {
                $like = '%'.trim($search).'%';
                $q->where(fn ($w) => $w->where('order_number', 'like', $like)
                    ->orWhere('delivery_note', 'like', $like)
                    ->orWhere('invoice_number', 'like', $like)
                    ->orWhere('supplier', 'like', $like)
                    ->orWhere('tank_label', 'like', $like)
                    ->orWhere('truck', 'like', $like)
                    ->orWhere('driver_name', 'like', $like));
            });
    }

    /** @return array<string, mixed> */
    protected function totals(Builder $query): array
    {
        $t = $query->toBase()->selectRaw('COUNT(*) as count, COALESCE(SUM(quantity),0) as litres, COALESCE(SUM(amount),0) as amount,
            COALESCE(SUM(CASE WHEN unit_price IS NOT NULL THEN quantity ELSE 0 END),0) as priced_litres,
            COALESCE(SUM(unit_price IS NULL),0) as missing_price')->first();

        return [
            'count' => (int) $t->count,
            'litres' => round((float) $t->litres, 2),
            'amount' => round((float) $t->amount, 2),
            'pmp' => (float) $t->priced_litres > 0 ? round((float) $t->amount / (float) $t->priced_litres, 4) : null,
            'missing_price' => (int) $t->missing_price,
        ];
    }

    protected function canSeePrices(Request $request): bool
    {
        return $request->user()->role !== 'pompiste';
    }

    protected function ensureCanSeePrices(Request $request): void
    {
        abort_unless($this->canSeePrices($request), 403, 'Les prix sont réservés aux responsables.');
    }

    protected function hidePrices(Request $request, array $data): array
    {
        return $this->canSeePrices($request) ? $data : array_diff_key($data, array_flip([...FuelDelivery::PRICE_FIELDS, 'pmp', 'missing_price']));
    }

    protected function present(Request $request, FuelDelivery $d): array
    {
        $data = $d->toArray();
        $invoices = (int) ($d->invoice_attachments_count ?? $d->attachments()->where('kind', 'facture')->count());
        $all = (int) ($d->attachments_count ?? $d->attachments()->count());
        $data['invoice_attachments_count'] = $invoices;
        // A pompiste only ever counts (and sees) the bon de livraison photos.
        $data['attachments_count'] = $this->canSeePrices($request) ? $all : $all - $invoices;
        $data['received_litres'] = $d->gauge_after_l !== null && $d->gauge_before_l !== null ? round($d->gauge_after_l - $d->gauge_before_l, 2) : null;

        return $this->hidePrices($request, $data);
    }

    protected function tank(Request $request, mixed $id): FuelTank
    {
        abort_if(! $id, 422, 'Choisissez la citerne qui reçoit le gasoil.');
        $tank = FuelTank::findOrFail($id);
        $this->ensureSiteAccess($request, $tank->site_id);

        return $tank;
    }

    /** A pompiste corrects only the deliveries it typed; a responsable / SuperAdmin any of its sites (prices included). */
    protected function ensureCanEdit(Request $request, FuelDelivery $delivery): void
    {
        $this->ensureSiteAccess($request, $delivery->site_id);
        $user = $request->user();
        if ($user->role === 'pompiste') {
            abort_if($delivery->origin !== 'app' || $delivery->created_by !== $user->id, 403, 'Vous ne pouvez modifier que les livraisons que vous avez saisies.');
        }
    }

    /** The same BL, or the same n° de commande, can't be typed twice on one citerne (±60 days: the numbers are reused). */
    protected function ensureNew(FuelTank $tank, array $data, ?int $exceptId = null): void
    {
        $day = Carbon::parse($data['date']);
        $near = FuelDelivery::where('fuel_tank_id', $tank->id)
            ->whereBetween('date', [$day->copy()->subDays(self::WINDOW_DAYS)->toDateString(), $day->copy()->addDays(self::WINDOW_DAYS)->toDateString()])
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))
            ->get(['date', 'delivery_note', 'order_number', 'quantity']);

        foreach (['delivery_note' => 'Le bon de livraison', 'order_number' => 'La commande'] as $field => $label) {
            $ref = FuelDelivery::normalizeRef($data[$field] ?? null);
            if ($ref === null) {
                continue;
            }
            $same = $near->first(fn ($d) => FuelDelivery::normalizeRef($d->{$field}) === $ref);
            abort_if($same !== null, 422, "{$label} n° {$data[$field]} est déjà enregistré(e) sur {$tank->name} (le {$same?->date->format('d/m/Y')}, {$this->number((float) $same?->quantity)} L).");
        }
    }

    protected function validated(Request $request): array
    {
        $nullable = fn ($v) => $v === '' || $v === 'null' ? null : $v;
        foreach (['time', 'order_number', 'delivery_note', 'supplier', 'truck', 'driver_name', 'pompiste_name', 'remark', 'gauge_before_cm', 'gauge_before_l', 'gauge_after_cm', 'gauge_after_l', 'serie', 'unit_price', 'amount', 'invoice_number'] as $key) {
            if ($request->has($key)) {
                $request->merge([$key => $nullable(is_string($request->input($key)) ? trim($request->input($key)) : $request->input($key))]);
            }
        }

        $rules = [
            'date' => ['required', 'date', 'before_or_equal:'.now()->addDay()->toDateString()],
            'time' => ['nullable', 'date_format:H:i'],
            'supplier' => ['required', 'string', 'max:120'],
            'order_number' => ['nullable', 'string', 'max:60'],
            'delivery_note' => ['nullable', 'string', 'max:60'],
            'quantity' => ['required', 'numeric', 'gt:0', 'max:200000'],
            'gauge_before_cm' => ['nullable', 'numeric', 'min:0'],
            'gauge_before_l' => ['nullable', 'numeric', 'min:0'],
            'gauge_after_cm' => ['nullable', 'numeric', 'min:0'],
            'gauge_after_l' => ['nullable', 'numeric', 'min:0'],
            'serie' => ['nullable', 'numeric', 'min:0'],
            'truck' => ['nullable', 'string', 'max:60'],
            'driver_name' => ['nullable', 'string', 'max:120'],
            'pompiste_name' => ['nullable', 'string', 'max:120'],
            'remark' => ['nullable', 'string', 'max:255'],
            'attachments' => ['sometimes', 'array', 'max:10'],
            'attachments.*' => ['file', 'mimes:jpg,jpeg,png,webp,heic,heif,pdf', 'max:10240'],
            'invoice_attachments' => ['sometimes', 'array', 'max:10'],
            'invoice_attachments.*' => ['file', 'mimes:jpg,jpeg,png,webp,heic,heif,pdf', 'max:10240'],
        ];
        if ($this->canSeePrices($request)) {
            $rules += [
                'unit_price' => ['nullable', 'numeric', 'gt:0', 'max:1000'],
                'amount' => ['nullable', 'numeric', 'min:0'],
                'invoice_number' => ['nullable', 'string', 'max:60'],
                'invoice_received' => ['sometimes', 'boolean'],
            ];
        }

        $data = $request->validate($rules, [
            'supplier.required' => 'Choisissez le fournisseur.',
            'quantity.required' => 'La quantité livrée est obligatoire.',
            'quantity.gt' => 'La quantité doit être supérieure à 0.',
            'date.before_or_equal' => 'La date de livraison ne peut pas être dans le futur.',
            'unit_price.gt' => 'Le prix unitaire doit être supérieur à 0.',
            'attachments.*.mimes' => 'Les photos doivent être des images (JPG, PNG, WEBP, HEIC) ou des PDF.',
            'attachments.*.max' => 'Chaque photo doit faire moins de 10 Mo.',
            'attachments.*.uploaded' => 'Une photo n\'a pas pu être envoyée (fichier trop lourd pour le serveur).',
        ]);
        unset($data['attachments'], $data['invoice_attachments']);

        $data['time'] = isset($data['time']) ? $data['time'].':00' : null;
        $data['supplier'] = FuelDelivery::normalizeSupplier($data['supplier']);
        foreach (['order_number', 'delivery_note', 'truck'] as $key) {
            $data[$key] = isset($data[$key]) ? mb_strtoupper($data[$key]) : null;
        }
        $data['pompiste_name'] ??= $request->user()->name;
        if ($this->canSeePrices($request)) {
            // Montant HT = quantité × PU unless typed (an invoice can round differently).
            if (isset($data['unit_price']) && ! isset($data['amount'])) {
                $data['amount'] = round($data['unit_price'] * $data['quantity'], 2);
            }
            $data['invoice_received'] = $request->boolean('invoice_received');
        }

        return $data;
    }

    /** The delivery is also the ENTREE line of its citerne (Détail citernes). */
    protected function syncMovement(FuelDelivery $delivery): void
    {
        $delivery->syncMovement();
    }

    protected function storeFiles(Request $request, FuelDelivery $delivery): void
    {
        // Bon de livraison photos for everyone; invoices only from a responsable / SuperAdmin.
        $groups = ['bl' => 'attachments'] + ($this->canSeePrices($request) ? ['facture' => 'invoice_attachments'] : []);
        foreach ($groups as $kind => $field) {
            $files = $request->file($field, []);
            foreach (is_array($files) ? $files : [$files] as $file) {
                if (! $file instanceof UploadedFile) {
                    continue;
                }
                $path = $file->store('livraisons/'.$delivery->site_id.'/'.$delivery->date->format('Y-m'), 'local');
                abort_if($path === false, 500, 'Le fichier n\'a pas pu être enregistré sur le serveur.');
                $delivery->attachments()->create([
                    'kind' => $kind,
                    'path' => $path,
                    'original_name' => mb_substr($file->getClientOriginalName() ?: ($kind === 'bl' ? 'bon-livraison' : 'facture'), 0, 250),
                    'mime' => $file->getMimeType() ?: 'application/octet-stream',
                    'size' => $file->getSize(),
                    'uploaded_by' => $request->user()->id,
                ]);
            }
        }
    }

    protected function number(float $value): string
    {
        return rtrim(rtrim(number_format($value, 2, ',', ' '), '0'), ',');
    }
}
