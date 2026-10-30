<?php

namespace App\Services;

use App\Models\FuelAssignment;
use App\Models\FuelMovement;
use App\Models\FuelMovementOverride;
use App\Models\FuelTank;
use App\Models\FuelVehicle;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Reads the company's own Excel files as-is — no template to fill in, no
 * column to rename. The column layout is detected from the header labels
 * (ENTREE/SORTIES group row + Date/Qte/Code/... row), so a column inserted
 * or moved in the original workbook doesn't break the import.
 *
 * Re-importing a citerne REPLACES all its IMPORTED rows (delete + insert in
 * one transaction): the Excel file is the source of truth, so a line
 * corrected or removed in Excel is corrected/removed here too on the next
 * import. Hand corrections made from the Global survive it: rows added by
 * hand (origin = manual) are never deleted, and edits/deletions of imported
 * rows are re-applied from fuel_movement_overrides (applyOverrides()).
 */
class FuelImportService
{
    public function __construct(protected FuelConsumptionService $consumption) {}

    /**
     * One citerne per recognised sheet (sheet name = citerne name).
     *
     * @return array<int, array<string, mixed>> one summary per sheet
     */
    public function importTanks(string $path, string $filename, int $siteId, ?int $userId): array
    {
        $reader = new XlsxStreamReader($path);
        $parsed = [];

        foreach ($reader->sheets() as $sheetName => $sheetPath) {
            $result = $this->parseTankSheet($reader, $sheetPath);
            if ($result !== null) {
                $parsed[trim($sheetName)] = $result;
            }
        }

        if (! $parsed) {
            throw new HttpException(422, "Aucune feuille de citerne reconnue dans « {$filename} » (en-têtes ENTREE / SORTIES / Date / Qte introuvables).");
        }

        $knownCodes = array_flip(DB::table('fuel_vehicles')->pluck('code')->all());
        $summaries = [];

        DB::transaction(function () use ($parsed, $filename, $siteId, $userId, $knownCodes, &$summaries) {
            foreach ($parsed as $name => $result) {
                $tank = FuelTank::firstOrCreate(['site_id' => $siteId, 'name' => $name]);
                $previousCount = $tank->movements()->where('origin', 'import')->count();
                $tank->movements()->where('origin', 'import')->delete();

                $rows = array_map(fn ($row) => $row + ['fuel_tank_id' => $tank->id, 'site_id' => $siteId], $result['rows']);
                foreach (array_chunk($rows, 1000) as $chunk) {
                    DB::table('fuel_movements')->insert($chunk);
                }
                $kept = $this->applyOverrides($tank, array_column($rows, 'fingerprint'));

                $tank->update([
                    'last_import_file' => $filename,
                    'last_imported_at' => now(),
                    'last_imported_by' => $userId,
                ]);

                $codes = array_unique(array_filter(array_column($result['rows'], 'vehicle_code')));
                $unknown = array_values(array_filter($codes, fn ($code) => ! isset($knownCodes[$code])));
                sort($unknown);

                $summaries[] = [
                    'tank_id' => $tank->id,
                    'tank' => $name,
                    'created' => $previousCount === 0,
                    'previous_rows' => $previousCount,
                    'rows' => count($rows),
                    'entries' => $result['entries'],
                    'exits' => $result['exits'],
                    'litres_in' => round($result['litres_in'], 2),
                    'litres_out' => round($result['litres_out'], 2),
                    'date_from' => $result['date_from'],
                    'date_to' => $result['date_to'],
                    'skipped' => $result['skipped'],
                    'unknown_codes' => $unknown,
                    'kept_edits' => $kept,
                ];
            }
        });

        $this->consumption->recalculate();

        return $summaries;
    }

    /**
     * Re-applies the Global's hand corrections on top of freshly imported
     * rows. An override whose line no longer exists (corrected or removed in
     * the Excel file itself) is dropped: the file was fixed at the source.
     *
     * @param  array<int, string>  $fingerprints  of the rows just imported
     * @return int number of hand edits/deletions re-applied (+ manual rows kept)
     */
    protected function applyOverrides(FuelTank $tank, array $fingerprints): int
    {
        $present = array_flip($fingerprints);
        $applied = 0;

        foreach (FuelMovementOverride::where('fuel_tank_id', $tank->id)->get() as $override) {
            if (! isset($present[$override->fingerprint])) {
                $override->delete();

                continue;
            }
            $rows = FuelMovement::where('fuel_tank_id', $tank->id)->where('origin', 'import')->where('fingerprint', $override->fingerprint);
            $override->action === 'delete' ? $rows->delete() : $rows->update([...$override->data, 'edited' => true]);
            $applied++;
        }

        return $applied + $tank->movements()->where('origin', 'manual')->count();
    }

