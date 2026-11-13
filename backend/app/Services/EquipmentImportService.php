<?php

namespace App\Services;

use App\Models\FuelVehicle;
use App\Models\Site;
use App\Models\User;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Reads the company's "Affectation de matériels" workbook as-is (Matériel
 * session) and makes Matériel look exactly like it — nothing that isn't in
 * the file is invented:
 * - "OCTOBRE": Immatriculation, CODE PARC, N° de Châssis, Type, Site;
 * - "DEPLACEMENT": same columns, the destination site in a MERGED column
 *   (carried down) → that site, status "En déplacement";
 * - "Arrêt & panne": Code, Matricule, Châssis, Site, Remarque → "En panne";
 * - sheets without such a header (Recap) are ignored.
 *
 * The CODE PARC is kept as written (`fleet_code`: "D66 ARR", "TRSP",
 * "DACIA"…) and the file's order is kept (`sort_order`). A vehicle is
 * recognised by its plate (the same vehicle on two sheets is one vehicle;
 * several "DACIA" are several vehicles). `code` — the pump code
 * Consommation matches on — is never shown in Matériel: an existing
 * vehicle keeps it, a new one gets FuelVehicle::pumpCodeFor(). Upsert,
 * never deletes.
 */
class EquipmentImportService
{
    private const COLUMNS = [
        'code' => ['code parc', 'code'],
        'matricule' => ['immatriculation', 'matricule'],
        'chassis' => ['chassis'],
        'type' => ['type'],
        'site' => ['site', 'deplacement'],
        'notes' => ['remarque', 'observation'],
    ];

    /** @return array{created: int, updated: int, total: int, skipped: array<int, string>, other_sites: int} */
    public function import(string $path, string $filename, User $user): array
    {
        $reader = new XlsxStreamReader($path);
        $sites = Site::all()->keyBy(fn (Site $s) => $this->compact($s->name));
        $byPlate = [];
        $skipped = [];
        $otherSites = 0; // lines of sites outside the user's scope (counted, not listed)
        $found = false;
        $order = 0;

        foreach ($reader->sheets() as $sheetName => $sheetPath) {
            $sheetKey = $this->key($sheetName);
            $sheetStatus = str_contains($sheetKey, 'panne') || str_contains($sheetKey, 'arret') ? 'en_panne'
                : (str_contains($sheetKey, 'deplacement') ? 'deplacement' : 'en_service');
            $columns = null;
            $lastSite = null;

            foreach ($reader->rows($sheetPath) as [$rowNumber, $cells]) {
                $texts = array_filter(array_map(fn ($v) => $this->text($v), $cells), fn ($v) => $v !== null);
                if ($detected = $this->detectColumns($texts)) {
                    // A (new) header row: the merged site column starts over.
                    $columns = $detected;
                    $lastSite = null;
                    $found = true;
                    continue;
                }
                if (! $columns) {
                    continue;
                }

                $value = fn (string $key) => isset($columns[$key]) ? $this->text($cells[$columns[$key]] ?? null) : null;
                $fleetCode = $value('code');
                if ($fleetCode === null) {
                    continue;
                }
                $plate = $this->compactId($value('matricule'));
                $label = "{$sheetName} ligne {$rowNumber}";
                if ($plate === null) {
                    $skipped[] = "{$label} : {$fleetCode} sans immatriculation, ignoré.";
                    continue;
                }

                // Merged site cells (DEPLACEMENT) only hold the value on their first row.
                $siteText = $value('site') ?? $lastSite;
                $lastSite = $siteText;
                $site = $siteText ? $this->matchSite($sites, $siteText) : null;
                if ($siteText && ! $site) {
                    $skipped[] = "{$label} : {$fleetCode} — site « {$siteText} » inconnu, ignoré.";
                    continue;
                }
                if (! $user->isSuperAdmin() && (! $site || ! $user->canAccessSite($site->id))) {
                    $otherSites++;
                    continue;
                }

                $remark = $value('notes');
                $status = $remark && str_contains($this->key($remark), 'panne') ? 'en_panne' : $sheetStatus;
                // "83639A55" and "83639-A-55" are the same plate; a D… / E…
                // number is one vehicle even if a later sheet writes another
                // plate for it (D246, E18 in the October file).
                $number = FuelVehicle::pumpCodeFor($fleetCode, null);
                $plateKey = preg_match('/^[DE]\d+$/', $number) ? 'N:'.$number : str_replace('-', '', $plate);
                $previous = $byPlate[$plateKey] ?? null;

                // The same plate on a later sheet (déplacement, panne) refines the vehicle.
                $byPlate[$plateKey] = [
                    'fleet_code' => $previous['fleet_code'] ?? $fleetCode,
                    'matricule' => $previous['matricule'] ?? $plate,
                    // The first sheet (the fleet list) gives the identity; later ones refine site / status / remark.
                    'chassis_number' => $previous['chassis_number'] ?? $this->compactId($value('chassis')),
                    'type' => $previous['type'] ?? $value('type'),
                    'site_id' => $site?->id ?? ($previous['site_id'] ?? null),
                    'status' => $status,
                    'notes' => $remark ?? ($previous['notes'] ?? null),
                    'sort_order' => $previous['sort_order'] ?? ++$order,
                ];
            }
        }

        if (! $found) {
            throw new HttpException(422, "Aucune liste de matériel reconnue dans « {$filename} » (en-têtes CODE PARC / Immatriculation introuvables).");
        }

        $created = $updated = 0;
        foreach ($byPlate as $row) {
            $plate = $row['matricule'];
            $plateKey = str_replace('-', '', $plate);
            $pumpCode = FuelVehicle::pumpCodeFor($row['fleet_code'], $plate);
            $isFleetNumber = (bool) preg_match('/^[DE]\d+$/', $pumpCode);

            // Same plate = same vehicle; a D… / E… number also identifies it.
            $vehicle = FuelVehicle::whereRaw("REPLACE(REPLACE(matricule, '-', ''), ' ', '') = ?", [$plateKey])->first()
                ?? ($isFleetNumber ? FuelVehicle::where('code', $pumpCode)->first() : null);

            if (! $vehicle) {
                $vehicle = new FuelVehicle(['code' => $this->freeCode($pumpCode, $plate)]);
            }
            // A citerne marked "Citerne" in Matriculation stays one (its fills are transfers, not consumption).
            if ($vehicle->type === 'Citerne') {
                unset($row['type']);
            } elseif ($row['type'] === null) {
                unset($row['type']); // a sheet without a Type column (Arrêt & panne) keeps the known one
            }
            $vehicle->fill($row);
            $vehicle->exists ? $updated++ : $created++;
            $vehicle->save();
        }

        return ['created' => $created, 'updated' => $updated, 'total' => $created + $updated, 'skipped' => $skipped, 'other_sites' => $otherSites];
    }

