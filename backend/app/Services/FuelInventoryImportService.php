<?php

namespace App\Services;

use App\Models\FuelDelivery;
use App\Models\FuelTank;
use App\Models\Site;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Reads the company's "INVENTAIRE -2026-.xlsx" as-is: the purchase lists
 * "Citernes Fixes" (Mois | Date | Quantité | PU | Montant HT | Fournisseur |
 * Citerne | N° de Facture | BON DE COMMANDE | Facture reçu | DEPOTAGE) and
 * "Citerne mobile" (same, + the mobile citerne's plate). Columns are found
 * by their header labels. The other sheets (summaries, PMP, per-citerne
 * jauge sheets) are computed from these two and are not imported.
 *
 * - Only the citernes of the app's sites are kept ("BOUCHANE 1" → Bouchane,
 *   "BENGURIR 2" → Ben Guerir…); the others (El Jadida, Casa, Khouribga…)
 *   are counted and listed, never invented as sites.
 * - Upsert, never delete: a re-import updates its own lines (import_key).
 * - A delivery the pompiste already typed in the app (same site, ±3 days,
 *   same n° de commande — or same quantity and fournisseur) receives the
 *   file's price / facture instead of being duplicated.
 */
class FuelInventoryImportService
{
    protected const SHEETS = ['citernes fixes' => 'fixe', 'citerne mobile' => 'mobile'];

    /** Spellings of the app's sites in the workbook. */
    protected const SITE_ALIASES = [
        'benguerir' => ['benguerir', 'bengurir', 'benghrir', 'benguerir'],
        'bouchane' => ['bouchane'],
        'mzinda' => ['mzinda'],
        'louta' => ['louta'],
    ];

    /**
     * @return array<string, mixed>
     */
    public function import(string $path, string $filename, User $user): array
    {
        $reader = new XlsxStreamReader($path);
        $sites = $this->siteKeys();
        $allowed = $user->isSuperAdmin() ? null : array_flip($user->assignedSiteIds());
        $tanks = FuelTank::get(['id', 'site_id', 'name']);

        $result = ['lines' => 0, 'created' => 0, 'updated' => 0, 'matched_app' => 0, 'unchanged' => 0, 'not_in_app' => [], 'other_sites' => [], 'sheets' => []];
        $found = false;

        DB::transaction(function () use ($reader, $sites, $allowed, $tanks, $user, &$result, &$found) {
            foreach ($reader->sheets() as $sheetName => $sheetPath) {
                $kind = self::SHEETS[mb_strtolower(trim($sheetName))] ?? null;
                if ($kind === null) {
                    continue;
                }
                $found = true;
                $columns = null;
                $seen = [];
                $count = 0;

                foreach ($reader->rows($sheetPath) as [$row, $cells]) {
                    if ($columns === null) {
                        $columns = $this->detectColumns($cells);

                        continue;
                    }
                    $line = $this->readLine($cells, $columns);
                    if ($line === null) {
                        continue;
                    }
                    $result['lines']++;
                    $count++;

                    // Both sheets name the site's citerne in "Citerne" (the mobile sheet adds the plate).
                    $siteLabel = $line['tank_label'];
                    $siteId = $this->siteFor($siteLabel, $sites);
                    if ($siteId === null) {
                        $result['not_in_app'][$siteLabel ?: '(sans citerne)'] = ($result['not_in_app'][$siteLabel ?: '(sans citerne)'] ?? 0) + 1;

                        continue;
                    }
                    if ($allowed !== null && ! isset($allowed[$siteId])) {
                        $result['other_sites'][$siteLabel] = ($result['other_sites'][$siteLabel] ?? 0) + 1;

                        continue;
                    }

                    $tankId = $kind === 'mobile'
                        ? $this->mobileTank($line['mobile'], $tanks)
                        : $this->fixedTank($line['tank_label'], $siteId, $tanks);
                    $label = $kind === 'mobile' ? ($line['mobile'] ?: $line['tank_label']) : $line['tank_label'];

                    $base = implode('|', [$kind, $line['date'], Str::upper($label), $line['mobile'] ?? '', number_format($line['quantity'], 2, '.', ''), FuelDelivery::normalizeRef($line['order_number']) ?? '']);
                    $seen[$base] = ($seen[$base] ?? 0) + 1;
                    $key = sha1($base.'#'.$seen[$base]);

                    $values = [
                        'site_id' => $siteId,
                        'fuel_tank_id' => $tankId,
                        'tank_label' => $label,
                        'kind' => $kind,
                        'date' => $line['date'],
                        'quantity' => $line['quantity'],
                        'unit_price' => $line['unit_price'],
                        'amount' => $line['amount'],
                        'supplier' => $line['supplier'],
                        'order_number' => $line['order_number'],
                        'invoice_number' => $line['invoice_number'],
                        'invoice_received' => $line['invoice_received'],
                        'remark' => $kind === 'mobile' && $line['tank_label'] ? mb_substr(trim('Livraison '.$line['tank_label'].' '.($line['remark'] ?? '')), 0, 255) : $line['remark'],
                    ];

                    $this->save($key, $values, $user, $result);
                }

                $result['sheets'][] = ['name' => trim($sheetName), 'lines' => $count];
            }
        });

        if (! $found) {
            throw new HttpException(422, "Feuilles « Citernes Fixes » / « Citerne mobile » introuvables dans « {$filename} ».");
        }

        arsort($result['not_in_app']);

        return $result;
    }

