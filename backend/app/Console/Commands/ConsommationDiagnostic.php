<?php

namespace App\Console\Commands;

use App\Services\FuelImportService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * READ-ONLY health check for the Consommation module on a server: PHP
 * extensions and upload limits, whether the fuel migrations ran, what is
 * stored per site, and — with --citerne / --affectation — a dry-run parse of
 * an Excel file that writes nothing to the database.
 *
 *   php artisan consommation:diagnostic
 *   php artisan consommation:diagnostic --citerne="/tmp/mobile 1.xlsx" --affectation="/tmp/AFFECTATION LOUTA.xlsx"
 *
 * Note: limits shown here are the CLI php.ini's; the web server's PHP-FPM
 * may use a different php.ini (compare with `php -i` vs phpinfo()).
 */
class ConsommationDiagnostic extends Command
{
    protected $signature = 'consommation:diagnostic
        {--citerne=* : Chemin d\'un fichier de citerne à tester (lecture seule)}
        {--affectation=* : Chemin d\'un fichier d\'affectation à tester (lecture seule)}
        {--reparer-sites : Rattache chaque citerne au site de ses lignes quand ils diffèrent (demande confirmation)}';

    protected $description = 'Vérifie (sans rien modifier) que le module Consommation peut importer les fichiers Excel sur ce serveur';

    private int $problems = 0;

    public function handle(FuelImportService $importer): int
    {
        $this->info('== PHP ==');
        $this->line('Version : '.PHP_VERSION.' ('.php_ini_loaded_file().')');
        foreach (['zip' => 'ZipArchive', 'xmlreader' => 'XMLReader', 'mbstring' => null, 'fileinfo' => null, 'pdo_mysql' => null] as $extension => $class) {
            $ok = $class ? class_exists($class) : extension_loaded($extension);
            $this->check($ok, "Extension {$extension}", $ok ? 'OK' : "MANQUANTE — installez php-{$extension} puis redémarrez PHP/PHP-FPM");
        }
        foreach (['upload_max_filesize' => 10, 'post_max_size' => 10, 'memory_limit' => 256] as $key => $minMo) {
            $value = (string) ini_get($key);
            $ok = $value === '-1' || $this->mo($value) >= $minMo;
            $this->check($ok, $key, $value.($ok ? '' : " — trop bas, mettez au moins {$minMo}M (le fichier « mobile 1 » fait 2,3 Mo)"));
        }
        $this->line('max_execution_time : '.ini_get('max_execution_time').' s (les imports demandent 300 s eux-mêmes)');
        $this->comment('Rappel : nginx limite aussi la taille des envois (client_max_body_size, 1 Mo par défaut) → mettez par ex. client_max_body_size 50M;');

        $this->newLine();
        $this->info('== Base de données ==');
        $migrations = [
            '2026_10_27_000001_create_fuel_tables',
            '2026_10_27_000002_add_manual_edits_to_fuel_movements',
            '2026_10_27_000003_create_fuel_report_tables',
        ];
        $ran = DB::table('migrations')->whereIn('migration', $migrations)->pluck('migration')->all();
        foreach ($migrations as $migration) {
            $this->check(in_array($migration, $ran, true), $migration, in_array($migration, $ran, true) ? 'exécutée' : 'NON exécutée → lancez « php artisan migrate --force » (ajoute seulement les tables/colonnes, ne supprime rien)');
        }
        $columns = [
            'fuel_vehicles' => ['code', 'matricule', 'unit'],
            'fuel_tanks' => ['site_id', 'name'],
            'fuel_movements' => ['origin', 'fingerprint', 'edited'],
            'fuel_movement_overrides' => ['fingerprint'],
            'fuel_assignments' => ['site_id', 'code', 'driver_1'],
            'fuel_report_lines' => ['date', 'activity'],
        ];
        foreach ($columns as $table => $needed) {
            $missing = Schema::hasTable($table) ? array_values(array_filter($needed, fn ($c) => ! Schema::hasColumn($table, $c))) : $needed;
            $this->check(! $missing, "Table {$table}", $missing ? 'colonnes manquantes : '.implode(', ', $missing) : 'OK');
        }

        if (Schema::hasTable('fuel_tanks') && Schema::hasTable('sites')) {
            $this->newLine();
            $this->info('== Données par site ==');
            $rows = DB::table('sites')->orderBy('name')->get(['id', 'name'])->map(fn ($site) => [
                $site->name,
                DB::table('fuel_tanks')->where('site_id', $site->id)->pluck('name')->implode(', ') ?: '—',
                DB::table('fuel_movements')->where('site_id', $site->id)->count(),
                Schema::hasTable('fuel_assignments') ? DB::table('fuel_assignments')->where('site_id', $site->id)->count() : '—',
            ]);
            $this->table(['Site', 'Citernes', 'Lignes', 'Affectations'], $rows);
            $this->line('Matricules : '.DB::table('fuel_vehicles')->count());

            $this->newLine();
            $this->info('== Citernes : site de la citerne / site de ses lignes ==');
            $siteNames = DB::table('sites')->pluck('name', 'id');
            $lineSites = DB::table('fuel_movements')->groupBy('fuel_tank_id', 'site_id')
                ->get(['fuel_tank_id', 'site_id', DB::raw('COUNT(*) as n')])->groupBy('fuel_tank_id');
            $mismatches = [];
            $rows = [];
            foreach (DB::table('fuel_tanks')->orderBy('id')->get() as $tank) {
                $lines = $lineSites[$tank->id] ?? collect();
                $ok = isset($siteNames[$tank->site_id]) && $lines->every(fn ($l) => (int) $l->site_id === (int) $tank->site_id);
                if (! $ok && $lines->count() === 1) {
                    $mismatches[] = [$tank, (int) $lines->first()->site_id];
                }
                if (! $ok) {
                    $this->problems++;
                }
                $rows[] = [
                    $tank->id,
                    $tank->name,
                    ($siteNames[$tank->site_id] ?? 'INEXISTANT').' (#'.$tank->site_id.')',
                    $lines->map(fn ($l) => ($siteNames[$l->site_id] ?? 'INEXISTANT').' (#'.$l->site_id.') : '.$l->n)->implode(', ') ?: 'aucune ligne',
                    $ok ? 'OK' : 'INCOHÉRENT',
                ];
            }
            $this->table(['#', 'Citerne', 'Site de la citerne', 'Site des lignes : nombre', 'État'], $rows);

            if ($mismatches && ! $this->option('reparer-sites')) {
                $this->warn(count($mismatches)." citerne(s) rattachée(s) à un autre site que leurs lignes : elles n'apparaissent pas correctement dans l'onglet Citernes.");
                $this->line("→ Pour corriger : php artisan consommation:diagnostic --reparer-sites (change seulement le site de ces citernes, aucune ligne n'est touchée).");
            }
            if ($mismatches && $this->option('reparer-sites')) {
                foreach ($mismatches as [$tank, $siteId]) {
                    $target = $siteNames[$siteId] ?? null;
                    if ($target === null) {
                        $this->error("Citerne « {$tank->name} » : ses lignes pointent vers un site inexistant (#{$siteId}), correction manuelle nécessaire.");

                        continue;
                    }
                    if (DB::table('fuel_tanks')->where('site_id', $siteId)->where('name', $tank->name)->where('id', '!=', $tank->id)->exists()) {
                        $this->error("Citerne « {$tank->name} » : une autre citerne du même nom existe déjà à {$target}, correction manuelle nécessaire.");

                        continue;
                    }
                    if ($this->confirm("Rattacher la citerne « {$tank->name} » au site {$target} (celui de ses lignes) ?", true)) {
                        DB::table('fuel_tanks')->where('id', $tank->id)->update(['site_id' => $siteId, 'updated_at' => now()]);
                        $this->problems--;
                        $this->info("  ✔ « {$tank->name} » rattachée à {$target}.");
                    }
                }
            }
        }

        foreach ((array) $this->option('citerne') as $path) {
            $this->newLine();
            $this->info("== Test citerne : {$path} ==");
            try {
                $sheets = $importer->inspectTanks($path);
                foreach ($sheets as $name => $stats) {
                    $stats === null
                        ? $this->line("  Feuille « {$name} » : ignorée (pas d'en-têtes ENTREE / SORTIES / Date / Qte)")
                        : $this->line(sprintf('  Feuille « %s » → citerne : %d sorties, %d entrées, du %s au %s, %d ligne(s) ignorée(s)', $name, $stats['exits'], $stats['entries'], $stats['date_from'] ?? '?', $stats['date_to'] ?? '?', $stats['skipped']));
                }
                $this->check((bool) array_filter($sheets), 'Lecture', array_filter($sheets) ? 'OK' : 'aucune feuille de citerne reconnue');
            } catch (Throwable $e) {
                $this->check(false, 'Lecture', $e->getMessage());
            }
        }

        foreach ((array) $this->option('affectation') as $path) {
            $this->newLine();
            $this->info("== Test affectation : {$path} ==");
            try {
                $rows = $importer->parseAssignments($path, basename($path));
                $byCategory = collect($rows)->countBy('category');
                $this->check(true, 'Lecture', sprintf('%d véhicules (%d camions, %d engins)', count($rows), $byCategory['camion'] ?? 0, $byCategory['engin'] ?? 0));
            } catch (Throwable $e) {
                $this->check(false, 'Lecture', $e->getMessage());
            }
        }

        $this->newLine();
        $this->problems === 0
            ? $this->info('Aucun problème détecté. Si un import échoue encore, regardez storage/logs/laravel.log et la limite client_max_body_size de nginx.')
            : $this->error("{$this->problems} problème(s) détecté(s) ci-dessus.");

        return $this->problems === 0 ? self::SUCCESS : self::FAILURE;
    }

    private function check(bool $ok, string $label, string $detail): void
    {
        if (! $ok) {
            $this->problems++;
        }
        $this->line(($ok ? '<fg=green>✔</>' : '<fg=red>✘</>')." {$label} : {$detail}");
    }

    private function mo(string $value): float
    {
        $number = (float) $value;

        return match (strtoupper(substr(trim($value), -1))) {
            'G' => $number * 1024,
            'K' => $number / 1024,
            'M' => $number,
            default => $number / 1024 / 1024,
        };
    }
}