    /** `code` is unique: a pump code already taken by another plate falls back to the plate itself. */
    private function freeCode(string $code, string $plate): string
    {
        if (! FuelVehicle::where('code', $code)->exists()) {
            return $code;
        }

        return FuelVehicle::where('code', $plate)->exists() ? $plate.'-'.Str::lower(Str::random(4)) : $plate;
    }

    /** @return array<string, string>|null field => column letter */
    private function detectColumns(array $texts): ?array
    {
        $labels = array_map(fn ($t) => $this->key($t), $texts);
        $columns = [];
        foreach (self::COLUMNS as $field => $needles) {
            foreach ($needles as $needle) {
                foreach ($labels as $column => $label) {
                    if (! in_array($column, $columns, true) && ($label === $needle || str_starts_with($label, $needle.' ') || ($needle !== 'code' && str_contains($label, $needle)))) {
                        $columns[$field] = $column;
                        continue 3;
                    }
                }
            }
        }

        return isset($columns['code'], $columns['matricule']) ? $columns : null;
    }

    private function matchSite($sites, string $text): ?Site
    {
        $key = $this->compact($text);
        if ($key === '') {
            return null;
        }

        return $sites[$key] ?? $sites->first(fn (Site $s, $k) => str_contains($key, $k) || str_contains($k, $key));
    }

    /** Plates / chassis: no spaces or line breaks ("\n\nVF631S359ND001198\n"). */
    private function compactId(?string $text): ?string
    {
        if ($text === null) {
            return null;
        }
        $id = strtoupper(preg_replace('/\s+/u', '', $text));

        return $id === '' ? null : Str::limit($id, 120, '');
    }

    private function text(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (is_float($value) && floor($value) == $value) {
            $value = (string) (int) $value;
        }
        $text = trim(preg_replace('/\s+/u', ' ', (string) $value));

        return $text === '' ? null : $text;
    }

    private function key(string $text): string
    {
        $ascii = Str::ascii(mb_strtolower($text));

        return trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z0-9 ]+/', ' ', $ascii)));
    }

    private function compact(string $text): string
    {
        return str_replace(' ', '', $this->key($text));
    }
}
