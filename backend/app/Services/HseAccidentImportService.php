<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\HseAccident;
use App\Models\Site;
use App\Models\User;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Reads the company's own "BILAN GLOBAL DES ACCIDENTS" workbook as-is (no
 * template): the header row is found by its labels (Site / Date de
 * l'accident / Heure / Shift / Zone / Nom du chauffeur / Âge / Ancienneté /
 * N° Camion, plus the merged "Détails de l'événement" / "Causes" /
 * "Décision" cells of the row above), so a moved column doesn't break it.
 * Cells are free text in that file ("29/04/2026 - Mercredi", "4H30
 * (Ramadan)", "2 ème", "41 Ans", "MAP - 6 Jours") and are parsed here.
 *
 * Re-importing the same file never duplicates: a line is matched on
 * site + date + chauffeur and updated.
 */
class HseAccidentImportService
{
    private const COLUMNS = [
        'type' => ['type', 'nature'],
        'site' => ['site'],
        'date' => ['date'],
        'time' => ['heure'],
        'shift' => ['shift', 'poste'],
        'zone' => ['zone', 'lieu'],
        'driver' => ['nom', 'chauffeur', 'victime'],
        'age' => ['age'],
        'seniority' => ['anciennete'],
        'equipment' => ['camion', 'materiel', 'engin'],
        'description' => ['detail', 'evenement', 'description'],
        'causes' => ['cause'],
        'decision' => ['decision', 'sanction'],
        'notes' => ['observation', 'remarque'],
    ];

    /**
     * @return array{created: int, updated: int, total: int, skipped: array<int, string>}
     */
    public function import(string $path, string $filename, User $user): array
    {
        $reader = new XlsxStreamReader($path);
        $sites = Site::all()->keyBy(fn (Site $s) => $this->compact($s->name));
        $created = $updated = 0;
        $skipped = [];
        $touched = []; // site_id => accidents written, for the Historique
        $headerFound = false;

        foreach ($reader->sheets() as $sheetName => $sheetPath) {
            $columns = null;
            $previous = [];

            foreach ($reader->rows($sheetPath) as [$rowNumber, $cells]) {
                $texts = array_filter(array_map(fn ($v) => $this->text($v), $cells), fn ($v) => $v !== null);

                if ($columns === null) {
                    $columns = $this->detectColumns($texts, $previous);
                    $previous = $texts;
                    if ($columns === null && $rowNumber > 30) {
                        break;
                    }
                    continue;
                }
                $headerFound = true;

                $value = fn (string $key) => isset($columns[$key]) ? ($cells[$columns[$key]] ?? null) : null;
                $siteText = $this->text($value('site'));
                $driver = $this->text($value('driver'));
                $description = $this->text($value('description'));
                if ($siteText === null && $driver === null && $description === null) {
                    continue; // empty line
                }

                $label = "Ligne {$rowNumber}".(count($reader->sheets()) > 1 ? " ({$sheetName})" : '');
                $site = $siteText ? $this->matchSite($sites, $siteText) : null;
                if (! $site) {
                    $skipped[] = "{$label} : site « ".($siteText ?? '—').' » inconnu.';
                    continue;
                }
                if (! $user->canAccessSite($site->id)) {
                    $skipped[] = "{$label} : le site {$site->name} ne fait pas partie de vos sites.";
                    continue;
                }
                $date = $this->parseDate($value('date'));
                if (! $date) {
                    $skipped[] = "{$label} : date « ".($this->text($value('date')) ?? '—').' » illisible.';
                    continue;
                }
                if ($driver === null) {
                    $skipped[] = "{$label} : nom du chauffeur manquant.";
                    continue;
                }

                [$time, $timeNote] = $this->parseTime($value('time'));
                [$decision, $days, $decisionNote] = $this->parseDecision($this->text($value('decision')));
                $notes = array_filter([$timeNote, $this->text($value('notes'))]);
                $typeText = $this->key((string) $this->text($value('type')));

                $data = [
                    'type' => str_contains($typeText, 'incident') ? 'incident' : 'accident',
                    'occurred_time' => $time,
                    'shift' => $this->parseShift($value('shift')),
                    'zone' => $this->text($value('zone')),
                    'driver_age' => $this->parseInt($value('age'), 14, 99),
                    'driver_seniority' => $this->text($value('seniority')),
                    'equipment' => $this->text($value('equipment')),
                    'description' => $description ?? '—',
                    'causes' => $this->text($value('causes')),
                    'decision' => $decision,
                    'decision_days' => $days,
                    'decision_note' => $decisionNote,
                    'notes' => $notes ? implode(' — ', $notes) : null,
                ];

                $existing = HseAccident::where('site_id', $site->id)
                    ->whereDate('occurred_on', $date)
                    ->whereRaw('LOWER(TRIM(driver_name)) = ?', [mb_strtolower($driver)])
                    ->first();

                if ($existing && $user->isHse() && $existing->created_by !== $user->id) {
                    // Same rule as editing by hand: an animateur only corrects its own lines.
                    $skipped[] = "{$label} : déjà saisie par un autre compte, non modifiée.";
                    continue;
                }
                if ($existing) {
                    $existing->update($data);
                    $touched[$site->id][] = $existing;
                    $updated++;
                } else {
                    $touched[$site->id][] = HseAccident::create($data + [
                        'site_id' => $site->id,
                        'occurred_on' => $date,
                        'driver_name' => $driver,
                        'employee_id' => $this->matchEmployee($site->id, $driver),
                        'created_by' => $user->id,
                    ]);
                    $created++;
                }
            }
        }

        if (! $headerFound) {
            throw new HttpException(422, "Aucun tableau d'accidents reconnu dans « {$filename} » (en-têtes Site / Date de l'accident / Nom du chauffeur introuvables).");
        }

        return ['created' => $created, 'updated' => $updated, 'total' => $created + $updated, 'skipped' => $skipped, 'touched' => $touched];
    }

    /**
     * The header row holds "Site" and a "Date…" label; the merged group
     * cells of the row above ("Détails de l'événement", "Causes…",
     * "Décision…") count for their own column too.
     *
     * @param  array<string, string>  $texts
     * @param  array<string, string>  $previous
     * @return array<string, string>|null field => column letter
     */
    private function detectColumns(array $texts, array $previous): ?array
    {
        $labels = [];
        foreach ($texts as $column => $text) {
            $labels[$column] = $this->key($text);
        }
        if (! in_array('site', $labels, true) || ! collect($labels)->contains(fn ($l) => str_contains($l, 'date'))) {
            return null;
        }
        foreach ($previous as $column => $text) {
            if (! isset($labels[$column])) {
                $labels[$column] = $this->key($text);
            }
        }

        $columns = [];
        foreach (self::COLUMNS as $field => $needles) {
            foreach ($labels as $column => $label) {
                if (in_array($column, $columns, true)) {
                    continue;
                }
                foreach ($needles as $needle) {
                    if ($label === $needle || str_contains($label, $needle)) {
                        $columns[$field] = $column;
                        continue 3;
                    }
                }
            }
        }

        return isset($columns['site'], $columns['date']) ? $columns : null;
    }

    private function matchSite($sites, string $text): ?Site
    {
        $key = $this->compact($text);
        if ($key === '') {
            return null;
        }
        if (isset($sites[$key])) {
            return $sites[$key];
        }

        return $sites->first(fn (Site $s, $k) => str_contains($key, $k) || str_contains($k, $key));
    }

    /** Links the line to a fiche employé when exactly one employee of that site has this name. */
    private function matchEmployee(int $siteId, string $name): ?int
    {
        $ids = Employee::where('site_id', $siteId)
            ->whereRaw('LOWER(TRIM(full_name)) = ?', [mb_strtolower(trim($name))])
            ->limit(2)->pluck('id');

        return $ids->count() === 1 ? $ids->first() : null;
    }

    /** "29/04/2026 - Mercredi", " 04/09/2026", an Excel date serial… */
    private function parseDate(mixed $value): ?string
    {
        if (is_int($value) || is_float($value)) {
            return XlsxStreamReader::toDate($value)?->toDateString();
        }
        $text = (string) $this->text($value);
        if (preg_match('#(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})#', $text, $m)) {
            return XlsxStreamReader::toDate("{$m[1]}/{$m[2]}/{$m[3]}")?->toDateString();
        }

        return XlsxStreamReader::toDate($text)?->toDateString();
    }

    /** "18H30", "6H50", "11h44", "00H30", "4H30 (Ramadan)" -> ["04:30:00", "Ramadan"]. */
    private function parseTime(mixed $value): array
    {
        if (is_int($value) || is_float($value)) {
            return [XlsxStreamReader::toTime($value), null];
        }
        $text = (string) $this->text($value);
        if (preg_match('/(\d{1,2})\s*[hH:]\s*(\d{2})?/', $text, $m) && (int) $m[1] < 24 && (int) ($m[2] ?? 0) < 60) {
            $rest = trim(str_replace($m[0], '', $text), " ()-\t");

            return [sprintf('%02d:%02d:00', $m[1], $m[2] ?? 0), $rest !== '' ? $rest : null];
        }

        return [null, $text !== '' ? "Heure : {$text}" : null];
    }

    /** "1ér", "1 ér", "2 ème" -> 1 / 2 */
    private function parseShift(mixed $value): ?int
    {
        return preg_match('/([123])/', (string) $this->text($value), $m) ? (int) $m[1] : null;
    }

    private function parseInt(mixed $value, int $min, int $max): ?int
    {
        if (! preg_match('/(\d+)/', (string) $this->text($value), $m)) {
            return null;
        }
        $n = (int) $m[1];

        return $n >= $min && $n <= $max ? $n : null;
    }

    /** "MAP - 6 Jours" / "Repos Maladie - 14 Jours" / "Licenciement" / "En poste" / anything else = autre. */
    private function parseDecision(?string $text): array
    {
        if ($text === null) {
            return [null, null, null];
        }
        $key = $this->key($text);
        $days = preg_match('/(\d+)\s*j/i', $text, $m) ? (int) $m[1] : null;

        return match (true) {
            str_starts_with($key, 'map') || str_contains($key, 'mise a pied') => ['map', $days, null],
            str_contains($key, 'repos') || str_contains($key, 'maladie') || str_contains($key, 'arret') => ['repos_maladie', $days, null],
            str_contains($key, 'licenci') => ['licenciement', null, null],
            str_contains($key, 'avertissement') => ['avertissement', null, null],
            str_contains($key, 'en poste') || $key === 'poste' => ['en_poste', null, null],
            default => ['autre', null, Str::limit($text, 250, '')],
        };
    }

    private function text(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $text = trim(preg_replace('/\s+/u', ' ', (string) $value));

        return $text === '' ? null : $text;
    }

    /** "Ben Guerir" and "Benguerir" are the same site. */
    private function compact(string $text): string
    {
        return str_replace(' ', '', $this->key($text));
    }

    /** lower-case, no accents, no emoji/punctuation: "👤Profil du Chauffeur" -> "profil du chauffeur" */
    private function key(string $text): string
    {
        $ascii = Str::ascii(mb_strtolower($text));

        return trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z0-9 ]+/', ' ', $ascii)));
    }
}
