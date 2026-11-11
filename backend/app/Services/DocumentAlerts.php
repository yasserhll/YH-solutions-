<?php

namespace App\Services;

use App\Http\Controllers\Api\EmployeeDocumentController;
use App\Models\Employee;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Device notifications for the CIN and permis de conduire (Contrats → CIN /
 * Permis): each document is pushed ONCE when it enters "bientôt" (30 days
 * before the expiry) and once more when it is "expirée", to every account
 * with the contrats session and the employee's site — same rules as the
 * contract alerts, and run by them (ContractAlerts::notifyDue(), under the
 * same lock and triggers: any save, the bell, the every-minute cron).
 * `employees.cin_notified_state` / `license_notified_state` remember what
 * was already sent. A missing date never alerts (the Contrats page lists it).
 */
class DocumentAlerts
{
    /** doc => [date column, notified column, label] */
    private const DOCS = [
        'cin' => ['cin_expiry_date', 'cin_notified_state', 'CIN'],
        'permis' => ['license_expiry_date', 'license_notified_state', 'Permis'],
    ];

    public function __construct(private WebPushService $push) {}

    /** @return int documents newly notified (the caller holds the lock). */
    public function send(): int
    {
        $today = now()->toDateString();
        $soon = now()->addDays(EmployeeDocumentController::ALERT_DAYS)->toDateString();
        $due = collect();

        foreach (self::DOCS as $doc => [$date, $notified]) {
            // Renewed (or date removed / person gone): may be alerted again later.
            Employee::query()->whereNotNull($notified)
                ->where(fn ($q) => $q->whereNull($date)->orWhere($date, '>', $soon)->orWhere('status', '!=', 'actif'))
                ->update([$notified => null]);

            Employee::query()->with('site:id,name')
                ->where('status', 'actif')
                ->whereNotNull($date)->where($date, '<=', $soon)
                ->get()
                ->each(function (Employee $e) use ($doc, $date, $notified, $today, $due) {
                    $state = $e->{$date}->toDateString() < $today ? 'expire' : 'bientot';
                    if ($e->{$notified} !== $state) {
                        $due->push(['doc' => $doc, 'state' => $state, 'employee' => $e, 'days' => (int) now()->startOfDay()->diffInDays($e->{$date}, false)]);
                    }
                });
        }

        if ($due->isEmpty()) {
            return 0;
        }

        $users = User::with('sites')->whereHas('pushSubscriptions')->get()->filter(fn (User $u) => $u->hasModule('contrats'));
        foreach ($users as $user) {
            $sites = $user->assignedSiteIds();
            $mine = $due->filter(fn ($a) => in_array($a['employee']->site_id, $sites, true))->values();
            if ($mine->isNotEmpty()) {
                $this->push->sendToUsers([$user->id], $this->payload($mine));
            }
        }

        // Marked even when nobody was subscribed (a device switched on later only gets the NEW alerts).
        foreach ($due->groupBy(fn ($a) => $a['doc'].'|'.$a['state']) as $key => $alerts) {
            [$doc, $state] = explode('|', $key);
            Employee::whereIn('id', $alerts->pluck('employee.id'))->update([self::DOCS[$doc][1] => $state]);
        }

        return $due->count();
    }

    /** One notification per account: the document itself, or a summary. */
    private function payload(Collection $alerts): array
    {
        $docs = $alerts->pluck('doc')->unique();
        $base = [
            'url' => '/contrats?vue='.($docs->count() === 1 ? $docs->first() : 'cin').'&state=a_traiter',
            'tag' => 'documents',
        ];

        if ($alerts->count() === 1) {
            $a = $alerts->first();
            $label = self::DOCS[$a['doc']][2];
            $e = $a['employee'];
            $end = $e->{self::DOCS[$a['doc']][0]}->format('d/m/Y');
            $site = $e->site?->name ? " · {$e->site->name}" : '';
            $fem = $a['doc'] === 'cin' ? 'e' : '';

            if ($a['state'] === 'expire') {
                return $base + [
                    'title' => "{$label} expiré{$fem}",
                    'body' => "{$e->full_name} · {$label} expiré{$fem} depuis le {$end}{$site}. À renouveler.",
                ];
            }
            $when = $a['days'] === 0 ? "aujourd'hui" : "dans {$a['days']} jour".($a['days'] > 1 ? 's' : '');

            return $base + [
                'title' => "{$label} bientôt expiré{$fem}",
                'body' => "{$e->full_name} · {$label} expire {$when} ({$end}){$site}.",
            ];
        }

        $parts = [];
        foreach (['cin' => ['CIN expirée', 'CIN expirées', 'CIN bientôt expirée', 'CIN bientôt expirées'], 'permis' => ['permis expiré', 'permis expirés', 'permis bientôt expiré', 'permis bientôt expirés']] as $doc => $words) {
            $expired = $alerts->where('doc', $doc)->where('state', 'expire')->count();
            $soon = $alerts->where('doc', $doc)->where('state', 'bientot')->count();
            if ($expired) {
                $parts[] = $expired.' '.($expired > 1 ? $words[1] : $words[0]);
            }
            if ($soon) {
                $parts[] = $soon.' '.($soon > 1 ? $words[3] : $words[2]);
            }
        }
        $names = $alerts->take(3)->map(fn ($a) => $a['employee']->full_name)->unique()->implode(', ');
        $others = $alerts->count() - min(3, $alerts->count());

        return $base + [
            'title' => $alerts->count().' pièces d’identité à renouveler',
            'body' => implode(' · ', $parts).' — '.$names.($others > 0 ? " et {$others} autre".($others > 1 ? 's' : '') : '').'.',
        ];
    }
}