    /** @param array<string, mixed> $values */
    protected function save(string $key, array $values, User $user, array &$result): void
    {
        $existing = FuelDelivery::where('import_key', $key)->first();

        // Typed by the pompiste first: the file brings its price and facture.
        if ($existing === null) {
            $existing = $this->typedMatch($values);
            if ($existing !== null) {
                $existing->update([
                    'import_key' => $key,
                    'unit_price' => $values['unit_price'] ?? $existing->unit_price,
                    'amount' => $values['amount'] ?? $existing->amount,
                    'invoice_number' => $values['invoice_number'] ?? $existing->invoice_number,
                    'invoice_received' => $values['invoice_received'] || $existing->invoice_received,
                    'order_number' => $existing->order_number ?? $values['order_number'],
                    'supplier' => $existing->supplier ?? $values['supplier'],
                ]);
                $result['matched_app']++;

                return;
            }
        }

        if ($existing === null) {
            FuelDelivery::create($values + ['import_key' => $key, 'origin' => 'import', 'created_by' => $user->id])->syncMovement();
            $result['created']++;

            return;
        }

        if ($existing->origin === 'app') {
            // Already linked to a typed delivery: only the price side follows the file.
            $existing->fill(array_intersect_key($values, array_flip(['unit_price', 'amount', 'invoice_number', 'invoice_received'])));
        } else {
            $existing->fill($values);
        }
        if ($existing->isDirty()) {
            $existing->save();
            $result['updated']++;
        } else {
            $result['unchanged']++;
        }
        // Its ENTREE line in the citerne (created on the first import, kept in step after).
        $existing->syncMovement();
    }

    /** @param array<string, mixed> $values */
    protected function typedMatch(array $values): ?FuelDelivery
    {
        $day = Carbon::parse($values['date']);
        $candidates = FuelDelivery::where('origin', 'app')->whereNull('import_key')
            ->where('site_id', $values['site_id'])
            ->whereBetween('date', [$day->copy()->subDays(3)->toDateString(), $day->copy()->addDays(3)->toDateString()])
            ->get();
        $order = FuelDelivery::normalizeRef($values['order_number']);

        return $candidates->first(fn (FuelDelivery $d) => $order !== null && FuelDelivery::normalizeRef($d->order_number) === $order)
            ?? $candidates->first(fn (FuelDelivery $d) => abs($d->quantity - $values['quantity']) <= 1
                && ($values['supplier'] === null || $d->supplier === null || $d->supplier === $values['supplier'])
                && ($values['fuel_tank_id'] === null || $d->fuel_tank_id === null || $d->fuel_tank_id === $values['fuel_tank_id']));
    }

    /** @param array<string, mixed> $cells */
    protected function detectColumns(array $cells): ?array
    {
        $map = [];
        foreach ($cells as $column => $value) {
            $label = Str::lower(Str::ascii(trim((string) $value)));
            $label = preg_replace('/\s+/', ' ', $label);
            $key = match (true) {
                $label === 'date' => 'date',
                str_starts_with($label, 'quantit') => 'quantity',
                $label === 'pu' || str_starts_with($label, 'prix') => 'unit_price',
                str_starts_with($label, 'montant') => 'amount',
                str_starts_with($label, 'fournisseur') => 'supplier',
                $label === 'citerne' => 'tank',
                str_contains($label, 'citerne mobile') => 'mobile',
                str_contains($label, 'recu') => 'invoice_received',
                str_contains($label, 'facture') => 'invoice_number',
                str_contains($label, 'commande') => 'order_number',
                str_contains($label, 'depotage') => 'remark',
                default => null,
            };
            if ($key !== null && ! isset($map[$key])) {
                $map[$key] = $column;
            }
        }

        // Not the header row yet (title rows above it): keep looking.
        return isset($map['date'], $map['quantity'], $map['tank']) ? $map : null;
    }

