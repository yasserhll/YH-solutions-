<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\LeaveHistory;
use App\Models\Position;
use App\Models\Site;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Reads a site's "ETAT DE CONGE" workbook as-is: a row of years (2022,
 * 2023…) above the header row ("Nom & Prenom", "Fonction", "Date
 * D'embauche", then one column per month: Juillet, Aout, … Décembre,
 * Janvier…), then one line per employee with the days taken each month.
 *
 * - An employee already in the app (same matricule, else the same name in
 *   any word order) gets the history. An empty matricule / entry date on
 *   their fiche is filled from the file, nothing else is changed.
 * - Someone missing from the app is created on the site with the file's
 *   matricule, fonction and embauche date, as a former employee (`sorti`)
 *   unless the import asks for `actif`.
 * - Re-importing replaces that employee's imported months with the file's
 *   (a month corrected in Excel is corrected here); never duplicates.
 */
class LeaveHistoryImportService
{
    private const MONTHS = [
        'janvier' => 1, 'fevrier' => 2, 'mars' => 3, 'avril' => 4, 'mai' => 5, 'juin' => 6,
        'juillet' => 7, 'aout' => 8, 'septembre' => 9, 'octobre' => 10, 'novembre' => 11, 'decembre' => 12,
    ];

    /** Site guessed from the file / sheet name ("ETAT DE CONGE MZINDA", sheet "BG"). */
    public static function guessSite(string ...$labels): ?Site
    {
        $text = ' '.self::norm(implode(' ', $labels)).' ';
        $aliases = [
            'ben-guerir' => [' ben guerir ', ' benguerir ', ' bengurir ', ' bg '],
            'mzinda' => [' mzinda '],
            'louta' => [' louta '],
            'bouchane' => [' bouchane '],
        ];
        foreach ($aliases as $slug => $words) {
            foreach ($words as $word) {
                if (str_contains($text, $word)) {
                    return Site::where('slug', $slug)->first();
                }
            }
        }

        return null;
    }

    /** @return array{0: array<int, array>, 1: string[]} parsed lines + sheet names */
    public function parse(string $path): array
    {
        $reader = new XlsxStreamReader($path);
        $lines = [];
        $sheetNames = [];
        foreach ($reader->sheets() as $sheetName => $sheetPath) {
            $parsed = $this->parseSheet($reader, $sheetPath);
            if ($parsed) {
                $sheetNames[] = $sheetName;
                array_push($lines, ...$parsed);
            }
        }
        if (! $lines) {
            throw new HttpException(422, "Aucune ligne d'état de congé trouvée : le fichier doit avoir une colonne « Nom & Prénom » et une colonne par mois (Juillet, Août…) sous une ligne d'années.");
        }

        return [$lines, $sheetNames];
    }