    /**
     * Upsert by code: an existing code gets its matricule/type refreshed, a
     * new one is created, and nothing is ever deleted (a vehicle added by
     * hand and absent from the file stays).
     *
     * @return array{created: int, updated: int, total: int, skipped: int}
     */
    public function importVehicles(string $path, string $filename): array
    {
        $reader = new XlsxStreamReader($path);
        $byCode = [];
        $skipped = 0;
        $found = false;

        foreach ($reader->sheets() as $sheetPath) {
            $columns = null;
            foreach ($reader->rows($sheetPath) as [$rowNumber, $cells]) {
                if ($columns === null) {
                    $columns = $this->detectVehicleColumns($cells);
                    if ($columns === null && $rowNumber > 30) {
                        break;
                    }

                    continue;
                }

                $code = FuelVehicle::normalizeCode($cells[$columns['code']] ?? null);
                $matricule = $this->text($cells[$columns['matricule']] ?? null);
                if ($code === null) {
                    if ($matricule !== null) {
                        $skipped++;
                    }

                    continue;
                }

                $type = $columns['type'] ? $this->text($cells[$columns['type']] ?? null) : null;
                $byCode[$code] = ['code' => $code, 'matricule' => $matricule, 'type' => $type, 'brand' => $columns['brand'] ? $this->brand($cells[$columns['brand']] ?? null) : null];
            }
            $found = $found || $columns !== null;
        }

        if (! $found) {
            throw new HttpException(422, "Colonnes « Code » et « Matricule » introuvables dans « {$filename} ».");
        }

        $existing = array_flip(DB::table('fuel_vehicles')->pluck('code')->all());
        $created = count(array_diff_key($byCode, $existing));
        $now = now();

        DB::transaction(function () use ($byCode, $now) {
            foreach (array_chunk(array_values($byCode), 500) as $chunk) {
                DB::table('fuel_vehicles')->upsert(
                    array_map(fn ($row) => $row + ['created_at' => $now, 'updated_at' => $now], $chunk),
                    ['code'],
                    // A type/marque typed by hand isn't wiped by a file whose column is empty.
                    ['matricule', 'updated_at', 'type' => DB::raw('COALESCE(VALUES(`type`), `type`)'), 'brand' => DB::raw('COALESCE(VALUES(`brand`), `brand`)')]
                );
            }
        });

        return ['created' => $created, 'updated' => count($byCode) - $created, 'total' => count($byCode), 'skipped' => $skipped];
    }

    /**
     * A site's "LISTE D'AFFECTATION", read as-is: a "Camion" / "ENGINS"
     * cell switches the section, and on each line the cell holding a vehicle
     * code ("D140", "480-E49", "D10-E89"...) is the vehicle, the cell on its
     * left équipe 1, the cell on its right équipe 2, any other name on the
     * line a remplaçant. Upsert by code for that site (never deletes — a
     * vehicle added by hand stays), file order kept as the report's order.
     *
     * @return array{created: int, updated: int, total: int}
     */
    public function importAssignments(string $path, string $filename, int $siteId): array
    {
        $byCode = array_map(fn ($row) => ['site_id' => $siteId] + $row, $this->parseAssignments($path, $filename));

        $existing = DB::table('fuel_assignments')->where('site_id', $siteId)->pluck('code')->flip();
        $created = count(array_diff_key($byCode, $existing->all()));
        $now = now();

        DB::table('fuel_assignments')->upsert(
            array_map(fn ($row) => $row + ['created_at' => $now, 'updated_at' => $now], array_values($byCode)),
            ['site_id', 'code'],
            // A default activité typed by hand isn't in the file: keep it.
            ['label', 'category', 'driver_1', 'driver_2', 'replacements', 'sort_order', 'updated_at']
        );

        return ['created' => $created, 'updated' => count($byCode) - $created, 'total' => count($byCode)];
    }