    /**
     * @param  array<string, mixed>  $cells
     * @param  array<string, string>|null  $columns
     * @return array<string, mixed>|null
     */
    protected function readLine(array $cells, ?array $columns): ?array
    {
        if ($columns === null) {
            return null;
        }
        $get = fn (string $key) => isset($columns[$key]) ? ($cells[$columns[$key]] ?? null) : null;
        $text = fn (string $key) => ($v = trim((string) $get($key))) === '' ? null : $v;
        $number = function (string $key) use ($get) {
            $v = $get($key);
            if (is_string($v)) {
                $v = str_replace([' ', ','], ['', '.'], $v);
            }

            return is_numeric($v) ? (float) $v : null;
        };

        $date = $this->toDate($get('date'));
        $quantity = $number('quantity');
        if ($date === null || $quantity === null || $quantity <= 0) {
            return null;
        }
        $unitPrice = $number('unit_price');
        $amount = $number('amount');
        if (($amount === null || $amount == 0.0) && $unitPrice !== null) {
            $amount = round($unitPrice * $quantity, 2);
        }

        return [
            'date' => $date,
            'quantity' => $quantity,
            // Rounded like the columns store them, so a re-import of the same file changes nothing.
            'unit_price' => $unitPrice ? round($unitPrice, 6) : null,
            'amount' => $amount ? round($amount, 2) : null,
            'supplier' => FuelDelivery::normalizeSupplier($text('supplier')),
            'tank_label' => $text('tank') ? preg_replace('/\s+/', ' ', mb_strtoupper($text('tank'))) : null,
            'mobile' => $text('mobile') ? strtoupper(preg_replace('/[\s\-]/', '', $text('mobile'))) : null,
            'invoice_number' => $this->ref($get('invoice_number')),
            'order_number' => $this->ref($get('order_number')),
            'invoice_received' => in_array(Str::lower((string) $text('invoice_received')), ['ok', 'oui', 'x', 'yes'], true),
            'remark' => $text('remark') ? mb_substr('Dépotage '.$text('remark'), 0, 255) : null,
        ];
    }

    /** Invoice / order numbers come as numbers (9261000660) or text (P03099). */
    protected function ref(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_float($value) && floor($value) === $value) {
            $value = number_format($value, 0, '', '');
        }
        $value = trim((string) $value);

        return $value === '' ? null : mb_substr($value, 0, 60);
    }

    protected function toDate(mixed $value): ?string
    {
        if (is_numeric($value) && $value > 20000 && $value < 80000) {
            return ExcelDate::excelToDateTimeObject((float) $value)->format('Y-m-d');
        }
        if (is_string($value) && preg_match('#^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$#', trim($value), $m)) {
            $year = strlen($m[3]) === 2 ? '20'.$m[3] : $m[3];

            return checkdate((int) $m[2], (int) $m[1], (int) $year) ? sprintf('%04d-%02d-%02d', $year, $m[2], $m[1]) : null;
        }

        return null;
    }

    /** @return array<string, int> normalized spelling → site id */
    protected function siteKeys(): array
    {
        $keys = [];
        foreach (Site::get(['id', 'name']) as $site) {
            $key = $this->squash($site->name);
            foreach (self::SITE_ALIASES[$key] ?? [$key] as $alias) {
                $keys[$alias] = $site->id;
            }
        }

        return $keys;
    }

    /** @param array<string, int> $sites */
    protected function siteFor(?string $label, array $sites): ?int
    {
        $squashed = $this->squash((string) $label);
        foreach ($sites as $alias => $id) {
            if ($alias !== '' && str_starts_with($squashed, $alias)) {
                return $id;
            }
        }

        return null;
    }

    /** "BOUCHANE 1" → the site's citerne numbered 1 ("BO 1", "Citerne LOUTA 1"); never a mobile (plate) citerne. */
    protected function fixedTank(?string $label, int $siteId, $tanks): ?int
    {
        $own = $tanks->where('site_id', $siteId)->reject(fn ($t) => $this->isPlate($t->name));
        preg_match('/(\d+)\s*$/', (string) $label, $m);
        if (! isset($m[1])) {
            return $own->count() === 1 ? $own->first()->id : null;
        }

        return $own->first(fn ($t) => preg_match('/(\d+)\s*$/', $t->name, $n) && (int) $n[1] === (int) $m[1])?->id;
    }

    protected function mobileTank(?string $plate, $tanks): ?int
    {
        if ($plate === null) {
            return null;
        }

        return $tanks->first(fn ($t) => strtoupper(preg_replace('/[\s\-]/', '', $t->name)) === $plate)?->id;
    }

    protected function isPlate(string $name): bool
    {
        return (bool) preg_match('/^\d{3,6}\s*-?\s*[A-Z]\s*-?\s*\d{1,3}$/i', trim($name));
    }

    protected function squash(string $value): string
    {
        return preg_replace('/[^a-z]/', '', Str::lower(Str::ascii($value)));
    }
}