    private function parseSheet(XlsxStreamReader $reader, string $sheetPath): array
    {
        $years = [];      // column index => year (from the year row)
        $header = null;   // ['name' => idx, ...]
        $months = [];     // column index => [year, month]
        $lines = [];

        foreach ($reader->rows($sheetPath) as [$rowNumber, $cells]) {
            $byIndex = [];
            foreach ($cells as $letter => $value) {
                $byIndex[self::colIndex($letter)] = $value;
            }
            ksort($byIndex);

            if ($header === null) {
                $labels = array_map(fn ($v) => is_string($v) ? self::norm($v) : '', $byIndex);
                $nameCol = null;
                foreach ($labels as $i => $label) {
                    if (str_contains($label, 'nom') && str_contains($label, 'prenom')) {
                        $nameCol = $i;
                        break;
                    }
                }
                if ($nameCol === null) {
                    $rowYears = array_filter($byIndex, fn ($v) => is_numeric($v) && (int) $v >= 2000 && (int) $v <= 2100 && (float) $v == (int) $v);
                    if (count($rowYears) >= 2) {
                        $years = array_map('intval', $rowYears);
                    }

                    continue;
                }

                $header = ['name' => $nameCol, 'matricule' => null, 'fonction' => null, 'embauche' => null];
                foreach ($labels as $i => $label) {
                    if ($header['matricule'] === null && str_contains($label, 'matri')) {
                        $header['matricule'] = $i;
                    } elseif ($header['fonction'] === null && str_contains($label, 'fonction')) {
                        $header['fonction'] = $i;
                    } elseif ($header['embauche'] === null && str_contains($label, 'embauche') && ! str_contains($label, 'mois')) {
                        $header['embauche'] = $i;
                    }
                }
                // "N° MATRICULE" in one file; just "N" right before the name in the other.
                $header['matricule'] ??= $nameCol - 1;

                $currentYear = null;
                $previousMonth = 0;
                ksort($years);
                foreach ($labels as $i => $label) {
                    $month = self::MONTHS[trim($label)] ?? null;
                    if ($month === null || $i <= $nameCol) {
                        continue;
                    }
                    // The year written above the column, else the last one to its left;
                    // a month going back (Décembre → Janvier) moves to the next year.
                    $above = null;
                    foreach ($years as $col => $year) {
                        if ($col <= $i) {
                            $above = $year;
                        }
                    }
                    if (isset($years[$i])) {
                        $currentYear = $years[$i];
                    } elseif ($currentYear === null) {
                        $currentYear = $above;
                    } elseif ($month < $previousMonth) {
                        $currentYear++;
                    }
                    $previousMonth = $month;
                    if ($currentYear) {
                        $months[$i] = [$currentYear, $month];
                    }
                }
                if (! $months) {
                    $header = null;
                }

                continue;
            }

            $name = trim(preg_replace('/\s+/', ' ', (string) ($byIndex[$header['name']] ?? '')));
            if ($name === '' || is_numeric($name)) {
                continue;
            }
            $matricule = trim((string) ($byIndex[$header['matricule']] ?? ''));
            if (is_numeric($matricule)) {
                $matricule = (string) (int) $matricule;
            }
            if (! preg_match('/\d/', $matricule)) {
                $matricule = '';
            }
            $entry = $header['embauche'] !== null ? XlsxStreamReader::toDate($byIndex[$header['embauche']] ?? null) : null;

            $days = [];
            foreach ($months as $i => [$year, $month]) {
                $value = $byIndex[$i] ?? null;
                if (is_numeric($value) && (float) $value > 0) {
                    $key = sprintf('%04d-%02d', $year, $month);
                    $days[$key] = round(($days[$key] ?? 0) + (float) $value, 1);
                }
            }

            $lines[] = [
                'row' => $rowNumber,
                'name' => $name,
                'matricule' => $matricule ?: null,
                'fonction' => $header['fonction'] !== null ? (trim(preg_replace('/\s+/', ' ', (string) ($byIndex[$header['fonction']] ?? ''))) ?: null) : null,
                'entry_date' => $entry?->toDateString(),
                'days' => $days,
            ];
        }

        return $lines;
    }

    /**
     * @param  array<int, array>  $lines
     * @param  int[]  $accessibleSiteIds  sites the importing user may touch (matricule matches elsewhere are ignored)
     */
    public function import(array $lines, int $siteId, array $accessibleSiteIds, string $newStatus, ?int $userId): array
    {
        $result = [
            'lines' => count($lines), 'matched' => 0, 'created' => 0, 'months' => 0, 'days' => 0.0,
            'filled' => 0, 'unchanged' => 0, 'updated' => 0, 'new_people' => [], 'warnings' => [],
        ];

        $positions = Position::all()->mapWithKeys(fn ($p) => [self::positionKey($p->name) => $p->id]);
        $pool = Employee::whereIn('site_id', $accessibleSiteIds)->get(['id', 'full_name', 'matricule', 'site_id', 'entry_date', 'position_id']);
        $byMatricule = [];
        $byName = [];
        foreach ($pool as $employee) {
            if ($employee->matricule) {
                $byMatricule[(string) (int) $employee->matricule ?: $employee->matricule][] = $employee;
            }
            $byName[self::nameKey($employee->full_name)][] = $employee;
        }
        $pick = function (array $candidates) use ($siteId) {
            $onSite = array_values(array_filter($candidates, fn ($e) => $e->site_id === $siteId));

            return count($onSite) === 1 ? $onSite[0] : (count($onSite) === 0 && count($candidates) === 1 ? $candidates[0] : null);
        };

        DB::transaction(function () use ($lines, $siteId, $newStatus, $userId, $positions, &$byMatricule, &$byName, $pick, &$result) {
            $seen = [];
            foreach ($lines as $line) {
                $employee = null;
                if ($line['matricule'] && isset($byMatricule[$line['matricule']])) {
                    $employee = $pick($byMatricule[$line['matricule']]);
                }
                $nameKey = self::nameKey($line['name']);
                if (! $employee && isset($byName[$nameKey])) {
                    $candidate = $pick($byName[$nameKey]);
                    // Same name but another matricule on file: a different person.
                    if ($candidate && $line['matricule'] && $candidate->matricule && (int) $candidate->matricule !== (int) $line['matricule']) {
                        $candidate = null;
                    }
                    if (! $candidate && count($byName[$nameKey]) > 1) {
                        $result['warnings'][] = "Ligne {$line['row']} — {$line['name']} : plusieurs employés portent ce nom, ligne ignorée.";

                        continue;
                    }
                    $employee = $candidate;
                }

                if ($employee && isset($seen[$employee->id])) {
                    $result['warnings'][] = "Ligne {$line['row']} — {$line['name']} : déjà lu ligne {$seen[$employee->id]}, ligne ignorée.";

                    continue;
                }

                if ($employee) {
                    $result['matched']++;
                    $fill = [];
                    if (! $employee->matricule && $line['matricule']) {
                        $fill['matricule'] = $line['matricule'];
                    }
                    if (! $employee->entry_date && $line['entry_date']) {
                        $fill['entry_date'] = $line['entry_date'];
                    }
                    if (! $employee->position_id && ($positionId = $positions[self::positionKey((string) $line['fonction'])] ?? null)) {
                        $fill['position_id'] = $positionId;
                    }
                    if ($fill) {
                        Employee::whereKey($employee->id)->update($fill);
                        $result['filled']++;
                    }
                } else {
                    $positionId = $line['fonction'] ? ($positions[self::positionKey($line['fonction'])] ?? null) : null;
                    $employee = Employee::create([
                        'full_name' => $line['name'],
                        'matricule' => $line['matricule'],
                        'site_id' => $siteId,
                        'position_id' => $positionId,
                        'entry_date' => $line['entry_date'],
                        'status' => $newStatus,
                        'notes' => 'Ajouté depuis l’état de congé (historique)'.($line['fonction'] && ! $positionId ? ' — fonction : '.$line['fonction'] : ''),
                    ]);
                    $result['created']++;
                    $result['new_people'][] = $line['name'];
                    if ($line['matricule']) {
                        $byMatricule[$line['matricule']][] = $employee;
                    }
                    $byName[$nameKey][] = $employee;
                }
                $seen[$employee->id] = $line['row'];

                $changed = $this->replaceMonths($employee->id, $siteId, $line['days'], $userId);
                $changed ? $result['updated']++ : $result['unchanged']++;
                $result['months'] += count($line['days']);
                $result['days'] += array_sum($line['days']);
            }
        });

        $result['days'] = round($result['days'], 1);

        return $result;
    }