    /**
     * Reads an affectation workbook without writing anything (also used by
     * `php artisan consommation:diagnostic --affectation=...`).
     *
     * @return array<string, array<string, mixed>> code => assignment row (without site_id)
     */
    public function parseAssignments(string $path, string $filename): array
    {
        $reader = new XlsxStreamReader($path);
        $byCode = [];

        foreach ($reader->sheets() as $sheetPath) {
            $section = null;
            foreach ($reader->rows($sheetPath) as [, $cells]) {
                $texts = [];
                foreach ($cells as $column => $value) {
                    if (($text = $this->text($value)) !== null) {
                        $texts[Coordinate::columnIndexFromString($column)] = $text;
                    }
                }
                ksort($texts);

                $codeIndex = null;
                foreach ($texts as $index => $text) {
                    $label = $this->label($text);
                    if (in_array($label, ['CAMION', 'CAMIONS'], true)) {
                        $section = 'camion';
                    } elseif (in_array($label, ['ENGIN', 'ENGINS'], true)) {
                        $section = 'engin';
                    } elseif ($codeIndex === null && mb_strlen($text) <= 25 && FuelAssignment::codeFromLabel($text) !== null) {
                        $codeIndex = $index;
                    }
                }
                if ($codeIndex === null) {
                    continue;
                }

                $code = FuelAssignment::codeFromLabel($texts[$codeIndex]);
                $driver = fn ($index) => isset($texts[$index]) && FuelAssignment::codeFromLabel($texts[$index]) === null ? $this->personName($texts[$index]) : null;
                $others = array_filter(
                    array_diff_key($texts, array_flip([$codeIndex - 1, $codeIndex, $codeIndex + 1])),
                    fn ($text) => ! in_array($this->label($text), ['CAMION', 'CAMIONS', 'ENGIN', 'ENGINS'], true)
                );

                $byCode[$code] = [
                    'code' => $code,
                    'label' => mb_substr(trim(preg_replace('/\s+/', ' ', $texts[$codeIndex])), 0, 80),
                    'category' => $section ?? (str_starts_with($code, 'E') ? 'engin' : 'camion'),
                    'driver_1' => $driver($codeIndex - 1),
                    'driver_2' => $driver($codeIndex + 1),
                    'replacements' => $others ? mb_substr(implode(', ', array_map(fn ($t) => $this->personName($t), $others)), 0, 255) : null,
                    'sort_order' => count($byCode) + 1,
                ];
            }
            if ($byCode) {
                break; // first sheet holding an affectation list
            }
        }

        if (! $byCode) {
            throw new HttpException(422, "Aucune affectation reconnue dans « {$filename} » (codes D… / E… introuvables).");
        }

        return $byCode;
    }

    /**
     * Reads a citerne workbook without writing anything: one entry per sheet,
     * recognised or not (used by `php artisan consommation:diagnostic`).
     *
     * @return array<string, array<string, mixed>|null> sheet name => stats, null = not a citerne sheet
     */
    public function inspectTanks(string $path): array
    {
        $reader = new XlsxStreamReader($path);
        $sheets = [];
        foreach ($reader->sheets() as $sheetName => $sheetPath) {
            $result = $this->parseTankSheet($reader, $sheetPath);
            $sheets[trim($sheetName)] = $result === null ? null : array_diff_key($result, ['rows' => true]);
        }

        return $sheets;
    }

    /** "EL MAJDOULI  BRAHIM" -> "EL MAJDOULI BRAHIM"; "-" means nobody. */
    protected function personName(string $text): ?string
    {
        $name = trim(preg_replace('/\s+/', ' ', $text));

        return $name === '' || $name === '-' ? null : mb_substr($name, 0, 120);
    }

