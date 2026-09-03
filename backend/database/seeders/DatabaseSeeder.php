<?php

namespace Database\Seeders;

use App\Models\Assignment;
use App\Models\Attendance;
use App\Models\CashAccount;
use App\Models\CashTransaction;
use App\Models\Department;
use App\Models\DisciplinaryWarning;
use App\Models\Employee;
use App\Models\Entry;
use App\Models\EmployeeExit;
use App\Models\Leave;
use App\Models\LeaveRequest;
use App\Models\Position;
use App\Models\Site;
use App\Models\Suspension;
use App\Models\User;
use App\Services\CashLedgerService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $sites = collect(['Ben Guerir', 'Louta', 'Bouchane', 'Mzinda'])
            ->mapWithKeys(fn ($name) => [$name => Site::create(['name' => $name, 'slug' => Str::slug($name)])]);

        $departments = collect(['Moyens généraux', 'HSE', 'Exploitation', 'Administration', 'Maintenance'])
            ->mapWithKeys(fn ($name) => [$name => Department::create(['name' => $name])]);

        $positions = collect(['Technicien', 'Agent de sécurité', 'Chauffeur', 'Superviseur', 'Ouvrier', 'Magasinier', 'Comptable'])
            ->mapWithKeys(fn ($name) => [$name => Position::create(['name' => $name])]);

        User::create([
            'name' => 'Super Admin',
            'email' => 'admin@transwin-mining.com',
            'password' => Hash::make('password'),
            'role' => 'superadmin',
            'site_id' => null,
        ]);

        $employeeNames = [
            'Ben Guerir' => ['Ahmed Benali', 'Youssef El Amrani', 'Karim Fassi', 'Nadia Chraibi', 'Rachid Idrissi'],
            'Louta' => ['Mohamed Alaoui', 'Samira Bennis', 'Hicham Tazi', 'Fatima Zahra Ouazzani', 'Omar Sqalli'],
            'Bouchane' => ['Abdellah Kabbaj', 'Latifa Berrada', 'Younes Cherkaoui', 'Imane Belhaj', 'Said Tahiri'],
            'Mzinda' => ['Khalid Mernissi', 'Salma Guessous', 'Driss Lahlou', 'Naima Skalli', 'Anas Bouzidi'],
        ];

        $ledger = new CashLedgerService;
        $beneficiaries = ['Marjan', 'Bim', 'Aswak Essalame', 'Ferme', 'Transport'];
        $descriptions = [
            'Acheter des bouteilles d\'eau',
            'Acheter des capsules de café',
            'Remplir la citerne d\'arrosage',
            'Payer une facture de livraison',
            'Acheter des produits de nettoyage',
        ];

        // Single, company-wide caisse — matching the reference Excel's
        // "Admin" sheet, which holds one shared solde/reste across all sites.
        $cashAccount = CashAccount::create([
            'initial_balance' => 3000,
            'allow_negative_balance' => false,
        ]);

        $siteIndex = 0;
        foreach ($sites as $siteName => $site) {
            $dayOffsetBase = 20 - $siteIndex * 5;

            if ($siteIndex > 0) {
                // Recharge the shared caisse before this site's purchases —
                // no site_id, just like the site-less "Entree" rows in the
                // reference Excel's Admin sheet.
                $ledger->create($cashAccount, [
                    'type' => 'entry',
                    'site_id' => null,
                    'date' => now()->subDays($dayOffsetBase + 1)->toDateString(),
                    'beneficiary' => 'Direction',
                    'description' => 'Recharge de caisse',
                    'amount' => 4000,
                ]);
            }

            User::create([
                'name' => 'Responsable '.$siteName,
                'email' => 'responsable.'.Str::slug($siteName).'@transwin-mining.com',
                'password' => Hash::make('password'),
                'role' => 'responsable',
                'site_id' => $site->id,
            ]);

            $employees = collect();
            foreach ($employeeNames[$siteName] as $index => $fullName) {
                $department = $departments->values()->get($index % $departments->count());
                $position = $positions->values()->get($index % $positions->count());
                $entryDate = now()->subDays(rand(60, 900));

                $employee = Employee::create([
                    'full_name' => $fullName,
                    'site_id' => $site->id,
                    'department_id' => $department->id,
                    'position_id' => $position->id,
                    'establishment' => $siteName,
                    'entry_date' => $entryDate,
                    'status' => 'actif',
                ]);

                Assignment::create([
                    'employee_id' => $employee->id,
                    'site_id' => $site->id,
                    'department_id' => $department->id,
                    'position_id' => $position->id,
                    'start_date' => $entryDate,
                    'is_current' => true,
                ]);

                Entry::create([
                    'employee_id' => $employee->id,
                    'full_name' => $fullName,
                    'position_id' => $position->id,
                    'department_id' => $department->id,
                    'establishment' => $siteName,
                    'site_id' => $site->id,
                    'entry_date' => $entryDate,
                ]);

                $employees->push($employee);
            }

            foreach ($employees as $index => $employee) {
                for ($day = 0; $day < 10; $day++) {
                    $date = now()->subDays($day);
                    $isAbsent = $index === 0 && $day === 2;

                    Attendance::create([
                        'employee_id' => $employee->id,
                        'site_id' => $site->id,
                        'date' => $date,
                        'status' => $isAbsent ? 'absent' : 'present',
                        'absence_cause' => $isAbsent ? 'maladie' : null,
                        'description' => $isAbsent ? 'Absence pour rendez-vous médical.' : null,
                    ]);
                }
            }

            $requester = $employees->first();
            $leaveRequest = LeaveRequest::create([
                'employee_id' => $requester->id,
                'site_id' => $site->id,
                'request_date' => now()->subDays(20),
                'desired_start_date' => now()->subDays(10),
                'duration_days' => 10,
                'reason' => 'Congé annuel',
                'status' => 'acceptee',
            ]);

            $leave = Leave::create([
                'employee_id' => $requester->id,
                'site_id' => $site->id,
                'leave_request_id' => $leaveRequest->id,
                'start_date' => now()->subDays(10),
                'duration_days' => 10,
                'end_date' => now()->subDays(1),
                'reason' => 'Congé annuel',
                'status' => 'en_cours',
            ]);

            $leave->extensions()->create([
                'extra_days' => 5,
                'reason' => 'Problème familial',
                'previous_end_date' => now()->subDays(1),
                'new_end_date' => now()->addDays(4),
            ]);
            $leave->update(['end_date' => now()->addDays(4), 'duration_days' => 15]);

            $warnedEmployee = $employees->get(1);
            DisciplinaryWarning::create([
                'employee_id' => $warnedEmployee->id,
                'site_id' => $site->id,
                'date' => now()->subDays(15),
                'reason' => 'Retard répété',
                'description' => 'Retards constatés à trois reprises durant le mois.',
            ]);

            $suspendedEmployee = $employees->get(2);
            Suspension::create([
                'employee_id' => $suspendedEmployee->id,
                'site_id' => $site->id,
                'date' => now()->subDays(5),
                'reason' => 'Non-respect des consignes de sécurité',
                'description' => 'Mise à pied suite à un incident HSE.',
                'duration_days' => 3,
                'start_date' => now()->subDays(5),
                'end_date' => now()->subDays(3),
            ]);

            $exitedEmployee = $employees->last();
            EmployeeExit::create([
                'employee_id' => $exitedEmployee->id,
                'full_name' => $exitedEmployee->full_name,
                'position_id' => $exitedEmployee->position_id,
                'department_id' => $exitedEmployee->department_id,
                'site_id' => $site->id,
                'entry_date' => $exitedEmployee->entry_date,
                'exit_date' => now()->subDays(2),
                'reason' => 'Fin de contrat',
            ]);
            $exitedEmployee->update(['status' => 'sorti', 'exit_date' => now()->subDays(2)]);

            for ($i = 0; $i < 5; $i++) {
                $ledger->create($cashAccount, [
                    'type' => 'expense',
                    'site_id' => $site->id,
                    'date' => now()->subDays($dayOffsetBase - $i)->toDateString(),
                    'beneficiary' => $beneficiaries[$i],
                    'description' => $descriptions[$i],
                    'amount' => rand(30, 400),
                ]);
            }

            $siteIndex++;
        }
    }
}