    /** @return bool whether anything changed */
    private function replaceMonths(int $employeeId, int $siteId, array $days, ?int $userId): bool
    {
        $existing = LeaveHistory::where('employee_id', $employeeId)->where('source', 'import')->get()
            ->mapWithKeys(fn ($h) => [sprintf('%04d-%02d', $h->year, $h->month) => $h]);

        $changed = false;
        foreach ($existing as $key => $row) {
            if (! isset($days[$key])) {
                $row->delete();
                $changed = true;
            }
        }
        foreach ($days as $key => $value) {
            [$year, $month] = array_map('intval', explode('-', $key));
            $row = $existing[$key] ?? null;
            if ($row) {
                if (abs($row->days - $value) > 0.01 || $row->site_id !== $siteId) {
                    $row->update(['days' => $value, 'site_id' => $siteId]);
                    $changed = true;
                }

                continue;
            }
            LeaveHistory::updateOrCreate(
                ['employee_id' => $employeeId, 'year' => $year, 'month' => $month],
                ['site_id' => $siteId, 'days' => $value, 'source' => 'import', 'created_by' => $userId]
            );
            $changed = true;
        }

        return $changed;
    }

    public static function norm(string $value): string
    {
        $value = \Illuminate\Support\Str::ascii(mb_strtolower($value));

        return trim(preg_replace('/[^a-z0-9]+/', ' ', $value));
    }

    /** "Ayoub LACHHEB" = "LACHHEB AYOUB". */
    public static function nameKey(string $name): string
    {
        $words = array_filter(explode(' ', self::norm($name)));
        sort($words);

        return implode(' ', $words);
    }

    /** "CHAUFFEUR DE CAMION" = "Chauffeur De Camion", "OUVRIER-SECURITE" = "Ouvrier sécurité". */
    private static function positionKey(string $name): string
    {
        $words = array_filter(explode(' ', self::norm($name)), fn ($w) => ! in_array($w, ['de', 'du', 'des', 'd', 'l', 'la', 'le'], true));

        return implode(' ', $words);
    }

    private static function colIndex(string $letters): int
    {
        $index = 0;
        foreach (str_split(strtoupper($letters)) as $char) {
            $index = $index * 26 + (ord($char) - 64);
        }

        return $index;
    }

    /** Whole months since the entry date, like Excel's DATEDIF(entry, TODAY(), "m"). */
    public static function monthsSince(?Carbon $entry, ?Carbon $until = null): int
    {
        if (! $entry) {
            return 0;
        }
        $until ??= Carbon::today();

        return $entry->gt($until) ? 0 : (int) $entry->diffInMonths($until);
    }
}