    /**
     * @return array{rows: array<int, array<string, mixed>>, entries: int, exits: int, litres_in: float, litres_out: float, date_from: ?string, date_to: ?string, skipped: int}|null
     */
    protected function parseTankSheet(XlsxStreamReader $reader, string $sheetPath): ?array
    {
        $previousCells = [];
        $map = null;
        $rows = [];
        $stats = ['entries' => 0, 'exits' => 0, 'litres_in' => 0.0, 'litres_out' => 0.0, 'skipped' => 0];
        $minDate = null;
        $maxDate = null;

        foreach ($reader->rows($sheetPath) as [$rowNumber, $cells]) {
            if ($map === null) {
                $map = $this->detectTankColumns($previousCells, $cells);
                $previousCells = $cells;
                if ($map === null && $rowNumber > 30) {
                    return null;
                }

                continue;
            }

            $in = XlsxStreamReader::toNumber($cells[$map['entry_qty']] ?? null);
            $out = isset($map['exit_qty']) ? XlsxStreamReader::toNumber($cells[$map['exit_qty']] ?? null) : null;
            $hasIn = $in !== null && abs($in) > 0;
            $hasOut = $out !== null && abs($out) > 0;
            if (! $hasIn && ! $hasOut) {
                continue; // pre-formatted empty line (only D/K/L formulas)
            }

            $date = XlsxStreamReader::toDate($cells[$map['date']] ?? null);
            if ($date === null) {
                $stats['skipped']++;

                continue;
            }

            $dateString = $date->toDateString();
            $minDate = $minDate === null || $dateString < $minDate ? $dateString : $minDate;
            $maxDate = $maxDate === null || $dateString > $maxDate ? $dateString : $maxDate;

            $common = [
                'date' => $dateString,
                'time' => isset($map['time']) ? XlsxStreamReader::toTime($cells[$map['time']] ?? null) : null,
                'bon_number' => isset($map['bon']) ? $this->text($cells[$map['bon']] ?? null, 60) : null,
                'remark' => isset($map['remark']) ? $this->text($cells[$map['remark']] ?? null, 255) : null,
                'serie_start' => isset($map['serie_start']) ? XlsxStreamReader::toNumber($cells[$map['serie_start']] ?? null) : null,
                'serie_end' => isset($map['serie_end']) ? XlsxStreamReader::toNumber($cells[$map['serie_end']] ?? null) : null,
                'source_row' => $rowNumber,
            ];
            $empty = ['supplier' => null, 'vehicle_code' => null, 'odometer' => null];

            if ($hasIn) {
                $rows[] = ['type' => 'entry', 'quantity' => round($in, 2)] + $common + [
                    'supplier' => isset($map['supplier']) ? $this->text($cells[$map['supplier']] ?? null, 120) : null,
                ] + $empty;
                $stats['entries']++;
                $stats['litres_in'] += $in;
            }
            if ($hasOut) {
                $code = isset($map['code']) ? FuelVehicle::normalizeCode($cells[$map['code']] ?? null) : null;
                $rows[] = ['type' => 'exit', 'quantity' => round($out, 2)] + $common + [
                    'vehicle_code' => $code !== null ? mb_substr($code, 0, 60) : null,
                    'odometer' => isset($map['odometer']) ? XlsxStreamReader::toNumber($cells[$map['odometer']] ?? null) : null,
                ] + $empty;
                $stats['exits']++;
                $stats['litres_out'] += $out;
            }
        }

        if ($map === null) {
            return null;
        }

        // Every row needs the same keys, in the same order, for a bulk insert.
        $keys = ['type', 'quantity', 'date', 'time', 'bon_number', 'remark', 'serie_start', 'serie_end', 'source_row', 'supplier', 'vehicle_code', 'odometer'];
        $rows = array_map(fn ($row) => array_merge(array_fill_keys($keys, null), array_intersect_key($row, array_flip($keys))), $rows);
        $seen = [];
        foreach ($rows as &$row) {
            $row['fingerprint'] = FuelMovement::fingerprint($row, $seen);
        }
        unset($row);

        return ['rows' => $rows, 'date_from' => $minDate, 'date_to' => $maxDate] + $stats;
    }

