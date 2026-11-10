<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Contrats: a 2nd (or later) CDD that has ended becomes a CDI (see
// Contract::promoteDueToCdi — it also runs on every Contrats/bell request,
// so this schedule is only a backup when a cron is configured).
Artisan::command('contrats:cdi-auto', function () {
    $this->info(\App\Models\Contract::promoteDueToCdi().' contrat(s) passé(s) en CDI.');
})->purpose('Passe en CDI les 2èmes CDD (ou suivants) arrivés à leur fin');

Schedule::command('contrats:cdi-auto')->dailyAt('00:10');

// Device notifications (Web Push) for contracts entering "bientôt" / "terminé".
// Also sent right after any contract change and on the top-bar bell.
Artisan::command('contrats:notifier', function () {
    $this->info(app(\App\Services\ContractAlerts::class)->notifyDue().' contrat(s) notifié(s).');
})->purpose('Envoie les notifications appareil des contrats bientôt terminés / terminés');

// Every minute: a contract crossing into "bientôt" / "terminé" at midnight is
// pushed within the minute (changes made in the app are pushed instantly).
Schedule::command('contrats:notifier')->everyMinute()->withoutOverlapping();