    /**
     * Header detection for a citerne sheet: a row with "Date" + "Qte", read
     * together with the row above it (the merged ENTREE / SORTIES / SERIE
     * DEPART / SERIE FIN group labels).
     *
     * @return array<string, string>|null field => column letter
     */
    protected function detectTankColumns(array $groupRow, array $headerRow): ?array
    {
        $labels = array_map(fn ($v) => $this->label($v), $headerRow);
        if (! in_array('DATE', $labels, true) || ! in_array('QTE', $labels, true)) {
            return null;
        }

        $columns = array_unique(array_merge(array_keys($groupRow), array_keys($headerRow)));
        usort($columns, fn ($a, $b) => strlen($a) <=> strlen($b) ?: strcmp($a, $b));

        $map = [];
        $group = '';
        foreach ($columns as $column) {
            if (isset($groupRow[$column])) {
                $group = $this->label($groupRow[$column]);
            }
            $label = $labels[$column] ?? $this->label($groupRow[$column] ?? '');

            $field = match (true) {
                $label === 'DATE' => 'date',
                in_array($label, ['QTE', 'QUANTITE', 'LITRE', 'LITRES'], true) && str_contains($group, 'ENTR') => 'entry_qty',
                in_array($label, ['QTE', 'QUANTITE', 'LITRE', 'LITRES'], true) && str_contains($group, 'SORT') => 'exit_qty',
                str_contains($label, 'FOURNISSEUR') => 'supplier',
                str_contains($label, 'BON') => 'bon',
                str_contains($label, 'HEURE') => 'time',
                $label === 'CODE' => 'code',
                str_contains($label, 'KILOM') || str_contains($label, 'COMPTEUR') => 'odometer',
                str_contains($label, 'REMARQUE') || str_contains($label, 'OBSERVATION') => 'remark',
                str_contains($label, 'SERIE DEPART') || str_contains($label, 'SERIE DEBUT') => 'serie_start',
                str_contains($label, 'SERIE FIN') => 'serie_end',
                default => null,
            };
            if ($field !== null && ! isset($map[$field])) {
                $map[$field] = $column;
            }
        }

        // Without group labels, the first Qte is the entry and the second the exit.
        if (! isset($map['entry_qty']) && ! isset($map['exit_qty'])) {
            $qtyColumns = array_keys(array_filter($labels, fn ($l) => $l === 'QTE'));
            usort($qtyColumns, fn ($a, $b) => strlen($a) <=> strlen($b) ?: strcmp($a, $b));
            $map['entry_qty'] = $qtyColumns[0];
            if (isset($qtyColumns[1])) {
                $map['exit_qty'] = $qtyColumns[1];
            }
        }

        return isset($map['date'], $map['entry_qty']) || isset($map['date'], $map['exit_qty']) ? $map + ['entry_qty' => '__none__'] : null;
    }

    /** @return array{code: string, matricule: string, type: ?string}|null */
    protected function detectVehicleColumns(array $cells): ?array
    {
        $code = $matricule = $type = $brand = null;
        foreach ($cells as $column => $value) {
            $label = $this->label($value);
            if ($label === 'CODE') {
                $code = $column;
            } elseif (in_array($label, ['MATRICULE', 'IMMATRICULATION', 'MATRICULATION'], true)) {
                $matricule = $column;
            } elseif (in_array($label, ['TYPE', 'NATURE', 'CATEGORIE'], true)) {
                $type = $column;
            } elseif (in_array($label, ['MARQUE', 'MARK', 'BRAND'], true)) {
                $brand = $column;
            }
        }
        if ($code === null || $matricule === null) {
            return null;
        }

        // The reference file has an unlabelled column right after Matricule
        // holding "Camion"/"Citerne" — use it as the type when no TYPE header exists.
        $next = $matricule;
        $next++;

        return ['code' => $code, 'matricule' => $matricule, 'type' => $type ?? $next, 'brand' => $brand];
    }

    /** "SINOTRUCK", "Sino Truk", "MAN TGS", "Renault Kerax"... → sinotruk / man / renault. */
    protected function brand(mixed $value): ?string
    {
        $label = str_replace(' ', '', $this->label($value));

        return match (true) {
            str_starts_with($label, 'SINO') => 'sinotruk',
            str_starts_with($label, 'MAN') => 'man',
            str_starts_with($label, 'RENAULT') => 'renault',
            default => null,
        };
    }

    protected function label(mixed $value): string
    {
        return strtoupper(trim(preg_replace('/\s+/', ' ', Str::ascii((string) $value))));
    }

    protected function text(mixed $value, int $max = 120): ?string
    {
        if ($value === null) {
            return null;
        }
        if (is_float($value) && floor($value) == $value) {
            $value = (string) (int) $value;
        }
        $text = trim((string) $value);

        return $text === '' ? null : mb_substr($text, 0, $max);
    }
}
